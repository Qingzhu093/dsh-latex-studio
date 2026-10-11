# dsh-latex-studio — 验收标准与可复现命令

> 本文件把 6 条成功标准写成**可执行**的验收清单：每条给出「判定条件 / 命令 / 期望输出 / 本机实测」。
> 所有命令的**工作目录都是插件根** `<repo>\\dsh-latex-studio`（路径含空格与中文，命令均已按此实测）。
> 契约见 [INTERFACES.md](./INTERFACES.md)；方法学见 [paperfit-notes.md](./paperfit-notes.md)。

## 0. 验收总表（2026-10-10 本机实测）

| # | 标准 | 判定 | 状态 |
|---|---|---|---|
| A1 | 安装与开关 | CLI 一条命令装入；`plugin list --profile desktop` 见 `dsh-latex-studio@0.1.0`；关开关后对应子系统不注册 | ✅ 安装 + `plugin list` 实测（exit 0）；开关断言 ✅ |
| A2 | A 线编译闭环 | 干净工程 `passed` + 正确页数；注入 `\notacommand` → `failed` + 正确 file/line；还原后再次 `passed` | ✅（core 层实测） |
| A3 | 视觉通道可用 | 至少一条**本地**后端出图；工具能明确报出可用后端；页图以 image 块回会话 | ✅ poppler + miktex-ghostscript 均实测出图 |
| A4 | VTO 门禁 | 删除任一 `\cite` 键必须判 fail/拦截并回滚 | ✅ guard 层实测；工具层由 `test/vto.test.mjs` 覆盖 |
| A5 | 隐私断言 | 默认 `external-only` 与 `never` 下本人稿件不得走解析上传路径；仅 `always` 允许 | ✅ 闸门实测 |
| A6 | 依赖口径 | MiKTeX 为唯一必需件；无 npm 运行时依赖；`lib/core/*` 不 import `@deepseek-ai/*` | ✅ 实测 |

---

## A1 · 安装与开关

**判定**：① 桌面端 CLI 一条命令装入成功；② `plugin list --profile desktop` 能看到 `dsh-latex-studio@0.1.0`；③ 把 `enableDaily`/`enableVto` 置 false 后，对应子系统不被注册。
（`--profile desktop --dump-config` **不可用**：desktop profile 由 Electron 应用独占管理，实测 exit 1，见下面注。）

**① 安装**：

```powershell
cd <repo>\dsh-latex-studio
npm pack
& "D:\DshDesktop\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add (Resolve-Path .\dsh-latex-studio-0.1.0.tgz)
```

**② 校验是否装入**：

```powershell
& "D:\DshDesktop\resources\runtime\cli\bin\dsh.cmd" plugin list --profile desktop
```

期望（**exit 0**；第三行必须是 `dsh-latex-studio@0.1.0`）：

```text
Legend: production dependency, optional only, dev only

dsh-profile-desktop C:\Users\wangy\.dsh\profiles\desktop (PRIVATE)
│
│   dependencies:
├── @klarkxy/dsh-dev-index@0.1.7
├── dsh-latex-studio@0.1.0
└── dsh-pdf-mineru@0.2.0

3 packages
```

**实测**：本机 exit 0，输出与上面一致（`dsh-latex-studio@0.1.0` 在列）。
**注意 · 不要用 `--profile desktop --dump-config`**：本机实测 **exit 1**，`error: profile "desktop" is managed exclusively by the Electron application`（`desktop` profile 由 Electron 应用独占管理）。配置**生效值**请在应用内设置页查看；`Config: yes`（装入副本可解析 schemastery）与 `enableVto:false` 时不注册 VTO 这两点已由 Lead 在临时 profile `latexverify` 上验证。

**③ 开关断言**（不需要装宿主的纯 Node 断言）：

```powershell
$code = @'
const mod = await import('./lib/index.js')
const mock = () => ({ tools: {}, logger: { info() {}, warn() {} } })
const bothOff = await mod.apply(mock(), { enableDaily: false, enableVto: false })
const vtoOn = await mod.apply(mock(), { enableDaily: false, enableVto: true })
const systems = [...vtoOn.registered, ...vtoOn.failed.map((f) => f.system)]
console.log(JSON.stringify({ bothOff, systems }))
'@
node --input-type=module -e $code
```

期望：`bothOff.registered` 与 `bothOff.failed` 都为空；`systems` 中**不出现 `daily`**（因为 `enableDaily:false`）。
**实测**：

