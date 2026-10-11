# dsh-latex-studio 交接文档

> **用途**：把本插件的后续维护 / 改进工作完整移交给另一个人或另一个会话。
> **读者假设**：熟悉 TypeScript/Node，但**不了解**本插件、也未必了解 DSH 插件体系。
> **状态**：v0.1.0 之后的一次设计修订（2026-10-11，见第 17 节），功能完整、测试全绿，已装入桌面端 profile。
> **最后核验**：2026-10-11 01:4x（Asia/Shanghai）

---

## 0. TL;DR（先读这 10 行）

- **它是什么**：一个 DeepSeek Harness（DSH）插件，把 LaTeX 编译与"排版视觉优化"变成**模型能调用、能自验证的闭环工具**，而不只是"让模型写 tex"。
- **两套命令体系**：A 线（日常编译：体检/编译/静态检查/参考文献）+ B 线（VTO 视觉排版优化闭环）。
- **9 个工具**：`latex_doctor` `latex_build` `latex_lint` `bib_tool` / `vto_start` `vto_inspect` `vto_fix` `vto_verify` `vto_report`。
- **17 个配置字段**、纯开关控制、默认隐私安全（不外传原稿）。
- **零运行时第三方依赖**（`dependencies: {}`）；内核 `lib/core/*` 完全不依赖 DSH，可独立测试。
- **测试**：`npm test` 全绿，0 跳过（需先装 devDependencies）。**具体条数不要抄文档，直接跑**——`test/docs.test.mjs` 会强制文档里的配置字段数等关键数字与代码一致。
- **宿主**：DSH `0.2.0-rc.2`（peer 已对齐）；LaTeX 侧依赖 **MiKTeX 26.5**（`D:\MiKTeX`，不在 PATH）。
- **最需要你接手的事**：第 12 节的维护配方；第 17 节记录了本轮设计修订的全部结论。
- **不要做的事**：不要用 PATH 上的 `dsh`（那是 0.1.5-rc.1，不是宿主版本）；不要用 `node --test test/`（在本机 Node 24 下会失败）。

---

## 1. 背景：为什么会有这个插件

### 1.1 起点问题

用户观察到"某个 Flash 级模型写 LaTeX 的能力很差"，提出两个问题：

1. 是 **DSH 环境**的问题，还是**模型**的问题？
2. 社区与大厂有没有现成解决方案？

### 1.2 调研结论（决定了本插件的形态）

- **不是环境问题**：本机 MiKTeX / 引擎 / 页图后端全部可用（第 6.2 节有实测矩阵）。所谓"模型写不好"，实测下来主要是**缺少可验证的反馈闭环**——模型一次生成 tex，没有"编译失败在哪一行、排版是否溢出、页数是否超预算"的结构化回传，只能盲改。
- **不是"要教模型 LaTeX"**：真正缺的是**工具化 + 可验证闭环**。
- **社区/大厂确有可借鉴方案**，但**没有一个能直接拿来用**：
  - **PaperFit**（arXiv 2605.10341，UCAS + 上海 AI Lab + SJTU，MIT）：多智能体 LaTeX 排版优化。其**6 个 agent 提示词文件（各 250–330 行）才是真正的规范蓝图**；代码是 Python + 多智能体编排，与本机（Node/DSH/MiKTeX）不兼容。
  - **OpenAI Prism / OpenDCAI OpenPrism**：闭源/研究性质，无法直接复用。
  - **dsh-latex-guard**（MIT，npm）：思路是"把现成 CLI 包成模型可见的 JSON 工具 + 优雅降级 + 拒绝写入不可解析的 .bib"。**这个模式被完整借鉴**，但其算法本身是商品化的（`check`/`bib-lint`/`bib-fill` 与 texlogsieve、biber --tool、bibtex-tidy、betterbib 高度重叠）。

### 1.3 因此的取舍

| 决策 | 理由 |
|---|---|
| **重写，不 vendors 代码** | PaperFit 的 Python 编排与 DSH 插件模型不兼容；只把它的**规则数据**（MIT）转成 JSON 资产 |
| **直接 vendor 规则数据** | VTO 分类法/布局规则/写作规则是真正的领域知识，重造没有意义 |
| **一个插件，不拆包** | 官方指南明确"不要预防性拆分，只有角色需要独立演进时才分包" |
| **不引入 Tectonic** | 用户明确否决：会提高系统复杂度 |
| **不依赖 latexmk** | 本机 latexmk 需要 Perl，不可用（实测） |

---

## 2. 它是什么 / 不是什么

**是**：

- 一个 **DSH bundle（组合包）**：`package.json` 声明 `dsh.bundle.patch`，装载时把一行插件插进 profile 的插件树。
- 一个**能力消费者**：只使用宿主已有的 `tools` 服务（可选桥接宿主自带的 `read_pdf` 工具）。
- 一套**可验证闭环**：编译有结构化错误、渲染有页图、改动有内容保全基线、修复有回滚。

**不是**：

- **不是客户端插件**：没有 UI 半边，不需要重建 Web 前端。
- **不是 LaTeX 发行版管理器**：只调用 MiKTeX；不负责安装 TeX。
- **不是排版算法库**：视觉判断交给模型（看页图），插件负责"渲染 + 度量 + 守门"。
- **不是 PDF 解析器**：结构化 PDF 解析**委托给 MinerU 插件**（`read_pdf`），不重复造轮子。

---

## 3. 架构

### 3.1 分层（重要：这是本项目的核心不变量）

```
┌──────────────────────────────────────────────────────────────┐
│ lib/tools/daily.js         lib/tools/vto.js                  │  ← 唯一允许 import
│ 9 个 defineTool 注册；入参校验；presentCall/presentResult      │    @deepseek-ai/dsh-tools
└───────────────────────┬──────────────────────────────────────┘    与 ctx 的地方
                        │  纯函数调用，传 config
┌───────────────────────▼──────────────────────────────────────┐
│ lib/core/*.js  (env, compile, lint, bib, render, guard,       │  ← 零 DSH 依赖
│                 policy, state, report, logparse, pdfread,     │    可被 node --test 直接测
│                 paths)                                        │
└───────────────────────┬──────────────────────────────────────┘
                        │  读规则数据
┌───────────────────────▼──────────────────────────────────────┐
│ lib/data/  vto_taxonomy.json + diagnostic_report.template.md  │  ← vendored 自 PaperFit (MIT)
│            （其余 5 个 JSON 目前无人读取，见第 17 节）           │
└──────────────────────────────────────────────────────────────┘
```

**铁律**：`lib/core/*` 永远不 import DSH；`lib/tools/*` 永远不写业务逻辑。
这样做的好处是 **绝大部分代码可以在没有 DSH 的环境里测试**，也是测试能跑起来的前提。

### 3.2 目录地图

> 行数**有意不写**：它每改一次代码就过期一次，而"实测行数"的价值远低于它带来的
> 误导成本（本表曾把 12 个文件里的 7 个写错，并漏掉了新模块）。需要行数就直接 `wc -l`。

