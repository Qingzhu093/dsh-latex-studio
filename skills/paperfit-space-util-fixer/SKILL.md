---
name: paperfit-space-util-fixer
description: Space Utilization Fixer Skill（vendored 自 PaperFit，MIT）：本技能专门处理 **Category A：空间利用缺陷**，包括：
---

# Space Utilization Fixer Skill

## 概述

本技能专门处理 **Category A：空间利用缺陷**，包括：

- **A1**：孤行/寡行（Widow/Orphan Lines）
- **A2**：末页大面积留白（Excessive Trailing Whitespace）
- **A3**：页数预算违反（Page Budget Violation）
- **A4**：双栏末页左右栏高度不齐（Unbalanced Column Heights）
- **A5**：双栏页内列竖向空洞（栏内中段大块无图无表空白，常与 `figure*`/`[H]`/不当断页有关）

该技能由 `code-surgeon-agent` 或 `semantic-polish-agent` 调用，通过对段落级排版控制、浮动体调度和最小语义改写的组合运用，优化页面空间分配，使文档达到专业级的视觉均衡。

空间利用问题的修复常常需要多轮迭代，因为局部调整会影响全局分页。因此，每次修改后必须重新编译并审查页图。

---

## 适用场景

| 缺陷 ID | 描述 | 优先级 | 是否允许语义修改 |
|---------|------|--------|-----------------|
| A1 | 孤行/寡行 | High | 是（最后手段） |
| A2 | 末页大面积留白 | High | 是（最后手段） |
| A3 | 页数预算违反 | Critical | 是（最后手段） |
| A4 | 双栏末页左右栏高度不齐 | Medium | 否 |
| A5 | 双栏页内列竖向空洞（非末页、栏内大块无正文空白） | High | 视情况 |

---

## 输入规范

| 输入项 | 来源 | 说明 |
|--------|------|------|
| 主 `.tex` 文件路径 | 项目上下文 | 需修改的源文件 |
| 排版侦探报告 | `layout-detective-agent` 输出 | 包含 A 类缺陷的页码和描述 |
| 目标页数（若适用） | 用户约束 | A3 修复必须提供 |
| 模板类型 | `templates.yaml` 或上下文 | 单栏/双栏 |

---

## 输出规范

```json
{
  "skill": "space-util-fixer",
  "status": "success | partial | failed",
  "modified_files": ["main.tex"],
  "changes": [
    {
      "defect_id": "A1",
      "object": "第4页顶部孤行",
      "action": "在段落前添加 \\looseness=-1",
      "before_snippet": "The proposed method achieves...",
      "after_snippet": "{\\looseness=-1 The proposed method achieves...}"
    }
  ],
  "unresolved": []
}
```

---

## 修复策略

### 通用原则

1. **先排版，后语义**：优先使用 LaTeX 原生的排版控制命令，仅在无效时才考虑语义级改写。
2. **局部修改，全局验证**：改动一段可能影响后续多页分页，必须完整编译并检查全文档。
3. **避免硬性分页**：禁止滥用 `\newpage` 或 `\clearpage` 来“凑页数”，这会破坏文档结构的自然性。

---

### A1：孤行/寡行修复

**问题特征**：
- 段落最后一行单独出现在下一页顶部（孤行）。
- 段落第一行单独留在上一页底部（寡行）。
- 段落末尾仅含 1-3 个单词的短行（段尾小尾巴）。

**修复策略（严格按优先级顺序尝试）**：

#### 策略 1：段落级收紧 (`\looseness=-1`)

通过在段落前设置 `\looseness=-1`，指示 TeX 引擎尝试将段落收缩一行，从而消除孤行或小尾巴。

```latex
% 修改前
The proposed method achieves state-of-the-art performance on several
benchmarks, demonstrating the effectiveness of our approach.

% 修改后
{\looseness=-1 The proposed method achieves state-of-the-art performance on several
benchmarks, demonstrating the effectiveness of our approach.}
```

