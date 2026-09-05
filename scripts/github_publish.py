#!/usr/bin/env python3
"""GitHub delivery helper for /publish-pr — the single git delivery boundary.

Stages an explicit set of paths on the ticket branch, creates ONE publishable
commit when there is anything to commit, pushes the branch, opens a Pull Request
via the GitHub CLI (or returns the already-open one), and prints
{"pr_url": "..."} as JSON on stdout.

This file is the ONLY home for `git` (staging/commit/push) and `gh` logic; the
/publish-pr command embeds none (ADR-005 pattern, ADR-007, PB-7).

Contract (validation-model.md > PB-3..PB-9):
  PB-3/PB-4  One-way, workflow -> GitHub. This helper never reads GitHub
             status/review/check/merge state back, never edits ticket.md, and
             performs no workflow-state transition. The caller writes only
             links.github.
  PB-6       Fails SAFELY when `gh` is missing (GH-1) or unauthenticated (GH-2):
             no commit, no push, no PR.
  PB-8       The single publishable commit is created HERE, before the push.
             No other command commits.
  PB-9/GU-3  Staging is confined to the --path values the caller supplies (the
             implemented source per plan.md plus _specs/<slug>/). Nothing else is
             staged, so unrelated working-tree files cannot ride along. There is
             deliberately no `git add -A`.

Idempotent: re-running with no staged changes skips the commit, and an existing
open PR for the branch is returned rather than duplicated.

Usage:
    python scripts/github_publish.py --branch ticket/<slug> \
        --title "<title>" --body-file <file> --base main \
        --commit-message "<message>" --path <path> [--path <path> ...]

Exit codes:
    0  success (JSON on stdout)
    1  GH-1 — `gh` not found on PATH
    2  GH-2 — `gh` not authenticated
    3  GH-3 — a git or gh operation failed
    4  GH-4 — usage/precondition error (branch missing or not checked out, etc.)
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
TIMEOUT_SECONDS = 120


def _fail(code: int, rule: str, message: str) -> None:
    print(f"{rule} ERROR: {message}", file=sys.stderr)
    raise SystemExit(code)


def _run(args: list[str], *, check: bool = True) -> subprocess.CompletedProcess:
    """Run a command in the repository root and capture its output."""
    result = subprocess.run(
        args,
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=TIMEOUT_SECONDS,
    )
    if check and result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()
        _fail(3, "GH-3", f"`{' '.join(args)}` failed ({result.returncode}) — {detail}")
    return result


def _precheck_gh() -> None:
    """PB-6: verify `gh` before anything is staged, committed, or pushed."""
    if shutil.which("gh") is None:
        _fail(1, "GH-1", "GitHub CLI (`gh`) is not installed or not on PATH")

    status = subprocess.run(
        ["gh", "auth", "status"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=TIMEOUT_SECONDS,
    )
    if status.returncode != 0:
        detail = (status.stderr or status.stdout or "").strip()
        _fail(2, "GH-2", f"`gh` is not authenticated — {detail}")


def _precheck_branch(branch: str) -> None:
    """The ticket branch must exist and be the checked-out branch (PB-2)."""
    exists = subprocess.run(
        ["git", "rev-parse", "--verify", "--quiet", f"refs/heads/{branch}"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        timeout=TIMEOUT_SECONDS,
    )
    if exists.returncode != 0:
        _fail(4, "GH-4", f"branch {branch} does not exist locally")

    current = _run(["git", "rev-parse", "--abbrev-ref", "HEAD"]).stdout.strip()
    if current != branch:
        _fail(4, "GH-4", f"branch {branch} is not checked out (currently on {current})")


def stage_and_commit(paths: list[str], commit_message: str) -> str | None:
    """Stage only the given paths and create the single publishable commit (PB-8/PB-9).

    Returns the new commit SHA, or None when there was nothing to commit.
    """
    missing = [p for p in paths if not (REPO_ROOT / p).exists()]
    if missing:
        _fail(4, "GH-4", f"path(s) not found: {', '.join(missing)}")

    _run(["git", "add", "--"] + paths)

    staged = subprocess.run(
        ["git", "diff", "--cached", "--quiet"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        timeout=TIMEOUT_SECONDS,
    )
    if staged.returncode == 0:
        return None  # nothing staged — idempotent re-run

    _run(["git", "commit", "-m", commit_message])
    return _run(["git", "rev-parse", "HEAD"]).stdout.strip()


def push(branch: str) -> None:
    _run(["git", "push", "--set-upstream", "origin", branch])


def open_pr(branch: str, base: str, title: str, body_file: str) -> tuple[str, bool]:
    """Open the PR, or return the already-open one. Returns (url, created)."""
    existing = _run(
        ["gh", "pr", "list", "--head", branch, "--state", "open", "--json", "url"],
        check=False,
    )
    if existing.returncode == 0 and existing.stdout.strip():
        try:
            rows = json.loads(existing.stdout)
        except json.JSONDecodeError:
            rows = []
        if rows:
            return rows[0].get("url", ""), False

    created = _run(
        [
            "gh", "pr", "create",
            "--base", base,
            "--head", branch,
            "--title", title,
            "--body-file", body_file,
        ]
    )
    url = ""
    for line in created.stdout.splitlines():
        line = line.strip()
        if line.startswith("http"):
            url = line
    if not url:
        _fail(3, "GH-3", f"`gh pr create` returned no PR URL — {created.stdout.strip()}")
    return url, True


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Commit, push and open a PR for a ticket branch (/publish-pr)."
    )
    parser.add_argument("--branch", required=True, help="ticket/<slug> branch to publish")
    parser.add_argument("--title", required=True, help="PR title")
    parser.add_argument("--body-file", required=True, help="file holding the PR body")
    parser.add_argument("--base", default="main", help="base branch (default: main)")
    parser.add_argument("--commit-message", required=True, help="publishable commit message")
    parser.add_argument(
        "--path",
        dest="paths",
        action="append",
        required=True,
        metavar="PATH",
        help=(
            "Repository-relative path to stage; repeatable. Staging is confined to "
            "these paths (PB-9/GU-3) — there is no add-everything mode."
        ),
    )
    args = parser.parse_args()

    if not (REPO_ROOT / args.body_file).exists() and not Path(args.body_file).exists():
        _fail(4, "GH-4", f"body file not found: {args.body_file}")

    # Order matters: gh is prechecked BEFORE anything is staged or committed, so a
    # missing/unauthenticated gh leaves the working tree untouched (PB-6).
    _precheck_gh()
    _precheck_branch(args.branch)

    commit_sha = stage_and_commit(args.paths, args.commit_message)
    push(args.branch)
    pr_url, created = open_pr(args.branch, args.base, args.title, args.body_file)

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    json.dump(
        {
            "pr_url": pr_url,
            "pr_created": created,
            "commit": commit_sha,
            "branch": args.branch,
            "base": args.base,
        },
        sys.stdout,
        ensure_ascii=False,
        indent=2,
    )
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
