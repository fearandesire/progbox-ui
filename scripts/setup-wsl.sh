#!/usr/bin/env bash
set -Eeuo pipefail

PNPM_VERSION="${PNPM_VERSION:-10.8.0}"
NODE_MIN_MAJOR="${NODE_MIN_MAJOR:-22}"
INSTALL_SYSTEM_PACKAGES="${INSTALL_SYSTEM_PACKAGES:-auto}"
INSTALL_NODE="${INSTALL_NODE:-auto}"
RUN_ENGINE="${RUN_ENGINE:-1}"
RUN_DOCTOR="${RUN_DOCTOR:-1}"
PREFLIGHT_ONLY=0
ASSUME_YES=0

usage() {
  cat <<'EOF'
Usage: bash scripts/setup-wsl.sh [options]

Options:
  -y, --yes             Run non-interactively and accept safe installs.
  --no-system-packages  Do not install missing apt packages.
  --no-node-install     Do not install or upgrade Node.js.
  --skip-engine         Skip pnpm run build:engine.
  --skip-doctor         Skip pnpm run doctor.
  --preflight-only      Stop after prerequisite and pnpm checks.
  -h, --help            Show this help.

Environment overrides:
  PNPM_VERSION=10.8.0
  NODE_MIN_MAJOR=22
  INSTALL_SYSTEM_PACKAGES=auto|1|0
  INSTALL_NODE=auto|1|0
EOF
}

while (($#)); do
  case "$1" in
    -y|--yes)
      ASSUME_YES=1
      ;;
    --no-system-packages)
      INSTALL_SYSTEM_PACKAGES=0
      ;;
    --no-node-install)
      INSTALL_NODE=0
      ;;
    --skip-engine)
      RUN_ENGINE=0
      ;;
    --skip-doctor)
      RUN_DOCTOR=0
      ;;
    --preflight-only)
      PREFLIGHT_ONLY=1
      ;;
    --)
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
if ROOT="$(git -C "$SCRIPT_DIR/.." rev-parse --show-toplevel 2>/dev/null)"; then
  ROOT="$(cd "$ROOT" && pwd -P)"
else
  ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
fi

cd "$ROOT"

if [[ ! -f package.json ]] ||
  ! grep -q '"name"[[:space:]]*:[[:space:]]*"progbox-ui"' package.json ||
  [[ ! -f pnpm-workspace.yaml ]] ||
  [[ ! -d web ]] ||
  [[ ! -d api/vendor/progbox_cpp ]]; then
  echo "Refusing to run: could not prove repo root is progbox-ui ($ROOT)." >&2
  exit 1
fi

mkdir -p logs
LOG_FILE="$ROOT/logs/setup-wsl-$(date +%Y%m%d-%H%M%S).log"
touch "$LOG_FILE"

if [[ -t 1 ]]; then
  BOLD=$'\033[1m'
  DIM=$'\033[2m'
  GREEN=$'\033[32m'
  YELLOW=$'\033[33m'
  RED=$'\033[31m'
  BLUE=$'\033[34m'
  RESET=$'\033[0m'
else
  BOLD=""
  DIM=""
  GREEN=""
  YELLOW=""
  RED=""
  BLUE=""
  RESET=""
fi

log() {
  printf '%s\n' "$*" >>"$LOG_FILE"
}

step() {
  printf '\n%s>%s %s\n' "$BLUE" "$RESET" "$*"
  log ""
  log "==> $*"
}

ok() {
  printf '  %sOK%s %s\n' "$GREEN" "$RESET" "$*"
  log "OK: $*"
}

warn() {
  printf '  %sWARN%s %s\n' "$YELLOW" "$RESET" "$*"
  log "WARN: $*"
}

fail() {
  printf '  %sFAIL%s %s\n' "$RED" "$RESET" "$*" >&2
  log "FAIL: $*"
}

is_interactive() {
  [[ "$ASSUME_YES" == "1" ]] || [[ -t 0 && -t 1 ]]
}

confirm() {
  local prompt="$1"
  local default="${2:-y}"

  if [[ "$ASSUME_YES" == "1" ]]; then
    log "Auto-confirmed: $prompt"
    return 0
  fi

  if [[ ! -t 0 || ! -t 1 ]]; then
    log "Non-interactive default no: $prompt"
    return 1
  fi

  local suffix="[y/N]"
  [[ "$default" == "y" ]] && suffix="[Y/n]"

  local answer
  read -r -p "  $prompt $suffix " answer
  answer="${answer:-$default}"
  [[ "$answer" =~ ^[Yy] ]]
}

