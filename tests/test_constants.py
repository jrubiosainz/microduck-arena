from arena import constants as c


def test_joint_names_match_default_pose():
    assert len(c.JOINT_NAMES) == c.NUM_JOINTS == 14
    assert c.DEFAULT_POSE.shape == (14,)


def test_observation_layout_sums_to_obs_size():
    # gyro(3) + projected gravity(3) + joint_pos(14) + joint_vel(14)
    # + last_action(14) + command(13)
    assert 3 + 3 + c.NUM_JOINTS * 3 + c.CMD_SIZE == c.OBS_SIZE == 61


def test_control_rate_is_50hz():
    assert c.CTRL_DT == c.TIMESTEP * c.DECIMATION
    assert 1.0 / c.CTRL_DT == 50.0


def test_default_pose_is_left_right_antisymmetric():
    # The stand keyframe mirrors left and right legs; a sign error in one leg
    # is the most likely transcription mistake and this catches it.
    pose = dict(zip(c.JOINT_NAMES, c.DEFAULT_POSE))
    for joint in ("hip_roll", "hip_pitch", "knee", "ankle"):
        assert pose[f"left_{joint}"] == -pose[f"right_{joint}"], joint


def test_trace_width_is_pos_quat_joints():
    assert c.TRACE_WIDTH == 3 + 4 + c.NUM_JOINTS == 21
