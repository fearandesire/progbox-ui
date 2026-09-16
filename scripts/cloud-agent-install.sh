#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

if ! python3 -m venv --help >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y python3-venv python3-pip
fi

corepack enable
corepack prepare pnpm@10.8.0 --activate

pnpm install --frozen-lockfile
pnpm run build:engine

python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r api/vendor/progbox_cpp/tools/requirements.txt

npx playwright install chromium

pnpm run doctor
