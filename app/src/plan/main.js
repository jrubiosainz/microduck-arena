// The reserve's browser opens this page and nothing else. It turns a dialogue
// into the timed plan the live page will play — the same `prepare` the page
// itself imports, so what the reserve stores is exactly what plays. `planCall`
// times a match's play-by-play the same way (the cup worker asks for the calls).

import { prepare, prepareCall } from "../live/score.js";

window.plan = prepare;
window.planCall = prepareCall;
