# LinkedIn Auto-Post — One-Time Setup Guide

This is a **one-time setup**. After completing it, the Viral Amplifier Bot can auto-post to your LinkedIn personal feed when you trigger it.

**Time required:** 15-20 minutes.

**You'll get:**
- Auto-posting to your LinkedIn personal feed
- Token refresh reminders before they expire
- Audit log of every post made

**You won't get** (LinkedIn API limitation):
- Auto-posting to groups (Groups API was deprecated in 2018)
- Auto-posting to company pages (different setup)
- Automatic follower DMs

---

## Step 1 — Create a LinkedIn Developer App

1. Go to https://www.linkedin.com/developers/apps
2. Click **Create app**
3. Fill in:
   - **App name:** `Shadow Brain Personal Bot` (or any name)
   - **LinkedIn Page:** any company page you control (required by LinkedIn even for personal apps — create a free company page if needed)
   - **Privacy policy URL:** any URL (your project's GitHub README works)
   - **App logo:** any image
4. Accept terms → **Create app**

## Step 2 — Request the `w_member_social` Scope

1. In your app, go to **Products** tab
2. Find **Share on LinkedIn** → click **Request access**
3. This is auto-approved (no waiting). It grants `w_member_social` scope which lets the app post to YOUR feed only.

## Step 3 — Set Up OAuth Redirect

1. In your app, go to **Auth** tab
2. Under **OAuth 2.0 settings**, add this redirect URL:
   ```
   https://oauth.pstmn.io/v1/callback
   ```
   (We'll use Postman for the one-time OAuth flow.)
3. Save.
4. Copy your **Client ID** and **Client Secret** — you'll need them in step 4.

## Step 4 — Get Your Access Token (One-Time OAuth)

You need to grant your app permission to post on your behalf. This is the OAuth flow.

### Easiest path: use the [LinkedIn OAuth Token Generator](https://www.linkedin.com/developers/tools/oauth)

1. Open https://www.linkedin.com/developers/tools/oauth
2. Select your app from the dropdown
3. Select scopes: check **`w_member_social`**
4. Click **Request access token**
5. Authorize when prompted
6. Copy the **access token** that appears (60-day expiry)

### Alternative: manual OAuth via curl

```bash
# 1. Get authorization code (open in browser, log in, copy the `code` param from redirect)
open "https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=YOUR_CLIENT_ID&redirect_uri=https://oauth.pstmn.io/v1/callback&scope=w_member_social"

# 2. Exchange code for access token
curl -X POST 'https://www.linkedin.com/oauth/v2/accessToken' \
  -d 'grant_type=authorization_code' \
  -d 'code=YOUR_CODE_FROM_BROWSER' \
  -d 'redirect_uri=https://oauth.pstmn.io/v1/callback' \
  -d 'client_id=YOUR_CLIENT_ID' \
  -d 'client_secret=YOUR_CLIENT_SECRET'
# Returns: {"access_token":"AQX...","expires_in":5184000}
```

## Step 5 — Get Your Member URN

```bash
curl -H "Authorization: Bearer YOUR_ACCESS_TOKEN" https://api.linkedin.com/v2/userinfo
# Returns: {"sub":"abc123def456",...}
```

Your URN is `urn:li:person:abc123def456` (use the `sub` value).

## Step 6 — Add Secrets to GitHub

Go to your repo on GitHub → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.

Add these two secrets:

| Name | Value |
|---|---|
| `LINKEDIN_ACCESS_TOKEN` | The token from Step 4 |
| `LINKEDIN_USER_URN` | `urn:li:person:YOUR_SUB_FROM_STEP_5` |

## Step 7 — Test Dry-Run

Before posting for real, do a dry-run:

```bash
DRY_RUN=1 \
LINKEDIN_ACCESS_TOKEN="AQX..." \
LINKEDIN_USER_URN="urn:li:person:abc123" \
node .github/scripts/linkedin-auto-post.mjs
```

This validates everything WITHOUT posting. You should see:

```
🔍 DRY RUN — would post to LinkedIn:
---
[your content here]
---
Length: XXX chars
Hash:   abc123...
```

## Step 8 — First Real Post

Trigger the workflow:

1. GitHub → Actions → **Viral Amplifier Bot** → **Run workflow**
2. Select job: `linkedin-auto-post`
3. Run

The bot will read content from `docs/launch/LINKEDIN_NEXT_POST.md` (which you can edit before triggering) and post it to your feed.

You'll see the post URL in the workflow logs and saved to `docs/launch/LINKEDIN_POST_HISTORY.md`.

## Step 9 — Token Refresh (every 60 days)

LinkedIn access tokens expire after 60 days. The bot will fail with a 401 when this happens.

**To refresh:** repeat Step 4 to get a new token, then update the `LINKEDIN_ACCESS_TOKEN` secret on GitHub.

The Viral Amplifier Bot will open a GitHub issue 7 days before expiry as a reminder (TODO: implement this).

---

## Anti-Spam Guardrails (already in the script)

The bot enforces these limits to protect your account:

- **Max 1 post per 72 hours** (LinkedIn flags rapid posters)
- **Refuses duplicates** (SHA1-checks last 5 posts)
- **No posts during 23:00-06:00 your local time** (looks bot-like)
- **Min 200 chars** (low-effort posts hurt your reputation)

If you need to override (for a milestone, big launch), edit `.github/scripts/linkedin-auto-post.mjs` MIN_HOURS_BETWEEN constant. But honestly, 1 post every 3 days is the sweet spot.

## What the Bot Won't Do

- ❌ **Won't post to LinkedIn Groups** — API is dead. Use `linkedin-groups-helper.mjs` for the manual one-click share workflow.
- ❌ **Won't message your connections** — no DM API access in this bot.
- ❌ **Won't auto-comment on others' posts** — only posts to YOUR feed.
- ❌ **Won't follow random people** — no follow API in this bot.
- ❌ **Won't change your profile** — read-only on profile data.

## Compliance

- Uses the official LinkedIn UGC Posts API (`/v2/ugcPosts`)
- `w_member_social` scope is the standard scope for personal posting
- Posts only YOUR content to YOUR feed (not impersonation)
- Rate limits + duplicate detection prevent spam violations
- All posts logged to `docs/launch/LINKEDIN_POST_HISTORY.md` for audit

LinkedIn's [Professional Community Policies](https://www.linkedin.com/legal/professional-community-policies) explicitly allow use of their API for legitimate sharing. The script enforces "legitimate" via the guardrails above.

## Troubleshooting

**`401 Unauthorized`** → Token expired. Repeat Step 4.

**`403 Forbidden`** → Token doesn't have `w_member_social` scope. Repeat Step 2 → Step 4.

**`429 Too Many Requests`** → LinkedIn rate-limited you. The 72h cooldown will prevent further posts; wait it out.

**`422 Unprocessable Entity`** → Content failed LinkedIn validation. Most common: post >3000 chars, or URN format wrong.

**Post doesn't appear** → Check https://www.linkedin.com/in/YOUR-PROFILE/recent-activity/. May take up to 30 seconds. If still not there, check workflow logs for the post URN and visit `https://www.linkedin.com/feed/update/THE_URN/` directly.
