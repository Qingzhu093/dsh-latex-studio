# dsh-latex-studio

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node: ^22.19.0 || >=24.0.0](https://img.shields.io/badge/Node-%3E%3D22.19.0%20%7C%7C%20%3E%3D24.0.0-blue.svg)](https://nodejs.org/)
[![DSH: >=0.2.0-rc.2](https://img.shields.io/badge/DSH-%3E%3D0.2.0--rc.2-purple.svg)](https://github.com/Qingzhu093/dsh-latex-studio)
[![Platform: Windows + MiKTeX](https://img.shields.io/badge/Platform-Windows%20%2B%20MiKTeX-green.svg)](https://miktex.org/)

**dsh-latex-studio** 是专为 **DeepSeek Harness (DSH) 桌面端** 打造的 MiKTeX 原生 LaTeX 编译诊断与视觉排版优化（VTO）闭环插件。

通过 **10 个原生工具** 与 **3 个专业技能**，让 AI 编写 LaTeX 文档时告别“盲写盲改”和“只管生成不管版面”，提供从 **本地多趟编译、错误行号追踪、PDF 逐页渲染看图、18 类视觉版面缺陷诊断、受限安全修复** 到 **多重门禁复核与一键回滚** 的全自动化闭环能力。

---

## 1. 为什么需要这个插件？

在长文本或学术论文写作中，大语言模型编写 LaTeX 往往面临两个根本痛点：

1. **反馈缺失（编译盲区）**：
   模型一次性输出 `.tex` 后，如果没有编译环境，根本无法知道代码能否通过编译。即使用外部脚本跑了编译，传统引擎报错日志（`.log`）动辄上千行，模型难以提取结构化的精准错误位置（哪个文件、哪一行、什么原因）。
2. **“编译通过” ≠ “可以交付/投稿”**：
   这是学术出版与专业排版最头疼的问题。**孤行寡行（Widows/Orphans）、浮动体远离正文引用、双栏下方严重空洞、Overfull 溢出黑块、表格字号凌乱、正文超预算页数** 等典型的二维版面缺陷，在源码和纯文本 `.log` 中是完全隐形的。

**dsh-latex-studio 的解决方案**：
- **精准日志诊断**：内置针对 MiKTeX / TeX 引擎的日志解析器，提供带有 `file:line` 的结构化错误与警告，让模型改错有的放矢。
- **本地视觉闭环（VTO，参考 PaperFit 方法学）**：无缝将编译出的 PDF 逐页光栅化为高保真图片送入视觉多模态通道，让模型“亲眼看到”渲染版面，配合专业 checklist 识别 18 类版面缺陷。
- **守卫门禁与反伪修复（Guard & Policy）**：严密保护内容完整性，**坚决杜绝 AI 偷删引用文献（`\cite`）、误删标签（`\label`/`\ref`）或用 `\resizebox`、硬编码 `\vspace`、滥用 `\newpage`、恶意缩字体等手段“掩盖”排版问题**。
- **带台账与自动回滚**：每一轮修复均有快照备份，门禁复核失败支持一键回滚；跨轮次持久化缺陷台账，精准捕捉问题是否复发。

---

## 2. 核心特性

- 🖥️ **MiKTeX 原生与零外部运行时依赖**：
  核心硬依赖仅需本地安装好的 **MiKTeX**。编译引擎（`pdflatex`/`xelatex`/`lualatex`）、参考文献工具（`bibtex`/`biber`）以及页图渲染后端（Poppler `pdftoppm` 与 Ghostscript `mgs.exe`）全部使用 MiKTeX 本地自带组件。**不需要额外部署 Python 环境或复杂第三方服务**。
- 🔄 **智能双路编译驱动**：
  优先探测并使用 `latexmk`（享受 `.fls` 依赖追踪与增量编译）；在没有 Perl 运行时的环境下，自动无缝回落到自研的多趟循环驱动（引擎 → 自动按需运行 bibtex/biber/makeindex → 直至 `.aux` 稳定收敛，最多 4 趟）。
- 🛡️ **严格的内容保全与原子化写操作**：
  任何写入操作（`vto_fix`）必须经过前置预检与 Diff 确认；执行写入时先备份，写入后立即比对内容键集合（`\cite`、`\label`、`\ref`、`\caption`），若有破坏或语法阻断自动安全回滚。
- 📋 **跨轮次缺陷台账（Defect Ledger）**：
  缺陷记录持久化在 `.latex-studio/state.json` 中。验证门禁能够识别“上一轮声明已修复、本轮又再次出现”的回归现象，防止模型陷入死循环。
- 🔒 **本地优先与隐私闸门（`uploadScope`）**：
  所有页图渲染均在本地完成。统一的隐私闸门机制默认采用 `external-only`，绝不擅自向云端或第三方解析服务上传您的未发表论文手稿。
- ⚙️ **完整的图形化配置表单（0.4.0+）**：
  在 DSH 桌面端的“插件”管理界面中直接提供 17 个配置项的可视化表单，支持实时修改、热保存与一键恢复默认。

---

## 2. 快速安装与环境一键配置

### 2.1 环境要求

| 依赖项 | 必需性 | 说明 | 快速安装命令（Windows PowerShell） |
|---|---|---|---|
| **MiKTeX** | **必需** | 提供编译引擎、bib 工具与 Poppler/Ghostscript 渲染组件 | `winget install MiKTeX.MiKTeX` |
| **Strawberry Perl** | 推荐 | 用于开启 `latexmk` 依赖追踪与加速（可选，缺失时自动回落内置驱动） | `winget install StrawberryPerl.StrawberryPerl` |
| **chktex** | 可选 | 用于 LaTeX 源码的语法风格静态检查 | `mpm --install=chktex` |

> 💡 **提示**：MiKTeX 首次编译包含新宏包的文档时，如果启用了 `--enable-installer`（插件默认开启），可能会联网按需下载缺失的宏包，属于正常现象。

---

### 2.2 首次使用：协助一次性全套配置（强烈推荐）

很多用户在安装插件后，因缺乏完整的编译器与组件栈而不知所措。本插件针对**首次使用**进行了专门的易用性对齐：

#### 方式 A：Agent 主动引导（会话交互）
在 DSH 桌面端对话框中直接对 Agent 发送：
> **人类输入**：“我刚装好 dsh-latex-studio 插件，请帮我检查并一次性配置好所需的全部环境。”

Agent 会自动启动 `latex_doctor` 执行整套工具链体检，若缺少依赖，**绝不进行“缺一个报一个”的碎片化骚扰**，而是主动整理并推荐全套配置方案，并在安装后运行验收闭环。

#### 方式 B：终端一键自动配置脚本
在插件目录下直接运行全套配置脚本：
```powershell
powershell -ExecutionPolicy Bypass -File tools\setup-latex-stack.ps1
```
该脚本全自动执行：
1. 自动检查并静默安装 **MiKTeX**（含 TeX 引擎、Bib 工具与 Poppler/Ghostscript 页图后端）；
2. 自动安装 **Strawberry Perl**（激活 `latexmk` 的 `.fls` 依赖追踪加速）；
3. 自动开启 MiKTeX 的 **`[MPM]AutoInstall=1`** 宏包静默补全（编译遇到新宏包全自动静默下载，免去弹窗阻断）；
4. 自动安装并配置 **chktex** 语法检查工具；
5. 自动修复当前会话与用户级环境变量 **`PATH`**；
6. 自动调用 `doctor.mjs` 打印全绿健康报告。

---

### 2.3 插件安装（推荐）

在仓库根目录下执行自带的安装脚本：

```powershell
cd <本仓库路径>\dsh-latex-studio
node tools/install.mjs
```

安装脚本会自动执行：
1. 本地安全打包（执行白名单过滤，确保纯净）；
2. 登记插件至 DSH 的 `desktop` profile；
3. 将包树镜像至运行环境并保留已有依赖；
4. 运行健康检查，安装成功后会提示重启 DSH。

> ⚠️ **注意**：安装或更新完成后，**请重启 DSH 桌面端**，以便让宿主加载最新的插件逻辑。

---

### 2.4 运行健康自检：`doctor.mjs`

在插件使用前或排查环境问题时，直接在终端运行独立体检脚本：

```powershell
node tools/doctor.mjs
```

体检脚本会逐项检查：
- 核心文件与导出完整性；
- 10 个工具与 3 个随包技能是否已正常登记；
- 图形配置项 Schemastery 兼容性；
- 本机 MiKTeX 编译器引擎路径与版本；
- 本地 Poppler（`pdftoppm`）与 Ghostscript（`mgs.exe`）页图通道是否畅通；
- BibTeX / Biber 与 chktex 工具链可用性。

**预期输出示例**：
```text
dsh-latex-studio doctor — v0.4.1
dir: D:\Documents\deepseek harness\DSH插件管理\dsh-latex-studio

  [OK  ] files      28 required files present
  [OK  ] patch      inserts the plugin row with no duplicated defaults
  [OK  ] tools      10 tools registered: latex_doctor, latex_build, latex_lint, bib_tool,
                    vto_start, vto_inspect, vto_fix, vto_verify, vto_report, vto_rollback
  [OK  ] skills     3 skills registered: latex-daily, latex-fix-catalog, latex-vto-loop
  [OK  ] volatile   17 config fields are volatile → editable in the Plugins page
  [OK  ] client     declares dsh.client (web) and exports ./client
  [OK  ] clientBundle lazy-CJS factory, requires react only, registers both config slots
  [OK  ] locale     en/zh display metadata present
  [OK  ] profile    registered in: desktop
  [OK  ] in-sync    repo and installed lib/index.js are identical
  [OK  ] shadows    no discovery root duplicates the plugin-registered skills
  [OK  ] toolchain  engine=D:\MiKTeX\miktex\bin\x64\pdflatex.exe (MiKTeX 26.5) isMiKTeX=true
  [OK  ] render     page-image backend: poppler (pdftoppm+pdfinfo)
  [OK  ] bib        bibliography tooling: bibtex, biber
  [OK  ] chktex     optional static checker available (enable with enableChktex)

verdict: HEALTHY
```

---

## 3. 两套命令体系与实战

安装插件后，**3 个操作守则技能**（`latex-daily`、`latex-vto-loop`、`latex-fix-catalog`）会自动注册并注入 DSH 会话中。用户通常只需使用自然语言向 AI 提出要求，模型即可自主组织调用相应工具链。

### 3.1 怎么用（两个真实场景）

#### 场景 A：日常编译、错误排查与文档交付

当您需要编译一篇 LaTeX 文章并修正编译报错与参考文献时：

```
用户：帮我把 paper/ 目录下的论文编译通过，参考文献也要对。

模型：latex_doctor({})                       ← 先体检，缺件会直接告诉你装什么
      latex_build({dir:"paper"})             ← 看 status / errors[{file,line}] / overfull
      …按 errors 的行号改 tex，再 latex_build…
      latex_lint({dir:"paper"})              ← 抓伪修复与引用/标签对账
      bib_tool({action:"audit", bib:"paper/refs.bib", tex:["paper/main.tex"]})
      latex_build({dir:"paper"})             ← 门禁：必须 status="passed" 才算交付
```

**判定标准**：`latex_build` 返回 `passed` 且 `errors` 为空。没有编译通过不算写完。

#### 场景 B：学术论文版面优化与压页（VTO 全流程）

当您的论文超过页数预算，需要进行视觉版面调优：

```
用户：这篇双栏论文要压到 9 页，别删内容。

模型：vto_start({dir:"paper", pageBudget:9})     ← 冻结内容基线 + 记录当前页数
      vto_inspect({dir:"paper", pages:"all"})    ← 出页图 + 机检候选 + 带阈值的 checklist
      …逐页看图，按 checklist 的 id 记录缺陷（每项带 visual_indicators 与数值阈值）…
      vto_report({dir:"paper", defects:[{id:"A5", page:3, severity:"major", evidence:"左栏空洞 34%"}]})  ← 写入台账
      vto_fix({dir:"paper", file:"main.tex", find:"…", replace:"…"})        ← apply 默认 false：只看 diff
      vto_fix({…, apply:true})                   ← 备份 → 写 → guard 校验 → 失败自动回滚
      vto_verify({dir:"paper"})                  ← 五项门禁 + verdict + regressions + rollbackTo
      vto_report({dir:"paper", verdict:"pass", changes:[…]})
```

**判定标准**：`vto_verify` 的 `verdict` 为 `pass`/`pass_with_notes`，且 `checks.contentIntegrity` 严格通过（`\cite`/`\label`/`\ref`/`\caption` 一个都没丢）。任何一轮 `contentIntegrity` 失败都先回滚，不要继续叠改动。

---

### 3.2 完整工具矩阵（10 个原生工具）

本插件提供两套命令体系，共 10 个原子工具：

#### 基础编译与静态诊断模块（Daily Tools）

| 工具名 | 核心职责 | 常用输入参数 | 关键输出 |
|---|---|---|---|
| `latex_doctor` | 环境体检 | `refresh` (刷新缓存), `verifyPdfRead` (真实测试渲染), `pdfPath` | 引擎版本、Poppler/GS 后端状态、修复命令建议 `advice[]`、渲染探针 `renderProbe` |
| `latex_build` | 全自动多趟编译 | `dir` (工程目录，必填), `entry` (入口tex), `engine` (auto/pdflatex/xelatex/lualatex), `clean` | `status` (passed/failed/skipped), `via` (latexmk/builtin), `pages`, `pdfPath`, `errors[{file,line,message}]`, `overfull[]` |
| `latex_lint` | 源码静态规则门禁 | `dir` (必填), `entry`, `rules[]` | 伪修复告警（拦截 `\resizebox`、裸 `\vspace`、滥用 `\newpage` 等）、引用/标签对账、chktex 检查结果 |
| `bib_tool` | 参考文献全面治理 | `action` (lint/format/fill/audit，必填), `bib` (必填), `tex[]`, `write` | 结构问题清单、未引用项 `uncited[]`、正文缺引项 `missingInBib[]`；**解析不完整时强制拒绝写入** |

#### 视觉排版与版面优化闭环（VTO Loop Tools）

| 工具名 | 核心职责 | 常用输入参数 | 关键输出 |
|---|---|---|---|
| `vto_start` | 初始化排版优化轮次 | `dir`, `entry`, `pageBudget` (目标页数), `template`, `columnType` | 冻结当前引用与文本哈希基线，创建 `.latex-studio/state.json` |
| `vto_inspect` | 视觉检测与页图渲染 | `dir`, `pdf`, `pages` (如 "all" 或 "1-3"), `dpi`, `focus`, `parse` | 输出页面图片 ContentBlock、18 类排版缺陷核对清单（含视觉特征与数值阈值）、机检信号候选 |
| `vto_fix` | 受限安全源码修复 | `dir`, `file`, `find`, `replace`, `apply` (默认 false 仅看 diff), `round`, `force` | 变更 Diff、策略校验违规项、内容保全验证、原子备份路径；写入失败或违规自动回滚 |
| `vto_verify` | 多重门禁综合复核 | `dir`, `entry`, `pdf`, `pages`, `pageBudget`, `round` | 重新编译复检，综合输出 `verdict` (pass/fail/pass_with_notes)、门禁项明细、**缺陷复发回归项 `regressions[]`**、回滚轮次建议 `rollbackTo` |
| `vto_report` | 沉淀轮次排版报告 | `dir`, `round`, `verdict`, `changes[]`, `defects[]`, `notes` | 生成可读 Markdown 报告与结构化 JSON 报告，持久化更新缺陷台账 |
| `vto_rollback` | 真实执行轮次文件回滚 | `dir`, `round` (目标轮次), `workDir` | 按该轮备份清单真实还原受损文件，自动删除该轮新建的文件，返回 `restored[]` 恢复清单 |

> 📌 **参数基准规则**：
> - `dir`、`bib`、`tex`、`latex_doctor.pdfPath` 均相对 **DSH 会话工作区**；
> - `entry`、`file`、`pdf` 均相对 **`dir` 所指定的工程目录**；
> - 绝对路径、盘符、UNC 路径与 `..` 越界路径一律在入口处安全拦截。

---

## 5. 配置参数说明

插件的所有 17 个配置项均支持在 DSH 侧边栏的 **插件 → dsh-latex-studio → 配置** 页面中直接可视化调整，修改即时保存。

| 配置项 | 默认值 | 作用与人类使用建议 |
|---|---|---|
| `enableDaily` | `true` | 是否加载基础编译与诊断工具（`latex_doctor`, `latex_build` 等）。修改后需重载插件生效。 |
| `enableVto` | `true` | 是否加载 VTO 视觉排版全流程工具集。修改后需重载插件生效。 |
| `uploadScope` | `'external-only'` | 隐私闸门：`external-only`（默认，绝不外发本人手稿）、`always`（允许第三方解析）、`never`（完全禁用）。 |
| `rendererOrder` | `['poppler', 'miktex-ghostscript', 'mineru-page']` | 页图渲染后端尝试顺序，按数组优先级依次降级。全部由本地优先提供。 |
| `popplerPath` | `''` | 自定义 `pdftoppm.exe` 路径，留空则自动从 MiKTeX 或系统 PATH 中探测。 |
| `ghostscriptPath` | `''` | 自定义 Ghostscript（`mgs.exe`）路径，留空则自动探测。 |
| `readPdfToolName` | `'read_pdf'` | 宿主注入的 PDF 读取工具名称。 |
| `latexCommand` | `''` | 编译命令：留空表示自动选择（检测到 Perl 则优先使用 `latexmk`，否则走内置多趟驱动）；也可显式指定 `pdflatex`、`xelatex` 等。 |
| `enableInstaller` | `true` | MiKTeX 下自动添加 `--enable-installer` 编译参数，缺失宏包时自动按需下载。 |
| `engineArgs` | `''` | 额外透传给 TeX 编译引擎的命令行参数（支持单双引号包裹）。 |
| `compileTimeoutMs`| `300000` | 单次编译最长超时时间（毫秒，默认 5 分钟），超时将自动安全终止进程树。 |
| `renderTimeoutMs` | `60000` | 单次页图渲染最长超时时间（毫秒，默认 1 分钟）。 |
| `workDir` | `'.latex-studio'` | 编译产物、辅助文件、页图、备份快照和报告的存储目录（位于工程内，不污染项目根目录）。 |
| `pageBudget` | `null` | 目标页数预算。设置后门禁将严格核对总页数是否达标。 |
| `attachImagesPerRound` | `1` | 每一轮诊断主动回传到对话窗口的页图张数。设为 `0` 可完全关闭图片回显以节省 token。 |
| `enableChktex` | `false` | 是否在 `latex_lint` 中启用外部 `chktex` 工具进行语法风格分析。 |
| `chktexPath` | `''` | 自定义 `chktex.exe` 路径，留空则自动探测。 |

---

## 6. 项目结构与目录说明

```text
dsh-latex-studio/
├── lib/
│   ├── index.js            # 插件宿主入口：按配置注册工具与技能，声明 Schema
│   ├── client.js           # 浏览器半：DSH 插件面板里的 React 配置表单
│   ├── config.js           # 配置项默认值（DEFAULTS）与运行时动态配置
│   ├── core/               # 纯 Node ESM 内核逻辑（零 DSH 依赖，方便单元测试）
│   │   ├── paths.js        # 路径安全守卫（唯一路径校验收口）
│   │   ├── env.js          # 本地编译工具链探测与环境体检报告
│   │   ├── compile.js      # 双路编译驱动（latexmk 优先 + 内置多趟收敛兜底）
│   │   ├── logparse.js     # .log 日志智能解析（文件栈跟踪、错误行号提取）
│   │   ├── lint.js         # 源码静态门禁（伪修复拦截、图表引用对账）
│   │   ├── bib.js          # 参考文献治理（结构审计、格式化与安全校验）
│   │   ├── render.js       # 本地页图渲染降级链（Poppler -> Ghostscript）
│   │   ├── guard.js        # 内容完整性保护快照与密钥泄露扫描
│   │   ├── policy.js       # FORBIDDEN 禁用排版规则差分比对
│   │   ├── state.js        # 跨轮次持久化台账、原子快照备份与回滚实现
│   │   ├── report.js       # Markdown 与 JSON 格式的轮次报告生成
│   │   └── pdfread.js      # 隐私闸门（uploadScope 控制）
│   ├── tools/              # DSH 工具接入层（唯一允许引入 @deepseek-ai/dsh-tools 的地方）
│   │   ├── daily.js        # 4 个 Daily 工具定义与注册
│   │   └── vto.js          # 6 个 VTO 工具定义与注册
│   └── data/               # 布局规范、18 类缺陷分类与阈值数据（JSON 资产）
├── skills/                 # 随包自动注册的 3 个技能守则
│   ├── latex-daily/        # 日常编译排错指南
│   ├── latex-vto-loop/     # 视觉排版循环操作规范
│   └── latex-fix-catalog/  # 排版缺陷标准修复手法目录
├── test/                   # 自动化测试用例（覆盖内核逻辑与文档契约）
├── tools/                  # 维护与发布工具（doctor、install、verify-package 等）
├── cordis.patch.yml        # 插件 Patch 声明
└── THIRD_PARTY_NOTICES.md  # 第三方开源代码与规范许可声明
```

---

## 7. 质量保证与测试

本项目内置完善的自动化测试与发布验证工具：

```powershell
# 运行全部单测（聚合运行器，要求 0 failed, 0 skipped）
npm test

# 运行特定测试（例如只测 VTO 闭环）
node test/run-all.mjs vto

# 运行安装前封装自证（模拟发布打包、解包与宿主 apply 注册验证）
npm run verify:package
```

当前测试矩阵包含 12 个测试集、149 项自动化测试，全部通过（ALL GREEN）。

---

## 8. 常见问题排查（FAQ）

### Q1: 提示 `找不到 TeX 引擎` 或编译被 skipped 怎么办？
**A**: 请确保已安装 MiKTeX，并且已将 `D:\MiKTeX\miktex\bin\x64`（或您的实际安装目录）加入系统环境变量 `PATH`。您可以直接运行 `node tools/doctor.mjs` 查看插件探测到的真实路径。

### Q2: 为什么 `latex_build` 提示回落到了内置多趟驱动？
**A**: 这是正常表现。`latexmk` 是一个 Perl 脚本，如果您的系统没有安装 Perl 解释器，插件会自动调用内置的多趟编译驱动（反复运行引擎直到 `.aux` 稳定），同样能保证多重交叉引用与页码正确收敛。若需使用 `latexmk`，只需安装 Strawberry Perl 即可。

### Q3: 为什么 `vto_inspect` 每次默认只在对话窗口贴出一张图片？
**A**: 这是出于保护大语言模型上下文窗口与控制 Token 开销的考量。多模态图片消耗的上下文非常大。如果您需要查看全部页面，可以在配置中调大 `attachImagesPerRound`，或者按工具返回的 `pages[].call` 命令针对特定页码定向阅读。

### Q4: 插件更新后怎么在 DSH 桌面端生效？
**A**: 重新执行 `node tools/install.mjs`，然后**务必完全退出并重启 DSH 桌面端**。正在运行的进程不会热重载底层的包代码。

---

## 9. 开源许可证与致谢

- 本项目采用 [MIT License](LICENSE) 开源。
- 视觉排版优化（VTO）的分类学、数值阈值与方法学参考源自论文 **PaperFit**（arXiv:2605.10341，UCAS / Shanghai AI Laboratory / SJTU，MIT 许可）。
- 详细第三方规范与代码归属声明请参阅 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

---

本项目的开发、调试与文档验证大量使用 **DeepSeek Harness** 完成，其中很多模块由 **deepseek-flash** 模型参与构建。

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)

