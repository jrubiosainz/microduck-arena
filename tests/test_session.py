import dataclasses

from arena.web.session import Sessions, sign, unsign


def test_a_signed_value_round_trips():
    assert unsign(sign("abc", "k"), "k") == "abc"


def test_a_tampered_value_is_rejected_not_repaired():
    signed = sign("abc", "k")
    assert unsign(signed[:-1] + ("X" if signed[-1] != "X" else "Y"), "k") is None


def test_a_value_signed_with_another_key_is_rejected():
    assert unsign(sign("abc", "k1"), "k2") is None


def test_a_value_with_no_signature_is_rejected():
    # The whole point: an attacker sets the cookie to a plain session id.
    assert unsign("abc", "k") is None


def test_comparison_is_constant_time():
    # hmac.compare_digest, not ==. Asserted by inspecting the source rather
    # than by timing, which would be flaky.
    import inspect

    from arena.web import session

    assert "compare_digest" in inspect.getsource(session.unsign)


def test_a_session_is_retrievable_by_its_id():
    sessions = Sessions()
    sid = sessions.create("alice", ttl_s=60)
    found = sessions.get(sid)
    assert found.username == "alice"


def test_a_session_holds_no_token():
    from arena.web.session import Session

    assert [f.name for f in dataclasses.fields(Session)] == ["username", "expires_at"]


def test_session_ids_are_unguessable_and_unique():
    sessions = Sessions()
    ids = {sessions.create("alice", ttl_s=60) for _ in range(50)}
    assert len(ids) == 50
    assert all(len(i) >= 32 for i in ids)


def test_an_expired_session_is_gone_not_merely_stale():
    sessions = Sessions()
    sid = sessions.create("alice", ttl_s=-1)
    assert sessions.get(sid) is None
    # And it is evicted, so a long-lived process does not accumulate them.
    assert sid not in sessions._by_id


def test_dropping_a_session_forgets_it():
    sessions = Sessions()
    sid = sessions.create("alice", ttl_s=60)
    sessions.drop(sid)
    assert sessions.get(sid) is None


def test_an_unknown_session_id_is_none_not_an_error():
    assert Sessions().get("nope") is None
