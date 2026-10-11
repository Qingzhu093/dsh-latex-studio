# PaperFit 论文要点笔记

> 本文是给 dsh-latex-studio 实现者/维护者的**方法学参考文献**，不是 API 文档。
> 契约与实现细节见 [INTERFACES.md](./INTERFACES.md)；验收见 [ACCEPTANCE.md](./ACCEPTANCE.md)。
> 论文原文：Bihui Yu et al., *PaperFit: Vision-in-the-Loop Typesetting Optimization for Scientific Documents*,
> [arXiv:2605.10341](https://arxiv.org/abs/2605.10341)（cs.AI，2026-05-11 提交，47 页 / 17 图 / 17 表，MIT 仓库 [OpenRaiser/PaperFit](https://github.com/OpenRaiser/PaperFit)）。
> 作者：Bihui Yu`*`, Xinglong Xu`*`, Junjie Jiang`*`, Jiabei Cheng`*`, Caijun Jia, Siyuan Li, Conghui He, Jingxuan Wei, Cheng Tan（`*` 为共同一作）；单位：① 中国科学院大学 ② 上海人工智能实验室 ③ 上海交通大学自动化与感知学院；通讯：Cheng Tan, tancheng@pjlab.org.cn。
> 本地证据副本：`_analysis/paperfit-paper/paperfit.pdf`（本仓库工作区，非插件发布内容）；
> 可执行材料：`%TEMP%\\pfcli\\node_modules\\paperfit-cli\\`（CLAUDE.md / agents / skills / config / scripts）。

## 0. 一句话总结

「编译通过」≠「可投稿」。VTO（Visual Typesetting Optimization，视觉排版优化）是**结构化排版之后、最终出版之前**被现有文档流水线漏掉的一环：
规则工具只看源码与日志（对渲染后的二维版面是盲的），纯文本 LLM 只能开环改源码（无法预测也无法验证改动的版面后果）。
可靠做法是**每改一次就重编译、重渲染页图、重新视觉验收**的闭环，并把修复约束在「真实排版修复」内。

## 1. VTO 的定义（论文 §4.1）

设 `x` = 可编译的 LaTeX 工程，`τ` = 目标模板，`b` = 可选页数预算；执行 compile→render 流水线得到日志证据 `ℓ`、PDF `P`、页图 `I` 与页数 `p`。VTO 求：

```
x* = argmin_{x'}  Σ_{d ∈ D(x')} w_{c(d)} · s(d)   +   λ_e · Δ(x, x')
     s.t.  COMPILE(x', τ) = success          (2)
           RENDER(x', τ)  = success          (3)
           CONTENT(x') ⊇ CONTENT(x)          (4)
           |PAGES(x', τ)| = b   （当 b 指定）  (5)
```

- `D(x')`：在 `x'` 渲染页面上检测到的视觉缺陷集合，每个缺陷带类别 `c(d)` 与严重度 `s(d)`；`w` 按 taxonomy 加权。
- `Δ(x, x')`：源码编辑距离，鼓励**最小、可审计**的改动；`λ_e` 平衡保守性与视觉收益。
- 因为目标函数**只有在编译+渲染之后才可观测**，且微小改动会引发非局部的版面级联（float 宽度一变，整篇分页可能重排），VTO 不能用单遍生成解决，必须建模为「每轮编辑后都做视觉验收」的迭代搜索。

**对本插件的直接要求**：`vto_fix` 默认 `apply:false` 只产出配方与 diff；`apply:true` 必须 备份→写→guard 校验→失败回滚；`vto_verify` 每次都要重新 compile+render+对照四层证据。

## 2. 五类 18 缺陷（与 `lib/data/vto_taxonomy.json` 逐字一致）

| 类别 | 名称 | Name (EN) | 默认严重度 | 缺陷数 |
|---|---|---|---|---|
| A | 空间利用缺陷 | Space Utilization Defects | major | 5 |
| B | 浮动体缺陷 | Float Placement Defects | major | 4 |
| C | 排版一致性缺陷 | Consistency Defects | minor | 3 |
| D | 溢出与对齐缺陷 | Overflow & Alignment Defects | major | 3 |
| E | 跨模板迁移缺陷 | Cross-Template Transfer Defects | critical | 3 |

严重度语义：`critical`=必须修（否则不合投稿要求），`major`=严重影响专业度，`minor`=美观问题。taxonomy 中 `critical` 与 `major` 都是 `gate_blocking: true`，`minor` 为 false。

| ID | 名称 | Name (EN) | 严重度 | 需页图 | 主修复手法 | 验收指标 |
|---|---|---|---|---|---|---|
| A1 | 孤行/寡行 | Widow/Orphan Lines | major | 是 | `space-util-fixer` | widow_orphan_count = 0 |
| A2 | 末页大面积留白 | Excessive Trailing Whitespace | major | 是 | `space-util-fixer` | last_page_whitespace_ratio = <0.20 |
| A3 | 页数预算违反 | Page Budget Violation | critical | 否 | `space-util-fixer` | page_count_match = true |
| A4 | 双栏末页左右栏高度不齐 | Unbalanced Column Heights | minor | 是 | `space-util-fixer` | column_height_diff_lines = <=2 |
| A5 | 双栏页内列竖向空洞 | Intra-Column Vertical Void (Two-Column) | major | 是 | `space-util-fixer` | intra_column_void_ratio = <0.30 |
| B1 | 浮动体远离首次引用 | Float-Reference Distance | major | 是 | `float-optimizer` | float_reference_distance_pages = <=1 |
| B2 | 浮动体大小不适配栏宽 | Float Width Mismatch | major | 是 | `fullwidth-fixers` | float_width_utilization = >0.95 且 <=1.0 |
| B3 | 浮动体连续堆叠 | Float Clustering | minor | 是 | `float-optimizer` | max_consecutive_floats = <=2 |
| B4 | 浮动体跨页分裂 | Float Page Orphaning | minor | 是 | `float-optimizer` | float_split_improper = 0 |
| C1 | 表格字号不统一 | Inconsistent Table Font Sizes | minor | 是 | `consistency-polisher` | table_font_size_consistency = true |
| C2 | 图片分辨率/风格不一致 | Inconsistent Figure Quality/Style | minor | 是 | `consistency-polisher` | figure_quality_consistency = true |
| C3 | Caption 格式不统一 | Inconsistent Caption Format | minor | 是 | `consistency-polisher` | caption_format_consistency = true |
| D1 | Overfull hbox | Overfull hbox | major | 是 | `overflow-repair` | overfull_hbox_count = 0 |
| D2 | 长公式未合理断行 | Unbroken Long Equations | major | 是 | `overflow-repair` | long_equation_overflow_count = 0 |
| D3 | URL/长标识符溢出 | URL/Long Identifier Overflow | minor | 是 | `overflow-repair` | url_overflow_count = 0 |
| E1 | 单栏↔双栏图表尺寸失配 | Single/Double Column Figure Mismatch | critical | 是 | `template-migrator` | figure_width_adaptation = true |
| E2 | 页数预算不匹配 | Page Budget Mismatch | critical | 否 | `template-migrator` | page_budget_match = true |
| E3 | 模板特定宏兼容性 | Template-Specific Macro Compatibility | critical | 否 | `template-migrator` | compilation_success = true |

**ID 列表（机器可校对，必须与 taxonomy 完全一致）**：

```
A1 A2 A3 A4 A5 B1 B2 B3 B4 C1 C2 C3 D1 D2 D3 E1 E2 E3
```

> 口径说明：论文摘要说的 `13 defect types` 是 **PaperFit-Bench 基准的注入缺陷型数**；taxonomy 本身是 **5 类 18 个缺陷 ID**（本插件 vendored 的 `vto_taxonomy.json`）。两者不矛盾，写文档/技能时统一以 18 个 ID 为准。
> 注意 A5「双栏页内列竖向空洞」是区分 A2（末页尾部留白）与 A4（末页栏底不齐）的**任意页、单列中段**空洞，检测必须依赖页图（可选 PaperFit 的 OpenCV 行向墨迹投影脚本佐证）。

## 3. 四层证据（论文 §4.2「Sense」）

没有任何单一证据源能可靠覆盖所有排版缺陷：一个表格可以编译无警告、用标准 `tabular`、落在正确页——但依然**溢出栏宽**；这种缺陷只有页图层看得到，而只有源码层能定位修复点。因此 PaperFit 融合四层：

| 证据层 | 论文中的信号 | 在本插件中的落点 |
|---|---|---|
| **源码层 `.tex`** | 文档结构、模板配置、宏、float 环境、表格结构；受保护对象（figure/table/caption/label/citation/bib 命令）计数 | `lib/core/lint.js` `extractProtected`；`lib/core/guard.js` `snapshot`；`checkPolicy` |
| **日志层 `.log`** | 编译失败、未定义控制序列、未解析引用、缺引用、Overfull/Underfull、模板兼容错误 | `lib/core/logparse.js`；`latex_build` / `latex_lint` |
| **PDF 层 `.pdf`** | 最终页数、页序、浮动体落点 | `lib/core/compile.js` 的 `pages`；B1 图-引用距离由 `lint.js` 的 crossref 分析给出 |
| **页图层（渲染 PNG）** | 末页稀疏、双栏列空洞、浮动体堆叠、超宽表、局部留白、跨页失衡、风格不一致 | `lib/core/render.js`（poppler → miktex-ghostscript → mineru-page）；`vto_inspect` 以 image 内容块回会话 |

诊断阶段的每条缺陷记录是 `d = (c, o, r, e)`：`c ∈ {A,B,C,D,E}` 类别、`o` 位置（页码+空间区域）、`r ∈ {blocking, degrading, cosmetic}` 严重度、`e` 支撑证据。
它是**诊断与修复之间的接口**：每一次编辑都必须能追溯到明确的多源证据，严重度决定修复优先序。

## 4. 硬约束与优先级

### 4.1 约束的严格优先序（论文 §4.1，原文）

```
content preservation  >  compilation/rendering  >  page budget  >  visual quality  >  edit minimality
（内容保全）              （编译/渲染）              （页数预算）      （视觉质量）        （编辑最小性）
```

`CLAUDE.md`（PaperFit 运行守则）把它展开为 5 条非协商原则：
1. 保持学术语义与事实不变（绝不篡改数据、结论、引用内容）
2. 编译通过，日志无严重阻塞性错误
3. 消除视觉缺陷（按 VTO 严重等级排序）
4. 版式自然、统一、专业
5. 满足页数目标（若用户指定）

### 4.2 缺陷修复的选择次序（论文 §4.3.2）

```
编译错误（最高）→ Overflow(D) → Float placement(B) → Table consistency(C) → Space utilization(A) → Cross-template(E)
```

每轮只挑 `D_t` 中**最高优先级的未解决缺陷**，对其施加该类别排名最高的 layout-native 手法；layout-native 用尽后才允许受限的 spacing 手法。

### 4.3 修复动作三层（论文 §4.3.1）

| 层级 | 允许度 | 典型手法 |
|---|---|---|
| **Layout-native（首选）** | 直接解决根因、无副作用 | float 重新锚定（`[htbp]`）、公式断行（`align`/`multline`）、表格重构为宽度感知环境（`tabularx`/`table*`）、图片宽度归一化 |
| **Spacing-manipulative（受限）** | 需显式局部理由，且必须复核 | 局部 `\vspace`、`\setlength`、columnbreak 提示 |
| **Pseudo-fix（禁止作为主修复）** | 掩盖症状 | 表格 `\resizebox`、用 `\newpage`/`\pagebreak` 控页数、图形 `\scalebox`、删内容 |

本插件把第三层固化为 `lib/core/policy.js` 的 `FORBIDDEN`（`\resizebox`、裸 `\vspace`、滥 `\newpage`、`\tiny`/`\scriptsize`），`vto_fix` 写前用 `checkPolicy(before,after)` 拦截。

### 4.4 语义微调的边界（§4.3.3）

只有在 layout-native 手段耗尽、且只剩「页数差一点 / 孤行寡行 / 末页稀疏」时，才允许**有界语义润色**：收紧冗长句、长短语换等价短表达，且**不得改动论断、结果、数字、引用与事实含义**。修复前对受保护对象（figure/table/caption/label/citation/bib）做快照，修复后校验无删除、无跨节位移、caption 未被改；违规自动回滚到修复前状态。
本插件对应：`enableSemanticTuning` **默认 false**；`guard.verifySnapshot` 违规即 rollback。

## 5. 六基线实验结论（论文 §5.1.1 / §5.2，Table 5）

**六基线按「反馈范式」递增构造**（唯一变量是：能访问的证据源、修复迭代次数、是否含结构化修复机制）：

| 基线 | 范式 | 它能看到什么 |
|---|---|---|
| **Perturbed** | Rule-based | 扰动后**未修改**的输入（原始难度参照 / 视觉对比基准） |
| **RuleLog** | Rule-based | 源码 + 编译日志，施加确定性规则修复，无模型视觉反馈 |
| **TextST** | Text-only | 源码，单轮模型修复，不看页图 |
| **TextMR** | Text-only | 源码 + 多轮文本/日志反馈，仍无页图 |
| **VisualST** | Visual | 源码 + 页图，但只有**一次**视觉修复回合 |
| **VisualMR** | Visual | 固定轮数的**朴素多轮视觉 agent**：可查源码/日志/页图并直接修 compile/render/layout；但**被禁止**使用 PaperFit 的 taxonomy、结构化诊断/修复计划、约束修复策略、状态管理、门禁 |

**主结果（Table 5，200 篇 / 10 个模板；VLM 与 Program 为 0–5 分，其余为比率）**：

| Method | Compile ↑ | Render ↑ | VLM ↑ | Win ↑ | Program ↑ | Page hit ↑ |
|---|---|---|---|---|---|---|
| Perturbed | 0.5800 | 0.8200 | 1.8275 | 0.0000 | 3.6344 | 0.3750 |
| RuleLog | 0.5200 | 0.7600 | 2.1838 | 0.3800 | 3.3401 | 0.4444 |
| TextST | 0.5850 | 0.5850 | 1.8522 | 0.2800 | 2.5738 | 0.4530 |
| TextMR | 0.6100 | 0.6100 | 2.1601 | 0.4250 | 2.7433 | 0.6230 |
| VisualST | 0.6250 | 0.6250 | 1.8741 | 0.2950 | 2.7681 | 0.4560 |
| VisualMR | 0.9750 | 0.9750 | 2.8006 | 0.6500 | 4.5789 | 0.5487 |
| **PaperFit** | **1.0000** | **1.0000** | **3.3907** | **0.8950** | 4.5790 | **0.8050** |

**五条结论**：
1. **文本/日志反馈与单轮视觉反馈都不够**：RuleLog、TextST、TextMR、VisualST 逐级增加证据（日志 → 多轮文本 → 页图），但**没有一个超过 VLM 2.19 或 Win 0.43**。文本/日志方法判断不了「留白过多、浮动体级联」这类二维版面失败；单轮视觉编辑处理不了非局部级联。
2. **朴素多轮视觉能修「能不能用」，修不好「页数/新缺陷」**：VisualMR 的 compile/render 都到 0.975，说明多轮视觉+日志反馈能消除绝大多数执行失败；但 Page hit 只有 **0.549**、Win 只有 **0.650**——缺少显式规划、受限修复与门禁，仍难以满足页数预算、也难以避免引入新缺陷。
3. **PaperFit 取得最佳权衡**：compile/render **1.000**、VLM **3.391**、Win **0.895**、Page hit **0.805**，Program 4.579 与 VisualMR 基本持平。即：视觉质量与约束满足的提升**不是靠牺牲可执行性/内容保全**换来的。
4. **收益来自版面结构修复而非语义漂移**：所有方法的 content embedding similarity 都 **> 0.97**（内容相似度保持得很高）。
5. **提升来自方法而非某个模型**（§5.4，Table 7，20 个代表用例）：四个后端 VLM 3.52–3.66、Win 90–100%、compile/render 近满分，后端间 VLM 极差仅 **0.14**，远小于 PaperFit 与 VisualMR 之间的 **0.59** 差距；剩余瓶颈是**空间利用与视觉平衡**，不是执行可靠性。论文还给出外部能力边界矩阵（Table 6）：DocParser / LocalRecon / CodeAgent / 通用 visual agent 都没有同时覆盖「多源输入 + 编辑 + 执行回路 + 全页视觉诊断 + 版面修复 + 门禁」。

**对本插件的取舍**：本插件复现的是「**闭环 + 结构化缺陷 + 受限修复 + 门禁**」这套**机制**（对应上表 VisualMR→PaperFit 的差距来源），而不是论文的模型/基准设施。

## 6. PaperFit agent 规格 → 本插件工具映射

PaperFit 是 Claude Code 形态的 agent 系统（`agents/*.md` + `skills/*/SKILL.md` + `.claude/commands/*` + Python `scripts/`）。
本插件把它落成 DSH 的 `defineTool` 工具 + `lib/core/*` 纯 Node ESM 模块：

| PaperFit 组件 | 职责（论文/CLAUDE.md） | 本插件落点 |
|---|---|---|
| `orchestrator-agent` | 识别入口与约束、管理闭环状态机、按序派发 | `vto_start` / `vto_verify`（+ `lib/core/state.js` 轮次状态） |
| `rule-engine-agent` | 解析 `.log` 的确定性错误与警告，保证「硬约束通过」 | `latex_build` + `lib/core/logparse.js`；`latex_lint` 复用同一报告 |
| `layout-detective-agent` | 基于页图 + 18-ID taxonomy 输出结构化缺陷记录 | `vto_inspect`（`render.js` 出页图 + checklist + 指标） |
| `code-surgeon-agent` | 表格重构、浮动体调整、公式断行等源码级修复 | `vto_fix`（默认 `apply:false` 只给配方/diff；写前 `policy.js` 守卫） |
| `semantic-polish-agent` | 排版手段用尽后的最小语义改写（3–8 词等边界） | `vto_fix` + `config.enableSemanticTuning`（**默认 false**） |
| `quality-gatekeeper-agent` | 汇总四层证据，裁决 DONE / CONTINUE / BLOCKED | `vto_verify` → `{verdict, checks{compile,render,contentIntegrity,pageBudget,policy}, regressions, rollbackTo}` |
| `skills/space-util-fixer` 等 6 个 fixer 技能 | A–E 各类缺陷的允许/禁止手法与阈值 | `skills/latex-fix-catalog/SKILL.md`（由 `vto_taxonomy.json` 的 18 ID 生成）+ `policy.js` |
| `scripts/parse_log.py` | 日志解析（页数、Overfull/Underfull、缺引用等） | `lib/core/logparse.js`（Node 重写，MIT 规则移植） |
| `scripts/extract_crossrefs.py` | 图文/表格的首次引用位置与源码距离 | `lib/core/lint.js`（B1 图-引用距离） |
| `scripts/render_pages.py` / `paperfit render` | PDF → 逐页高 DPI PNG | `lib/core/render.js`：poppler(pdftoppm) → miktex-ghostscript(mgs) → mineru-page |
| `scripts/state_manager.py` | `data/state.json` 状态、备份、回滚、列空洞报告合并 | `lib/core/state.js`：`<workDir>/{state.json,build,aux,pages,reports,backups/rN}` |
| `scripts/content_integrity_check.py` | pre/post 内容一致性对照（受保护对象） | `lib/core/guard.js`（`snapshot`/`verifySnapshot`）+ `scanSecrets` |
| `config/diagnostic_report.template.md` | 诊断报告骨架 | `lib/data/diagnostic_report.template.md` + `lib/core/report.js` |
| `.claude/commands/*`（`/fix-layout` 等） | 用户触发入口 | DSH 工具：daily(`latex_doctor`/`latex_build`/`latex_lint`/`bib_tool`) + vto(`vto_start`/`vto_inspect`/`vto_fix`/`vto_verify`/`vto_report`) |
| `paperfit doctor` | 环境体检与依赖缺口 | `latex_doctor`（`probeEnv` + `--verify-pdf-read`） |

**移植策略**：vendored 的是**数据与规则**（`config/*.yaml` → `lib/data/*.json`，MIT，见 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)）；算法是**行为等价重写**（Node ESM，不复制 Python）。

