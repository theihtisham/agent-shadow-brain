# Viral Amplifier Bot — Ethics & Guardrails

The Viral Amplifier Bot is built to help projects grow **honestly**. It will never:

## Hard Guarantees

1. **Never run on private repos.** First job is a hard gate that exits if `repo.private == true`.
2. **Never auto-submit PRs to other repos.** All outbound contributions are manual. The bot only generates draft templates.
3. **Never auto-post to social media.** No Twitter API, no Discord webhook (user opted out). Only generates copy/paste templates for manual posting.
4. **Never DM strangers.** No off-platform contact, no email scraping, no LinkedIn DM automation.
5. **Never spam awesome lists.** Throttles to ≤1 PR/week, refuses to suggest before 100 stars, respects each list's CONTRIBUTING.md (which the user must read before submitting).
6. **Never multi-comment.** Welcome messages fire ONCE per user. No nag-back, no follow-up.
7. **Never inflate stats.** No fake stars, no view inflation, no buying engagement.
8. **Never violate platform TOS.** Hacker News, Reddit, npm, GitHub all have anti-automation rules. The bot only generates content for human posting.

## What the Bot Actually Does

| Job | Action | Outcome |
|---|---|---|
| `daily-stats` | Read public stargazer count + npm download count | Commits `docs/STATS.md` to your own repo |
| `milestone-check` | Compare current stars to `.milestone-state.json` | Generates LinkedIn post template + opens an issue in your own repo |
| `weekly-viral-report` | Diff 7-day stats, suggest actions | Opens a weekly issue with action suggestions |
| `awesome-list-targets` | List candidate awesome-* repos | Generates draft PR templates for **manual** review and submission |
| `welcome-new-issue` | Detect first-time issue authors | Posts ONE welcome comment per user |
| `welcome-new-pr` | Detect first-time PR authors | Posts ONE welcome comment per user |

## Why "Manual Approval" Matters

Awesome-list maintainers HATE bot PRs. They downrank submissions that look auto-generated, and they ban repeat offenders. The bot helps you craft a strong submission — but you must:

1. Read the target list's `CONTRIBUTING.md` and `README.md` before submitting
2. Adapt the entry text to match the list's existing style
3. Submit no more than 1 PR/week to awesome-* repos
4. Never resubmit a closed PR without addressing the maintainer's feedback

## Rate Limits Hard-Coded

- **Awesome-list PRs:** ≤1/week (script writes a `.last-awesome-pr` marker; user respects it)
- **Milestone alerts:** Each milestone fires only once (state in `.github/.milestone-state.json`)
- **Welcome comments:** First-time only per user (checked via `gh issue list --author USER`)
- **Weekly reports:** Open one issue per Sunday at most

## What the Bot Does NOT Do (and Why)

- ❌ **Auto-tweet milestones** — Twitter API is restrictive; user opted out anyway.
- ❌ **Auto-post to LinkedIn** — LinkedIn API for posting is locked behind partner status. Manual only.
- ❌ **Submit to Hacker News** — HN explicitly bans automated submissions. Submitting via API gets you banned.
- ❌ **Submit to Reddit** — Subreddits have wildly different rules; auto-submission is bannable.
- ❌ **Bulk-follow people** — looks spammy, gets your account flagged.
- ❌ **Comment on other repos** — no drive-by promotion.
- ❌ **Mass-email contributors** — no opt-in basis.

## How to Disable / Tune

To disable the entire bot:

```bash
gh workflow disable "Viral Amplifier Bot"
```

To disable a specific job, comment out its `if:` condition in `.github/workflows/viral-amplifier.yml`.

## Reporting Concerns

If the bot ever does something that violates these guarantees, open an issue with the label `bot-misbehavior` and tag @theihtisham. The bot will be paused until investigated.
