#!/usr/bin/env python3
"""generate_training_data.py — Brain -> JSONL instruction dataset.

Reads memories from ~/.shadow-brain/ (or the bundled sample) and emits
(instruction, input, output) triples suitable for LoRA fine-tuning.

For each brain entity (raw entries + summaries + patterns + principles),
we synthesize one or more instruction triples by templating:

  - "What's our convention for X?"  -> the codified rule
  - "How do we handle X?"           -> the pattern + rationale
  - "Why did we decide X?"          -> the decision + linked causes
  - "What is the bug-fix for X?"    -> the recipe
  - "List our security rules"       -> aggregated principles

Outputs JSONL (one triple per line) compatible with TRL/Unsloth chat-style
fine-tuning. Stdlib-only — no pip installs required.

Usage:
  python generate_training_data.py --output ./my-project
  python generate_training_data.py --sample --output ./demo
  python generate_training_data.py --brain-dir ~/.shadow-brain --output ./my-project --max-examples 5000
  python generate_training_data.py --dry-run --sample

Run --help for all flags.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable

# ----------------------------------------------------------------------------
# CONFIG
# ----------------------------------------------------------------------------

DEFAULT_BRAIN_DIR = Path.home() / ".shadow-brain"
SAMPLE_DIR = Path(__file__).parent / "sample_data"

# Minimum and maximum examples we aim to produce per project.
TARGET_MIN = 1000
TARGET_MAX = 5000

# Per-entry expansion: each brain entry generates this many paraphrased triples.
EXPANSION_FACTOR = 6

# Categories that often map to a specific instruction template family.
CATEGORY_TEMPLATES: dict[str, list[str]] = {
    "security": [
        "What's our security rule about {topic}?",
        "How do we handle {topic} securely?",
        "Why is {topic} important from a security standpoint?",
        "Give the security policy for {topic}.",
    ],
    "architecture": [
        "What's our architecture decision for {topic}?",
        "Explain why we chose {topic}.",
        "How is {topic} structured in this codebase?",
    ],
    "pattern": [
        "What's the convention for {topic}?",
        "How do we typically handle {topic}?",
        "What pattern do we use for {topic}?",
    ],
    "decision": [
        "Why did we decide on {topic}?",
        "What's the rationale behind {topic}?",
        "Document the decision for {topic}.",
    ],
    "incident": [
        "What incident taught us about {topic}?",
        "What happened with {topic} in production?",
        "Describe the {topic} postmortem.",
    ],
    "performance": [
        "How do we optimize {topic}?",
        "What's the perf rule for {topic}?",
        "Document the perf finding for {topic}.",
    ],
    "warning": [
        "What should I avoid when working with {topic}?",
        "What's the gotcha for {topic}?",
        "Why is {topic} tricky?",
    ],
    "pitfall": [
        "What pitfall should I watch for with {topic}?",
        "Why does {topic} break unexpectedly?",
    ],
    "convention": [
        "What's our convention for {topic}?",
        "How should I format {topic}?",
        "Document the {topic} style rule.",
    ],
    "anti-pattern": [
        "What should we never do with {topic}?",
        "What's the anti-pattern for {topic}?",
    ],
    "bug": [
        "What was the bug related to {topic} and how was it fixed?",
        "Describe the {topic} bug and its resolution.",
    ],
    "refactor": [
        "Describe the {topic} refactor.",
        "Why was {topic} refactored?",
    ],
    "learning": [
        "What did we learn about {topic}?",
    ],
    "observation": [
        "What did we observe about {topic}?",
    ],
    "rule": [
        "What's the rule for {topic}?",
        "Codify our policy on {topic}.",
    ],
    "failure": [
        "What failed with {topic}?",
        "Describe the {topic} failure.",
    ],
}

# Generic templates for any category without a specific mapping.
GENERIC_TEMPLATES = [
    "Tell me about our approach to {topic}.",
    "What do we know about {topic}?",
    "Summarize {topic} for a new team member.",
]


# ----------------------------------------------------------------------------
# BRAIN LOADERS
# ----------------------------------------------------------------------------

def _load_json_safe(path: Path) -> Any:
    """Read a JSON file safely; return None on any failure."""
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        print(f"  warn: could not parse {path}: {exc}", file=sys.stderr)
        return None


def load_brain_entries(brain_dir: Path, *, use_sample: bool = False) -> list[dict[str, Any]]:
    """Load all available brain entries from disk.

    Returns a normalized list with keys: id, tier, content, category, confidence,
    importance, agent (best-effort), project (best-effort), metadata.
    """
    entries: list[dict[str, Any]] = []

    if use_sample:
        hierarchy_path = SAMPLE_DIR / "fake-brain-hierarchy.json"
        global_path = SAMPLE_DIR / "fake-brain-global.json"
    else:
        hierarchy_path = brain_dir / "hierarchical-memory" / "hierarchy.json"
        global_path = brain_dir / "global.json"

    # Tier-1 source: hierarchical-memory (richest)
    hier = _load_json_safe(hierarchy_path)
    if isinstance(hier, list):
        for raw in hier:
            entries.append({
                "id": raw.get("id", ""),
                "tier": raw.get("tier", "raw"),
                "content": str(raw.get("content", "")).strip(),
                "category": str(raw.get("category", "general")).strip().lower(),
                "confidence": float(raw.get("confidence", 0.5)),
                "importance": float(raw.get("importance", 0.5)),
                "agent": (raw.get("metadata") or {}).get("agent", "unknown"),
                "project": (raw.get("metadata") or {}).get("projectId", ""),
                "metadata": raw.get("metadata") or {},
            })

    # Tier-2 source: global.json memories array
    glob = _load_json_safe(global_path)
    if isinstance(glob, dict):
        for raw in glob.get("memories", []) or []:
            entries.append({
                "id": raw.get("id", ""),
                "tier": "raw",
                "content": str(raw.get("content", "")).strip(),
                "category": str(raw.get("category", "general")).strip().lower(),
                "confidence": float(raw.get("confidence", 0.5)),
                "importance": float(raw.get("importance", 0.5)),
                "agent": raw.get("agentTool", "unknown"),
                "project": raw.get("projectId", ""),
                "metadata": {"projectName": raw.get("projectName", "")},
            })

    # Dedupe by content (same memory may appear in both stores)
    seen: set[str] = set()
    unique: list[dict[str, Any]] = []
    for e in entries:
        key = e["content"][:300]
        if not key or key in seen:
            continue
        seen.add(key)
        unique.append(e)
    return unique


def load_causal_links(brain_dir: Path, *, use_sample: bool = False) -> list[dict[str, Any]]:
    """Load causal links so we can synthesize chained reasoning examples."""
    path = (SAMPLE_DIR / "fake-brain-causal.json") if use_sample else (brain_dir / "causal-chains.json")
    data = _load_json_safe(path)
    if isinstance(data, dict):
        return data.get("links", []) or []
    if isinstance(data, list):
        return data
    return []


# ----------------------------------------------------------------------------
# TRIPLE SYNTHESIS
# ----------------------------------------------------------------------------

def extract_topic(content: str) -> str:
    """Extract a short topic phrase from a memory's content (heuristic)."""
    # Strip "Established principle (cat):" prefix and similar
    cleaned = content
    for prefix in ("Established principle", "Pattern detected", "Summary of"):
        if cleaned.startswith(prefix):
            # Find first ":" then take next 80 chars
            idx = cleaned.find(":")
            if idx > -1:
                cleaned = cleaned[idx + 1:]
                break
    # Take first sentence
    cleaned = cleaned.strip().split(".")[0].split("\n")[0].strip()
    # Drop leading verb phrases
    for verb in ("Use ", "All ", "Do NOT ", "Never ", "Always ", "Adopted ", "Default to "):
        if cleaned.startswith(verb):
            cleaned = cleaned[len(verb):]
            break
    # Truncate
    if len(cleaned) > 80:
        cleaned = cleaned[:80].rsplit(" ", 1)[0]
    return cleaned.strip() or "this topic"


