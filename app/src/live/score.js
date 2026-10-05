// A dialogue becomes a plan: captions, the droid syllables each commentator
// sings, head beats and glances, at integral milliseconds so every screen that
// plays it computes the same pose and the same sample. `prepare` runs once, in
// the clip page the worker drives; the live page only ever plays a stored plan.

export const SAMPLE_RATE = 48000;
/** Each commentator is a microduck personality (`seed`) and a way of talking:
 * the band his voice keeps to, as multiples of that duck's own pitch, how long
 * his chirps are, how long he pauses, and which gestures he reaches for. */
export const VOICES = Object.freeze({
  // The warm half of the booth: a little higher, quicker, fond of trills.
  peter: Object.freeze({
    name: "Peter Duckry", word_ms: 270, seed: 142, home: 1.15, range: [0.95, 1.55],
    chirp_ms: [100, 160], gap_ms: [60, 150],
    gestures: Object.freeze({ chirps: 4, swoop: 2, trill: 1.5, quack: 1.5 }),
  }),
  // The dry half: lower, steadier, slower.
  ray: Object.freeze({
    name: "Ray Quackson", word_ms: 330, seed: 92, home: 1.05, range: [0.9, 1.45],
    chirp_ms: [120, 190], gap_ms: [90, 220],
    gestures: Object.freeze({ chirps: 4, swoop: 2, trill: 0.5, quack: 1.5 }),
  }),
});
const TURNS = { min: 2, max: 6 };
const CAPTION_CHARS = 84;
const WORD_CHARS = 42;
const FRAME_MS = 40;
// The steps a voice walks from one chirp to the next, in semitones: small ones most often.
const STEPS = [-4, -3, -2, -2, -1, 1, 2, 2, 3, 4];

/** FNV-1a over the string's code units: the seed of everything time-jittered. */
function hash(text) {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h;
}

const round = (value, places) => Math.round(value * 10 ** places) / 10 ** places;

/** One phrase in droid: `words` ({text, ms}) in time order, closed by `mark`.
 * Returns syllables at ms offsets from the phrase's start, all inside the sum
 * of the words' ms. The gestures are the microduck's own calls — chirps,
 * glides, trills, quacks — each carrying several words; numbers are read out
 * digit by digit, a fixed pitch per digit; the punctuation decides how the
 * phrase ends. Every pitch stays inside the voice's band. */
