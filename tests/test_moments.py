import numpy as np

from arena.manifest import Tug
from arena.moments import Moment, moments
from tests.test_tug import straight

COURSE = Tug(ring_m=3.0, pit_m=0.30, pit_depth_m=0.30, string_m=1.0)
START = Moment(0.0, "start", None)


def bout(frames=500):
    trace = np.zeros((2, frames, 21), np.float32)
    trace[:, :, 2] = 0.2  # standing
    trace[:, :, 3] = 1.0  # upright (w = 1)
    trace[0, :, 0], trace[1, :, 0] = -0.5, 0.5
    return trace


def tilt(trace, duck, degrees):
    theta = np.radians(degrees)
    trace[duck, :, 3] = np.cos(theta / 2)
    trace[duck, :, 4] = np.sin(theta / 2)


def test_a_bout_nobody_pulls_is_its_start_and_the_time():
    t = bout()
    assert moments(t, straight(t), COURSE) == [START, Moment(10.0, "time", None)]


def test_a_bout_reset_before_its_first_frame_is_its_start_and_its_stop():
    """MuJoCo reset on the first timed step: the bout has no frame, and stops at 0 s on the centre line."""
    t = bout(0)
    assert moments(t, straight(t), COURSE) == [START, Moment(0.0, "time", None)]


def test_the_lead_changes_when_the_marker_crosses_lead_m():
    t = bout()
    t[:, 100:300, 0] -= 0.05
    t[:, 300:, 0] += 0.05
    assert moments(t, straight(t), COURSE) == [
        START,
        Moment(2.02, "lead", "west"),
        Moment(6.02, "lead", "east"),
        Moment(10.0, "time", "east"),
    ]


def test_a_marker_wobbling_inside_lead_m_changes_nothing():
    t = bout()
    t[:, :400, 0] += 0.015 * np.sin(np.arange(400) / 8.0)
    assert moments(t, straight(t), COURSE) == [START, Moment(10.0, "time", None)]


def dragged():
    """The west duck dragged to the edge of the pit, then into it on the last of 401 frames."""
    t = bout(401)
    d = 0.4 * np.arange(401) / 399
    t[0, :, 0] = -0.5 + d
    t[1, :, 0] = 0.5 + d
    t[0, 400, 2] = -0.1
    return t


def test_a_duck_dragged_to_its_edge_then_into_the_pit():
    t = dragged()
    assert moments(t, straight(t), COURSE) == [
        START,
        Moment(0.42, "lead", "east"),
        Moment(2.02, "ground", "east"),
        Moment(5.42, "edge", "west"),
        Moment(8.02, "pit", "west"),
    ]


def test_the_marker_pulled_ground_m_one_way_is_a_moment():
    t = bout()
    d = 0.15 * np.arange(500) / 499
    t[0, :, 0] = -0.5 + d
    t[1, :, 0] = 0.5 + d
    assert moments(t, straight(t), COURSE) == [
        START,
        Moment(1.36, "lead", "east"),
        Moment(6.68, "ground", "east"),
        Moment(10.0, "time", "east"),
    ]


def test_a_tilt_past_slip_deg_is_one_slip():
    t = bout()
    tilt(t, 1, np.interp(np.arange(500), [100, 200, 300, 350, 400], [0, 48, 0, 0, 48]))
    assert moments(t, straight(t), COURSE) == [
        START,
        Moment(3.48, "slip", "east"),
        Moment(10.0, "time", None),
    ]


def test_a_duck_tipped_flat_slips_and_stays_in_play():
    t = bout()
    tilt(t, 1, np.interp(np.arange(500), [100, 190], [0, 81]))
    assert moments(t, straight(t), COURSE) == [
        START,
        Moment(2.8, "slip", "east"),
        Moment(10.0, "time", None),
    ]


def test_both_ducks_in_the_pit_on_one_frame_are_two_drops():
    t = bout(300)
    t[:, 299, 2] = -0.1
    assert moments(t, straight(t), COURSE) == [
        START,
        Moment(6.0, "pit", "west"),
        Moment(6.0, "pit", "east"),
    ]
