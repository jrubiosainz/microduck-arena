# Train your first policy

A policy is the model that controls the robot. Train it in
[Microduck RL](https://github.com/pollen-robotics/microduck_rl), then bring its ONNX file to the Arena.

## Train

You need `uv` and a CUDA GPU. Without a GPU, use the project’s
[cloud training instructions](https://github.com/pollen-robotics/microduck_rl/blob/develop/scripts/hf/README.md).

```bash
git clone https://github.com/pollen-robotics/microduck_rl
cd microduck_rl
uv run list-envs
```

Open **Training & rules** on your chosen challenge for the task to use and what to practice.
Replace `TASK_ID` below with that task:

```bash
uv run train TASK_ID --env.scene.num-envs 4096
```

Reduce `4096` if your GPU runs out of memory.

## Export

Use the same task and the path to your saved checkpoint:

```bash
uv run scripts/export.py TASK_ID \
  --checkpoint-file /path/to/model.pt \
  --onnx-file output.onnx
```

Use this exporter so the model includes its learned observation normalization.
The Arena expects 61 observations, 14 actions and a file no larger than 64 MiB.

## Test and publish

1. Open a challenge, sign in and choose `output.onnx`.
2. Select **Test it** and watch the replay. Nothing is published.
3. Select **Publish** when ready. This shares the model on Hugging Face and records your result.

Change one training setting at a time, export again, and compare results.
