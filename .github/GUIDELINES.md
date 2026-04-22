# Viral Amplifier Bot — Guidelines & Compliance

The bot operates within the rules of every platform it touches. This document lists every guideline the bot honors and the specific mechanism that enforces compliance.

---

## 1. GitHub Acceptable Use Policy

[GitHub TOS](https://docs.github.com/en/site-policy/acceptable-use-policies)

| Rule | How the bot complies |
|---|---|
| No spam or unsolicited bulk content | Welcome comments fire ONCE per user; no repeated outreach |
| No automated account creation | Bot uses YOUR existing account via `GITHUB_TOKEN`; creates no new accounts |
| No misuse of GitHub's services | Reads public data only (stars, downloads, public READMEs) |
| Respect rate limits | Each script uses `gh api` which respects rate limits automatically |
| No scraping at high volume | Code search capped at 30 results per query |

## 2. GitHub Actions Limits

[Actions Limits](https://docs.github.com/en/actions/learn-github-actions/usage-limits-billing-and-administration)

| Limit | How the bot stays within it |
|---|---|
| 2000 free minutes/month for private repos | Bot only runs on PUBLIC repos (free unlimited minutes) |
| Workflow concurrency | Daily/weekly/monthly cron — never simultaneous heavy load |
| API rate limits (5000/hr authenticated) | All scripts use authenticated `gh api` calls |
| Storage limits | Bot writes only small markdown/JSON files to docs/ |

## 3. npm Terms of Service

[npm TOS](https://docs.npmjs.com/policies/terms)

| Rule | How the bot complies |
|---|---|
| No automated publish without consent | Bot NEVER publishes — only the human maintainer runs `npm publish` |
| Public download data is fair use | Bot uses official `api.npmjs.org/downloads/*` endpoints only |
| No name-squatting | Bot never registers package names |
| Truth in advertising | Generated marketing copy must be accurate (human reviews before posting) |

## 4. Awesome List Maintainer Guidelines

[Sindre Sorhus — Awesome Manifesto](https://github.com/sindresorhus/awesome/blob/main/awesome.md)

| Rule | How the bot complies |
|---|---|
| Don't submit immature/low-quality projects | Bot blocks suggestions if stars < 100 |
| One project, one PR | Bot generates one PR template at a time — no batch submissions |
| Check existing inclusion first | `inclusion-checker.mjs` searches before suggesting |
| Follow the list's CONTRIBUTING.md exactly | PR template tells user to read each list's rules first |
| No drive-by promotional PRs | Bot suggests; user manually crafts and submits each PR |
| Wait for response before bumping | Bot never auto-comments on submitted PRs |
| Cool-off between submissions | Bot enforces 1 PR/week max via `.last-awesome-pr` marker |

## 5. Hacker News Guidelines

[HN Guidelines](https://news.ycombinator.com/newsguidelines.html)

| Rule | How the bot complies |
|---|---|
| No automated submission | Bot does NOT submit to HN. Generates "Show HN" template for manual posting only |
| Don't ask for upvotes | Bot's HN template explicitly warns against this |
| Be substantive, not promotional | Template lead with problem, not features |
| One Show HN per launch | Bot doesn't track repeat submissions — user's responsibility |

## 6. Reddit Content Policy

[Reddit Policy](https://www.redditinc.com/policies/content-policy)

| Rule | How the bot complies |
|---|---|
| No spam, no vote manipulation | Bot generates draft posts only — manual posting required |
| Respect each subreddit's rules | Template includes "Read the subreddit rules first" reminder |
| 9:1 self-promotion ratio (informal) | Bot suggests 5 subreddits over 24h max — user spaces real activity |
| No cross-posting same content | Each subreddit gets a TAILORED template |

## 7. LinkedIn Professional Community Policies

[LinkedIn Policies](https://www.linkedin.com/legal/professional-community-policies)

| Rule | How the bot complies |
|---|---|
| Authentic content only | Templates match the user's voice; user reviews before posting |
| No automated posting via API | Bot does NOT use LinkedIn API; user manually copies/pastes |
| No mass connection requests | Bot doesn't manage LinkedIn connections |
| Disclose sponsored content | Templates don't include sponsored content (organic only) |

## 8. GDPR / Privacy

| Rule | How the bot complies |
|---|---|
| No personal data collection | Bot reads only public GitHub data |
| No tracking of stargazers beyond public list | Stargazer suggestions use the public `/stargazers` API only |
| No third-party data sharing | Bot doesn't send data anywhere except your own repo |
| Right to deletion | If you delete the repo, all bot-generated data goes with it |

## 9. General Open Source Etiquette

| Norm | How the bot complies |
|---|---|
| Don't pad commit history | Bot commits are infrequent (daily stats, weekly report) |
| Don't astroturf reviews | Bot generates honest stat reports — no inflation |
| Credit contributors | Bot's welcome messages explicitly thank contributors |
| Be transparent | This GUIDELINES.md and ETHICS.md document everything the bot does |
| No dark patterns | All suggestions go through user approval |

## 10. Internal Bot Guardrails

| Guardrail | Implementation |
|---|---|
| Never run on private repos | First job in workflow: `if: needs.guard.outputs.is_public == 'true'` |
| Throttle awesome-list PRs | `.last-awesome-pr` marker enforces 7-day cooldown |
| Never auto-DM | No DM API integrations exist in the bot |
| Never escalate without approval | All "next actions" appear as GitHub issues for human review |
| Quality gate before suggestions | `quality-scorecard.mjs` runs first — won't suggest awesome-list submission below 80% score |
| Emergency stop | `gh workflow disable "Viral Amplifier Bot"` instantly halts everything |

---

## What the Bot Will NEVER Do

- ❌ Submit a Hacker News post
- ❌ Post to Reddit, Twitter, LinkedIn, or any social media
- ❌ Send DMs or emails on your behalf
- ❌ Comment on issues/PRs in repos you don't own
- ❌ Buy followers, stars, or engagement
- ❌ Submit PRs to awesome lists without your manual review
- ❌ Run on private repos
- ❌ Bypass any platform rate limit
- ❌ Misrepresent project metrics
- ❌ Auto-merge anything

## How to Audit the Bot

Read the source — there's no obfuscation:
- [`.github/workflows/viral-amplifier.yml`](workflows/viral-amplifier.yml)
- [`.github/scripts/*.mjs`](scripts/)
- [`.github/ETHICS.md`](ETHICS.md)
- [`.github/GUIDELINES.md`](GUIDELINES.md) — this file

To audit GitHub Actions runs:
```bash
gh run list --workflow="Viral Amplifier Bot" --limit 20
```

## Reporting Violations

If you believe the bot violated any of these guidelines:

1. Open an issue with label `bot-misbehavior`
2. Include the workflow run URL
3. Tag @theihtisham

The bot will be paused immediately while investigated.
