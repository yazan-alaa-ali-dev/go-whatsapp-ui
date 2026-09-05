---
ticket: wf-pilot-001
stage: research
mode: standard
status: complete
owner: ai_agent
updated: 2026-06-14
links:
  clickup:
  github:
---

# Research — wf-pilot-001

> Read-only phase. No implementation is allowed in this command.

## Goal

Provide a quick, dependency-free check that all observability JSON config files
are valid JSON.

## Relevant directories

- `scripts/` — does not exist yet; proposed home for repo tooling.
- `observability/grafana/dashboards/` — contains dashboard JSON exports.
- `observability/prometheus/targets/` — contains scrape-target JSON.

## Relevant config files

The JSON files in scope (validation targets), confirmed present:
- `observability/grafana/dashboards/application-metrics.json`
- `observability/grafana/dashboards/infrastructure-overview.json`
- `observability/grafana/dashboards/service-operations.json`
- `observability/prometheus/targets/chat-app.json`

These are **read-only inputs** to the tool; they are not modified.

## Possibly affected services

- None. The tool is a developer/CI convenience; it does not run inside, deploy,
  or alter Prometheus/Grafana/Loki/Alertmanager.

## Test / validation commands available

- `python --version` → `Python 3.11.0` (interpreter present).
- The tool itself will be runnable as `python scripts/<tool>.py` and report a
  pass/fail exit code — usable directly as the `/verify` check.

## Risks and unknowns

- Python invocation name may be `python` vs `python3` depending on environment
  (here `python` → 3.11.0). Tool should rely only on the standard library.
- Grafana dashboard JSON files are large but still standard JSON — `json` stdlib
  parses them fine.

## Open questions

- Should the tool validate **all** `*.json` under `observability/`, or only
  targets? → Recommend all (dashboards are valid JSON exports and worth checking).
- Should non-zero exit also print the offending filename? → Recommend yes.

## Notes

- No code was changed during research.
- No observability runtime configs were modified.
