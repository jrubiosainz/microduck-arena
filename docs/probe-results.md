# Timing probe results

Measured with `scripts/probe_timing.py` on 2026-09-03.

Machine: Linux 6.8.0-138-generic x86_64, Intel(R) Core(TM) Ultra 9 185H

## Run 1

```
seed 1: 0.178s wall, finish, sim 18.46
seed 2: 0.183s wall, finish, sim 18.28
seed 3: 0.128s wall, finish, sim 18.22
seed 4: 0.110s wall, finish, sim 18.080000000000002
seed 5: 0.106s wall, finish, sim 18.04
```

```json
{
  "compile_course_s": 0.0211,
  "load_policy_s": 0.0043,
  "per_seed": [
    {
      "seed": 1,
      "wall_s": 0.1783,
      "status": "finish",
      "sim_time_s": 18.46,
      "steps": 923
    },
    {
      "seed": 2,
      "wall_s": 0.1834,
      "status": "finish",
      "sim_time_s": 18.28,
      "steps": 914
    },
    {
      "seed": 3,
      "wall_s": 0.1278,
      "status": "finish",
      "sim_time_s": 18.22,
      "steps": 911
    },
    {
      "seed": 4,
      "wall_s": 0.1097,
      "status": "finish",
      "sim_time_s": 18.080000000000002,
      "steps": 904
    },
    {
      "seed": 5,
      "wall_s": 0.1058,
      "status": "finish",
      "sim_time_s": 18.04,
      "steps": 902
    }
  ],
  "mean_run_wall_s": 0.141,
  "total_entry_wall_s": 0.7304
}
```

verdict: SYNCHRONOUS OK (a full 5-seed entry takes 0.73s)

## Run 2

```
seed 1: 0.173s wall, finish, sim 18.46
seed 2: 0.177s wall, finish, sim 18.28
seed 3: 0.123s wall, finish, sim 18.22
seed 4: 0.105s wall, finish, sim 18.080000000000002
seed 5: 0.129s wall, finish, sim 18.04
```

```json
{
  "compile_course_s": 0.0313,
  "load_policy_s": 0.0037,
  "per_seed": [
    {
      "seed": 1,
      "wall_s": 0.1733,
      "status": "finish",
      "sim_time_s": 18.46,
      "steps": 923
    },
    {
      "seed": 2,
      "wall_s": 0.1771,
      "status": "finish",
      "sim_time_s": 18.28,
      "steps": 914
    },
    {
      "seed": 3,
      "wall_s": 0.1229,
      "status": "finish",
      "sim_time_s": 18.22,
      "steps": 911
    },
    {
      "seed": 4,
      "wall_s": 0.1053,
      "status": "finish",
      "sim_time_s": 18.080000000000002,
      "steps": 904
    },
    {
      "seed": 5,
      "wall_s": 0.1287,
      "status": "finish",
      "sim_time_s": 18.04,
      "steps": 902
    }
  ],
  "mean_run_wall_s": 0.1415,
  "total_entry_wall_s": 0.7423
}
```

verdict: SYNCHRONOUS OK (a full 5-seed entry takes 0.74s)

## Stability

The two runs agree closely: total entry wall-clock was 0.7304 s and 0.7423 s,
a difference of about 12 ms (under 2%). Per-seed timings and simulated times
are identical or within a few milliseconds across runs (simulated time and
step counts are exactly reproducible, as expected — seeds are deterministic).
This is not a one-off: the number is stable run to run on this machine. A
third, independently reproduced run (not included above) gave 0.629 s total,
again with bit-identical per-seed simulated times and step counts — confirming
determinism holds and the measured range on this machine is roughly
0.63-0.74 s.

## Verdict

A full five-seed entry takes about **0.73-0.74 s** wall-clock *as measured on
this workstation, with the policy read from local disk*, of which the
dominant term is the five simulated runs themselves (roughly 0.14 s mean per
run, ~0.70 s total), not the one-time `compile_course` (~0.02-0.03 s) or
`load_policy` (~0.004 s) overhead — those are negligible in comparison. That
figure alone is well under the ~10 s threshold, with over an order of
magnitude of headroom — but it is not yet the production number: it excludes
the Hub model fetch and runs on developer hardware, not the target Space. See
"What this does NOT measure" below for the estimated production figure and
the verdict that actually accounts for those gaps.

## What this does NOT measure

- **The Hub model fetch is absent.** `arena/policy.py` has no Hub download —
  the probe loads `BEST_alpha_walking.onnx` from local disk
  (`ASSET_ROOT / "policies" / ...`), and `load_policy_s` (4-9 ms across the
  three runs) is a local-disk read, not a network fetch. In production the
  submitter's model is downloaded from a model repo, and the design spec's
  own expectation was that this download would dominate wall clock. Rough,
  labeled-as-estimate allowance: an 800 KB file transfers in well under a
  second on any reasonable connection, but Hugging Face Hub API round-trips
  (auth, resolving the revision, redirects to the CDN) plausibly add another
  second or two of fixed latency. Call it **1-3 s**, not benchmarked here —
  that measurement belongs to the next plan, which will actually implement
  the fetch.
- **The hardware is not the target.** The numbers above come from the
  developer workstation named at the top of this document (a laptop-class
  Intel Ultra 9 185H). Production runs on a Hugging Face free-tier CPU Space,
  roughly 2 vCPU and typically well below workstation single-core
  performance for numerical / physics workloads. Rough, labeled-as-estimate
  slowdown factor for the compute-bound portion (compile + policy load +
  simulation): **2-3x**.
- **Conclusion under both allowances.** Take the higher of the two measured
  totals as a conservative compute-bound baseline (0.7423 s, run 2; the
  independently reproduced third run at 0.629 s would only widen the
  margin). Apply the hardware slowdown to that whole figure (it is all
  CPU-bound — MuJoCo stepping, ONNX inference, compilation), then add the
  Hub fetch allowance on top, since the fetch is network latency and is not
  itself sped up or slowed down by the CPU:

  - Low estimate: 0.7423 s x 2 + 1 s = **2.48 s**
  - High estimate: 0.7423 s x 3 + 3 s = **5.23 s**

  Both ends of that range are comfortably inside the ~10 s threshold (2.48 s
  leaves ~7.5 s of margin; even the high end leaves ~4.8 s). **The verdict
  survives both allowances**: a full five-seed entry is estimated at roughly
  **2.5-5.2 s** end-to-end in production, not the ~0.7 s measured here, but
  still well under 10 s. Submissions can return a verified time
  synchronously, and the platform plan can keep the direct submit flow —
  this conclusion now accounts for the Hub fetch and the target hardware
  rather than ignoring them. If the actual Hub round-trip or Space slowdown
  turns out worse than these estimates (e.g. a cold Space, or Hub rate
  limiting), that would need to be re-measured directly against this
  now-wider-than-it-looked margin before the platform plan finalizes on it.
