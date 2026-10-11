# dsh-latex-studio 设计审阅与目标设计

> 审阅日期：2026-10-11 · 宿主 `DeepSeek Harness 0.2.0-rc.2`（Electron 桌面端）· MiKTeX 26.5
> 依据：官方 `develop/*` 全部页面 + **PaperFit 论文原文**（arXiv:2605.10341，47 页，本地
> `_analysis/paperfit-paper/paperfit.pdf`，经 MinerU 结构化解析）+ **PaperFit 官方实现**
> （`paperfit-cli`，本机 `%TEMP%\pfcli\node_modules\paperfit-cli`，MIT）+ 本仓库
> `docs/paperfit-notes.md` + 独立的中文综述（`论文研读/2605.10341_PaperFit_中文综述.md`）。
> 本文替换了本文件 2026-10-11 的初版；初版中关于"用纯文本度量替代视觉通道"的**结论是错的**，
> 第 2 节记录了错在哪里，以免后人重犯。

---

## 1. 一句话结论

插件的**机制方向是对的**（闭环 + 结构化缺陷 + 受限修复 + 门禁，正是 PaperFit 相对朴素多轮视觉的
增益来源）。真正的问题不是"该不该看图"，而是**把 PaperFit 已有的确定性机检与结构化诊断产物丢了**：

- PaperFit 的 `layout-detective-agent` 会先用 `scripts/detect_column_void.py` 做**机检**，
  把结果作为 `machine_signals` 与页图结论**合并**；本插件把页图给了模型，却**没给任何机检数字**。
- PaperFit 的阈值分散在 `config/layout_rules.yaml`；本插件 vendored 了同一个文件，
  但 checklist 里大部分缺陷的 `thresholds` 是 `null`——模型被告知"要看什么"，却没被告知"多少算缺陷"。
- PaperFit 有 `scripts/evidence_collector.py` 做**跨轮持久化证据链**；本插件只有轮次记录，没有缺陷台账。

---

## 2. 我的初版结论错在哪里（必须记录）

初版提出：把版式判据从"页图"改成"纯文本度量"，并让 `attachImagesPerRound` 默认 0。
**这是错的**，而且证据就在本仓库自己的 `docs/paperfit-notes.md` §5、以及论文 Table 5：

| 方法 | 反馈范式 | Compile ↑ | Render ↑ | VLM ↑ | Win ↑ | Page hit ↑ |
|---|---|---|---|---|---|---|
| Perturbed | 无修复 | 0.5800 | 0.8200 | 1.8275 | 0.0000 | 0.3750 |
| RuleLog | 规则+日志 | 0.5200 | 0.7600 | 2.1838 | 0.3800 | 0.4444 |
| TextST | 纯文本单轮 | 0.5850 | 0.5850 | 1.8522 | 0.2800 | 0.4530 |
| TextMR | 纯文本多轮 | 0.6100 | 0.6100 | 2.1601 | 0.4250 | 0.6230 |
| VisualST | 视觉单轮 | 0.6250 | 0.6250 | 1.8741 | 0.2950 | 0.4560 |
| VisualMR | 朴素多轮视觉 | 0.9750 | 0.9750 | 2.8006 | 0.6500 | 0.5487 |
| **PaperFit** | 结构化视觉闭环 | **1.0000** | **1.0000** | **3.3907** | **0.8950** | **0.8050** |

三条硬事实：

1. **所有纯文本/日志方法的 VLM 上限是 2.1838（RuleLog），Win 上限 0.4250。**
   论文原文结论："文本/日志方法判断不了『留白过多』『浮动体级联』这类二维版面失败。"
   → 用文本替代视觉，天花板就锁死在 2.18。
2. **RuleLog 的 Compile/Render（0.52/0.76）甚至低于不做任何修复的 Perturbed（0.58/0.82）**——
   确定性规则修复会**误伤**原本可渲染的输入。纯规则/纯文本路线不只是"不够好"，是**会变差**。
3. **视觉是必要的**：VisualST/VisualMR 相对 TextST/TextMR 的 Render 从 0.585/0.61 跳到 0.625/0.975。

**另一个我低估了的事实**（初版只看到"PaperFit 比 VisualMR 好"，没看到**为什么**）：

> VisualMR 与 PaperFit 的区别**不是模型是否看到页面图像**，而是多轮过程是否围绕
> "显式缺陷、约束修复、验收门控"组织。

且 **Program 分几乎相同**（VisualMR 4.5789 vs PaperFit 4.5790）、
**所有方法内容相似度都 > 0.97**。也就是说：增益**不来自**图像本身，也**不来自**语义改写，
而来自**结构化组织**：显式缺陷台账 + 受限修复策略 + 回滚感知门禁。

