# Simple HTTP server for PricingEstimator — run from the Pricingestimator folder
$port = 3000
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()

Write-Host ""
Write-Host "✅ Serving at http://localhost:$port/PricingEstimator.html" -ForegroundColor Green
Write-Host "   Press Ctrl+C to stop." -ForegroundColor Gray
Write-Host ""

$mimeTypes = @{
    ".html" = "text/html"
    ".css"  = "text/css"
    ".js"   = "application/javascript"
    ".json" = "application/json"
    ".png"  = "image/png"
    ".jpg"  = "image/jpeg"
    ".svg"  = "image/svg+xml"
    ".ico"  = "image/x-icon"
    ".pdf"  = "application/pdf"
}

while ($listener.IsListening) {
    try {
        $context  = $listener.GetContext()
        $req      = $context.Request
        $resp     = $context.Response

        $localPath = $req.Url.LocalPath.TrimStart('/')
        if ($localPath -eq '' -or $localPath -eq '/') { $localPath = 'PricingEstimator.html' }

        $filePath = Join-Path $root $localPath

        if (Test-Path $filePath -PathType Leaf) {
            $ext  = [System.IO.Path]::GetExtension($filePath).ToLower()
            $mime = if ($mimeTypes.ContainsKey($ext)) { $mimeTypes[$ext] } else { "application/octet-stream" }
            $bytes = [System.IO.File]::ReadAllBytes($filePath)
            $resp.ContentType   = $mime
            $resp.ContentLength64 = $bytes.Length
            $resp.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $resp.StatusCode = 404
            $msg  = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
            $resp.OutputStream.Write($msg, 0, $msg.Length)
        }

        $resp.Close()
    } catch [System.Net.HttpListenerException] {
        break
    }
}

$listener.Stop()
