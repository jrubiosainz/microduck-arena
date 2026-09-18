// The hall under the booth: the clip's stadium engine with a neutral
// direction, at half the clip's crowd, scheduled in real time the way the
// engine's own comment prescribes.

import { stadiumDirection } from "../clip/direction.js";
import { StadiumAmbience, prepareStadium } from "../clip/stadium.js";

const VOLUME = 25;
const HORIZON_S = 0.45;
const EVERY_MS = 40;

export async function createAmbience(context) {
  await prepareStadium(OfflineAudioContext);
  const gain = context.createGain();
  gain.connect(context.destination);
  let engine = null;
  let timer = null;

  function stop() {
    clearInterval(timer);
    timer = null;
    engine?.dispose();
    engine = null;
  }

  return {
    start() {
      stop();
      engine = new StadiumAmbience(context, {
        direction: stadiumDirection(), volume: VOLUME, destination: gain,
      });
      timer = setInterval(() => engine.scheduleUntil(context.currentTime + HORIZON_S), EVERY_MS);
    },
    stop,
    muted(flag) {
      gain.gain.value = flag ? 0 : 1;
    },
  };
}
