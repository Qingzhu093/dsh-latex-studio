# dsh-latex-studio · 开发文档

> **读者**：维护者与审阅者。用户向内容看 [README](../README.md)，变更历史看 [CHANGELOG](../CHANGELOG.md)。
> **本文替代**原来的 `HANDOFF.md` / `DESIGN-REVIEW.md` / `P0-PROBES.md` 三份（2026-10-11 合并）。
> **时效约定**：§1–§9 是**现行事实**，改代码请同步；§10–§15 是**历史记录**，只保留仍然成立的结论与教训。
> 写文档时**不要写会过期的数字**（行数、用例数、文件数）；字段数与模块地图由 `test/docs.test.mjs` 钉住。

## 0. 一分钟上手

```powershell
cd <repo>/dsh-latex-studio
npm install --legacy-peer-deps     # 首次：拉 0.2.0-rc.2 全套 peer
npm test                           # = node test/run-all.mjs；判据 0 failed 且 0 skipped
node tools/doctor.mjs              # 期望 verdict: HEALTHY
node tools/install.mjs             # 打包 → 注册 profile → 镜像 → 自动 doctor 验证
```

改了代码以后：`npm test` → `node tools/install.mjs` → 重启 DSH（运行中的进程仍用旧实例）。

## 1. 这个插件是什么

### 1.1 起点问题

实测结论：本机模型写 LaTeX 写不好的主因**不是环境缺件，也不是模型不懂 LaTeX**，而是**缺少可验证的反馈闭环**——模型一次生成 `.tex`，拿不到「哪一行编不过 / 版面是否溢出 / 页数超没超」的结构化回传，只能盲改。

所以本插件做的是：把「编译 → 读日志 → 渲染页图 → 诊断 18 类版面缺陷 → 受限修复 → 门禁复核」做成 DSH 工具链，并把状态留在工程内的 `.latex-studio/`。

### 1.2 是 / 不是

**是**：一个 DSH **bundle**（`dsh.bundle.patch`）、一套可验证闭环、一个能力消费者（只用宿主的 `tools`，可选桥接 `read_pdf`）。

**不是**：不是客户端插件（无 UI 半边）；不是 TeX 发行版管理器（只调用 MiKTeX）；不是排版算法库（视觉判断交给模型看页图）；不是 PDF 解析器（结构化解析委托 MinerU）。

### 1.3 硬约束优先级（来自 PaperFit 论文，不可违反）

```
内容保全  >  编译/渲染成功  >  页数预算  >  视觉质量  >  改动最小化
```

## 2. 架构

### 2.1 分层（核心不变量）

```
lib/tools/daily.js · lib/tools/vto.js    ← 唯一 import @deepseek-ai/dsh-tools 与 ctx 的地方
        │  纯函数调用，传 config
lib/core/*.js (paths rules env compile lint bib render guard policy state report logparse pdfread)
        │  读规则数据
lib/data/*.json + 上游参考文本            ← vendored（MIT），每份都有代码消费者
```

**铁律**：`lib/core/*` 永不 import DSH；`lib/tools/*` 永不写业务逻辑。好处是绝大部分代码能在没有 DSH 的环境里直接被 `node --test` 测。

### 2.2 目录地图

```
dsh-latex-studio/
├── package.json          bundle manifest + peer/dev 契约 + files 白名单
├── cordis.patch.yml      只 insert 一行插件，**不携带 config**（见 §4.4）
├── lib/
│   ├── index.js          插件入口：Config schema（全字段 volatile）+ 同步 apply()
│   ├── client.js         浏览器半：插件面板配置页（lazy-CJS 工厂，只 require react；见 §2.6）
│   ├── config.js         DEFAULTS + normalizeField/normalizeConfig + liveConfig()
│   ├── core/             零 DSH 依赖
│   │   ├── paths.js        路径词法守卫的**唯一实现**
│   │   ├── rules.js        FORBIDDEN 规则表 + extractProtected（policy/guard/lint 共用）
│   │   ├── env.js          工具链探测（Perl/latexmk、MiKTeX 目录回退）
│   │   ├── compile.js      编译驱动：latexmk 优先，内置多趟 + makeindex 兜底
│   │   ├── logparse.js     引擎日志解析（file:line 错误、overfull、.aux 指纹）
│   │   ├── lint.js         静态规则 + chktex 三态
│   │   ├── bib.js          BibTeX 解析 / lint / format / fill / audit
│   │   ├── render.js       页图渲染（poppler → miktex-ghostscript → mineru-page）
│   │   ├── guard.js        内容保全：冻结受保护集合 + sha256 比对
│   │   ├── policy.js       禁用修复手法的**差分**门禁
│   │   ├── state.js        .latex-studio 状态 v2（含缺陷台账）/ 备份 / 回滚 / 轮次记录
│   │   ├── report.js       轮次报告（由台账直接生成，无模板无占位符）
│   │   └── pdfread.js      uploadScope 隐私门 + read_pdf 桥
│   ├── tools/            daily.js（A 线 4 个）· vto.js（B 线 6 个）
│   └── data/             vto_taxonomy / layout_rules / templates / content_boundaries / writing_rules / agent_roles
├── locale/               en.json / zh.json：插件页的标题与描述（meta.title / meta.description）
├── icon.svg              插件卡片图标（package.json 的 icon）
├── skills/               latex-daily · latex-vto-loop · latex-fix-catalog（全部由插件自注册）
├── test/                 node:test；run-all.mjs 聚合
├── tools/                install.mjs · doctor.mjs · build-preview.mjs · verify-pdf-read.mjs · vendor-paperfit-specs.mjs
│   └── _p0/              立项期调研证据（**不在发布白名单**）
└── docs/                 本文件 + INTERFACES + ACCEPTANCE + README(索引) + upstream/（只读参考，不发布）
```