**结论（设计的第一性依据）**：
- 视觉通道**必须保留并作为判据主体**——初版要关掉它是错的。
- 要补的是**结构化组织**（机检数字 + 数值阈值 + 缺陷台账 + 门禁），这才是 PaperFit 相对
  VisualMR 的全部增益来源，也是本插件目前最薄的地方。
- 机检的作用是**为视觉判读提供目标与量化**，不是替代视觉。

---

## 3. 已实施（本轮，A 组）

### A1 `lib/core/voidetect.js` — 移植 PaperFit 的 A5 列空洞机检 ★核心新增

PaperFit `scripts/detect_column_void.py`（377 行，OpenCV + numpy）的**行为等价移植**。
本机**没有 cv2**（只有 numpy/PIL），且 `dependencies: {}` 是硬不变量，因此用 Node 内置
`zlib` 自解 PNG，纯 JS 重实现原版每一步：

| 原版步骤 | 原版行号 | 本移植 |
|---|---|---|
| 灰度化 | :179-180 | `decodePngGray`（ITU-R 601 权重，同 `cv2.COLOR_BGR2GRAY`） |
| Otsu 求墨迹阈值 +15，夹 [120,220] | :149-156 | `otsuThreshold` / `inkThreshold` |
| 中缝：33%–67% 找最亮竖带中心 | :62-80 | `findGutterX` |
| 行向墨迹占比 + 移动平均 | :83-97 | `rowInkRatio` / `smooth1d` |
| 无墨迹成段 → 合并近邻 → 双阈值过滤 | :100-146 | `findVoidSegments` |
| Sobel 纵向梯度峰值间距估行高 | :194-203 | `estimateLineHeight` |
| 输出 `a5_candidates` | :228-243 | `analyzePageImage` |

**忠实度的实测锚点**：真实页图 `latex-demo` 第 1 页（1241×1754）→ `lineHeight=24px`，
即 24/150dpi×72 = **11.5pt**，与 11pt article 正文相符 → 行高估计正确。

**一个必须保留的语义修正**：原版**假定输入是双栏**，总是按中缝切左右两栏。单栏页没有中缝，
硬切会产出假空洞（实测单栏页被切成 ~30% 的"左栏空洞"）。A5 在 taxonomy 里本就只对双栏成立，
所以移植版把 `layout` 设为**必需参数**：`single` 时**不做**空洞判定，只报页面级度量。
（`test/voidetect.test.mjs` 有一条专门的回归测试锁住这一点。）

**架构上它只产出候选**，与 `agents/layout-detective-agent.md:130, :180, :240` 一致：
机检 → 模型看图确认 → 确认才写入 defects；**模型否定则记为误报**。
工具输出里明确写着这句，`machineSignalLine` 的措辞也刻意不出现"缺陷"二字。

### A2 `vto_inspect` 接入机检与数值阈值

- 新增 `machineSignals`：逐页 `inkRatio` / `trailingBlankRatio` / `contentBox` /
  `estimatedLineHeightPx` / `columns` / `a5_candidates`，以及 `a5CandidatePages`。
  这些都是**可测**的：`trailingBlankRatio` 就是 A2（末页留白）的量化代理。
- `buildChecklist` 现在把 `lib/data/layout_rules.json` 的数值阈值按缺陷 ID 挂到
  `layoutRules` 上（A1 段末行比、A2 留白比、A4 栏高差、A5 空洞比、B1 引用距离、
  B2 宽度利用率、B3 堆叠数、D1/D2 溢出阈值）。**阈值只有一份来源**，不再抄进 taxonomy。
- 实测在真实 `latex-demo` 上：第 1 页 `ink=0.91%`、`contentBox={263,359,1007,1455}`、
  `trailingBlank=17.05%`（阈值 20%，**未触发 A2**——这是正确的不报警）。

### A3 配置与路径的结构性简化（首轮已完成，见 `HANDOFF.md` §17.1）

bundle patch 不再携带 `config`（消灭"覆盖一个字段丢掉其余 19 个"）、路径守卫合并为唯一实现、
`applyEdits` 改字面替换（`$` 陷阱）、空 `.aux` 不算收敛、`workDir` 不得逃出工程、
删除 3 个死配置字段、`lint` 不再抛异常、`bib` 写后校验纳入保护、
封堵测试"假绿"、新增文档可追溯性测试。

---

## 4. PaperFit 机制 → 本插件落点（含**缺口**）

