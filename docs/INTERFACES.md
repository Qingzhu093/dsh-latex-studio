# dsh-latex-studio — 模块接口契约（实现前冻结）

> 本文档是并行实现的唯一契约。**改接口必须先改这里并通知 Lead。**
> 所有 `lib/core/*` 必须是**纯 Node ESM**，不得 import `@deepseek-ai/*`（便于单测）。
> 只有 `lib/tools/*` 与 `lib/index.js` 可以 import `@deepseek-ai/dsh-tools`。

## 0. 环境事实（P0 已确认，2026-10-10）

| 事实 | 值 |
|---|---|
| MiKTeX | 已安装于 `D:\MiKTeX`，bin = `D:\MiKTeX\miktex\bin\x64`（已在用户 PATH） |
| 引擎 | `pdflatex.exe` / `xelatex.exe` / `lualatex.exe` / `biber.exe`(2.21) / `bibtex.exe` / `makeindex.exe` / `mpm.exe` / `initexmf.exe` / **`miktex-chktex.exe`** 全部可用 |
| **`latexmk` 不可用** | MiKTeX 的 latexmk 是脚本，需要 **Perl**，本机没有 → **禁止依赖 latexmk**。必须自己写多趟编译驱动 |
| **Poppler** | ✅ **可用（daily-core 实测更正）**：`D:\MiKTeX\miktex\bin\x64\pdftoppm.exe` / `pdfinfo.exe`（Poppler 24.04.0）**随 MiKTeX 25.12 一起装了**。`Get-Command pdftoppm` 查不到只是因为 DSH 进程 PATH 不含 MiKTeX bin → **resolveTool 必须显式追加 `D:\MiKTeX\miktex\bin\x64`**。`pdftoppm -png -r 100 -f 1 -l 1 -- <abs pdf> <out>` 退出码 0，产出 55253 字节 PNG。**注意：Windows 下必须传绝对路径，Poppler 不认正斜杠相对路径** |
| scoop 的 poppler | 空壳目录 `D:\scoop_all\scoop\apps\poppler`，可忽略 |
| **MiKTeX Ghostscript** | ✅ **可用（P0 实测）**：`D:\MiKTeX\miktex\bin\x64\mgs.exe`（GPL Ghostscript 9.25）；已把 `latex-demo/main.pdf` 第 1 页渲染成 18454 字节 PNG，退出码 0。命令：`mgs.exe -dNOPAUSE -dBATCH -sDEVICE=png16m -r<dpi> -dFirstPage=N -dLastPage=N -sOutputFile=<out.png> <in.pdf>`。**这是零额外安装的本地页图后端** |
| MinerU 页图渲染 | 本机实测失败：`PDF.js returned invalid page metadata`；结构化解析走 `official-v4`（**会上传**） |
| Node | 24.21.0（DSH 桌面端 0.2.0-rc.2） |

**编译策略（据此实现）**：引擎直调 + 自研多趟循环（最多 4 趟，比较 `.aux` 的 `\newlabel` 是否稳定），需要时插 `bibtex`/`biber`；MiKTeX 下给引擎加 `--enable-installer` 自动补包。

## 1. lib/core/env.js
```js
export async function probeEnv(config) -> EnvReport
export function resolveTool(name, extraDirs = []) -> string | null
```
`EnvReport`：
```js
{
  latex: { command, path, version, engines: { pdflatex, xelatex, lualatex },
           biber, bibtex, makeindex, mpm, initexmf, chktex,   // 均为 string|null
           isMiKTeX: boolean, binDir: string|null },
  poppler: { pdftoppm: string|null, pdfinfo: string|null },
  mineru: { toolName: string, available: boolean, activeProvider: string|null, uploadsData: boolean },
  python: { path: string|null },
  node: { version: string },
  config: { uploadScope, rendererOrder },
  advice: [ { level: 'info'|'warn'|'error', message: string, command?: string } ]
}
```
查找顺序：PATH → `D:\MiKTeX\miktex\bin\x64` → `%LOCALAPPDATA%\Programs\MiKTeX\miktex\bin\x64` → 注册表 `InstallLocation`。

## 2. lib/core/logparse.js
```js
export function parseLatexLog(text) -> LogReport
```
```js
{
  compileSuccess: boolean, pages: number|null,
  errors:   [{ file, line:number|null, message, raw }],
  warnings: [{ file, line:number|null, message, kind }],
  overfull: [{ file, line, amountPt:number|null, text }],
  underfull:[{ file, line, amountPt:number|null, text }],
  missingCitations: string[], missingRefs: string[],
  floatWarnings: [], packageWarnings: []
}
```
规则移植自 PaperFit `scripts/parse_log.py`（MIT）。页数从 `Output written on ... (N pages` 提取。

