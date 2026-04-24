# publish.ps1 — one-click npm publish for @theihtisham/agent-shadow-brain
#
# Usage (from PowerShell, in the project root):
#   powershell -ExecutionPolicy Bypass -File .\publish.ps1
#
# What it does:
#   1. cd to project root
#   2. Verify npm login (triggers browser login if not)
#   3. Build the package (tsc → dist/)
#   4. Run full test suite
#   5. Dry-run publish (shows what would upload, uploads nothing)
#   6. Prompt for confirmation
#   7. Real publish
#   8. Verify new version live on npm

$ErrorActionPreference = 'Stop'

# ── Move to project root ────────────────────────────────────────────────
$PSScriptRoot_ = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
Set-Location $PSScriptRoot_

# ── Header ──────────────────────────────────────────────────────────────
$pkgJson = Get-Content package.json -Raw | ConvertFrom-Json
$name = $pkgJson.name
$version = $pkgJson.version

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  Publish $name@$version to npm" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# ── Step 1 — login check ────────────────────────────────────────────────
Write-Host "→ Step 1/6: Checking npm login..." -ForegroundColor Cyan
$who = $null
try { $who = (npm whoami 2>$null).Trim() } catch {}

if (-not $who) {
  Write-Host "  Not logged in. Opening browser..." -ForegroundColor Yellow
  Write-Host "  (If 2FA is on, keep your authenticator app ready.)" -ForegroundColor Yellow
  Write-Host ""
  npm login
  if ($LASTEXITCODE -ne 0) { Write-Host "  Login failed." -ForegroundColor Red; exit 1 }
  $who = (npm whoami).Trim()
}
Write-Host "  ✓ Logged in as: $who" -ForegroundColor Green

if ($who -ne 'theihtisham') {
  Write-Host ""
  Write-Host "  ! Warning: logged in as '$who', not 'theihtisham'." -ForegroundColor Yellow
  $continue = Read-Host "  Continue anyway? (yes/no)"
  if ($continue -ne 'yes') { Write-Host "  Aborted." -ForegroundColor Red; exit }
}

# ── Step 2 — ensure we're on the right version ──────────────────────────
Write-Host ""
Write-Host "→ Step 2/6: Checking what's already live on npm..." -ForegroundColor Cyan
$livever = $null
try { $livever = (npm view $name version 2>$null).Trim() } catch {}

if ($livever) {
  Write-Host "  Currently live: $livever" -ForegroundColor Yellow
  if ($livever -eq $version) {
    Write-Host ""
    Write-Host "  ✗ Version $version is ALREADY published." -ForegroundColor Red
    Write-Host "    You cannot publish over an existing version." -ForegroundColor Red
    Write-Host ""
    Write-Host "  Options:" -ForegroundColor Yellow
    Write-Host "    1. Bump to 6.0.1: npm version patch --no-git-tag-version" -ForegroundColor Gray
    Write-Host "    2. Bump to 6.1.0: npm version minor --no-git-tag-version" -ForegroundColor Gray
    Write-Host "    3. Bump to 7.0.0: npm version major --no-git-tag-version" -ForegroundColor Gray
    Write-Host ""
    $bump = Read-Host "  Bump type (patch/minor/major) or 'abort'"
    if ($bump -eq 'patch' -or $bump -eq 'minor' -or $bump -eq 'major') {
      npm version $bump --no-git-tag-version
      $pkgJson = Get-Content package.json -Raw | ConvertFrom-Json
      $version = $pkgJson.version
      Write-Host "  ✓ Bumped to $version" -ForegroundColor Green
    } else {
      Write-Host "  Aborted." -ForegroundColor Red; exit
    }
  } else {
    Write-Host "  ✓ Local $version is newer — will publish." -ForegroundColor Green
  }
} else {
  Write-Host "  No existing version found (first publish or temporary npm glitch)." -ForegroundColor Yellow
}