tail_log() {
  printf '\n%sLast log lines:%s\n' "$BOLD" "$RESET" >&2
  tail -n 30 "$LOG_FILE" >&2 || true
}

run_cmd() {
  local label="$1"
  shift
  step "$label"
  log "+ $*"
  if "$@" >>"$LOG_FILE" 2>&1; then
    ok "$label"
  else
    local code=$?
    fail "$label (exit $code)"
    tail_log
    exit "$code"
  fi
}

run_shell() {
  local label="$1"
  local script="$2"
  step "$label"
  log "+ $script"
  if bash -lc "$script" >>"$LOG_FILE" 2>&1; then
    ok "$label"
  else
    local code=$?
    fail "$label (exit $code)"
    tail_log
    exit "$code"
  fi
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

package_installed() {
  dpkg-query -W -f='${Status}' "$1" 2>/dev/null | grep -q "install ok installed"
}

require_command() {
  local cmd="$1"
  local hint="$2"
  if ! command_exists "$cmd"; then
    fail "$cmd is missing. $hint"
    exit 1
  fi
}

check_frontend_native_deps() {
  (
    cd web
    node -e "import('vite').then(() => process.exit(0), (err) => { console.error(err && err.message ? err.message : err); process.exit(1); })"
  ) >>"$LOG_FILE" 2>&1
}

node_major() {
  if ! command_exists node; then
    echo 0
    return
  fi
  node --version 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/'
}

python_minor_report() {
  python3 - <<'PY' 2>/dev/null || true
import sys
print(f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}")
PY
}

remove_venv() {
  local target="$ROOT/.venv"
  local resolved
  resolved="$(cd "$(dirname "$target")" && pwd -P)/$(basename "$target")"
  if [[ "$resolved" != "$ROOT/.venv" ]]; then
    fail "Refusing to remove unexpected venv path: $resolved"
    exit 1
  fi
  rm -rf "$resolved"
}

printf '\n%sprogbox-ui WSL/Linux setup%s\n' "$BOLD" "$RESET"
printf '%sRepo:%s %s\n' "$DIM" "$RESET" "$ROOT"
printf '%sLog:%s  %s\n\n' "$DIM" "$RESET" "$LOG_FILE"
log "progbox-ui WSL/Linux setup"
log "Repo: $ROOT"
log "Date: $(date -Is)"
log "Shell: ${SHELL:-unknown}"

if [[ "$(uname -s)" != "Linux" ]]; then
  fail "This script must run under WSL or Linux. Use scripts/setup-windows.ps1 on native Windows."
  exit 1
fi

if grep -qi microsoft /proc/version 2>/dev/null; then
  ok "WSL detected"
else
  warn "Plain Linux detected; continuing with the WSL/Linux path."
fi

step "Checking system packages"
if command_exists apt-get && command_exists dpkg-query; then
  missing_packages=()
  for pkg in git curl ca-certificates cmake build-essential python3 python3-venv python3-pip python-is-python3; do
    if ! package_installed "$pkg"; then
      missing_packages+=("$pkg")
    fi
  done

  if ((${#missing_packages[@]})); then
    warn "Missing apt packages: ${missing_packages[*]}"
    install_packages=0
    if [[ "$INSTALL_SYSTEM_PACKAGES" == "1" ]]; then
      install_packages=1
    elif [[ "$INSTALL_SYSTEM_PACKAGES" == "auto" ]] && is_interactive && confirm "Install missing apt packages with sudo?"; then
      install_packages=1
    fi

    if [[ "$install_packages" == "1" ]]; then
      run_cmd "Updating apt package index" sudo apt-get update
      run_cmd "Installing system packages" sudo apt-get install -y "${missing_packages[@]}"
    else
      fail "Install these packages, then rerun: sudo apt-get install -y ${missing_packages[*]}"
      exit 1
    fi
  else
    ok "System packages present"
  fi
else
  warn "apt-get not found; validating commands without installing system packages."
fi

require_command git "Install git."
require_command curl "Install curl."
require_command python3 "Install Python 3."
require_command cmake "Install CMake."
require_command g++ "Install build-essential or another C++17 compiler."

ok "$(git --version | head -1)"
ok "python3 $(python_minor_report)"
ok "$(cmake --version | head -1)"
ok "$(g++ --version | head -1)"

step "Checking Node.js"
current_node_major="$(node_major)"
if ((current_node_major < NODE_MIN_MAJOR)); then
  if command_exists node; then
    warn "Node $(node --version) is below required major ${NODE_MIN_MAJOR}."
  else
    warn "Node.js is missing."
  fi

  install_node=0
  if [[ "$INSTALL_NODE" == "1" ]]; then
    install_node=1
  elif [[ "$INSTALL_NODE" == "auto" ]] && is_interactive && confirm "Install Node.js ${NODE_MIN_MAJOR}.x from NodeSource with sudo?"; then
    install_node=1
  fi

  if [[ "$install_node" == "1" ]]; then
    run_shell "Adding NodeSource ${NODE_MIN_MAJOR}.x apt repository" \
      "curl -fsSL https://deb.nodesource.com/setup_${NODE_MIN_MAJOR}.x | sudo -E bash -"
    run_cmd "Installing Node.js" sudo apt-get install -y nodejs
    hash -r
  else
    fail "Install Node.js ${NODE_MIN_MAJOR}+ and rerun. Recommended: https://github.com/nodesource/distributions"
    exit 1
  fi
fi

require_command node "Install Node.js ${NODE_MIN_MAJOR}+."
ok "node $(node --version)"

step "Checking pnpm"
current_pnpm="$(pnpm --version 2>/dev/null || true)"

if [[ "$current_pnpm" != "$PNPM_VERSION" ]]; then
  if command_exists corepack; then
    run_cmd "Enabling corepack" corepack enable
    if ! command_exists pnpm || [[ "$(pnpm --version 2>/dev/null || true)" != "$PNPM_VERSION" ]]; then
      run_cmd "Activating pnpm ${PNPM_VERSION}" corepack prepare "pnpm@${PNPM_VERSION}" --activate
      hash -r
    fi
  else
    warn "corepack is missing; falling back to npm for pnpm ${PNPM_VERSION}."
  fi

  if ! command_exists pnpm || [[ "$(pnpm --version 2>/dev/null || true)" != "$PNPM_VERSION" ]]; then
    require_command npm "Install npm or reinstall Node.js."
    run_cmd "Installing pnpm ${PNPM_VERSION} globally" npm install -g "pnpm@${PNPM_VERSION}"
    hash -r
  fi
elif ! command_exists corepack; then
  warn "corepack is missing, but pnpm ${PNPM_VERSION} is already available."
fi

require_command pnpm "Install pnpm ${PNPM_VERSION}."
ok "pnpm $(pnpm --version)"

if [[ "$PREFLIGHT_ONLY" == "1" ]]; then
  printf '\n%sPreflight complete%s\n' "$BOLD" "$RESET"
  printf '  Log: %s\n' "$LOG_FILE"
  exit 0
fi

if check_frontend_native_deps; then
  run_cmd "Installing workspace dependencies" pnpm install --frozen-lockfile
else
  warn "Frontend native dependencies are missing for this platform; forcing a pnpm reinstall."
  run_cmd "Repairing workspace dependencies" pnpm install --frozen-lockfile --force
  if check_frontend_native_deps; then
    ok "Frontend native dependencies are usable"
  else
    fail "Frontend native dependency check still fails after pnpm reinstall."
    tail_log
    exit 1
  fi
fi

step "Preparing Python virtual environment"
if [[ -d .venv ]]; then
  if [[ -x .venv/bin/python && -x .venv/bin/pip ]]; then
    ok "Existing Linux/WSL .venv is usable"
  else
    warn ".venv is missing Linux executables; recreating it for WSL/Linux."
    remove_venv
  fi
fi

if [[ ! -d .venv ]]; then
  run_cmd "Creating .venv" python3 -m venv .venv
fi

# shellcheck source=/dev/null
source .venv/bin/activate
run_cmd "Upgrading pip" python -m pip install --upgrade pip
run_cmd "Installing API Python dependencies" python -m pip install -r api/requirements.txt

if [[ "$RUN_ENGINE" == "1" ]]; then
  run_cmd "Building C++ engine" pnpm run build:engine
else
  warn "Skipped C++ engine build"
fi

if [[ "$RUN_DOCTOR" == "1" ]]; then
  run_cmd "Running doctor" pnpm run doctor
else
  warn "Skipped doctor"
fi

printf '\n%sSetup complete%s\n' "$BOLD" "$RESET"
printf '  Activate: source .venv/bin/activate\n'
printf '  Start:    pnpm dev\n'
printf '  Log:      %s\n' "$LOG_FILE"