```
dsh-latex-studio/
├── package.json                bundle manifest + peer/dev 契约
├── cordis.patch.yml            只 insert 一行插件，**不携带 config**（见 5.4）
├── lib/
│   ├── index.js                插件入口：Config schema + 同步 apply()
│   ├── config.js               DEFAULTS + normalizeConfig()
│   ├── core/                   ← 零 DSH 依赖
│   │   ├── paths.js            路径守卫的**唯一实现**（工作区相对 + 容器性判定）
│   │   ├── voidetect.js        页图机检：A5 列空洞 + 页级度量（PaperFit detect_column_void 移植）
│   │   ├── env.js              工具链探测（含 MiKTeX 目录回退）
│   │   ├── compile.js          多趟编译驱动（不用 latexmk）
│   │   ├── lint.js             静态规则 + chktex 三态
│   │   ├── bib.js              BibTeX 解析/lint/format/fill/audit
│   │   ├── render.js           页图渲染（poppler → mgs → mineru）
│   │   ├── guard.js            内容保全基线（sha256 快照/比对）
│   │   ├── policy.js           禁用修复手法检测（FORBIDDEN）
│   │   ├── state.js            .latex-studio 状态、备份、回滚
│   │   ├── report.js           轮次报告渲染
│   │   ├── logparse.js         引擎日志解析（错误行号/overfull、.aux 指纹）
│   │   └── pdfread.js          隐私门 + read_pdf 桥接
│   ├── tools/
│   │   ├── daily.js            A 线 4 个工具
│   │   └── vto.js              B 线 5 个工具
│   └── data/                   ← vendored 规则数据（MIT）
│       ├── vto_taxonomy.json   5 类 / 18 缺陷 / 3 严重级 / 7 技能路由  ← 被 vto_inspect 读取
│       ├── diagnostic_report.template.md                              ← 被 vto_report 读取
│       └── templates / content_boundaries / writing_rules / agent_roles / layout_rules .json
│                               【目前无人读取】见第 17 节
├── skills/
│   ├── latex-daily/SKILL.md
│   ├── latex-vto-loop/SKILL.md
│   └── latex-fix-catalog/SKILL.md    ← 修复手法目录（也是数据）
├── test/
│   ├── config.test.mjs         配置契约守卫（schema ≡ DEFAULTS；patch 不得再带 config）
│   ├── docs.test.mjs           文档可追溯性守卫（字段数/布局名/模块地图/UTF-8）
│   ├── daily.test.mjs          A 线
│   ├── vto.test.mjs            B 线
│   ├── voidetect.test.mjs      机检：PNG 解码 / Otsu / 投影 / 空洞分段 / 真实页图行高
│   ├── skillpack.test.mjs      技能自注册（解析 / 注册形状 / 缺技能服务时的降级）
│   ├── vendored-specs.test.mjs 上游规范树的来源哈希与防漂移
│   ├── tools.test.mjs          doctor / install 的行为守卫
│   └── run-all.mjs             聚合运行器（不是 node:test 目录模式）
├── tools/
│   ├── install.mjs             ★ 一条命令安装：pack → 注册 profile → 镜像 → 自检
│   ├── doctor.mjs              ★ 健康自检：文件/注册/profile/影子技能/工具链
│   ├── verify-pdf-read.mjs     页图通道体检（纯 Node，三态结论）
│   ├── vendor-paperfit-specs.mjs 可复现地 vendor 上游规范 + 来源哈希
│   └── _p0/                    【不在发布白名单】调研证据，有意不发布
└── docs/
    ├── INTERFACES.md           对外契约（**已知滞后**，见第 17 节 G4）
    ├── ACCEPTANCE.md           验收记录（含真实输出，数字部分已过期）
    ├── P0-PROBES.md            P0 探针原始输出
    ├── paperfit-notes.md       PaperFit 调研笔记 / 丢弃清单
    ├── DESIGN-REVIEW.md        本轮设计审阅与目标设计（第 17 节的展开）
    └── HANDOFF.md              ← 本文
```

### 3.3 A 线一次调用的数据流

```
模型调用 latex_build({dir:"paper"})
  → workspaceRelativePath() 校验（必须工作区内相对路径）
  → env.probeEnv() 找引擎（PATH → MiKTeX bin 目录回退）
  → compile.build():
       第 1 趟 引擎 → 写 .latex-studio/auxfiles/
       若有 \cite/\bibdata → bibtex 或 biber（不另计趟数）
       再跑至 .aux 指纹稳定（最多 4 趟**引擎**运行；指纹为空不算稳定）
  → logparse.parse() 抽 errors(含 file:line) / overfull / underfull / 缺引用
  → 返回 {status, engine, passes, pages, pdfPath, errors[], warnings[], …}
     其中 passes = 引擎运行次数，bibtex/biber 那一次记在 bib 字段
```

### 3.4 VTO 闭环的数据流（硬约束优先级是设计核心）

**硬约束优先级**（来自 PaperFit 论文，**不可违反**）：
```
内容保全  >  编译/渲染成功  >  页数预算  >  视觉质量  >  改动最小化
```

```
vto_start    → 冻结内容基线（\cite/\label/\ref/\caption 键 + 每文件 sha256）+ 页数基线
               → 写 <proj>/.latex-studio/state.json
vto_inspect  → 渲染页图（poppler → MiKTeX mgs → mineru-page 逐个降级）
               → 返回 18 项 checklist + 逐页度量（尺寸/字节）
vto_fix      → 备份 → 写入 → guard 校验基线 → 失败自动回滚
               → 拒绝禁用手法（\resizebox / 裸 \vspace / 滥用 \newpage / \tiny / \scriptsize）
vto_verify   → 五项 checks：compile / render / contentIntegrity / pageBudget / policy
               → verdict: pass | pass_with_notes | fail | continue（+ rollbackTo）
vto_report   → 写 reports/round-<n>.{md,json}
```

**状态全部落在 `<项目>/.latex-studio/`**：

```
.latex-studio/
├── state.json          轮次/基线/开关
├── build/main.pdf      编译产物
├── auxfiles/           .aux/.log/.bbl（**不叫 aux**——Windows 保留设备名，会失败）
├── pages/page-001.png  页图
├── reports/round-N.*   轮次报告
└── backups/rN/         每轮修复前备份
```

---

## 4. 工具面（9 个）

### 4.1 A 线：日常编译（4 个）

| 工具 | 作用 | 关键参数 | 关键输出 |
|---|---|---|---|
| `latex_doctor` | 环境体检：探测 pdflatex/xelatex/lualatex/bibtex/biber/poppler/ghostscript/mineru/python/node | `refresh`, `verifyPdfRead`, `pdfPath` | `status`, 各探测项版本/路径, `advice[]`, `renderProbe{status,backend,bytes}` |
| `latex_build` | 多趟编译（引擎 → bibtex/biber → 至 .aux 稳定，最多 4 趟） | `dir`, `entry`, `engine`(auto), `clean` | `status/engine/passes/pages/pdfPath`, `errors[{file,line,message}]`, `overfull[]`, `underfull[]`, `missingCitations[]` |
| `latex_lint` | 静态检查：禁用伪修复、引用-标签对账、图-引用距离、chktex | `dir`, `entry`, `rules[]` | `findings[]`, `protected`（引用键/标签/数字 token 清单）, `external` |
| `bib_tool` | 参考文献四动作 | `action: lint\|format\|fill\|audit`, `bib`, `tex[]`, `write` | `issues[]`, `missingInBib[]`, `uncited[]`, `external`(bibtex-tidy/biber --tool) |

**`bib_tool` 的安全语义**：`.bib` **不可解析时拒绝写入**（返回 `PARSE_INCOMPLETE`），绝不"猜着改"；`fill` 走 Crossref **只补不覆盖**。

### 4.2 B 线：VTO 视觉排版优化闭环（5 个）

| 工具 | 作用 | 关键参数 | 关键输出 |
|---|---|---|---|
| `vto_start` | 建基线（内容 sha256 冻结 + 页数基线） | `dir`, `entry`, `pageBudget`, `template`, `columnType`, `workDir` | `statePath`, 基线摘要 |
| `vto_inspect` | 渲染页图 + 18 项 checklist + 度量 | `dir`, `pdf`, `pages`, `dpi`, `focus`, `parse`(是否走 MinerU，会上传), `consent` | 页图 ContentBlock, `checklist`, `metrics` |
| `vto_fix` | 备份→写入→guard→失败回滚 | `dir`, `file`, `find`, `replace`, `edits[]`, `apply`(默认 false=预览), `rationale`, `force` | `applied`, `diff`, `guard`, `policy` 预检, `rollbackTo` |
| `vto_verify` | 五项复核 + verdict | `dir`, `entry`, `pdf`, `pages`, `pageBudget`, `round`, `dpi` | `verdict`, `checks{compile,render,contentIntegrity,pageBudget,policy}`, `regressions[]`, `rollbackTo` |
| `vto_report` | 落盘轮次报告 | `dir`, `round`, `verdict`, `changes[]`, `remaining[]` | `mdPath`, `jsonPath` |

### 4.3 全体工具共同遵守的约定