def make_input_context(entry: dict[str, Any], peers: list[dict[str, Any]]) -> str:
    """Build the 'input' field — extra context the model sees alongside the question.

    For raw entries we leave it empty (the model should answer from learned knowledge).
    For higher tiers we include 1-3 source snippets so the model learns to ground.
    """
    if entry["tier"] in ("pattern", "principle"):
        # Add a peer-context block
        sample = random.sample(peers, k=min(2, len(peers))) if peers else []
        snippets = [p["content"][:200] for p in sample]
        if snippets:
            return "Related context:\n" + "\n".join(f"- {s}" for s in snippets)
    return ""


def synthesize_triples_for_entry(
    entry: dict[str, Any],
    *,
    peers: list[dict[str, Any]],
    rng: random.Random,
    expansion: int,
) -> Iterable[dict[str, str]]:
    """Generate (instruction, input, output) triples for a single brain entry."""
    if not entry["content"]:
        return
    category = entry["category"]
    topic = extract_topic(entry["content"])
    templates = CATEGORY_TEMPLATES.get(category, []) + GENERIC_TEMPLATES
    rng.shuffle(templates)

    for tpl in templates[:expansion]:
        instruction = tpl.format(topic=topic)
        ctx = make_input_context(entry, peers)
        # Build a clean output: prefer the original codified content
        output = entry["content"]
        # If content is a higher-tier summary, slightly humanize it
        if output.startswith(("Established principle", "Pattern detected", "Summary of")):
            # Strip the metadata header line, keep the body
            lines = output.split("\n")
            body_lines = [l for l in lines if not l.startswith(("Established", "Pattern", "Summary", "Validated", "Reliability", "Trust", "Confidence", "Observed"))]
            if body_lines:
                output = "\n".join(body_lines).strip()
        yield {
            "instruction": instruction.strip(),
            "input": ctx,
            "output": output.strip(),
            "meta": {
                "entry_id": entry["id"],
                "category": category,
                "tier": entry["tier"],
                "importance": entry["importance"],
            },
        }