| PaperFit 组件 | 本插件状态 | 缺口 |
|---|---|---|
| `agents/orchestrator-agent.md` | `vto_start` + `state.js` 状态机 | 缺 `next_action` 与轮次目标的显式流转 |
| `agents/rule-engine-agent.md` | `logparse.js` + `latex_build` | ✅ 覆盖 |
| `agents/layout-detective-agent.md` | `vto_inspect` + checklist | **本轮补齐机检合并**；仍缺"结构化缺陷记录 `d=(c,o,r,e)`" |
| `agents/code-surgeon-agent.md` | `vto_fix` + `policy.js` | 覆盖；但写入仍靠字面替换（见 §5 B3） |
| `agents/semantic-polish-agent.md` | `vto_fix` + `enableSemanticTuning` | 覆盖（默认关，符合论文"最后手段"） |
| `agents/quality-gatekeeper-agent.md` | `vto_verify` 五项 checks | 覆盖 |
| `scripts/detect_column_void.py` | **本轮新增 `voidetect.js`** | ✅ 移植完成 |
| `scripts/extract_crossrefs.py` | `lint.js` 的 B1 距离 | ⚠ 需核对是否等价（原版有 `orphan_refs`/`orphan_labels`） |
| `scripts/content_integrity_check.py` | `guard.js` | ✅ 覆盖 |
| `scripts/evidence_collector.py` | 轮次记录 | **缺跨轮证据链/缺陷台账** |
| `scripts/parse_log.py` | `logparse.js` | ✅ 覆盖 |
| `scripts/render_pages.py` | `render.js`（poppler→mgs→mineru） | ✅ 且本地优先（零上传） |
| `config/layout_rules.yaml` | `layout_rules.json` | **本轮接上 checklist 阈值** |
| `config/vto_taxonomy.yaml` | `vto_taxonomy.json` | ✅ 18 ID 一致 |
| `config/diagnostic_report.template.md` | 同 | ✅ |
| `skills/*/SKILL.md`（9 个） | 3 个 SKILL.md | **缺 6 个 fixer 技能的可执行规范** |
| `CLAUDE.md`（300 行运行守则） | 散落在 SKILL.md 与工具描述 | **缺单一权威守则** |

**"避免重复造轮子"的具体含义**：`paperfit-cli` 的 9 个 SKILL.md + 6 个 agent .md 是**论文级的规范文本**
（`skills/taxonomy-vto/SKILL.md` 18.5KB、`space-util-fixer` 11KB、`float-optimizer` 11.2KB 等）。
它们不需要"重写"，正相反：**应当 vendor 成数据资产**，让执行模型直接读到与 PaperFit 同源的规范，
而不是让后人凭记忆复述。这是当前最大的"重复造轮子"来源——`latex-fix-catalog/SKILL.md` 只有 420 行，
而对应的上游规范合计超过 100KB。

### 4.1 ✅ 已完成（2026-10-11）

**Vendor 上游规范文本**（`paperfit-cli@1.0.6`，MIT）：

| 落地 | 内容 |
|---|---|
| `docs/upstream/paperfit/agents/*.md` | 6 个 agent 规格，**逐字节等同上游** |
| `docs/upstream/paperfit/CLAUDE.md` + `commands/*.md` + `LICENSE` | 运行守则与命令定义，逐字节等同上游 |
| `skills/paperfit-<name>/SKILL.md` | 8 个 fixer/检查技能；**唯一改动**是前置 YAML frontmatter（`name` + `description`，由上游标题与首段机械推导），上游正文原样保留 |
| `docs/upstream/paperfit/MANIFEST.json` | 逐文件来源、来源 sha256、上游版本、转换类型 |
| `tools/vendor-paperfit-specs.mjs` | 可复现的 vendor 脚本；`--check` 在漂移时失败 |
| `tools/install-skills.mjs` | 把技能装进**真实的发现根目录**并自检 |

未 vendor：`skills/latex_fixers/*.py`（67KB Python）——那是实现而非规范，且本包保持 `dependencies: {}`。

### 4.2 ⚠ 一个顺带查出的真问题：`skills/` 从来就没被发现过

官方 Skills 参考的"本地发现优先级"表说明，发现只扫描**配置好的根目录**
（rank 100 `project-dsh` / 200 `project-agents` / 300 `customSkillDirs` / 400 `user-dsh` /
500 `user-agents` / 600 `bundledSkillDir`）。**npm 包自己的 `skills/` 不在其中。**