1. **路径按基准解析**：`dir`/`bib`/`tex`/`pdfPath` 工作区相对；`entry`/`file`/`pdf` 相对 `dir`（`resolveProjectPath` 收口）；绝对路径、盘符、UNC、`..` 一律拒绝（`INVALID_PATH`）。传错基准会给出「应传什么」的 advice。**注意**：宿主传入含正斜杠的 `cwd` 时曾误判，已修（用 `path.relative` 判包含性）。
2. **缺外部件一律优雅降级**：返回 `status:"skipped"` + `reason` + `advice[]`，**绝不抛异常**。
3. **`vto_fix` 默认不写盘**（`apply:false` 只给配方+diff+预检）。
4. **presentCall / presentResult** 负责给 UI 卡片；工具返回结构化 JSON 供模型消费。

---

## 5. 配置契约（17 个字段）

### 5.1 字段表

| 字段 | 默认 | 说明 |
|---|---|---|
| `enableDaily` | `true` | A 线总开关 |
| `enableVto` | `true` | B 线总开关 |
| `uploadScope` | `external-only` | 隐私门：`external-only\|always\|never` |
| `rendererOrder` | `[poppler, miktex-ghostscript, mineru-page]` | 页图后端尝试顺序 |
| `popplerPath` | `''` | `''` = 自动（PATH + MiKTeX bin 目录） |
| `ghostscriptPath` | `''` | 同上（对应 `mgs.exe`） |
| `readPdfToolName` | `read_pdf` | 宿主 MinerU 工具名（桥接用） |
| `latexCommand` | `''` | `''` = 自动选引擎；**latexmk 会被忽略并给 advice** |
| `enableInstaller` | `true` | MiKTeX 自动补包 |
| `engineArgs` | `''` | 额外引擎参数 |
| `compileTimeoutMs` | `300000` | 编译超时 |
| `renderTimeoutMs` | `60000` | 单次渲染超时 |
| `workDir` | `.latex-studio` | 状态目录名（**必须是工程内相对目录**，见下） |
| `pageBudget` | `null` | 页数预算（`null` = 不限） |
| `attachImagesPerRound` | `1` | 每轮回传页图数（**改 0 可关掉图片通道**，见第 17 节 D3） |
| `enableChktex` | `false` | 可选：chktex 外部校验 |
| `chktexPath` | `''` | `''` = 自动 |

> `test/docs.test.mjs` 会断言本节声明的字段数与 `lib/config.js` 的 `DEFAULTS` 一致。
> 改字段数请同时改这里，否则测试会红——这是**有意**的。

**已删除的三个字段**（曾经存在但没有任何代码读取，见第 17 节）：`maxRounds`、
`enableFixerSidecar`、`enableSemanticTuning`。"声明了却什么都不做"比"没有这个字段"更糟：
用户会以为自己配上了。轮次上限改由 `lib/core/state.js` 的 `DEFAULT_MAX_ROUNDS` 常量表达，
且**没有工具会强制它**（循环是模型驱动的），这一点已写进 `skills/latex-vto-loop`。

**`workDir` 的新约束**：它必须是工程目录内的相对目录名。`resolveWorkDir()` 会拒绝绝对路径、
盘符、UNC 与 `..` 并回退到 `.latex-studio`。原因很硬：这个值会流到 `ensureDirs()`、
`writeAtomic()`，并经 `latex_build({clean:true})` 流到 `rmSync(..., {recursive:true})`。

### 5.2 两个开关 = 两个命令体系

- 两个都关 → **0 个工具注册**（插件仍在，只是空转）。
- 只开 `enableDaily` → 4 个 A 线工具。
- 只开 `enableVto` → 5 个 B 线工具。
- 这也是验收项之一（`ACCEPTANCE.md` 里有开关矩阵实测）。

### 5.3 隐私模型（重要）

- 默认 `uploadScope: "external-only"` → **自己的原稿永不上传**。
- 视觉通道优先用**本地**后端：Poppler 与 MiKTeX 自带 Ghostscript，**零额外安装**。
- 只有显式 `vto_inspect({parse:true, consent:true})` 才会把 PDF 交给 MinerU（走 `official-v4`，即上传到 mineru.net）。
- MinerU 侧有 SHA-256 缓存，同一文档不会重复上传。

### 5.4 ✅ 配置只有两处，且不再需要"三处同步"

**旧规则（已废除）**：同一个字段必须同时存在于 `lib/config.js` 的 `DEFAULTS`、
`lib/index.js` 的 `Config` schema **和** `cordis.patch.yml`。

**为什么废除**：官方规则是"**patch 整份替换 `config`、不深合并**"。旧设计因此把全部默认值
也抄进了 `cordis.patch.yml`；结果任何人在自己的 profile patch 里只覆盖**一个**字段，
其余字段就被整份替换掉、静默丢失。这不是"要小心"能解决的，是结构错误。

**现在的规则**（两处，且由测试钉死）：

1. `lib/index.js` 的 `Config` schema —— **真实宿主唯一生效处**，默认值写在 `.default()` 里。
2. `lib/config.js` 的 `DEFAULTS` —— 内核与测试用，必须与 schema 一致。

`cordis.patch.yml` **只 insert 一行插件，不带 `config:`**；`test/config.test.mjs` 用
`assert.doesNotMatch(body, /^\s*config:/m)` 明确禁止它回来。因为 schema 的 `.default()`
本来就会补齐所有缺省字段，那份拷贝从头到尾都是多余的。

> 仍然要记住的两条官方行为：
> - **未声明的字段在 `apply` 之前被直接丢弃**（症状是"配了没反应"且无报错）。加字段必须同时改上面两处。
> - schemastery 3.18.4 里**值解析为 `null` 的字段在校验结果里"键不存在"**（不是 present-with-null），
>   所以 `apply` 里必须走 `normalizeConfig()` 兜底，这不是冗余。
> - schemastery 没有 strict 模式，**配置里的未知键会被静默忽略**；删字段时尤其要注意（见第 17 节）。

---

## 6. 外部依赖矩阵

### 6.1 必需 / 自带 / 可选

| 组件 | 必需性 | 说明 |
|---|---|---|
| **Node** | 必需 | `^22.19.0 \|\| >=24.0.0`（本机 24.20/24.21） |
| **MiKTeX** | **必需** | 提供 pdflatex/xelatex/lualatex/bibtex/biber |
| **Poppler**（`pdftoppm`/`pdfinfo`） | 随 MiKTeX 自带 | `D:\MiKTeX\miktex\bin\x64\` |
| **Ghostscript**（`mgs.exe` 9.25） | 随 MiKTeX 自带 | 同上 |
| **Perl** | **不需要** | 所以不用 latexmk |
| **MinerU 插件**（`dsh-pdf-mineru`） | 可选 | 只在要结构化解析 PDF 时用（会上传） |
| **任何 npm 运行时依赖** | **无** | `dependencies: {}` |

### 6.2 本机实测环境（2026-10-11）

```
宿主          DeepSeek Harness 0.2.0-rc.2（Electron 桌面端）
Node          v24.20.0（用户）/ v24.21.0（桌面端自带）
Python        3.12.14（运行时目录）/ 3.14（用户）
MiKTeX        D:\MiKTeX  —— 26.5，**不在 PATH**
  pdflatex    D:\MiKTeX\miktex\bin\x64\pdflatex.exe   (pdfTeX 4.27 / MiKTeX 26.5)
  biber       D:\MiKTeX\executables\windows-x64\biber\biber.exe
  pdftoppm    D:\MiKTeX\miktex\bin\x64\pdftoppm.exe   (24.04.0)
  mgs.exe     D:\MiKTeX\miktex\bin\x64\mgs.exe        (Ghostscript 9.25)
  chktex      D:\MiKTeX\miktex\bin\x64\miktex-chktex.exe
