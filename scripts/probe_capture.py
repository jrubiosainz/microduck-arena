"""Measure what a clip frame costs, three ways, on the real clip page.

    uv run --frozen python scripts/probe_capture.py --origin http://127.0.0.1:8001 \
        --run <run_id> --layout landscape --frames 40

Prints milliseconds per frame for: the page's own draw (JavaScript only), a
PNG screenshot, a JPEG q92 screenshot, an in-page JPEG readback (raster +
encode, no protocol), a VideoFrame readback and a VP9 WebCodecs encode. The
spec's rule: if rasterisation dominates, JPEG screenshots; if the capture
does, WebCodecs.

This script stays in the tree, not as leftover scaffolding: cpu-basic prices
frames differently from a developer laptop, so re-run it there, against the
Space's own origin, whenever the choice of screenshot format is worth
re-checking.
"""

import argparse
import statistics
import time

from arena.recorder import Chrome, find_chrome

SIZES = {"landscape": (1920, 1080), "vertical": (1080, 1920)}

WEBCODECS = """
(async () => {
  const canvas = document.getElementById("stage");
  const support = await VideoEncoder.isConfigSupported({ codec: "vp09.00.10.08", width: canvas.width, height: canvas.height, bitrate: 12_000_000, framerate: 25 });
  if (!support.supported) return { supported: false };
  let chunks = 0;
  const encoder = new VideoEncoder({ output: () => chunks++, error: (e) => { throw e; } });
  encoder.configure(support.config);
  const t0 = performance.now();
  for (let i = 0; i < %(frames)d; i++) {
    window.clip.draw(%(first)d + i);
    const frame = new VideoFrame(canvas, { timestamp: i * 40000 });
    encoder.encode(frame, { keyFrame: i === 0 });
    frame.close();
  }
  await encoder.flush();
  return { supported: true, ms: (performance.now() - t0) / %(frames)d, chunks };
})()
"""


def timed(fn, n):
    samples = []
    for _ in range(n):
        start = time.perf_counter()
        fn()
        samples.append((time.perf_counter() - start) * 1000)
    return statistics.median(samples)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--origin", required=True)
    parser.add_argument("--run", required=True)
    parser.add_argument("--layout", default="landscape", choices=SIZES)
    parser.add_argument("--frames", type=int, default=40)
    args = parser.parse_args()
    width, height = SIZES[args.layout]
    with Chrome(find_chrome()) as chrome:
        tab = chrome.tab(width, height)
        tab.navigate(f"{args.origin}/clip.html?run={args.run}&layout={args.layout}&frame=0")
        tab.wait_ready()
        plan = tab.evaluate("window.clip.plan")
        first = plan["intro"] + 5
        i = [first]

        def draw():
            tab.evaluate(f"window.clip.draw({i[0]})")
            i[0] += 1

        print(f"{args.layout} {width}x{height}, {plan['frames']} frames planned")
        print(f"draw only            {timed(draw, args.frames):7.1f} ms")
        print(f"draw + png shot      {timed(lambda: (draw(), tab.send('Page.captureScreenshot', {'format': 'png', 'optimizeForSpeed': True})), args.frames):7.1f} ms")
        print(f"draw + jpeg shot     {timed(lambda: (draw(), tab.send('Page.captureScreenshot', {'format': 'jpeg', 'quality': 92})), args.frames):7.1f} ms")
        print(f"draw + jpeg in page  {timed(lambda: (draw(), tab.evaluate('document.getElementById(\"stage\").toDataURL(\"image/jpeg\", 0.92).length')), args.frames):7.1f} ms")
        print(f"draw + VideoFrame    {timed(lambda: (draw(), tab.evaluate('(() => { const f = new VideoFrame(document.getElementById(\"stage\"), { timestamp: 0 }); f.close(); return 1 })()')), args.frames):7.1f} ms")
        vp9 = tab.evaluate(WEBCODECS % {"frames": args.frames, "first": i[0]}, await_promise=True)
        print(f"draw + vp9 encode    {vp9['ms']:7.1f} ms ({vp9['chunks']} chunks)" if vp9["supported"] else "vp9 encode           unsupported")


if __name__ == "__main__":
    main()
