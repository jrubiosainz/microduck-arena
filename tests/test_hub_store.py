import hashlib
import json
import threading
import time
from types import SimpleNamespace

import pytest
from huggingface_hub.hf_api import RepoFile, RepoFolder

from arena.store import HubStore, Withdrawal
from tests.test_store import make_record


class FakeHub:
    """The dataset as files whose head moves on every `commit()`. Each head keeps the files it
    had, as a Hub revision does: the tree at a head names each file by a hash of its bytes, as
    the Hub's blob id does, and a download at a head copies that head's bytes into a cache."""

    def __init__(self, tmp_path, info_delay_s=0.0):
        self.cache = tmp_path / "cache"
        self.files: dict[str, bytes] = {}
        self.trees: dict[str, dict[str, bytes]] = {}
        self.head, self.info_delay_s, self.down = 0, info_delay_s, False
        self.infos = 0
        self.downloads: list[list[str]] = [[]]

    @property
    def sha(self):
        return f"commit-{self.head}"

    def put(self, path, data: bytes):
        self.files[path] = data

    def commit(self):
        self.head += 1
        self.trees[self.sha] = dict(self.files)
        self.downloads.append([])

    def repo_info(self, repo_id, repo_type, timeout):
        if self.down:
            raise ConnectionError("the Hub is away")
        self.infos += 1
        # The head as it was when asked: a commit landing meanwhile is the next head.
        self.trees.setdefault(self.sha, dict(self.files))
        sha = self.sha
        time.sleep(self.info_delay_s)
        return SimpleNamespace(sha=sha)

    def list_repo_tree(self, repo_id, recursive, revision, repo_type):
        yield RepoFolder(path="runs", oid="folder")
        for path, data in sorted(self.trees[revision].items()):
            yield RepoFile(path=path, size=len(data), oid=hashlib.sha1(data).hexdigest())

    def hf_hub_download(self, repo_id, filename, repo_type, revision):
        self.downloads[-1].append(filename)
        out = self.cache / revision / filename
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(self.trees[revision][filename])
        return str(out)

    def create_commit(self, repo_id, repo_type, commit_message, operations):
        for op in operations:
            self.put(op.path_in_repo, op.path_or_fileobj)
        self.commit()


def publish(hub, record):
    hub.put(f"runs/{record.event_id}/{record.run_id}.json", json.dumps(record.to_dict()).encode())
    hub.put(f"traces/{record.run_id}.npz", b"trace")


def test_the_first_refresh_fetches_every_file_but_media_and_votes(tmp_path):
    hub = FakeHub(tmp_path)
    record = make_record()
    publish(hub, record)
    hub.put(f"clips/{record.run_id}/clip.json", b"{}")
    hub.put(f"clips/{record.run_id}/landscape.mp4", b"video")
    hub.put(f"clips/{record.run_id}/poster.png", b"image")
    hub.put("votes/2026-10-19/ballot.json", b"{}")
    store = HubStore("org/runs", api=hub)
    assert store.runs(record.event_id) == [record]
    assert sorted(hub.downloads[0]) == sorted([
        f"runs/{record.event_id}/{record.run_id}.json", f"traces/{record.run_id}.npz",
        f"clips/{record.run_id}/clip.json",
    ])


def test_an_unchanged_head_refreshes_without_fetching(tmp_path):
    hub = FakeHub(tmp_path)
    record = make_record()
    publish(hub, record)
    store = HubStore("org/runs", api=hub, snapshot_ttl_s=0)
    store.runs(record.event_id)
    assert store.runs(record.event_id) == [record]
    assert hub.infos == 2
    assert len(hub.downloads[0]) == 2


def test_a_new_head_fetches_only_what_changed(tmp_path):
    hub = FakeHub(tmp_path)
    first, second = make_record(), make_record()
    publish(hub, first)
    hub.put(f"clips/{first.run_id}/clip.json", b'{"v": 1}')
    store = HubStore("org/runs", api=hub, snapshot_ttl_s=0)
    store.runs(first.event_id)
    publish(hub, second)
    hub.put(f"clips/{first.run_id}/clip.json", b'{"v": 2}')
    hub.commit()
    assert {r.run_id for r in store.runs(first.event_id)} == {first.run_id, second.run_id}
    assert sorted(hub.downloads[1]) == sorted([
        f"runs/{second.event_id}/{second.run_id}.json", f"traces/{second.run_id}.npz",
        f"clips/{first.run_id}/clip.json",
    ])
    assert store.clip_state(first.run_id) == ("ready", {"v": 2})