```text
{"bothOff":{"registered":[],"failed":[]},"systems":["vto"]}
```

（`systems=["vto"]` 表示：关掉 daily 后 daily 完全未被加载；VTO 子系统被加载。裸 Node 进程里 `@deepseek-ai/dsh-tools` 不存在，`vto.js` 会降级为 `failed:[{system:"vto"}]` —— 这是设计内的优雅降级，不是崩溃。）

---

## A2 · A 线编译闭环

**判定**：干净工程 `status:'passed'` 且页数为 2；注入 `\notacommand` 后 `status:'failed'` 且 `errors[0]` 带正确 `file`/`line`；还原后再次 `passed`。

**命令**（在插件根执行；用副本避免污染 `latex-demo`）：

```powershell
$code = @'
import { cpSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { build } from './lib/core/compile.js'
import { normalizeConfig } from './lib/config.js'

const END = String.raw`\end{document}`
const INJ = String.raw`\notacommand`
const config = normalizeConfig({})
const dir = path.join(process.env.TEMP, 'latex-acceptance-c2')
rmSync(dir, { recursive: true, force: true })
cpSync('../latex-demo', dir, { recursive: true })
for (const f of ['main.log', 'main.pdf', 'main.blg']) rmSync(path.join(dir, f), { force: true })

const clean = await build({ dir, entry: 'main.tex', engine: 'auto', config })
console.log('clean:', JSON.stringify({ status: clean.status, pages: clean.pages, engine: clean.engine, passes: clean.passes }))

const tex = readFileSync(path.join(dir, 'main.tex'), 'utf8')
writeFileSync(path.join(dir, 'main.tex'), tex.replace(END, INJ + '\n' + END))
const broken = await build({ dir, entry: 'main.tex', engine: 'auto', config })
const e = broken.errors[0] || {}
console.log('broken:', JSON.stringify({ status: broken.status, file: e.file, line: e.line, message: e.message }))

writeFileSync(path.join(dir, 'main.tex'), tex)
const restored = await build({ dir, entry: 'main.tex', engine: 'auto', config })
console.log('restored:', JSON.stringify({ status: restored.status, pages: restored.pages }))
rmSync(dir, { recursive: true, force: true })
'@
node --input-type=module -e $code
```

期望输出（页数 2；行号为实现行号，本机为 46）：

```text
clean: {"status":"passed","pages":2,"engine":"pdflatex","passes":3}
broken: {"status":"failed","file":"C:/Users/.../latex-acceptance-c2/main.tex","line":46,"message":"Undefined control sequence."}
restored: {"status":"passed","pages":2}
```

**实测**：完全一致；`broken` 的 `file` 指向副本内 `main.tex`、`line:46`、`message:"Undefined control sequence."`。

**DSH 会话内等价调用**：`latex_build({ dir: 'latex-demo', entry: 'main.tex' })`——`dir` 是工作区相对路径，`entry` 相对 `dir`。

---

## A3 · 视觉通道可用

**判定**：工具层 `latex_doctor({ verifyPdfRead: true, pdfPath: '<latex_build 返回的 pdfPath>' })` 返回 `renderProbe.status === 'ok'` 且 `renderProbe.backend ∈ {poppler, miktex-ghostscript}`（`bytes > 0`）；并且页图能作为 image 内容块回到会话。
（`pdfPath` 请用编译产物：本工作区默认 workDir 下为 `latex-demo/.latex-studio/build/main.pdf`，即 `latex_build` 返回的 `pdfPath`。）

**命令 1（主，DSH 会话内）· 工具内实渲染验证**：

```jsonc
// 第 1 步：编译，记下返回的 pdfPath（本工作区默认 workDir 下为 latex-demo/.latex-studio/build/main.pdf）
latex_build({ dir: "latex-demo", entry: "main.tex" })

// 第 2 步：工具内真渲染第 1 页（latex_doctor.pdfPath 是工作区相对路径）
latex_doctor({ verifyPdfRead: true, pdfPath: "latex-demo/.latex-studio/build/main.pdf" })
```

期望返回（关键字段）：

```json
{
  "status": "ok",
  "renderProbe": { "status": "ok", "backend": "poppler", "bytes": 45961, "reason": null, "path": "...\\latex-demo\\.latex-studio\\pages\\page-001.png" }
}
```

实测（用 mock `ctx.tools.register` 拿到定义后直接 `execute`，会话工作区 = 本仓库根）：

