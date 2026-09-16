import { describe, expect, it } from "vitest";
import { intentUrl, postText, shareStrip, wireShare } from "./share.js";

/** X's count: every link is 23 characters, whatever its length. Test-only —
 * nothing in share.js needs its own count of what X will display. */
const xLength = (text) => text.replace(/(https?:\/\/)?[\w.-]+\.\w+\/\S*/g, "x".repeat(23)).length;

const run = {
  run_id: "01M2X", user: "alice", policy_name: "walker v2", score: 2.314,
  seeds_finished: 5, seeds_total: 5, per_seed: [], on_board: true, withdrawn: false, rank: 3,
  receipts: [{ act: "run", points: 10 }, { act: "own_best", points: 25 }],
  policy_url: "https://huggingface.co/alice/microduck-walker-v2",
  event: { id: "sprint-2m", title: "2 m Sprint" },
};
const origin = "https://arena.hf.space";

describe("postText", () => {
  it("says the result, links the run, names the weights, and mentions only on X", () => {
    expect(postText(run, { origin, network: "x" })).toBe(
      "I coded a robot duck to walk. On 2 m Sprint it finished 5/5 seeds in 2.314 s, #3 on the board (+35 pts).\n" +
      "Beat it: https://arena.hf.space/r/01M2X\n" +
      "Weights: huggingface.co/alice/microduck-walker-v2\n" +
      "#MicroduckArena @pollenrobotics @huggingface",
    );
    expect(postText(run, { origin, network: "linkedin" }).split("\n").at(-1)).toBe("#MicroduckArena");
  });

  it("leaves out the place off the board, the points at zero, and the weights without a repo", () => {
    const plain = { ...run, on_board: false, receipts: [], policy_url: null };
    const text = postText(plain, { origin, network: "x" });
    expect(text).toContain("finished 5/5 seeds in 2.314 s.\n");
    expect(text).not.toContain("Weights");
  });

  it("tells a DNF how it ended", () => {
    const fell = { ...run, seeds_finished: 0, per_seed: [{ seed: 1, status: "fall", time_s: null }] };
    expect(postText(fell, { origin, network: "x" })).toContain("finished 0/5 seeds on its feet — it ate the floor.");
    const late = { ...fell, per_seed: [{ seed: 1, status: "timeout", time_s: null }] };
    expect(postText(late, { origin, network: "x" })).toContain("it ran out of time.");
  });

  it("fits X with a long policy name, links counted as 23", () => {
    const long = { ...run, policy_name: "x".repeat(60), policy_url: `https://huggingface.co/alice/microduck-${"x".repeat(60)}` };
    expect(xLength(postText(long, { origin, network: "x" }))).toBeLessThanOrEqual(280);
  });
});

describe("intentUrl", () => {
  it("opens the two composers that take a text", () => {
    expect(intentUrl("x", "a b")).toBe("https://x.com/intent/post?text=a%20b");
    expect(intentUrl("linkedin", "a b")).toBe("https://www.linkedin.com/feed/?shareActive=true&text=a%20b");
  });
});

describe("shareStrip", () => {
  it("is two links, two buttons and two clip stickers that follow the clip's state", () => {
    const strip = shareStrip(run, { origin });
    const items = [...strip.nav.children];
    expect(items.map((el) => el.tagName)).toEqual(["A", "A", "BUTTON", "BUTTON", "A", "A", "P"]);
    expect(items[0].href).toMatch(/^https:\/\/x\.com\/intent\/post\?text=/);
    expect(items[2].dataset.upload).toBe("instagram");

    strip.setClip({ state: "pending" });
    const clips = strip.nav.querySelectorAll("[data-clip]");
    expect(clips[0].textContent).toBe("Clip · rendering…");
    expect(clips[0].getAttribute("aria-disabled")).toBe("true");
    expect(clips[0].hasAttribute("href")).toBe(false);

    strip.setClip({ state: "ready", layouts: { landscape: { url: "/l.mp4" }, vertical: { url: "/v.mp4" } } });
    expect(clips[1].getAttribute("href")).toBe("/v.mp4?download=1");
    expect(clips[1].hasAttribute("download")).toBe(true);
    expect(clips[1].textContent).toBe("Clip · vertical");

    strip.setClip({ state: "failed" });
    expect(clips[0].hidden && clips[1].hidden).toBe(true);
  });
});

describe("wireShare", () => {
  it("on a laptop, Instagram copies the post and takes the vertical clip", async () => {
    const strip = shareStrip(run, { origin });
    strip.setClip({ state: "ready", layouts: { landscape: { url: "/l.mp4" }, vertical: { url: "/v.mp4" } } });
    const copied = [];
    const opened = [];
    wireShare(strip, run, {
      origin, handheld: false, share: undefined,
      clipboard: { writeText: async (text) => copied.push(text) }, open: (url) => opened.push(url),
    });
    strip.nav.querySelector('[data-upload="instagram"]').click();
    await new Promise((r) => setTimeout(r, 0));
    expect(copied[0]).toBe(postText(run, { origin, network: "instagram" }));
    expect(opened).toEqual(["/v.mp4?download=1"]);
    expect(strip.said.textContent).toMatch(/^Text copied\. Use the clip download/);
  });

  it("on a phone, hands the text to the share sheet", async () => {
    const strip = shareStrip(run, { origin });
    const shared = [];
    wireShare(strip, run, { origin, handheld: true, share: async (data) => shared.push(data) });
    strip.nav.querySelector('[data-upload="tiktok"]').click();
    await new Promise((r) => setTimeout(r, 0));
    expect(shared).toEqual([{ text: postText(run, { origin, network: "tiktok" }) }]);
  });
});
