---
name: paperfit-float-optimizer
description: Float Optimizer Skill（vendored 自 PaperFit，MIT）：本技能专门处理 **Category B：浮动体缺陷**，包括：
---

# Float Optimizer Skill

## 概述

本技能专门处理 **Category B：浮动体缺陷**，包括：

- **B1**：浮动体远离首次引用（Float-Reference Distance）
- **B2**：浮动体大小不适配栏宽（Float Width Mismatch）
- **B3**：连续多个浮动体堆叠无正文间隔（Float Clustering）
- **B4**：浮动体跨页分裂（Float Page Orphaning）

该技能由 `code-surgeon-agent` 调用，通过对浮动体位置参数、尺寸设置和周围正文结构的精确调整，实现图表与正文的和谐共处。浮动体优化是视觉排版中最具挑战性的环节之一，必须结合页图反馈迭代验证。

---

## 适用场景

当 `layout-detective-agent` 报告中出现以下缺陷 ID 时，路由至本技能：

| 缺陷 ID | 描述 | 优先级 |
|---------|------|--------|
| B1 | 浮动体远离首次引用 | High |
| B2 | 浮动体大小不适配栏宽 | High |
| B3 | 浮动体连续堆叠 | Medium |
| B4 | 浮动体跨页分裂 | Medium |

---

## 输入规范

| 输入项 | 来源 | 说明 |
|--------|------|------|
| 主 `.tex` 文件路径 | 项目上下文 | 需修改的源文件 |
| 排版侦探报告 | `layout-detective-agent` 输出 | 包含缺陷对象（图表标签）、页码、描述 |
| 源码交叉引用报告 | `extract_crossrefs.py` 输出 (`data/crossrefs.json`) | 提供每个图表的首次引用行号、定义行号、行距离、节距离 |
| 当前 PDF 页图 | `visual-inspector` 输出 | 用于验证修复后视觉效果 |
| 模板类型 | 用户上下文或 `templates.yaml` | 单栏/双栏，影响浮动体宽度策略 |

**输入使用说明**：
- 从 `crossrefs.json` 的 `distances[]` 数组中提取 `ref_line` 和 `figure_line`，计算源码距离
- 若源码距离近（`line_distance < 50` 且 `section_distance = 0`）但视觉距离远 → 典型 LaTeX 浮动体放置问题，使用本技能的浮动体参数调整策略
- 若源码距离本身远 → 优先建议移动源码位置（策略 3），而非调整浮动体参数

---

## 输出规范

修改完成后，必须返回以下信息：

```json
{
  "skill": "float-optimizer",
  "status": "success | partial | failed",
  "modified_files": ["main.tex"],
  "changes": [
    {
      "defect_id": "B1",
      "object": "Figure 3",
      "action": "调整浮动体位置参数为 [htbp]",
      "before": "\\begin{figure}[t]",
      "after": "\\begin{figure}[htbp]"
    },
    {
      "defect_id": "B2",
      "object": "Table 1",
      "action": "将 tabular 宽度设为 \\linewidth",
      "before": "\\begin{tabular}{|l|c|c|}",
      "after": "\\begin{tabularx}{\\linewidth}{|l|X|X|}"
    }
  ],
  "unresolved": []
}
```

---

## 修复策略

### 通用原则

1. **浮动体是“浮动”的**：LaTeX 的浮动体放置算法具有不确定性，同一份源码在不同编译中可能产生不同输出。因此，修复后必须多次编译以验证稳定性。
2. **最小侵入**：优先调整位置参数 `[htbp]`，其次调整尺寸，最后才考虑移动浮动体在源码中的位置。
3. **视觉验证必须**：浮动体修复的效果必须在页图上肉眼确认，不能仅凭日志判断。

---

### B1：浮动体远离首次引用

**问题特征**：
- 图表出现在距离其首次引用页码 ≥ 2 页的位置。
- 读者需翻页才能找到对应图表，打断阅读流。
- **源码分析**：从 `data/crossrefs.json` 读取 `ref_line` 和 `figure_line`：
  - 若 `line_distance < 50` 且 `section_distance = 0` → 源码组织良好，问题出在 LaTeX 浮动体放置算法
  - 若 `line_distance > 100` 或 `section_distance ≥ 1` → 源码层面的引用与定义相距较远

