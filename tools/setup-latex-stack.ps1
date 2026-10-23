<#
.SYNOPSIS
  一键配置 dsh-latex-studio 所需的全套本地 LaTeX 编译与排版环境（Windows）。

.DESCRIPTION
  本脚本实现全自动化、一次性配齐全套工具链：
    1. MiKTeX 编译器核心（pdflatex / xelatex / lualatex / bibtex / biber / makeindex）
    2. 本地页图渲染后端（Poppler pdftoppm / pdfinfo + Ghostscript mgs.exe）
    3. Strawberry Perl（激活 latexmk 的 .fls 依赖追踪与增量编译加速）
    4. 开启 MiKTeX 宏包全自动静默安装（[MPM]AutoInstall=1，编译时缺宏包自动补齐，免弹窗打扰）
    5. 源码静态语法分析器（chktex）
    6. 自动补全系统与用户环境变量 PATH
    7. 执行健康体检（doctor.mjs）验证就绪状态

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools\setup-latex-stack.ps1
#>

[CmdletBinding()]
param(
  [switch]$SkipPerl,
  [switch]$SkipChktex,
  [switch]$NonInteractive
)

$ErrorActionPreference = "Continue"

function Say-Step($msg) {
  Write-Host "`n==> $msg" -ForegroundColor Cyan
}

function Say-Ok($msg) {
  Write-Host "  [OK] $msg" -ForegroundColor Green
}

function Say-Warn($msg) {
  Write-Host "  [!!] $msg" -ForegroundColor Yellow
}

function Say-Info($msg) {
  Write-Host "  [..] $msg" -ForegroundColor Gray
}

# ---------------------------------------------------------------------------
# 0. 基础环境探测
# ---------------------------------------------------------------------------
Say-Step "0. 检查 Windows 包管理环境 (winget)"

$winget = Get-Command winget.exe -ErrorAction SilentlyContinue
if (-not $winget) {
  Say-Warn "未检测到 winget。请确保 Windows 10/11 已启用“应用安装程序”（可在应用商店安装 App Installer）。"
} else {
  Say-Ok "winget 可用: $($winget.Source)"
}

# ---------------------------------------------------------------------------
# 1. MiKTeX 核心引擎与页图后端
# ---------------------------------------------------------------------------
Say-Step "1. 检查 / 安装 MiKTeX (核心 TeX 引擎 + Poppler + Ghostscript)"

$pdflatex = Get-Command pdflatex.exe -ErrorAction SilentlyContinue
$candidates = @(
  "D:\MiKTeX\miktex\bin\x64",
  "$env:LOCALAPPDATA\Programs\MiKTeX\miktex\bin\x64",
  "C:\Program Files\MiKTeX\miktex\bin\x64",
  "C:\Program Files (x86)\MiKTeX\miktex\bin\x64"
)

$foundDir = $null
foreach ($dir in $candidates) {
  if (Test-Path (Join-Path $dir "pdflatex.exe")) {
    $foundDir = $dir
    break
  }
}

if ($pdflatex -or $foundDir) {
  Say-Ok "MiKTeX 已经安装就绪。"
  if ($foundDir -and ($env:PATH -notlike "*$foundDir*")) {
    $env:PATH = "$foundDir;$env:PATH"
    Say-Info "已将 MiKTeX bin 目录临时载入当前会话: $foundDir"
  }
} else {
  if (-not $winget) {
    Say-Warn "未找到 MiKTeX，且缺少 winget，请手动前往 https://miktex.org/download 下载安装。"
  } else {
    Say-Info "正在通过 winget 安装 MiKTeX（包含 pdflatex, xelatex, biber, pdftoppm, mgs）..."
    & winget install --id MiKTeX.MiKTeX -e --accept-source-agreements --accept-package-agreements
    # 重新探测
    foreach ($dir in $candidates) {
      if (Test-Path (Join-Path $dir "pdflatex.exe")) {
        $foundDir = $dir
        $env:PATH = "$foundDir;$env:PATH"
        break
      }
    }
    if ($foundDir) {
      Say-Ok "MiKTeX 安装完成并载入环境。"
    } else {
      Say-Warn "MiKTeX 安装可能需要重启终端或系统以生效。"
    }
  }
}

# ---------------------------------------------------------------------------
# 2. 配置 MiKTeX 自动静默安装宏包 (AutoInstall)
# ---------------------------------------------------------------------------
Say-Step "2. 配置 MiKTeX 宏包全自动静默下载 (免弹窗中断)"

$initexmf = Get-Command initexmf.exe -ErrorAction SilentlyContinue
if (-not $initexmf -and $foundDir) {
  $initexmfPath = Join-Path $foundDir "initexmf.exe"
  if (Test-Path $initexmfPath) { $initexmf = Get-Item $initexmfPath }
}

if ($initexmf) {
  try {
    & $initexmf --set-config-value [MPM]AutoInstall=1 2>$null
    Say-Ok "已成功开启 [MPM]AutoInstall=1：编译中遇到缺失的 LaTeX 宏包将全自动静默下载。"
  } catch {
    Say-Warn "设置 AutoInstall 遇到异常，MiKTeX 编译时仍会附带 --enable-installer。"
  }
} else {
  Say-Info "未定位到 initexmf.exe，插件将在编译时通过 --enable-installer 参数兜底补包。"
}