def synthesize_chain_triples(
    entries_by_id: dict[str, dict[str, Any]],
    links: list[dict[str, Any]],
) -> Iterable[dict[str, str]]:
    """Generate cause-effect chain triples from causal links.

    Format:
      instruction: "Why did decision X lead to Y?"
      input:       "Decision X: ...\nDecision Y: ..."
      output:      "<causal reason linking them>"
    """
    for link in links:
        a = entries_by_id.get(link.get("from", ""))
        b = entries_by_id.get(link.get("to", ""))
        if not a or not b:
            continue
        topic_a = extract_topic(a["content"])
        topic_b = extract_topic(b["content"])
        yield {
            "instruction": f"How does our decision on '{topic_a}' relate to '{topic_b}'?",
            "input": f"Decision A: {a['content'][:300]}\nDecision B: {b['content'][:300]}",
            "output": link.get("reason", "These are part of a connected chain of decisions in this project."),
            "meta": {"kind": "causal-link", "link_id": link.get("id", "")},
        }


def synthesize_category_summaries(entries: list[dict[str, Any]]) -> Iterable[dict[str, str]]:
    """Aggregated 'List our X rules' type triples."""
    by_cat: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for e in entries:
        by_cat[e["category"]].append(e)
    for cat, items in by_cat.items():
        if len(items) < 3:
            continue
        # Sort by importance desc, take top 6
        items.sort(key=lambda x: x["importance"], reverse=True)
        top = items[:6]
        bullets = "\n".join(f"- {it['content'].splitlines()[0][:160]}" for it in top)
        yield {
            "instruction": f"List the team's {cat} rules.",
            "input": "",
            "output": bullets,
            "meta": {"kind": "category-summary", "category": cat, "n_sources": len(top)},
        }


# ----------------------------------------------------------------------------
# MAIN PIPELINE
# ----------------------------------------------------------------------------