function phrase(style, words, mark, random) {
  const between = (a, b) => a + (b - a) * random();
  const pick = (list) => list[Math.floor(random() * list.length)];
  const [low, high] = style.range;
  const out = [];
  const sing = (at, ms, contour, { held = false, warble = [0, 0], buzz = 0.2, emphasis = between(0.65, 0.8) } = {}) => {
    out.push({
      at: Math.round(at), ms: Math.round(at + ms) - Math.round(at),
      contour: contour.map(([x, m]) => [round(x, 3), round(Math.min(high * 1.1, Math.max(low * 0.92, m)), 3)]),
      held, warble: warble.map((w) => round(w, 2)), buzz, emphasis: round(emphasis, 3),
    });
  };
  // A step along the scale, turned back at the edges of the voice.
  let pitch = style.home * between(0.95, 1.08);
  const walk = () => {
    const step = pick(STEPS);
    const next = pitch * 2 ** (step / 12);
    pitch = Math.min(high, Math.max(low, next > high || next < low ? pitch * 2 ** (-step / 12) : next));
    return pitch;
  };
  // The chirp's four shapes: a rise, a fall, a flick and the wek-wek's arch.
  const chirp = () => pick([
    [[0, 0.9], [0.5, between(1.08, 1.15)], [1, 1.04]],
    [[0, between(1.08, 1.15)], [0.3, 1], [1, 0.88]],
    [[0, 0.96], [1, 1.04]],
    [[0, 0.95], [0.4, 1.08], [1, 0.92]],
  ]);
  // Each gesture sings from `at` within `room` ms and returns how long it took, 0 when it could not fit.
  const gestures = {
    // Two to four chirps in a row, the wek-wek drawn out.
    chirps(at, room) {
      let t = 0, end = 0;
      for (let n = 2 + Math.floor(random() * 3); n > 0; n--) {
        const ms = between(...style.chirp_ms);
        if (t + ms > room) break;
        const p = walk();
        sing(at + t, ms, chirp().map(([x, m]) => [x, p * m]));
        end = t + ms;
        t = end + between(30, 70);
      }
      return Math.round(end);
    },
    // One held glide across several words, the inquire's and the wheee's kind.
    swoop(at, room) {
      const ms = Math.min(room, between(380, 650));
      if (ms < 300) return 0;
      const a = pitch, b = walk();
      sing(at, ms, pick([
        [[0, a], [1, b]],
        [[0, a], [between(0.35, 0.6), Math.max(a, b) * between(1.06, 1.15)], [1, b]],
        [[0, a], [between(0.35, 0.6), Math.min(a, b) * between(0.9, 0.96)], [1, b]],
      ]), {
        held: true, buzz: 0.15, emphasis: between(0.68, 0.82),
        warble: random() < 0.25 ? [between(6, 10), between(0.3, 0.6)] : [0, 0],
      });
      return Math.round(ms);
    },
    // The chirp's trill.
    trill(at, room) {
      const ms = Math.min(room, between(220, 340));
      if (ms < 200) return 0;
      const p = walk();
      sing(at, ms, [[0, p], [0.5, p * 1.06], [1, p * 0.94]], { held: true, warble: [between(10, 16), between(1.2, 2)], buzz: 0.1 });
      return Math.round(ms);
    },
    // The greet: a quack bent up then down, now and then a wak-wak.
    quack(at, room) {
      const ms = between(240, 380);
      if (ms > room) return 0;
      const p = pitch * between(0.95, 1.02), bend = between(0.08, 0.16);
      const call = [[0, p * (1 - bend / 2)], [0.18, p * (1 + bend)], [1, p * (1 - bend / 3)]];
      if (random() < 0.4 && ms * 1.75 <= room) {
        sing(at, ms, call, { buzz: 1 });
        sing(at + ms * 1.15, ms * 0.6, call.map(([x, m]) => [x, m * 0.97]), { buzz: 1 });
        return Math.round(ms * 1.75);
      }
      sing(at, ms, call, { buzz: 1 });
      return Math.round(ms);
    },
  };
  // How a phrase ends, sung over the last `ms` of it.
  const endings = {
    // A question rises, the inquire's shape.
    "?": [between(420, 560), (at, ms) => sing(at, ms, [[0, pitch * 0.94], [0.3, pitch * 0.96], [1, pitch * between(1.25, 1.4)]], { held: true, emphasis: 0.8 })],
    // An exclamation is the alarm's: a jump up, a buzz, a fall.
    "!": [between(220, 320), (at, ms) => sing(at, ms, [[0, pitch * 1.1], [0.08, pitch * 1.25], [1, pitch * 0.9]], { buzz: 0.6, emphasis: 0.9 })],
    // A statement settles: a falling chirp, or a wek-wek down.
    ".": random() < 0.5
      ? [between(220, 320), (at, ms) => sing(at, ms, [[0, pitch * 1.08], [0.3, pitch], [1, pitch * 0.88]], { emphasis: 0.72 })]
      : [between(240, 300), (at, ms) => {
        sing(at, ms * 0.42, [[0, pitch * 1.02], [0.4, pitch * 1.1], [1, pitch * 0.96]]);
        sing(at + ms * 0.58, ms * 0.42, [[0, pitch * 0.94], [0.4, pitch], [1, pitch * 0.88]]);
      }],
  };
  const choose = (last) => {
    const weights = Object.entries(style.gestures).map(([kind, w]) => [kind, kind === last ? w / 4 : w]);
    let r = random() * weights.reduce((sum, [, w]) => sum + w, 0);
    return weights.find(([, w]) => (r -= w) < 0)?.[0] ?? weights.at(-1)[0];
  };
  // Gestures fill [start, start + room), then the silence left over is spread
  // between them so the phrase breathes evenly instead of stalling at its end.
  const fill = (start, room) => {
    const groups = [];
    let t = 0, end = 0, last = null;
    while (room - t >= 120) {
      const first = out.length;
      let kind = choose(last);
      let length = gestures[kind](start + t, room - t);
      if (!length) length = gestures[(kind = "chirps")](start + t, room - t);
      if (!length) break;
      groups.push(first);
      end = t + length;
      last = kind;
      const [a, b] = style.gap_ms;
      t = end + (random() < 0.12 ? between(b, b * 1.7) : between(a, b));
    }
    const spare = room - end;
    groups.forEach((first, k) => {
      const until = groups[k + 1] ?? out.length;
      for (const syllable of out.slice(first, until)) syllable.at += Math.round((spare * k) / groups.length);
    });
  };
  let at = 0, run = 0;
  for (const word of words) {
    const digits = word.text.replace(/\D/g, "");
    if (!digits) {
      run += word.ms;
      continue;
    }
    fill(at, run);
    at += run;
    run = 0;
    // A number is read out like a terminal: one steady beep per digit, the same pitch for the same digit.
    let t = 0;
    for (const digit of digits) {
      if (t + 95 > word.ms) break;
      const p = style.home * 2 ** ((Number(digit) - 4) / 12);
      sing(at + t, 95, [[0, p], [1, p]], { held: true, buzz: 0, emphasis: 0.7 });
      t += 120;
    }
    at += word.ms;
  }
  const ending = endings[mark];
  const closing = ending && run >= 220 ? Math.min(Math.round(ending[0]), run) : 0;
  fill(at, run - closing);
  if (closing) ending[1](at + run - closing, closing);
  return out;
}