# ---------------------------------------------------------------------------
# 3. Strawberry Perl (让 latexmk 满血运行)
# ---------------------------------------------------------------------------
if (-not $SkipPerl) {
  Say-Step "3. 检查 / 安装 Strawberry Perl (激活 latexmk 依赖追踪加速)"

  $perl = Get-Command perl.exe -ErrorAction SilentlyContinue
  $gitPerl = "C:\Program Files\Git\usr\bin\perl.exe"
  $strawPerl = "C:\Strawberry\perl\bin\perl.exe"

  if ($perl) {
    Say-Ok "Perl 环境就绪: $($perl.Source)"
  } elseif (Test-Path $strawPerl) {
    $env:PATH = "C:\Strawberry\perl\bin;$env:PATH"
    Say-Ok "检测到 Strawberry Perl 并载入环境: $strawPerl"
  } elseif (Test-Path $gitPerl) {
    $env:PATH = "C:\Program Files\Git\usr\bin;$env:PATH"
    Say-Ok "检测到 Git 内置 Perl 并载入环境: $gitPerl"
  } else {
    if ($winget) {
      Say-Info "正在通过 winget 安装 Strawberry Perl..."
      & winget install --id StrawberryPerl.StrawberryPerl -e --accept-source-agreements --accept-package-agreements
      if (Test-Path $strawPerl) {
        $env:PATH = "C:\Strawberry\perl\bin;$env:PATH"
        Say-Ok "Strawberry Perl 安装完成并载入环境。"
      } else {
        Say-Info "Strawberry Perl 安装完成，将在新会话中生效。"
      }
    } else {
      Say-Info "跳过 Perl 自动安装。无需担心，插件已内置多趟编译驱动，不依赖 Perl 亦可正常编译。"
    }
  }
}

# ---------------------------------------------------------------------------
# 4. chktex 静态检查工具
# ---------------------------------------------------------------------------
if (-not $SkipChktex) {
  Say-Step "4. 检查 / 安装 chktex 静态检查工具"

  $chktex = Get-Command chktex.exe -ErrorAction SilentlyContinue
  if (-not $chktex -and $foundDir) {
    if (Test-Path (Join-Path $foundDir "chktex.exe")) {
      $chktex = Get-Item (Join-Path $foundDir "chktex.exe")
    } elseif (Test-Path (Join-Path $foundDir "miktex-chktex.exe")) {
      $chktex = Get-Item (Join-Path $foundDir "miktex-chktex.exe")
    }
  }

  if ($chktex) {
    Say-Ok "chktex 可用: $($chktex.Name)"
  } else {
    $mpm = Get-Command mpm.exe -ErrorAction SilentlyContinue
    if (-not $mpm -and $foundDir) {
      $mpmPath = Join-Path $foundDir "mpm.exe"
      if (Test-Path $mpmPath) { $mpm = Get-Item $mpmPath }
    }
    if ($mpm) {
      Say-Info "正在通过 MiKTeX 包管理器 (mpm) 安装 chktex..."
      & $mpm --install=chktex 2>$null
      Say-Ok "chktex 安装指令已执行。"
    } else {
      Say-Info "chktex 为可选工具，未安装不影响核心编译和视觉排版流程。"
    }
  }
}

# ---------------------------------------------------------------------------
# 5. 永久写入用户 PATH（若尚未包含）
# ---------------------------------------------------------------------------
Say-Step "5. 检查并持久化系统环境变量 PATH"

if ($foundDir) {
  $userPath = [Environment]::GetEnvironmentVariable("PATH", "User")
  if ($userPath -notlike "*$foundDir*") {
    try {
      [Environment]::SetEnvironmentVariable("PATH", "$foundDir;$userPath", "User")
      Say-Ok "已将 MiKTeX 目录写入用户级 PATH: $foundDir"
    } catch {
      Say-Warn "写入用户级 PATH 失败，您可以在系统设置中手动添加该目录。"
    }
  } else {
    Say-Ok "用户级 PATH 已包含 MiKTeX 路径。"
  }
}

# ---------------------------------------------------------------------------
# 6. 执行整体健康自检 (doctor.mjs)
# ---------------------------------------------------------------------------
Say-Step "6. 运行插件健康自检 (tools/doctor.mjs)"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$doctorPath = Join-Path $scriptDir "doctor.mjs"
if (Test-Path $doctorPath) {
  & node $doctorPath
} else {
  Say-Info "doctor.mjs 检查跳过。"
}

Write-Host "`n========================================================" -ForegroundColor Green
Write-Host " 🎉 LaTeX 全套编译与排版环境配置流程已完成！" -ForegroundColor Green
Write-Host " 若您刚才新装了 MiKTeX 或 Perl，请完全重启 DSH 桌面端以加载新环境。" -ForegroundColor Green
Write-Host "========================================================`n" -ForegroundColor Green