本机实测：workspace 无 `.git`、无 `.dsh/skills`，profile 未配 `bundledSkillDir`/`customSkillDirs`，
`~/.dsh/skills` 为空 —— 也就是说**本插件的 3 个 `latex-*` 技能随包发布了很久，但一次都没被任何会话发现**。
当时用兜底脚本 `tools/install-skills.mjs --check` 对全部技能逐个报 `MISSING`，这就是证据。
（该脚本与那批 vendored 技能在 0.2.0 一并删除，见下。）

**第一次修法走了弯路**：我加了 `tools/install-skills.mjs`，把技能链接进 `~/.dsh/skills`（rank 400）。
它能用（`--check` 全 `OK`），但**方向错了**：那是"文件发现"路线，需要外部安装步骤、
会在发现根里留下副本、还要用户记住去跑。

**正确做法（已改为默认）**：**DSH 是围绕插件设计的，插件已经装载，就直接注册。**
`lib/index.js` 在 `apply()` 里 `ctx.get('skills')` → `loadSkillPack()` → `registerSkillPack()`，
把 11 个技能注册进 `ctx.skills`：

| | 文件发现（弯路） | 插件注册（现在） |
|---|---|---|
| 需要安装步骤 | 是 | **否** |
| 需要改 profile | 是 | **否** |
| 卸载清理 | 手动 | **自动**（注册是 effect） |
| 与插件同生命周期 | 否 | **是** |
| 组合里没有技能服务时 | 无影响 | **9 个工具照常可用**（`ctx.get` 可选依赖，不进 `inject`） |

**0.2.0 修订**：兜底脚本删除；同时**不再注册 vendored 的上游规范**——注册 11 个技能等于把 PaperFit 的 agent/命令/路径当成本插件的手册，而 `latex-*` 才是本插件自己的操作规程。现在注册的就是 3 个 `latex-*`，上游原文只作 `docs/upstream/paperfit/` 下的只读参考。

实测（仓库开发副本）：`apply()` 注册 **9 工具 + 3 技能，0 problems**；
无技能服务时仍注册 **9 工具**；技能服务抛异常时被隔离且**上报失败**而不是静默。

---

## 5. 其余待办（按价值排序）

| # | 事项 | 依据 |
|---|---|---|
| B1 | **缺陷台账**：把每轮 `defects[]`（`d=(c,o,r,e)` + `evidence_sources` + `cv_signal_ref`）持久化进 `state.json`，供下一轮对比与门禁 | 论文的核心增益是"**持久化缺陷记录 + 验收门控**"；VisualMR 正是在"第一个可渲染结果"处停下 |
| B2 | **B2 缺陷的机检**：从页图测图表实际渲染宽度与栏宽之比（`table.min/max_width_utilization`） | `layout-detective-agent.md:187-192` 明确要求；本插件目前没有这门测量。B1-B（placement 导致的尺寸压缩）同理 |
| B3 | **A2/A4 的机检** | `trailingBlankRatio` 已在 `machineSignals` 里，可直接判 A2；A4 栏高差需比较两栏栏底墨迹位置。阈值已在 checklist，缺的是"谁去量" |
| B4 | **`vto_fix` 与宿主 `edit` 分工**：`vto_fix` 保留"配方 + 预检 + 备份/回滚"，写入交宿主 `edit`（有版本守卫） | 两套写入机制并存，把宿主已解决的版本漂移又留在插件里 |
| B5 | **`vto_inspect.parse`/`consent` 空承诺**：要么真正调用结构化解析，要么删参数 | 声明了却不做，与已删的 3 个死配置字段同一理由 |
| B6 | **`latex_build.clean` 会 `rmSync(recursive)`** | `workDir` 已加固，但 `clean` 仍是无二次确认的递归删除 |
| B7 | **junction/symlink 写入穿透** | 路径守卫是词法的，`realpath` 复检可堵 |
| B8 | **`extract_crossrefs` 等价性核对** + `orphan_refs`/`orphan_labels` | `layout-detective-agent.md` 第零步要求；原版输出含悬空引用与未被引用的标签 |
| B9 | ✅ **0.2.0 已处理** | `_meta.json` 删除；其余 4 份 JSON 接上消费者（见 HANDOFF §17.3） |
| B10 | **`INTERFACES.md` 重建** | 重复 §13、缺 `paths.js`/`voidetect.js`、`checkPolicy` 三参未记、多项未文档化导出 |

---

## 6. 边界：我做过什么、没做什么

**做过并验证过**：
- 移植 `detect_column_void.py` → `lib/core/voidetect.js`，16 条测试通过，含真实页图行高锚点。
- `vto_inspect` 输出 `machineSignals`；`buildChecklist` 补上 `layout_rules` 数值阈值。
- Vendor 上游 22 个规范文件（含 `MANIFEST.json` 与来源 sha256），8 条守卫测试通过。
- **技能改为插件自注册**：`apply()` 实测注册 9 工具 + 11 技能、0 problems；无技能服务时 9 工具照常；
  10 条 `skillpack` 测试通过。已撤掉此前链接进 `~/.dsh/skills` 的兜底副本，避免双重来源。
