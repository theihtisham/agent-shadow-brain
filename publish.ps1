# publish.ps1 - one-click npm publish for @theihtisham/agent-shadow-brain
#
# Usage (from PowerShell, in the project root):
#   powershell -ExecutionPolicy Bypass -File .\publish.ps1

$ErrorActionPreference = 'Stop'

# Move to project root
$here = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
Set-Location $here

# Read package.json
$pkgJson = Get-Content package.json -Raw | ConvertFrom-Json
$name = $pkgJson.name
$version = $pkgJson.version

Write-Host ""
Write-Host "===========================================================" -ForegroundColor Cyan
Write-Host "  Publish $name@$version to npm" -ForegroundColor Cyan
Write-Host "===========================================================" -ForegroundColor Cyan
Write-Host ""

# Step 1 - login check
Write-Host "[1/6] Checking npm login..." -ForegroundColor Cyan
$who = $null
try { $who = (npm whoami 2>$null).Trim() } catch {}

if (-not $who) {
  Write-Host "  Not logged in. Opening browser..." -ForegroundColor Yellow
  Write-Host "  (If 2FA is on, keep your authenticator app ready.)" -ForegroundColor Yellow
  Write-Host ""
  npm login
  if ($LASTEXITCODE -ne 0) {
    Write-Host "  Login failed." -ForegroundColor Red
    exit 1
  }
  $who = (npm whoami).Trim()
}
Write-Host "  OK - logged in as: $who" -ForegroundColor Green

if ($who -ne 'theihtisham') {
  Write-Host ""
  Write-Host "  Warning: logged in as '$who', not 'theihtisham'." -ForegroundColor Yellow
  $continue = Read-Host "  Continue anyway? (yes/no)"
  if ($continue -ne 'yes') {
    Write-Host "  Aborted." -ForegroundColor Red
    exit
  }
}

# Step 2 - check live version
Write-Host ""
Write-Host "[2/6] Checking what's already live on npm..." -ForegroundColor Cyan
$livever = $null
try { $livever = (npm view $name version 2>$null).Trim() } catch {}

if ($livever) {
  Write-Host "  Currently live on npm: $livever" -ForegroundColor Yellow
  if ($livever -eq $version) {
    Write-Host ""
    Write-Host "  Version $version is ALREADY published." -ForegroundColor Red
    Write-Host "  You cannot publish over an existing version." -ForegroundColor Red
    Write-Host ""
    Write-Host "  Options:" -ForegroundColor Yellow
    Write-Host "    patch = bump to next patch (e.g. 6.0.1)" -ForegroundColor Gray
    Write-Host "    minor = bump to next minor (e.g. 6.1.0)" -ForegroundColor Gray
    Write-Host "    major = bump to next major (e.g. 7.0.0)" -ForegroundColor Gray
    Write-Host ""
    $bump = Read-Host "  Bump type (patch/minor/major) or 'abort'"
    if ($bump -eq 'patch' -or $bump -eq 'minor' -or $bump -eq 'major') {
      npm version $bump --no-git-tag-version
      $pkgJson = Get-Content package.json -Raw | ConvertFrom-Json
      $version = $pkgJson.version
      Write-Host "  OK - bumped to $version" -ForegroundColor Green
    } else {
      Write-Host "  Aborted." -ForegroundColor Red
      exit
    }
  } else {
    Write-Host "  OK - local $version is newer than $livever, will publish." -ForegroundColor Green
  }
} else {
  Write-Host "  No existing version found (first publish or npm hiccup)." -ForegroundColor Yellow
}

# Step 3 - build
Write-Host ""
Write-Host "[3/6] Building..." -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) {
  Write-Host "  Build failed." -ForegroundColor Red
  exit 1
}
if (-not (Test-Path "dist\cli.js") -or -not (Test-Path "dist\index.js")) {
  Write-Host "  Missing dist/cli.js or dist/index.js after build." -ForegroundColor Red
  exit 1
}
Write-Host "  OK - dist/cli.js + dist/index.js both present" -ForegroundColor Green

# Step 4 - tests
Write-Host ""
Write-Host "[4/6] Running tests..." -ForegroundColor Cyan
npm test
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "  Tests failed - aborting publish." -ForegroundColor Red
  Write-Host "  Fix failing tests and re-run this script." -ForegroundColor Red
  exit 1
}
Write-Host "  OK - all tests passed" -ForegroundColor Green

# Step 5 - dry run
Write-Host ""
Write-Host "[5/6] Dry-run publish (nothing uploaded yet)..." -ForegroundColor Cyan
npm publish --dry-run --access public
if ($LASTEXITCODE -ne 0) {
  Write-Host "  Dry-run failed." -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "  -----------------------------------------------------------" -ForegroundColor Yellow
Write-Host "   Review the file list above. Should NOT include:" -ForegroundColor Yellow
Write-Host "     - node_modules/" -ForegroundColor Gray
Write-Host "     - .env / .env.* / *.key / credentials*" -ForegroundColor Gray
Write-Host "     - tests/, tools/, src/ (should be dist-only)" -ForegroundColor Gray
Write-Host "   SHOULD include:" -ForegroundColor Yellow
Write-Host "     - dist/**/*" -ForegroundColor Gray
Write-Host "     - README.md, LICENSE, package.json" -ForegroundColor Gray
Write-Host "  -----------------------------------------------------------" -ForegroundColor Yellow
Write-Host ""

$confirm = Read-Host "Publish $name@$version to npm for real? Type 'yes' to continue"
if ($confirm -ne 'yes') {
  Write-Host "Aborted. Nothing uploaded." -ForegroundColor Red
  exit
}

# Step 6 - real publish
Write-Host ""
Write-Host "[6/6] Publishing for real..." -ForegroundColor Cyan
npm publish --access public
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "  Publish failed." -ForegroundColor Red
  Write-Host "  Common causes:" -ForegroundColor Yellow
  Write-Host "    - 2FA required: re-run with OTP ready" -ForegroundColor Gray
  Write-Host "    - Version already exists: bump version and retry" -ForegroundColor Gray
  Write-Host "    - Not logged in as owner: run 'npm whoami'" -ForegroundColor Gray
  exit 1
}

# Verify
Write-Host ""
Write-Host "Verifying publish..." -ForegroundColor Cyan
Start-Sleep -Seconds 3
$ver = $null
try { $ver = (npm view $name version 2>$null).Trim() } catch {}

Write-Host ""
if ($ver -eq $version) {
  Write-Host "===========================================================" -ForegroundColor Green
  Write-Host "  SHIPPED - $name@$version" -ForegroundColor Green
  Write-Host "  https://www.npmjs.com/package/$name" -ForegroundColor Green
  Write-Host "===========================================================" -ForegroundColor Green
  Write-Host ""
  Write-Host "Test the install on a clean shell:" -ForegroundColor Cyan
  Write-Host "  npx $name@latest attach-all" -ForegroundColor Gray
  Write-Host ""
  Write-Host "Next steps:" -ForegroundColor Cyan
  Write-Host "  1. Create GitHub Release v$version and attach the video" -ForegroundColor Gray
  Write-Host "  2. Follow docs/launch/LAUNCH_CHECKLIST.md" -ForegroundColor Gray
  Write-Host ""
} else {
  Write-Host "  Publish returned success but npm view shows: $ver" -ForegroundColor Yellow
  Write-Host "  (npm CDN can take 30-60s to propagate - check in a minute.)" -ForegroundColor Yellow
  Write-Host "  Check manually: https://www.npmjs.com/package/$name" -ForegroundColor Yellow
}
