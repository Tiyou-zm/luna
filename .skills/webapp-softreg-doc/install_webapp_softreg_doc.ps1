$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

if ($env:CODEX_HOME -and $env:CODEX_HOME.Trim()) {
    $codexHome = $env:CODEX_HOME
} else {
    $codexHome = Join-Path $env:USERPROFILE ".codex"
}

$skillsDir = Join-Path $codexHome "skills"
$targetDir = Join-Path $skillsDir "webapp-softreg-doc"
$requirements = Join-Path $scriptDir "requirements.txt"
$sourcePath = (Resolve-Path $scriptDir).Path
$targetPath = [System.IO.Path]::GetFullPath($targetDir)

New-Item -ItemType Directory -Force -Path $skillsDir | Out-Null

if ($sourcePath -ne $targetPath) {
    if (Test-Path $targetDir) {
        Remove-Item -Recurse -Force $targetDir
    }

    Copy-Item -Recurse -Force $scriptDir $targetDir
}

if (Get-Command python -ErrorAction SilentlyContinue) {
    python -m pip install -r $requirements
} elseif (Get-Command py -ErrorAction SilentlyContinue) {
    py -m pip install -r $requirements
} else {
    throw "Python not found. Install Python 3.10 or newer first."
}

Write-Host ""
Write-Host "Installation completed."
Write-Host "Skill path: $targetDir"
Write-Host ""
Write-Host "Use this in Codex:"
Write-Host "用 `$webapp-softreg-doc 审阅这个网页并生成软著说明书"
