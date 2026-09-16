# Environment Builds Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the progbox-ui Cloud Agent personal environment to prebuilt environment builds, with repo-managed configuration that installs dependencies, builds the C++ engine, and starts dev servers on boot.

**Architecture:** Cursor environment builds run a one-time `install` phase into a snapshot; new agent pods boot from that snapshot and run `start`/`terminals` only. Configuration lives in `.cursor/environment.json` (repo-managed, takes precedence over dashboard settings). System packages (CMake, g++, Python venv) are baked into `.cursor/Dockerfile`; repository-specific work runs via `scripts/cloud-agent-install.sh`.

**Tech Stack:** Node 22, pnpm 10.8.0, Vue 3 + Vite, Fastify API, vendored C++ progbox engine (CMake), Python 3.12 analysis deps, Playwright Chromium

## Global Constraints

- Node **22**, pnpm **10.8.0** (from `package.json` `packageManager`)
- C++ engine build required for real sims: `pnpm run build:engine`
- Dev servers: web `:5173`, API `:8000` on `127.0.0.1`
- Stop `pnpm dev` before `pnpm test:e2e` (Playwright binds `127.0.0.1:5173`)
- No external services; file-backed storage under `outputs/`
- Environment ID: `c80a33f3-8607-11f1-a7d1-d6b4613131ce` (Personal, DB-managed before PR merge)
- Do not enable builds in the dashboard programmatically; user enables after review

---

## Migration outcome summary

