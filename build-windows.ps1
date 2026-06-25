# ============================================================
# OpenChamber 中文版 — 一键 Windows 客户端构建脚本
# ============================================================
# 用法: .\build-windows.ps1
# 输出: packages\electron\dist\OpenChamber-*-win-x64.exe (NSIS 安装包)
# ============================================================

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  OpenChamber 中文版 — Windows 客户端构建" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# ---------- 1. 检查 Node.js ----------
Write-Host "[1/6] 检查 Node.js..." -ForegroundColor Yellow
try {
    $nodeVersion = node --version 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $nodeVersion) {
        throw "Node.js 未安装"
    }
    Write-Host "  ✓ Node.js $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "  ✗ 未找到 Node.js！请安装 Node.js 22+ https://nodejs.org" -ForegroundColor Red
    exit 1
}

# ---------- 2. 检查 Bun ----------
Write-Host "[2/6] 检查 Bun..." -ForegroundColor Yellow
$bunInstalled = $false
try {
    $bunVersion = bun --version 2>$null
    if ($LASTEXITCODE -eq 0 -and $bunVersion) {
        Write-Host "  ✓ Bun $bunVersion" -ForegroundColor Green
        $bunInstalled = $true
    }
} catch {}

if (-not $bunInstalled) {
    Write-Host "  ! Bun 未安装，正在通过 PowerShell 安装..." -ForegroundColor Yellow
    powershell -c "irm bun.sh/install.ps1 | iex"
    # Refresh PATH
    $env:PATH = "$env:USERPROFILE\.bun\bin;$env:PATH"
    try {
        $bunVersion = bun --version 2>$null
        Write-Host "  ✓ Bun $bunVersion 安装完成" -ForegroundColor Green
    } catch {
        Write-Host "  ✗ Bun 安装失败！请手动安装: https://bun.sh" -ForegroundColor Red
        exit 1
    }
}

# ---------- 3. 安装依赖 ----------
Write-Host "[3/6] 安装项目依赖..." -ForegroundColor Yellow
bun install
if ($LASTEXITCODE -ne 0) {
    Write-Host "  ✗ 依赖安装失败！" -ForegroundColor Red
    exit 1
}
Write-Host "  ✓ 依赖安装完成" -ForegroundColor Green

# ---------- 4. 构建 Web UI ----------
Write-Host "[4/6] 构建 Web UI..." -ForegroundColor Yellow
Push-Location "$ScriptDir\packages\electron"
bun run build:web-assets
if ($LASTEXITCODE -ne 0) {
    Pop-Location
    Write-Host "  ✗ Web UI 构建失败！" -ForegroundColor Red
    exit 1
}
Pop-Location
Write-Host "  ✓ Web UI 构建完成" -ForegroundColor Green

# ---------- 5. 打包 Electron ----------
Write-Host "[5/6] 打包 Electron 应用..." -ForegroundColor Yellow
Push-Location "$ScriptDir\packages\electron"
bun run bundle:main
if ($LASTEXITCODE -ne 0) {
    Pop-Location
    Write-Host "  ✗ Electron 主进程打包失败！" -ForegroundColor Red
    exit 1
}

bun run rebuild:native
if ($LASTEXITCODE -ne 0) {
    Write-Host "  ! 原生模块重编译警告（可能不影响运行）" -ForegroundColor Yellow
}

# ---------- 6. 生成 Windows 安装包 ----------
Write-Host "[6/6] 生成 Windows NSIS 安装包..." -ForegroundColor Yellow
# Windows 专用：只构建 win 目标，跳过 macOS 签名
node ./scripts/package.mjs --win
if ($LASTEXITCODE -ne 0) {
    Pop-Location
    Write-Host "  ✗ 安装包生成失败！" -ForegroundColor Red
    exit 1
}
Pop-Location

# ---------- 完成 ----------
Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  构建完成！" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
$distDir = "$ScriptDir\packages\electron\dist"
if (Test-Path $distDir) {
    Write-Host "  输出文件:" -ForegroundColor White
    Get-ChildItem $distDir -Filter "*.exe" | ForEach-Object {
        Write-Host "    $($_.FullName)" -ForegroundColor Green
    }
    Get-ChildItem $distDir -Filter "*.yml" | ForEach-Object {
        Write-Host "    $($_.FullName)" -ForegroundColor Green
    }
}
Write-Host ""
Write-Host "  安装包可直接分发给 Windows 用户使用。" -ForegroundColor White
