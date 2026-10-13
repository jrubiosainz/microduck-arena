//! One syllable of Peter's or Ray's, and the stage duck's quack and wheee, sung by the microduck's
//! own synthesiser.
//!
//! The voice is the robot's: a [`Personality`] drawn from the commentator's seed gives the
//! harmonics, vibrato, jitter, quack buzz and breath, and the envelopes are the synth's. Only
//! the shape is the booth's: the plan writes each syllable's length and pitch contour, so a line
//! chirps, glides, trills and quacks like a droid instead of repeating one note.
//!
//! No bindings: the page writes a contour into [`contour`], calls [`syllable`] and reads the
//! samples at [`samples`].
//!
//! The quack and the wheee are the robot's own calls, unshaped: what its pad's RT and LT play.
//! The stage duck's song is the robot's singing voice, `Stream`, driven note by note as its
//! chorale drives it. All three sing in a voice the performance tunes: five knobs over the seed's
//! personality, each a position within [0, 1] on a trait's range.

use std::cell::RefCell;
use std::f64::consts::TAU;

use sounds::chorale::midi_hz;
use sounds::{Personality, SR, Stream, synth as s};

/// The chorale's control block: a note change lands within a few milliseconds, the stream's own
/// slews shape the rest.
const BLOCK: usize = 128;
/// How much of a note sounds before it lets go, so two notes in a row re-articulate.
const SUSTAIN: f64 = 0.92;

thread_local! {
    static CONTOUR: RefCell<Vec<f32>> = const { RefCell::new(Vec::new()) };
    static NOTES: RefCell<Vec<f64>> = const { RefCell::new(Vec::new()) };
    static SAMPLES: RefCell<Vec<f32>> = const { RefCell::new(Vec::new()) };
}

/// Room for `points` pairs of (fraction of the syllable, multiple of the voice's pitch),
/// which the page fills before calling [`syllable`].
#[unsafe(no_mangle)]
pub extern "C" fn contour(points: usize) -> *mut f32 {
    CONTOUR.with_borrow_mut(|c| {
        c.resize(points * 2, 0.0);
        c.as_mut_ptr()
    })
}

/// Where the last [`syllable`] is: 48 kHz mono, peaking at -6 dBFS.
#[unsafe(no_mangle)]
pub extern "C" fn samples() -> *const f32 {
    SAMPLES.with_borrow(|s| s.as_ptr())
}

/// Render one syllable along the contour and return its length in samples.
///
/// - `held`: 1 swells and holds like a whistle, 0 strikes and decays like a chirp.
/// - `warble_hz`, `warble_st`: a trill over the contour, the chirp's warble.
/// - `buzz`: how much of this duck's quack buzz, 0..1.
#[unsafe(no_mangle)]
pub extern "C" fn syllable(
    seed: u32,
    variant: u32,
    duration_s: f64,
    held: u32,
    warble_hz: f64,
    warble_st: f64,
    buzz: f64,
) -> usize {
    let p = Personality::from_seed(seed);
    let mut rng = p.variant_rng("booth", variant);
    let t = s::t_axis(duration_s);
    let points: Vec<(f64, f64)> = CONTOUR.with_borrow(|c| {
        c.chunks(2)
            .map(|pair| {
                (
                    f64::from(pair[0]) * duration_s,
                    f64::from(pair[1]) * p.pitch_center_hz,
                )
            })
            .collect()
    });
    let warble = s::vibrato(&t, warble_hz, warble_st, rng.uniform(0.0, TAU));
    let vibrato = s::vibrato(
        &t,
        p.vibrato_rate_hz,
        p.vibrato_depth,
        rng.uniform(0.0, TAU),
    );
    let jitter = s::jitter(&t, p.jitter_depth, &mut rng);
    let freq: Vec<f32> = s::lerp(&t, &points)
        .iter()
        .zip(&warble)
        .zip(&vibrato)
        .zip(&jitter)
        .map(|(((f, w), v), j)| f * w * v * j)
        .collect();
    let mut sig = s::harmonic_osc(&s::phase_from_freq(&freq), &p.harmonics());

    let am = p.am_depth * buzz * p.quackiness;
    let breath = (p.breath * 0.5) as f32;
    for ((v, &x), n) in sig.iter_mut().zip(&t).zip(s::pink_noise(t.len(), &mut rng)) {
        *v *= (1.0 - am * (0.5 + 0.5 * (TAU * p.am_rate_hz * f64::from(x)).sin())) as f32;
        *v += breath * n;
    }

    let env = if held == 1 {
        s::bell(&t, (0.08 * duration_s).max(0.005), 0.3 * duration_s)
    } else {
        let soft = 0.04 * duration_s;
        let attack = (soft - 0.037 * duration_s * p.attack_sharpness).max(0.001);
        s::expdecay(&t, attack, 0.45 * duration_s)
    };
    // A struck syllable is cut where the next one starts: the last 3 ms fade it rather than click.
    let fade = (0.003 * f64::from(SR)) as usize;
    let last = t.len().saturating_sub(1);
    for (i, (v, e)) in sig.iter_mut().zip(&env).enumerate() {
        *v *= e * ((last - i) as f32 / fade as f32).min(1.0);
    }
    s::normalise(&mut sig, -6.0);
    SAMPLES.with_borrow_mut(|out| *out = sig);
    t.len()
}