def test_a_file_gone_from_the_hub_is_gone_from_the_snapshot(tmp_path):
    hub = FakeHub(tmp_path)
    record = make_record()
    publish(hub, record)
    hub.put(f"clips/{record.run_id}/pending.json", b"{}")
    store = HubStore("org/runs", api=hub, snapshot_ttl_s=0)
    assert store.clip_state(record.run_id) == ("pending", None)
    del hub.files[f"clips/{record.run_id}/pending.json"]
    hub.commit()
    assert store.clip_state(record.run_id) == ("none", None)


def test_a_reader_keeps_its_folder_for_one_refresh(tmp_path):
    hub = FakeHub(tmp_path)
    record = make_record()
    publish(hub, record)
    store = HubStore("org/runs", api=hub, snapshot_ttl_s=0)
    held = store.snapshot()
    hub.put("seen/a.json", b"{}")
    hub.commit()
    store.snapshot()
    assert held.runs(record.event_id) == [record]
    hub.put("seen/b.json", b"{}")
    hub.commit()
    store.snapshot()
    assert not held.root.exists()


def test_a_head_seen_before_is_built_again_without_losing_the_snapshot(tmp_path):
    hub = FakeHub(tmp_path)
    record = make_record()
    publish(hub, record)
    store = HubStore("org/runs", api=hub, snapshot_ttl_s=0)
    store.snapshot()
    hub.put("seen/a.json", b"{}")
    hub.commit()
    store.snapshot()
    # The dataset's last commit undone: the head is the one the previous folder was built from.
    hub.head -= 1
    assert store.runs(record.event_id) == [record]


def test_concurrent_readers_share_one_refresh(tmp_path):
    hub = FakeHub(tmp_path, info_delay_s=0.2)
    publish(hub, make_record())
    store = HubStore("org/runs", api=hub)
    got = []
    readers = [threading.Thread(target=lambda: got.append(store.snapshot())) for _ in range(8)]
    for reader in readers:
        reader.start()
    for reader in readers:
        reader.join()
    assert hub.infos == 1
    assert len({id(snapshot) for snapshot in got}) == 1


def test_a_write_is_read_back_at_once(tmp_path):
    hub = FakeHub(tmp_path)
    record = make_record()
    publish(hub, record)
    store = HubStore("org/runs", api=hub)
    assert store.withdrawals() == []
    gone = Withdrawal(run_id=record.run_id, event_id=record.event_id, user=record.user,
                      withdrawn_at="2026-10-19T10:00:00Z")
    store.withdraw(gone)
    assert store.withdrawals() == [gone]


def test_a_write_is_read_back_even_while_another_refresh_builds_an_older_head(tmp_path):
    hub = FakeHub(tmp_path)
    record = make_record()
    publish(hub, record)
    store = HubStore("org/runs", api=hub)
    store.snapshot()
    store.refresh()
    # Another request starts the refresh and reads the head before the write lands.
    hub.info_delay_s = 0.3
    other = threading.Thread(target=store.snapshot)
    other.start()
    time.sleep(0.1)
    hub.info_delay_s = 0.0
    gone = Withdrawal(run_id=record.run_id, event_id=record.event_id, user=record.user,
                      withdrawn_at="2026-10-19T10:00:00Z")
    store.withdraw(gone)
    assert store.withdrawals() == [gone]
    other.join()


def test_a_hub_hiccup_keeps_the_last_snapshot(tmp_path):
    hub = FakeHub(tmp_path)
    record = make_record()
    publish(hub, record)
    store = HubStore("org/runs", api=hub, snapshot_ttl_s=0)
    store.runs(record.event_id)
    hub.down = True
    assert store.runs(record.event_id) == [record]


def test_a_hub_down_at_the_first_read_is_an_error(tmp_path):
    hub = FakeHub(tmp_path)
    hub.down = True
    with pytest.raises(ConnectionError):
        HubStore("org/runs", api=hub).snapshot()