def build_dataset(
    *,
    brain_dir: Path,
    use_sample: bool,
    max_examples: int,
    expansion: int,
    seed: int,
) -> list[dict[str, Any]]:
    rng = random.Random(seed)
    entries = load_brain_entries(brain_dir, use_sample=use_sample)
    if not entries:
        raise SystemExit(
            "No brain entries found.\n"
            "  - Tried: hierarchical-memory/hierarchy.json and global.json\n"
            f"  - Brain dir: {brain_dir}\n"
            "  - Run the brain first (e.g., `shadow-brain --init`) or use --sample."
        )
    links = load_causal_links(brain_dir, use_sample=use_sample)
    entries_by_id = {e["id"]: e for e in entries}

    examples: list[dict[str, Any]] = []

    # 1. Per-entry expansion
    for entry in entries:
        peer_pool = [e for e in entries if e["category"] == entry["category"] and e["id"] != entry["id"]]
        for triple in synthesize_triples_for_entry(entry, peers=peer_pool, rng=rng, expansion=expansion):
            examples.append(triple)

    # 2. Causal-chain triples
    for triple in synthesize_chain_triples(entries_by_id, links):
        examples.append(triple)

    # 3. Category-aggregated summaries
    for triple in synthesize_category_summaries(entries):
        examples.append(triple)

    rng.shuffle(examples)
    if len(examples) > max_examples:
        examples = examples[:max_examples]
    return examples


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


def print_summary(rows: list[dict[str, Any]]) -> None:
    by_cat: dict[str, int] = defaultdict(int)
    by_kind: dict[str, int] = defaultdict(int)
    for r in rows:
        meta = r.get("meta", {}) or {}
        by_cat[meta.get("category", "other")] += 1
        by_kind[meta.get("kind", "per-entry")] += 1
    print(f"  Total triples: {len(rows)}")
    print("  By category:")
    for cat, n in sorted(by_cat.items(), key=lambda x: -x[1])[:12]:
        print(f"    {cat:20s} {n:6d}")
    print("  By kind:")
    for kind, n in sorted(by_kind.items(), key=lambda x: -x[1]):
        print(f"    {kind:20s} {n:6d}")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Convert ~/.shadow-brain memories into a LoRA training JSONL.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    p.add_argument("--brain-dir", type=Path, default=DEFAULT_BRAIN_DIR,
                   help="Path to ~/.shadow-brain (ignored when --sample is set)")
    p.add_argument("--sample", action="store_true",
                   help="Use the bundled sample brain instead of a real one")
    p.add_argument("--output", "-o", type=Path, default=Path("./training-out"),
                   help="Output directory (training-data.jsonl will be written here)")
    p.add_argument("--max-examples", type=int, default=TARGET_MAX,
                   help=f"Cap on number of triples emitted (target {TARGET_MIN}-{TARGET_MAX})")
    p.add_argument("--expansion", type=int, default=EXPANSION_FACTOR,
                   help="Number of paraphrased triples per brain entry")
    p.add_argument("--seed", type=int, default=42, help="RNG seed for reproducibility")
    p.add_argument("--project", type=str, default="project",
                   help="Project name (used in output paths)")
    p.add_argument("--dry-run", action="store_true",
                   help="Print summary, do not write the JSONL file")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    print(f"  brain-dir: {args.brain_dir} {'(SAMPLE)' if args.sample else ''}")
    print(f"  output:    {args.output}")
    print(f"  expansion: {args.expansion} | max: {args.max_examples} | seed: {args.seed}")
    try:
        rows = build_dataset(
            brain_dir=args.brain_dir,
            use_sample=args.sample,
            max_examples=args.max_examples,
            expansion=args.expansion,
            seed=args.seed,
        )
    except SystemExit as e:
        print(str(e), file=sys.stderr)
        return 2
    print_summary(rows)

    if args.dry_run:
        print("  --dry-run set; not writing any file.")
        return 0

    out_path = args.output / "training-data.jsonl"
    write_jsonl(out_path, rows)
    print(f"  wrote {out_path} ({out_path.stat().st_size:,} bytes)")
    # Also emit a small manifest for downstream scripts
    manifest = {
        "project": args.project,
        "n_examples": len(rows),
        "brain_dir": str(args.brain_dir),
        "sample_mode": args.sample,
        "seed": args.seed,
        "expansion": args.expansion,
    }
    (args.output / "manifest.json").write_text(json.dumps(manifest, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