```text
{"status":"ok","backend":"poppler","bytes":45961,"reason":null,"path":"D:\\...\\latex-demo\\.latex-studio\\pages\\page-001.png"}
```

> `bytes` 随编译产物浮动（本次实测 45961）。

以及「只给 verifyPdfRead 不给 pdfPath」的降级：

```text
{"noPdfPath":"skipped :: verifyPdfRead=true 但未提供 pdfPath。"}
```

语义：`verifyPdfRead:true` 时**必须**给 `pdfPath`，工具真渲染第 1 页并返回 `renderProbe{status,backend,bytes,reason}`；只给 `verifyPdfRead:true` 不给 `pdfPath` → `renderProbe.status:'skipped'`（不算通过）；完全不传 `verifyPdfRead` 时只报 `pdftoppm`/`mgs` 的**存在性**。
下面命令 2/3 是不依赖 DSH 宿主的等价复现。

**命令 2（单元级证据）· core 层逐个后端实测**：

```powershell
$code = @'
import { cpSync, rmSync } from 'node:fs'
import path from 'node:path'
import { build } from './lib/core/compile.js'
import { renderPages } from './lib/core/render.js'
import { normalizeConfig } from './lib/config.js'

// compile a temp copy (spaces + CJK in the path) and use the returned pdfPath
const config = normalizeConfig({})
const dir = path.join(process.env.TEMP, 'latex-acceptance-a3')
rmSync(dir, { recursive: true, force: true })
cpSync('../latex-demo', dir, { recursive: true })
const built = await build({ dir, entry: 'main.tex', engine: 'auto', config })
console.log('build:', built.status, '| pdfPath:', built.pdfPath)

const out = {}
for (const backend of ['poppler', 'miktex-ghostscript']) {
  const outDir = path.join(process.env.TEMP, 'latex-acceptance-' + backend)
  rmSync(outDir, { recursive: true, force: true })
  const r = await renderPages({
    pdfPath: built.pdfPath, pages: '1', dpi: 120, outDir,
    config: normalizeConfig({ rendererOrder: [backend] }),
  })
  out[backend] = { status: r.status, backend: r.backend, bytes: r.pages[0] && r.pages[0].bytes, size: r.pages[0] && (r.pages[0].width + 'x' + r.pages[0].height) }
  rmSync(outDir, { recursive: true, force: true })
}
rmSync(dir, { recursive: true, force: true })
console.log(JSON.stringify(out, null, 1))
'@
node --input-type=module -e $code
```

期望（两条本地后端都 `ok`；字节数随编译产物浮动）：

```text
build: passed | pdfPath: C:\Users\...\AppData\Local\Temp\latex-acceptance-a3\.latex-studio\build\main.pdf
{
 "poppler":            { "status": "ok", "backend": "poppler",            "bytes": 45939, "size": "993x1404" },
 "miktex-ghostscript": { "status": "ok", "backend": "miktex-ghostscript", "bytes": 19600, "size": "992x1403" }
}
```

**命令 3 · 一行回答「哪个后端可用」**（P0 探针；`verifyPdfRead` 也可作为模块被 tools 层注入 `callReadPdf` 后调用）：

```powershell
# 先确保有 PDF（例如先跑 latex_build，产物在工作区相对路径 latex-demo/.latex-studio/build/main.pdf）
# 注意：--pdf 由脚本按【插件根】解析，所以要用 ../ 前缀指向工作区里的文件
node tools/verify-pdf-read.mjs --pdf ../latex-demo/.latex-studio/build/main.pdf
node tools/verify-pdf-read.mjs --pdf ../latex-demo/.latex-studio/build/main.pdf --json
```

实测（退出码 0）：

```text
PDF: <ws>\\latex-demo\\.latex-studio\\build\\main.pdf
后端顺序: poppler -> miktex-ghostscript -> mineru-page
  [OK] poppler :: D:\\MiKTeX\\miktex\\bin\\x64\\pdftoppm.exe (993x1404, 45961 bytes)
  [OK] miktex-ghostscript :: D:\\MiKTeX\\miktex\\bin\\x64\\mgs.exe (992x1403, 19598 bytes)
  [SKIP] mineru-page :: 需要 DSH 工具层注入 callReadPdf（read_pdf view:'page'），CLI 独立运行时不可用
CONCLUSION: OK — 推荐后端 = poppler
```

