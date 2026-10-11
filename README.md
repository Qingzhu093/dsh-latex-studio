# dsh-latex-studio

> MiKTeX 原生的 **LaTeX 编译 + VTO（Visual Typesetting Optimization，视觉排版优化）闭环**插件，面向 DeepSeek Harness（DSH）桌面端。
> 两套命令体系：**A 线 日常编译**（`latex_doctor` / `latex_build` / `latex_lint` / `bib_tool`）与 **B 线 VTO 全流程**（`vto_start` / `vto_inspect` / `vto_fix` / `vto_verify` / `vto_report`）。
> 方法学参考 PaperFit（MIT，[arXiv:2605.10341](https://arxiv.org/abs/2605.10341)），要点见 [docs/paperfit-notes.md](docs/paperfit-notes.md)；模块契约见 [docs/INTERFACES.md](docs/INTERFACES.md)；验收见 [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md)。
>
> 🔧 **维护 / 开发从这里开始：[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)** —— 架构、工具面、配置契约、维护配方、排错、已知问题，以及历史记录。
> 🧭 **设计依据与取舍**：见 DEVELOPMENT.md §7（关键设计决策与**被否决的方案**）。
>
> ℹ️ **技能由插件自己注册**，装完插件即可用，不需要额外步骤（见 §2.5）。`skills/` 里只有本插件自己的 3 个 `latex-*`；vendor 自 PaperFit 的上游规范自 0.2.0 起只作参考文本（`docs/upstream/paperfit/`），不再注册、不随包发布。

## 1. 它解决什么问题

「编译通过」不等于「可投稿」：孤行寡行、浮动体远离引用、双栏列内空洞、Overfull、表格字号不一等**二维版面缺陷**，只看源码和 `.log` 是看不出来的。
本插件把「**编译 → 读日志 → 渲染页图 → 诊断（18 类缺陷）→ 受限修复 → 门禁复核**」做成可复现的 DSH 工具链：

- **不依赖 latexmk**：MiKTeX 的 latexmk 是 Perl 脚本、需要 Perl（本机没有）。`latex_build` 自研多趟驱动（引擎 → 需要时 bibtex/biber → 直到 `.aux` 稳定，最多 4 趟）。
- **页图后端全部本地、零额外安装**：MiKTeX 自带 Poppler（`pdftoppm`）与 Ghostscript（`mgs.exe`）；MinerU 只作可选兜底。
- **外部件缺失绝不抛异常**：一律降级为 `status:'skipped'` + `advice`（可执行的修复命令）。
- **写操作原子化**：先备份 → 再写 → 用内容守卫校验 → 失败回滚；`vto_fix` 默认 `apply:false` 只给配方与 diff。
- **缺陷台账跨轮持久**：`vto_report({defects:[…]})` 按 `id+page` 落进 `state.json`，`vto_verify` 对「标了 fixed 又复发」判回归、对未清的阻断级缺陷降级 verdict——这是 PaperFit 相对朴素多轮视觉的全部增益来源（显式缺陷记录 + 受限修复 + 门禁）。
- **编译驱动**：默认优先 `latexmk`（带 `.fls` 依赖追踪；需要 Perl，Git 自带亦可），不可用时自动回落内置多趟驱动，两者产出同一结果结构（`via` 标明走了哪条）。
- **隐私内置**：`uploadScope` 闸门统一决定「哪种 PDF 解析可以上传」，默认不外发本人稿件。

## 2. 安装与自检

### 2.1 一条命令（推荐）

```powershell
cd <本仓库>\dsh-latex-studio
node tools/install.mjs              # 打包 → 注册进 profile → 镜像到 node_modules → 自检
```

它会：① `npm pack`（遵守 `files` 白名单，`tools/_p0` 调研证据永远不会进发布集）；
② 备份 profile 清单并登记 bundle；③ 把包树镜像进 `node_modules`（保留已有 `node_modules`）；
④ 用 `tools/doctor.mjs` 验证部署副本，**失败即报错并给出回滚命令**。

参数：`--profile <名字>`（默认 `desktop`）、`--dry-run`（只打印计划，不改任何东西）、
`--no-pack`（复用已打好的 tgz）。

> 安装完会提示 `restart DSH`。**必须重启或开新会话**，新构建才会被加载——正在运行的进程用的仍是旧实例。

### 2.2 自检：`node tools/doctor.mjs`

**装完就该跑一次。** 这个插件最危险的失败模式是"装上了但没加载"，而**没加载的插件无法注册工具
来告诉你它没加载**——所以诊断必须能在插件之外运行：

```powershell
node tools/doctor.mjs                  # 检查当前目录
node tools/doctor.mjs --dir <安装副本>  # 检查别的副本
node tools/doctor.mjs --json           # 机器可读（CI 用）
```

它按顺序回答 5 个问题：**文件齐不齐 → `apply()` 能否注册 9 工具 + 技能包 → bundle 有没有登记进
profile → 发现根里有没有重复技能（会互相遮蔽）→ 本机 LaTeX 工具链能不能真编译/渲染**。

退出码：`0` 健康｜`1` 有失败项｜`2` 脚本自身出错。本机实测输出：

```
[OK  ] files      26 required files present
[OK  ] patch      inserts the plugin row with no duplicated defaults
[OK  ] tools      9 tools registered: latex_doctor, latex_build, latex_lint, bib_tool,
                  vto_start, vto_inspect, vto_fix, vto_verify, vto_report
[OK  ] skills     3 skills registered: latex-daily, latex-fix-catalog, latex-vto-loop
[OK  ] profile    registered in: desktop
[OK  ] in-sync    this directory IS what profile "desktop" loads
[OK  ] shadows    no discovery root duplicates the plugin-registered skills
[OK  ] toolchain  engine=D:\MiKTeX\miktex\bin\x64\pdflatex.exe (MiKTeX-pdfTeX 4.27 (MiKTeX 26.5))
[OK  ] render     page-image backend: poppler (pdftoppm+pdfinfo)
[OK  ] bib        bibliography tooling: bibtex, biber
verdict: HEALTHY
```

### 2.3 手工安装（不用脚本时）

正规通道是**应用内插件管理器**。走命令行时用**桌面端自带的 CLI**：

```powershell
npm pack
& "D:\DshDesktop\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add (Resolve-Path .\dsh-latex-studio-0.1.0.tgz)
& "D:\DshDesktop\resources\runtime\cli\bin\dsh.cmd" plugin list --profile desktop
```

> ⚠️ 请用上面的**全路径** `dsh.cmd`：PATH 上还有一个旧版 `dsh`（**0.1.5-rc.1**），桌面端自带的是
> **0.2.0-rc.2**；用错版本操作不到桌面端 profile（见 §9）。
> ⚠️ 本机实测 `dsh plugin add` 在 Electron 独占管理的 profile 上**会挂起**，所以日常请用 §2.1 的脚本。
> 也**不要**用 `--profile desktop --dump-config` 校验（同样被拒绝）。

### 2.4 升级 / 卸载

```powershell
node tools/install.mjs        # 升级 = 再跑一次（每次自动备份 profile 清单）
node tools/doctor.mjs         # 升级后自检
```

卸载：从 profile 的 `package.json` 删掉 `dependencies` 里的依赖与 `dsh.profile.bundles` 里的条目，
再删掉安装副本目录。（清单在 `$DSH_HOME/profiles/<名字>/package.json`，`$DSH_HOME` 默认 `~/.dsh`。）

### 2.5 技能：由插件自己注册（不需要额外步骤）

**装了插件就有技能。** `lib/index.js` 在 `apply()` 里调用 `ctx.skills.register()` 把整包技能
注册出去（**只有本插件自己的 3 个 `latex-*`**：`latex-daily`、`latex-vto-loop`、`latex-fix-catalog`）。
注册是 effect，插件卸载时自动撤销；不需要安装脚本、不需要文件链接、不需要改 profile 配置。

> 0.2.0 起**不再注册 vendored 的上游规范**：那些文本描述的是 PaperFit 的 agent/命令/路径（`data/pages/`、220 DPI、`/check-visual`），注册进来等于让模型拿别人的操作规程当本插件的手册。上游原文保留在 `docs/upstream/paperfit/`（含 MANIFEST 与逐文件哈希）作**只读参考**，`docs/` 也已移出发布白名单。

```js
// lib/index.js（节选）
const service = ctx.get('skills')            // 可选依赖，故意不放进 inject
if (service?.register) registerSkillPack(service, loadSkillPack().skills)
```

> **为什么不能只把文件放进 `skills/`。** DSH 的技能发现只扫描**配置好的根目录**
> （官方 Skills 参考的"本地发现优先级"）：
>
> | rank | source | 根目录 |
> |---|---|---|
> | 100 | `project-dsh` | `<项目根>/.dsh/skills` |
> | 200 | `project-agents` | `<项目根>/.agents/skills` |
> | 300 | `custom` | `Config.customSkillDirs` |
> | 400 | `user-dsh` | `<dshHome>/skills` |
> | 500 | `user-agents` | `<agentsHome>/skills` |
> | 600 | `bundled` | `Config.bundledSkillDir` |
>
> **npm 包自己的 `skills/` 不在其中。** 本项目此前就是这样：3 个 `latex-*` 技能随包发布很久，
> 却一次都没被任何会话发现过。DSH 是围绕插件设计的，插件既然已经装载，就没有理由再绕一圈做文件发现。
>
> `skills` 是**可选**依赖（`ctx.get` 而不是 `inject`）：组合里没有技能服务时，10 个工具照常可用，
> 而不是让插件永远 PENDING——PENDING 的插件连一个工具都注册不了。

**不用插件时怎么读技能**：直接打开 `skills/<名字>/SKILL.md` 即可（例如在编辑器或 CI 里）。
0.2.0 删除了 `tools/install-skills.mjs`：它是为「技能不进上下文」那个已经修好的问题写的兜底，而把同一批技能同时注册又放进发现根，只会互相遮蔽。


### 2.6 环境要求与自助安装（发布版必读）

**硬依赖只有一个：MiKTeX。** 它同时提供引擎、`bibtex`/`biber`/`makeindex`、页图后端（Poppler `pdftoppm`/`pdfinfo`、Ghostscript `mgs.exe`）。其余全部可选，缺了就降级，绝不抛异常。

模型先跑 `latex_doctor`：它逐项报出「已装 / 缺失 + 安装命令」，`advice[]` 里就是可执行命令。对照表：

| 组件 | 必需性 | 用途 | 缺失后果 | 安装（Windows） |
|---|---|---|---|---|
| MiKTeX（`pdflatex`/`xelatex`/`lualatex`、`bibtex`、`biber`、`makeindex`、`chktex`、`pdftoppm`/`pdfinfo`、`mgs.exe`） | **必需** | 编译、参考文献、页图 | A 线除 `latex_lint` 外全部 `skipped` | `winget install MiKTeX.MiKTeX` |
| Perl + `latexmk` | 可选（推荐） | `.fls` 依赖追踪、正确重跑 | 自动回落内置多趟驱动（结果结构一致，只是没有依赖追踪） | `winget install StrawberryPerl.StrawberryPerl`；或使用 Git 自带的 `<Git>\usr\bin\perl.exe`（探测会自动找到） |
| `chktex` | 可选 | 静态检查的外部通道 | `latex_lint` 少一路信号 | `mpm --install=chktex` |
| 缺宏包 | 按需 | 编译通过 | `latex_build` 报 `File ... not found` | `latex_build` 默认带 `--enable-installer` 自动补装；或 `mpm --install=<pkg>` |
| MinerU / 宿主 `read_pdf` | 可选 | 结构化解析（**可能上传**） | `vto_inspect({parse:true})` 在 `notes` 里说明 | 安装 DSH 的 `dsh-pdf-mineru` 插件 |

**自助安装流程**（模型照做即可，不需要用户手动）：

1. `latex_doctor({})` → 读 `advice[]`；
2. 对每条缺失项执行它给出的命令（`winget install …` / `mpm --install=…`）；
3. 再跑 `latex_doctor({ refresh: true })` 确认变为 `OK`；
4. 仍然缺失的项**如实告诉用户**，不要假装编译通过。

> MiKTeX 首次编译会慢：`--enable-installer` 需要联网按需下载宏包。
## 3. 两套命令体系

### 3.1 怎么用（两个真实场景）

工具表在 §3.2 / §3.3；**先看这两段流程更有用**。

#### 场景 A：写好并交付一篇 LaTeX（日常，不需要页图）

```
用户：帮我把 paper/ 编译通过，参考文献也要对。

模型：latex_doctor({})                       ← 先体检，缺件会直接告诉你装什么
      latex_build({dir:"paper"})             ← 看 status / errors[{file,line}] / overfull
      …按 errors 的行号改 tex，再 latex_build…
      latex_lint({dir:"paper"})              ← 抓伪修复与引用/标签对账
      bib_tool({action:"audit", bib:"paper/refs.bib", tex:["paper/main.tex"]})
      latex_build({dir:"paper"})             ← 门禁：必须 status="passed" 才算交付
```

**判定标准**：`latex_build` 返回 `passed`，且 `errors` 为空。**没有编译通过不算写完。**

#### 场景 B：论文超页数，要"排版级"收紧（B 线 VTO）

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

**判定标准**：`vto_verify` 的 `verdict` 为 `pass`/`pass_with_notes`，且 `checks.contentIntegrity` 通过
（\cite/\label/\ref/\caption 一个都没丢）。**任何一轮 `contentIntegrity` 失败都先回滚，不要继续叠改动。**

**机检与页图怎么分工**（重要）：`vto_inspect` 的 `machineSignals` 只给**候选**（例如 A5 列空洞的
位置与占比），**判据永远是页图**。看图后否定某个候选，就把它记成机检误报，**不要**当成缺陷写进报告。

### 3.2 A 线：日常编译（`enableDaily`）

| 工具 | 用途 | 关键参数 |
|---|---|---|
| `latex_doctor` | 环境体检：引擎/引擎版本、biber/bibtex/makeindex/chktex、页图后端、MinerU 可用性与是否会上传，附修复建议；`verifyPdfRead:true` + `pdfPath` 时**真渲染第 1 页**并返回 `renderProbe` | `refresh` `verifyPdfRead` `pdfPath` |
| `latex_build` | 多趟编译：引擎直调 + 多趟循环，返回 `status` / `engine` / `passes`（引擎趟数，bib 那趟记在 `bib`）/ `pages` / `pdfPath` / `logPath` / 结构化 `errors`/`warnings`/`overfull` | `dir`（必填）`entry` `engine` `clean` |
| `latex_lint` | 静态规则检查：伪修复（`\resizebox`、裸 `\vspace`、滥 `\newpage`、`\tiny`/`\scriptsize`）、引用/标签对账、图-引用距离；可选 chktex | `dir`（必填）`entry` `rules` |
| `bib_tool` | `.bib` 的 `lint` / `format` / `fill`（Crossref，只补不覆盖）/ `audit`（正文与 .bib 双向对账）；**解析不完整时拒绝写入** | `action`（必填）`bib`（必填）`tex` `write` |

### 3.3 B 线：VTO 全流程（`enableVto`）

| 工具 | 用途 | 关键参数 |
|---|---|---|
| `vto_start` | 建立基线：`<workDir>/state.json` + 内容快照（cite/label/ref/caption + 每文件 sha256）+ 页数基线 | `dir` `entry` `pageBudget` `template` `columnType` `workDir` |
| `vto_inspect` | **视觉检测**：按 `rendererOrder` 渲染页图（image 内容块回会话）+ 带数值阈值/视觉特征/日志信号的 18 项 checklist + `machineSignals` 机检候选 + 当前缺陷台账；`parse:true` 走真实结构化解析（受 `uploadScope` 闸门） | `dir` `pdf` `pages` `dpi` `focus` `parse` `consent` |
| `vto_fix` | 受限修复：默认 `apply:false` 只给 diff/配方；`apply:true` 走 备份→写→policy+guard 校验→失败回滚 | `dir` `file` `find` `replace` `replaceAll` / `edits` `apply` `round` `rationale` `force` `allowPolicy` |
| `vto_verify` | 门禁复核：重新编译 + 重新渲染抽样页 + 内容保全 + 页数预算 + 策略 + 关键章节下限 + **台账回归**，给出 `verdict`/`checks`/`regressions`/`rollbackTo` | `dir` `entry` `pdf` `pages` `pageBudget` `round` `dpi` |
| `vto_report` | 写出本轮诊断报告并把缺陷写进台账（`.json` + `.md`；编译状态与内容哈希取自真实记录） | `dir` `round` `verdict` `changes` `remaining` **`defects`** `defectsBefore` `defectsAfter` `notes` |

> **路径基准（0.2.0 起）**：`dir`、`bib`、`tex`、`latex_doctor.pdfPath` 按**会话工作区**解析；`entry`、`file`、`pdf` 按 **`dir` 指向的工程目录**解析（例如 `dir:"paper"` + `entry:"main.tex"`）；`workDir` 是纯目录名。绝对路径、盘符、UNC 与 `..` 一律拒绝。
> 传错基准时工具会直接告诉你应传什么，而不是丢一个 `FILE_NOT_READABLE`（见 `test/params.test.mjs`）。
> `vto_inspect` 默认每轮只内联 1 张页图（`attachImagesPerRound`）；其余页用返回里的
> `pages[].call` 字符串直接照抄调用 `read_image`。想看完整页图就调大该值（或设 0 关掉图片通道）。

### 配置（默认值只在 `lib/index.js` 的 schema 里）

> **改默认值改 schema**（真实宿主唯一生效处），再同步 `lib/config.js` 的 `DEFAULTS`。
> `cordis.patch.yml` **故意不携带 `config`**：patch 是**整份替换** config 而不是深合并，
> 在里面抄一份默认值，会让人只覆盖一个字段就丢掉其余全部。`test/config.test.mjs` 会拦住这种写法。

| 键 | 默认 | 说明 |
|---|---|---|
| `enableDaily` | `true` | 是否注册 A 线 4 个工具 |
| `enableVto` | `true` | 是否注册 B 线 5 个工具 |
| `uploadScope` | `'external-only'` | `external-only` \| `always` \| `never`，见 §5 |
| `rendererOrder` | `['poppler','miktex-ghostscript','mineru-page']` | 页图后端尝试顺序 |
| `popplerPath` | `''` | `''` = 自动探测；也可指向 `pdftoppm.exe` |
| `ghostscriptPath` | `''` | 同上（对应 `mgs.exe`） |
| `readPdfToolName` | `'read_pdf'` | 注入 `render.js` 的宿主工具名 |
| `latexCommand` | `''` | `''` = 自动探测 pdflatex/xelatex/lualatex；**latexmk 被显式忽略** |
| `enableInstaller` | `true` | MiKTeX 下给引擎加 `--enable-installer` 自动补包 |
| `engineArgs` | `''` | 追加给引擎的额外参数（支持引号） |
| `compileTimeoutMs` | `300000` | 编译超时；超时返回 `failed` 且保留 `logTail` |
| `renderTimeoutMs` | `60000` | 单次渲染后端超时 |
| `workDir` | `'.latex-studio'` | 状态/构建/页图/报告/备份的落盘目录；**必须是工程内相对目录** |
| `pageBudget` | `null` | 目标页数（A3/E2） |
| `attachImagesPerRound` | `1` | 每轮回会话的页图数；**设为 `0` 可完全关掉图片通道**（省 token） |
| `enableChktex` | `false` | 是否调用 chktex |
| `chktexPath` | `''` | `''` = 自动探测 |

修改方式：编辑 profile 的 patch（**只写你要改的字段即可**，其余取 schema 默认）后重载；用 `dsh.cmd plugin list --profile desktop` 核对插件是否装入，**生效值**请在应用内设置页查看（`--profile desktop --dump-config` 被 Electron 独占拒绝，见 §2 注）。`apply()` 见 `lib/index.js`，两套体系互相独立——关掉一个不影响另一个。

## 4. 依赖

| 依赖 | 必需性 | 说明 |
|---|---|---|
| **MiKTeX** | **唯一必需外部件** | 同时提供 `pdflatex`/`xelatex`/`lualatex`、`biber`、`bibtex`、`makeindex`、`miktex-chktex`、**`pdftoppm`/`pdfinfo`（Poppler 24.04）**、**`mgs`（Ghostscript 9.25）** |
| `dsh-pdf-mineru`（MinerU） | 可选 | 结构化 PDF 解析的 Provider；**会上传文档**，受 `uploadScope` 约束。本机 `read_pdf({view:'page'})` 实测失败（`PDF.js returned invalid page metadata`） |
| Python sidecar | 可选 | 默认关闭；核心链路不需要 Python |
| Node.js | 宿主自带 | `^22.19.0 || >=24.0.0`；DSH 桌面端 0.2.0-rc.2 自带 Node 24 |
| npm 运行时依赖 | **无** | `dependencies: {}`；`@deepseek-ai/*` 只是 peer（且 `lib/core/*` 完全不 import 它们） |

**不需要单独安装 Poppler**：MiKTeX 自带 `D:\MiKTeX\miktex\bin\x64\pdftoppm.exe`；即使没有 Poppler，还有 `mgs.exe`。
**编译驱动**：默认优先 `latexmk`（需要 Perl；Git for Windows 自带的 `usr\bin\perl.exe` 也会被探测到），探测不到 Perl/latexmk 时自动回落到内置多趟驱动——**没有 Perl 也能用**，只是没有依赖追踪。安装 Perl：`winget install StrawberryPerl.StrawberryPerl`。

一条命令体检页图通道（默认探测 `../latex-demo/main.pdf`）：

```powershell
# --pdf 由脚本按【插件根】解析：指向工作区里的 PDF 要用 ../ 前缀
# 先跑 latex_build，产物在工作区相对路径 latex-demo/.latex-studio/build/main.pdf
node tools/verify-pdf-read.mjs --pdf ../latex-demo/.latex-studio/build/main.pdf
node tools/verify-pdf-read.mjs --pdf ../latex-demo/.latex-studio/build/main.pdf --json
```

> 不带 `--pdf` 时脚本会按一组候选路径探测样例 PDF（其中包含 `latex-demo/.latex-studio/build/main.pdf`）；
> 一个都找不到时结论是 `CONCLUSION: NO SAMPLE PDF`（exit 仍为 0）。**最稳的用法还是显式传 `--pdf`。**

## 5. 隐私模型（`uploadScope`）

`read_pdf` 有两种代价完全不同的模式：`view:'page'` 只在本机渲染一页、**不上传任何文档字节**；`view:'content'`（结构化解析/OCR）会走 Provider，**可能上传整份文档**。统一闸门在 `lib/core/pdfread.js`：

| `uploadScope` | 本人稿件 + 解析模式 | 非本人文档（如参考文献 PDF） | 本地页图（`view:'page'`） |
|---|---|---|---|
| `never` | 拒绝 | 拒绝 | 允许 |
| `external-only`（默认） | **拒绝**（除非单次 `consent:true`） | 允许 | 允许 |
| `always` | 允许 | 允许 | 允许 |

- 视觉通道优先走本地后端，因此**默认配置下完成 VTO 全流程不需要上传任何东西**。
- 闸门返回结构化的 `{allowed, reason, advice}`；被拒绝时工具会给出「改用本地页图」的可执行建议，而不是报错。

## 6. 验收标准

6 条成功标准（安装与开关 / A 线编译闭环 / 视觉通道 / VTO 门禁 / 隐私断言 / 依赖口径）及其**可复现命令与期望输出**见 [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md)。

## 7. 目录结构

```
dsh-latex-studio/
├── lib/
│   ├── index.js            # 宿主入口：按 enableDaily/enableVto 动态注册（Lead）
│   ├── config.js           # DEFAULTS + normalizeConfig（唯一配置真源）
│   ├── core/               # 纯 Node ESM，禁止 import @deepseek-ai/*
│   │   ├── env.js          # 引擎/工具探测、EnvReport
│   │   ├── compile.js      # 多趟编译驱动（不依赖 latexmk）
│   │   ├── logparse.js     # .log 解析（移植 PaperFit parse_log.py，MIT）
│   │   ├── lint.js         # 伪修复/引用对账/图-引用距离
│   │   ├── bib.js          # .bib lint/format/fill/audit（拒绝写入不完整解析）
│   │   ├── render.js       # 页图：poppler → miktex-ghostscript → mineru-page
│   │   ├── guard.js        # 内容快照/校验/密钥扫描
│   │   ├── policy.js       # FORBIDDEN 伪修复规则
│   │   ├── pdfread.js      # uploadScope 闸门
│   │   ├── state.js        # state.json / 备份 / 回滚 / 轮次
│   │   └── report.js       # 轮次报告（json + md）
│   ├── tools/              # 唯一允许 import @deepseek-ai/dsh-tools 的地方
│   │   ├── daily.js        # latex_doctor / latex_build / latex_lint / bib_tool
│   │   └── vto.js          # vto_start / vto_inspect / vto_fix / vto_verify / vto_report
│   └── data/               # 在用的 PaperFit 数据（MIT）：分类法 / 阈值 / 报告模板
├── skills/                 # 操作守则（latex-daily / latex-vto-loop / latex-fix-catalog）
├── test/                   # node:test 单测；run-all.mjs 聚合汇总
├── docs/                   # 【不随包发布】DEVELOPMENT / INTERFACES / ACCEPTANCE / 索引 + upstream 参考
│   └── upstream/paperfit/  # 【只读参考】上游 agent/命令原文 + MANIFEST（逐文件 sha256）
├── tools/                  # 辅助脚本（doctor / install / 页图体检 / 上游参考校验）
├── cordis.patch.yml        # bundle 配置层（开关默认值）
└── THIRD_PARTY_NOTICES.md
```

## 8. 测试

```powershell
npm test                          # = node test/run-all.mjs（聚合汇总，退出码 0/1/2）
node test/run-all.mjs             # 聚合汇总：每个文件一行 + 失败用例名 + 总计
node test/run-all.mjs --verbose   # 附带子进程原始输出
node test/run-all.mjs --json      # 机器可读
node test/run-all.mjs vto         # 只跑文件名含 vto 的测试
node --test test/vto.test.mjs     # 单文件直跑 node:test（原生 spec 输出）
node --test                       # 不带参数：从当前目录递归发现测试
```

> ⚠️ **不要用 `node --test test/`（目录参数）**：在本机 Node 24.20 + Windows 下会报 `Cannot find module ...\test`（exit 1）。用上面的 `npm test` / `run-all.mjs` / 单文件 / 无参数形式。

### 开发环境对齐（宿主 0.2.0-rc.2）

插件与宿主 **0.2.0-rc.2** 对齐：`peerDependencies` 声明
`@deepseek-ai/cordis ~4.0.4`、`@deepseek-ai/dsh-tools ^0.2.0-rc.2`、`@deepseek-ai/schemastery ~3.18.4`，
`engines.dsh >= 0.2.0-rc.2`。仓库的 `devDependencies` 固定到**同一套真实版本**。
`test/vto.test.mjs` 里的两条端到端用例会真跑真实 `defineTool`。

```powershell
npm install --legacy-peer-deps     # 拉 0.2.0-rc.2 全套 peer（需能访问 registry，见 §9 死代理排错）
npm test                           # 判定标准：0 failed 且 0 skipped（数量以输出为准，别抄文档）
```

> **为什么强调「0 skipped」**：`test/daily.test.mjs` 用 `node:module` resolve hook 把
> `@deepseek-ai/dsh-tools` 换成 stub（该 hook 同时作用于 `createRequire`，所以那个文件里
> **无法**用真实模块校验自己的定义）。早先 stub 导入失败会把 8 条工具测试**静默跳过**，
> 而整轮仍报 `ALL GREEN`——现在有一条测试专门让这种状态变红。
> A 线的真实覆盖来自运行时：`cordis_inspect_query(host, Tool, listTools)` 能看到 9 个工具即证明注册成功。
> PATH 上的 `dsh` 是 0.1.5-rc.1，**不是**本插件对齐的版本——别用它判断宿主版本（见 §9）。

## 9. 已知限制与排错

### 已知限制

- **latexmk 需要 Perl**：装了 Perl 就优先用它（`.fls` 依赖追踪），没装则自动回落内置多趟驱动；`latex_doctor` 报出实际状态与安装命令。
- 本机 MinerU `read_pdf({view:'page'})` 失败；本地后端已足够，MinerU 仅作兜底/结构化解析（会上传）。
- C2「图片分辨率/风格不一致」只能诊断，自动重绘不在范围内（需人工替换图片）。
- 以 Windows + MiKTeX 为第一目标平台；路径含空格与中文已覆盖测试。

### 排错（本机实测）

- **装错 CLI**：PATH 上的 `dsh` 是 **0.1.5-rc.1**（本机为 `C:\Users\wangy\nodejs\dsh.ps1`），桌面端自带的是 **0.2.0-rc.2**（`D:\DshDesktop\resources\runtime\cli\bin\dsh.cmd`）。安装/查询**一律用桌面端全路径**那个；用旧版会看不到/改不到桌面端 profile。
  ```powershell
  dsh --version                                                    # 0.1.5-rc.1（PATH 上的旧版）
  & "D:\DshDesktop\resources\runtime\cli\bin\dsh.cmd" --version   # 0.2.0-rc.2（要用的那个）
  ```
- **`--dump-config` 被拒**：`desktop` profile 由 Electron 应用独占管理，
  `& dsh.cmd --profile desktop --dump-config` → **exit 1**，`error: profile "desktop" is managed exclusively by the Electron application`。
  改用 `& dsh.cmd plugin list --profile desktop`（exit 0），或到应用内设置页查看配置行。
- **npm 会走死代理**：`~/.npmrc` 配的是本地代理 `http://127.0.0.1:31180` / `https-proxy=http://127.0.0.1:31181`，实测这两个端口**不可达**；需要访问 registry 的 npm 操作会长时间重试甚至挂起。绕过方式：
  ```powershell
  npm <cmd> --userconfig <一个空的 npmrc 文件>
  ```
  纯本地打包（`npm pack`）与 `node test/run-all.mjs` 不受影响。

## 10. 许可证

MIT，见 [LICENSE](LICENSE)。第三方数据与规则来源见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)：
**PaperFit**（MIT）—— vendored `config/*.yaml` 与诊断报告模板；**dsh-latex-guard**（MIT）—— 行为等价的 BibTeX 处理与「拒绝写入不可解析 .bib」安全规则（重写，非复制）。