*注意*：
- 必须将整个段落用花括号 `{ }` 括起，以限制 `\looseness` 的作用范围。
- 若段落本身很短，收缩可能导致过紧的行距，需在页图上确认可接受。

#### 策略 2：段落级扩张 (`\looseness=1`)

若段落太紧，可尝试扩张一行，使段末行变长。

```latex
{\looseness=1 This paragraph will be typeset with one more line...}
```

#### 策略 3：调整段落间胶水 (`\emergencystretch`)

为特定段落增加紧急拉伸量，允许行间略微拉伸以调整断行。

```latex
{\emergencystretch=1em This paragraph content...}
```

#### 策略 4：微调上下文句长分布（需 `semantic-polish-agent`）

若排版控制无效，则进行最小语义改写：
- 在段落中增删 3-8 个单词（如将 `in order to` 改为 `to`，或将 `demonstrate` 改为 `show`）。
- 调整从句结构，但不改变学术原意。

```latex
% 修改前
The proposed method achieves state-of-the-art performance on several
benchmarks, demonstrating the effectiveness of our approach.

% 修改后
The proposed method achieves state-of-the-art results on several
benchmarks, showing the effectiveness of our approach.
```

*语义改写必须由 `semantic-polish-agent` 执行，本技能仅提出请求。*

#### 策略 5：全局调整 widow/orphan 惩罚

在导言区增加以下设置（通常模板已包含，可作为兜底）：

```latex
\widowpenalty=10000
\clubpenalty=10000
\displaywidowpenalty=10000
```

*注意*：此设置影响全局，需谨慎。若模板已设置，则无需重复。

---

### A2：末页大面积留白修复

**问题特征**：
- 最后一页（参考文献前或后）空白区域超过页面高度的 20%。

**修复策略（按优先级）**：

#### 策略 1：前移浮动体

检查倒数第二、第三页是否有可前移的图表。调整其位置参数 `[htbp]`，使其占据末页空白区域。

```latex
% 将原本放在倒数第二页的图强制前移
\begin{figure}[t]  →  \begin{figure}[ht]
```

#### 策略 2：调整局部垂直间距

在不影响整体美观的前提下，微调末页前的某些垂直间距（如 `\vspace`、章节间距）。

```latex
% 轻微缩小最后一节前的间距
\vspace{-0.5em}
\section{Conclusion}
```

*注意*：不要制造新的视觉不协调。

#### 策略 3：适当扩写结论或讨论部分（需语义润色）

在结论、讨论或分析段落中增加有实质内容的 2-4 行文本（约 30-60 词），以自然填充空白。

*此操作必须由 `semantic-polish-agent` 执行。*

#### 策略 4：增加附录或致谢（最后手段）

若用户同意，可将部分非核心内容（如额外消融实验）从正文移至附录，或在末页后增加致谢部分。

---

### A3：页数预算修复

**问题特征**：
- 实际总页数与目标页数不符（如会议要求 9 页，实际 8 页或 10 页）。

**修复策略**：

本缺陷修复需要系统性操作，通常结合多种手段。

#### 情况 1：超页（实际页数 > 目标页数）

**优先级从高到低**：

1. **压缩浮动体**  
   - 缩小超大图片（`width=0.95\linewidth` 代替 `\linewidth`）。
   - 将跨页长表格改为 `longtable`（可跨页，避免独占一页）。
   - 调整浮动体位置，使其更紧凑地填充页面。

2. **缩减垂直间距**  
   - 使用 `\vspace{-0.2cm}` 微调节标题、图表与正文的间距。
   - 检查是否有冗余的 `\newline` 或空行。

3. **精炼文字（语义级）**  
   在非核心段落（Related Work、Introduction 末尾）进行精简：
   - 删除冗余修饰词。
   - 合并短句。
   - 将被动语态改为主动语态（通常更短）。

4. **压缩参考文献**  
   若参考文献过多，使用 `\bibliographystyle{abbrv}` 或类似缩写样式，或使用 `biblatex` 的压缩选项。

