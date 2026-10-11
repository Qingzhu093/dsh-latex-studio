# P0 环境探针报告（T3 · env-lab）

> ⚠️ **历史文档（采集于 2026-10-10）——结论可能已过期。**
> 已确认过期的一条：**latexmk 现在可用**。本机装有 Git for Windows 自带的 Perl（`D:\Git\usr\bin\perl.exe`，5.38.2），`latexmk 4.88` 正常执行；0.2.0 起插件**可用即优先 latexmk**，不可用时才回落内置多趟驱动。
> 因此下面 §B 的「latexmk 不可用 / 禁止依赖 latexmk」是**当时**的结论，已被取代；其余探针结论（Poppler/Ghostscript 随 MiKTeX、`read_pdf` 的 page 视图失败）仍然有效。

> 采集窗口：2026-10-10 21:17 – 21:41（Asia/Shanghai），采集者：teammate `env-lab`。
> **状态声明**：21:40:45 起用户开始对本机 MiKTeX 做「统一更新」。按用户与 Lead 的指令，此后**已停止一切 MiKTeX 调用**
> （pdflatex / xelatex / mpm / initexmf / pdftoppm / mgs 等一律不再执行）。因此本报告所有输出均为**更新开始前**采集；
> 标注为「未验证/待复跑」的条目必须在 MiKTeX 更新完成后重跑，不要当作已验证结论引用。

## 结论摘要

| # | 事项 | 结论 | 证据 |
|---|---|---|---|
| A | MiKTeX 引擎与版本 | 可用；**引擎不在 DSH 进程 PATH 上，必须用绝对路径探测** | §A.1 |
| A | `--enable-installer` 自动补包 | **未验证成功**：实测未自动安装；当时包数据库被 `miktex-console.exe` 独占锁定，且用户正在做全局更新 —— 待复跑 | §A.2 |
| B | latexmk | **确认不可用**（缺 Perl）；禁止依赖 | §B |
| C | Poppler | **可用，来自 MiKTeX 自带**（`pdftoppm` 24.04.0）；无需另装 | §C |
| D | Ghostscript | 可用，MiKTeX 自带 `mgs.exe` 9.25 | §D |
| E | `read_pdf({view:'page'})`（MinerU 页图） | **失败**：`PDF.js returned invalid page metadata` | §E |
| F | 桌面端 CLI `plugin --profile <p> add <tgz>` | **可用**（真实安装了 dummy tgz，exit 0） | §F |
| G | 环境变更告警 | 21:40:45 起 MiKTeX 进入更新中间态：**所有 MiKTeX 启动器 0xC0000135 启动失败**，仅自包含的 `mgs.exe` 仍可用 | §G |

**视觉通道最终口径（更新完成前）**：`poppler`（首选）→ `miktex-ghostscript` → `mineru-page`（本机失败）。
前两条都是本地、零上传、零额外安装。

---

## A. MiKTeX 引擎与 `--enable-installer`

### A.1 引擎可用性（更新前采集）

命令（工作目录 = `D:\Documents\deepseek harness\DSH插件管理`）：

```powershell
& 'D:\MiKTeX\miktex\bin\x64\pdflatex.exe' --version
& 'D:\MiKTeX\miktex\bin\x64\xelatex.exe'  --version
& 'D:\MiKTeX\miktex\bin\x64\biber.exe'    --version
& 'D:\MiKTeX\miktex\bin\x64\mpm.exe'      --version
```

原始输出（节选）：

```
MiKTeX-pdfTeX 4.23 (MiKTeX 25.12)
© 1982 D. E. Knuth, © 1996-2025 Hàn Thế Thành
using bzip2 version 1.0.8, 13-Jul-2019
compiled with curl version 8.4.0; using libcurl/8.4.0 Schannel

MiKTeX-XeTeX 4.16 (MiKTeX 25.12)
© 1994-2008 SIL International, © 2009-2023 Jonathan Kew ...

biber version: 2.21

MiKTeX Package Manager 4.5 (MiKTeX 25.12)
```

**关键事实：引擎不在 DSH 进程的 PATH 上。** 在同一 pwsh 进程中：