## 7. 与原版的差异（有意为之）

| 差异 | 原因 |
|---|---|
| **不依赖 `latexmk`** | 本机 MiKTeX 的 latexmk 是脚本、需要 Perl，本机无 Perl → 自研多趟驱动（最多 4 趟，比较 `.aux` 的 `\newlabel` 是否稳定，必要时插 `bibtex`/`biber`） |
| **页图后端本地优先** | MinerU 的 `read_pdf({view:'page'})` 在本机实测失败（`PDF.js returned invalid page metadata`）；而 MiKTeX 自带 `pdftoppm`(Poppler 24.04) 与 `mgs.exe`(Ghostscript 9.25)，零额外安装、零上传 |
| **上传闸门显式化** | MinerU 的**结构化解析**走 `official-v4`，会**上传**文档；PaperFit 无此边界 → `uploadScope: external-only|always|never`（默认 `external-only`）+ `lib/core/pdfread.js` 的 `{allowed, reason}` |
| **纯 Node ESM，无 Python sidecar** | 便于单测（`test/*.test.mjs`，node:test），不需要 Python 运行时；PaperFit 的 OpenCV A5 机检（`detect_column_void.py`）在本插件中**不是必需**（退化为页图人工/视觉判读 + 阈值） |
| **无 slash command，改为工具** | DSH 侧由 `lib/index.js` 的 `enableDaily`/`enableVto` 开关注册工具；`skills/*/SKILL.md` 只承载守则 |

## 8. 引用与出处

- 论文（全文 PDF，47 页）：https://arxiv.org/abs/2605.10341
- 官方实现（MIT）：https://github.com/OpenRaiser/PaperFit
- 本笔记引用的表格/章节号：§4.1（VTO 定义、约束优先序）、§4.2（四层证据、缺陷记录 `d=(c,o,r,e)`）、§4.3（修复动作三层、类别优先序、语义回退）、§5.1.1（六基线）、§5.2 与 Table 5（主结果）、§5.4 与 Table 7（模型后端）、Table 6（外部能力边界）
- 本地 vendored 数据：`lib/data/vto_taxonomy.json`、`layout_rules.json`、`content_boundaries.json`、`templates.json`、`writing_rules.json`、`diagnostic_report.template.md`
