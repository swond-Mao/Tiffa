# integrate-repo.ps1 - fold wide-recall into the Tiffa repo (idempotent)
# Usage: copy this file to the portable ROOT (e.g. G:\Tiffa), then:
#   powershell -ExecutionPolicy Bypass -File integrate-repo.ps1
$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
if (-not (Test-Path (Join-Path $Root 'data\agent\mcp.json.example'))) {
    throw "Put this script in the portable ROOT (next to install.bat) and run it again."
}
Set-Location $Root

# ── 1. patch mcp.json.example: add memory-wide entry ──
$examplePath = Join-Path $Root 'data\agent\mcp.json.example'
$Utf8 = New-Object System.Text.UTF8Encoding($false)
$cfg = [IO.File]::ReadAllText($examplePath, [Text.Encoding]::UTF8) | ConvertFrom-Json
if ($cfg.mcpServers.PSObject.Properties['memory-wide']) {
    Write-Host '[skip] mcp.json.example already has memory-wide'
} else {
    $entry = [pscustomobject]@{
        type = 'stdio'
        command = '{{PORTABLE_ROOT}}/npm-global/node_modules/bun/bin/bun.exe'
        args = @('{{PORTABLE_ROOT}}/data/agent/mcp-servers/wide-recall.ts')
        env = [pscustomobject]@{
            PI_CODING_AGENT_DIR = '{{PORTABLE_ROOT}}/data/agent'
            PORTABLE_ROOT = '{{PORTABLE_ROOT}}'
            HOME = '{{PORTABLE_ROOT}}/home'
        }
        enabled = $true
        timeout = 600000
    }
    $cfg.mcpServers | Add-Member -MemberType NoteProperty -Name 'memory-wide' -Value $entry
    [IO.File]::WriteAllText($examplePath, ($cfg | ConvertTo-Json -Depth 10) + "`n", $Utf8)
    Write-Host '[ok] mcp.json.example updated'
}

# ── 2. stage everything wide-recall touched ──
git add data/agent/mcp-servers/wide-recall.ts
git add data/agent/mcp.json.example
git add electron/main.ts electron/main.js
git add plugins/claude-mode-extension.ts
git add data/agent/rules/no-direct-mnemopi-inspection.md

# ── 3. commit ──
$staged = git diff --cached --name-only
if (-not $staged) {
    Write-Host '[skip] nothing new to commit'
} else {
    git commit -m 'feat: wide_recall cross-project semantic memory search (drive-letter self-heal)'
    Write-Host '[ok] committed:'
    git log --oneline -1
}

Write-Host ''
Write-Host '[done] fresh installs now ship with wide_recall built-in.'
Read-Host 'Press Enter to close'
