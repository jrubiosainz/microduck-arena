"""Scalars from a TensorBoard event file, without TensorBoard.

The Arena must not depend on the training stack, and a curve needs one tag. The
file is a sequence of TFRecords — an 8-byte length, a 4-byte CRC, the record, a
4-byte CRC — each record an `Event` protobuf: `step` is field 2, `summary` field
5; a summary's `value`s are field 1, each with `tag` (1) and `simple_value` (2),
which is what rsl_rl's SummaryWriter.add_scalar writes. CRCs are not checked: a
record still being written is simply shorter than its length says, or its length
arrived but a field inside it stops mid-way (a truncated varint, a float cut
short) — either way it is torn, not malformed, and is left for the next read.
Checked against tensorboard's own EventAccumulator on a real rsl_rl 5.0.1 file
(tests/fixtures/workshop/).
"""

import struct
from pathlib import Path


def _varint(buf: bytes, i: int) -> tuple[int, int]:
    shift = value = 0
    while True:
        byte = buf[i]
        i += 1
        value |= (byte & 0x7F) << shift
        if byte < 0x80:
            return value, i
        shift += 7


def _fields(buf: bytes):
    """(field number, value) for each field of one protobuf message."""
    i = 0
    while i < len(buf):
        key, i = _varint(buf, i)
        field, wire = key >> 3, key & 7
        if wire == 0:
            value, i = _varint(buf, i)
        elif wire == 1:
            value = struct.unpack_from("<d", buf, i)[0]
            i += 8
        elif wire == 2:
            size, i = _varint(buf, i)
            value = bytes(buf[i:i + size])
            i += size
        elif wire == 5:
            value = struct.unpack_from("<f", buf, i)[0]
            i += 4
        else:
            raise ValueError(f"unsupported protobuf wire type {wire}")
        yield field, value


def scalars(path: Path, tag: str) -> list[tuple[int, float]]:
    """Every (step, value) recorded under `tag`, in file order."""
    data = Path(path).read_bytes()
    wanted = tag.encode()
    points, i = [], 0
    while i + 12 <= len(data):
        (size,) = struct.unpack_from("<Q", data, i)
        record = data[i + 12:i + 12 + size]
        if len(record) < size:
            break
        i += 12 + size + 4
        try:
            event = dict(_fields(record))
            if 5 not in event:
                continue
            for field, value in _fields(event[5]):
                if field != 1:
                    continue
                entry = dict(_fields(value))
                if entry.get(1) == wanted and 2 in entry:
                    points.append((event.get(2, 0), entry[2]))
        except (IndexError, struct.error):
            break  # the length arrived but a field inside stops mid-way: torn too
    return points
