// Who the camera looks at, and from where. Ported from Duck Jam's
// dome/media/commentators/direction.mjs: the duo wide by default; after ten
// seconds wide, one close shot on a speaker, held five to seven seconds to the
// end of that reply, never within five seconds of the end and never while the
// partner speaks inside it; a speaker change never interrupts a shot.

const BOOTH_TURN = Math.PI / 6;

export function shotsFor(plan) {
  const turns = [];
  for (const cue of plan.captions) {
    const last = turns.at(-1);
    if (last?.shot === cue.speaker && last.end_ms === cue.start_ms) last.end_ms = cue.end_ms;
    else turns.push({ shot: cue.speaker, start_ms: cue.start_ms, end_ms: cue.end_ms });
  }
  const shots = [];
  let cursor = 0;
  for (const turn of turns) {
    if (turn.start_ms < cursor + 10000) continue;
    const end_ms = Math.max(turn.start_ms + 5000, Math.min(turn.end_ms, turn.start_ms + 7000));
    if (end_ms > plan.duration_ms - 5000) continue;
    if (plan.captions.some((cue) => cue.speaker !== turn.shot && cue.start_ms < end_ms && cue.end_ms > turn.start_ms)) {
      continue;
    }
    shots.push({ shot: "duo", start_ms: cursor, end_ms: turn.start_ms }, { ...turn, end_ms });
    cursor = end_ms;
  }
  shots.push({ shot: "duo", start_ms: cursor, end_ms: plan.duration_ms });
  return shots;
}

/** Item time is the only camera clock. Booth-local x follows the actors and
 * negative y faces the auditorium; the booth stands turned by π/6 in the world. */
export function direct(plan) {
  const shots = shotsFor(plan);
  const world = ([x, y, z]) => [
    x * Math.cos(BOOTH_TURN) - y * Math.sin(BOOTH_TURN),
    x * Math.sin(BOOTH_TURN) + y * Math.cos(BOOTH_TURN),
    z,
  ];
  return (ms, aspect = 16 / 9) => {
    const shot = shots.find((s) => s.start_ms <= ms && ms < s.end_ms) ?? shots.at(-1);
    const t = Math.max(0, Math.min(1, (ms - shot.start_ms) / Math.max(1, shot.end_ms - shot.start_ms)));
    const ease = t * t * (3 - 2 * t);
    const duo = shot.shot === "duo";
    const x = duo ? 0 : shot.shot === "peter" ? -0.16 : 0.16;
    const target = world([x, 0, duo ? 0.12 : 0.15]);
    const back = duo ? 1.1 - 0.02 * ease : 0.6 - 0.045 * ease;
    // Room for the heads at narrow aspects, portrait included.
    const fit = Math.max(1, 16 / 9 / aspect);
    const offset = world([duo ? 0.025 * ease : 0, -back, duo ? 0.34 : 0.2]);
    return { ...shot, target, position: target.map((v, i) => v + offset[i] * fit) };
  };
}