### 2.3 core 模块清单（`test/docs.test.mjs` 会校验这里引用的文件都存在）

| 模块 | 职责 |
|---|---|
| `lib/core/paths.js` | 路径词法守卫（唯一实现）：工作区/工程基准、拒绝绝对路径与 `..` |
| `lib/core/rules.js` | FORBIDDEN 规则表 + `extractProtected`（policy/guard/lint 共用一份） |
| `lib/core/env.js` | 工具链探测：引擎、`bibtex`/`biber`/`makeindex`、Perl、latexmk、Poppler、Ghostscript |
| `lib/core/compile.js` | 编译驱动：latexmk 优先，内置多趟 + makeindex 兜底 |
| `lib/core/logparse.js` | `.log` 解析：`file:line` 错误、overfull/underfull、缺引用、`.aux` 指纹 |
| `lib/core/lint.js` | 静态规则 + chktex（三态：ok/skipped/unavailable） |
| `lib/core/bib.js` | `.bib` 解析 / lint / format / fill（Crossref）/ audit |
| `lib/core/render.js` | 页图渲染与页数探测（poppler → miktex-ghostscript → mineru-page） |
| `lib/core/guard.js` | 内容保全：受保护集合、文件哈希、sha256 快照比对、密钥扫描 |
| `lib/core/policy.js` | 禁用修复手法的**差分**门禁（只报本次新增） |
| `lib/core/state.js` | `.latex-studio` 状态 v2（含缺陷台账）、原子写、备份、回滚、轮次记录 |
| `lib/core/report.js` | 轮次报告生成（Markdown 直接由台账计算得出） |
| `lib/core/pdfread.js` | `uploadScope` 隐私门 + `read_pdf` 桥 |

### 2.4 A 线一次调用

```
latex_build({dir})
  → resolveProjectPath/工作区校验 → probeEnv() 找引擎（PATH → MiKTeX bin 回退）
  → compile.build()：
      可用 latexmk 时：latexmk -pdf -outdir=.latex-studio/build -auxdir=.latex-studio/auxfiles …
      否则内置驱动：引擎 → (bibtex|biber) → (makeindex) → 再跑至 .aux 指纹稳定（≤4 趟引擎）
  → logparse：errors[{file,line}] / overfull / underfull / 缺引用
  → {status, via, stopReason, passes, pages, pdfPath, errors[], …}
```

### 2.5 B 线闭环与状态目录

```
vto_start    冻结内容基线（cite/label/ref/caption 键 + 每文件 sha256）+ 页数基线 + 模板解析
vto_inspect  页图（本地后端，零上传）+ 带阈值/视觉特征/日志信号的 checklist + 现有台账
             可选 parse:true → 过 uploadScope 门后调 read_pdf({view:'content'})
vto_fix      预检（diff + policy + guard + 语义上限）→ 备份 → 写入 → 复核 → 失败回滚
vto_verify   门禁：compile / render / contentIntegrity / pageBudget / policy
             + contentBoundaries（提示）+ ledger（回归即 fail）→ verdict / rollbackTo
vto_report   把本轮写进台账并生成 reports/round-N.{md,json}
vto_rollback 按 backups/rN/manifest.json **真正执行回滚**
```

状态目录（默认 ``.latex-studio/``，名字由 `workDir` 配置，必须是工程内相对目录）：

```
.latex-studio/
├── state.json          版本/工程路径/入口/开关/轮次/内容基线/缺陷台账
├── build/main.pdf      编译产物
├── auxfiles/           .aux/.log/.bbl/.fls/.fdb_latexmk（**不叫 aux**：Windows 保留设备名）
├── pages/page-001.png  页图
├── reports/round-N.*   轮次报告（.md 由台账生成）与 round-N.record.json
└── backups/rN/         修复前副本 + manifest.json（含 existed/hash/bytes）
```

### 2.6 浏览器半：插件面板里的配置页

`lib/client.js` 是这个插件的浏览器半（`package.json` 的 `dsh.client` + `exports["./client"]`）。它把 §4 的 17 个字段渲染成 6 张卡片，注册到插件页的**两个**位置：

| slot | key | 用户在哪里看到它 |
|---|---|---|
| `plugins.bundle.config` | `dsh-latex-studio`（包名） | 点插件卡片后的「配置」区 |
| `plugins.row.config` | `dsh-latex-studio#latex-studio` | 点组件行 `latex-studio` 后的配置页（键由插件管理器按 `bundle#rowId` 计算） |

**为什么是手写文件、没有打包器**：客户端模块系统只按 `exports["./client"]` 服务一个产物，格式是 lazy-CJS 工厂（`window.__ModuleLoader__.load({id, factory})`），`factory(require)` 只能解析模块图里已经存在的模块；DSH 仓库里负责生成它的 `clientBundle` tsdown preset 不随包发布。所以这里是一个自包含的单文件工厂，**只 `require("react")`**：零构建步骤、零运行时依赖，与「不引入运行时依赖」这条不变量一致。`test/client.test.mjs` 用一套最小 React/DOM shim 真的把这个 bundle 跑起来。

**为什么没有「保存」按钮**：字段全部是 `.volatile()`（§4.1），设置服务把 volatile 字段按 profile 条目 id 投影成表单，插件页拿到的 controller 与 `ctx.configForms.get('latex-studio')` 是同一个。写入走 `form.set / form.unset / form.mutate`：宿主校验**整份** Config → 写 profile patch → 原地替换 volatile 引用。于是

- 不需要自建 RPC、不需要调 configEditor、不需要重启，也没有「草稿 / 已保存」两套状态；
- 「恢复默认」= `unset`，语义就是「删掉本页写入的覆盖值、回到 schema 默认」；
- 写入是 CAS 的（过期 revision 由宿主拒绝），页面把 revision 交给 controller 管理。

