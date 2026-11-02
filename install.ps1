# fc-counter を わんコメ に入れる（上書きコピー）
# 使い方: PowerShell で  .\install.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$oc = Join-Path $env:APPDATA 'onecomme'
if (-not (Test-Path $oc)) { throw "わんコメのフォルダが見つからない: $oc （わんコメを一度起動してから実行する）" }

$plugin = Join-Path $oc 'plugins\fc-counter'
$template = Join-Path $oc 'templates\custom\fc-counter'
New-Item -ItemType Directory -Force -Path $plugin, $template | Out-Null
Copy-Item -Force (Join-Path $root 'onecomme-plugin\fc-counter\*') $plugin
Copy-Item -Force (Join-Path $root 'onecomme-template\fc-counter\*') $template

Write-Host "プラグイン  -> $plugin"
Write-Host "テンプレート -> $template"
Write-Host "わんコメを再起動し、設定のプラグイン一覧で fc-counter を有効にする"