## 3. lib/core/compile.js
```js
export function detectEngine(texSource, dir) -> 'pdflatex'|'xelatex'|'lualatex'
export async function build(opts) -> BuildResult
// opts: { dir, entry, engine='auto', clean=false, config }
```
`BuildResult` = `{ status:'passed'|'failed'|'skipped', engine, passes:number, durationMs, pdfPath, logPath, pages, ...LogReport 的字段, logTail, reason? }`
- 输出目录 `<dir>/<workDir>/build`、辅助 `<dir>/<workDir>/auxfiles`（`-output-directory` / `-aux-directory`）；辅助目录**不得**叫 `aux`（Windows 保留设备名，会让 Copy-Item/Robocopy/解压失败）。`workDir` 默认 `.latex-studio`。
- 找不到引擎 → `status:'skipped'` + `reason` + `advice`，**不得抛异常**。
- 超时受 `config.compileTimeoutMs` 约束；超时返回 `failed` 且保留 `logTail`。

## 4. lib/core/lint.js
```js
export function lintProject({ dir, entry, rules = null, config }) -> LintReport
export function extractProtected(texSources) -> Protected
```
`LintReport` = `{ findings:[{rule,severity:'info'|'minor'|'major'|'critical',file,line,message,hint}], protected:Protected, external:{chktex:'used'|'skipped'|'unavailable'} }`
`Protected` = `{ cites:string[], labels:string[], refs:string[], numericTokens:string[] }`
规则：禁用伪修复（`\resizebox`、裸 `\vspace`、滥 `\newpage`、`\tiny`/`\scriptsize`）；引用/标签对账；图-引用距离（移植 PaperFit `extract_crossrefs.py`）。

## 5. lib/core/bib.js
```js
export function parseBib(text) -> { entries: BibEntry[], complete: boolean }
export async function bibAction({ action, bibPath, texFiles = [], write = false, config }) -> BibResult
// action: 'lint' | 'format' | 'fill' | 'audit'
```
`BibResult` = `{ ok:boolean, action, issues:[], fixed?:string, written?:boolean, missingInBib?:string[], uncited?:string[], error?:{code,message} }`
- 优先调用 MiKTeX 的 `biber --tool`（`biber --tool --output-format=bibtex <file>`）做 lint/format；不可用时用内部解析。
- `fill`：Crossref API（Node 内置 fetch），**只补不覆盖**。
- `audit`：`\cite/\citep/\citet/\parencite/\textcite/\autocite/\footcite/\fullcite/\nocite` 双向对账。
- **写前必须校验 `complete`**，不完整则 `error.code='PARSE_INCOMPLETE'` 且**拒绝写入**。

## 6. lib/core/guard.js
```js
export function snapshot(texSources) -> { protected: Protected, hashes: Record<string,string>, at: string }
export function verifySnapshot(snapshot, texSources) -> { ok:boolean, unchanged:string[], changed:string[], added:string[], removed:string[] }
export function scanSecrets(text) -> [{ pattern:string, line:number, excerpt:string }]
```
受保护项：`\cite/\ref/\label/\caption` 键集合、表格 `&` 单元格、数字 token。`scanSecrets` 覆盖 `sk-`/`ghp_`/`AKIA` 等。

## 7. lib/core/policy.js
```js
export const FORBIDDEN = [ { id, pattern, message, hint } ]
export function checkPolicy(beforeText, afterText) -> { violations:[{id,line,message,hint}] }
```

## 8. lib/core/render.js
```js
export async function renderPages({ pdfPath, pages='all', dpi=150, outDir, config, callReadPdf }) -> RenderResult
```
`RenderResult` = `{ status:'ok'|'skipped'|'failed', backend:'poppler'|'mineru-page'|null, pages:[{index,path,width,height,bytes}], reason?, advice? }`
四道保险（后端名即 `config.rendererOrder` 的取值）：① `poppler` = `pdftoppm`（`-f -l -r -png -singlefile`）② **`miktex-ghostscript` = `mgs.exe`（MiKTeX 自带，P0 已实测可用；用 `-dFirstPage/-dLastPage` 单页输出 + `-r<dpi>`）** ③ `mineru-page` = 注入的 `callReadPdf`（调 `read_pdf({view:'page'})`）④ 明确报错 + 安装指令，调用方降级为"只给 checklist"。默认顺序 `['poppler','miktex-ghostscript','mineru-page']`。
`callReadPdf` 由 tools 层注入，core 不得直接依赖 DSH。

