import contextlib
import time

import numpy as np
import pytest

from arena.assets import ASSET_ROOT
from arena.constants import NUM_JOINTS, OBS_SIZE
from arena.policy import ANSWER_S, MAX_MODEL_BYTES, PolicyError, _width, load_policy

REFERENCE = ASSET_ROOT / "policies" / "BEST_alpha_walking.onnx"


def test_reference_policy_loads_and_acts():
    policy = load_policy(REFERENCE)
    action = policy.act(np.zeros(OBS_SIZE, dtype=np.float32))
    assert action.shape == (NUM_JOINTS,)
    assert np.all(np.isfinite(action))


def test_a_policy_runs_on_one_thread():
    """A troupe runs up to eight policies in one process. With onnxruntime's default pools, a thread
    per core for each, eight ducks spent 19 s of CPU on a 3 s run, against 3 s on one thread each."""
    options = load_policy(REFERENCE).session.get_session_options()
    assert options.intra_op_num_threads == 1


def test_sha256_is_stable():
    assert load_policy(REFERENCE).sha256 == load_policy(REFERENCE).sha256
    assert len(load_policy(REFERENCE).sha256) == 64


def test_wrong_observation_width_is_named_precisely(tmp_path):
    # The 51-D family is a real mistake people make: same sensors, the legacy
    # 3-value command instead of the unified 13-value one.
    model = _make_onnx(tmp_path / "legacy.onnx", obs_width=51, action_width=14)
    with pytest.raises(PolicyError, match=r"observation width is 51, expected 61"):
        load_policy(model)


def test_wrong_action_width_is_named_precisely(tmp_path):
    model = _make_onnx(tmp_path / "wide.onnx", obs_width=61, action_width=20)
    with pytest.raises(PolicyError, match=r"action width is 20, expected 14"):
        load_policy(model)


def test_oversize_model_is_rejected(tmp_path):
    fat = tmp_path / "fat.onnx"
    fat.write_bytes(b"\0" * (MAX_MODEL_BYTES + 1))
    with pytest.raises(PolicyError, match="larger than"):
        load_policy(fat)


def test_garbage_is_rejected(tmp_path):
    junk = tmp_path / "junk.onnx"
    junk.write_bytes(b"not an onnx file")
    with pytest.raises(PolicyError, match="not a loadable ONNX model"):
        load_policy(junk)


def test_a_missing_file_is_rejected_not_crashed(tmp_path):
    """A path that does not exist is a rejection, not a FileNotFoundError."""
    with pytest.raises(PolicyError, match="cannot read the model file"):
        load_policy(tmp_path / "does-not-exist.onnx")


def test_a_dynamic_batch_axis_is_accepted(tmp_path):
    """A symbolic batch dimension is an unknown width, not a wrong one.

    Rejecting it would turn away perfectly ordinary exports, since most training
    pipelines emit a dynamic batch axis.
    """
    model = _make_onnx(tmp_path / "dyn.onnx", 61, 14, dynamic_batch=True)
    policy = load_policy(model)
    assert policy.act(np.zeros(OBS_SIZE, dtype=np.float32)).shape == (NUM_JOINTS,)


def test_width_reads_an_unknown_axis_as_unknown_rather_than_erroring():
    """The guard that keeps an IndexError from escaping load_policy.

    onnxruntime's lenient shape merge can hand back an EMPTY shape when a graph's
    declared output shape conflicts with the inferred one. Whether any particular
    malformed model triggers that depends on the onnxruntime version, so the
    guard is pinned here directly instead of through a fixture that may quietly
    stop reproducing it on an upgrade. Without the guard, the first case raises
    IndexError.
    """
    assert _width([]) is None
    assert _width([1, 61]) == 61
    assert _width(["batch", 61]) == 61
    assert _width(["batch"]) is None
    assert _width([1, 61], axis=5) is None


def test_a_one_dimensional_input_does_not_crash_the_loader(tmp_path):
    """A smoke test over the whole loader for an odd but well-formed graph.

    This module is the front door for untrusted files, so the loader must answer
    with a Policy or a PolicyError and never a raw exception — any other
    exception type escaping this block fails the test. Note this fixture does not
    necessarily exercise the empty-shape path; which graphs trigger that is an
    onnxruntime implementation detail. The direct guarantee lives in
    test_width_reads_an_unknown_axis_as_unknown_rather_than_erroring.
    """
    model = _make_onnx(tmp_path / "flat.onnx", 61, 14, flat_input=True)
    with contextlib.suppress(PolicyError):
        load_policy(model)


def test_the_cap_admits_the_largest_real_community_policy():
    """Measured: juicenv/duckwing-v80-roller-skating is 8.4 MB, and the old
    4 MiB cap rejected it. The cap is raised, not removed — an unbounded upload
    to a shared 2-vCPU Space is a denial-of-service vector."""
    assert MAX_MODEL_BYTES == 64 * 1024 * 1024
    assert MAX_MODEL_BYTES > 8_409_525


