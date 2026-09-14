"""Publish a policy to its AUTHOR's Hugging Face repo.

The Space keeps no weights. Publishing writes `policy.onnx` to
`<user>/microduck-<slug>` with the author's own OAuth token and records a link,
so the policy is attributed to them, versioned by them, and downloadable onto a
real duck by anyone.

Two conventions are copied from what is already on the Hub rather than invented:
`policy.onnx` at the repo root, and a `manifest.json` declaring the contract.
14 repos already carry the `microduck-policy` tag; joining that is the point.

`api` is handed in — an `HfApi` in production, a recorder in tests — so none of
this needs a network to be tested.
"""

import json
import re
from dataclasses import dataclass

from .constants import ACTION_SCALE, CTRL_DT, NUM_JOINTS, OBS_SIZE

POLICY_FILENAME = "policy.onnx"
MANIFEST_FILENAME = "manifest.json"
# The tag the ecosystem already searches by, plus the broader one.
TAGS = ("microduck-policy", "microduck", "onnx", "robotics")
_UNSAFE = re.compile(r"[^a-z0-9]+")
# MJCF rig name -> the string the community manifests use.
RIG_MODEL = {"legs": "microduck", "rollers": "microduck passive rollers"}


class HubPublishError(Exception):
    """Writing to the author's repo failed, with a reason fit to show them."""


@dataclass(frozen=True)
class PublishedPolicy:
    repo_id: str
    filename: str
    revision: str
    url: str


def slugify(name: str) -> str:
    """A safe repo-name segment from a submitted policy name.

    This lands in someone's Hub namespace as a path, so it is sanitised rather
    than trusted: no dots, no slashes, no traversal, and a length bound.
    """
    slug = _UNSAFE.sub("-", str(name or "").lower()).strip("-")
    slug = re.sub(r"-{2,}", "-", slug)[:60].strip("-")
    return slug or "policy"


def policy_manifest(name: str, rig: str) -> dict:
    """The contract, in the shape the community already declares it."""
    return {
        "schema_version": 2,
        "model_api": 1,
        "name": name,
        "kind": "perpetual",
        "obs_len": OBS_SIZE,
        "action_len": NUM_JOINTS,
        "action_scale": ACTION_SCALE,
        "entry_pose": "standing",
        "robot": {
            "model": RIG_MODEL.get(rig, "microduck"),
            "control_hz": round(1.0 / CTRL_DT),
        },
        "published_by": "microduck-arena",
    }


def _readme(name: str, slug: str) -> bytes:
    tags = "\n".join(f"- {tag}" for tag in TAGS)
    control_hz = round(1.0 / CTRL_DT)
    return (
        f"---\nlibrary_name: onnx\ntags:\n{tags}\n---\n\n"
        f"# microduck-{slug}\n\n"
        f"`{POLICY_FILENAME}` is a Microduck policy: {OBS_SIZE}-value observation in, "
        f"{NUM_JOINTS} joint\n"
        f"targets out, {control_hz} Hz. Published from the Microduck Arena.\n\n"
        f"See `{MANIFEST_FILENAME}` for the full contract.\n"
    ).encode()


def publish_policy(api, username: str, name: str, blob: bytes, rig: str) -> PublishedPolicy:
    from huggingface_hub import CommitOperationAdd

    slug = slugify(name)
    repo_id = f"{username}/microduck-{slug}"
    try:
        # public, and exist_ok: republishing a name is a new commit on the same
        # repo, which is how version history comes for free.
        api.create_repo(repo_id, repo_type="model", private=False, exist_ok=True)
    except Exception as exc:  # the Hub's own wording is the useful part
        raise HubPublishError(f"could not create {repo_id}: {exc}") from exc

    manifest = json.dumps(policy_manifest(name, rig), indent=2).encode()
    try:
        result = api.create_commit(
            repo_id=repo_id,
            repo_type="model",
            operations=[
                CommitOperationAdd(path_in_repo=POLICY_FILENAME, path_or_fileobj=blob),
                CommitOperationAdd(path_in_repo=MANIFEST_FILENAME, path_or_fileobj=manifest),
                CommitOperationAdd(path_in_repo="README.md", path_or_fileobj=_readme(name, slug)),
            ],
            commit_message=f"Publish {name} from the Microduck Arena",
        )
    except Exception as exc:
        raise HubPublishError(f"could not write to {repo_id}: {exc}") from exc

    revision = getattr(result, "oid", None)
    if not revision:
        # Without a revision the recorded link cannot be pinned, and an
        # unpinned link silently changes what a leaderboard row points at.
        raise HubPublishError(f"{repo_id}: the commit returned no revision")

    return PublishedPolicy(
        repo_id=repo_id,
        filename=POLICY_FILENAME,
        revision=revision,
        url=f"https://huggingface.co/{repo_id}/resolve/{revision}/{POLICY_FILENAME}",
    )