5. **缩小页边距（谨慎）**  
   若模板允许，使用 `\usepackage[margin=...]{geometry}` 微调边距。*必须在模板允许范围内。*

#### 情况 2：缺页（实际页数 < 目标页数）

**优先级从高到低**：

1. **检查浮动体堆积**  
   是否因 `\FloatBarrier` 或 `[H]` 导致页面空白？若是，先按 B 类缺陷修复。

2. **适当扩写结论、讨论或分析段落**  
   增加 5-10 行有实质内容的分析，例如：
   - 深入解释某个实验结果的含义。
   - 补充一个简短的局限性讨论。
   - 强化与相关工作的对比。

3. **增加附录或补充材料**  
   若会议允许附录且不计入页数限制，可将部分内容移至附录，使正文恰好满页。

4. **微调图表尺寸**  
   将部分图片略微放大（`width=1.0\linewidth` 代替 `0.95\linewidth`），使其占据更多空间但不溢出。

5. **增加分页点**  
   在合适位置（如章节末尾）添加 `\newpage` 迫使内容分页，但必须确保不产生孤页。

---

### A4：双栏末页左右栏高度不齐

**问题特征**：
- 双栏模板最后一页，左栏和右栏底部高度差超过 2 行。

**修复策略**：

#### 策略 1：使用 `\balance` 或 `flushend` 宏包

在导言区加载 `flushend` 宏包，自动平衡末页两栏高度。

```latex
\usepackage{flushend}
```

*注意*：`flushend` 与某些宏包（如 `multicol`）可能冲突，需在特定模板下测试。

#### 策略 2：手动平衡

若自动平衡无效，在最后一节结束前插入 `\balance` 命令（需 `balance` 宏包）。

```latex
\usepackage{balance}
...
\section{Conclusion}
...
\balance
\end{document}
```

#### 策略 3：微调最后一段的断行

对末页最后一段使用 `\looseness=-1` 或 `\looseness=1`，改变其行数，从而影响两栏高度。

#### 策略 4：调整浮动体位置

若末页有浮动体，尝试将其移至前一页或强制放在当前页底部，以改变栏内内容分布。

---

### A5：双栏页内列竖向空洞

**问题特征**：某一页左栏或右栏在标题/段落后出现大块竖向空白（无图无表），另一栏同期仍有连续正文；常见于 `figure*` 顶到下一页后在栏内留下“断层”、滥用 `\\` / `\clearpage`、`\FloatBarrier`、`[H]` 等。

**修复策略**（优先浮动体与断页，再动正文）：

1. 检查本页及前后页的 `figure*` / `table*`：尝试将浮动环境在源码中前移/后移，或改为单栏 `figure`/`table`（若尺寸允许）。
2. 搜索并移除不当的 `\\`（段内强制换行）、`\newpage`、`\vfill`；慎用 `[H]`。
3. 若使用 `\FloatBarrier`，评估是否可删除或挪到节末。
4. 与 **float-optimizer** 协同：处理 `Float too large` 日志后再看栏内空洞是否消失。
5. 最后手段：对空洞下方段落使用 `\looseness` 或最小语义扩写，使分栏断点上移。

---

## 修复验证

每完成一项修复后：

1. **重新编译至少两次**（确保交叉引用稳定）。
2. **渲染页图**，对照缺陷逐项检查：
   - A1：孤行/寡行是否消失？
   - A2：末页空白比例是否降至 20% 以下？
   - A3：总页数是否达到目标？
   - A4：双栏末页高度差是否 ≤ 2 行？
   - A5：该页逐栏检查，栏内中段竖向空洞是否消失？
3. 若未通过，回滚并尝试下一策略。

---

## 与其它技能的协作

- **浮动体修复 (float-optimizer)**：A2 和 A3 常需配合浮动体调整。
- **语义润色 (writing-polish)**：当排版手段用尽时，请求语义改写。
- **一致性检查 (consistency-polisher)**：修改字号、间距后需确保全局一致。

---

**Space Utilization Fixer Skill 就绪。** 等待调用，优化页面空间分配。