> ⚠️ 不带 `--pdf` 时脚本默认探测 `../latex-demo/main.pdf`；workDir 归位后 latex-demo 的编译产物在 `latex-demo/.latex-studio/build/`，默认路径会指向不存在的文件并输出 `CONCLUSION: NO-LOCAL-BACKEND`（**exit 仍是 0**，容易误读成「后端不可用」）。已把该问题报给 env-lab/Lead；当前请显式传 `--pdf`。

**DSH 会话内**：`vto_inspect` 走 `rendererOrder` 出图并把页图以 image 内容块返回（受 `attachImagesPerRound` 限制）。三条后端都不可用时降级为「只给 checklist」而不是报错。
> 说明：命令 1 是工具面主证据（`renderProbe`）；命令 3 的独立脚本输出可直接贴进报告（须显式 `--pdf`）；命令 2 证明「逐后端」都能出图而不只是第一个可用，且自带编译、不依赖 `latex-demo` 里的易变产物。三者都通过 = 标准 3 通过。
> 维护提示：本文件里 `$code = @'…'@` 形式的代码块，**块内 JS 注释请用英文**。Windows 下 PowerShell 把「含中文的注释行」传给 `node -e` 时会吞掉紧随其后的一行（本机实测：中文 `//` 注释后面的语句被并进注释，报 `ReferenceError: … is not defined`）。

---

## A4 · VTO 门禁

**判定**：`vto_verify` 能给出 `pass`/`fail`；**删掉任意一个 `\cite` 键的编辑必须被判 fail 并回滚**（`vto_fix` 的 guard 与 `vto_verify` 的 contentIntegrity 双保险）。

**命令（内容守卫层，可直接复现）**：

```powershell
$code = @'
import { snapshot, verifySnapshot } from './lib/core/guard.js'
const before = [{ path: 'main.tex', text: String.raw`\cite{vaswani2017,he2016} \label{sec:intro} 3.5` }]
const snap = snapshot(before)
const after = [{ path: 'main.tex', text: String.raw`\cite{he2016} \label{sec:intro} 3.5` }]
const bad = verifySnapshot(snap, after)
const same = verifySnapshot(snap, before)
console.log(JSON.stringify({ removed_cite: { ok: bad.ok, lost: bad.protectedLost }, untouched: { ok: same.ok, lost: same.protectedLost } }))
'@
node --input-type=module -e $code
```

期望：

```text
{"removed_cite":{"ok":false,"lost":["cite:vaswani2017"]},"untouched":{"ok":true,"lost":[]}}
```

**DSH 会话内**（双保险）：
1. `vto_fix({ apply: true, file: '...', find: '\\cite{a,b}', replace: '\\cite{b}' })` → 守卫判定内容丢失 → **不写入并自动回滚**；
2. `vto_verify(...)` → `verdict: 'fail'`，`checks.contentIntegrity: false`，`regressions` 列出丢失的键，必要时给 `rollbackTo`。

单元测试覆盖：`node --test test/vto.test.mjs`；整套 `npm test`（= `node test/run-all.mjs`）当前 72/72 全绿（基线只钉 `0 failed / 0 skipped`）。

---

## A5 · 隐私断言

**判定**：`uploadScope: 'external-only'`（默认）与 `'never'` 下，**对本人稿件的任何操作都不得触发解析上传路径**（闸门返回 `allowed:false`）；只有 `'always'` 允许。

**命令**：

```powershell
$code = @'
import { checkPdfRead } from './lib/core/pdfread.js'
const gate = (scope, opts) => checkPdfRead({ uploadScope: scope }, opts).allowed
console.log(JSON.stringify({
  never_content_user: gate('never', { view: 'content', isUserWork: true }),
  external_content_user: gate('external-only', { view: 'content', isUserWork: true }),
  external_content_other: gate('external-only', { view: 'content', isUserWork: false }),
  always_content_user: gate('always', { view: 'content', isUserWork: true }),
  local_page_view: gate('never', { view: 'page' }),
}))
'@
node --input-type=module -e $code
```

期望：

```text
{"never_content_user":false,"external_content_user":false,"external_content_other":true,"always_content_user":true,"local_page_view":true}
```

说明：`view:'page'` 是纯本地渲染，任何 `uploadScope` 下都允许；`external-only` 只对**非本人文档**（如参考文献 PDF）放行解析；本人稿件需显式单次 `consent:true`。

