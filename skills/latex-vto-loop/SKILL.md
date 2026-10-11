---
name: latex-vto-loop
description: LaTeX 论文的 VTO（视觉排版优化）循环：用「编译 → 渲染页图 → 视觉诊断 → 受控修复 → 复核」的闭环把版面缺陷修到位。当任务是消除孤行/留白/浮动体错位/溢出/跨模板失配，或需要按页图核对版面时使用。所有修复都必须过 guard 内容红线与 policy 伪修复门禁。
---

# VTO 视觉排版循环

**核心原则：版面缺陷必须看**渲染页图**判定，不能只读源码猜。每一次改动都要能被"编译 + 渲染 + 内容完整性 + 页数预算 + 策略"五项复核回来。**

## 0. 本机事实（先读，别装东西）

| 事实 | 值 |
|---|---|
| MiKTeX | `D:\MiKTeX\miktex\bin\x64`（同时提供 pdflatex/xelatex/lualatex/biber/bibtex/makeindex/chktex） |
| `latexmk` | **不可用**（需 Perl）。用 `latex_build` 的自研多趟驱动，不要自己拼 latexmk |
| 页图后端 | ① `pdftoppm`（Poppler 24.04，随 MiKTeX）② `mgs.exe`（MiKTeX 自带 GPL Ghostscript 9.25）③ `mineru-page`（`read_pdf({view:'page'})`；本机 pdfjs 报错，通常不可用） |
| DSH 进程 PATH | **通常不含 MiKTeX bin**。因此渲染/编译走绝对路径探测（render.js 已内置 `D:\MiKTeX\miktex\bin\x64` 兜底） |
| Windows + Poppler | 必须**绝对路径 + `--` 分隔**，否则 I/O Error |
| 上传 | 本地页图不上传；`read_pdf({view:'content'})` 结构化解析**会上传**，受 `uploadScope` 闸门（默认 `external-only`：用户手稿默认不外发） |

## 1. 工具与调用顺序

```text
vto_start   → 建基线：state.json + guard 快照（cite/label/ref/caption 键 + 文件 sha256）+ 页数基线
vto_inspect → 出页图（ContentBlock 图片）+ 18 项 checklist + 度量
vto_fix     → 默认 apply:false 只给 diff + 预检；apply:true 才「备份 → 写 → guard 校验 → 失败回滚」
vto_verify  → verdict + checks{compile,render,contentIntegrity,pageBudget,policy} + regressions + rollbackTo
vto_report  → 写 reports/round-N.{md,json}
```

**路径基准**：`dir`/`pdfPath`/`bib`/`tex` 按工作区解析；`entry`/`file`/`pdf` 相对 `dir`（工程目录）解析，例如 `vto_fix({dir:"paper", file:"main.tex"})`。绝对路径与 `..` 会被拒绝。工作目录默认 `<工程>/.latex-studio/`，布局 `{state.json,build/,auxfiles/,pages/,reports/,backups/rN/}`。辅助目录是 `auxfiles/` 而**不是** `aux/`：`aux` 是 Windows 保留设备名，会让复制/打包失败。

## 2. 一轮完整循环

### 2.1 start（一次）
- 传 `dir`（工程目录）与 `pageBudget`（会议/期刊页数要求）。
- 产出 `baseline`。**没有 baseline 就没有内容红线**，`vto_verify` 只能给 skipped。

### 2.2 inspect（每轮）
- `pages: "all"` 或抽样页，`dpi: 150`（整页判读用 150，细看建议 200）。
- 返回的 `pages[].call` 是可直接照抄的 `read_image({"file_path":"..."})` 调用；页图同时会以 image ContentBlock 内联（数量受 `config.attachImagesPerRound` 限制，默认 1）。
- **必须逐页看图**，对照 `checklist` 的 id 与 `thresholds` 记录缺陷（A/B/C/D/E 分类，见 `latex-fix-catalog`）。
- 若 `render.status !== "ok"`：说明无可用后端，**降级为「只给 checklist」的人工核对**，把 `render.advice` 原样转告用户，不要假装看过图。

