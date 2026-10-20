// The tug of war's arithmetic, as the server's (arena/tug.py): where a string is tied, where
// the marker stands, how hard the bench's winch pulls, and the lanes the viewer plays.
// Frames are MJCF (z up); `toThree` carries a point to the scene.

import { CTRL_DT, frameCount, leadIn } from "./replay.js";

/** An MJCF point (x, y, z up) in the three.js scene (y up). */
export const toThree = ([x, y, z]) => [x, z, -y];

/** Where a duck's string is tied: `offset` in the trunk's frame, turned by the trunk's
 * quaternion (frame[3:7] = w, x, y, z) and carried to its position. */
export function stringEnd(frame, offset) {
  const [w, ux, uy, uz] = [frame[3], frame[4], frame[5], frame[6]];
  const [vx, vy, vz] = offset;
  const t = [2 * (uy * vz - uz * vy), 2 * (uz * vx - ux * vz), 2 * (ux * vy - uy * vx)];
  return [
    frame[0] + vx + w * t[0] + (uy * t[2] - uz * t[1]),
    frame[1] + vy + w * t[1] + (uz * t[0] - ux * t[2]),
    frame[2] + vz + w * t[2] + (ux * t[1] - uy * t[0]),
  ];
}

/** The marker's x: the middle of the two string ends. */
export const markerX = (westFrame, eastFrame, offset) =>
  (stringEnd(westFrame, offset)[0] + stringEnd(eastFrame, offset)[0]) / 2;

/** The winch's pull in newtons `t` seconds into the timed run, never below 0, never above the top. */
export function benchForce({ ramp_n_per_s: ramp, top_n: top, jerks }, t) {
  const pull = ramp * t + jerks.reduce((sum, [amp, hz, phase]) => sum + amp * Math.sin(2 * Math.PI * hz * t + phase), 0);
  return Math.min(top, Math.max(0, pull));
}

/** The dial at a lane's frame `index`: nothing during the `lead` frames of settle, then the winch from the clock's start. */
export const forceAt = (profile, index, lead) =>
  index < lead ? 0 : benchForce(profile, (index - lead) * CTRL_DT);

/** The lanes of an entry for `viewer.setLanes`: a bench's one duck, a bout's two (west first), each settle led in. */
export function tugDucks(entry) {
  const ducks = entry.tug === "bench" ? [entry] : entry.ducks;
  const lead = Math.max(...ducks.map((duck) => (duck.settle ? frameCount(duck.settle) : 0)));
  return ducks.map(({ trace, settle, livery, name }) => ({
    trace: leadIn(settle ?? new Float32Array(0), trace, lead),
    lead,
    livery,
    name,
  }));
}

/** Both string ends, MJCF, of one frame per duck: the second is the duck's, or the winch on the bench. */
export const tugEnds = (event, frames) => [
  stringEnd(frames[0], event.string_offset),
  frames[1] ? stringEnd(frames[1], event.string_offset) : event.winch,
];