**读取必须走 `liveConfig()`**：volatile 字段在 `apply` 里拿到的是**引用**，不是值。`liveConfig(ctx, entryConfig)` 返回的对象每次属性访问都重读 `ctx.fiber?.config`，所以工具永远看到最新值，保存后立刻生效。0.3.0 及以前「读一次快照」的写法在这里会表现成「保存成功但行为不变」——这是本次改动最容易踩的坑。

**三条降级路径**（都必须成立，`test/client.test.mjs` 覆盖）：拿不到 `configForms` 服务 → 只读页 + 默认值 + 说明；`writable:false`（被更高层覆盖）→ 全部控件禁用并显示「只读」；表单 `status:unavailable` → 同上。

**两个字段要重载才换工具集**：`enableDaily` / `enableVto` 决定 `apply` 里注册哪些工具，是**加载期**决策。页面在「命令系统」卡片上挂了「重载后生效」徽章，避免"关了却没关掉"的误解。

**看设计不必重启**：`npm run preview`（`tools/build-preview.mjs`）从 `lib/client.js` 的三个标记区（`#region preview-dict` / `preview-model` / `preview-css`）提取文案、字段模型与 CSS，生成自包含静态 HTML（默认 `ui-preview.html`）。预览与真实页面同源，不会漂移。

**必须重启才会开始服务这个 bundle**：客户端模块系统按 specifier 缓存包元数据（包括「它不是 client 包」这一否定结论）到进程重启为止，因此**新增 `dsh.client` 后第一次生效必须重启 DSH**；`lib/index.js` 的改动同理。

## 3. 工具面（10 个）

### 3.1 A 线：日常编译（4）

| 工具 | 作用 | 关键参数 | 关键输出 |
|---|---|---|---|
| `latex_doctor` | 环境体检：引擎、bib 工具、页图后端、Perl/latexmk、chktex；`advice[]` 给可执行安装命令 | `refresh`（清解析缓存）`verifyPdfRead` `pdfPath` | 各项路径/版本、`advice[]`、`renderProbe{status,backend,bytes}` |
| `latex_build` | 编译：latexmk 优先，否则内置多趟 | `dir` `entry` `engine` `clean` | `status/via/stopReason/passes/pages/pdfPath`、`errors[{file,line}]`、`overfull[]`、`missingCitations[]` |
| `latex_lint` | 静态检查：禁用伪修复、引用-标签对账、图-引用距离、chktex | `dir` `entry` `rules[]` | `findings[]`、`protected`、`external` |
| `bib_tool` | `.bib` 四动作 lint/format/fill/audit | `action` `bib` `tex[]` `write` | `issues[]`、`missingInBib[]`、`uncited[]` |

`bib_tool` 的安全语义：**不可解析时拒绝写入**（`PARSE_INCOMPLETE`），`fill` 走 Crossref **只补不覆盖**。

### 3.2 B 线：VTO 闭环（6）

| 工具 | 作用 | 关键参数 | 关键输出 |
|---|---|---|---|
| `vto_start` | 建基线 + 模板解析 | `dir` `entry` `pageBudget` `template` `columnType` `workDir` | `statePath`、基线摘要、`template` |
| `vto_inspect` | 页图 + checklist + 台账（可选结构化解析） | `dir` `pdf` `pages` `dpi` `focus` `parse` `consent` | 页图 ContentBlock、`checklist`（含阈值/视觉特征/日志信号/manual）、`ledger`、`semanticPolicy`、`parsed` |
| `vto_fix` | 预检 → 备份 → 写 → 复核 → 失败回滚 | `dir` `file` `find` `replace` `replaceAll` `edits[]` `apply`（默认 false）`round` `rationale` `force` `allowPolicy` | `applied`、`diff`、`violations`、`contentIntegrity`、`semantic`、`backups` |
| `vto_verify` | 门禁复核 | `dir` `entry` `pdf` `pages` `pageBudget` `round` `dpi` | `verdict`、`checks{compile,render,contentIntegrity,pageBudget,policy,contentBoundaries,ledger}`、`regressions`、`rollbackTo` |
| `vto_report` | 写台账 + 报告 | `dir` `round` `verdict` `changes[]` `remaining[]` **`defects[]`** `notes` | `mdPath`、`jsonPath`、`ledger{entries,open,blockingOpen}` |
| `vto_rollback` | **执行**回滚（不是建议） | `dir` `round` `workDir` | `restored[]`、`manifestEntries`；无备份 → `NO_BACKUP` |

### 3.3 全体约定

1. **参数按基准解析**（`test/params.test.mjs` 强制）：