```powershell
foreach ($e in 'pdflatex','xelatex','lualatex','biber','bibtex','makeindex','mpm','initexmf','miktex-chktex','latexmk','perl') {
  $c = Get-Command $e -ErrorAction SilentlyContinue
  if ($c) { Write-Output ("$e -> " + $c.Source) } else { Write-Output ("$e -> NOT FOUND") }
}
$env:PATH
```

原始输出（节选）：

```
pdflatex -> NOT FOUND
xelatex -> NOT FOUND
lualatex -> NOT FOUND
biber -> NOT FOUND
bibtex -> NOT FOUND
makeindex -> NOT FOUND
mpm -> NOT FOUND
initexmf -> NOT FOUND
miktex-chktex -> NOT FOUND
latexmk -> NOT FOUND
perl -> NOT FOUND

C:\Program Files\Common Files\Oracle\Java\javapath;...;D:\Git\cmd;D:\MATLAB\R2025b\bin;...;D:\scoop_all\scoop\shims;...
（PATH 中不含 D:\MiKTeX\miktex\bin\x64）
```

**对实现的要求**：`resolveTool(name, extraDirs)` 必须显式探测
`D:\MiKTeX\miktex\bin\x64` → `%LOCALAPPDATA%\Programs\MiKTeX\miktex\bin\x64` → 注册表 `InstallLocation`，
不能只依赖 `PATH` 或 `Get-Command`。`tools/verify-pdf-read.mjs` 已按此实现（`knownBinDirs()`）。

### A.2 `--enable-installer` 自动补包：**未验证成功（待复跑）**

构造缺包场景的步骤（确实找到了「mpm DB 中存在但本机未安装」的包）：

```powershell
# 1) 导出包数据库到文件
& 'D:\MiKTeX\miktex\bin\x64\mpm.exe' --list   # -> tools/_p0/mpm-list.txt（9037 行）
# 2) 统计已安装包
(Get-Content tools/_p0/mpm-list.txt | Where-Object { $_ -match '^true ' }).Count   # -> 210
# 3) 在 false 且体积较小的候选中逐个用 kpsewhich 判定文件是否真的缺失
#    -> tools/_p0/missing-candidates.txt（18 个真缺失，含 algorithms）
& 'D:\MiKTeX\miktex\bin\x64\kpsewhich.exe' algorithms.sty
```

原始输出：

```
210
（mpm-list.txt 中：false 7 386261 algorithms）

C:\...> & kpsewhich.exe algorithms.sty
exit=1 out=kpsewhich: major issue: So far, you have not checked for MiKTeX updates.
（即 algorithms.sty 确实不存在）
```

真编译验证（`tools/_p0/installer-test/probe2.tex`，内容 `\documentclass{article}\usepackage{algorithms}\begin{document}...`）：

```powershell
Push-Location '...\dsh-latex-studio\tools\_p0\installer-test'
& 'D:\MiKTeX\miktex\bin\x64\pdflatex.exe' --enable-installer --interaction=nonstopmode --halt-on-error probe2.tex
Pop-Location
```

原始输出（节选；完整见 `tools/_p0/installer-test/installer-probe.log` 与 `probe2.log`）：

```
pdflatex exit=1
This is pdfTeX, Version 3.141592653-2.6-1.40.28 (MiKTeX 25.12) (preloaded format=pdflatex.fmt)
...
! LaTeX Error: File `algorithms.sty' not found.

Type X to quit or <RETURN> to proceed,
or enter new name. (Default extension: sty)

Enter file name:
! Emergency stop.
*** (cannot \read from terminal in nonstop modes)
!  ==> Fatal error occurred, no output PDF file produced!
```

**结论：本次实测 `--enable-installer` 没有触发自动安装，编译以 fatal error 结束。** 未出现任何下载/安装尝试记录。

根因证据链（两条，均为更新开始前采集）：

1. 包数据库被独占锁定：

```powershell
Get-Process | Where-Object { $_.Path -like 'D:\MiKTeX\*' }
Get-ChildItem 'D:\MiKTeX\miktex\lock'
& 'D:\MiKTeX\miktex\bin\x64\mpm.exe' --install=algorithms
```

```
   Id ProcessName       StartTime           Path
35032 miktex-console    2026/10/10 20:17:38 D:\MiKTeX\miktex\bin\x64\miktex-console.exe

