// The reserve's browser opens this page and nothing else. It turns a dialogue
// into the timed plan the live page will play — the same `prepare` the page
// itself imports, so what the reserve stores is exactly what plays.

import { prepare } from "../live/score.js";

window.plan = prepare;
