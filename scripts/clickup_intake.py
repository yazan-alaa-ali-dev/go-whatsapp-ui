#!/usr/bin/env python3
"""Read-only ClickUp task intake helper for /start-ticket.

Performs a SINGLE read-only GET against the ClickUp API and prints
{"title", "description", "url"} as JSON on stdout.

Credentials are read from the gitignored repository-root `.env`
(CLICKUP_API_TOKEN, optional CLICKUP_API_BASE); a shell environment variable is
used only as a fallback when `.env` does not define the key. `.env` is the
project's credential store and wins, so a stale exported value cannot shadow it.

Contract (validation-model.md > CU-1..CU-5):
  CU-1  CLICKUP_API_TOKEN must be resolvable (.env or environment).
  CU-2  The fetch must succeed (task exists / authorized / reachable).
  CU-3  READ-ONLY — only GET is ever issued. No POST/PUT/DELETE, no status or
        comment change, no task creation or closure.
  CU-5  Seeds title/description/url only; workflow state stays owned by
        _specs/<ticket>/ticket.md.

Usage:
    python scripts/clickup_intake.py <task_id> [--team-id <id>]

Exit codes:
    0  success (JSON on stdout)
    1  CU-1 — CLICKUP_API_TOKEN missing
    2  CU-2 — fetch failed (HTTP error, network error, bad payload)
    3  usage error
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

DEFAULT_API_BASE = "https://api.clickup.com/api/v2"
ENV_FILE = Path(__file__).resolve().parent.parent / ".env"
TIMEOUT_SECONDS = 20


def _fail(code: int, rule: str, message: str) -> None:
    print(f"{rule} ERROR: {message}", file=sys.stderr)
    raise SystemExit(code)


def _config(key: str) -> str:
    """Resolve a setting from the repo-root .env first, then the environment."""
    if ENV_FILE.is_file():
        for raw in ENV_FILE.read_text(encoding="utf-8", errors="replace").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            name, _, value = line.partition("=")
            if name.strip() == key:
                value = value.strip().strip("\"'")
                if value:
                    return value
    return os.environ.get(key, "").strip()


def _get(url: str, token: str) -> dict:
    """Issue the one and only GET (CU-3) and return the decoded payload."""
    request = urllib.request.Request(url, method="GET")
    request.add_header("Authorization", token)
    request.add_header("Accept", "application/json")
    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_task(task_id: str, token: str, team_id: str | None, api_base: str) -> dict:
    """Fetch a task by id, falling back to the custom-task-id form on 404."""
    query = {"include_markdown_description": "true"}
    attempts = [urllib.parse.urlencode(query)]
    if team_id:
        custom = dict(query, custom_task_ids="true", team_id=team_id)
        attempts.append(urllib.parse.urlencode(custom))

    last_error = None
    for params in attempts:
        url = f"{api_base.rstrip('/')}/task/{urllib.parse.quote(task_id)}?{params}"
        try:
            return _get(url, token)
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", "replace").strip()
            last_error = f"HTTP {exc.code} for task {task_id} — {body}"
            if exc.code not in (400, 401, 404):
                break
        except urllib.error.URLError as exc:
            last_error = f"network error reaching ClickUp — {exc.reason}"
            break
        except json.JSONDecodeError:
            last_error = "ClickUp returned a non-JSON payload"
            break

    _fail(2, "CU-2", last_error or "unknown failure")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Read-only ClickUp task fetch for /start-ticket (CU-3)."
    )
    parser.add_argument("task_id", help="ClickUp task id (or custom id with --team-id)")
    parser.add_argument(
        "--team-id",
        default=None,
        help="Workspace/team id, enabling the custom-task-id fallback.",
    )
    args = parser.parse_args()

    token = _config("CLICKUP_API_TOKEN")
    if not token:
        _fail(1, "CU-1", "CLICKUP_API_TOKEN is not set in .env or the environment")

    api_base = _config("CLICKUP_API_BASE") or DEFAULT_API_BASE
    team_id = args.team_id or _config("CLICKUP_TEAM_ID") or None

    task = fetch_task(args.task_id, token, team_id, api_base)

    description = task.get("markdown_description") or task.get("description") or ""
    payload = {
        "title": (task.get("name") or "").strip(),
        "description": description.strip(),
        "url": task.get("url") or "",
    }
    if not payload["title"]:
        _fail(2, "CU-2", f"task {args.task_id} returned no name field")

    # ClickUp titles/descriptions carry non-ASCII (e.g. "·"); the Windows console
    # default codepage would mangle them, so pin stdout to UTF-8.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    json.dump(payload, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