| 类别 | 参数 | 基准 |
|---|---|---|
| 工程根 | `dir` | 会话工作区 |
| 工程内文件 | `entry` `file` `pdf` | 相对 `dir`（工程目录） |
| 工作区文件 | `latex_doctor.pdfPath` `bib_tool.bib` `bib_tool.tex` | 会话工作区 |
| 目录名 | `workDir` | 纯相对目录名 |
| 页码 / 轮次 | `pages` `round` | `all` 或 `3`/`1-3,5`；正整数 |
| 副作用开关 | `apply` `write` `replaceAll` `force` `clean` `parse` `consent` `verifyPdfRead` | 默认 false |

   绝对路径、盘符、UNC、`\..\` 一律拒绝；传错基准会得到「应传什么」的 advice，而不是 `FILE_NOT_READABLE`。
2. **缺外部件一律优雅降级**：`status:'skipped'` + `reason` + `advice[]`，绝不抛异常。
3. `vto_fix` **默认不写盘**（`apply:false` 只给配方 + 预检）。
4. 工具只做入参校验与渲染，逻辑在 `lib/core/*`。

## 4. 配置契约（17 个配置字段）

### 4.1 字段表

| 字段 | 默认 | 说明 |
|---|---|---|
| `enableDaily` / `enableVto` | `true` | 两条命令线的总开关 |
| `uploadScope` | `external-only` | 隐私门：`external-only\|always\|never` |
| `rendererOrder` | `[poppler, miktex-ghostscript, mineru-page]` | 页图后端顺序 |
| `popplerPath` / `ghostscriptPath` / `chktexPath` | `''` | `''` = 自动（含 MiKTeX bin 回退） |
| `readPdfToolName` | `read_pdf` | 宿主工具名（桥接用） |
| `latexCommand` | `''` | `''` = 自动：可用则 latexmk，否则直接驱动引擎；也可显式写 `latexmk` |
| `enableInstaller` | `true` | MiKTeX 自动补包 |
| `engineArgs` | `''` | 额外引擎参数 |
| `compileTimeoutMs` / `renderTimeoutMs` | `300000` / `60000` | 超时 |
| `workDir` | `.latex-studio` | 状态目录名（必须是工程内相对目录） |
| `pageBudget` | `null` | 页数预算（`null` = 不限） |
| `attachImagesPerRound` | `1` | 每轮回传页图数（0 = 关图片通道） |
| `enableChktex` | `false` | 可选 chktex |

已删除的死字段（**不要加回来**）：`maxRounds`、`enableFixerSidecar`、`enableSemanticTuning`。轮次上限由 `DEFAULT_MAX_ROUNDS` 常量表达，且**没有工具强制它**（循环是模型驱动的）。

### 4.2 两个开关 = 两条命令线

两个都关 → 0 个工具注册（插件仍在，空转）；只开 A 线 → 4 个；只开 B 线 → 6 个。

### 4.3 隐私模型

- 默认 `external-only` → **自己的原稿永不上传**。
- 页图优先本地后端（Poppler / MiKTeX Ghostscript），零额外安装、零上传。
- 只有 `vto_inspect({parse:true, consent:true})` 才把 PDF 交给 `read_pdf({view:'content'})`（走 MinerU provider，会上传）；默认 scope 下 `parse:true` 会**被拒绝且不发起任何调用**（`test/parse-gate.test.mjs` 用 stub 钉死零调用）。

### 4.4 配置只有两处（patch 不带 config）

1. `lib/index.js` 的 `Config` schema —— 真实宿主唯一生效处；
2. `lib/config.js` 的 `DEFAULTS` —— 内核与测试用，必须与 schema 一致。

`cordis.patch.yml` **只 insert 一行、不带 `config:`**：官方规则是 **patch 整份替换 `config`、不深合并**，抄一份默认值会让人只覆盖一个字段就丢掉其余全部（`test/config.test.mjs` 明确禁止它回来）。

> 两条官方行为要记住：未被 schema 声明的字段在 `apply` 前被**直接丢弃**（症状是「配了没反应」）；schemastery 里解析为 `null` 的字段在校验结果中「键不存在」，所以 `apply` 必须走 `normalizeConfig()` 兜底。

### 4.5 在插件面板里编辑（0.4.0+）

17 个字段全部写成 `Schema.…volatile()`。这不是修饰：设置服务**只**把 volatile 字段投影成可编辑表单，非 volatile 字段在插件页里根本不会出现（官方 `dsh-settings` README：「表单只展示活动且可唯一定位的 profile 条目中的 volatile 字段」）。由此产生两条硬约束：

1. `apply` 收到的 config 里，字段是**引用**——读取只能经 `liveConfig()`（§2.6）；
2. 浏览器半保存时写的是 profile patch 的覆盖层，因此「恢复默认」= `unset`，而不是把默认值写回去。

`test/config.test.mjs` 钉住这两条：每个字段都必须是 Volatile 引用，且 `liveConfig()` 必须在源值变化后立刻读到新值。

## 5. 外部依赖与环境

### 5.1 依赖矩阵（与 README §2.6 同源）

| 组件 | 必需性 | 用途 | 缺失后果 |
|---|---|---|---|
| Node `^22.19.0 \|\ >=24.0.0` | 必需 | 运行 | 无法加载 |
| MiKTeX（引擎 + `bibtex`/`biber`/`makeindex` + `chktex` + Poppler + Ghostscript） | **必需** | 编译/参考文献/页图 | A 线除 `latex_lint` 外全部 `skipped` |
| Perl + `latexmk` | 可选（推荐） | `.fls` 依赖追踪 | 自动回落内置多趟驱动 |
| MinerU（`dsh-pdf-mineru`） | 可选 | 结构化解析 | `parse` 返回 `notes` 说明 |
| npm 运行时依赖 | **无** | — | `dependencies: {}` 是硬不变量 |

安装命令与自助流程见 README §2.6（`winget install MiKTeX.MiKTeX` / `winget install StrawberryPerl.StrawberryPerl` / `mpm --install=…`）。模型侧的标准动作是：`latex_doctor` → 执行 `advice[]` 里的命令 → `latex_doctor({refresh:true})` 复验 → 仍缺就如实报告。

### 5.2 本机实测环境（2026-10-11）

```
宿主      DeepSeek Harness 0.2.0-rc.2（Electron 桌面端）
Node      v24.20.0（用户）/ v24.21.0（桌面端自带）
MiKTeX    26.5，D:\MiKTeX（**不在 PATH**）
  pdflatex / biber / pdftoppm 24.04 / mgs.exe 9.25 / chktex 均在 D:\MiKTeX 下
Perl      D:\Git\usr\bin\perl.exe（5.38.2，Git for Windows 自带）→ latexmk 4.88 可用
profile   C:\Users\<user>\.dsh\profiles\desktop（Electron 独占管理）
```

> PATH 上的 `dsh` 可能是旧版（0.1.5-rc.1）。安装/查询一律用桌面端全路径 `D:\DshDesktop\resources\runtime\cli\bin\dsh.cmd`。

## 6. 数据资产（`lib/data/`）

| 文件 | 消费者 | 内容 |
|---|---|---|
| `vto_taxonomy.json` | `vto_inspect` / checklist / 门禁 | 5 类 18 缺陷：检测特征、日志信号、允许手法、语义约束、验收指标、严重级与 `gate_blocking` |
| `layout_rules.json` | checklist 阈值；驱动参数默认值 | 数值阈值（唯一权威来源） |
| `templates.json` | `vto_start({template})` | 模板列式、期望页数、必需/禁用宏包 |
| `content_boundaries.json` | `vto_verify` 的 `contentBoundaries` | 关键章节下限（Abstract/Conclusions/Introduction）与内容分类 |
| `writing_rules.json` | `semanticLimits()` + `vto_fix` 预检 | 语义微调建议区间/硬上限、禁改章节、措辞与术语规则 |
| `agent_roles.json` | 角色/路由来源数据（模型侧不引用） | PaperFit 的角色契约与类别路由 |

规则：**每份数据必须有一个消费者**，否则移出发布集（0.2.0 删掉了 `_meta.json`，它记的是绝对路径）。改数据先改这里的表。

## 7. 关键设计决策（含被否决）

| 决策 | 理由 |
|---|---|
| 自研编译驱动 + latexmk 优先 | 本机 perl 来自 Git，不保证人人都有；两条路产出同一结果结构（`via` 标明） |
| 内核零 DSH 依赖 | 让绝大部分代码可独立测试 |
| 一个插件 + 两个开关 | 官方指南：不要预防性拆分 |
| 本地页图优先，MinerU 仅兜底 | 零额外安装；默认不外传原稿 |
| 内容保全优先 | guard 冻结键与文件哈希，任何修复不得破坏内容 |
| 拒绝伪修复 | 五条 FORBIDDEN 规则，差分门禁（只报新增） |
| 状态目录不叫 `aux` | Windows 保留设备名，`Copy-Item` 会失败 → 用 `auxfiles/` |
| 零运行时依赖 | 只用 Node 内置 + 宿主 peer |
| 数据 vendor、代码重写 | 领域知识值得复用，Python 编排不可复用 |
| **被否决：把上游规范注册成技能** | 0.2.0 做过，0.3.0 撤回：它把 PaperFit 的 agent/命令/路径当成**本插件**的手册，且逐字节冻结导致不能适配。现为 `docs/upstream/` 只读参考 |
| **被否决：纯文本度量替代页图** | 论文 Table 5：纯文本/日志方法的 VLM 上限 2.18、Win 上限 0.43，而结构化视觉闭环是 3.39/0.90；视觉是判据主体 |
| **被否决：六角色智能体团队** | 单人模型 + 写清守则更可控；团队模式留待将来（多写者并发下的 guard 行为未验证） |
| **被否决：默认自带/依赖 Perl** | 不能成为硬依赖；改为「探测到就用，没有就回落 + 给安装命令」 |

## 8. 测试与验收

```powershell
npm test                          # 聚合；判据 0 failed 且 0 skipped
node test/run-all.mjs --verbose   # 附原始输出
node test/run-all.mjs vto         # 只跑文件名含 vto 的
node --test test/vto.test.mjs     # 单文件直跑
```

**不要用 `node --test test/`（目录参数）**：本机 Node 24 + Windows 会报 `Cannot find module ...\test`。

测试文件分工：`client`（浏览器半：加载器格式 / 槽位键 / 字段覆盖 / 降级 / 写入路径）、`config`（schema ≡ DEFAULTS / 全字段 volatile / liveConfig 活性）、`docs`（字段数/布局名/模块地图/README 工具与参数真实存在/UTF-8）、`params`（参数基准确认）、`daily`（A 线 + 真实编译）、`vto`（B 线 + 真实 defineTool 端到端）、`ledger`（台账/回滚/数据消费者）、`parse-gate`（上传门禁零调用）、`compile-driver`（驱动选择）、`skillpack`、`vendored-specs`、`tools`（doctor/install 行为）。

**为什么强调 0 skipped**：`daily.test.mjs` 用 resolve hook 把 `@deepseek-ai/dsh-tools` 换成 stub，该 hook 也作用于 `createRequire`，所以那个文件无法用真实 `defineTool` 校验；真实覆盖在 `vto.test.mjs`。有一条测试专门在 stub 导入失败时变红，防止「全跳过还报 ALL GREEN」。

其他验证入口：`node tools/doctor.mjs`（健康自检，退出码 0/1/2，`--json` 给 CI）、`node tools/install.mjs`（打包→注册→镜像→验证）、`node tools/verify-pdf-read.mjs --pdf <pdf>`（页图通道三态）。

## 9. 安装 / 升级 / 卸载 / 发布

### 9.1 组件路径

```
源码        <repo>/dsh-latex-studio
安装副本    %USERPROFILE%\.dsh\profiles\<profile>\node_modules\dsh-latex-studio
profile 清单 %USERPROFILE%\.dsh\profiles\<profile>\package.json（dependencies + dsh.profile.bundles）
备份        %USERPROFILE%\.dsh\backups\latex-studio\<version>-<timestamp>\
```

### 9.2 安装 / 升级

首选 `node tools/install.mjs`（打包 → 备份 profile 清单 → 登记依赖与 bundle → 镜像包树 → 跑 doctor 验证，失败给回滚命令；`--dry-run` 只预演）。

官方通道是应用内插件管理器，或桌面端 CLI：`& "<DshDesktop>\resources\runtime\cli\bin\dsh.cmd" plugin --profile <p> add <tgz|dir>`。注意：本机实测**在 Electron 独占管理的 profile 上 `plugin add` 会挂起**，所以日常用脚本。

**升级后必须重启 DSH**（或开新会话）：运行中的进程仍用旧实例。

### 9.3 卸载

从 profile 的 `dependencies` 删除依赖、从 `dsh.profile.bundles` 删除条目，再删除安装副本目录。

### 9.4 面向 npm / GitHub 发布

官方《打包与安装插件》给出的形态（本仓库已符合）：bundle 用 `dsh.bundle.patch`；patch 里的插件行按**包名**引用；共享 dsh 包同时进 `peerDependencies` 与 `devDependencies`；`files` 是发布白名单（本仓库**不含** `docs/`、`tools/_p0/`）。

发布前仍需确认（**未完成，需要决定**）：`repository`/`homepage`/`bugs`/`author` 元数据；npm 包名是否可用；走 npm 还是 GitHub-only；发布后的版本策略（0.x 下破坏性改动进 MINOR）。

## 10. 维护手册（历史 + 现行）

- **加一个工具**：`lib/tools/{daily,vto}.js` 里 `defineTool` → 逻辑写进 `lib/core/*` → 更新 `docs/INTERFACES.md` → 加测试 → `npm test` → `node tools/install.mjs`。
- **加一个配置字段**：改 `lib/index.js` 的 schema 与 `lib/config.js` 的 `DEFAULTS`（**两处**），在 README 配置表补一行，跑 `config` + `docs` 测试。**先自问它真的需要可配置吗**——死字段比没有字段更糟。
- **改规则/分类法**：数据在 `lib/data/*.json`（唯一形态，上游 YAML 与转换脚本都不在仓库）；改完同步 `skills/latex-fix-catalog`，并跑 `ledger`/`vto` 测试（阈值一致性由 `test/ledger.test.mjs` 钉住）。
- **改页图后端**：实现在 `lib/core/render.js`，顺序由 `rendererOrder` 控制；新后端必须「探测 → 渲染 → 返回结构化结果」，不可用时 `skipped` 而非抛异常；探测复用 `env.resolveTool()`。
- **改隐私门**：`lib/core/pdfread.js` + `uploadScope`；默认必须保持 `external-only`。
- **改技能**：`skills/*/SKILL.md` 目录名 = frontmatter `name` 且 kebab-case；插件自注册，无安装步骤；`test/skillpack.test.mjs` 会钉住。
- **上游参考文本**：`node tools/vendor-paperfit-specs.mjs --check` 校验未漂移；`--from <paperfit-cli>` 重新 vendor。

## 11. 已知问题与技术债（诚实清单）

| # | 类型 | 内容 | 影响 / 建议 |
|---|---|---|---|
| 1 | 环境 | `read_pdf({view:'page'})` 在本机失败（MiKTeX pdfinfo 输出含 CP936 时区字节 → 严格 UTF-8 解码抛错） | 不依赖它：页图走本地 poppler/mgs；`TZ=UTC` 可绕过；upstream 应改非致命解码 |
| 2 | 未实测 | `bib_tool` 的 Crossref 网络路径 | 需在有网环境补一次端到端验证 |
| 3 | 设计限制 | C2（图片分辨率/风格不一致）只能诊断，不能自动重绘 | 需人工替换图片 |
| 4 | 流程 | 无 CI | 质量靠 `npm test` + `docs/ACCEPTANCE.md` 手工重跑；建议加 Windows runner |
| 5 | 平台 | 只在 Windows + MiKTeX 验证过 | `lib/core/*` 已做平台中立处理，但 Linux/TeX Live 未测 |
| 6 | 安装 | 桌面 profile 的 CLI `add` 会挂起 | 用 `tools/install.mjs` 或应用内插件管理器 |
| 7 | 脚手架 | `tools/_p0/` 是调研证据，**有意不在发布白名单** | 发布审计需单独归档 |
| 8 | 文档 | `docs/INTERFACES.md` 部分小节滞后于代码 | `test/docs.test.mjs` 只钉字段数/布局名/模块地图 |
| 9 | 数据 | taxonomy 内联阈值与 `layout_rules` 有重复副本 | 由 `test/ledger.test.mjs` 钉住一致；改一处必须改另一处 |
| 10 | 语义 | `content_boundaries` 只作提示（`warn` → `pass_with_notes`），不阻断 | 下限是整篇论文的默认值，用来卡短文会误伤 |
| 11 | 台账 | 条目由模型声明，`vto_verify` 只能检测「回归」，不能独立复核条目真假 | 单人模式下的固有局限；下一步可要求条目携带可核对证据（file:line / 日志行） |
| 12 | 备份 | `backupFiles` 跳过不存在的文件，因此 rollback 里「删除新建文件」的分支实际不可达 | 需要时让 `vto_fix` 在写盘前记录新建文件 |
| 13 | 路径 | 词法守卫看不到 junction/symlink | `realpath` 复检可堵 |
| 14 | 明确不做 | 六角色团队模式 | 推后；单人 + 守则是当前取舍 |
| 15 | 配置页 | `enableDaily` / `enableVto` 是**加载期**决策：保存后要重载插件才换工具集 | 页面已挂「重载后生效」徽章；真要热切换得在 volatile 变更事件上重注册工具 |
| 16 | 验证 | 浏览器半只有 shim 级测试，尚未在真实 Web GUI 里点过一遍（需要重启 DSH 才会开始服务这个 bundle） | 重启后按 §2.6 的降级/写入路径逐条手验一次 |
| 17 | 部署 | 本机 profile 用 tarball（`file:...tgz`）安装，升级要重新 pack + `tools/install.mjs`，且必须重启 | 见 §9.2；npm 发布后这条消失 |
| 18 | 环境 | `\$DSH_HOME/profiles/node_modules/@deepseek-ai/schemastery` 在本机是**旧版**（无 `Schema.prototype.volatile`），而 DSH 应用自带的副本有 | 插件已改为**能力探测**（`markVolatile` / `VOLATILE_CONFIG_SUPPORTED`）：旧副本下插件照常加载，只是配置页只读。`doctor` 的 `volatile` 行会说明本目录解析到的是哪一个；要彻底消除，升级/清理那个 profile 级副本 |

## 12. 排错手册

### 12.1 工具不出现 / 插件像没加载

**先做运行时查询，不要重启碰运气**：

```
1. plugin_manager list_plugins         → enabled? fiberPhase（active / pending / failed）
2. cordis_inspect_query host Config    → 插件行在不在？schema 出得来吗？
3. cordis_inspect_query host Tool      → 工具在不在当前会话目录？
4. 若为 pending：查组合里是否有 dsh-system-prompt
   （dsh-tools 的 ToolRuntime 声明 inject = ['systemPrompt']，缺它 tools 就 PENDING → 我们 inject ['tools'] 也 PENDING → apply 根本不执行、且无报错）
5. 若第 2 步找不到行：模块名/包名/bundles 三者拼写不一致
```

结构性结论：**PENDING 的插件无法注册工具来报告自己没加载**，所以 `doctor` 必须是插件生命周期之外的 CLI。

### 12.2 插件页里看不到配置 / 表单显示「配置表单不可用」

| 症状 | 原因 | 解法 |
|---|---|---|
| 插件卡片下压根没有「配置」区 | 没有任何包为 `plugins.bundle.config` 注册这个包名的页面 | 确认装的是 0.4.0+（包内有 `lib/client.js`），然后**重启** DSH：客户端模块系统把包元数据缓存到进程重启为止 |
| 页面出现，但顶部是「配置表单不可用」 | 浏览器半拿不到 `configForms` 服务（设置 / 配置编辑器没挂载），或该 profile 条目没有 volatile 字段 | 确认组合里有 `@deepseek-ai/dsh-settings` 与 `@deepseek-ai/dsh-config-editor`；确认装的是 0.4.0+（0.4.0 起字段才是 volatile） |
| 顶部是「配置表单不可用」，但服务都在 | 该条目解析到的 `@deepseek-ai/schemastery` 是**旧版**（无 `Schema.prototype.volatile`）→ 字段没被标记为 volatile | 跑 `node tools/doctor.mjs --dir <部署目录>`，看 `volatile` 行：0 个字段 = 就是这个原因。插件本身仍能加载（`markVolatile` 是能力探测），要恢复可编辑需升级那个 schemastery 副本 |
| 顶部是「只读」 | 表单 `writable:false`，通常是 profile 的 `cordis.patch.yml` 或命令行 overlay 覆盖了同一批字段 | 属预期行为：覆盖层优先级更高，请在覆盖层里改，或先删掉覆盖 |
| 保存了但行为不变 | 只有 `enableDaily` / `enableVto` 会这样，它们是加载期决策 | 重载插件或重启；其余字段保存即生效（读的是 `liveConfig`） |

### 12.3 常见环境坑

| 症状 | 原因 | 解法 |
|---|---|---|
| `dsh --version` 显示旧版 | PATH 上是旧全局安装 | 用桌面端 `dsh.cmd` 全路径 |
| `--profile desktop --dump-config` → exit 1 | Electron 独占管理该 profile | 用 `plugin list --profile desktop` 或应用内设置页 |
| `npm install` 挂死 | `~/.npmrc` 配了失效代理 | `npm <cmd> --userconfig <空文件>` |
| `latexmk` 报找不到 perl | 缺 Perl 运行时 | 装 Strawberry Perl 或把 Git 的 `usr/bin` 加入 PATH；否则自动回落 |
| MiKTeX 启动器 exit 0xC0000135/0xC0000139 | 版本混装 / lock 残留 | 清 `lock\package-manager.lock` → 重装基础包 → `miktex packages update` |
| 编译报 `File … not found` | 缺宏包 | `--enable-installer` 默认开启会自动补装；或 `mpm --install=<pkg>` |
| 中文/空格路径下失败 | 历史上的路径正则问题 | 新增路径处理必须覆盖含空格与 CJK 的工作区 |
| PowerShell 显示中文乱码 | 控制台编码，不是文件损坏 | 用 Node 读文件校验，别信 `Get-Content` 的显示 |

## 13. 历史：环境探针（2026-10-10，结论已复核）

采集于立项当天，原始输出与复跑清单在 `tools/_p0/`。**下表是复核后的口径**：

| 项 | 当时结论 | 现在口径 |
|---|---|---|
| MiKTeX 引擎 | 可用，但**不在 DSH 进程 PATH 上** | 仍成立：必须用绝对路径探测（`env.resolveTool` 会扫 MiKTeX bin 与注册表） |
| `--enable-installer` | **未验证成功**（当时包库被锁 + 全局更新中） | 后续实测成功（缺包时 exit 0 并自动补装） |
| latexmk | **不可用**（缺 Perl）→ 禁止依赖 | **已推翻**：Perl 由 Git for Windows 提供，`latexmk 4.88` 可用；0.2.0 起默认优先使用 |
| Poppler | 可用，MiKTeX 自带 `pdftoppm` 24.04 | 仍成立（首选页图后端） |
| Ghostscript | 可用，MiKTeX 自带 `mgs.exe` 9.25 | 仍成立（第二后端） |
| `read_pdf({view:'page'})` | 失败 | 仍失败；根因已定位（pdfinfo 的 CP936 时区字节 + 严格 UTF-8 解码），见本文件 §11 #1 |
| 桌面端 CLI `plugin add <tgz>` | 可用（真实装过 dummy 包） | 仍可用，但在 Electron 独占 profile 上会挂起 → 日常用 `install.mjs` |
| MiKTeX 更新中间态 | 所有启动器 0xC0000135 | 版本混装时的通用症状，排错表里有解法 |

## 14. 历史：设计审阅的结论与自我更正

**关键自我更正（必须记住）**：初版设计审阅提出「用纯文本度量替代视觉通道、把每轮内联页图降到 0」。**这是错的**，证据是 PaperFit 的 Table 5：纯文本/日志方法 VLM 上限 2.18、Win 上限 0.43，而结构化视觉闭环 3.39 / 0.90；RuleLog 的 Compile/Render 甚至低于**不做修复**的基线。

结论修正为：**视觉是判据主体，不能关**；真正缺的是**结构化组织**（显式缺陷台账 + 受限修复 + 回滚感知门禁）——这也是 0.2.0 补上缺陷台账的依据。

**另一条更正**：该审阅同轮移植的 A5 机检模块在 0.3.0 被删除，理由是复现出来的：它只覆盖 18 类中的 1 类，其契约自述「判据仍是页图」，而它算的页尾留白指标实际量的是「最低墨迹（页码）到纸边的距离」——实测写满页与近空白页同为 0.1705，无法区分。删除后流程不变。

**保留下来的教训**：技能发现只扫描配置好的根目录（rank 100 `<项目>/.dsh/skills` … 600 `bundledSkillDir`），**npm 包自己的 `skills/` 不在其中**；本插件的 3 个技能因此在 0.1.x 整轮空转。DSH 是围绕插件设计的，插件已装载就直接注册。

## 15. 历次修订（只记结论）

- **0.1.0**：两条命令线、guard/policy/备份回滚、本地页图、bundled 上游数据。9 工具 + 11 技能（其中 8 个是上游文本，从未被引用）。
- **0.2.0**：把资产变成承重件。注册技能 11 → 3（上游文本转只读参考）；路径基准统一（此前 `file`/`pdf` 的包含性检查对被写目标之外的一棵树做）；`state.json` v2 + **缺陷台账**；四份数据接上消费者（模板/语义上限/章节下限/角色路由）；`parse` 从空承诺变成受门禁的真实调用；编译驱动改为 latexmk 优先 + `via`/`stopReason`；报告去掉错值（时间戳冒充哈希、不存在的 agent 段落）。
- **0.4.0**：把配置搬到插件面板。17 个字段全部 `.volatile()`，`apply` 改读 `liveConfig()`（属性访问时才读，保存即生效）；新增浏览器半 `lib/client.js`（lazy-CJS 工厂、只 `require("react")`），注册 `plugins.bundle.config` 与 `plugins.row.config` 两个槽位；新增 `locale/` 展示元信息、`icon.svg`、`npm run preview` 静态预览、`test/client.test.mjs`（最小 React/DOM shim 真跑 bundle）。
- **0.3.0**：删掉只像承重件的部分。删除 `voidetect.js`（见 §14）与每次调用都刷的「分类法自检」告警；报告改为直接生成（去掉模板/占位符，修掉重复表头与恒为 0 的进度表，进度改由台账计算）；回滚做成真动作（`vto_rollback`）；统一 latexmk 的三处矛盾说法；README 增「环境要求与自助安装」；docs 合并为本文件 + 索引。

## 附录 A：关键不变量

1. `lib/core/*` 不 import DSH；`lib/tools/*` 不写业务逻辑。
2. `apply` 同步注册（更稳，也更容易推理）。
3. 配置两处同步；`cordis.patch.yml` 不得出现 `config:` 块。
4. 参数按基准解析；词法守卫只有 `paths.js` 一份实现，工程相对由 `resolveProjectPath` 收口。
5. 缺外部件返回 `skipped + advice`，不抛异常。
6. `vto_fix` 默认不写盘；写盘 = 备份 → 写 → guard 复核 → 失败回滚；回滚要能被 `vto_rollback` 真正执行。
7. 内容保全优先于视觉质量。
8. `dependencies` 保持为空。
9. 测试自建夹具，不依赖仓库里的历史产物；**不得让失败伪装成 skip**。
10. 声明了就必须用（配置字段 / 工具参数 / 数据文件 / 技能）。
11. 字形替换必须**字面**插入（`String.replace` 会展开 `$&`/`$1`，而 LaTeX 全是 `$`）。
12. 发布白名单不含 `docs/`、`tools/_p0/`、`*.tgz`。
13. 不要在 PowerShell 里用 `Get-Content`/`Set-Content` 改含中文的文件（按 ANSI 码页重写会毁文件）。
14. 配置字段全部 `.volatile()`；读取必须走 `liveConfig()`——快照式读取会让保存静默失效。
15. 浏览器半 `lib/client.js` 必须自包含、只 `require("react")`，且不依赖本包其它文件（客户端模块系统不给它解析相对导入）。

## 附录 B：参考资料

**仓库内**：`README.md`（用户向）· `CHANGELOG.md`（变更）· `docs/INTERFACES.md`（契约）· `docs/ACCEPTANCE.md`（验收）· `docs/paperfit-notes.md`（上游调研）· `docs/upstream/paperfit/`（上游原文 + `MANIFEST.json`）· `THIRD_PARTY_NOTICES.md`（许可）· `tools/_p0/`（探针证据）。

**外部**：PaperFit（arXiv 2605.10341，MIT）· dsh-latex-guard（MIT，借鉴其「CLI 包成 JSON 工具 + 优雅降级 + 拒绝写入不可解析 .bib」）· DSH 官方文档 `develop/basic/{index,tool,config,publish}`、`develop/framework/*`、`develop/practice/*`、`develop/cordis-tutorial/*`。
