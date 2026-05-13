#!/usr/bin/env python3
"""eval_lora.py — Three-way eval: base vs base+brain-context (RAG) vs LoRA.

For each held-out question:
  A) base model alone (control)
  B) base model + retrieved brain context in the prompt (RAG baseline)
  C) base model + LoRA adapter (this pipeline's output)

Score with:
  - exact-match (string containment, normalized)
  - semantic similarity (sentence-transformers cosine; falls back to char-shingle if missing)

Writes:
  <output>/eval-results.json   raw per-question scores
  <output>/eval-report.md      pretty markdown report (3 columns: A vs B vs C)

Required pip install (BEFORE running):
  pip install transformers torch peft sentence-transformers

Why each dep:
  transformers           — base model + tokenizer
  torch                  — runtime
  peft                   — load the LoRA adapter
  sentence-transformers  — semantic similarity scoring (~120MB, optional)

Usage:
  python eval_lora.py --adapter ./demo/lora-adapter --output ./demo
  python eval_lora.py --adapter ./demo/lora-adapter --questions ./my-eval.jsonl --output ./demo
  python eval_lora.py --adapter ./demo/lora-adapter --output ./demo --dry-run

The default eval set is a small held-out batch (in-script) of 20 Q&A pairs
drawn from the same brain themes — meant as a smoke-test, not a benchmark.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

# ----------------------------------------------------------------------------
# DEFAULT HELD-OUT EVAL SET (20 Qs — synthetic, mirrors sample brain themes)
# ----------------------------------------------------------------------------

DEFAULT_EVAL: list[dict[str, str]] = [
    {"q": "What hashing algorithm do we use for passwords?", "a_substr": "bcrypt", "a_full": "Use bcrypt with cost factor 12. SHA-256 is deprecated."},
    {"q": "Is SHA-256 acceptable for password storage?", "a_substr": "no", "a_full": "No. We deprecated SHA-256 in the 2025-Q4 audit. Use bcrypt or argon2id."},
    {"q": "How should SQL queries be written?", "a_substr": "parameterized", "a_full": "All SQL must be parameterized. No string concatenation. Enforced via Semgrep."},
    {"q": "Where do we store API keys?", "a_substr": ".env", "a_full": "API keys go in .env (gitignored). Document in .env.example."},
    {"q": "What's preferred for server state in React?", "a_substr": "react query", "a_full": "React Query is preferred over Redux for server state. Use Zustand for client-only state."},
    {"q": "How long is a JWT access token valid?", "a_substr": "24", "a_full": "JWT access tokens are 24-hour TTL. Refresh tokens are 30 days, single-use rotating."},
    {"q": "What library do we use for runtime API validation?", "a_substr": "zod", "a_full": "Use zod for runtime schema validation at all API boundaries."},
    {"q": "Why do we avoid fs.writeFileSync directly?", "a_substr": "atomic", "a_full": "Direct fs.writeFileSync can corrupt files on crash. Always use tmp + rename for atomic writes."},
    {"q": "What testing framework do we use?", "a_substr": "vitest", "a_full": "We adopted Vitest over Jest. Faster startup, native ESM, better TS inference."},
    {"q": "What caused the 2026-04-20 outage?", "a_substr": "connection pool", "a_full": "Postgres connection pool exhaustion. Fixed by adding pgbouncer with 100 max connections."},
    {"q": "What's our N+1 query rule?", "a_substr": "eager", "a_full": "Use eager loading (.select + .join). N+1 in /api/users took latency from 2.1s to 180ms."},
    {"q": "How do we handle path separators on Windows?", "a_substr": "forward slash", "a_full": "Use forward slashes everywhere. node:path.posix for display, node:path for filesystem."},
    {"q": "What's our commit message format?", "a_substr": "feat", "a_full": "<type>(<scope>): <subject>. Types: feat|fix|refactor|test|docs|chore|perf|security. Under 72 chars. No AI attribution."},
    {"q": "What's our policy on innerHTML?", "a_substr": "never", "a_full": "Never use innerHTML with user data. Always textContent or DOMPurify."},
    {"q": "What's required on every fetch call?", "a_substr": "abortsignal", "a_full": "Use AbortSignal.timeout(ms) on every fetch. 30s for LLM, 5s for health checks."},
    {"q": "What's the issue with Ink TUI in CI?", "a_substr": "tty", "a_full": "Ink TUI fails in non-TTY background processes. Set CI=true or use the dash command."},
    {"q": "What's our primary LLM provider?", "a_substr": "ollama", "a_full": "Local-first: Ollama is primary. Remote APIs are an explicit opt-in."},
    {"q": "Where does the global brain persist?", "a_substr": "global.json", "a_full": "~/.shadow-brain/global.json. Atomic write-tmp-rename pattern."},
    {"q": "What's our XSS mitigation strategy?", "a_substr": "domprify", "a_full": "Always textContent or DOMPurify for user-supplied HTML. We had a stored XSS in 2025."},
    {"q": "How do we revoke a JWT?", "a_substr": "revocation table", "a_full": "Maintain a revocation table indexed by jti. Refresh tokens are single-use rotating."},
]


# ----------------------------------------------------------------------------
# DEP CHECK
# ----------------------------------------------------------------------------

def check_dependencies() -> tuple[list[str], list[str]]:
    import importlib.util
    req = ["torch", "transformers", "peft"]
    opt = ["sentence_transformers"]
    missing_req = [r for r in req if importlib.util.find_spec(r) is None]
    missing_opt = [o for o in opt if importlib.util.find_spec(o) is None]
    return missing_req, missing_opt


def fail_missing(missing: list[str]) -> None:
    print(f"\nERROR: missing required deps: {missing}", file=sys.stderr)
    print("\n  pip install transformers torch peft sentence-transformers", file=sys.stderr)
    sys.exit(3)


# ----------------------------------------------------------------------------
# SCORING
# ----------------------------------------------------------------------------

def normalize(s: str) -> str:
    return re.sub(r"\s+", " ", s.lower().strip())


def exact_match(prediction: str, expected_substr: str) -> float:
    return 1.0 if normalize(expected_substr) in normalize(prediction) else 0.0


def char_shingle_similarity(a: str, b: str, n: int = 4) -> float:
    """Fallback semantic similarity using character n-gram Jaccard."""
    def shingles(s: str) -> set[str]:
        s = normalize(s)
        return {s[i:i + n] for i in range(len(s) - n + 1)}
    sa, sb = shingles(a), shingles(b)
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / len(sa | sb)


# ----------------------------------------------------------------------------
# CONTEXT RETRIEVAL FOR RAG BASELINE
# ----------------------------------------------------------------------------

def load_brain_snippets(brain_dir: Path | None, sample_mode: bool) -> list[str]:
    """Load brain entries to build a tiny RAG corpus."""
    if sample_mode:
        path = Path(__file__).parent / "sample_data" / "fake-brain-hierarchy.json"
    elif brain_dir is not None:
        path = brain_dir / "hierarchical-memory" / "hierarchy.json"
    else:
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return [e.get("content", "") for e in data if e.get("content")]
    except (OSError, json.JSONDecodeError):
        return []


def retrieve_context(query: str, snippets: list[str], top_k: int = 3) -> str:
    """Naive retrieval: char-shingle similarity, top-k."""
    if not snippets:
        return ""
    scored = sorted(
        ((char_shingle_similarity(query, s), s) for s in snippets),
        key=lambda x: -x[0],
    )
    return "\n".join(f"- {s}" for _, s in scored[:top_k])


# ----------------------------------------------------------------------------
# GENERATION (real or stub)
# ----------------------------------------------------------------------------

def generate_real(model, tokenizer, prompt: str, *, max_new_tokens: int = 200) -> str:
    import torch
    inputs = tokenizer(prompt, return_tensors="pt").to(model.device)
    with torch.no_grad():
        out = model.generate(
            **inputs,
            max_new_tokens=max_new_tokens,
            do_sample=False,
            pad_token_id=tokenizer.eos_token_id,
        )
    decoded = tokenizer.decode(out[0][inputs["input_ids"].shape[1]:], skip_special_tokens=True)
    return decoded.strip()


def make_prompt(tokenizer, question: str, context: str = "") -> str:
    msgs = [
        {"role": "system", "content": "You are an AI engineer assistant for this codebase. Be concise."},
    ]
    user = question if not context else f"{question}\n\nReference context:\n{context}"
    msgs.append({"role": "user", "content": user})
    return tokenizer.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True)


# ----------------------------------------------------------------------------
# EVAL LOOP
# ----------------------------------------------------------------------------

def evaluate(args: argparse.Namespace) -> int:
    missing_req, missing_opt = check_dependencies()
    if missing_req:
        fail_missing(missing_req)

    import torch  # noqa: F401
    from transformers import AutoTokenizer, AutoModelForCausalLM
    from peft import PeftModel

    # Load eval set
    if args.questions and args.questions.exists():
        eval_set = [json.loads(l) for l in args.questions.read_text(encoding="utf-8").splitlines() if l.strip()]
    else:
        eval_set = DEFAULT_EVAL
    print(f"  eval set: {len(eval_set)} questions")

    # Load base
    print(f"  loading base: {args.base_model}")
    tokenizer = AutoTokenizer.from_pretrained(args.base_model)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    base = AutoModelForCausalLM.from_pretrained(args.base_model, torch_dtype="auto", device_map="auto")

    # Load LoRA-fused
    print(f"  loading adapter: {args.adapter}")
    tuned = PeftModel.from_pretrained(base, str(args.adapter))

    # Load semantic-sim model if available
    sim_model = None
    if "sentence_transformers" not in missing_opt:
        try:
            from sentence_transformers import SentenceTransformer
            sim_model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")
            print("  semantic-similarity: sentence-transformers (MiniLM)")
        except Exception as exc:
            print(f"  semantic-similarity: fallback (sentence-transformers failed: {exc})")
    else:
        print("  semantic-similarity: char-shingle fallback")

    def semantic_sim(a: str, b: str) -> float:
        if sim_model is not None:
            import numpy as np
            ea, eb = sim_model.encode([a, b])
            sim = float(np.dot(ea, eb) / (np.linalg.norm(ea) * np.linalg.norm(eb) + 1e-9))
            return max(0.0, sim)
        return char_shingle_similarity(a, b)

    # Build RAG corpus
    snippets = load_brain_snippets(args.brain_dir, args.sample)
    if snippets:
        print(f"  RAG corpus: {len(snippets)} snippets")
    else:
        print("  RAG corpus: empty (B condition will fall back to no-context)")

    # Run all 3 conditions per question
    rows: list[dict[str, Any]] = []
    for i, q in enumerate(eval_set, 1):
        question = q["q"]
        gold_substr = q.get("a_substr", "")
        gold_full = q.get("a_full", q.get("a_substr", ""))

        print(f"  [{i}/{len(eval_set)}] {question[:60]}")

        # A) base alone
        prompt_a = make_prompt(tokenizer, question)
        pred_a = generate_real(base, tokenizer, prompt_a)

        # B) base + RAG
        ctx = retrieve_context(question, snippets, top_k=3)
        prompt_b = make_prompt(tokenizer, question, context=ctx)
        pred_b = generate_real(base, tokenizer, prompt_b)

        # C) LoRA
        prompt_c = make_prompt(tokenizer, question)
        pred_c = generate_real(tuned, tokenizer, prompt_c)

        rows.append({
            "q": question,
            "gold_substr": gold_substr,
            "gold_full": gold_full,
            "A_base":      {"pred": pred_a, "em": exact_match(pred_a, gold_substr), "sim": semantic_sim(pred_a, gold_full)},
            "B_base_rag":  {"pred": pred_b, "em": exact_match(pred_b, gold_substr), "sim": semantic_sim(pred_b, gold_full)},
            "C_lora":      {"pred": pred_c, "em": exact_match(pred_c, gold_substr), "sim": semantic_sim(pred_c, gold_full)},
        })

    return write_results(args.output, rows)


def write_results(out_dir: Path, rows: list[dict[str, Any]]) -> int:
    out_dir.mkdir(parents=True, exist_ok=True)
    n = len(rows)

    def avg(col: str, k: str) -> float:
        return sum(r[col][k] for r in rows) / max(1, n)

    summary = {
        "n_questions": n,
        "A_base":     {"em_rate": avg("A_base", "em"),     "sim_avg": avg("A_base", "sim")},
        "B_base_rag": {"em_rate": avg("B_base_rag", "em"), "sim_avg": avg("B_base_rag", "sim")},
        "C_lora":     {"em_rate": avg("C_lora", "em"),     "sim_avg": avg("C_lora", "sim")},
    }

    (out_dir / "eval-results.json").write_text(json.dumps({"summary": summary, "rows": rows}, indent=2))

    md = render_report(summary, rows)
    (out_dir / "eval-report.md").write_text(md)
    print(f"\n  wrote {out_dir / 'eval-results.json'}")
    print(f"  wrote {out_dir / 'eval-report.md'}")
    print(f"  A (base):     EM {summary['A_base']['em_rate']:.1%}   sim {summary['A_base']['sim_avg']:.3f}")
    print(f"  B (base+RAG): EM {summary['B_base_rag']['em_rate']:.1%}   sim {summary['B_base_rag']['sim_avg']:.3f}")
    print(f"  C (LoRA):     EM {summary['C_lora']['em_rate']:.1%}   sim {summary['C_lora']['sim_avg']:.3f}")
    return 0


def render_report(summary: dict[str, Any], rows: list[dict[str, Any]]) -> str:
    out: list[str] = []
    out.append("# LoRA Eval Report\n")
    out.append("Three conditions evaluated on the same held-out questions:\n")
    out.append("- **A** — base model alone\n")
    out.append("- **B** — base model + retrieved brain context (RAG)\n")
    out.append("- **C** — base model + LoRA adapter (this pipeline)\n\n")
    out.append("## Summary\n\n")
    out.append("| Condition | Exact-match | Semantic sim |\n|---|---|---|\n")
    for k, label in [("A_base", "A — base"), ("B_base_rag", "B — base+RAG"), ("C_lora", "C — LoRA")]:
        out.append(f"| {label} | {summary[k]['em_rate']:.1%} | {summary[k]['sim_avg']:.3f} |\n")
    out.append("\n## Per-question detail\n\n")
    for r in rows:
        out.append(f"### Q: {r['q']}\n\n")
        out.append(f"Gold substring: `{r['gold_substr']}`\n\n")
        for k, label in [("A_base", "A — base"), ("B_base_rag", "B — base+RAG"), ("C_lora", "C — LoRA")]:
            v = r[k]
            out.append(f"**{label}** (EM={int(v['em'])}, sim={v['sim']:.2f})\n\n> {v['pred'][:240]}\n\n")
    return "".join(out)


# ----------------------------------------------------------------------------
# DRY RUN
# ----------------------------------------------------------------------------

def eval_dry_run(args: argparse.Namespace) -> int:
    print("\n=== DRY RUN ===")
    print(f"  adapter:    {args.adapter}")
    print(f"  base model: {args.base_model}")
    print(f"  output dir: {args.output}")
    eval_set = DEFAULT_EVAL if not (args.questions and args.questions.exists()) else [
        json.loads(l) for l in args.questions.read_text(encoding="utf-8").splitlines() if l.strip()
    ]
    print(f"  eval set:   {len(eval_set)} questions")
    print("\n  conditions to be evaluated:")
    print("    A) base model alone")
    print("    B) base model + retrieved brain context (RAG baseline)")
    print("    C) base model + LoRA adapter (this pipeline)")
    print("\n  scoring:")
    print("    - exact-match (gold substring contained in prediction)")
    print("    - semantic similarity (sentence-transformers cosine; char-shingle fallback)")

    snippets = load_brain_snippets(args.brain_dir, args.sample)
    print(f"  RAG corpus would contain {len(snippets)} snippets")

    missing_req, missing_opt = check_dependencies()
    if missing_req:
        print(f"\n  MISSING required deps: {missing_req}")
    if missing_opt:
        print(f"  missing optional deps: {missing_opt}")
    print("\n  --dry-run set; not running any model.")
    return 0


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Eval base vs base+RAG vs LoRA on a held-out set.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    p.add_argument("--adapter", type=Path, required=True, help="Path to the LoRA adapter directory")
    p.add_argument("--base-model", type=str, default="unsloth/Qwen2.5-Coder-1.5B-Instruct")
    p.add_argument("--output", "-o", type=Path, default=Path("./eval-out"))
    p.add_argument("--questions", type=Path, default=None,
                   help="Optional JSONL of held-out questions ({q, a_substr, a_full})")
    p.add_argument("--brain-dir", type=Path, default=Path.home() / ".shadow-brain",
                   help="Brain directory for RAG snippets")
    p.add_argument("--sample", action="store_true", help="Use bundled sample brain for RAG corpus")
    p.add_argument("--dry-run", action="store_true")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.dry_run:
        return eval_dry_run(args)
    if not args.adapter.exists():
        print(f"ERROR: adapter not found: {args.adapter}", file=sys.stderr)
        return 2
    return evaluate(args)


if __name__ == "__main__":
    raise SystemExit(main())
