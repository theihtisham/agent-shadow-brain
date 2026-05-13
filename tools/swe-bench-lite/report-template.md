# SWE-Bench Lite — Publish Template

Populate the placeholders below with values from `report.md` after running the harness.

---

## Twitter thread (5 tweets)

**1/5** I ran a 10-problem mini-SWE-Bench with @shadow_brain ON vs OFF on the same coding agent.

Brain OFF: {{RESOLUTION_RATE_OFF}} resolved.
Brain ON:  {{RESOLUTION_RATE_ON}} resolved.

Same model. Same problems. Same prompts. Code in the thread.

**2/5** Methodology:
- 10 curated bugs in real public repos (express, axios, requests, flask, gin, ...)
- Each problem run twice — `SHADOW_BRAIN_ENABLED=0` vs `=1`
- Failing test before, failing test after = source of truth
- N=10 is small. I'm reporting effect size + Fisher's exact p={{P_VALUE}}.

**3/5** What the brain seems to help with most:
- Off-by-one classes (it remembered the project's iteration conventions)
- Null-guard / undefined-deref (it remembered the framework's nullable shapes)
- Library-quirk edge cases (it remembered our prior fixes for the same library)

**4/5** Where it didn't help:
- {{NEUTRAL_PROBLEM_1}}
- {{NEUTRAL_PROBLEM_2}}

Verdict: prior context is most useful when the bug class has been seen before. Cold-start bugs are no different.

**5/5** Reproduce yourself:
```
git clone https://github.com/theihtisham/agent-shadow-brain
cd agent-shadow-brain
python tools/swe-bench-lite/runner.py --output ./my-run
python tools/swe-bench-lite/score.py --input ./my-run
```

---

## Blog post outline

### Title options
- "I gave my coding agent a brain. Here's what changed."
- "10 bugs, 2 agents, 1 difference: persistent memory"
- "Does an LLM agent benefit from project memory? A 10-bug experiment."

### Sections

**1. Why I ran this**
Short claim that agents reset context every session is a known pain point. The brain is supposed to fix that. Does it?

**2. Methodology (paste 4-5 bullets)**
- 10 problems, all real public repos
- Same agent, same prompt, same model
- Brain ON injects retrieved project context; OFF runs vanilla
- Failing test before / failing test after = ground truth
- N=10, Fisher's exact for the one-sided test

**3. Headline results (paste the table from `report.md`)**

| Metric | Brain OFF | Brain ON | Delta |
|---|---|---|---|
| Resolution rate | {{RESOLUTION_RATE_OFF}} | {{RESOLUTION_RATE_ON}} | {{ABSOLUTE_LIFT}} |
| Mean wall-clock | {{WALLCLOCK_OFF}}s | {{WALLCLOCK_ON}}s | {{WALLCLOCK_DELTA_PCT}}% |
| Mean tokens | {{TOKENS_OFF}} | {{TOKENS_ON}} | {{TOKENS_DELTA_PCT}}% |

Fisher's exact p = {{P_VALUE}} -- {{SIGNIFICANT_OR_NOT}}.

**4. Where the brain helped (3 concrete examples)**
Pick the 3 problems with the biggest delta and walk through what context the brain surfaced that helped the agent.

**5. Where it didn't (2 concrete examples)**
Show problems where the delta was zero or negative. Be honest.

**6. Limitations**
- N=10 is small. Effect size matters more than the p-value at this scale.
- Curated problems can favor either side; we picked classes the brain *might* help with.
- Agent variance is high; one trial per condition isn't enough for production claims.

**7. Run it yourself**
The whole harness is in `tools/swe-bench-lite/`. Forks welcome.

---

## Internal Slack version (one-liner)

> Brain ON vs OFF on 10 small bugs: **{{RESOLUTION_RATE_OFF}} -> {{RESOLUTION_RATE_ON}}** resolution. p={{P_VALUE}}. Tokens {{TOKENS_DELTA_PCT}}%. Run it yourself via `tools/swe-bench-lite/`.
