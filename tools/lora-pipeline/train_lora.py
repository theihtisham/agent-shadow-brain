#!/usr/bin/env python3
"""train_lora.py — Train a LoRA adapter on the JSONL produced by generate_training_data.py.

Required pip install (run BEFORE this script — we do not auto-install):

  pip install \\
    "unsloth @ git+https://github.com/unslothai/unsloth.git" \\
    peft trl transformers datasets accelerate bitsandbytes torch

Why each dep:
  unsloth        — 2x faster, lower-VRAM LoRA training kernels (optional but recommended)
  peft           — LoRA adapter library
  trl            — SFTTrainer (supervised fine-tuning loop)
  transformers   — HuggingFace base model loading + tokenizer
  datasets       — JSONL -> Dataset wrapper used by TRL
  accelerate     — device placement, mixed precision
  bitsandbytes   — 4-bit quantized base model (saves VRAM)
  torch          — PyTorch (CUDA, MPS, or CPU build)

Usage:
  python train_lora.py --data ./demo/training-data.jsonl --output ./demo/lora-adapter
  python train_lora.py --data ... --output ... --base-model unsloth/Qwen2.5-Coder-1.5B-Instruct
  python train_lora.py --data ... --output ... --epochs 5 --lr 1e-4 --rank 32
  python train_lora.py --dry-run --data ./demo/training-data.jsonl --output ./demo/lora-adapter

Run --help for all flags.

NOTE: this script is the orchestration scaffold. It expects the pip deps above
to be installed when run for real. With --dry-run it imports nothing heavy
and just prints the plan — safe to invoke without GPU or deps.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any


# ----------------------------------------------------------------------------
# DEFAULTS — hyperparams justified in README.md
# ----------------------------------------------------------------------------

DEFAULT_BASE_MODEL = "unsloth/Qwen2.5-Coder-1.5B-Instruct"
DEFAULT_LORA_R = 16
DEFAULT_LORA_ALPHA = 32
DEFAULT_LORA_DROPOUT = 0.05
DEFAULT_LR = 2e-4
DEFAULT_EPOCHS = 3
DEFAULT_BATCH = 4
DEFAULT_GRAD_ACCUM = 4
DEFAULT_MAX_SEQ = 2048

# Attention-only LoRA — standard for code tasks; saves memory.
DEFAULT_TARGET_MODULES = ["q_proj", "k_proj", "v_proj", "o_proj"]

# Chat template — Qwen2.5-Coder uses the same one as Qwen2.5-Instruct.
SYSTEM_PROMPT = (
    "You are an AI engineer assistant for this codebase. Answer using the team's "
    "established conventions, decisions, and patterns. Be concise and specific."
)


# ----------------------------------------------------------------------------
# DEP CHECK
# ----------------------------------------------------------------------------

REQUIRED_DEPS = [
    ("torch", "PyTorch"),
    ("transformers", "HuggingFace transformers"),
    ("datasets", "HuggingFace datasets"),
    ("peft", "LoRA library"),
    ("trl", "TRL SFTTrainer"),
]

OPTIONAL_DEPS = [
    ("unsloth", "Unsloth (2x faster LoRA)"),
    ("bitsandbytes", "4-bit quantization"),
]


def check_dependencies() -> tuple[list[str], list[str]]:
    """Return (missing_required, missing_optional)."""
    import importlib.util
    missing_req: list[str] = []
    missing_opt: list[str] = []
    for name, _label in REQUIRED_DEPS:
        if importlib.util.find_spec(name) is None:
            missing_req.append(name)
    for name, _label in OPTIONAL_DEPS:
        if importlib.util.find_spec(name) is None:
            missing_opt.append(name)
    return missing_req, missing_opt


def fail_missing_deps(missing: list[str]) -> None:
    print("\nERROR: missing required Python packages:", file=sys.stderr)
    for m in missing:
        print(f"  - {m}", file=sys.stderr)
    print("\nInstall with:", file=sys.stderr)
    print(
        '  pip install unsloth peft trl transformers datasets accelerate bitsandbytes torch',
        file=sys.stderr,
    )
    print("\n(Or follow the install table in tools/lora-pipeline/README.md.)", file=sys.stderr)
    sys.exit(3)


# ----------------------------------------------------------------------------
# DATA LOADING
# ----------------------------------------------------------------------------

def load_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as f:
        for line_no, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError as exc:
                print(f"warn: skipping line {line_no}: {exc}", file=sys.stderr)
    return rows


def format_chat_example(row: dict[str, Any]) -> dict[str, str]:
    """Format one triple as a Qwen2.5 chat message string."""
    user = row.get("instruction", "").strip()
    if row.get("input"):
        user += "\n\n" + row["input"].strip()
    assistant = row.get("output", "").strip()
    # Qwen2.5 chat-ml format. Tokenizer's apply_chat_template will format properly.
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user},
        {"role": "assistant", "content": assistant},
    ]
    return {"messages": messages}


# ----------------------------------------------------------------------------
# TRAINING (real)
# ----------------------------------------------------------------------------

def train_real(args: argparse.Namespace) -> int:
    """Run the actual training loop. Requires all deps."""
    missing_req, missing_opt = check_dependencies()
    if missing_req:
        fail_missing_deps(missing_req)
    if missing_opt:
        print(f"  note: optional deps missing ({', '.join(missing_opt)}) — fallback mode")

    import torch  # noqa: F401
    from datasets import Dataset
    from transformers import AutoTokenizer, AutoModelForCausalLM, TrainingArguments
    from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training

    use_unsloth = "unsloth" not in missing_opt
    use_4bit = "bitsandbytes" not in missing_opt

    print(f"  loading dataset: {args.data}")
    rows = load_jsonl(args.data)
    if not rows:
        print("ERROR: empty dataset", file=sys.stderr)
        return 4
    print(f"  examples: {len(rows)}")
    formatted = [format_chat_example(r) for r in rows]
    ds = Dataset.from_list(formatted)

    print(f"  loading base model: {args.base_model}")
    if use_unsloth:
        from unsloth import FastLanguageModel  # type: ignore
        model, tokenizer = FastLanguageModel.from_pretrained(
            model_name=args.base_model,
            max_seq_length=args.max_seq,
            load_in_4bit=use_4bit,
        )
        model = FastLanguageModel.get_peft_model(
            model,
            r=args.rank,
            target_modules=DEFAULT_TARGET_MODULES,
            lora_alpha=args.alpha,
            lora_dropout=DEFAULT_LORA_DROPOUT,
            bias="none",
            use_gradient_checkpointing="unsloth",
            random_state=args.seed,
        )
    else:
        tokenizer = AutoTokenizer.from_pretrained(args.base_model)
        if tokenizer.pad_token is None:
            tokenizer.pad_token = tokenizer.eos_token
        model_kwargs: dict[str, Any] = {"torch_dtype": "auto", "device_map": "auto"}
        if use_4bit:
            from transformers import BitsAndBytesConfig
            model_kwargs["quantization_config"] = BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_compute_dtype="float16",
                bnb_4bit_use_double_quant=True,
            )
        model = AutoModelForCausalLM.from_pretrained(args.base_model, **model_kwargs)
        if use_4bit:
            model = prepare_model_for_kbit_training(model)
        lora_cfg = LoraConfig(
            r=args.rank, lora_alpha=args.alpha, lora_dropout=DEFAULT_LORA_DROPOUT,
            target_modules=DEFAULT_TARGET_MODULES, bias="none", task_type="CAUSAL_LM",
        )
        model = get_peft_model(model, lora_cfg)

    # Tokenize with the model's chat template
    def tokenize(batch: dict[str, Any]) -> dict[str, Any]:
        texts = [
            tokenizer.apply_chat_template(m, tokenize=False, add_generation_prompt=False)
            for m in batch["messages"]
        ]
        return tokenizer(texts, truncation=True, max_length=args.max_seq, padding="max_length")

    tokenized = ds.map(tokenize, batched=True, remove_columns=ds.column_names)

    # TRL SFTTrainer
    from trl import SFTConfig, SFTTrainer

    train_args = SFTConfig(
        output_dir=str(args.output),
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch,
        gradient_accumulation_steps=args.grad_accum,
        learning_rate=args.lr,
        lr_scheduler_type="cosine",
        warmup_ratio=0.03,
        logging_steps=10,
        save_strategy="epoch",
        bf16=True if torch.cuda.is_available() and torch.cuda.is_bf16_supported() else False,
        fp16=False,
        optim="adamw_8bit" if use_4bit else "adamw_torch",
        seed=args.seed,
        report_to="none",
        max_seq_length=args.max_seq,
    )

    trainer = SFTTrainer(
        model=model,
        train_dataset=tokenized,
        tokenizer=tokenizer,
        args=train_args,
    )

    print("  beginning training...")
    trainer.train()

    print(f"  saving adapter to {args.output}")
    args.output.mkdir(parents=True, exist_ok=True)
    trainer.save_model(str(args.output))
    tokenizer.save_pretrained(str(args.output))

    # Write a small training-info.json
    info = {
        "base_model": args.base_model,
        "lora_r": args.rank,
        "lora_alpha": args.alpha,
        "learning_rate": args.lr,
        "epochs": args.epochs,
        "n_examples": len(rows),
        "max_seq": args.max_seq,
        "target_modules": DEFAULT_TARGET_MODULES,
    }
    (args.output / "training-info.json").write_text(json.dumps(info, indent=2))
    print("  done.")
    return 0


# ----------------------------------------------------------------------------
# DRY RUN
# ----------------------------------------------------------------------------

def train_dry_run(args: argparse.Namespace) -> int:
    print("\n=== DRY RUN ===")
    print(f"  data file:        {args.data}")
    print(f"  output dir:       {args.output}")
    print(f"  base model:       {args.base_model}")
    print(f"  lora r:           {args.rank}")
    print(f"  lora alpha:       {args.alpha}")
    print(f"  lora dropout:     {DEFAULT_LORA_DROPOUT}")
    print(f"  target modules:   {DEFAULT_TARGET_MODULES}")
    print(f"  learning rate:    {args.lr}")
    print(f"  epochs:           {args.epochs}")
    print(f"  batch (per dev):  {args.batch}")
    print(f"  grad accum:       {args.grad_accum}")
    print(f"  effective batch:  {args.batch * args.grad_accum}")
    print(f"  max seq len:      {args.max_seq}")
    print(f"  seed:             {args.seed}")

    if args.data.exists():
        rows = load_jsonl(args.data)
        print(f"  dataset rows:     {len(rows)}")
        if rows:
            sample = format_chat_example(rows[0])
            print("  sample formatted chat (first row):")
            print(f"    system: {SYSTEM_PROMPT[:80]}...")
            print(f"    user:   {sample['messages'][1]['content'][:120]}")
            print(f"    asst:   {sample['messages'][2]['content'][:120]}")
    else:
        print(f"  WARN: data file does not exist: {args.data}")

    missing_req, missing_opt = check_dependencies()
    if missing_req:
        print(f"\n  MISSING required deps: {missing_req}")
        print("  run: pip install peft trl transformers datasets accelerate torch")
    if missing_opt:
        print(f"  missing optional deps: {missing_opt}")
        print("  (training will fall back to slower transformers-only path)")
    print("\n  --dry-run set; not actually training.")
    return 0


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Train a LoRA adapter on shadow-brain training data.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    p.add_argument("--data", type=Path, required=True,
                   help="Path to training-data.jsonl")
    p.add_argument("--output", "-o", type=Path, required=True,
                   help="Output directory for the LoRA adapter")
    p.add_argument("--base-model", type=str, default=DEFAULT_BASE_MODEL,
                   help="HuggingFace model id (small code-tuned model recommended)")
    p.add_argument("--rank", type=int, default=DEFAULT_LORA_R, help="LoRA r")
    p.add_argument("--alpha", type=int, default=DEFAULT_LORA_ALPHA, help="LoRA alpha")
    p.add_argument("--lr", type=float, default=DEFAULT_LR, help="Learning rate")
    p.add_argument("--epochs", type=int, default=DEFAULT_EPOCHS)
    p.add_argument("--batch", type=int, default=DEFAULT_BATCH,
                   help="Per-device train batch size")
    p.add_argument("--grad-accum", type=int, default=DEFAULT_GRAD_ACCUM,
                   help="Gradient accumulation steps")
    p.add_argument("--max-seq", type=int, default=DEFAULT_MAX_SEQ,
                   help="Max sequence length for tokenizer")
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--dry-run", action="store_true",
                   help="Print the plan + dataset stats; do not import heavy deps")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.dry_run:
        return train_dry_run(args)
    if not args.data.exists():
        print(f"ERROR: data file does not exist: {args.data}", file=sys.stderr)
        return 2
    return train_real(args)


if __name__ == "__main__":
    raise SystemExit(main())