def test_an_oversize_model_is_still_refused_with_its_size(tmp_path):
    fat = tmp_path / "fat.onnx"
    fat.write_bytes(b"\0" * (MAX_MODEL_BYTES + 1))
    with pytest.raises(PolicyError, match="larger than"):
        load_policy(fat)


def test_a_model_that_loops_for_ever_is_given_up_after_a_second(tmp_path):
    """An ONNX Loop of 2**62 trips: an evaluation or a cup waiting on it would wait for ever."""
    policy = load_policy(looping_onnx(tmp_path / "loop.onnx"))
    started = time.monotonic()
    with pytest.raises(PolicyError, match=r"^no answer within 1 s$"):
        policy.act(np.zeros(OBS_SIZE, dtype=np.float32))
    assert ANSWER_S == 1.0 and time.monotonic() - started < ANSWER_S + 0.5


def test_a_model_that_fails_to_act_says_why(tmp_path):
    """An action as wide as the observation has non-zero values, unknown at load: none of zeros."""
    import onnx
    from onnx import TensorProto, helper

    graph = helper.make_graph(
        [helper.make_node("NonZero", ["obs"], ["where"]), helper.make_node("Cast", ["where"], ["actions"], to=1)],
        "nonzero",
        [helper.make_tensor_value_info("obs", TensorProto.FLOAT, [1, OBS_SIZE])],
        [helper.make_tensor_value_info("actions", TensorProto.FLOAT, [2, "found"])],
    )
    onnx.save(helper.make_model(graph, opset_imports=[helper.make_opsetid("", 18)]), str(tmp_path / "nonzero.onnx"))
    policy = load_policy(tmp_path / "nonzero.onnx")
    with pytest.raises(PolicyError, match=r"^no action: cannot reshape array of size 0"):
        policy.act(np.zeros(OBS_SIZE, dtype=np.float32))


def looping_onnx(path):
    """A model whose every answer loops 2**62 times, adding one to the observation, before it slices
    its action out."""
    import onnx
    from onnx import TensorProto, helper

    body = helper.make_graph(
        [helper.make_node("Identity", ["cond_in"], ["cond_out"]), helper.make_node("Add", ["x_in", "one"], ["x_out"])],
        "body",
        [helper.make_tensor_value_info("i", TensorProto.INT64, []),
         helper.make_tensor_value_info("cond_in", TensorProto.BOOL, []),
         helper.make_tensor_value_info("x_in", TensorProto.FLOAT, [1, OBS_SIZE])],
        [helper.make_tensor_value_info("cond_out", TensorProto.BOOL, []),
         helper.make_tensor_value_info("x_out", TensorProto.FLOAT, [1, OBS_SIZE])],
        [helper.make_tensor("one", TensorProto.FLOAT, [], [1.0])],
    )
    graph = helper.make_graph(
        [helper.make_node("Loop", ["trips", "cond", "obs"], ["looped"], body=body),
         helper.make_node("Slice", ["looped", "starts", "ends", "axes"], ["actions"])],
        "loop",
        [helper.make_tensor_value_info("obs", TensorProto.FLOAT, [1, OBS_SIZE])],
        [helper.make_tensor_value_info("actions", TensorProto.FLOAT, [1, NUM_JOINTS])],
        [helper.make_tensor("trips", TensorProto.INT64, [], [2**62]),
         helper.make_tensor("cond", TensorProto.BOOL, [], [True]),
         helper.make_tensor("starts", TensorProto.INT64, [1], [0]),
         helper.make_tensor("ends", TensorProto.INT64, [1], [NUM_JOINTS]),
         helper.make_tensor("axes", TensorProto.INT64, [1], [1])],
    )
    onnx.save(helper.make_model(graph, opset_imports=[helper.make_opsetid("", 18)]), str(path))
    return path


def _make_onnx(path, obs_width, action_width, dynamic_batch=False, flat_input=False):
    """A minimal valid ONNX graph with the given input/output widths."""
    import onnx
    from onnx import TensorProto, helper

    weight = helper.make_tensor(
        "w",
        TensorProto.FLOAT,
        [obs_width, action_width],
        np.zeros(obs_width * action_width, dtype=np.float32).tolist(),
    )
    node = helper.make_node("MatMul", ["obs", "w"], ["actions"])
    if flat_input:
        in_shape, out_shape = [obs_width], [action_width]
    elif dynamic_batch:
        in_shape, out_shape = ["batch", obs_width], ["batch", action_width]
    else:
        in_shape, out_shape = [1, obs_width], [1, action_width]
    graph = helper.make_graph(
        [node],
        "tiny",
        [helper.make_tensor_value_info("obs", TensorProto.FLOAT, in_shape)],
        [helper.make_tensor_value_info("actions", TensorProto.FLOAT, out_shape)],
        [weight],
    )
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 18)])
    onnx.save(model, str(path))
    return path
