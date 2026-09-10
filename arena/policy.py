"""Load a submitted policy, or say precisely why not.

The shape check is the same one robotd does at load, worded the same way. A
policy the Arena rejects would have been rejected by the robot, in the same
sentence — and getting that sentence back in two seconds is most of what a
newcomer experiences here.
"""

import hashlib
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import onnxruntime as ort

from .constants import NUM_JOINTS, OBS_SIZE

MAX_MODEL_BYTES = 4 * 1024 * 1024


class PolicyError(Exception):
    """A submitted model cannot be used, with a reason fit to show a human."""


@dataclass
class Policy:
    session: ort.InferenceSession
    sha256: str
    _input_name: str
    _output_name: str

    def act(self, obs: np.ndarray) -> np.ndarray:
        feeds = {self._input_name: obs.reshape(1, OBS_SIZE).astype(np.float32)}
        out = self.session.run([self._output_name], feeds)[0]
        return np.asarray(out, dtype=np.float32).reshape(NUM_JOINTS)


def _width(shape, axis=-1):
    """The size of one axis, or None when it is not a concrete integer.

    Two different things mean "unknown", and neither is grounds for rejecting a
    model: a symbolic batch axis arrives as a string rather than an int, and
    onnxruntime's shape inference can hand back an EMPTY shape when a graph's
    declared output shape conflicts with the inferred one. Indexing an empty
    shape is how this function used to raise IndexError out of load_policy.
    """
    if not shape or not (-len(shape) <= axis < len(shape)):
        return None
    value = shape[axis]
    return value if isinstance(value, int) else None


def load_policy(path: Path) -> Policy:
    path = Path(path)
    try:
        size = path.stat().st_size
    except OSError as exc:
        # Every exit from this function has to be a PolicyError: a submitted path
        # that does not exist must read as a rejection, not a traceback.
        raise PolicyError(f"cannot read the model file: {exc}") from exc
    if size > MAX_MODEL_BYTES:
        raise PolicyError(f"model is {size} bytes, larger than the {MAX_MODEL_BYTES} byte limit")

    options = ort.SessionOptions()
    options.log_severity_level = 3
    try:
        session = ort.InferenceSession(str(path), options, providers=["CPUExecutionProvider"])
    except Exception as exc:  # onnxruntime raises a variety of types here
        raise PolicyError(f"not a loadable ONNX model: {exc}") from exc

    inputs = session.get_inputs()
    outputs = session.get_outputs()
    if len(inputs) != 1:
        raise PolicyError(f"model takes {len(inputs)} inputs, expected 1")
    if len(outputs) != 1:
        raise PolicyError(f"model returns {len(outputs)} outputs, expected 1")

    obs_width = _width(inputs[0].shape)
    if obs_width is not None and obs_width != OBS_SIZE:
        raise PolicyError(f"observation width is {obs_width}, expected {OBS_SIZE}")

    action_width = _width(outputs[0].shape)
    if action_width is not None and action_width != NUM_JOINTS:
        raise PolicyError(f"action width is {action_width}, expected {NUM_JOINTS}")

    return Policy(
        session=session,
        sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
        _input_name=inputs[0].name,
        _output_name=outputs[0].name,
    )
