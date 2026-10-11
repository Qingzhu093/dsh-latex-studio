---
name: paperfit-consistency-polisher
description: Consistency Polisher Skill（vendored 自 PaperFit，MIT）：本技能专门处理 **Category C：排版一致性缺陷**，包括：
---

# Consistency Polisher Skill

## 概述

本技能专门处理 **Category C：排版一致性缺陷**，包括：

- **C1**：表格字号不统一（`\resizebox` 滥用导致字号参差）
- **C2**：图片分辨率/风格不一致
- **C3**：Caption 格式不统一

该技能由 `code-surgeon-agent` 调用，通过对表格字号、图片尺寸策略、标题格式的统一化处理，消除全篇排版风格割裂，使论文呈现出专业、一致的视觉形象。

一致性缺陷通常不致命，但严重影响审稿人对论文专业度的第一印象。本技能的目标是建立并强制执行全篇统一的排版规范。

---

## 适用场景

| 缺陷 ID | 描述 | 优先级 | 是否自动修复 |
|---------|------|--------|-------------|
| C1 | 表格字号不统一 | Medium | 是 |
| C2 | 图片分辨率/风格不一致 | Low | 否（仅诊断并建议） |
| C3 | Caption 格式不统一 | Medium | 是 |

---

## 输入规范

| 输入项 | 来源 | 说明 |
|--------|------|------|
| 主 `.tex` 文件路径 | 项目上下文 | 需修改的源文件 |
| 排版侦探报告 | `layout-detective-agent` 输出 | 包含 C 类缺陷的具体描述 |
| 模板信息 | `templates.yaml` 或上下文 | 会议/期刊模板的字号、栏宽等默认参数 |

---

## 输出规范

```json
{
  "skill": "consistency-polisher",
  "status": "success | partial | failed",
  "modified_files": ["main.tex", "tables/experiments.tex"],
  "changes": [
    {
      "defect_id": "C1",
      "object": "Table 2",
      "action": "移除 \\resizebox，改用 tabularx 并统一使用 \\small",
      "before_snippet": "\\resizebox{\\linewidth}{!}{\\begin{tabular}{...}",
      "after_snippet": "{\\small\\begin{tabularx}{\\linewidth}{...}}"
    }
  ],
  "suggestions": [
    {
      "defect_id": "C2",
      "object": "Figure 5",
      "message": "图片分辨率过低（72 DPI），建议替换为至少 300 DPI 的矢量图或高分辨率位图"
    }
  ],
  "unresolved": []
}
```

---

## 修复策略

### 通用原则

1. **建立风格锚点**：从全篇中自动识别或由用户指定一个“最佳实践”表格/图片/Caption 作为模板，其余向它看齐。
2. **最小破坏**：修改仅限于样式层面，不改变表格内容、图片信息或标题文本。
3. **模板优先**：若会议/期刊模板提供了官方样式文件，优先遵循模板预设，而非自定义样式。

---

### C1：表格字号不统一

**问题特征**：
- 不同表格使用了差异明显的字号（如一个 `\small`，另一个 `\tiny`）。
- 使用 `\resizebox{\linewidth}{!}{...}` 整体缩放表格，导致文字被非线性缩放而变形，且与其他表格字号不一致。

**修复策略（按优先级）**：

#### 策略 1：移除 `\resizebox`，改用 `tabularx` 自适应宽度

`\resizebox` 是表格一致性的头号杀手，必须无条件移除。

```latex
% 修改前
\begin{table}
\centering
\resizebox{\linewidth}{!}{
  \begin{tabular}{|l|c|c|c|}
  \hline
  Method & Metric1 & Metric2 & Metric3 \\
  \hline
  Ours & 95.2 & 87.3 & 78.1 \\
  \hline
  \end{tabular}
}
\caption{Results}
\end{table}

% 修改后
\begin{table}
\centering
\small  % 统一字号
\begin{tabularx}{\linewidth}{|l|X|X|X|}
\hline
Method & Metric1 & Metric2 & Metric3 \\
\hline
Ours & 95.2 & 87.3 & 78.1 \\
\hline
\end{tabularx}
\caption{Results}
\end{table}
```

