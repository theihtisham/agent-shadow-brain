#!/usr/bin/env python3
"""score.py — Aggregate runs.jsonl into a results table + markdown report.

Computes:
  - Resolution rate (brain ON vs OFF)
  - Mean wall-clock time per problem
  - Mean tokens per problem (when reported)
  - Fisher's exact test (one-sided, brain ON > OFF) on the resolution counts

Outputs:
  <output>/report.md       human-readable summary
  <output>/results.json    machine-readable for downstream tools

Required pip install (optional):
  pip install scipy  # for Fisher's exact test

If scipy is not installed, the test is computed manually using log-factorial
on the contingency table. Slower but identical result.

Usage:
  python score.py --input ./runs/trial-1
  python score.py --input ./runs/trial-1 --output ./runs/trial-1
  python score.py --input ./runs/trial-1 --dry-run
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any


# ---------------------------------------------------------------------------
# FISHER'S EXACT TEST (one-sided)
# ---------------------------------------------------------------------------

def log_factorial(n: int) -> float:
    if n < 2:
        return 0.0
    return math.lgamma(n + 1)


def hypergeom_pmf(a: int, b: int, c: int, d: int) -> float:
    """Probability of observing exactly this 2x2 table under the null."""
    n = a + b + c + d
    log_p = (
        log_factorial(a + b) + log_factorial(c + d) +
        log_factorial(a + c) + log_factorial(b + d) -
        log_factorial(n) - log_factorial(a) - log_factorial(b) -
        log_factorial(c) - log_factorial(d)
    )
    return math.exp(log_p)


def fishers_exact_one_sided(table: list[list[int]]) -> float:
    """One-sided Fisher's exact test (alternative: a is larger than expected).

    Table is [[a, b], [c, d]] where:
      a = brain_on resolved
      b = brain_off resolved
      c = brain_on not resolved
      d = brain_off not resolved
    """
    # Try scipy first
    try:
        from scipy import stats  # type: ignore
        _odds, p = stats.fisher_exact(table, alternative="greater")
        return float(p)
    except ImportError:
        pass

    a, b = table[0]
    c, d = table[1]
    # Marginals are fixed; iterate over possible a values from observed to max
    row1 = a + b
    col1 = a + c
    n = a + b + c + d
    p = 0.0
    max_a = min(row1, col1)
    for k in range(a, max_a + 1):
        nb = row1 - k
        nc = col1 - k
        nd = n - k - nb - nc
        if nb < 0 or nc < 0 or nd < 0:
            continue
        p += hypergeom_pmf(k, nb, nc, nd)
    return min(1.0, p)


# ---------------------------------------------------------------------------
# AGGREGATION
# ---------------------------------------------------------------------------

def load_runs(input_dir: Path) -> list[dict[str, Any]]:
    runs_path = input_dir / "runs.jsonl"
    if not runs_path.exists():
        raise SystemExit(f"ERROR: {runs_path} not found")
    return [json.loads(l) for l in runs_path.read_text(encoding="utf-8").splitlines() if l.strip()]


def aggregate(runs: list[dict[str, Any]]) -> dict[str, Any]:
    """Pair up runs by problem_id and produce per-problem rows + overall stats."""
    by_problem: dict[str, dict[str, dict[str, Any]]] = defaultdict(dict)
    for r in runs:
        key = "on" if r["brain_on"] else "off"
        by_problem[r["problem_id"]][key] = r

    rows: list[dict[str, Any]] = []
    res_on = res_off = unres_on = unres_off = 0
    sum_secs_on = sum_secs_off = 0.0
    n_secs_on = n_secs_off = 0
    tokens_on: list[int] = []
    tokens_off: list[int] = []

    for pid, pair in sorted(by_problem.items()):
        on = pair.get("on", {})
        off = pair.get("off", {})
        on_resolved = on.get("outcome") == "resolved"
        off_resolved = off.get("outcome") == "resolved"
        if on_resolved:
            res_on += 1
        else:
            unres_on += 1
        if off_resolved:
            res_off += 1
        else:
            unres_off += 1
        if "elapsed_s" in on:
            sum_secs_on += on["elapsed_s"]; n_secs_on += 1
        if "elapsed_s" in off:
            sum_secs_off += off["elapsed_s"]; n_secs_off += 1
        if isinstance(on.get("tokens"), int):
            tokens_on.append(on["tokens"])
        if isinstance(off.get("tokens"), int):
            tokens_off.append(off["tokens"])
        rows.append({
            "id": pid,
            "brain_off_outcome": off.get("outcome", "missing"),
            "brain_on_outcome":  on.get("outcome", "missing"),
            "brain_off_s": off.get("elapsed_s"),
            "brain_on_s":  on.get("elapsed_s"),
            "brain_off_tokens": off.get("tokens"),
            "brain_on_tokens":  on.get("tokens"),
        })

    table = [[res_on, res_off], [unres_on, unres_off]]
    p_value = fishers_exact_one_sided(table)
    total = len(rows)

    summary = {
        "n_problems": total,
        "resolution_rate_off": res_off / total if total else 0,
        "resolution_rate_on":  res_on  / total if total else 0,
        "absolute_lift": (res_on - res_off) / total if total else 0,
        "mean_wallclock_off_s": sum_secs_off / max(1, n_secs_off),
        "mean_wallclock_on_s":  sum_secs_on  / max(1, n_secs_on),
        "wallclock_delta_pct": (
            ((sum_secs_off / max(1, n_secs_off)) - (sum_secs_on / max(1, n_secs_on))) / max(1e-9, sum_secs_off / max(1, n_secs_off)) * 100
        ) if n_secs_off and n_secs_on else 0.0,
        "mean_tokens_off": (sum(tokens_off) / len(tokens_off)) if tokens_off else None,
        "mean_tokens_on":  (sum(tokens_on)  / len(tokens_on))  if tokens_on else None,
        "fisher_p_value": p_value,
        "contingency_table": {
            "resolved_brain_on": res_on,
            "resolved_brain_off": res_off,
            "unresolved_brain_on": unres_on,
            "unresolved_brain_off": unres_off,
        },
    }
    return {"summary": summary, "rows": rows}


# ---------------------------------------------------------------------------
# RENDERING
# ---------------------------------------------------------------------------

def render_markdown(report: dict[str, Any]) -> str:
    s = report["summary"]
    rows = report["rows"]
    lines: list[str] = []
    lines.append("# SWE-Bench Lite Results\n")
    lines.append(f"**Total problems:** {s['n_problems']}\n")
    lines.append("## Headline\n")
    lines.append(f"| Metric | Brain OFF | Brain ON | ON vs OFF (positive = brain helped) |\n|---|---|---|---|\n")
    lines.append(f"| Resolution rate | {s['resolution_rate_off']:.0%} | {s['resolution_rate_on']:.0%} | {s['absolute_lift']:+.0%} |\n")
    if s["mean_wallclock_off_s"] and s["mean_wallclock_on_s"]:
        # Positive = brain ON was faster (off - on > 0 means on took less time)
        lines.append(f"| Mean wall-clock | {s['mean_wallclock_off_s']:.1f}s | {s['mean_wallclock_on_s']:.1f}s | {s['wallclock_delta_pct']:+.1f}% faster |\n")
    if s["mean_tokens_off"] is not None and s["mean_tokens_on"] is not None:
        # Positive = brain ON used fewer tokens
        tok_delta = (s["mean_tokens_off"] - s["mean_tokens_on"]) / s["mean_tokens_off"] * 100 if s["mean_tokens_off"] else 0
        lines.append(f"| Mean tokens | {s['mean_tokens_off']:.0f} | {s['mean_tokens_on']:.0f} | {tok_delta:+.1f}% fewer |\n")
    lines.append(f"\n**Fisher's exact (one-sided, brain ON > OFF):** p = {s['fisher_p_value']:.4f}")
    sig = "yes (alpha=0.05)" if s["fisher_p_value"] < 0.05 else "no (alpha=0.05)"
    lines.append(f"  -> statistically significant: {sig}\n")
    lines.append("\n## Per-problem detail\n\n")
    lines.append("| # | Problem | Brain OFF | Brain ON | OFF time | ON time | OFF tokens | ON tokens |\n")
    lines.append("|---|---|---|---|---|---|---|---|\n")
    for i, r in enumerate(rows, 1):
        off_t = f"{r['brain_off_s']:.1f}s" if r.get("brain_off_s") else "-"
        on_t = f"{r['brain_on_s']:.1f}s" if r.get("brain_on_s") else "-"
        off_k = f"{r['brain_off_tokens']:,}" if r.get("brain_off_tokens") else "-"
        on_k = f"{r['brain_on_tokens']:,}" if r.get("brain_on_tokens") else "-"
        lines.append(
            f"| {i} | `{r['id']}` | {r['brain_off_outcome']} | {r['brain_on_outcome']} | {off_t} | {on_t} | {off_k} | {on_k} |\n"
        )
    lines.append("\n## How to read this\n\n")
    lines.append("- `resolved` — failing test now passes after the agent's patch.\n")
    lines.append("- `failed`   — patch applied but failing test still fails.\n")
    lines.append("- `no-patch` — agent did not produce a patch.\n")
    lines.append("- `setup-error` — clone or `npm install` step failed (network/dep issue, not the agent's fault).\n")
    lines.append("\nFisher's exact tests whether the difference in resolution rate is likely due to chance. ")
    lines.append("With N=10 you need at least a 4-point absolute lift to clear p<0.05; smaller differences are inconclusive without more trials.\n")
    return "".join(lines)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Aggregate runs.jsonl into a results report.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    p.add_argument("--input", "-i", type=Path, required=True,
                   help="Directory containing runs.jsonl (output of runner.py)")
    p.add_argument("--output", "-o", type=Path, default=None,
                   help="Output directory (defaults to --input)")
    p.add_argument("--dry-run", action="store_true",
                   help="Print summary stats; do not write files")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    out_dir = args.output or args.input
    runs = load_runs(args.input)
    if not runs:
        print("ERROR: runs.jsonl is empty", file=sys.stderr)
        return 2
    report = aggregate(runs)
    md = render_markdown(report)

    print(md)
    if args.dry_run:
        print("\n  --dry-run set; not writing files.")
        return 0

    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "report.md").write_text(md, encoding="utf-8")
    (out_dir / "results.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"\n  wrote {out_dir / 'report.md'}")
    print(f"  wrote {out_dir / 'results.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