**另需人工确认**：本机 MinerU `read_pdf({view:'page'})` 实测失败（`PDF.js returned invalid page metadata`），结构化解析 Provider 为 `official-v4` 且 `uploadsData: true` —— 这正是默认 `external-only` + `rendererOrder` 本地优先的原因。

---

## A6 · 依赖口径

**判定**：**MiKTeX 是唯一必需外部件**（同时提供 pdflatex/xelatex/lualatex/biber/bibtex/makeindex/chktex/**pdftoppm/pdfinfo**/**ghostscript(mgs)**）；`dsh-pdf-mineru` 可选；Python sidecar 可选且默认关闭；无任何 npm 运行时依赖。

**命令 1 · 检查 npm 依赖与核心层纯度**：

```powershell
node -e "const p=require('./package.json'); console.log(JSON.stringify({dependencies:p.dependencies, peers:Object.keys(p.peerDependencies||{})}))"
Select-String -Path .\lib\core\*.js -Pattern '@deepseek-ai' -SimpleMatch | Measure-Object | Select-Object -ExpandProperty Count
```

期望：

```text
{"dependencies":{},"peers":["@deepseek-ai/cordis","@deepseek-ai/dsh-tools"]}
0
```

（`dependencies` 为空 = 无 npm 运行时依赖；`core` 下 `@deepseek-ai` 命中 0 次 = 核心层与宿主解耦。）

**命令 2 · 外部件探测（全部应指向 MiKTeX）**：

```powershell
$code = @'
import { probeEnv } from './lib/core/env.js'
import { normalizeConfig } from './lib/config.js'
const r = await probeEnv(normalizeConfig({}))
console.log(JSON.stringify({ engines: r.latex.engines, biber: r.latex.biber, chktex: r.latex.chktex, isMiKTeX: r.latex.isMiKTeX, pdftoppm: r.poppler.pdftoppm, pdfinfo: r.poppler.pdfinfo, mineruUploads: r.mineru.uploadsData }, null, 1))
'@
node --input-type=module -e $code
```

期望（本机实测）：

```text
{
 "engines": { "pdflatex": "D:\\MiKTeX\\miktex\\bin\\x64\\pdflatex.exe", "xelatex": "...\\xelatex.exe", "lualatex": "...\\lualatex.exe" },
 "biber": "D:\\MiKTeX\\executables\\windows-x64\\biber\\biber.exe",
 "chktex": "D:\\MiKTeX\\miktex\\bin\\x64\\miktex-chktex.exe",
 "isMiKTeX": true,
 "pdftoppm": "D:\\MiKTeX\\miktex\\bin\\x64\\pdftoppm.exe",
 "pdfinfo": "D:\\MiKTeX\\miktex\\bin\\x64\\pdfinfo.exe",
 "mineruUploads": true
}
```

> 结论口径：**不需要**单独安装 Poppler（MiKTeX 自带）；Perl/latexmk 是**可选**（有则优先 latexmk，无则回落内置多趟驱动）。任何外部件缺失时，工具返回 `status:'skipped'` + 可执行的 `advice`，绝不抛异常 —— 这条贯穿全部 10 个工具。

---

## 附：测试聚合

```powershell
npm test                         # = node test/run-all.mjs（聚合汇总，推荐入口）
node test/run-all.mjs            # 每个 test/*.test.mjs 一行 + 失败用例名 + 总计
node test/run-all.mjs --verbose  # 附带子进程原始输出
node test/run-all.mjs --json     # 机器可读汇总
node test/run-all.mjs vto        # 只跑文件名含 vto 的测试
node --test test/vto.test.mjs    # 单文件直跑 node:test
```

实测输出（`npm test`，退出码 0）：

```text
[run-all] discovered 2 file(s): test/daily.test.mjs, test/vto.test.mjs
  PASS  test/daily.test.mjs                24/24 passed
  PASS  test/vto.test.mjs                  48/48 passed
[run-all] summary: 2 file(s), 72 test(s) — 72 passed, 0 failed, 0 skipped
[run-all] verdict: ALL GREEN
```

> 计数会随测试增长而变；**基线只钉 `0 failed / 0 skipped` 与 `ALL GREEN`**（当前 72 passed）。

退出码：全绿 `0`；有失败 `1`；runner 自身崩溃 `2`。

> ⚠️ **不要用 `node --test test/`（目录参数）**：本机 Node 24.20 + Windows 下会报 `Cannot find module ...\test` 且 exit 1（已实测）。用 `npm test` / `run-all.mjs` / 单文件 / `node --test`（无参数）均可。
