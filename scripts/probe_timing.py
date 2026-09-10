"""Measure what an official run costs.

The spec bets that a run is sub-second, which is what makes five seeds per entry
affordable and lets a submission return a verified time synchronously. If that
bet is wrong, the platform plan changes shape: submissions become a queue the
frontend polls. So this runs before any of that is built.
"""

import json
import statistics
import sys
import time

from arena.assets import ASSET_ROOT
from arena.course import compile_course
from arena.manifest import load_event
from arena.policy import load_policy
from arena.runner import run_once


def main() -> int:
    manifest = load_event("sprint-2m")

    t0 = time.perf_counter()
    model = compile_course(manifest)
    compile_s = time.perf_counter() - t0

    t0 = time.perf_counter()
    policy = load_policy(ASSET_ROOT / "policies" / "BEST_alpha_walking.onnx")
    load_s = time.perf_counter() - t0

    per_seed = []
    for seed in manifest.seeds:
        t0 = time.perf_counter()
        outcome = run_once(manifest, policy, seed, model=model)
        elapsed = time.perf_counter() - t0
        per_seed.append({
            "seed": seed,
            "wall_s": round(elapsed, 4),
            "status": outcome.status,
            "sim_time_s": outcome.time_s,
            "steps": int(outcome.trace.shape[0]),
        })
        print(f"seed {seed}: {elapsed:.3f}s wall, {outcome.status}, sim {outcome.time_s}")

    walls = [r["wall_s"] for r in per_seed]
    summary = {
        "compile_course_s": round(compile_s, 4),
        "load_policy_s": round(load_s, 4),
        "per_seed": per_seed,
        "mean_run_wall_s": round(statistics.mean(walls), 4),
        "total_entry_wall_s": round(compile_s + load_s + sum(walls), 4),
    }
    print(json.dumps(summary, indent=2))

    verdict = "SYNCHRONOUS OK" if summary["total_entry_wall_s"] < 10.0 else "NEEDS A QUEUE"
    print(f"\nverdict: {verdict} (a full 5-seed entry takes "
          f"{summary['total_entry_wall_s']:.2f}s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