D:\MiKTeX\miktex\lock\package-manager.lock

mpm --install=algorithms exit=0
Warning: --install: this option has been deprecated; it will be removed from a future version of MiKTeX
Sorry, but: The package database is locked and cannot be accessed.
Another MiKTeX program has exclusevily locked the package database.      <- MiKTeX 原文拼写
Remedy: Close running MiKTeX programs and try again.
（log: C:\Users\wangy\AppData\Local\MiKTeX\miktex\log\miktex.log
  2026-10-10 21:40:37,687+0800 FATAL miktex.core - The package database is locked and cannot be accessed.)
```

2. `AutoInstall` 本身是开启的，问题不在配置：

```powershell
reg query 'HKCU\Software\MiKTeX.org\MiKTeX\2.9\MPM'
reg query 'HKCU\Software\MiKTeX.org\MiKTeX\2.9\Core'
```

```
HKEY_CURRENT_USER\Software\MiKTeX.org\MiKTeX\2.9\MPM
    AutoInstall    REG_SZ    1
HKEY_CURRENT_USER\Software\MiKTeX.org\MiKTeX\2.9\Core
    UserInstall    REG_SZ    D:\MiKTeX
    SharedSetup    REG_SZ    0          （用户级安装，无需管理员）
```

3. 另一条可疑线索（仅记录，不作为结论）：`api.miktex.org` 不可达（`curl -I` → 000），而
`mirrors.ctan.org` 307 / `ctan.org` 200 可达。MiKTeX 的按需安装走 MiKTeX Online API（注册表里有 `AuthToken`）。

> **待复跑（MiKTeX 更新完成后）**：
> ```powershell
> # 1) 关闭 MiKTeX Console（不要与更新进程并发）
> & 'D:\MiKTeX\miktex\bin\x64\pdflatex.exe' --enable-installer --interaction=nonstopmode --halt-on-error probe2.tex
> & 'D:\MiKTeX\miktex\bin\x64\kpsewhich.exe' algorithms.sty
> ```
> 三种可能结果：①自动装好（`kpsewhich` 有输出、退出码 0）；②仍 fatal（则 `--enable-installer` 在本机不可依赖）；
> ③报网络/服务错误。**在复跑前，`compile.js` 不得假设自动补包可用。**

---

## B. `latexmk` 不可用（缺 Perl）

命令：

```powershell
& 'D:\MiKTeX\miktex\bin\x64\latexmk.exe' --version
Get-Command perl -ErrorAction SilentlyContinue
```

原始输出（stderr 原文）：

```
Sorry, but latexmk.exe did not succeed for the following reason:
  MiKTeX could not find the script engine 'perl' which is required to execute 'latexmk'.
Remedy:
  Make sure 'perl' is installed on your system.

（Get-Command perl -> 无输出；perl found=False）
```

**结论**：`D:\MiKTeX\miktex\bin\x64\latexmk.exe` 文件存在，但没有 Perl 就无法执行。
**禁止依赖 latexmk**，必须自研多趟编译驱动（与 INTERFACES.md §0 一致）。

---

## C. Poppler：**MiKTeX 自带，本地可用**（首选页图后端）

命令与原始输出：

```powershell
Test-Path 'D:\MiKTeX\miktex\bin\x64\pdftoppm.exe'    # True
Test-Path 'D:\MiKTeX\miktex\bin\x64\pdfinfo.exe'     # True
& 'D:\MiKTeX\miktex\bin\x64\pdftoppm.exe' -v
& 'D:\MiKTeX\miktex\bin\x64\pdfinfo.exe'  'latex-demo\main.pdf'
```

```
pdftoppm version 24.04.0
Copyright 2005-2024 The Poppler Developers - http://poppler.freedesktop.org
Copyright 1996-2011 Glyph & Cog, LLC

