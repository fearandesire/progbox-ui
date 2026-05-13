#!/usr/bin/env bash
# Build the C++ progbox binary into vendor/progbox_cpp/build/.
# Run from api/ or any directory; paths are resolved from this script.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

mkdir -p build
cd build

cmake .. -DCMAKE_BUILD_TYPE=Release
cmake --build . --config Release
