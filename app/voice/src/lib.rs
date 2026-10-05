//! One syllable of Peter's or Ray's, sung by the microduck's own synthesiser.
//!
//! The voice is the robot's: a [`Personality`] drawn from the commentator's seed gives the
//! harmonics, vibrato, jitter, quack buzz and breath, and the envelopes are the synth's. Only
//! the shape is the booth's: the plan writes each syllable's length and pitch contour, so a line
//! chirps, glides, trills and quacks like a droid instead of repeating one note.
//!
//! No bindings: the page writes a contour into [`contour`], calls [`syllable`] and reads the
//! samples at [`samples`].

use std::cell::RefCell;
use std::f64::consts::TAU;

use sounds::{Personality, SR, synth as s};

thread_local! {
    static CONTOUR: RefCell<Vec<f32>> = const { RefCell::new(Vec::new()) };
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
