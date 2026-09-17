"""Synthesise the clip's start horn into app/public/sound/foghorn.wav.

A foghorn, computed sample by sample so it is ours to license (CC0-1.0, see
app/public/sound/PROVENANCE.md): two reeds a fifth apart, each a pair of
slightly detuned harmonic stacks so they beat, scooping up a semitone into
the note, its upper harmonics arriving after the fundamental the way a horn
speaks. The harmonics reach past 3 kHz so a phone's speaker, which has no
150 Hz, still hears it. Deterministic: re-running writes the same bytes.
"""

import wave
from pathlib import Path

import numpy as np

RATE = 48000
OUT = Path(__file__).resolve().parent.parent / "app" / "public" / "sound" / "foghorn.wav"

REEDS = (146.83, 220.0)  # D3 and the A above it
DETUNE = 0.0035
ATTACK_S, HOLD_S, RELEASE_S = 0.08, 1.3, 0.4
SCOOP_S = 0.05  # how fast the note climbs its last semitone
VIBRATO_HZ, VIBRATO = 4.5, 0.0015
BRASS_HZ, BRASS_WIDTH_HZ = 700.0, 400.0  # the harmonics that make it a horn
TOP_HZ = 6000.0
DRIVE = 1.6
PEAK = 0.89  # -1 dBFS


def envelope(t: np.ndarray) -> np.ndarray:
    rise = np.clip(t / ATTACK_S, 0, 1)
    fall = np.clip((ATTACK_S + HOLD_S + RELEASE_S - t) / RELEASE_S, 0, 1)
    return np.sin(0.5 * np.pi * rise) * fall**2


def reed(f0: float, t: np.ndarray, level: np.ndarray) -> np.ndarray:
    scoop = 2 ** (-np.exp(-t / SCOOP_S) / 12)
    vibrato = 1 + VIBRATO * np.sin(2 * np.pi * VIBRATO_HZ * t)
    out = np.zeros_like(t)
    for side in (-1, 1):
        f = f0 * (1 + side * DETUNE) * scoop * vibrato
        phase = 2 * np.pi * np.cumsum(f) / RATE
        for k in range(1, int(TOP_HZ // f0) + 1):
            weight = k**-0.8 * (1 + 1.5 * np.exp(-(((k * f0 - BRASS_HZ) / BRASS_WIDTH_HZ) ** 2)))
            out += weight * level ** (1 + 0.15 * k) * np.sin(k * phase)
    return out


def main() -> None:
    t = np.arange(int((ATTACK_S + HOLD_S + RELEASE_S) * RATE)) / RATE
    level = envelope(t)
    horn = sum(reed(f0, t, level) for f0 in REEDS)
    horn = np.tanh(DRIVE * horn / np.abs(horn).max())
    horn *= PEAK / np.abs(horn).max()
    with wave.open(str(OUT), "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(RATE)
        out.writeframes(np.round(horn * 32767).astype("<i2").tobytes())
    print(f"{OUT} {len(t) / RATE:.2f} s")


if __name__ == "__main__":
    main()