| Build | ID | Branch | Status | Role |
| --- | --- | --- | --- | --- |
| No-change baseline | [bld-20260915-57955204-86a0-4e35-a543-4b6b90fda0b4](https://cursor.com/dashboard/cloud-agents/builds/bld-20260915-57955204-86a0-4e35-a543-4b6b90fda0b4) | `main` (default) | **SUCCEEDED** | Promotable; proves existing DB config works with builds |
| Improved install script | [bld-20260916-610d0391-a061-4ce4-98cb-fceb3f3e592e](https://cursor.com/dashboard/cloud-agents/builds/bld-20260916-610d0391-a061-4ce4-98cb-fceb3f3e592e) | `agent/env-builds-migration-c6e5` | **SUCCEEDED** | Validates full install: pnpm, build:engine, Python venv, Playwright, doctor |

**Result:** Works out of the box with the existing saved configuration. Works with changes after fixing Linux C++ compiler selection (`build-engine.mjs`) and Python venv bootstrap in `scripts/cloud-agent-install.sh`.

---

### Task 1: Inspect current environment

**Files:**
- Read: (MCP) `cursor-cloud-environment-info`
- Read: `/workspace/AGENTS.md`, `/workspace/package.json`, `/workspace/scripts/setup-wsl.sh`

**Findings:**
- Environment source: **Personal (DB-managed)** — `environmentJsonPath: null`
- Environment dashboard: [c80a33f3-8607-11f1-a7d1-d6b4613131ce](https://cursor.com/dashboard/cloud-agents/environments/e/c80a33f3-8607-11f1-a7d1-d6b4613131ce)
- No `.cursor/environment.json` in repository at migration start
- Existing recurring build already succeeded on default branch with pnpm install + Playwright

- [x] **Step 1:** Call `cursor-cloud-environment-info` and record managed type + environment ID
- [x] **Step 2:** Confirm Node 22 / pnpm 10.8.0 on current VM (`node --version`, `pnpm --version`)
- [x] **Step 3:** Review AGENTS.md Cursor Cloud section for install/start/terminals expectations

---

### Task 2: Baseline build (no configuration changes)

**Files:** None (uses saved DB configuration)

- [x] **Step 1:** Trigger build with no override

```
cursor-cloud-trigger-environment-build {}
```

- [x] **Step 2:** Poll until terminal state

```
cursor-cloud-list-environment-builds
```

Expected: `bld-20260915-57955204-86a0-4e35-a543-4b6b90fda0b4` → `SUCCEEDED`

- [x] **Step 3:** Inspect build logs

```
cursor-cloud-environment-build-logs buildId=bld-20260915-57955204-86a0-4e35-a543-4b6b90fda0b4
```

Expected: pnpm install exit 0, Playwright Chromium downloaded, snapshot ready

---

### Task 3: Add repo-managed environment configuration

**Files:**
- Create: `.cursor/environment.json`
- Create: `.cursor/Dockerfile`
- Create: `scripts/cloud-agent-install.sh`

**Interfaces:**
- Produces: idempotent install script invoked by `environment.json` `"install"` field

- [x] **Step 1:** Create `.cursor/environment.json` (default base image, no custom Dockerfile)

```json
{
  "name": "progbox-ui",
  "install": "bash scripts/cloud-agent-install.sh",
  "ports": [
    { "name": "web", "port": 5173 },
    { "name": "api", "port": 8000 }
  ],
  "terminals": [
    {
      "name": "dev",
      "command": "pnpm dev",
      "description": "Vite web (:5173) + Fastify API (:8000)"
    }
  ]
}
```

- [x] **Step 2:** Fix Linux engine build in `api/scripts/build-engine.mjs` (force `g++`/`gcc` for CMake on Linux)

- [x] **Step 3:** Fix Python venv bootstrap in `scripts/cloud-agent-install.sh` (install `python3.12-venv` when test venv fails)

- [x] **Step 4:** Commit on branch `agent/env-builds-migration-c6e5` and push

---

### Task 4: Validate improved configuration build

**Files:** Same as Task 3

- [x] **Step 1:** Trigger draft build from feature branch

```
cursor-cloud-trigger-environment-build refs=[{repoUrl: "github.com/fearandesire/progbox-ui", ref: "agent/env-builds-migration-c6e5"}]
```

Expected: build ID `bld-20260915-80299fe7-4a7b-4592-967f-fc939069dc3b`

- [x] **Step 2:** Poll until terminal state

Expected: `bld-20260916-610d0391-a061-4ce4-98cb-fceb3f3e592e` → `SUCCEEDED`

- [x] **Step 3:** Inspect build logs — `Built target progbox`, Playwright Chromium, `pnpm run doctor`, snapshot ready

- [ ] **Step 4:** After merge to `main`, trigger promotable build (default refs, no `refs` override)

---

### Task 5: Propose DB-managed configuration (pre-merge fallback)

**Files:** (MCP) `cursor-cloud-propose-environment-json`

Only needed while environment remains DB-managed before PR merge.

- [x] **Step 1:** Propose install script (without buildId — branch builds are not promotable for Save)

```
cursor-cloud-propose-environment-json
  environmentJson.install: bash scripts/cloud-agent-install.sh
```

---

### Task 6: Enable builds (manual user action)

- [ ] **Step 1:** User opens [Enable builds](https://cursor.com/dashboard/cloud-agents/environments/e/c80a33f3-8607-11f1-a7d1-d6b4613131ce) on the environment dashboard
- [ ] **Step 2:** User merges PR `agent/env-builds-migration-c6e5` → `main`
- [ ] **Step 3:** User triggers or waits for a default-branch build so repo `.cursor/environment.json` becomes authoritative

---

### Task 7: Post-migration smoke verification

- [ ] **Step 1:** Start a fresh Cloud Agent from a successful build
- [ ] **Step 2:** Confirm `pnpm run doctor` passes without re-install
- [ ] **Step 3:** Confirm `api/vendor/progbox_cpp/build/progbox` exists (engine built in install phase)
- [ ] **Step 4:** Confirm dev terminal serves `http://127.0.0.1:5173` and `http://127.0.0.1:8000`

Run locally after merge on a build-backed agent:

```bash
pnpm run doctor
test -x api/vendor/progbox_cpp/build/progbox && echo "engine OK"
curl -sf http://127.0.0.1:8000/api/config | head -c 200
```

---

## How environment builds work (progbox-ui)

1. **Dockerfile** (removed): Custom `node:22-bookworm-slim` images failed pod bootstrap; use Cursor default base image instead.
2. **Install** (`scripts/cloud-agent-install.sh`): Runs once during build — apt fixes for C++/Python if needed, pnpm deps, C++ engine, Python venv, Playwright Chromium, doctor.
3. **Terminals** (`pnpm dev`): Started on each new pod — Vite + Fastify dev servers.
4. **Ports**: 5173 (web), 8000 (api) exposed for browser/computer-use testing.

New agents boot from the snapshot; they do **not** re-run `install` unless the build is rebuilt.

---

## Remaining manual actions

1. **[Enable builds](https://cursor.com/dashboard/cloud-agents/environments/e/c80a33f3-8607-11f1-a7d1-d6b4613131ce)** on the environment dashboard (required).
2. **Merge PR** with `.cursor/environment.json` so configuration is repo-managed and versioned.
3. **Re-run a default-branch build** after merge for a promotable baseline with the full install script.
4. **Review proposed install** in the Portal Save flow if not merging the PR immediately.

No secrets, egress allowlist changes, or external setup actions were required.