**诊断流程（新增）**：
```bash
# 第一步：运行源码交叉引用分析
paperfit run scripts/extract_crossrefs.py main.tex --output data/crossrefs.json

# 第二步：解读输出
# {
#   "distances": [
#     {"label": "fig:result", "ref_line": 245, "figure_line": 260, "line_distance": 15, "section_distance": 0, "severity": "none"}
#   ]
# }
# 若源码距离近但视觉距离远 → 浮动体参数调整
# 若源码距离远 → 移动源码位置
```

**修复策略（按优先级）**：

1. **调整位置参数**  
   将浮动体环境的参数从限制性强的 `[t]` 或 `[b]` 改为更宽松的 `[htbp]`，给 LaTeX 更多放置自由度。
   ```latex
   % 修改前
   \begin{figure}[t]
   % 修改后
   \begin{figure}[htbp]
   ```
   *参数含义*：`h` = here（尽可能在此处），`t` = top（页顶），`b` = bottom（页底），`p` = float page（独立浮动页）。

2. **使用 `\FloatBarrier` 强制放置**  
   在引用点之后、期望图表出现的位置之前插入 `\FloatBarrier`（需 `placeins` 宏包），阻止浮动体越过此边界。
   ```latex
   \usepackage{placeins}
   ...
   As shown in Figure~\ref{fig:result}, ...
   \FloatBarrier  % 确保图不会漂到更后
   ```

3. **移动浮动体源码位置**  
   将整个 `figure` 或 `table` 环境在 `.tex` 源码中向上移动，使其更接近首次引用点。
   *注意*：移动源码可能改变上下文，需确保不影响前后文语义。

4. **拆分大型浮动体**  
   若一个浮动体包含多个子图且过大，考虑拆分为两个独立的浮动体，或将其部分内容移至附录。

5. **调整前后正文数量**  
   在浮动体前后增删少量文本（由 `semantic-polish-agent` 协助），改变分页位置，使浮动体自然落在引用附近。

---

### B2：浮动体大小不适配栏宽

**问题特征**：
- 过窄：图表宽度明显小于栏宽，两侧留白过多。
- 超宽：图表超出栏宽，内容被截断或溢出到页边。

**修复策略（按优先级）**：

1. **图片宽度标准化**  
   将所有图片的 `\includegraphics` 宽度设为 `\linewidth`（单栏）或 `\textwidth`（跨栏）。
   ```latex
   % 修改前
   \includegraphics[width=0.6\textwidth]{figure.pdf}
   % 修改后
   \includegraphics[width=\linewidth]{figure.pdf}
   ```

2. **区分单栏与跨栏图表**  
   - 单栏模板：所有图表默认使用 `\linewidth`。
   - 双栏模板：单栏图表用 `\columnwidth` 或 `\linewidth`；跨栏图表使用 `figure*` / `table*` 环境，宽度用 `\textwidth`。
   ```latex
   % 双栏中的跨栏图
   \begin{figure*}
   \includegraphics[width=\textwidth]{wide_figure.pdf}
   \end{figure*}
   ```

3. **表格宽度自适应**  
   使用 `tabularx` 将表格宽度设为 `\linewidth`，并由 `X` 列自动分配多余空间。
   ```latex
   \begin{tabularx}{\linewidth}{|l|X|X|}
   ```

4. **旋转超宽表格**  
   对于列数过多的宽表，使用 `sidewaystable` 环境旋转 90 度展示。
   ```latex
   \usepackage{rotating}
   ...
   \begin{sidewaystable}
   \centering
   \begin{tabular}{...}
   ...
   \end{tabular}
   \end{sidewaystable}
   ```

5. **缩小超大图片**  
   若原图本身尺寸过大，可使用 `width=\linewidth` 自动缩放；若仍需保持比例，可同时设置 `height` 和 `keepaspectratio`。
   ```latex
   \includegraphics[width=\linewidth,height=0.3\textheight,keepaspectratio]{figure.pdf}
   ```

---

### B3：浮动体连续堆叠

**问题特征**：
- 同一页或连续两页出现 ≥ 3 个图表，且中间正文极少（≤ 2 行）。

**修复策略（按优先级）**：