Creator:         tectonic
Producer:        xdvipdfmx (0.1)
Pages:           2
Encrypted:       no
```

真实渲染第 1 页（工作目录含空格与中文，参数用参数数组传递）：

```powershell
$out = Join-Path $env:TEMP 'envlab-p1'; New-Item -ItemType Directory -Force -Path $out | Out-Null
& 'D:\MiKTeX\miktex\bin\x64\pdftoppm.exe' -f 1 -l 1 -r 120 -png -singlefile -- 'latex-demo\main.pdf' (Join-Path $out 'p1')
```

```
pdftoppm render exit=0
C:\Users\wangy\AppData\Local\Temp\envlab-p1\p1.png
70798          （字节；1020x1320 @120dpi）
```

**注意**：Windows 下必须带 `--` 分隔符，否则 I/O Error（与 Lead 的通知一致）。

关于「另行下载 Poppler」的探查（结论：不需要）：

```powershell
D:\scoop_all\scoop\apps\poppler\25.12.0-0        # 存在但为空目录（0 个文件）
D:\scoop_all\scoop\cache                          # 无 poppler 压缩包
Invoke-RestMethod 'https://api.github.com/repos/oschwartz10612/poppler-windows/releases/latest'
Invoke-WebRequest  'https://github.com/oschwartz10612/poppler-windows/releases/download/v26.09.0-0/Release-26.09.0-0.zip'
curl -I https://github.com
```

```
tag=v26.09.0-0
ASSET: Release-26.09.0-0.zip | 41.69 MB | https://github.com/oschwartz10612/poppler-windows/releases/download/v26.09.0-0/Release-26.09.0-0.zip
DOWNLOAD FAIL after 21.1s: 无法连接到远程服务器
https://github.com                            -> 000
https://objects.githubusercontent.com         -> 404
https://raw.githubusercontent.com             -> 000
https://api.github.com                        -> 200（可达）
https://ghproxy.net                           -> 200（镜像可用，但已无必要）
https://ghfast.top                            -> 200
```

**结论**：Poppler 的最终落点是 **`D:\MiKTeX\miktex\bin\x64\pdftoppm.exe` / `pdfinfo.exe`（MiKTeX 25.12 自带）**；
仓库内 `dsh-latex-studio/tools/poppler/` 仅作为**可选**备用落点保留（无需下载，未下载成功也不影响）。

---

## D. Ghostscript：MiKTeX 自带 `mgs.exe`（第二页图后端）

```powershell
Test-Path 'D:\MiKTeX\miktex\bin\x64\mgs.exe'                        # True
& 'D:\MiKTeX\miktex\bin\x64\mgs.exe' --version                     # 9.25
& 'D:\MiKTeX\miktex\bin\x64\mgs.exe' -dNOPAUSE -dBATCH -dSAFER -sDEVICE=png16m -r120 `
    -dFirstPage=1 -dLastPage=1 "-sOutputFile=$out" 'latex-demo\main.pdf'
Get-Item $out | Select-Object -ExpandProperty Length
```

原始输出：

```
True
9.25

MiKTeX GPL Ghostscript 9.25 (2018-09-13)
Copyright (C) 2018 Artifex Software, Inc.  All rights reserved.
This software comes with NO WARRANTY: see the file PUBLIC for details.
mgs exit=0
png bytes=18454          （1020x1320 @120dpi）
```

**渲染陷阱（供 render.js 参考）**：把 `mgs` 的输出管道接到 `Select-Object -First N`（提前关闭管道）会让进程被
终止、且**不产出 PNG**（实测 exit=-1）。必须让其完整跑完（`tools/verify-pdf-read.mjs` 用 Node `spawn` 全量收集 stdio，正常）。

---

## E. `read_pdf({view:'page'})`：本机失败

复现命令（DSH 工具层，等价于 `read_pdf` 工具入参）：

```js
read_pdf({ file_path: 'D:\\Documents\\deepseek harness\\DSH插件管理\\latex-demo\\main.pdf', view: 'page', pages: 1 })
```

原始错误：

```
read_pdf FAILED: PDF.js returned invalid page metadata
```

补充：`view:'page'` 只接受 `file_path|attachment_id`、`pages`、`expected_sha256`；传入 `poll_timeout_ms` 会被拒绝：

```
read_pdf FAILED: page view accepts only one source (file_path or attachment_id), pages, and optional expected_sha256
```

**结论**：MinerU 页图通道在本机不可用，只能作为 `rendererOrder` 的最后一档（并需 DSH 注入 `callReadPdf`）。

---