export function prepare(dialogue, seed = hash(dialogue?.run_id ?? "")) {
  if (
    typeof dialogue?.run_id !== "string" || !dialogue.run_id ||
    !Array.isArray(dialogue.turns) ||
    dialogue.turns.length < TURNS.min || dialogue.turns.length > TURNS.max ||
    !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff
  ) {
    throw new Error("Invalid commentary");
  }
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const between = (a, b) => a + (b - a) * random();
  const captions = [], notes = [], gestures = [], turns = [];
  let cursor = 800;
  for (const [index, turn] of dialogue.turns.entries()) {
    if (
      !Object.hasOwn(VOICES, turn.speaker) || typeof turn.text !== "string" || !turn.text.trim() ||
      turn.text.length > 500 || (index && dialogue.turns[index - 1].speaker === turn.speaker)
    ) {
      throw new Error("Invalid commentary turn");
    }
    const turnStart = cursor;
    const voice = VOICES[turn.speaker];
    const words = turn.text.trim().split(/\s+/);
    if (words.some((w) => w.length > WORD_CHARS)) throw new Error("Caption word is too long");
    const chunks = [];
    for (const word of words) {
      if (!chunks.length || `${chunks.at(-1).join(" ")} ${word}`.length > CAPTION_CHARS) chunks.push([]);
      chunks.at(-1).push(word);
    }
    for (const chunk of chunks) {
      const start_ms = cursor;
      let words = [];
      for (const [i, text] of chunk.entries()) {
        words.push({ text, ms: Math.round(voice.word_ms + Math.min(85, text.length * 6.5) + random() * 65) });
        const mark = /([.!?,;:])["'”’)\]]*$/.exec(text)?.[1];
        if (!mark && i < chunk.length - 1) continue;
        for (const { at, ms, ...sound } of phrase(voice, words, mark, random)) {
          notes.push({
            speaker: turn.speaker, start_ms: cursor + at, end_ms: cursor + at + ms,
            variant: Math.floor(random() * 0x7fffffff), ...sound,
          });
        }
        cursor += words.reduce((sum, word) => sum + word.ms, 0) + (/[.!?]/.test(mark) ? 160 : mark ? 85 : 0);
        words = [];
      }
      cursor = Math.max(cursor, start_ms + Math.max(1300, chunk.join(" ").length * 45));
      captions.push({ speaker: turn.speaker, name: voice.name, text: chunk.join(" "), start_ms, end_ms: cursor });
    }
    turns.push({ speaker: turn.speaker, start_ms: turnStart, end_ms: cursor });
    cursor += 500;
  }
  const duration_ms = Math.ceil(cursor / FRAME_MS) * FRAME_MS;
  for (const speaker of ["peter", "ray"]) {
    // Irregular head beats through listening and silence, not just syllables.
    for (let at = 0; at < duration_ms; ) {
      const length = Math.round(between(750, 1800));
      const beat = {
        kind: "beat", speaker, start_ms: at, end_ms: Math.min(duration_ms, at + length),
        neck: between(-0.2, 0.08), pitch: between(-0.16, 0.18), roll: between(-0.16, 0.16),
        cycles: random() < 0.3 ? 2 : 1,
      };
      gestures.push(beat);
      const gap = Math.round(between(80, 500));
      // The last beat closes the plan exactly, rather than leaving a gap
      // after it that nothing plays.
      if (at + length + gap >= duration_ms) {
        beat.end_ms = duration_ms;
        at = duration_ms;
      } else {
        at += length + gap;
      }
    }
    for (const turn of turns) {
      const listening = speaker !== turn.speaker;
      let at = turn.start_ms + Math.round(listening ? between(60, 160) : between(900, 1600));
      while (at < turn.end_ms - 450) {
        const length = Math.round(listening ? between(1900, 3200) : between(650, 1100));
        gestures.push({
          kind: "look", speaker, start_ms: at, end_ms: Math.min(turn.end_ms + 180, at + length),
          yaw: (speaker === "peter" ? 1 : -1) * between(0.85, 1.12),
        });
        at += length + Math.round(listening ? between(130, 350) : between(1400, 2300));
      }
    }
  }
  return {
    version: 2, run_id: dialogue.run_id, duration_ms, seed, sample_rate: SAMPLE_RATE, channels: 2,
    captions, notes, gestures,
  };
}

/** A pure pose at item time, so seeking and out-of-order drawing never drift. */
export function poseAt(plan, speaker, ms) {
  const note = plan.notes.find((n) => n.speaker === speaker && n.start_ms <= ms && ms < n.end_ms);
  const phase = note ? (ms - note.start_ms) / (note.end_ms - note.start_ms) : 0;
  const energy = note ? Math.sin(Math.PI * phase) * note.emphasis : 0;
  const pose = { energy, mouth: energy, neck: 0, pitch: 0, roll: 0, yaw: 0 };
  for (const gesture of plan.gestures) {
    if (gesture.speaker !== speaker || ms < gesture.start_ms || ms >= gesture.end_ms) continue;
    const t = (ms - gesture.start_ms) / (gesture.end_ms - gesture.start_ms);
    if (gesture.kind === "look") {
      const ramp = Math.min(1, (ms - gesture.start_ms) / 240, (gesture.end_ms - ms) / 240);
      pose.yaw += gesture.yaw * (0.5 - 0.5 * Math.cos(Math.PI * ramp));
    } else {
      const envelope = Math.sin(Math.PI * t) ** 2;
      for (const key of ["neck", "pitch", "roll"]) {
        const cycles = key === "pitch" ? Math.cos(2 * Math.PI * (gesture.cycles - 1) * t) : 1;
        pose[key] += gesture[key] * envelope * cycles;
      }
    }
  }
  return pose;
}

/** Sample-accurate stereo PCM; identical channels keep the two timbres apart
 * in mono. `sing(seed, note)` is the microduck synthesiser (voice.js). */
export function synthesize(plan, sing) {
  const audio = new Float32Array((plan.duration_ms * SAMPLE_RATE) / 1000 * 2);
  for (const note of plan.notes) {
    const samples = sing(VOICES[note.speaker].seed, note);
    const start = note.start_ms * 48;
    for (let i = 0; i < samples.length; i++) {
      audio[(start + i) * 2] = audio[(start + i) * 2 + 1] = samples[i] * note.emphasis;
    }
  }
  return audio;
}
