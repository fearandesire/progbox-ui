#!/usr/bin/env bash

# Exit on error, treat unset variables as an error, and catch pipeline failures
set -euo pipefail

# ==========================================
# CONFIGURATION
# ==========================================
DATA_EXPORT="data/export.json"
DATA_TEAM="data/teaminfo.json"
OUTPUT_DIR="outputs"

VERSION="v321"
RUNS=1000
YEAR=2013
SEED=69

# Get the directory where this script actually lives
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ==========================================
# LOGGING UTILITIES
# ==========================================
# Setup ANSI color codes if stdout is a TTY
if [[ -t 1 ]]; then
    readonly NC='\033[0m'
    readonly GREEN='\033[0;32m'
    readonly YELLOW='\033[0;33m'
    readonly RED='\033[0;31m'
    readonly BLUE='\033[0;34m'
else
    readonly NC='' GREEN='' YELLOW='' RED='' BLUE=''
fi

log_info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $*"; }

# Custom error handler
error_trap() {
    local line_num=$1
    log_error "Script failed at line ${line_num} while executing last command."
}
trap 'error_trap $LINENO' ERR

# ==========================================
# VALIDATION
# ==========================================
log_info "Validating environment and input files..."

if [[ ! -f "$DATA_EXPORT" ]]; then
    log_error "Required input file missing: $DATA_EXPORT"
    exit 1
fi

if [[ ! -f "$DATA_TEAM" ]]; then
    log_error "Required input file missing: $DATA_TEAM"
    exit 1
fi

if ! command -v cmake &> /dev/null; then
    log_error "cmake is required but it's not installed."
    exit 1
fi

# ==========================================
# BUILD STEP (Out-of-source & Safe)
# ==========================================
log_info "Configuring CMake build directory..."
cmake -B build -S . > /dev/null

# Determine available CPU cores
CORES="$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 1)"
log_info "Building 'progbox' binary using ${CORES} CPU core(s)..."

cmake --build build --parallel "$CORES" > /dev/null
log_success "Build completed successfully."

log_info "Deploying binary to project root..."
cp build/progbox .

# ==========================================
# EXECUTION STEP
# ==========================================
log_info "Preparing output directory: ${OUTPUT_DIR}"
mkdir -p "$OUTPUT_DIR"

# Dynamically construct arguments array based on variables, wont die if missing
# This bypasses 'set -u' complaints using bash parameter expansion: ${VAR:-}
ARGS=()
[[ -n "${VERSION:-}" ]] && ARGS+=("-v" "$VERSION")
[[ -n "${RUNS:-}"    ]] && ARGS+=("-r" "$RUNS")
[[ -n "${YEAR:-}"    ]] && ARGS+=("-y" "$YEAR")
[[ -n "${SEED:-}"    ]] && ARGS+=("-s" "$SEED")

log_info "Running progbox with ${#ARGS[@]} optional flags..."
log_info "Command: ./progbox \"$DATA_EXPORT\" \"$DATA_TEAM\" \"$OUTPUT_DIR\" ${ARGS[*]:-}"
echo "----------------------------------------------------------------------"

./progbox "$DATA_EXPORT" "$DATA_TEAM" "$OUTPUT_DIR" "${ARGS[@]}"

echo "----------------------------------------------------------------------"
log_success "Execution finished successfully! Outputs saved to: ${OUTPUT_DIR}/"