## F. 桌面端 CLI：`plugin --profile <name> add <tgz>` 可用

命令与原始输出：

```powershell
$dsh = 'D:\DshDesktop\resources\runtime\cli\bin\dsh.cmd'
Test-Path $dsh                       # True
& $dsh --version                     # 0.2.0-rc.2
& $dsh plugin --profile desktop list
& $dsh plugin --profile desktop add --help
```

```
dsh.cmd exists: True
0.2.0-rc.2        （exit=0）

Legend: production dependency, optional only, dev only
dsh-profile-desktop C:\Users\wangy\.dsh\profiles\desktop (PRIVATE)
│   dependencies:
├── @klarkxy/dsh-dev-index@0.1.7
└── dsh-pdf-mineru@0.2.0
2 packages        （exit=0）

Usage: pnpm add <name>
       pnpm add <tarball file>
       pnpm add <tarball url>
...
（`plugin` 子命令透传 pnpm；未指定 --profile 时报 `error: required option '--profile <name>' not specified`）
```

**真实安装测试**（为避免污染用户 profile，用一个一次性 scratch profile；测试后**已删除**，desktop profile 未改动）：

```powershell
# 构造 dummy 包（无依赖，212 字节 tgz）
npm pack --silent                                     # -> dsh-envlab-probe-1.0.0.tgz
& $dsh plugin --profile envlab-p0 add <tgz 绝对路径>
& $dsh plugin --profile envlab-p0 list
Remove-Item -Recurse -Force 'C:\Users\wangy\.dsh\profiles\envlab-p0'
```

```
Progress: resolved 0, reused 0, downloaded 1, added 0
dependencies:
+ dsh-envlab-probe file:D:/Documents/deepseek harness/DSH插件管理/.../dsh-envlab-probe-1.0.0.tgz
Progress: resolved 1, reused 0, downloaded 1, added 1, done
Done in 433ms using pnpm v11.7.0
add exit=0

dsh-profile-envlab-p0 C:\Users\wangy\.dsh\profiles\envlab-p0 (PRIVATE)
└── dsh-envlab-probe@1.0.0
1 package
list exit=0

dsh: warning: dsh-envlab-probe declares no dsh.bundle — installed as a plain dependency, not a profile layer
（scratch profile 删除后：profiles 目录仅剩 desktop / latexverify / node_modules / web）
```

