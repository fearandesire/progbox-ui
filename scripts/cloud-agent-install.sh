#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

ensure_python_venv() {
  if python3 -m venv /tmp/progbox-venv-test 2>/dev/null; then
    rm -rf /tmp/progbox-venv-test
    return 0
  fi
  sudo apt-get update
  sudo apt-get install -y python3.12-venv python3-pip
  rm -rf /tmp/progbox-venv-test
}

ensure_cpp_toolchain() {
  if c++ -x c++ - -o /tmp/progbox-cxx-test 2>/dev/null <<< 'int main(){}'; then
    rm -f /tmp/progbox-cxx-test
    return 0
  fi
  sudo apt-get update
  sudo apt-get install -y g++ libstdc++-12-dev build-essential
  rm -f /tmp/progbox-cxx-test
}

ensure_python_venv
ensure_cpp_toolchain

corepack enable
corepack prepare pnpm@10.8.0 --activate

pnpm install --frozen-lockfile

export CC=gcc
export CXX=g++
pnpm run build:engine

python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r api/vendor/progbox_cpp/tools/requirements.txt

npx playwright install chromium

pnpm run doctor
