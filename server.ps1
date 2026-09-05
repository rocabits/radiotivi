$root = $PSScriptRoot
$port = 8083
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()
Write-Host "Servidor en http://localhost:$port"
$mime = @{
  ".html" = "text/html; charset=utf-8"
  ".css" = "text/css"
  ".js" = "application/javascript"
  ".json" = "application/json"
  ".png" = "image/png"
  ".svg" = "image/svg+xml"
  ".ico" = "image/x-icon"
  ".webmanifest" = "application/manifest+json"
}
while ($true) {
  $ctx = $listener.GetContext()
  $req = $ctx.Request
  $res = $ctx.Response
  $path = $req.Url.AbsolutePath.TrimStart("/").Replace("/", "\")
  if ($path -eq "") { $path = "index.html" }
  $file = Join-Path $root $path
  if (Test-Path $file -PathType Leaf) {
    $ext = [System.IO.Path]::GetExtension($file).ToLower()
    $res.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { "application/octet-stream" }
    $bytes = [System.IO.File]::ReadAllBytes($file)
    $res.ContentLength64 = $bytes.Length
    $res.OutputStream.Write($bytes, 0, $bytes.Length)
  } else {
    $res.StatusCode = 404
    $msg = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
    $res.OutputStream.Write($msg, 0, $msg.Length)
  }
  $res.Close()
}
$listener.Stop()