# ── Step 3 — build ──────────────────────────────────────────────────────
Write-Host ""
Write-Host "→ Step 3/6: Building..." -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { Write-Host "  Build failed." -ForegroundColor Red; exit 1 }
if (-not (Test-Path "dist\cli.js") -or -not (Test-Path "dist\index.js")) {
  Write-Host "  ✗ dist/cli.js or dist/index.js missing after build." -ForegroundColor Red
  exit 1
}
Write-Host "  ✓ Build clean (dist/cli.js + dist/index.js exist)" -ForegroundColor Green

# ── Step 4 — tests ──────────────────────────────────────────────────────
Write-Host ""
Write-Host "→ Step 4/6: Running tests..." -ForegroundColor Cyan
npm test
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "  ✗ Tests failed — aborting publish." -ForegroundColor Red
  Write-Host "    Fix failing tests then re-run this script." -ForegroundColor Red
  exit 1
}
Write-Host "  ✓ All tests passed" -ForegroundColor Green

# ── Step 5 — dry run ────────────────────────────────────────────────────
Write-Host ""
Write-Host "→ Step 5/6: Dry-run publish (nothing uploaded yet)..." -ForegroundColor Cyan
npm publish --dry-run --access public
if ($LASTEXITCODE -ne 0) { Write-Host "  Dry-run failed." -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Yellow
Write-Host "   Review the file list above. Should NOT include:" -ForegroundColor Yellow
Write-Host "     • node_modules/" -ForegroundColor Gray
Write-Host "     • .env / .env.* / *.key / credentials*" -ForegroundColor Gray
Write-Host "     • docs/launch/*.mp4 or screenshots (should be files-whitelisted)" -ForegroundColor Gray
Write-Host "     • tests/, tools/, src/ (should be dist-only)" -ForegroundColor Gray
Write-Host "   SHOULD include:" -ForegroundColor Yellow
Write-Host "     • dist/**/*" -ForegroundColor Gray
Write-Host "     • README.md, LICENSE, package.json" -ForegroundColor Gray
Write-Host "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Yellow
Write-Host ""

$confirm = Read-Host "Publish $name@$version to npm for real? Type 'yes' to continue"
if ($confirm -ne 'yes') { Write-Host "Aborted. Nothing was uploaded." -ForegroundColor Red; exit }

# ── Step 6 — real publish ───────────────────────────────────────────────
Write-Host ""
Write-Host "→ Step 6/6: Publishing for real..." -ForegroundColor Cyan
npm publish --access public
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "  ✗ Publish failed." -ForegroundColor Red
  Write-Host "    Common causes:" -ForegroundColor Yellow
  Write-Host "      • 2FA required: re-run with OTP ready" -ForegroundColor Gray
  Write-Host "      • Version already exists: bump version and retry" -ForegroundColor Gray
  Write-Host "      • Not logged in as owner: npm whoami" -ForegroundColor Gray
  exit 1
}

# ── Verification ────────────────────────────────────────────────────────
Write-Host ""
Write-Host "→ Verifying..." -ForegroundColor Cyan
Start-Sleep -Seconds 3
$ver = (npm view $name version 2>$null).Trim()

if ($ver -eq $version) {
  Write-Host ""
  Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Green
  Write-Host "  ✓ SHIPPED — $name@$version" -ForegroundColor Green
  Write-Host "  → https://www.npmjs.com/package/$name" -ForegroundColor Green
  Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Green
  Write-Host ""
  Write-Host "Test the install on a clean machine/shell:" -ForegroundColor Cyan
  Write-Host "  npx $name@latest attach-all" -ForegroundColor Gray
  Write-Host ""
  Write-Host "Next steps:" -ForegroundColor Cyan
  Write-Host "  1. Create GitHub Release v$version with the video attached" -ForegroundColor Gray
  Write-Host "  2. Run through docs/launch/LAUNCH_CHECKLIST.md" -ForegroundColor Gray
  Write-Host ""
} else {
  Write-Host ""
  Write-Host "  ! Publish returned success but npm view shows: $ver" -ForegroundColor Yellow
  Write-Host "    (This sometimes takes 30-60 seconds for npm's CDN to propagate.)" -ForegroundColor Yellow
  Write-Host "    Check: https://www.npmjs.com/package/$name" -ForegroundColor Yellow
}
