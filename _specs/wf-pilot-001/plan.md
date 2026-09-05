---
ticket: wf-pilot-001
stage: plan
mode: standard
status: complete
owner: developer
updated: 2026-06-14
links:
  clickup:
  github:
---

# Plan — wf-pilot-001

> Decide the approach before changing code. Plan only — no implementation here.

## Approach

Add one new standard-library Python script, `scripts/validate_observability_json.py`,
that walks `observability/` for `*.json` files, attempts to `json.load` each, and
exits 0 if all parse or non-zero (printing the offending file + error) otherwise.
Pure stdlib (`json`, `pathlib`, `sys`), read-only over the configs. Chosen over a
shell/`jq` approach to avoid a `jq` dependency and stay cross-platform.

## Steps

1. Create `scripts/` and add `validate_observability_json.py`.
2. Implement: discover `observability/**/*.json`, parse each, collect failures,
   print a one-line result per file, exit `0` (all valid / none found) or `1`.
3. Run it against the repo (expect exit 0 over the 4 current JSON files).

## Files to change

- `scripts/validate_observability_json.py` — **new** file (the entire change).
  No other file is modified.

## Validation strategy

- AC-1: inspect imports — standard library only; run with `python`.
- AC-2: `python scripts/validate_observability_json.py` → exit 0 over the repo's
  4 observability JSON files.
- AC-3: run against a temporary invalid JSON file (in a temp dir, outside the
  repo) → exit non-zero, offending file named.
- AC-4: confirm `git status` shows no modification to any `observability/**` or
  other file beyond the new script.

## Rollback

- Delete `scripts/validate_observability_json.py` (single new file) or revert the
  implementation commit on `ticket/wf-pilot-001`.

## Out of scope

- CI / pre-commit wiring; YAML validation; any change to dashboards/targets or
  runtime configuration.