MiKTeX 补包   已实测：缺 gnuplottex 时编译 exit 0 并自动装上（15.1s 含下载）
profile       C:\Users\wangy\.dsh\profiles\desktop  （Electron 独占管理）
```

> ⚠️ **PATH 上的 `dsh` 是 0.1.5-rc.1，不是宿主版本**。安装/查询一律用
> `D:\DshDesktop\resources\runtime\cli\bin\dsh.cmd`（0.2.0-rc.2）。

---

## 7. 数据资产：VTO 分类法（`lib/data/vto_taxonomy.json`）

**5 大类 / 18 个缺陷 / 3 个严重级 / 7 条技能路由**（vendored 自 PaperFit，MIT）：

| 类 | 名称 | 缺陷 |
|---|---|---|
| **A** | 空间利用缺陷 | A1 孤行/寡行(major) · A2 末页大面积留白(major) · A3 页数预算违反(**critical**) · A4 双栏末页左右栏高度不齐(minor) · A5 双栏页内列竖向空洞(major) |
| **B** | 浮动体缺陷 | B1 浮动体远离首次引用(major) · B2 浮动体大小不适配栏宽(major) · B3 浮动体连续堆叠(minor) · B4 浮动体跨页分裂(minor) |
| **C** | 排版一致性缺陷 | C1 表格字号不统一(minor) · C2 图片分辨率/风格不一致(minor) · C3 Caption 格式不统一(minor) |
| **D** | 溢出与对齐缺陷 | D1 Overfull hbox(major) · D2 长公式未合理断行(major) · D3 URL/长标识符溢出(minor) |
| **E** | 跨模板迁移缺陷 | E1 单栏↔双栏图表尺寸失配(**critical**) · E2 页数预算不匹配(**critical**) · E3 模板特定宏兼容性(**critical**) |

**严重级语义**：`critical` = 必须修复（不修不符合投稿要求）/ `major` = 强烈建议 / `minor` = 时间充裕再修。

**7 条技能路由**：`space-util-fixer` · `float-optimizer` · `fullwidth-fixers` · `consistency-polisher` · `overflow-repair` · `template-migrator` · `semantic-micro-tuning`

每个缺陷对象含：`description` / `detection{visual_indicators, log_signals, page_image_required}` / `fix_strategy{primary_skill, approaches}` / `evaluation_metric`。

---

## 8. 关键设计决策（含被否决方案）

| # | 决策 | 理由 |
|---|---|---|
| 1 | **不用 latexmk**，自研多趟驱动 | 本机 latexmk 报 "could not find the script engine 'perl'" |
| 2 | **内核零 DSH 依赖** | 让绝大部分代码可独立测试；`lib/tools/*` 是唯一桥接层 |
| 3 | **`apply` 必须同步** | ⚠ **原理由已被推翻**：工具目录是在**每个模型步骤前的组装**时物化的，"启动时快照、注册晚了就落空"**不成立**（见第 15 节）。同步 `apply` 保留为**稳妥**而非必需；E5 的真因是 PENDING（组合缺 `dsh-system-prompt`） |
| 4 | **一个插件 + 两个开关** | 用户明确否决"分成两个插件" |
| 5 | **本地页图优先，MinerU 仅兜底** | 零额外安装；默认不外传原稿 |
| 6 | **内容保全优先** | guard 用 sha256 冻结 `\cite/\label/\ref/\caption` 键与文件，任何修复不得破坏内容 |
| 7 | **拒绝禁用修复手法** | `\resizebox` / 裸 `\vspace` / 滥用 `\newpage` / `\tiny` / `\scriptsize` 被 policy 拦截（PaperFit 同样禁止） |
| 8 | **状态目录不叫 `aux`** | Windows 保留设备名，`Copy-Item` 会失败 → 用 `auxfiles/` |
| 9 | **零运行时依赖** | 避免供应链与版本漂移；只用 Node 内置模块 + 宿主 peer |
| 10 | **数据 vendor、代码重写** | 领域知识值得复用，Python 编排不可复用 |
| 11 | **不做客户端半边** | 不需要重建 Web 产物；工具卡片用 `presentCall` 即可 |
| 12 | **不 vendors PaperFit 的 `.claude/**、render_pages.py、测试夹具、TUI 向导、安装器、session_logger** | 见 `docs/paperfit-notes.md` 的丢弃清单与理由 |

---

## 9. 与 DSH 官方规范的一致性（`develop/*` 18 页对照）

| 官方规则 | 本插件状态 |
|---|---|
| 插件 = 导出 `apply(ctx, config)` | ✅ 函数形态 |
| `inject` 声明必需服务 | ✅ `inject = ['tools']` |
| `Config` 必须是 Schemastery schema（不能导普通对象） | ✅ 已对齐并加守卫测试 |
| 默认值只写一处（schema），patch 不带 `config` | ✅ 见 5.4（旧设计的"三处同步"已废除） |
| 无硬编码可调参数 | ✅ 17 个字段覆盖路径/超时/开关（3 个死字段已删） |
| 配置错误要响亮 | ✅ schema 校验失败即加载失败；⚠ 但 schemastery **无 strict 模式**，未知键静默忽略 |
| 注册即 effect，卸载自动清理 | ✅ 依赖 `ctx.tools.register` 的内建行为 |
| bundle 用 `dsh.bundle.patch` + `- insert: [{id, name}]`，`name` 填**包名** | ✅ `cordis.patch.yml` 合法（已用 js-yaml 实测解析） |
| patch 按 `id` 覆盖且**整份替换 config** | ✅ 正因如此，bundle patch **不带 config**；默认值只由 schema 提供（5.4） |
| 需共享实例的 dsh 包同时进 `peerDependencies` 与 `devDependencies` | ✅（`dsh-tools` 在两边；`cordis` 为 optional peer） |
| tarball 交付是官方支持的 | ✅ `npm pack` → `dsh plugin add ./x.tgz` |
| 不要预防性拆分能力 | ✅ 单包 |

---

## 10. 测试与验收

### 10.1 怎么跑

```powershell
cd "D:\Documents\deepseek harness\DSH插件管理\dsh-latex-studio"
npm install --legacy-peer-deps     # 首次：拉 0.2.0-rc.2 全套 peer（需能访问 registry）
npm test                            # = node test/run-all.mjs
```

### 10.2 当前基线

**不要抄这里的数字**——抄一次就过期一次，而"文档说 78/78、实际不是"正是本项目最贵的故障类型。
跑 `npm test`，它会打印真实的文件数/条数/跳过数。当前**文件构成**（相对稳定）：

```
PLAIN TEXT
test/config.test.mjs    配置契约守卫（schema ≡ DEFAULTS；patch 不得带 config）
test/docs.test.mjs      文档可追溯性（字段数 / 布局名 / 模块地图 / 禁止三处同步）
test/daily.test.mjs     A 线：环境探测/编译/日志解析/lint/bib/路径守卫/会话 cwd
test/vto.test.mjs       B 线：state/guard/policy/render/9 工具端到端
判定标准：0 failed 且 0 skipped
```

> **为什么强调 0 skipped**：`daily.test.mjs` 通过 `node:module` resolve hook 把
> `@deepseek-ai/dsh-tools` 映射成 stub；该 hook **同时作用于 `createRequire`**，所以这个文件
> **无法**用真实 `defineTool` 校验自己的定义（试过，会静默拿到 stub）。
> 真实 `defineTool` 的覆盖在 `test/vto.test.mjs`（2 条端到端），A 线的真实覆盖靠**运行时**：
> `cordis_inspect_query(host, Tool, listTools)` 能看到 9 个工具即证明注册成功。
> 该文件里有一条测试专门在 stub 导入失败时变红，防止"全跳过还报 ALL GREEN"。

### 10.3 其他验证入口

| 命令 | 作用 |
|---|---|
| `node tools/doctor.mjs` | **健康自检**：文件 → `apply()` 注册 9 工具 + 技能包 → profile 登记 → 影子技能 → 工具链。退出码 0/1/2；`--json` 给 CI |
| `node tools/install.mjs` | **一条命令安装/升级**：pack → 备份并注册 profile → 镜像 → 跑 doctor 验证。`--dry-run` 只看计划 |
| `node tools/verify-pdf-read.mjs --pdf ../latex-demo/.latex-studio/build/main.pdf` | 页图通道三态体检（OK / NO-LOCAL-BACKEND / NO SAMPLE PDF） |
| `docs/DESIGN-REVIEW.md` | 设计依据与取舍（为什么保留视觉通道、机检与页图的分工） |
| `docs/ACCEPTANCE.md` | 逐条验收 + 真实输出（**数字部分已过期**，以 `npm test` 为准） |
| `docs/P0-PROBES.md` | P0 探针原始输出（环境事实的证据链） |

### 10.4 测试写法约定（踩坑记录）

- **不要用 `node --test test/`**（目录参数）：本机 Node 24 + Windows 会报 `Cannot find module ...\test` 并 exit 1。用 `run-all.mjs` 或单文件。
- **测试必须自建夹具**：早期测试依赖 `latex-demo/main.log`、`main.pdf`、`refs-broken.bib` 等历史产物，清理 demo 就会变红。现已全部改为在 temp 目录自造（含自写最小合法 PDF）。**新增测试请沿用这个原则。**
- 后端可用性判定要用 `lib/core/env.js` 的 `resolveTool()`（它会查 MiKTeX 目录），**不要只查 PATH**——`D:\MiKTeX` 不在 PATH 上，只查 PATH 会误判"后端缺失"。

---

## 11. 安装 / 升级 / 卸载 / 发布

### 11.1 组件路径

| 项 | 路径 |
|---|---|
| 源码仓库 | `D:\Documents\deepseek harness\DSH插件管理\dsh-latex-studio\` |
| 发布产物 | `…\dsh-latex-studio\dsh-latex-studio-0.1.0.tgz`（157,879 B） |
| 已安装副本 | `C:\Users\wangy\.dsh\profiles\desktop\node_modules\dsh-latex-studio\` |
| profile 清单 | `C:\Users\wangy\.dsh\profiles\desktop\package.json`（`dsh.profile.bundles` 含 `dsh-latex-studio`） |
| 备份 | `…\profiles\desktop\package.json.bak-latexstudio` |

### 11.2 安装（四条路，按可靠性排序）

**(a) `node tools/install.mjs`（★ 现在推荐）** —— 打包 → 备份并注册 profile → 镜像 → **跑 doctor 验证**。
失败会报错并打印回滚命令，不会留下"以为装好了"的状态。

**(b) 应用内插件管理器** —— Electron 独占管理 desktop profile，这是官方通道。

**(c) 手工安装（本机实测可靠）**

```powershell
# 1) 把依赖写进 profile 清单
#    在 profiles\desktop\package.json 的 dependencies 加：
#      "dsh-latex-studio": "file:D:/…/dsh-latex-studio-0.1.0.tgz"
# 2) 把包名追加到 dsh.profile.bundles 数组
# 3) 把源码复制进安装副本
Copy-Item "<repo>\lib" -Destination "<installed>" -Recurse -Force
# …skills / docs / test / tools / cordis.patch.yml / package.json / README.md 同理
# 4) 校验
& "D:\DshDesktop\resources\runtime\cli\bin\dsh.cmd" plugin list --profile desktop
```

**(d) CLI** —— `dsh plugin --profile desktop add ./x.tgz`。**本机实测会挂起**（Electron 托管 profile 的限制），不推荐。

### 11.3 升级流程（改完代码必做）

```powershell
cd "<repo>"
npm test                 # 必须全绿、0 跳过
node tools/install.mjs   # 打包 + 注册 + 镜像 + 自动跑 doctor 验证
```

`tools/install.mjs` 已包含旧的 11.3 手工程序（绕开 `~/.npmrc` 死代理、清旧 tgz、重新打包、
复制到安装副本）以及 11.4 的一致性校验，失败会报错并给出回滚命令。旧手工步骤（保留备查）：

```powershell
$env:npm_config_userconfig = "$env:TEMP\clean-npmrc"   # 绕开 ~/.npmrc 死代理
Remove-Item *.tgz -Force
npm pack
# 然后复制到安装副本（同 11.2(c) 第 3 步）
```

### 11.4 部署后自检（必做）

```powershell
node tools/doctor.mjs --dir "<installed>"   # 期望 verdict: HEALTHY，退出码 0
node tools/doctor.mjs --json                # CI 用
```

doctor 会一次性覆盖下面这些原本要手工做的检查（保留旧手工片段备查）：

```powershell
# 1) 仓库与安装副本一致性
(Get-FileHash "<repo>\lib\index.js" -Algorithm SHA256).Hash
(Get-FileHash "<installed>\lib\index.js" -Algorithm SHA256).Hash   # 应相同

# 2) 安装副本能否同步注册 9 个工具
cd "<installed>"
node --input-type=module -e "
const m = await import('./lib/index.js');
const tools = new Map();
const res = m.apply({ logger:{info(){},warn(){},error(){}}, tools:{register(t){tools.set(t.name,t)}}, get(){return undefined} }, {});
console.log('sync:', !(res&&res.then), '| registered:', JSON.stringify(res.registered), '| tools:', tools.size);
"
# 期望：sync: true | registered: ["daily","vto"] | tools: 9
```

### 11.5 卸载

```powershell
# 官方：dsh plugin --profile desktop remove dsh-latex-studio   （同时移除依赖与插件层）
# 手工：从 profile package.json 删除依赖与 bundles 条目，删除安装副本目录
```

---

## 12. 维护手册：常见改动怎么做

### 12.1 加一个工具
1. 在 `lib/tools/daily.js`（A 线）或 `lib/tools/vto.js`（B 线）里 `defineTool({...})` 并 `ctx.tools.register(...)`。
2. 业务逻辑写进 `lib/core/*.js`（保持零 DSH 依赖），工具层只做入参校验与渲染。
3. 更新 `docs/INTERFACES.md`（冻结契约）。
4. 加测试到对应 `test/*.test.mjs`。
5. 跑 `npm test`，然后走第 11.3 节打包部署。

### 12.2 加一个配置字段 —— **只改两处**
1. `lib/index.js` → `Config` schema，默认值写在 `.default()` 里（**真实宿主唯一生效处**）
2. `lib/config.js` → `DEFAULTS`（内核与测试用；必须与 schema 一致）
3. **不要**往 `cordis.patch.yml` 里加 `config:`——`test/config.test.mjs` 会直接判失败
4. 跑 `node --test --test-reporter=spec test/config.test.mjs test/docs.test.mjs`
   （前者抓 schema↔DEFAULTS 漂移，后者抓文档里的字段数没跟着改）
5. 在 `README.md` 第 3 节的配置表补一行（`test/docs.test.mjs` 会校验表里没有不存在的字段）

**加字段前先问一句：真的需要它是可配置的吗？** 官方约定是"不同部署可能取不同值的参数才做配置字段"。
`maxRounds`/`enableFixerSidecar`/`enableSemanticTuning` 就是反面教材：声明了、写进了文档、
真实宿主里也能设，但**没有任何代码读取**——用户以为配上了。这种字段应当删掉而不是保留。

### 12.3 改 VTO 规则 / 分类法
- 数据在 `lib/data/*.json`（**唯一形态**）：上游 YAML 与当年用过一次的转换脚本都**已不在仓库**，不要去找、也不要重跑转换。
- 每份数据都必须有代码消费者，否则移出发布集（0.2.0 移除了 `_meta.json`，其余 4 份接上了用途，见 `test/` 与 HANDOFF §17.3）。
- 改上游规范文本请用 `node tools/vendor-paperfit-specs.mjs --from <paperfit-cli 目录>`，
  它会重写 `docs/upstream/paperfit/MANIFEST.json`（含逐文件来源 sha256）；`--check` 在漂移时失败。
- 改动分类法后**同步** `skills/latex-fix-catalog/SKILL.md`（修复手法目录，既是文档也是路由表）。
- 数据来源与许可记录在 `THIRD_PARTY_NOTICES.md`（**没有** `_meta.json` 了：它记录的是绝对路径，不可移植）。

### 12.3b 技能：由插件自注册（改了 `skills/` 不需要额外步骤）
`apply()` 里 `ctx.get('skills')` → `registerSkillPack()`，把 `skills/` 全部注册进宿主。
**没有安装步骤**；改了内容下次加载即生效（注册是 effect，卸载自动撤销）。

> 为什么不是"把文件放进 `skills/` 就会被发现"：技能发现只扫描配置好的根目录
> （rank 100 `<项目>/.dsh/skills` … 600 `Config.bundledSkillDir`），**npm 包自己的 `skills/` 不在其中**。
> 本插件那 3 个 `latex-*` 技能正是因此空转了整个 0.1.0 周期。DSH 是围绕插件设计的，
> 插件已装载就直接注册，不必再绕文件发现一圈。详见 `docs/DESIGN-REVIEW.md` §4.2。

**0.2.0：这个兜底已删除。** 它当年是为「技能不进上下文」那个问题写的，问题既然已经由插件自注册解决，留着只会造成两套来源互相遮蔽。不用插件时想读技能，直接打开 `skills/<名字>/SKILL.md` 即可。

新增技能时请确保：目录名 = frontmatter 的 `name`，且都是 kebab-case。
`test/skillpack.test.mjs` 会钉住这两条，也会在 `apply()` 漏注册时变红。

### 12.4 换/加页图后端
- 实现在 `lib/core/render.js`；顺序由 `rendererOrder` 控制。
- 新后端必须实现"可用性探测 → 渲染 → 返回 `{status,backend,pages[],reason?,advice?}`"三件事，且**不可用时要返回 `skipped` 而不是抛异常**。
- 可用性探测请复用 `lib/core/env.js` 的 `resolveTool()`。

### 12.5 改隐私门
- `lib/core/pdfread.js` + `uploadScope` 三态。改动必须保持默认 `external-only`（这是本插件的核心安全承诺），并更新 `docs/INTERFACES.md`。

### 12.6 提高模型侧体验
- `presentCall`/`presentResult`：UI 卡片。
- `skills/*/SKILL.md`：给模型的用法指引（A 线 / VTO 循环 / 修复手法目录）。

---

## 13. 已知问题与技术债（诚实清单）

| # | 类型 | 内容 | 影响 / 建议 |
|---|---|---|---|
| 1 | ~~未结案~~ **已结案** | ~~E5：插件是否真的在 app 内注册~~ → **已用运行时证据结案**（见第 15 节） | 结论：插件一直在正常注册；结案方式见第 15 节 |
| 2 | 环境限制 | 本机 `read_pdf({view:'page'})` 失败（"PDF.js returned invalid page metadata"） | `mineru-page` 后端实际不可用；poppler/mgs 已足够。可重试评估新版 MinerU |
| 3 | 未实测 | `bib_tool action='fill'` 的 **Crossref 网络路径** | 有网环境需补一次端到端验证 |
| 4 | 设计限制 | C2（图片分辨率/风格不一致）**只能诊断，不能自动重绘** | 需人工替换图片；若要自动化需接图片生成 |
| 5 | 流程 | **无 CI**。质量全靠 `npm test` + `docs/ACCEPTANCE.md` 手工重跑 | 建议加 GitHub Actions（Windows runner + MiKTeX 较重，可考虑只在 Linux 跑纯内核测试） |
| 6 | 平台 | 只在 **Windows + MiKTeX** 验证过 | `lib/core/*` 已做平台中立处理（含正斜杠 root 回归），但 Linux/TeX Live 未实测 |
| 7 | 安装 | 桌面 profile 的 CLI `add` 会挂起 | 用应用内插件管理器或第 11.2(b) 节的手工路径 |
| 8 | 脚手架 | `tools/_p0/` 是调研证据，**有意不在发布白名单** | 若要做发布审计，需单独归档 |
| 9 | 耦合 | `skills/latex-fix-catalog/SKILL.md` 与 `vto_taxonomy.json` 存在语义耦合 | 改一处要同步另一处 |
| 10 | 文档 | `docs/INTERFACES.md` 是"冻结契约"但**已滞后于代码**（重复小节号、缺 `paths.js`、`checkPolicy` 三参等） | `test/docs.test.mjs` 现在只钉住字段数/布局名/模块地图；建议进一步从工具注册反向生成 INTERFACES |
| 11 | 配置 | 已删 `maxRounds`/`enableFixerSidecar`/`enableSemanticTuning`（无人读取） | 老 profile 里若还写着这些键，schemastery **会静默忽略**（无 strict 模式），不会报错——属可接受 |
| 12 | 数据 | `lib/data/` 里 5 个 JSON（templates/content_boundaries/writing_rules/agent_roles/layout_rules）**无任何代码读取**，且生成它们的 PaperFit YAML 已不在仓库 | 要么接上用途，要么移出发布集；见第 17 节 |
| 13 | 路径 | 路径守卫是词法的（`resolve` + 前缀比较），**看不到 junction/符号链接** | `vto_fix` 理论上可穿过指向工程外的 junction 写入；未做利用验证。修法是加 `realpath` 复检 |

---

## 14. 排错手册（本机实测）

### 14.1 工具不出现 / 插件像没加载

按**官方教程第 01 / 06 章**给的两个失败模式依次排查：

1. **模块无法解析 → 静默失败**。官方原文：配置项模块无法被解析时，Cordis 通过 logger 报错而**不崩溃**，且**启动阶段这条报告可能早于 console 导出器而丢失**——表现就是"加了配置项毫无效果"。→ **先检查拼写**：`package.json` 的 `name`、`cordis.patch.yml` 里的 `name`、`dsh.profile.bundles` 三者必须完全一致。
2. **停在 PENDING**。`inject` 的服务无人提供时插件会**一直等待、不输出任何内容**。诊断代码（官方第 6 章）：
   ```js
   import { FiberState } from '@deepseek-ai/cordis'
   export function apply(ctx) {
     setTimeout(() => {
       for (const runtime of ctx.registry.values())
         for (const fiber of runtime.fibers)
           if (fiber.state === FiberState.PENDING) console.log(fiber.name + ' is PENDING')
     }, 500)
   }
   ```
3. 本插件另加一条已修复的成因：**入口曾用 `async apply` + 顶层 await + 动态 import**，注册可能晚于工具目录快照。现已改为**静态 import + 同步 `apply`**。

### 14.2 常见环境坑

| 症状 | 原因 | 解法 |
|---|---|---|
| `dsh --version` 显示 0.1.5-rc.1 | PATH 上是旧全局安装 | 用 `D:\DshDesktop\resources\runtime\cli\bin\dsh.cmd` |
| `--profile desktop --dump-config` → exit 1 | Electron 独占管理该 profile | 改用 `plugin list --profile desktop`，或看应用内设置页 |
| `npm install` 挂死 >300s | `~/.npmrc` 配了失效代理 `127.0.0.1:31180/31181` | `npm <cmd> --userconfig <空文件>` |
| `latexmk` 报找不到 perl | 本机无 Perl | 插件不使用 latexmk（`latexCommand='latexmk'` 会被忽略并给 advice） |
| MiKTeX 启动器 exit 0xC0000135/0xC0000139 | 版本混装 / 残留 lock | 清 `D:\MiKTeX\miktex\lock\package-manager.lock` → 重装基础包 → `miktex packages update` |
| 中文/空格路径下测试失败 | Node 路径正则曾排除空格 | 已修；新增正则应覆盖含空格与 CJK 的工作区 |
| PowerShell 输出中文乱码 | 控制台编码，非文件损坏 | 用 `js-yaml`/Node 读取校验，别信 `Get-Content` 显示 |

---

## 15. ✅ 已结案：E5（"9 个工具没出现"）

### 结论
**插件一直是正常注册的。** 本轮用运行时证据直接判定，不再需要重启实验。

### 证据（2026-10-11 01:2x，宿主 0.2.0-rc.2 / Electron 桌面端）

| 探针 | 结果 |
|---|---|
| `plugin_manager list_plugins` | `include:latex-studio` → `enabled: true`、`fiberPhase: "active"` |
| `cordis_inspect_query(host, Config, listConfigs, {name:'dsh-latex-studio'})` | 找到该行，`status: "schema"`，`packageDir` = 安装副本；schema 解析出全部字段与默认值 ← **证明 bundle patch 的那一行确实进了插件树** |
| `cordis_inspect_query(host, Tool, listTools)` | `latex_doctor / latex_build / latex_lint / bib_tool / vto_start / vto_inspect / vto_fix / vto_verify / vto_report` **9 个全在**当前会话的工具目录中 |
| 真调用 `latex_doctor({verifyPdfRead:true})` | 返回 `renderProbe=[ok] backend=poppler bytes=45961` —— 工具不仅注册，还真的跑通了整条本地链路 |

### 原诊断错在哪里（这才是要交接的东西）
1. **"工具目录在启动时快照"是错的。** 官方生成的子系统页写得很清楚：工具目录在**每个模型步骤前的组装**时才物化，并且注册/注销会通知"下一次组装"（`tools/change` 是**故意不做作用域过滤**的通知）。所以"注册晚了 → 目录已冻结"这个因果链**不成立**；为此改写 `apply` 为同步并不是错（同步本来就更稳），但**它不是 E5 的原因**。
2. **E5 更可能的真因是 PENDING，而 PENDING 有一个文档化的、可复现的机制**：`@deepseek-ai/dsh-tools` 的 `ToolRuntime` 自己声明 `static inject = ["systemPrompt"]`。因此只要组合里缺 `@deepseek-ai/dsh-system-prompt`，`tools` 服务就 PENDING → 我们的插件（`inject = ['tools']`）也 PENDING → `apply` **根本不执行** → 工具列表里什么都没有，而且**没有任何报错**。
3. **一个"自检工具"救不了这种情况**：PENDING 的插件无法注册任何工具，包括自检工具。这是结构性的——诊断必须在 loader / inspect 层做，不在插件内做。

### 正确的诊断路径（以后照这个做，别猜）
```
1. plugin_manager list_plugins            → enabled? fiberPhase? （active / pending / failed）
2. cordis_inspect_query host Config       → 行在不在？schema 出得来吗？
3. cordis_inspect_query host Tool         → 工具在不在当前会话目录里？
4. 若 1 显示 pending：查组合里是否有 @deepseek-ai/dsh-system-prompt
   （这是 tools 服务的注入依赖，缺它 tools 就 PENDING）
5. 若 2 找不到该行：模块名/包名/bundles 三者拼写不一致（官方：解析失败只写 logger，
   启动期这条日志可能早于 console 导出器而丢失）
```
第 14.1 节的 PENDING 打印代码（`FiberState.PENDING`）仍是最后手段，但**先用 1–3 的运行时查询**，
它们更便宜也更确定。

---

## 16. 参考资料

**本仓库内**
- `README.md` —— 用户视角的安装 / 自检 / 配置 / 排错（**先读这个**）
- `docs/DESIGN-REVIEW.md` —— 设计依据与取舍（为什么保留视觉通道；机检与页图的分工）
- `docs/INTERFACES.md` —— 对外契约（**已知滞后**，见第 13 节 #10）
- `docs/ACCEPTANCE.md` —— 逐条验收 + 真实输出（数字部分已过期）
- `docs/P0-PROBES.md` —— 环境探针证据链
- `docs/paperfit-notes.md` —— PaperFit 调研笔记与**丢弃清单（含理由）**
- `docs/upstream/paperfit/` —— vendored 的上游 agent/skill 规范 + `MANIFEST.json`（来源哈希）
- `THIRD_PARTY_NOTICES.md` —— 第三方来源与许可

**外部**
- PaperFit：arXiv 2605.10341（UCAS + 上海 AI Lab + SJTU，MIT；6 个 agent 提示词是真正的规范蓝图）
- dsh-latex-guard：MIT（借鉴其"CLI 包成 JSON 工具 + 优雅降级 + 拒绝写入不可解析 .bib"的模式）
- DSH 官方开发文档：
  - 基础：`develop/basic/{index,tool,config,publish}`
  - 框架：`develop/framework/{index,service,events}`
  - 实战：`develop/practice/{index,llm-adapter,dynamic-cordis}`
  - Cordis 教程：`develop/cordis-tutorial/`（总览 + 01–07）
  - 起点：https://deepseek-harness.github.io/deepseek-harness/develop/basic/

---

## 附录 A：一分钟交接清单

- [ ] 读第 0 / 2 / 3.1 节（建立心智模型）
- [ ] 读第 5.4 节（配置只有两处、patch 不带 config —— **最容易踩的坑**）
- [ ] 跑一次 `npm install --legacy-peer-deps && npm test`，确认全绿、0 跳过
- [ ] 跑 `node tools/doctor.mjs`，确认 `verdict: HEALTHY`
- [ ] 读第 15 节（E5 已结案）与第 17 节（设计修订）
- [ ] 读第 12 节，看清每类改动的标准动作
- [ ] 改任何配置字段前，先看 `test/config.test.mjs`
- [ ] 改任何工具/契约后，同步 `docs/INTERFACES.md` 并重跑测试
- [ ] 发布/升级只需 `node tools/install.mjs`（含第 11.3 + 11.4 的全部步骤与验证）

## 附录 B：关键不变量（改代码时别破坏）

1. `lib/core/*` **不 import DSH**；`lib/tools/*` **不写业务逻辑**。
2. `apply` **必须同步**注册（不是 E5 的原因，但同步本来就更稳；见第 15 节）。
3. 配置字段 **两处同步**（`config.js` 的 `DEFAULTS` ↔ `index.js` 的 schema）；
   `cordis.patch.yml` **不得**再出现 `config:` 块（`test/config.test.mjs` 强制）。
4. 路径参数按 **基准** 解析（工作区 / 工程 / 目录名），拒绝绝对路径 / 盘符 / UNC / `..`；词法守卫只有 `lib/core/paths.js` 一份实现，工程相对语义由 `lib/tools/vto.js` 的 `resolveProjectPath` 收口，`test/params.test.mjs` 强制每类参数都声明基准。
5. 缺外部件 **返回 skipped + advice**，不抛异常。
6. `vto_fix` **默认不写盘**；写盘必须 备份 → 写入 → guard 校验 → 失败回滚。
7. 内容保全 **优先于** 视觉质量。
8. `dependencies` **保持为空**。
9. 测试 **自建夹具**，不依赖仓库里的历史产物。
10. 发布白名单 `files` **不含 `tools/_p0/`**。
11. **字形替换必须字面插入**：不要用 `String.replace(str, str)`（`$&`/`` $` ``/`$$` 会被展开，而 LaTeX 全是 `$`）。`test/vto.test.mjs` 已钉死。
12. **声明了就必须用**：不得新增无人读取的配置字段、工具参数或数据文件。
13. **改字段数/布局名/模块地图后，`test/docs.test.mjs` 会拦你**；先改文档再跑测试，或先跑测试看它指出哪一行。
14. **`tools/install.mjs` 必须保持"打包 → 注册 → 镜像 → 自检"闭环**；doctor 若不在发布集里，
    第 4 步会退化成"无法验证"，`test/tools.test.mjs` 会因此变红。
15. **不要在 PowerShell 里用 `Get-Content`/`Set-Content` 改含中文的文件**：控制台按 ANSI 码页重写，
    中文会变成 U+FFFD 乱码（README.md 真发生过一次）。用 `read`/`edit`/`write` 工具。
    `test/docs.test.mjs` 现在会扫出 U+FFFD 与 BOM。

---

## 17. 本轮设计修订（2026-10-11）

完整的审阅过程、对官方文档的对照、以及**尚未实施的目标设计**，见
[`docs/DESIGN-REVIEW.md`](./DESIGN-REVIEW.md)。本节只记"已经改了什么、为什么"。

### 17.1 已实施（全部有测试覆盖）

| # | 变更 | 为什么 | 落点 |
|---|---|---|---|
| A1 | **bundle patch 不再携带 `config:`** | patch 整份替换 config；三处同步 → 两处，消灭"覆盖一个字段丢掉其余 19 个"的结构性错误 | `cordis.patch.yml`、`test/config.test.mjs` |
| A2 | **路径守卫合并为唯一实现** | 原本 `daily.workspaceRelativePath` 与 `vto.safeRel` 是两份实现、规则不一致，E4 只修了其中一份 | 新增 `lib/core/paths.js`；两个工具层改为 adapter |
| A3 | **`applyEdits` 改为字面替换** | `String.replace` 会把替换串里的 `$&`/`` $` ``/`$$` 当捕获组展开；LaTeX 里全是 `$`，一次"修复"就能写坏正文 | `lib/tools/vto.js`、回归测试 |
| A4 | **`.aux` 空指纹不再算"稳定"** | 缺/空 `.aux` 的指纹是 `''`，两趟都空就提前收敛 → 有前向 `\ref` 的文档被报 `passed` 但交叉引用是错的 | `lib/core/compile.js`、多趟测试 |
| A5 | **`passes` 语义统一为"引擎运行次数"** | 原来把 bibtex/biber 那一趟也算进去，与文档/`README` 的"引擎趟数"矛盾 | `lib/core/compile.js` |
| A6 | **`lint` 不再抛异常** | `readFileSync` 遇到目录型 `*.bib`/不可读 `.tex` 会 `EISDIR` 抛出，违背"永不抛"契约并让 `latex_lint` 硬失败 | `lib/core/lint.js` |
| A7 | **`bib` 写后校验纳入保护 + `fill` 也查 `complete`** | 写后读回失败会在文件**已被覆盖**的情况下抛出且不回滚；`fill` 曾不检查结构完整性 | `lib/core/bib.js` |
| A8 | **`workDir` 不得逃出工程** | 它流向 `ensureDirs`/`writeAtomic`，并经 `clean:true` 流向 `rmSync(recursive)`；原来绝对路径被原样接受 | `lib/core/state.js`、回归测试 |
| A9 | **删除 3 个死配置字段** | `maxRounds`/`enableFixerSidecar`/`enableSemanticTuning` 无人读取；"配了没反应"比没有更糟 | `config.js`/`index.js`/文档 |
| A10 | **`aux` → `auxfiles` 全局一致** | `SUBDIRS` 曾建一个空的保留名目录 `aux/`，而编译器写 `auxfiles/`；SKILL.md 还把 `aux/` 告诉了模型 | `state.js`、SKILL |
| A11 | **测试"假绿"通道封堵** | `daily.test.mjs` 的 stub 导入失败会静默 skip 掉 8 条工具测试，全套仍报 ALL GREEN；现在有一条测试专门让该状态变红 | `test/daily.test.mjs` |
| A12 | **新增文档可追溯性测试** | 本项目最贵的故障是文档与代码漂移（字段数、`aux/`、模块地图），不再靠手工发现 | 新增 `test/docs.test.mjs` |
| A13 | **移植 PaperFit 的 A5 机检**（`lib/core/voidetect.js`） | 上游有 `detect_column_void.py`，本插件此前**完全没有**机检，模型只拿到页图和"该看什么"。本机无 cv2（只有 numpy/PIL），且 `dependencies:{}` 是硬不变量，故改自解 PNG（Node zlib）行为等价重写 | 新增 `lib/core/voidetect.js` + `test/voidetect.test.mjs` |
| A14 | **`vto_inspect` 输出 `machineSignals`** | PaperFit 的 `layout-detective-agent` 要求把机检 `a5_candidates` 与页图结论**合并**；机检只产候选，判据仍是页图 | `lib/tools/vto.js` |
| A15 | **checklist 补上 `layout_rules` 数值阈值** | 上游阈值在 `config/layout_rules.yaml`；移植版此前大部分缺陷 `thresholds: null`，模型不知道"多少算缺陷" | `buildChecklist` + `layoutRules` 字段 |

### 17.1b ⚠ 我上一轮的一个错误结论，已撤回

上一轮我在 `DESIGN-REVIEW.md` 初版里提出"把版式判据改成纯文本度量、`attachImagesPerRound` 默认 0"。
**这是错的。** 证据在本仓库自己的 `docs/paperfit-notes.md` §5 与论文 Table 5：

- 纯文本/日志方法的 **VLM 上限 2.1838（RuleLog）、Win 上限 0.4250**；而视觉多轮 VisualMR 是 2.8006/0.6500，
  PaperFit 是 3.3907/0.8950。
- RuleLog 的 Compile/Render（0.52/0.76）**低于不做修复的 Perturbed**（0.58/0.82）——纯规则路线会误伤。
- 关键：VisualMR 与 PaperFit 的差别**不是"是否看到图"**，而是多轮过程是否围绕
  "显式缺陷 + 约束修复 + 验收门控"组织（两者 Program 分 4.5789 vs 4.5790 几乎相同）。

→ **结论修正**：视觉通道必须保留为判据主体；要补的是**结构化组织**（机检数字、数值阈值、缺陷台账、门禁）。
机检的作用是给视觉判读提供目标与量化，**不是替代视觉**。完整订正见 `docs/DESIGN-REVIEW.md` §2。

### 17.2 已确认但**未实施**（留给下一轮，按价值排序）

| # | 事项 | 证据 / 理由 |
|---|---|---|
| B1 | **缺陷台账（最有价值的一项）** | 论文的核心增益是"**持久化缺陷记录 + 验收门控**"：VisualMR 与 PaperFit **都看图**，Program 分几乎相同（4.5789 vs 4.5790），差距全在结构化组织上；VisualMR 正是在"第一个可渲染结果"处停下。把每轮 `defects[]`（`d=(c,o,r,e)` + `evidence_sources` + `cv_signal_ref`）写进 `state.json` 供下一轮对比与门禁 |
| B2 | **Vendor PaperFit 的 agent 规范文本** | `paperfit-cli` 的 9 个 SKILL.md + 6 个 agent .md 是论文级规范（`taxonomy-vto` 18.5KB、`space-util-fixer` 11KB、`float-optimizer` 11.2KB…合计 >100KB），而本插件只有 420 行的 `latex-fix-catalog`。这是最大的"重复造轮子/知识损耗"点。**需先确认许可与发布白名单**（MIT，须更新 `THIRD_PARTY_NOTICES.md`） |
| B3 | **B2 缺陷的机检**：从页图测图表渲染宽度与栏宽之比 | `layout-detective-agent.md:187-192` 明确要求（`table.min/max_width_utilization`）；本插件目前没有这门测量。B1-B（placement 导致的尺寸压缩）同理 |
| B4 | **A2/A4 的机检** | `trailingBlankRatio` 已在 `machineSignals` 里，可直接判 A2；A4 栏高差需比较两栏栏底墨迹位置。阈值已在 checklist，缺的是"谁去量" |
| B5 | **`vto_fix` 是字面 find/replace，脆弱且与宿主 `edit` 重叠** | 替换串只要一个字符不匹配就 `EDIT_NOT_FOUND`；两套写入机制并存，把宿主已解决的版本漂移又留在插件里。建议：`vto_fix` 只保留"配方 + 预检 + 备份/回滚"，写入交宿主 `edit`/`write`（有版本守卫） |
| B6 | **`vto_inspect.parse` / `consent` 是空承诺** | 即使 `gate.allowed` 也从不真正调用结构化解析；`consent` 也没传进 `read_pdf` 桥。要么实现，要么删参数 |
| B7 | **`latex_build.clean` 会 `rmSync(recursive)`** | `workDir` 已加固，但 `clean` 仍是无二次确认的递归删除；建议要求显式 `yes` 或只删已知子目录 |
| B8 | **junction/symlink 写入穿透** | 路径守卫是词法的，`realpath` 复检可堵 |
| B9 | **`extract_crossrefs` 等价性核对** + `orphan_refs`/`orphan_labels` | `layout-detective-agent.md` 第零步要求；原版输出含悬空引用与未被引用的标签 |
| B10 | ✅ **0.2.0 已处理** | `_meta.json` 删除、provenance 移入 `THIRD_PARTY_NOTICES.md`；其余 4 份 JSON 已接上消费者（templates→模板解析、content_boundaries→guard 章节下限、writing_rules→语义微调上限、agent_roles→类别路由与团队角色） |
| B11 | **`INTERFACES.md` 重建** | 重复 §13、缺 `paths.js`/`voidetect.js`、`checkPolicy` 三参未记、多项未文档化导出 |
