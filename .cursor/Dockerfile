FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        git \
        curl \
        ca-certificates \
        cmake \
        g++ \
        make \
        build-essential \
        python3 \
        python3-venv \
        python3-pip \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable
