# Train your first policy

A policy is the model that controls the robot. You train it in simulation, publish it
to your Hugging Face account, then enter it here. You do not need a physical robot.

## The workshop

Open a challenge and select **Train my robot**. You need `git`, `uv` and a Hugging Face
account; the panel gives one line to paste in a terminal. It clones
[microduck-challenges](https://github.com/pollen-robotics/microduck-challenges) and opens
the workshop in your browser:

1. **Preflight** checks your tools and your Hugging Face login.
2. **Train** starts from the challenge's own recipe. Change a knob if you like, then launch.
   With an NVIDIA GPU it trains on your machine; without one it runs on Hugging Face Jobs,
   billed to your account, and brings the checkpoints back as they are saved.
3. **Test** exports a checkpoint and races it with this Arena's own rules, on your machine.
   The time is indicative: only the Arena times an entry.
4. **Publish** puts the policy, its manifest and its recipe in your Hugging Face account,
   then opens this page with everything filled in. Select **Publish** here to enter it.

## From a shell

Everything the workshop does is a command you can run yourself in a clone of
microduck-challenges (the challenge's `task` is in its `challenge.toml`):

```bash
uv run train Mjlab-Sprint2m-MicroDuck --env.scene.num-envs 4096 --agent.max-iterations 3000 \
    --agent.seed 1 --agent.logger tensorboard --agent.run-name first
# no NVIDIA GPU: add --hf-jobs --no-wandb, then bring the run back with
# uv run hf download <the checkpoint repo it printed> --local-dir logs/rsl_rl
uv run publish --run logs/rsl_rl/sprint_2m/<the run> --repo <you>/microduck-first --no-private
```

Then enter `<you>/microduck-first` on the challenge's page. The Arena expects 61
observations, 14 actions and a file no larger than 64 MiB; `publish` checks all three.
