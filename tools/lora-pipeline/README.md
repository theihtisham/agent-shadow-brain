# Project-LoRA Distillation Pipeline

> **Your codebase becomes a model.** Turn your `~/.shadow-brain` memories into a fine-tuned LoRA adapter that bakes your team's conventions, decisions, and patterns directly into a small open-source model.

---

## What this does

The Shadow Brain stores thousands of project-specific memories: architecture decisions, bug-fix patterns, naming conventions, security rules, framework choices. This pipeline distills those memories into a LoRA (Low-Rank Adaptation) adapter on top of a small open-source code model.

**Result:** a 1.5B-parameter model that already knows:
- Your code conventions (file layout, naming, commit format)
- Your architectural decisions (why X over Y, what's deprecated)
- Your bug-fix recipes (the off-by-one you keep hitting, the auth quirk)
- Your security and review rules

You can serve it via Ollama, llama.cpp, or a small FastAPI server. No more re-explaining `our auth pattern` to every new agent session.

## Pipeline overview

```
~/.shadow-brain/          generate_training_data.py    train_lora.py        eval_lora.py
hierarchical-memory  ---> training-data.jsonl       ---> lora-adapter/  ---> eval-results.json
global.json                (1-5k instruction triples)    (peft format)        + report.md
                                                                                       |
                                                                                       v
                                                                                  serve_lora.py
                                                                                       |
                                                                                       v
                                                                              Ollama / FastAPI
```

## Stages

| Stage | Script | Inputs | Outputs |
|---|---|---|---|
| 1. Extract | `generate_training_data.py` | `~/.shadow-brain/` | `<project>/training-data.jsonl` |
| 2. Train | `train_lora.py` | training-data.jsonl | `<project>/lora-adapter/` |
| 3. Evaluate | `eval_lora.py` | adapter + held-out Q&A | `eval-results.json`, `report.md` |
| 4. Serve | `serve_lora.py` | adapter | Ollama Modelfile + FastAPI server |

## Requirements

**Python:** 3.10 or newer.

**Pip packages** (install only what each stage needs):

| Stage | Required pip install |
|---|---|
| `generate_training_data.py` | (stdlib only) |
| `train_lora.py` | `unsloth peft trl transformers datasets accelerate bitsandbytes torch` |
| `eval_lora.py` | `transformers torch sentence-transformers` |
| `serve_lora.py` | `fastapi uvicorn transformers peft torch` (for FastAPI mode) |

**Hardware for training:** a GPU with 8+ GB VRAM (NVIDIA, recent CUDA). On CPU it's possible but will take 12+ hours. Apple Silicon (MPS) is supported.

**Hardware for inference:** any modern CPU; LoRA-merged 1.5B model is ~3 GB and runs ~20-40 tokens/sec on a recent laptop.

## Quickstart

```bash
# 1. Extract training data from your brain (or use --sample for a demo run)
python tools/lora-pipeline/generate_training_data.py --project myapp --output ./myapp-lora

# 2. Inspect the dataset
head -n 3 ./myapp-lora/training-data.jsonl

# 3. Train the LoRA adapter (after pip install unsloth peft trl ...)
python tools/lora-pipeline/train_lora.py --data ./myapp-lora/training-data.jsonl --output ./myapp-lora/lora-adapter

# 4. Run the held-out eval
python tools/lora-pipeline/eval_lora.py --adapter ./myapp-lora/lora-adapter --output ./myapp-lora/eval-results.json

# 5. Serve via FastAPI on :8765
python tools/lora-pipeline/serve_lora.py --adapter ./myapp-lora/lora-adapter --port 8765
# OR convert to GGUF and load in Ollama
python tools/lora-pipeline/serve_lora.py --adapter ./myapp-lora/lora-adapter --gguf
```

Every script supports `--help` and `--dry-run`.

## Try it without a real brain

Sample data is included so you can see the full flow without installing anything heavy:

```bash
# Generate training data from bundled sample brain files
python tools/lora-pipeline/generate_training_data.py --sample --output ./demo

# Inspect the generated JSONL
cat ./demo/training-data.jsonl
```

The sample writes to `tools/lora-pipeline/sample_data/` and produces ~30 instruction triples so you can verify the format.

## Honest limitations

- **Small models forget less than they learn.** A 1.5B base will memorize conventions reliably but won't suddenly become a world-class coder.
- **Garbage in, garbage out.** If your brain is sparse (<200 entries), LoRA won't have enough signal — keep using the brain via RAG instead.
- **Eval is small (N=20).** Don't draw strong conclusions from a 5-point improvement — bigger eval sets matter for real validation.
- **Not a replacement for the brain.** LoRA encodes patterns at training time; the brain captures *new* learnings continuously. Run both.
- **Cost.** A single training run on a rental A10 GPU is ~$1-2 USD per project. CPU training is free but slow.

## Hyperparameter rationale

Defaults in `train_lora.py`:

| Param | Value | Why |
|---|---|---|
| `base_model` | `unsloth/Qwen2.5-Coder-1.5B-Instruct` | Small, code-tuned, instruction-following, Apache-2.0 |
| `lora_r` | 16 | Sweet spot — bigger overfits on <5k examples |
| `lora_alpha` | 32 | 2x rank — standard scaling rule |
| `learning_rate` | 2e-4 | Standard LoRA LR — higher than full-FT |
| `epochs` | 3 | More overfits the small dataset |
| `batch_size` | 4 | Fits 8GB GPU; grad-accum 4 for effective batch 16 |
| `max_seq_len` | 2048 | Enough for our triples + small code context |
| `target_modules` | `q_proj k_proj v_proj o_proj` | Attention-only LoRA is standard for code tasks |

## Files in this directory

```
tools/lora-pipeline/
  README.md                        this file
  generate_training_data.py        brain -> JSONL
  train_lora.py                    JSONL -> adapter
  eval_lora.py                     adapter + base + base+RAG comparison
  serve_lora.py                    Ollama Modelfile + FastAPI server
  sample_data/
    fake-brain-hierarchy.json      bundled sample brain memories
    fake-brain-global.json         bundled sample global brain
    fake-brain-causal.json         bundled sample causal links
    fake-training-data.jsonl       pre-generated demo output
```
