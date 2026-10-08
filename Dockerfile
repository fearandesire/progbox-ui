# progbox-ui with NET Lab, as one container: API on 127.0.0.1:8000, the built web app on $PORT.
# Contains no BBGM code; deep mode uses lab/models/statgen.json. Put it behind an auth proxy
# (Cloudflare Access or similar): the app has no login of its own.
FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends g++ cmake make python3 git ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build && pnpm build:engine

FROM node:22-bookworm-slim
RUN corepack enable
WORKDIR /app
COPY --from=build /app /app
# Recorded in every run's Lab version metadata (.git is not in the image):
#   docker build --build-arg LAB_COMMIT=$(git rev-parse --short HEAD) .
ARG LAB_COMMIT=""
ENV LAB_COMMIT=$LAB_COMMIT \
    NODE_ENV=production \
    PORT=8080 \
    LAB_DATA_DIR=/data/lab \
    PROGBOX_OUTPUTS_DIR=/data/outputs
VOLUME /data
EXPOSE 8080
CMD ["bash", "deploy/start.sh"]
