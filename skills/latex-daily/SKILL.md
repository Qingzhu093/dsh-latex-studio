---
name: latex-daily
description: 日常 LaTeX 编译门控、首次环境一键配置协助与参考文献审计（A 线）。当用户询问“如何配置环境/刚装好插件/环境体检/怎么用”，或任务是生成、修改、修复 .tex/.bib（论文、报告、公式、表格、参考文献），需要"配置环境"或"真编译过再交付"时使用。配套工具：latex_doctor / latex_build / latex_lint / bib_tool。
---

# LaTeX 日常编译与环境配置守则

**核心原则：**
1. **开箱即用，一次性全套配齐**：用户首次使用或环境缺失时，Agent 必须主动协助用户一次性配置完整套工具链，严禁“报一个缺件让用户装一个、装完又报下一个”的碎片化折腾。
2. **真编译交付**：没有编译通过的 LaTeX 不算写完。小步修改、每步编译。

---

## 0. 首次使用与全套环境一次性配置向导（最优先）

### 0.1 触发时机
- 用户首次安装插件并提问：“怎么配置环境”、“我刚装好插件”、“环境体检”、“怎么用”；
- 或者执行任何任务前运行 `latex_doctor({})`，**只要检测到缺少核心 TeX 引擎（`command === null`）或环境降级（`status === 'degraded'`）**。

### 0.2 Agent 的协助行为准则（一揽子全套配齐）
Agent 绝不可仅仅扔出一句“缺少 pdflatex”了事。必须向用户清晰呈现全套专业 LaTeX 工具链的构成，并提供一键式全自动解决方案：

1. **告知全套工具链清单**：
   - **核心编译与渲染组件**：MiKTeX（自带 pdflatex/xelatex/lualatex、bibtex/biber、Poppler `pdftoppm` 与 Ghostscript `mgs.exe`）；
   - **宏包免打扰自动补全**：配置 `[MPM]AutoInstall=1`（后续遇到未装宏包全自动静默下载，绝不弹窗阻断会话）；
   - **依赖追踪加速引擎**：Strawberry Perl（为 `latexmk` 提供 `.fls` 依赖追踪，实现工业级增量重编译）；
   - **源码静态检查器**：`chktex`（代码风格与潜在排版隐患扫描）。

2. **给出一次性全自动安装方案（在 Windows PowerShell 中运行）**：
   直接推荐运行插件自带的开箱脚本（全自动安装、配置免弹窗下载并刷新环境变量）：
   ```powershell
   powershell -ExecutionPolicy Bypass -File tools/setup-latex-stack.ps1
   ```
   *备选：若手动执行 winget 一键命令*：
   ```powershell
   winget install --id MiKTeX.MiKTeX StrawberryPerl.StrawberryPerl -e --accept-source-agreements --accept-package-agreements ; initexmf --set-config-value [MPM]AutoInstall=1 ; mpm --install=chktex
   ```

3. **竣工验收与就绪确认**：
   用户安装完成后，Agent 主动运行 `latex_doctor({ refresh: true, verifyPdfRead: true })` 进行验收，确认 `verdict: HEALTHY` 且页图探针 `renderProbe.status='ok'`，然后明确告诉用户环境已完全就绪，并提醒若新装了编译器需完全重启一次 DSH 桌面端。

---

## 1. 本机环境事实（不要凭记忆假设）

| 事实 | 说明 |
|---|---|
| MiKTeX 是**唯一必需件** | 同时自带引擎、biber/bibtex、chktex、**pdftoppm/pdfinfo（Poppler 24.04）**、**mgs.exe（Ghostscript 9.25）** |
| **编译驱动** | 默认优先 `latexmk`（需 Perl；Git 自带的 perl 也会被探测）；不可用时自动回落内置多趟驱动。`latex_build` 的返回值里 `via` 说明实际走了哪条 |
| 页图通道 | ① poppler（MiKTeX 自带）② miktex-ghostscript（mgs）③ read_pdf（会上传，非必要不用） |
| 路径 | `dir`/`bib`/`tex`/`pdfPath` 按工作区解析，`entry` 相对 `dir`；绝对路径与 `..` 会被拒绝。工作路径含空格与中文是正常的 |

先跑一次 `latex_doctor` 拿到真实环境，再动手。

