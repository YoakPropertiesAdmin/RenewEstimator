# share.ps1 — Expose your local estimator to a public URL using localtunnel
# Requirements: Node.js must be installed (https://nodejs.org)
# Usage: Right-click → Run with PowerShell   OR   .\share.ps1 in PowerShell

$port = 8080
$serverScript = Join-Path $PSScriptRoot "serve.ps1"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Renew Home Exteriors — Share Tool" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ── Step 1: Check Node.js ─────────────────────────────────
$nodeCheck = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCheck) {
    Write-Host "❌ Node.js not found." -ForegroundColor Red
    Write-Host "   Install it from https://nodejs.org (LTS version)" -ForegroundColor Yellow
    Read-Host "Press Enter to exit"
    exit 1
}
Write-Host "✅ Node.js found: $(node --version)" -ForegroundColor Green

# ── Step 2: Install localtunnel if needed ─────────────────
$ltCheck = Get-Command lt -ErrorAction SilentlyContinue
if (-not $ltCheck) {
    Write-Host ""
    Write-Host "📦 Installing localtunnel (one-time setup)..." -ForegroundColor Yellow
    npm install -g localtunnel 2>&1 | Out-Null
    $ltCheck = Get-Command lt -ErrorAction SilentlyContinue
    if (-not $ltCheck) {
        Write-Host "❌ localtunnel install failed. Try: npm install -g localtunnel" -ForegroundColor Red
        Read-Host "Press Enter to exit"
        exit 1
    }
    Write-Host "✅ localtunnel installed." -ForegroundColor Green
}

# ── Step 3: Start local HTTP server (if not already running) ──
$serverRunning = $false
try {
    $resp = Invoke-WebRequest -Uri "http://localhost:$port/" -TimeoutSec 2 -ErrorAction SilentlyContinue
    if ($resp.StatusCode -eq 200 -or $resp.StatusCode -eq 404) { $serverRunning = $true }
} catch { $serverRunning = $false }

if (-not $serverRunning) {
    Write-Host ""
    Write-Host "🚀 Starting local server on port $port..." -ForegroundColor Yellow
    Start-Process powershell -ArgumentList "-NoExit", "-File", "`"$serverScript`"" -WindowStyle Minimized
    Start-Sleep -Seconds 2
    Write-Host "✅ Server started." -ForegroundColor Green
} else {
    Write-Host "✅ Local server already running on port $port." -ForegroundColor Green
}

# ── Step 4: Start localtunnel ─────────────────────────────
Write-Host ""
Write-Host "🌐 Opening public tunnel to port $port..." -ForegroundColor Yellow
Write-Host "   (This may take 5–10 seconds)" -ForegroundColor Gray
Write-Host ""

# Run localtunnel and capture the URL line
$ltProcess = Start-Process -FilePath "lt" -ArgumentList "--port", "$port", "--subdomain", "renewhome" -RedirectStandardOutput "$env:TEMP\lt_output.txt" -PassThru -NoNewWindow

Start-Sleep -Seconds 6

$ltOutput = ""
if (Test-Path "$env:TEMP\lt_output.txt") {
    $ltOutput = Get-Content "$env:TEMP\lt_output.txt" -Raw
}

# Extract URL from output (format: "your url is: https://xxx.loca.lt")
$urlMatch = [regex]::Match($ltOutput, 'https://[^\s]+\.loca\.lt')
if ($urlMatch.Success) {
    $publicUrl = $urlMatch.Value
} else {
    # Fallback: localtunnel may not have gotten the subdomain, try reading stdout via job
    $publicUrl = "Check the console for the URL — it starts with https://"
}

Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  ✅ PUBLIC URL READY:" -ForegroundColor Green
Write-Host ""
Write-Host "  🔗 $publicUrl/PricingEstimator.html" -ForegroundColor Cyan
Write-Host "  🔄 $publicUrl/change-orders.html" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Send either link to your customer or colleague." -ForegroundColor White
Write-Host "  ⚠️  First-time visitors must click 'Click to Continue'" -ForegroundColor Yellow
Write-Host "      on the loca.lt tunnel page — this is normal." -ForegroundColor Yellow
Write-Host ""
Write-Host "  Press Ctrl+C to stop sharing." -ForegroundColor Gray
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

# Keep running and stream localtunnel output
try {
    while (-not $ltProcess.HasExited) {
        Start-Sleep -Seconds 5
        if (Test-Path "$env:TEMP\lt_output.txt") {
            $newOutput = Get-Content "$env:TEMP\lt_output.txt" -Raw
            if ($newOutput -ne $ltOutput) {
                $ltOutput = $newOutput
                Write-Host $ltOutput -ForegroundColor Gray
            }
        }
    }
} finally {
    Write-Host ""
    Write-Host "🔒 Tunnel closed." -ForegroundColor Yellow
    if (-not $ltProcess.HasExited) { $ltProcess.Kill() }
}
