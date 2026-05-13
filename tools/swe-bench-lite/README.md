# SWE-Bench Lite — Brain ON vs OFF micro-eval

> A 10-problem benchmark to measure whether the Shadow Brain actually helps a coding agent solve real bugs.

## What this measures

For each of 10 small, real-world bugs we:
1. Clone the repo at a known `base_commit` where the bug exists.
2. Run the failing test to confirm it actually fails.
3. Invoke a coding agent **twice** on the same problem:
   - Once with `SHADOW_BRAIN_ENABLED=0`
   - Once with `SHADOW_BRAIN_ENABLED=1`
4. Apply the agent's patch and re-run the failing test.
5. Record: pass/fail, wall-clock duration, and tokens used (when reported).

## Why "lite"?

The official [SWE-Bench](https://www.swebench.com/) is hundreds of problems and runs for hours. This is **10 problems, ~90 minutes** — a fast smoke-test you can run on a laptop without API budget anxiety.

## Interpreting the numbers

The headline metric is **resolution rate**: how many of the 10 problems were resolved (failing test now passes after the agent's patch).

We also report:
- Mean wall-clock time per problem (brain ON vs OFF)
- Mean tokens used per problem (when the agent surfaces them)
- Statistical significance via Fisher's exact test (one-sided, brain ON > OFF)

**Realistic expectation:** with carefully-curated problems where prior context helps (recurring framework patterns, library quirks, project conventions) we expect roughly **+20-40% resolution rate with the brain enabled**, *on these problems*. That is a smoke-test signal — not a benchmark of brains in general. N=10 cannot detect smaller differences. For statistical confidence at the 0.05 level on these N=10 problems, you need a margin of about 4+ extra problems solved.

## Disclaimers

- Not the official SWE-Bench. Same shape, fraction of the scope.
- Problems are hand-curated to be small (>5 min for a human, >5 min for a typical agent).
- Some problems are illustrative scaffolds rather than verbatim issues from those repos — see each `problem.json` for the upstream reference.
- Agent variance is high. Run 3 trials minimum before drawing conclusions.
- Network access is required to clone the repos. We do NOT bundle them.

## Requirements

**Python:** 3.10 or newer.

**System tools:**
- `git` on PATH (clone, checkout)
- One of: `node` (for JS/TS problems), `python3.10+` (for Python problems), `go` (for Go problems)

**Pip packages:**

| Stage | Required pip install |
|---|---|
| `runner.py` | (stdlib only) |
| `score.py` | `scipy` (for Fisher's exact test — falls back to manual computation if missing) |

**Coding agent:** the runner expects ONE of these on PATH (it auto-detects):
- `claude` (Anthropic Claude Code CLI)
- `aider` (Aider)
- `cline-cli` (Cline)

If none are installed, the runner uses a built-in **mock agent** that applies the `expected_fix_hint` directly — useful for verifying the harness plumbing works before consuming real tokens.

## Quickstart

```bash
# 0. Verify the harness works end-to-end with the mock agent (no LLM cost)
python tools/swe-bench-lite/runner.py --agent mock --output ./runs/mock-trial

# 1. Run real eval against one of the supported agents
python tools/swe-bench-lite/runner.py --agent claude --output ./runs/trial-1

# 2. Aggregate into a report
python tools/swe-bench-lite/score.py --input ./runs/trial-1 --output ./runs/trial-1/report.md

# 3. Inspect the markdown report
cat ./runs/trial-1/report.md
```

Every script supports `--help` and `--dry-run`.

## Files

```
tools/swe-bench-lite/
  README.md
  runner.py                 orchestrator (clone, run agent twice, record)
  score.py                  aggregate + Fisher's exact + markdown report
  report-template.md        twitter thread + blog post scaffold
  problems/
    README.md               problem-set documentation
    01-*.json               problem specs (10 total)
```

## Problem set at a glance

| # | Repo | Language | Class | Wall-clock budget |
|---|---|---|---|---|
| 01 | expressjs/express | JS  | off-by-one in path matcher | 5 min |
| 02 | axios/axios       | JS  | regex / URL encoding edge case | 5 min |
| 03 | facebook/react    | TS  | null-guard missing in dev warning | 5 min |
| 04 | psf/requests      | Py  | unicode header handling | 5 min |
| 05 | pallets/flask     | Py  | env var precedence | 4 min |
| 06 | numpy/numpy       | Py  | wrong dtype in error message | 3 min |
| 07 | sindresorhus/got  | JS  | retry counting off-by-one | 5 min |
| 08 | django/django     | Py  | timezone fallback string | 4 min |
| 09 | gin-gonic/gin     | Go  | header case sensitivity | 5 min |
| 10 | nodejs/node       | JS  | small docs/regex inconsistency | 4 min |

Total wall-clock budget: ~45 min × 2 (ON + OFF) = ~90 min.

## What happens when the agent doesn't apply a patch?

The runner records the run as a `no-patch` outcome (not a `fail`) — distinct from a patch that compiled but didn't fix the failing test. The scoring treats both as unresolved, but the report distinguishes them.