## 9. lib/core/state.js
```js
export function newState({ dir, entry, pageBudget, template, columnType, uploadScope })
export function loadState(workDir) / saveState(workDir, state)
export function nextRound(state) -> state
export function backupFiles(workDir, round, files) -> string[]
export function rollback(workDir, round) -> string[]
export function recordRound(workDir, round, payload) -> string
```
目录：`<proj>/<workDir>/{state.json,build/,auxfiles/,pages/,reports/,backups/rN/}`（**禁用 `aux`：Windows 保留设备名**）

## 10. lib/core/report.js
```js
export function writeRoundReport(workDir, round, data) -> { jsonPath, mdPath }
```
模板来自 `lib/data/diagnostic_report.template.md`（需从 PaperFit vendored）。

## 11. lib/tools/daily.js / lib/tools/vto.js
```js
export function registerDaily(ctx, config)   // latex_doctor, latex_build, latex_lint, bib_tool
export function registerVto(ctx, config)     // vto_start, vto_inspect, vto_fix, vto_verify, vto_report
```
用 `defineTool` from `@deepseek-ai/dsh-tools`；`output.schema` 为 JSON Schema 片段；`output.render(args,value)` 返回 `ContentBlock[]`（文本或 `{type:'image',...}`）。
工具入参一律**工作区相对路径**（拒绝绝对路径与 `..`）。

**工作区根**（daily/vto 一致）：`exec.agent.session.header.cwd` → `ctx.get('fs').cwd` → `process.cwd()`（前两者优先；DSH 桌面端进程 cwd 未必是会话工作区）。

`latex_doctor` 追加可选参数：`verifyPdfRead?:boolean`、`pdfPath?:string`（工作区相对）。`verifyPdfRead:true` 时用 `lib/core/render.js` 的 `renderPages()` 真渲染第 1 页（`outDir` 固定在工作区内，绝不落到项目根），输出 `renderProbe:{status,backend,bytes,reason,path}`；未给 `pdfPath` → `status:'skipped'` + `reason`。默认 `false` 只报存在性。

## 12. lib/index.js（Lead 负责）
```js
export const name = 'dsh-latex-studio'
export const inject = ['tools']
export function apply(ctx, config)   // 按 enableDaily/enableVto 注册
```

## 13. 验收口径（所有人遵守）
- 任一外部件缺失 → **`skipped` + advice**，绝不抛异常。
- 所有写操作：先备份 → 写 → 校验 → 失败回滚。
- 路径含空格与中文必须可用（本工作区即是）。
- 每个 core 模块自带 `test/*.test.mjs`（node:test）。
## 13. 各模块的可选扩展（超集，允许存在；不是必填契约）
实现方可以在不改动上面已冻结字段的前提下追加字段；调用方必须容忍它们缺席。已知扩展：
- `guard.verifySnapshot()` 额外返回 `protectedLost` / `drift` / `warnings`；
- `renderPages()` 的 `RenderResult` 额外返回 `attempts` / `pageCount` / `pageCountSource` / `rendererDowngrade`；
- `vto_*` 返回值额外带 `status` / `advice` / `notes` / `gate`；
- `latex_doctor` 追加 `verifyPdfRead` / `pdfPath` 入参与 `renderProbe` 出参（见 §11）；
- `latex_lint` 的 `external.chktex` 取值细化为 `used` / `skipped` / `unavailable`，由 `config.enableChktex`（默认 false）控制。

## 14. 已知未验证项（交付时如实标注，不得写成已通过）
- `bib_tool action=fill` 依赖 Crossref 联网，本机未做成功路径验证；失败时返回 `ok:false` + `error.code=CROSSREF_UNAVAILABLE`，不抛异常、不编造数据。
- ~~MiKTeX `--enable-installer`~~ **已实测通过（2026-10-11）**：`gnuplottex` 经文件级检查确认缺失 → 用 pdflatex **不带任何 installer 参数**编译（全局 `[MPM]AutoInstall=1`）→ exit 0、产出 14330 B PDF、`gnuplottex.sty` 随即出现（15.1 s，含下载）。
- `read_pdf({ view: page })`（MinerU 插件）在本机持续报 `PDF.js returned invalid page metadata`，因此 **不作为** 视觉通道依赖，仅作第三级回落。
