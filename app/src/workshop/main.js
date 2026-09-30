// The workshop's page: a home, a page per challenge, a page per training, addressed by hash so the
// browser's back button works. Each page mounts itself and says how to leave it (its polls, its
// viewer) and how to redraw the account when that changes.

import { createAccount } from "./account.js";
import * as api from "./api.js";
import { el } from "./dom.js";
import { mountHome } from "./home.js";
import { parseRoute } from "./routes.js";

const MOUNTS = { home: mountHome };

const root = document.querySelector("#app");
let page = null;
let shown = 0; // the latest show(): an older one that finishes late does not mount over it

const account = createAccount(() => page?.accountChanged());

async function show() {
  const mine = ++shown;
  page?.leave();
  page = null;
  try {
    const status = await api.getStatus();
    const route = parseRoute(location.hash);
    if (mine !== shown) return;
    const next = await (MOUNTS[route.view] ?? mountHome)(root, { status, account, route });
    if (mine !== shown) {
      next.leave();
      return;
    }
    page = next;
    window.scrollTo(0, 0);
  } catch (error) {
    root.replaceChildren(el("p", "failed", `The workshop's server did not answer: ${error.message}`));
  }
}

window.addEventListener("hashchange", show);
account.check(); // not awaited: the Hub may be slow, and no page waits for it
show();