要确认本地页图通道真的可用（验收标准 3），跑：
```
latex_doctor({ verifyPdfRead: true, pdfPath: "latex-demo/main.pdf" })
```
期望 `renderProbe.status='ok'`、`backend='poppler'`、`bytes>0`。默认 `verifyPdfRead:false` 时只报存在性，不渲染。

---

## 2. 标准开发编译循环（每一轮都必须完整走完）

1. `latex_doctor` —— 确认引擎/biber 可用（环境不全优先走 §0 一次性配齐）。
2. 小步改一处（一个段落 / 一张表 / 一个公式）。
3. `latex_build({ dir, entry })` —— 默认自动判定引擎；全部产物落在 `<dir>/.latex-studio/`（`build/` 放 PDF 与日志，`auxfiles/` 放 .aux/.bbl 等辅助文件）。**不要**在项目根建 `build/`、`aux/`：`aux` 是 Windows 保留设备名，会让复制/打包失败。
4. 看返回：
   - `status: "passed"` → 继续；
   - `status: "failed"` → **只看 `errors[0]`**（后面的多半是连锁反应），按 `file:line` 定位；
   - `status: "skipped"` → 外部件缺失，立即启动 §0 协助用户一次性配齐，**不要**假装编译过。
5. `latex_lint({ dir, entry })` —— 查伪修复、引用/标签对账、图-引用距离。外部 chktex 通道是**可选增强，默认关闭**（`config.enableChktex: true` 才跑）；返回值 `external.chktex` 三态：`used` / `skipped`（开关关）/ `unavailable`（找不到 chktex）。
6. 需要时 `bib_tool` —— 见 §4。
7. 改完再编译，最多 5 轮；仍失败就把日志尾部交给用户，不要瞎猜。

编译产物：`<dir>/.latex-studio/build/<entry>.pdf`、`<dir>/.latex-studio/auxfiles/<entry>.log`（MiKTeX 把 .log 放在辅助目录）。

---

## 3. 错误速查

| 日志 | 含义 | 处理 |
|---|---|---|
| `! Undefined control sequence.` + `l.23` | 宏包没引或命令拼错 | 补 `\usepackage` 或改拼写 |
| `File \`x.sty' not found` | 缺宏包 | MiKTeX 会带 `--enable-installer` 自动装；不行就 `mpm --install=x` |
| `! Missing $ inserted` | 数学符号跑到文本模式 | 补 `$...$` |
| `Overfull \hbox ... too wide` | 溢出 | 改列宽/断行，**不要** `\resizebox` |
| `Citation ... undefined` | 引用键不在 .bib 或没跑 bib | `bib_tool action=audit` 对账，再重新编译 |
| `Label(s) may have changed. Rerun` | 需要再跑一趟 | `latex_build` 会自动多趟，不用手点 |

---

## 4. 参考文献纪律

- **绝不编造文献**。只允许使用已存在于 .bib、或经 `bib_tool action=fill` 从 Crossref 取回的真实条目。
- 写引用前先 `bib_tool({ action: "audit", bib: "refs.bib", tex: ["main.tex"] })`，确认没有 `CITED_NOT_IN_BIB`。
- `format` / `fill` 默认**只预览**（`write: false`）；确要写回才传 `write: true`。
- 结构不完整（缺右括号）时**拒绝写入**并返回 `PARSE_INCOMPLETE`：先修结构，再写。
- 写回会先备份为 `<file>.bak`；写入后再校验，失败自动回滚。

---

## 5. 编辑纪律（禁止伪修复）

- **改一行，不要重写一节**：整节重生成会顺手改掉无关数值、引用和措辞。
- 一次只动一个语义单元。
- 不碰用户没让改的数值、结论、引用键。
- 禁用伪修复：`\resizebox` 暴力缩表、裸 `\vspace` 硬撑、`\tiny`/`\scriptsize` 缩字号、乱加 `\newpage`。`latex_lint` 会把它们标成 critical/major。
- 表格用 booktabs，列格式显式写；宽表先想 `tabularx`；公式优先 `amsmath`。

---

## 6. 交付前检查单

- [ ] `latex_build` 最近一次是 `passed`，且 `pages` 合理。
- [ ] `errors` 为空；overfull/underfull 已评估（不是每个都要修，但不能不知道）。
- [ ] `latex_lint` 无 critical/major（info 级 orphan-label 可以接受）。
- [ ] `bib_tool audit` 没有 `CITED_NOT_IN_BIB`；未引用条目已确认。
- [ ] 受保护项（引用键/标签/数字）没有被顺手改掉。