**结论**：安装通道可用。⚠️ 插件包**必须**声明 `dsh.bundle` 才会成为 profile layer；
`dsh-latex-studio/package.json` 已声明 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`，符合要求。
（Lead 另用 `latexverify` profile 完成了完整链路验证：`--dump-config` 出现 `latex-studio` → import 成功 → mock `apply()` 产出 9 个工具。）

---

## G. 环境变更告警：MiKTeX 更新中间态（21:40:45 起）

更新开始（用户侧统一更新）后，本机 MiKTeX 处于**不一致的中间状态**，实测：

```powershell
foreach ($e in 'miktex.exe','mpm.exe','initexmf.exe','pdflatex.exe','pdftoppm.exe','mgs.exe','latexmk.exe') {
  $o = & (Join-Path 'D:\MiKTeX\miktex\bin\x64' $e) --version 2>&1
  Write-Output ($e + " exit=" + $LASTEXITCODE)
}
```

```
miktex.exe    exit=-1073741515      （0xC0000135 STATUS_DLL_NOT_FOUND）
mpm.exe       exit=-1073741515
initexmf.exe  exit=-1073741515
pdflatex.exe  exit=-1073741515
pdftoppm.exe  exit=-1073741515
mgs.exe       exit=0                （自包含，不受影响）
latexmk.exe   exit=-1073741515
```

文件层面的原因（PE 导入表解析 + 目录清单对比）：

```
bin 目录 DLL 版本戳统计：{ "251200": 52 个, "260500": 2 个 }
MiKTeX260500-bzip2.dll   ctime=2026-10-10T13:40:45Z（= 本地 21:40:45）
MiKTeX260500-cairo.dll   ctime=2026-10-10T13:40:46Z
被引用但缺失：MiKTeX251200-bzip2.dll（<- MiKTeX251200-core.dll）、MiKTeX251200-cairo.dll（<- pdftocairo.exe 等）
被引用但缺失：MiKTeX260500-core.dll / -util.dll / -app.dll 等（<- miktex-console.exe / arctrl.exe / cjklatex.exe 等）
```

即：更新过程**只替换了部分 DLL 的文件名版本戳**，两套启动器各自缺 DLL，导致除 `mgs.exe` 外的所有
MiKTeX 可执行文件都无法启动。这也解释了 §A.2 中 `miktex-console.exe`（PID 35032，20:17:38 启动）在
21:40 之后消失、`package-manager.lock` 变为空目录。

**对插件实现的硬性要求**：`compile.js` / `render.js` / `env.js` 必须把「引擎无法启动」当作一等公民处理——
子进程非零退出（含 `0xC0000135` / `-1073741515`）→ 返回 `status:'failed'`（或引擎完全探测不到时 `'skipped'`）+ `advice`，
**绝不抛异常**（与 INTERFACES.md §13 一致）。

**待复跑**：MiKTeX 更新完成后，重跑

```powershell
& 'D:\MiKTeX\miktex\bin\x64\pdflatex.exe' --version
& 'D:\MiKTeX\miktex\bin\x64\pdftoppm.exe' -v
node tools/verify-pdf-read.mjs        # 期望：poppler OK / miktex-ghostscript OK / mineru-page SKIP
```

---

## H. `tools/verify-pdf-read.mjs`（本次交付）

功能：对给定 PDF **逐个后端**试渲染第 1 页，报告可用后端（供 `latex_doctor --verify-pdf-read` 调用；
也可 `import { verifyPdfRead } from './verify-pdf-read.mjs'`，`callReadPdf` 由 tools 层注入）。

命令（工作目录 = `dsh-latex-studio/`）与原始输出（**更新前采集**，2026-10-10 21:31）：

```powershell
node tools/verify-pdf-read.mjs
```

```
PDF: D:\Documents\deepseek harness\DSH插件管理\latex-demo\main.pdf
后端顺序: poppler -> miktex-ghostscript -> mineru-page
  [OK] poppler :: D:\MiKTeX\miktex\bin\x64\pdftoppm.exe (1020x1320, 70798 bytes)
  [OK] miktex-ghostscript :: D:\MiKTeX\miktex\bin\x64\mgs.exe (1020x1320, 18454 bytes)
  [SKIP] mineru-page :: 需要 DSH 工具层注入 callReadPdf（read_pdf view:'page'），CLI 独立运行时不可用