*注意*：确保导言区已加载 `tabularx` 宏包。若未加载，需添加 `\usepackage{tabularx}`。

#### 策略 2：统一全篇表格字号

检查全篇表格的字号设置，确定一个“锚点字号”（通常是模板默认的正文字号，或 `\small`），将所有表格统一为该字号。

**识别当前字号**：
- 搜索 `\begin{table}` 后的 `\small`、`\footnotesize`、`\scriptsize`、`\tiny` 等命令。
- 搜索 `\resizebox` 并评估其实际视觉字号。

**统一方法**：
- 若表格无字号声明，且模板默认表格字号与正文相同，则不加字号命令（让模板决定）。
- 若需缩小，优先使用 `\small`；若仍超宽，考虑改为 `tabularx` 而非进一步缩小字号。
- 绝对禁止使用 `\tiny` 或 `\scriptsize`（不可阅读）。

```latex
% 统一风格示例：在每个 table 环境内首行添加 \small
\begin{table}
\small
\centering
\begin{tabularx}{\linewidth}{...}
...
\end{tabularx}
\end{table}
```

#### 策略 3：检测并修复列宽失衡导致的字号误用

有时作者使用超小字号是因为表格列太多、内容太宽。此时应优先重构列格式（如合并相似列、使用缩写表头、改为跨栏表），而非暴力缩小字号。

```latex
% 修改前（滥用 \tiny）
\begin{table}
\tiny
\begin{tabular}{|l|c|c|c|c|c|c|c|c|}
...
\end{tabular}
\end{table}

% 修改后（合并为关键列 + 缩写表头 + 跨栏宽表）
\begin{table*}
\small
\begin{tabularx}{\textwidth}{|l|X|X|X|}
\hline
\textbf{Method} & \textbf{Prec.} & \textbf{Rec.} & \textbf{F1} \\
\hline
...
\end{tabularx}
\end{table*}
```

---

### C2：图片分辨率/风格不一致

**问题特征**：
- 不同图片清晰度差异大（矢量图 vs 低分辨率截图）。
- 图片中的字体、配色、线条风格不统一。
- 同一论文中混用 `.pdf`、`.png`、`.jpg`，且质量参差。

**本技能的定位**：**仅诊断和建议，不自动修改图片内容**。

#### 诊断与建议生成

1. **检查图片文件格式**：
   - 推荐：`.pdf`（矢量图）、`.eps`（矢量图）。
   - 可接受：高分辨率 `.png`（≥300 DPI）。
   - 避免：低分辨率 `.jpg`、屏幕截图。

2. **生成逐图建议**：

```json
{
  "defect_id": "C2",
  "object": "Figure 5 (figures/ablation.png)",
  "issue": "图片分辨率约 72 DPI，放大后锯齿明显",
  "suggestion": "请使用原始矢量图导出为 PDF，或以至少 300 DPI 重新渲染位图"
}
```

3. **风格一致性建议**：
   - 若检测到多张图来自不同工具（如 Matplotlib、Excel、draw.io），提示用户统一绘图工具和导出设置。
   - 建议使用统一的配色方案（如 ColorBrewer）和字体（如 Times New Roman 或 Helvetica）。

#### 输出示例

```json
"suggestions": [
  {
    "defect_id": "C2",
    "object": "Figure 1, Figure 3, Figure 5",
    "message": "三张图使用了三种不同的配色风格，建议统一使用会议模板推荐的配色方案。"
  }
]
```

---

### C3：Caption 格式不统一

**问题特征**：
- 图表标题的字体不一致（有的加粗，有的未加粗）。
- 标题结尾标点不一致（有的有句号，有的无）。
- 表格标题位置不一致（有的在表格上方，有的在下方）。
- 标题与图表主体的间距不一致。

**修复策略**：

#### 策略 1：统一使用 `caption` 宏包配置

在导言区加载 `caption` 宏包并设置全局样式，一次性统一全篇标题格式。