### 2.3 fix（每次只改一个语义单元）
- 先用 `apply:false` 拿 diff + 预检结论（`violations` / `contentIntegrity` / `secrets`）。
- 预检通过后再 `apply:true`：写前自动备份到 `backups/r<round>/`，写后 guard 复核，失败**自动回滚**。
- 一次只动一处（一个浮动体 / 一张表 / 一段）。**禁止**用以下伪修复——policy 会直接拒绝：
  - `\resizebox` 缩放表格（→ C1 字号不一致、E1 跨模板失真）
  - 裸固定尺寸 `\vspace{2em}`（→ A5 列空洞）
  - 滥 `\newpage/\clearpage`（→ A2 留白）
  - `\tiny` / `\scriptsize` 缩字号（→ C1）
- 确需豁免：`allowPolicy:["<rule id>"]`，并在 `rationale` 里写明理由（会被记进轮次记录）。

### 2.4 verify（每轮收尾，必须先于 report）
- `checks` 五项任一为 fail → **不要继续叠改动**，先回滚（`rollbackTo` 指向 `backups/rN`）或换手法。
- `compile: skipped` 表示 A 线编译模块不可用：此时不能声称"编译通过"。
- `pageBudget` 只在设置了预算时判定；`fail` 等于 A3/E2。
- `regressions` 列出相对上一轮的退化（页数增加、内容完整性回归）。

### 2.5 report
- `vto_report` 写 `reports/round-N.md`（由 `diagnostic_report.template.md` 渲染）+ `.json`。
- 轮数上限是**建议值** 5 轮（`DEFAULT_MAX_ROUNDS`）；它是产品约定，不是可配字段，也没有工具会拒绝第 6 轮调用——到顶仍未收敛就把剩余缺陷列清楚交回用户。

## 3. 内容红线（guard）

修复**只允许改版面**。以下内容丢失会被判为阻断并回滚：

- `\cite` 家族键（`\cite/\citep/\citet/\parencite/\textcite/\autocite/\footcite/\fullcite/\nocite`…）
- `\label` / `\ref`（`\eqref/\autoref/\pageref/\cref`…）键
- `\caption` 文本、含 `&` 的表格行

数字 token 变化只报警告，但语义微调仅限增删 3-8 词、不得改变数据/结论/引用含义（taxonomy A1/A2 的 `semantic_constraints`）。修复后若 `contentIntegrity.ok === false`，立即回滚。

## 4. 判定口径（照抄 taxonomy 的验收指标）

| 缺陷 | 指标 | 目标 |
|---|---|---|
| A1 孤行/寡行 | `widow_orphan_count` | 0 |
| A2 末页留白 | `last_page_whitespace_ratio` | <0.20 |
| A3 页数预算 | `page_count_match` | true |
| A4 双栏末页不齐 | `column_height_diff_lines` | ≤2 |
| A5 列竖向空洞 | `intra_column_void_ratio` | <0.30 |
| B1 浮动体距离 | `float_reference_distance_pages` | ≤1 |
| B2 浮动体宽度 | `float_width_utilization` | >0.95 且 ≤1.0 |
| B3 浮动体堆叠 | `max_consecutive_floats` | ≤2 |
| B4 浮动体跨页 | `float_split_improper` | 0 |
| D1 Overfull hbox | `overfull_hbox_count` | 0 |
| D2 长公式断行 | `long_equation_overflow_count` | 0 |
| D3 URL 溢出 | `url_overflow_count` | 0 |

C 类（一致性）与 E 类（跨模板）以"全篇一致 / 编译与尺寸适配"为布尔判据；具体每类的允许手法见 `latex-fix-catalog`。

## 5. 降级路径（绝不假装成功）

| 情况 | 正确反应 |
|---|---|
| 三个页图后端都不可用 | `render.status = "skipped"` + advice；只给 checklist，人工核对，不编造版面结论 |
| 没有 PDF | 先 `latex_build`；`vto_inspect` 会返回 skipped |
| 没有 baseline | `vto_verify.contentIntegrity = skipped`；先 `vto_start` |
| `uploadScope` 拦截解析 | 用本地页图通道；或让用户显式同意后再 `consent:true` |
| 修复被 policy/guard 拒绝 | 换允许手法；不要用 `force:true` 绕过内容红线 |

## 6. 反模式

- 一次重写整节 → 会顺手改掉数值/引用（guard 会拦，但代价是一轮白跑）。
- 为了"消除" overfull 而加 `\resizebox` 或缩字号 → 缺陷没消除，只是藏起来。
- 没看图就报"版面无问题"。
- 看到 `compile: skipped` 就说"编译通过"。
- 页数不满就凭感觉加内容 → 必须先确认页数预算，再按 E2/A3 的允许手法处理。