CONCLUSION: OK — 推荐后端 = poppler
node exit=0
```

设计要点：纯 Node ESM、无 `@deepseek-ai/*` 依赖；`spawn(cmd, argsArray, { shell:false })`（支持空格/中文路径）；
外部件缺失 → `status:'skipped'` + `reason`/`advice`，永不抛异常；`--json` 输出机器可读结果，`--strict` 在全部不可用时退出码 1。

### H.1 返修（qa-lab 复审 → env-lab 修复，2026-10-11）

**问题**（qa-lab 实测）：① 默认路径写死 `../latex-demo/main.pdf`，而 daily-core 已把产物移到
`<dir>/.latex-studio/build/`，导致默认调用输出 `NO-LOCAL-BACKEND`（易误读为「三个后端都坏了」）；
② `--pdf` 相对路径按【插件根】解析，与「工作区相对路径」的心智模型不符。

**修复**：
- 相对路径解析顺序：`--workdir` → `$DSH_WORKSPACE`/`$DSH_SESSION_CWD`/`$DSH_CWD` → **cwd** →
  工作区根（插件根的上一级）→ 插件根，**取第一个真实存在的**；报告中新增 `baseDir` / `resolvedBase` 便于核对。
- 无 `--pdf` 时按上述基准搜索 `<base>/latex-demo/.latex-studio/build/main.pdf`（即插件根视角的
  `../latex-demo/.latex-studio/build/main.pdf`）→ `<base>/latex-demo/main.pdf` → `<base>/.latex-studio/build/main.pdf`。
- **三态结论**：`OK`（有可用后端） / `NO-LOCAL-BACKEND`（样本在、后端全坏） /
  `NO SAMPLE PDF（reason=PDF_NOT_FOUND|PDF_EMPTY）`（**样本缺失，未探测任何后端**，并列出尝试过的路径与建议命令）。
- 仍未引入任何 DSH 依赖（纯 Node ESM）。

**复跑证据（2026-10-11，cwd = dsh-latex-studio/）**：

```
### CASE 1: node tools/verify-pdf-read.mjs --pdf ../latex-demo/.latex-studio/build/main.pdf
PDF: D:\Documents\deepseek harness\DSH插件管理\latex-demo\.latex-studio\build\main.pdf
基准目录: D:\Documents\deepseek harness\DSH插件管理\dsh-latex-studio
命中基准: D:\Documents\deepseek harness\DSH插件管理\dsh-latex-studio
后端顺序: poppler -> miktex-ghostscript -> mineru-page
  [OK] poppler :: D:\MiKTeX\miktex\bin\x64\pdftoppm.exe (993x1404, 45961 bytes)
  [OK] miktex-ghostscript :: D:\MiKTeX\miktex\bin\x64\mgs.exe (992x1403, 19598 bytes)
  [SKIP] mineru-page :: 需要 DSH 工具层注入 callReadPdf（read_pdf view:'page'），CLI 独立运行时不可用
CONCLUSION: OK — 推荐后端 = poppler
exit=0

### CASE 2: node tools/verify-pdf-read.mjs（无 --pdf）
PDF: D:\Documents\deepseek harness\DSH插件管理\latex-demo\.latex-studio\build\main.pdf
命中基准: D:\Documents\deepseek harness\DSH插件管理
  [OK] poppler (993x1404, 45961 bytes) / [OK] miktex-ghostscript (992x1403, 19598 bytes) / [SKIP] mineru-page
CONCLUSION: OK — 推荐后端 = poppler
exit=0

### CASE 3: node tools/verify-pdf-read.mjs --pdf latex-demo/.latex-studio/build/main.pdf
命中基准: D:\Documents\deepseek harness\DSH插件管理   （工作区根回退命中）
CONCLUSION: OK — 推荐后端 = poppler

### CASE 4: node tools/verify-pdf-read.mjs --pdf missing.pdf
尝试过的路径:
  - D:\...\dsh-latex-studio\missing.pdf
  - D:\...\DSH插件管理\missing.pdf
建议命令: 先用 latex_build 生成 PDF，或传 --pdf <路径>（相对路径基准目录：D:\...\dsh-latex-studio）
CONCLUSION: NO SAMPLE PDF（reason=PDF_NOT_FOUND）— 未做任何后端探测；请先生成 PDF 或修正 --pdf/--workdir
exit=0
```

**回归**：`node test/run-all.mjs` → `2 file(s), 72 test(s) — 72 passed, 0 failed, 0 skipped`，`verdict: ALL GREEN`，exit=0。

---

## 附录：证据文件与复跑清单

| 文件（工作区内） | 内容 |
|---|---|
| `dsh-latex-studio/tools/_p0/mpm-list.txt` | `mpm --list` 全量输出（9037 行，210 个 `true`） |
| `dsh-latex-studio/tools/_p0/missing-candidates.txt` | 18 个「DB 中存在但本机缺失」的包名 |
| `dsh-latex-studio/tools/_p0/pkgcheck.txt` | 候选包 `.sty` 的 `kpsewhich` 判定 |
| `dsh-latex-studio/tools/_p0/installer-test/installer-probe.log` | `--enable-installer` 探针的命令与原始输出 |
| `dsh-latex-studio/tools/_p0/installer-test/probe2.log` | pdflatex 的完整 transcript（49 行） |
| `dsh-latex-studio/tools/_p0/installer-test/mpm-install-probe.log` | `mpm --install=algorithms` 的锁报错 |
| `dsh-latex-studio/tools/verify-pdf-read.mjs` | 页图后端探针（本次交付） |

> 这些临时产物位于 `tools/_p0/`，不在 `package.json` 的 `files` 白名单内，**不会被 npm pack 打进 tgz**。

**暂停声明**：MiKTeX 侧验证（§A.2 的 `--enable-installer`、§G 的复跑）已按用户要求暂停，待 MiKTeX 更新完成后可复跑。
