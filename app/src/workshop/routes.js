// The workshop's pages, addressed by hash so the browser's back button works: the home, a challenge,
// and one training of that challenge.

const SEGMENT = "([A-Za-z0-9._-]+)";
const CHALLENGE = new RegExp(`^/c/${SEGMENT}/?$`);
const JOB = new RegExp(`^/c/${SEGMENT}/j/${SEGMENT}/?$`);

export function parseRoute(hash) {
  const path = String(hash || "").replace(/^#/, "");
  const job = path.match(JOB);
  if (job) return { view: "job", event: job[1], job: job[2] };
  const challenge = path.match(CHALLENGE);
  if (challenge) return { view: "challenge", event: challenge[1] };
  return { view: "home" };
}

export const homeHref = "#/";
export const challengeHref = (event) => `#/c/${event}`;
export const jobHref = (event, id) => `#/c/${event}/j/${id}`;