- **可用性收口**（见 §8）：`tools/install.mjs`（一条命令安装 + 自动验证）、`tools/doctor.mjs`
  （插件之外的 5 步健康自检）、README §3.1 两个真实场景流程，分别有 8 + 6 条测试钉住。
- 全量测试在**仓库**与**安装副本**两处都跑过（安装副本 1 条 skip：真实页图行高锚点需要 `latex-demo`）。

**没做过 / 未验证**：
- **没有在运行中的宿主里看到注册结果**：本会话执行的是**重启前**装载的插件实例，
  `skill` 工具仍报 `unknown or no longer available`（连旧的 `latex-daily` 也一样，说明是实例级而非文件级）。
  代码路径、契约形状与副作用语义都有测试覆盖，但"重启后宿主目录里确实多出 11 个技能"需要
  **重启 DSH 或开新会话**才能看到——请照此确认。
- **没有**把真实双栏论文跑过机检：唯一的真实工程 `latex-demo` 是单栏，双栏路径由合成页图覆盖。
- **没有**跨版本验证移植的数值等价性：本机无 `cv2`，无法跑上游脚本逐页对比。
  替代验证：真实页图行高 = 24px ≈ 11.5pt（与 11pt 正文相符）、合成双栏页正确检出且不误报。
- **没有**改 `vto_fix` 的写入机制、没有做缺陷台账（§5 的 B1/B4）——属契约变更，留给下一轮。

---

## 8. 可用性收口（本轮后半）

工具的**能力**和**能被用起来**是两件事。本轮补的是后者，做法是一致的：
**把"只有作者知道的操作知识"变成一条命令或一段可复制流程，并让测试钉住它。**

| 问题 | 之前 | 现在 |
|---|---|---|
| 装/升级要 4 步手工，容易半途出错 | HANDOFF §11.2 手工清单 | `node tools/install.mjs`：打包 → 备份并注册 profile → 镜像 → **自动跑 doctor 验证**；失败报错并给回滚命令；`--dry-run` 可预演 |
| "装上了但没加载"无从判断 | 靠 `plugin list` 猜 | `node tools/doctor.mjs`：**在插件之外**检查 文件 → `apply()` 注册 → profile 登记 → 影子技能 → 工具链；退出码 0/1/2，`--json` 给 CI |
| 技能随包发布却一次没被发现 | 无人知道 | 插件自注册（§4.2），doctor 里有一项专门验证 11 个技能确实注册 |
| 文档多但不知道从哪开始、怎么串 | 工具表 + 长篇 HANDOFF | README §3.1 给**两个真实场景的完整调用序列**（日常编译 / 降页数），并标注每步的判定标准 |
| 文档与代码漂移 | 靠人工发现 | `test/docs.test.mjs` 现在钉住：配置字段数、布局名、模块地图、**README 流程里出现的每个工具与参数名必须真实存在**、全库 UTF-8 无 U+FFFD |

**为什么 doctor 必须是 CLI 而不是工具**：这个插件最危险的失败模式是"装上了但没加载"，
而**没加载的插件无法注册工具来报告自己没加载**。诊断能力必须活在插件生命周期之外——
这一条直接来自 E5 的教训（§3 的 PENDING 分析）。

**为什么 `install.mjs` 要自带验证**：手工流程的最后一步"记得去校验"正是最容易被跳过的一步。
把验证编进安装动作本身，"装好了"才等于"doctor 说 HEALTHY"，而不是"我以为复制完了"。

---

## 7. 关键不变量（不得破坏）

1. `lib/core/*` 零 DSH 依赖；`lib/tools/*` 不写业务逻辑。
2. 只有一份路径守卫（`lib/core/paths.js`）。
3. 配置两处同步，bundle patch 不带 `config`。
4. 缺外部件返回 `skipped + advice`，不抛异常。
5. `vto_fix` 默认不写盘；写盘 = 备份 → 写 → guard → 失败回滚。
6. 内容保全优先于视觉质量。
7. `dependencies` 保持为空（因此 `voidetect.js` 自解 PNG，不引 cv2/pngjs）。
8. 测试自建夹具；**不得让失败伪装成 skip**。
9. 声明了就必须用（配置字段 / 工具参数 / 数据文件）。
10. **机检只产候选，判据永远是页图**；模型否定候选时记为误报，不得反向强行记缺陷。
