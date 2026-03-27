# Phase 2 — optional DX

## Internal `adopt-monorepo` overlay

If you want one-command adoption for future mixed Vue + Python repos, model an overlay on [`odysseustech/platform-templates`](https://github.com/odysseustech/platform-templates) (`overlays/adopt-node` + `adopt-python` patterns): Copier-based, additive files only.

## Vite+ (`vp create`)

[Vite+](https://viteplus.dev/guide/create) (`vp create`) can scaffold monorepos and forward flags to `create-vite` / other generators. Consider it after the app structure is stable, so template choices stay intentional.

## Centralized CI

Point `.github/workflows/ci.yml` at `odysseustech/ci-platform` reusable workflows once the repo layout matches what `node-ci.yml` expects (single package vs monorepo paths).

## Skip `.prototools`

If you do not use the `proto` toolchain, delete `.prototools` and rely on `engines` in `package.json` + CI `node-version` only.
