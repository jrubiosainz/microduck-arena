# Two stages, because the Space serves a built frontend and building it needs
# node, which the runtime does not.
#
# Hugging Face Spaces run this as UID 1000 with only /home/user and /tmp
# writable, and expect the app on port 7860.

# ── build the frontend ───────────────────────────────────────────────────
FROM node:20-slim AS frontend
WORKDIR /build/app
# package files first, so `npm ci` is only re-run when dependencies change and
# not on every source edit.
COPY app/package.json app/package-lock.json ./
RUN npm ci
COPY app/ ./
COPY docs/guides/ /build/docs/guides/
RUN npm run build

# ── the app ──────────────────────────────────────────────────────────────
FROM python:3.12-slim

# The clip recorder (arena/recorder.py) photographs the arena's own stage in
# a headless Chromium and encodes it with ffmpeg. That is the one reason this
# image carries a browser and Mesa: MuJoCo still runs headless with no GL of
# its own. fonts-liberation is the fallback face for glyphs Anton and DM Sans
# lack. The version check fails the build on a broken apt layer, before a
# Space boots and renders nothing.
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium ffmpeg fonts-liberation \
 && rm -rf /var/lib/apt/lists/* \
 && chromium --version && ffmpeg -version
ENV CHROME=/usr/bin/chromium

RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH \
    PYTHONUNBUFFERED=1
WORKDIR /home/user/app

# Dependencies before source, again for the layer cache. mujoco and onnxruntime
# are the slow ones and they change least.
COPY --chown=user pyproject.toml README.md ./
COPY --chown=user arena/ ./arena/
RUN pip install --no-cache-dir --user .

# The physics tripwire, at BUILD time. An image whose MuJoCo does not reproduce
# the recorded baseline cannot be built, so a Space can never come up serving a
# leaderboard that is silently incomparable with every other one. This is not
# hypothetical: an unpinned `mujoco>=3.2` resolved 3.13 here once, where the
# reference walker scores 44.9 s against the 18.2 s it was measured at.
RUN python -m arena.golden

# The built site goes INSIDE the package, where the release wheel carries it
# too (scripts/bundle_frontend.py does on a host what this COPY does here:
# app/dist -> arena/frontend). The package is then installed again without
# its dependencies, so the slow layer above stays cached. No ARENA_FRONTEND:
# the config finds arena/frontend next to the code.
COPY --chown=user --from=frontend /build/app/dist ./arena/frontend
RUN pip install --no-cache-dir --no-deps --user .

ENV ARENA_STORE=/home/user/arena-board \
    ARENA_RANK_BY=policy \
    ARENA_DEV_USER=guest

EXPOSE 7860
# 0.0.0.0, not the CLI's 127.0.0.1 default: nothing outside the container can
# reach a loopback bind.
CMD ["arena", "serve", "--host", "0.0.0.0", "--port", "7860"]