1. **分散浮动体位置参数**  
   为不同浮动体分配不同的位置偏好，如第一个用 `[t]`，第二个用 `[b]`，第三个用 `[p]`，避免它们挤在同一页。
   ```latex
   \begin{figure}[t] ... \end{figure}
   \begin{table}[b] ... \end{table}
   \begin{figure}[p] ... \end{figure}
   ```

2. **在浮动体之间插入正文**  
   若浮动体在源码中连续出现，可在其间补充或前移若干行正文（需确保语义连贯）。
   ```latex
   \begin{figure} ... \end{figure}
   % 在此处插入一段正文，哪怕只有 2-3 行
   The above results demonstrate...
   \begin{table} ... \end{table}
   ```

3. **使用 `\FloatBarrier` 控制浮动页**  
   在适当位置插入 `\FloatBarrier`，迫使之前的浮动体在下一页之前全部输出，避免后续浮动体继续堆积。

4. **将部分图表移至附录**  
   若正文中图表过多，可将非核心的图表或消融实验移至附录，并在正文中引用。

---

### B4：浮动体跨页分裂

**问题特征**：
- 一个长表格跨页断开，且第二页未重复表头。
- 一个图片（含子图）被分页符切开。

**修复策略（按优先级）**：

1. **长表格使用 `longtable` 环境**  
   将普通 `table` + `tabular` 替换为 `longtable`，支持跨页并自动重复表头。
   ```latex
   \usepackage{longtable}
   ...
   \begin{longtable}{|l|c|c|}
   \caption{Long table caption} \label{tab:long} \\
   \hline
   \textbf{Header1} & \textbf{Header2} & \textbf{Header3} \\
   \hline
   \endfirsthead
   \hline
   \textbf{Header1} & \textbf{Header2} & \textbf{Header3} \\
   \hline
   \endhead
   % 表格内容
   \end{longtable}
   ```

2. **强制表格不跨页**  
   若表格并非特别长，可用 `\begin{table}[!h]` 配合 `\centering` 强制放在一页内。
   ```latex
   \begin{table}[!h]
   \centering
   \begin{tabular}{...}
   ...
   \end{tabular}
   \end{table}
   ```

3. **拆分过大的图片组**  
   若一个 `figure` 包含多个子图且总高度过大，拆分为两个独立的 `figure` 环境。

---

## 双栏模板的特殊处理

双栏布局下的浮动体优化更加复杂，需额外注意：

| 场景 | 策略 |
|------|------|
| 单栏图过窄 | 判断图片宽高比：若宽度 > 高度 * 1.5，考虑改为跨栏 `figure*` |
| 跨栏图位置不受控 | 跨栏图只能放在页顶或单独浮动页，使用 `[t]` 或 `[p]` |
| 跨栏图导致正文留白 | 若跨栏图后下一页大片空白，考虑缩小图尺寸或在其后补充内容 |
| 双栏末页浮动体堆积 | 使用 `\balance` 或 `\flushend` 平衡末页两栏高度（见 `space-util-fixer`） |

---

## 修复验证

每完成一项修复后：

1. 重新编译至少 **两次** 以稳定交叉引用和浮动体位置。
2. 渲染新的 PDF 页图，对照缺陷报告逐项检查：
   - B1：浮动体页码与引用页码差值是否 ≤ 1？
   - B2：图表宽度是否充分利用栏宽且无溢出？
   - B3：堆叠是否分散，页面上图表数量是否 ≤ 2？
   - B4：表格跨页是否带有重复表头？
3. 若未通过，尝试下一策略，直至所有策略用尽或缺陷消除。

---

## 注意事项

- **避免过度使用 `[H]`**：`float` 宏包提供的 `[H]` 参数强制图表“在此处”，会破坏 LaTeX 的浮动机制，容易导致大面积留白。仅作为最后手段使用。
- **跨栏图顺序**：双栏中 `figure*` 总是出现在下一页顶部，这是 LaTeX 的固有行为，不可改变。若引用与图表跨页不可避免，接受并记录。
- **与 `space-util-fixer` 协同**：浮动体调整可能影响页数预算和末页留白，需联动 `space-util-fixer` 综合优化。

---

**Float Optimizer Skill 就绪。** 等待 `code-surgeon-agent` 调用，执行浮动体优化任务。
