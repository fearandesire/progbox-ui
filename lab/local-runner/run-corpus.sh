#!/usr/bin/env bash
# Plays real BBGM seasons on THIS machine and writes the data StatGen is fitted on.
# BBGM's license allows running it only for yourself: never run this on a server
# other people can reach. Only the JSONL data it writes leaves the zengm clone.
#
#   bash lab/local-runner/run-corpus.sh            # 3 leagues x 20 seasons, then refit StatGen
#   SEASONS=5 RUNS="random:1" bash lab/local-runner/run-corpus.sh   # quick smoke test
set -euo pipefail

ZENGM_REV="${ZENGM_REV:-f3dac650b3250ed324eca5210feeb3ca5b441de5}"
ZENGM_DIR="${ZENGM_DIR:-$HOME/.cache/net-lab/zengm}"
OUT="${OUT:-$(pwd)/outputs/lab/corpus}"
SEASONS="${SEASONS:-20}"
RUNS="${RUNS:-random:101 real:303 random:202}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$major" -lt 24 ]; then
  echo "zengm needs Node 24+ (found $(node -v)). Install it (e.g. 'fnm install 24 && fnm use 24') and re-run." >&2
  exit 1
fi

if [ ! -d "$ZENGM_DIR/.git" ]; then
  echo "Cloning zengm into $ZENGM_DIR"
  git clone --filter=blob:none https://github.com/zengm-games/zengm.git "$ZENGM_DIR"
fi
git -C "$ZENGM_DIR" fetch --quiet origin "$ZENGM_REV" || true
git -C "$ZENGM_DIR" checkout --quiet "$ZENGM_REV"
if [ ! -d "$ZENGM_DIR/node_modules" ]; then
  echo "Installing zengm dependencies"
  (cd "$ZENGM_DIR" && corepack pnpm@11 install --frozen-lockfile)
fi
cp "$HERE/corpus.zengm.ts" "$ZENGM_DIR/corpus.test.ts"

mkdir -p "$OUT/logs"
dirs=()
for run in $RUNS; do
  kind="${run%%:*}"
  seed="${run##*:}"
  dir="$OUT/$kind-$seed"
  dirs+=("$dir")
  rm -rf "$dir"
  echo "Starting $kind league, seed $seed, $SEASONS seasons -> $dir"
  (cd "$ZENGM_DIR" && SEED="$seed" LEAGUE_KIND="$kind" SEASONS="$SEASONS" OUT="$dir" npx vitest --run --project basketball corpus.test.ts >"$OUT/logs/$kind-$seed.out" 2>&1) &
done
wait
echo "Corpus written to $OUT"

# Fit on all but the last run; the last one is held out for the calibration gate.
train="$(IFS=,; echo "${dirs[*]:0:${#dirs[@]}-1}")"
holdout="${dirs[-1]}"
if [ "${#dirs[@]}" -lt 2 ]; then train="${dirs[0]}"; holdout=""; fi
ZENGM_REV="$ZENGM_REV" pnpm lab statgen fit --corpus "$train" ${holdout:+--holdout "$holdout"}
