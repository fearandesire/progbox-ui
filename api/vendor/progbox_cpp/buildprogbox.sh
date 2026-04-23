#!/usr/bin/env bash
# Build the C++ progbox binary into vendor/progbox_cpp/build/progbox.
# Run from api/ or any directory — uses the script's own location.
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
mkdir -p build
cd build
cmake .. -DCMAKE_BUILD_TYPE=Release
cmake --build . --config Release
