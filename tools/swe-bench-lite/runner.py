#!/usr/bin/env python3
"""runner.py — Orchestrate the SWE-Bench Lite eval (brain ON vs OFF).

For each problem in problems/*.json:
  1. Clone the repo to a fresh workdir at the specified base_commit
  2. Run the setup commands
  3. Run the failing test — record that it FAILS (sanity check)
  4. Invoke the coding agent TWICE on the same problem:
       a. with SHADOW_BRAIN_ENABLED=0
       b. with SHADOW_BRAIN_ENABLED=1
     Each invocation gets a fresh checkout.
  5. After each run, re-run the failing test. Record pass/fail/no-patch.
  6. Write everything as JSONL to <output>/runs.jsonl.

Supported agents (auto-detected on PATH, override with --agent):
  - claude      Anthropic Claude Code CLI
  - aider       Aider
  - cline-cli   Cline
  - mock        built-in mock that applies the expected_fix_hint as a no-op
                (used to smoke-test the harness without consuming LLM tokens)

Stdlib only. No pip installs required.

Usage:
  python runner.py --output ./runs/trial-1
  python runner.py --output ./runs/trial-1 --agent mock
  python runner.py --output ./runs/trial-1 --problem 01-express-path-off-by-one
  python runner.py --output ./runs/trial-1 --dry-run
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

PROBLEMS_DIR = Path(__file__).parent / "problems"

# ---------------------------------------------------------------------------
# AGENT DETECTION
# ---------------------------------------------------------------------------

KNOWN_AGENTS = ["claude", "aider", "cline-cli", "mock"]


def detect_agent() -> str:
    for cmd in ["claude", "aider", "cline-cli"]:
        if shutil.which(cmd):
            return cmd
    return "mock"


def agent_command(agent: str, prompt: str, workdir: Path) -> list[str]:
    """Return the subprocess argv that invokes the agent on the workdir.

    Note: real agents need API keys configured externally; we do not pass any.
    Each agent's CLI is documented; flags here reflect their public READMEs.
    """
    if agent == "claude":
        # claude-code CLI: pass the prompt; agent decides what to read/edit
        return ["claude", "--print", "--working-dir", str(workdir), prompt]
    if agent == "aider":
        # Aider works in --message mode with no interaction
        return ["aider", "--yes", "--no-git", "--message", prompt]
    if agent == "cline-cli":
        return ["cline-cli", "--cwd", str(workdir), "--prompt", prompt]
    if agent == "mock":
        # mock is handled in-process — see run_mock_agent
        return []
    raise ValueError(f"unknown agent: {agent}")


# ---------------------------------------------------------------------------
# PROBLEM LOADING
# ---------------------------------------------------------------------------

def load_problems(problem_filter: str | None = None) -> list[dict[str, Any]]:
    problems: list[dict[str, Any]] = []
    for p in sorted(PROBLEMS_DIR.glob("*.json")):
        if problem_filter and not p.name.startswith(problem_filter):
            continue
        try:
            problems.append(json.loads(p.read_text(encoding="utf-8")))
        except json.JSONDecodeError as exc:
            print(f"  warn: invalid problem {p.name}: {exc}", file=sys.stderr)
    return problems


# ---------------------------------------------------------------------------
# SHELL HELPERS
# ---------------------------------------------------------------------------

def run_cmd(
    argv: list[str],
    *,
    cwd: Path,
    env: dict[str, str] | None = None,
    timeout: int = 600,
    shell: bool = False,
) -> tuple[int, str, str, float]:
    """Run a command; return (exit_code, stdout, stderr, elapsed_seconds)."""
    full_env = os.environ.copy()
    if env:
        full_env.update(env)
    started = time.time()
    try:
        proc = subprocess.run(
            argv if not shell else " ".join(argv),
            cwd=str(cwd),
            env=full_env,
            timeout=timeout,
            capture_output=True,
            text=True,
            shell=shell,
        )
        return proc.returncode, proc.stdout, proc.stderr, time.time() - started
    except subprocess.TimeoutExpired:
        return 124, "", f"TIMEOUT after {timeout}s", time.time() - started
    except FileNotFoundError as exc:
        return 127, "", f"command not found: {exc}", time.time() - started


def run_shell(cmd: str, *, cwd: Path, env: dict[str, str] | None = None, timeout: int = 600) -> tuple[int, str, str, float]:
    """Run a string command through the shell (needed for setup commands)."""
    full_env = os.environ.copy()
    if env:
        full_env.update(env)
    started = time.time()
    try:
        proc = subprocess.run(
            cmd, cwd=str(cwd), env=full_env, timeout=timeout,
            capture_output=True, text=True, shell=True,
        )
        return proc.returncode, proc.stdout, proc.stderr, time.time() - started
    except subprocess.TimeoutExpired:
        return 124, "", f"TIMEOUT after {timeout}s", time.time() - started


# ---------------------------------------------------------------------------
# WORKDIR / CLONE
# ---------------------------------------------------------------------------

def prepare_workdir(problem: dict[str, Any], parent: Path, *, skip_clone: bool = False) -> tuple[Path, str]:
    """Clone (or copy) repo into a fresh workdir for one trial. Returns (path, error)."""
    repo_url = problem["repo_url"]
    base_commit = problem.get("base_commit", "main")
    name = problem["id"]
    workdir = parent / name
    if workdir.exists():
        shutil.rmtree(workdir, ignore_errors=True)
    workdir.parent.mkdir(parents=True, exist_ok=True)

    if skip_clone:
        # Mock mode: just create an empty workdir with a marker
        workdir.mkdir(parents=True, exist_ok=True)
        (workdir / "MOCK_CLONE.txt").write_text(f"would clone {repo_url} @ {base_commit}\n")
        return workdir, ""

    rc, _, err, _ = run_cmd(["git", "clone", "--depth", "50", repo_url, str(workdir)], cwd=parent, timeout=300)
    if rc != 0:
        return workdir, f"git clone failed: {err.strip()[:200]}"
    # Try to checkout the requested commit/branch; non-fatal if it fails
    rc2, _, err2, _ = run_cmd(["git", "checkout", base_commit], cwd=workdir, timeout=60)
    if rc2 != 0:
        # base_commit may be a branch name not in shallow clone — fetch it
        run_cmd(["git", "fetch", "--depth", "50", "origin", base_commit], cwd=workdir, timeout=120)
        rc3, _, _, _ = run_cmd(["git", "checkout", base_commit], cwd=workdir, timeout=60)
        if rc3 != 0:
            print(f"  warn: could not checkout {base_commit}, staying on default branch")
    return workdir, ""


def run_setup(problem: dict[str, Any], workdir: Path, *, timeout: int = 600) -> tuple[bool, str]:
    for cmd in problem.get("setup", []):
        rc, _, err, _ = run_shell(cmd, cwd=workdir, timeout=timeout)
        if rc != 0:
            return False, f"setup failed: {cmd}: {err.strip()[:200]}"
    return True, ""


def run_failing_test(problem: dict[str, Any], workdir: Path, *, timeout: int = 300) -> tuple[int, str]:
    """Run the failing test, return (exit_code, combined_output)."""
    rc, out, err, _ = run_shell(problem["failing_test"], cwd=workdir, timeout=timeout)
    return rc, (out + "\n" + err).strip()


# ---------------------------------------------------------------------------
# MOCK AGENT
# ---------------------------------------------------------------------------

def run_mock_agent(problem: dict[str, Any], workdir: Path, brain_on: bool) -> dict[str, Any]:
    """Mock agent: pretend to fix the bug. With brain_on=True we 'succeed' 70% of the time
    on trivial problems; brain_on=False we 'succeed' 40%. Determined by hash for repeatability.
    This is ONLY for harness smoke-testing — it does not actually patch the repo.
    """
    import hashlib
    seed = int(hashlib.sha256((problem["id"] + str(brain_on)).encode()).hexdigest(), 16) % 100
    base_success_rate = {"trivial": 50, "small": 35, "medium": 20}.get(problem.get("complexity", "small"), 30)
    if brain_on:
        base_success_rate += 25  # brain bonus
    success = seed < base_success_rate
    # Write a marker file to indicate the mock "ran"
    marker = workdir / ".mock-agent-ran"
    marker.write_text(f"problem={problem['id']}\nbrain_on={brain_on}\nsuccess={success}\nseed={seed}\n")
    return {
        "stdout": f"[mock agent] applied hint: {problem['expected_fix_hint'][:80]}",
        "stderr": "",
        "exit_code": 0,
        "elapsed_s": 1.0 + (seed % 30) / 10,
        "tokens": 1500 + seed * 20 if not brain_on else 900 + seed * 10,
        "patch_applied": True,
        "mock_success": success,
    }


# ---------------------------------------------------------------------------
# RUN ONE TRIAL
# ---------------------------------------------------------------------------

def run_trial(
    problem: dict[str, Any],
    *,
    runs_dir: Path,
    agent: str,
    brain_on: bool,
    skip_clone: bool = False,
) -> dict[str, Any]:
    label = "ON" if brain_on else "OFF"
    print(f"  [{problem['id']}] brain {label}")

    workdir, clone_err = prepare_workdir(problem, runs_dir / ("brain-on" if brain_on else "brain-off"), skip_clone=skip_clone)
    if clone_err:
        return {
            "problem_id": problem["id"], "brain_on": brain_on,
            "outcome": "setup-error", "error": clone_err,
            "elapsed_s": 0.0, "tokens": None,
        }

    if not skip_clone:
        ok, err = run_setup(problem, workdir)
        if not ok:
            return {
                "problem_id": problem["id"], "brain_on": brain_on,
                "outcome": "setup-error", "error": err,
                "elapsed_s": 0.0, "tokens": None,
            }
        # Sanity-check the test actually fails before we start
        rc0, out0 = run_failing_test(problem, workdir)
        if rc0 == 0:
            return {
                "problem_id": problem["id"], "brain_on": brain_on,
                "outcome": "test-already-passing", "error": "failing_test passed before any patch",
                "elapsed_s": 0.0, "tokens": None,
            }

    # Invoke the agent
    env = {"SHADOW_BRAIN_ENABLED": "1" if brain_on else "0"}
    if agent == "mock":
        agent_result = run_mock_agent(problem, workdir, brain_on)
    else:
        argv = agent_command(agent, problem["agent_prompt"], workdir)
        rc, stdout, stderr, elapsed = run_cmd(argv, cwd=workdir, env=env, timeout=problem.get("wall_clock_budget_s", 600))
        agent_result = {
            "stdout": stdout[-2000:], "stderr": stderr[-2000:],
            "exit_code": rc, "elapsed_s": elapsed,
            "tokens": _parse_token_count(stdout + "\n" + stderr),
            "patch_applied": rc == 0,
        }

    # Re-run the failing test
    if skip_clone or agent == "mock":
        # In mock mode the test isn't real; use the mock_success flag
        test_passed = bool(agent_result.get("mock_success", False))
        test_output = "[mock] simulated test pass" if test_passed else "[mock] simulated test fail"
    else:
        rc1, test_output = run_failing_test(problem, workdir)
        test_passed = rc1 == 0

    outcome = "resolved" if test_passed else ("no-patch" if not agent_result.get("patch_applied", True) else "failed")

    return {
        "problem_id": problem["id"],
        "brain_on": brain_on,
        "agent": agent,
        "outcome": outcome,
        "elapsed_s": agent_result.get("elapsed_s", 0.0),
        "tokens": agent_result.get("tokens"),
        "agent_exit_code": agent_result.get("exit_code"),
        "test_output_tail": test_output[-600:] if isinstance(test_output, str) else "",
        "agent_stdout_tail": agent_result.get("stdout", "")[-400:] if isinstance(agent_result.get("stdout"), str) else "",
        "agent_stderr_tail": agent_result.get("stderr", "")[-400:] if isinstance(agent_result.get("stderr"), str) else "",
    }


def _parse_token_count(text: str) -> int | None:
    """Try to extract a token usage count from agent stdout/stderr. Returns None if not found."""
    import re
    for pat in [
        r"total\s*tokens?[:=\s]+(\d+)",
        r"(\d+)\s+tokens?\s+used",
        r"input[:\s]+(\d+).*?output[:\s]+(\d+)",
    ]:
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            groups = [int(g) for g in m.groups() if g.isdigit()]
            return sum(groups) if groups else None
    return None


# ---------------------------------------------------------------------------
# MAIN
# ---------------------------------------------------------------------------

def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Run SWE-Bench Lite brain ON vs OFF eval.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    p.add_argument("--output", "-o", type=Path, required=True,
                   help="Output directory (runs.jsonl + workdirs)")
    p.add_argument("--agent", choices=KNOWN_AGENTS, default=None,
                   help="Coding agent to invoke (auto-detected if not specified)")
    p.add_argument("--problem", type=str, default=None,
                   help="Run only one problem (matches by id prefix)")
    p.add_argument("--dry-run", action="store_true",
                   help="Print the plan; do not clone or run agents")
    p.add_argument("--skip-clone", action="store_true",
                   help="Skip git clone + setup (smoke-test only; pairs with --agent mock)")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    agent = args.agent or detect_agent()
    print(f"  agent:          {agent}")
    print(f"  output dir:     {args.output}")
    print(f"  problems dir:   {PROBLEMS_DIR}")

    problems = load_problems(args.problem)
    if not problems:
        print("  ERROR: no problems matched", file=sys.stderr)
        return 2
    print(f"  problems:       {len(problems)}")

    if args.dry_run:
        print("\n  === DRY RUN ===")
        print("  Would run each problem TWICE (brain OFF, then ON)")
        for p in problems:
            print(f"    - {p['id']} ({p.get('language', '?')}, {p.get('complexity', '?')})")
        print(f"\n  Total trials: {len(problems) * 2}")
        budgets = [p.get("wall_clock_budget_s", 300) for p in problems]
        print(f"  Wall-clock budget (worst case): {sum(budgets) * 2 / 60:.0f} min")
        if agent == "mock":
            print("  Note: mock agent — no LLM calls, no real patches")
        return 0

    args.output.mkdir(parents=True, exist_ok=True)
    runs_path = args.output / "runs.jsonl"
    rows: list[dict[str, Any]] = []
    skip_clone = args.skip_clone or agent == "mock"

    with runs_path.open("w", encoding="utf-8") as out_f:
        for problem in problems:
            for brain_on in (False, True):
                row = run_trial(problem, runs_dir=args.output / "workdirs",
                                agent=agent, brain_on=brain_on, skip_clone=skip_clone)
                rows.append(row)
                out_f.write(json.dumps(row) + "\n")
                out_f.flush()
                print(f"    -> {row['outcome']} ({row['elapsed_s']:.1f}s)")

    # Cleanup workdirs to save disk
    work = args.output / "workdirs"
    if work.exists() and not skip_clone:
        print(f"  cleaning up {work}")
        shutil.rmtree(work, ignore_errors=True)

    print(f"\n  wrote {runs_path} ({len(rows)} trials)")
    print(f"  next step: python tools/swe-bench-lite/score.py --input {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
