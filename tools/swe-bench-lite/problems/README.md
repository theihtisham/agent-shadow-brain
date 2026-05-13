# Problem Set Documentation

Each problem is a JSON file with this schema:

```json
{
  "id":              "01-express-path-off-by-one",
  "title":           "Short human-readable title",
  "repo_url":        "https://github.com/...",
  "base_commit":     "abc1234",
  "language":        "javascript|typescript|python|go",
  "setup":           ["npm install"],
  "failing_test":    "npx mocha test/path.test.js",
  "expected_fix_hint": "Short hint about what needs to change (used by mock agent + scoring sanity check)",
  "success_criteria": "string the test runner must output for success",
  "agent_prompt":    "Initial prompt given to the coding agent",
  "wall_clock_budget_s": 300,
  "source":          "Upstream issue URL or note",
  "complexity":      "trivial|small|medium"
}
```

## Honest provenance

These 10 problems are **inspired by real bug classes** that have appeared in these projects. We have NOT pinned each to a specific upstream issue — that would require maintaining live SHA references that drift. Instead each problem is:

1. A small, plausible bug in a real public repo
2. Reproducible by checking out the listed `base_commit`
3. Sized so a competent agent can fix it in <5 minutes

If you want strict SWE-Bench-style fidelity, point `runner.py` at the official SWE-Bench dataset — the schemas are compatible.

## Adding your own problems

Drop a new `NN-*.json` file in this directory. The runner discovers all `*.json` files automatically.