/// This seed's personality with the performance's knobs over it. Each knob is a position within
/// [0, 1] on its trait's range in `Personality`; NaN keeps the seed's own trait.
fn tuned(seed: u32, pitch: f64, brightness: f64, buzz: f64, vibrato: f64, breath: f64) -> Personality {
    let mut p = Personality::from_seed(seed);
    if !pitch.is_nan() {
        p.pitch_center_hz = 110.0 * (620.0f64 / 110.0).powf(pitch);
    }
    if !brightness.is_nan() {
        p.tilt = 2.8 - 1.4 * brightness;
        p.brightness = 0.05 + 0.5 * brightness;
    }
    if !buzz.is_nan() {
        p.quackiness = buzz;
    }
    if !vibrato.is_nan() {
        p.vibrato_depth = 0.7 * vibrato;
    }
    if !breath.is_nan() {
        p.breath = 0.30 * breath;
    }
    p
}

/// The quack the robot's RT plays, in the tuned voice: variant `variant` of `chirp`. Returns its length.
#[unsafe(no_mangle)]
pub extern "C" fn chirp(
    seed: u32,
    variant: u32,
    pitch: f64,
    brightness: f64,
    buzz: f64,
    vibrato: f64,
    breath: f64,
) -> usize {
    keep(sounds::voices::chirp(&tuned(seed, pitch, brightness, buzz, vibrato, breath), variant))
}

/// The wheee the robot's LT rides, in the tuned voice: segment 0 is its start, anything else its
/// loop, which plays over and over while the trigger is held. No end: a timeline releases its
/// trigger, which cuts the ride as the robot does. Returns its length.
#[unsafe(no_mangle)]
pub extern "C" fn wheee(
    seed: u32,
    variant: u32,
    segment: u32,
    pitch: f64,
    brightness: f64,
    buzz: f64,
    vibrato: f64,
    breath: f64,
) -> usize {
    let p = tuned(seed, pitch, brightness, buzz, vibrato, breath);
    let (start, ride, _) = sounds::voices::wheee_segments(&p, variant);
    keep(if segment == 0 { start } else { ride })
}

/// Room for `count` notes of six numbers each, which the page fills before calling [`song`]: start
/// and length in seconds, MIDI number, level, beak opening, formant shift (arena/timeline.py
/// sound_of resolves the dynamic and the vowel into the last three).
#[unsafe(no_mangle)]
pub extern "C" fn notes(count: usize) -> *mut f64 {
    NOTES.with_borrow_mut(|n| {
        n.resize(count * 6, 0.0);
        n.as_mut_ptr()
    })
}

/// The whole song, `seconds` long from the performance's t = 0, in the tuned voice: the robot's
/// `Stream`, untamed (a solo has no chord to sour), driven by the chorale's loop. A note sounds for
/// its first [`SUSTAIN`] and lets go; between notes the voice is silent at the last pitch, mouth and
/// vowel, as the robot's live chorale leaves it. No
/// speaker rolloff: a page plays on full-range speakers. Returns the length, at least one sample.
#[unsafe(no_mangle)]
pub extern "C" fn song(
    seed: u32,
    pitch: f64,
    brightness: f64,
    buzz: f64,
    vibrato: f64,
    breath: f64,
    seconds: f64,
) -> usize {
    let notes: Vec<[f64; 6]> = NOTES.with_borrow(|n| {
        n.chunks_exact(6)
            .map(|c| [c[0], c[1], c[2], c[3], c[4], c[5]])
            .collect()
    });
    let mut voice = Stream::new(&tuned(seed, pitch, brightness, buzz, vibrato, breath), "song", 0);
    let total = ((seconds * f64::from(SR)).round() as usize).max(1);
    let mut out = vec![0.0f32; total];
    // Aimed at the first note, silently, so it does not glide in from the duck's centre pitch.
    if let Some(first) = notes.first() {
        voice.set_formant_shift(first[5]);
        voice.set(midi_hz(first[2]), 0.0, first[4]);
    }
    for start in (0..total).step_by(BLOCK) {
        let now = start as f64 / f64::from(SR);
        match notes
            .iter()
            .find(|note| now >= note[0] && now < note[0] + note[1])
        {
            Some(&[begin, length, midi, level, open, formant]) => {
                let sounding = now - begin < SUSTAIN * length;
                voice.set_formant_shift(formant);
                voice.set(midi_hz(midi), if sounding { level } else { 0.0 }, open);
            }
            // Before the first note, between two, after the last: only the level drops, so the
            // next note starts from the timbre this one left.
            None => voice.set_level(0.0),
        }
        let end = (start + BLOCK).min(total);
        voice.block(&mut out[start..end]);
    }
    keep(out)
}

fn keep(sig: Vec<f32>) -> usize {
    let length = sig.len();
    SAMPLES.with_borrow_mut(|out| *out = sig);
    length
}