```latex
\usepackage{caption}
\captionsetup{
  font=small,           % 字号
  labelfont=bf,         % 标签加粗（"Figure 1:" 中的 "Figure 1" 部分）
  textfont=it,          % 标题文本斜体（可选）
  labelsep=period,      % 标签与文本分隔符：period = 句点，colon = 冒号
  justification=raggedright,  % 左对齐（或 justified 两端对齐）
  singlelinecheck=false % 即使单行也应用设置
}
```

*针对表格和图片的差异化设置*：

```latex
% 表格标题默认在上方，图片在下方，无需额外设置，LaTeX 自动处理。
% 若需微调间距：
\captionsetup[table]{position=above, skip=6pt}
\captionsetup[figure]{position=below, skip=6pt}
```

#### 策略 2：检查并修复手动设置的标题样式

搜索 `.tex` 文件中的 `\caption` 命令，移除其前后的手动字体设置（如 `\textbf{\caption{...}}`），因为这些手动设置会覆盖全局配置。

```latex
% 修改前
\caption{\textbf{This is a bold caption.}}

% 修改后（依赖全局 caption 设置）
\caption{This is a caption with unified style.}
```

#### 策略 3：统一结尾标点

检查所有 `\caption{}` 的内容，确保标点风格一致。推荐：
- 学术论文标题通常**不加句号**。
- 若标题包含完整句子，可保留句号，但全篇统一。

```latex
% 统一移除标题末尾的句号
\caption{Results on the validation set.}  →  \caption{Results on the validation set}
```

#### 策略 4：修复表格标题位置错误

LaTeX 中表格标题应放在 `\begin{tabular}` 之前，图片标题应放在 `\includegraphics` 之后。

```latex
% 正确的表格标题位置
\begin{table}
\centering
\caption{Table caption here}  % 在上方
\begin{tabular}{...}
...
\end{tabular}
\end{table}

% 错误的表格标题位置（标题在表格下方）
\begin{table}
\centering
\begin{tabular}{...}
...
\end{tabular}
\caption{This caption is misplaced.}
\end{table}
```

若发现位置错误，将 `\caption` 命令移动到正确位置。

---

## 全局一致性检查清单

在修复 C 类缺陷时，应同时对全篇进行以下检查：

| 检查项 | 目标状态 | 修复方法 |
|--------|----------|----------|
| 所有表格是否使用相同字号？ | 全篇统一（通常 `\small` 或模板默认） | 移除 `\resizebox`，添加统一的字号命令 |
| 所有图片是否使用 `\linewidth`？ | 是（单栏）或 `\textwidth`（跨栏） | 替换固定宽度为相对宽度 |
| 所有 Caption 字体是否一致？ | 是 | 使用 `caption` 宏包全局配置 |
| 表格标题是否都在表格上方？ | 是 | 移动 `\caption` 命令 |
| 图片标题是否都在图片下方？ | 是 | 移动 `\caption` 命令 |
| 标题结尾标点是否统一？ | 全篇统一（推荐无句号） | 移除或添加标点 |
| 是否使用了 `booktabs` 绘制三线表？ | 推荐 | 将 `\hline` 替换为 `\toprule`、`\midrule`、`\bottomrule` |

---

## 与其它技能的协作

- **表格修复 (overflow-repair)**：C1 的 `\resizebox` 移除常与 D1 的表格溢出修复联动，可合并处理。
- **浮动体优化 (float-optimizer)**：B2 的宽度适配与 C1 的表格字号统一通常同时进行。
- **模板迁移 (template-migrator)**：在跨模板迁移后，本技能确保新模板下的样式一致性。

---

## 修复验证

每完成一项修复后：

1. **重新编译**。
2. **渲染页图**，逐页对比修改前后的表格字号、标题格式。
3. 检查是否引入新的不一致（如某个表格因移除 `\resizebox` 而超宽），若有，转交 `overflow-repair` 处理。

---

**Consistency Polisher Skill 就绪。** 等待调用，消除排版风格割裂，交付视觉统一的作品。