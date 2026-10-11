---
name: latex-fix-catalog
description: VTO 18 类排版缺陷（A1-A5/B1-B4/C1-C3/D1-D3/E1-E3）的修复目录：每类的检测信号、阈值、允许手法、禁止手法与验收指标。当用 vto_inspect/vto_fix 处理论文版面缺陷时加载，避免用 resizebox、裸 vspace、滥 newpage、tiny/scriptsize 等伪修复。
---

# LaTeX 排版缺陷修复目录（VTO taxonomy v1.0）

> 本目录由 `lib/data/vto_taxonomy.json` 的 18 个缺陷 id 生成，与 `vto_inspect` 返回的 checklist 同源。
> 严重度：critical（门禁阻断）、major（门禁阻断）、minor（不阻断）。

## 0. 全篇禁止的伪修复手法（`lib/core/policy.js` FORBIDDEN，`vto_fix` 会直接拒绝）

| id | 禁止 | 为什么 | 替代 |
|---|---|---|---|
| `resizebox` | 禁止 \resizebox 暴力缩放 | 使用了 \resizebox 暴力缩放：会连带缩放字号，造成全篇表格字号不一致（C1）与跨模板失真（E1）。 | 改用 tabularx + \textwidth 弹性 X 列；图片按 \linewidth / \columnwidth 设自然宽度，绝不用 \resizebox。 |
| `bare-vspace` | 裸 \vspace 硬编码间距 | 新增了固定尺寸的裸 \vspace{...}：属于掩盖排版问题的间距 hack，会破坏纵向节奏（A5）。 | 改用语义化间距（\setlength{\parskip}、列表参数、\captionsetup）或 \vspace*{\fill}（允许的填页形式）；确需固定间距请在 diff 中说明理由。 |
| `newpage-abuse` | 滥用 \newpage/\clearpage | 新增了强制分页命令：滥用会造成大面积留白与列空洞（A2/A5）。 | 优先用浮动体参数（[htbp]/[t]）、\FloatBarrier 或段落伸缩解决；确需在参考文献前强制分页时，请在 diff 中说明并与用户确认。 |
| `tiny-font` | 滥用 \tiny | 新增了 \tiny 缩小字号：会破坏全篇字号一致性（C1）并降低可读性。 | 表格统一用 \small 或模板默认字号，通过列宽/断行而不是缩字号解决溢出。 |
| `scriptsize-font` | 滥用 \scriptsize | 新增了 \scriptsize 缩小字号：与表格/正文默认字号不一致（C1）。 | 统一字号策略，优先用 \small；若整篇模板规定小字号，请在模板层一次性设置而不是逐处加。 |

**规则**：policy 是 **diff 门禁**——只拦截本轮*新增*的违禁用法；文档里历史遗留的写法不会每轮被重复报警，但也**不应主动新增**。
确需豁免时，必须在 `vto_fix` 里显式传 `allowPolicy:["<rule id>"]` 或 `force:true`，并在 diff 说明理由。

## 1. 内容红线（`lib/core/guard.js`）

任何修复都不得删除或改写：

- `\cite` 家族的键集合（`\cite/\citep/\citet/\parencite/\textcite/\autocite/\footcite/\fullcite/\nocite` 等）
- `\label`、`\ref`（`\eqref/\autoref/\pageref/\cref` …）键集合
- `\caption` 文本（归一化空白后比对）
- 表格行（含 `&` 的行）

丢失任一 `\cite` 键 → `vto_fix` 判为阻断并**拒绝写入/自动回滚**。数字 token 与表格行的变化只报警告，但语义微调只允许增删 3-8 词且不得改变数据、结论与引用含义。

## 2. 缺陷目录

### A 类 · 空间利用缺陷（Space Utilization Defects）

#### A1 孤行/寡行（major（强烈建议））

段落最后一行单独出现在下一页顶部（孤行），或段落第一行单独留在上一页底部（寡行）；也包括段尾仅含两三个单词的'小尾巴'

- **需要页图**：是（必须看渲染页图，不能只读源码）
- **视觉判据**：
  - 页面顶部或底部出现极短的文本行
  - 段尾行长度小于栏宽的 1/4
  - 跨页段落断开位置不自然
- **阈值**：无显式阈值（人工判读）
- **执行**：按本节「允许手法」做一次最小改动，经 `vto_fix`（先 `apply:false` 预检）写入
- **允许手法**：
  - 全局 penalty 防护（\widowpenalty=10000, \clubpenalty=10000）
  - \looseness=-1 紧缩排版（消除小尾巴）
  - \looseness=1 扩展排版（填充空白）
  - 语义级微调（最后手段，增删 3-8 词）
- **禁止手法**：`resizebox`、`bare-vspace`、`newpage-abuse`、`tiny-font`、`scriptsize-font`；尤其不许用缩放/缩字号把问题藏起来。
- **语义级改动**：允许（仅允许增删 3-8 个单词；不改变数据、结论、引用含义；优先使用排版手段，语义干预为最后手段）
- **验收指标**：`widow_orphan_count` = 0

#### A2 末页大面积留白（major（强烈建议））

论文最后一页（参考文献之前或之后）存在过大的空白区域，显得内容单薄

- **需要页图**：是（必须看渲染页图，不能只读源码）
- **视觉判据**：
  - 末页空白面积超过页面高度的 20%
  - 参考文献页底部大面积空白
- **阈值**：`max_whitespace_ratio = 0.2`
- **执行**：按本节「允许手法」做一次最小改动，经 `vto_fix`（先 `apply:false` 预检）写入
- **允许手法**：
  - 调整浮动体位置，将图表前移填充空白
  - 微调段落间距或 \looseness
  - 适当扩写结论/讨论部分（语义级）
  - 压缩过宽的页边距（谨慎）
- **禁止手法**：`resizebox`、`bare-vspace`、`newpage-abuse`、`tiny-font`、`scriptsize-font`；尤其不许用缩放/缩字号把问题藏起来。
- **语义级改动**：允许（仅限结论、分析段落、方法末尾；不可引入新实验或数据）
- **验收指标**：`last_page_whitespace_ratio` = "<0.20"

#### A3 页数预算违反（critical（必须修复））

论文总页数超出或不足会议/期刊规定页数（如要求 9 页，实际 8 或 10 页）

- **需要页图**：否（可用日志/页数判定）
- **视觉判据**：
  - PDF 总页数与用户指定目标不符
- **阈值**：无显式阈值（人工判读）
- **执行**：按本节「允许手法」做一次最小改动，经 `vto_fix`（先 `apply:false` 预检）写入
- **允许手法**：
  - 若超页：压缩浮动体、缩减参考文献、精炼文字
  - 若不满页：扩写结论/讨论、微调图表尺寸、增加分析深度
- **禁止手法**：`resizebox`、`bare-vspace`、`newpage-abuse`、`tiny-font`、`scriptsize-font`；尤其不许用缩放/缩字号把问题藏起来。
- **语义级改动**：允许（不引入新数据或虚构内容；优先调整非核心章节）
- **验收指标**：`page_count_match` = true

#### A4 双栏末页左右栏高度不齐（minor（时间充裕时））

双栏排版的最后一页，左右两栏底部高度不一致，影响视觉平衡

- **需要页图**：是（必须看渲染页图，不能只读源码）
- **视觉判据**：
  - 双栏布局末页左右栏底部高度差超过 2 行
- **阈值**：无显式阈值（人工判读）
- **执行**：按本节「允许手法」做一次最小改动，经 `vto_fix`（先 `apply:false` 预检）写入
- **允许手法**：
  - 使用 \balance 或 \flushend 宏包
  - 手动调整最后一节的分栏断点
  - 微调浮动体位置
- **禁止手法**：`resizebox`、`bare-vspace`、`newpage-abuse`、`tiny-font`、`scriptsize-font`；尤其不许用缩放/缩字号把问题藏起来。
- **语义级改动**：**不允许**，只能改排版参数
- **验收指标**：`column_height_diff_lines` = "<=2"

#### A5 双栏页内列竖向空洞（major（强烈建议））

双栏排版某一页中，左栏或右栏在标题/段落后出现占该栏可排版高度很大比例的连续空白， 且该空白内无正文、无图、无表；而另一栏在相近纵坐标区间仍有连续正文。与末页留白(A2)、 末页栏底不齐(A4)不同，多由跨栏浮动体占位、不当 \\ 或 \\newpage、\\FloatBarrier、 [H] 固定浮动体、\\vfill 等破坏纵向节奏引起。

- **需要页图**：是（必须看渲染页图，不能只读源码）
- **视觉判据**：
  - 将单栏按水平一分为二，分别估计左右栏的「墨迹」纵坐标覆盖；若一栏出现高度 > 栏高 30% 的无墨迹竖带，且相邻上下均有正文块，则高度怀疑
  - 同一纵坐标窗口内，一栏为大片白而另一栏为连续段落（列间密度严重失衡）
  - 节标题（如 Experiments）正下方出现异常大段空白，正文在栏底部才继续
  - 可选自动化：paperfit run scripts/detect_column_void.py（OpenCV 行向墨迹投影，输出 a5_candidates）
- **日志信号**：`LaTeX Warning: Float too large for page`、`Underfull \vbox (badness ...)`
- **阈值**：`min_void_ratio_of_column = 0.3`、`min_void_height_lines = 8`
- **执行**：按本节「允许手法」做一次最小改动，经 `vto_fix`（先 `apply:false` 预检）写入
- **允许手法**：
  - 检查本页及前后页的 figure*/table* 与 \\clearpage、\\FloatBarrier；必要时前移/后移源码中的浮动环境
  - 移除不当的 \\、\\newpage、\\vfill；避免滥用 float 宏包 [H]
  - 微调段落 \\looseness 或局部措辞，使分栏断点避开大块空白（语义手段为最后选择）
- **禁止手法**：`resizebox`、`bare-vspace`、`newpage-abuse`、`tiny-font`、`scriptsize-font`；尤其不许用缩放/缩字号把问题藏起来。
- **语义级改动**：允许（语义微调仅限消除断裂，不引入新结论或数据）
- **验收指标**：`intra_column_void_ratio` = "<0.30"

### B 类 · 浮动体缺陷（Float Placement Defects）

#### B1 浮动体远离首次引用（major（强烈建议））

图表出现在距离其首次被引用的页面过远的位置，读者需翻页查找；或者图表被挤压到异常小的尺寸（如指定 0.98\linewidth 但实际渲染宽度不足栏宽的 50%）

- **需要页图**：是（必须看渲染页图，不能只读源码）
- **视觉判据**：
  - 图表所在页码与首次引用页码差值 >= 2
  - 图表渲染尺寸显著小于源码指定的\linewidth 比例（如指定 0.98\linewidth 但实际宽度不足栏宽 50%）
  - 多个图表被压缩到同一页，导致所有图表尺寸异常偏小
- **日志信号**：`LaTeX Warning: Float too large for page`、`LaTeX Warning: Float too large for column`
- **阈值**：无显式阈值（人工判读）
- **执行**：按本节「允许手法」做一次最小改动，经 `vto_fix`（先 `apply:false` 预检）写入
- **允许手法**：
  - 调整浮动体位置参数为 [htbp]（增加 placement 灵活性）
  - 使用 \FloatBarrier 或\clearpage 控制浮动体边界
  - 微调图表前后正文数量，改变浮动体落点
  - 调整 float placement 参数：\renewcommand{\topfraction}{0.85} 等
  - 必要时将 figure 改为 figure*（跨栏）或反之
- **禁止手法**：`resizebox`、`bare-vspace`、`newpage-abuse`、`tiny-font`、`scriptsize-font`；尤其不许用缩放/缩字号把问题藏起来。
- **语义级改动**：**不允许**，只能改排版参数
- **验收指标**：`float_reference_distance_pages` = "<=1"
- **交叉核对流程**：

```text
第一步：运行源码交叉引用分析
paperfit run scripts/extract_crossrefs.py main.tex --output data/crossrefs.json

第二步：解读输出
- 从 data/crossrefs.json 读取每个图表的首次引用行号 (ref_line) 和图表定义行号 (figure_line)
- 计算源码距离：line_distance = |ref_line - figure_line|
- 若 line_distance < 50 且 section_distance = 0 → 源码组织良好
- 若 line_distance > 100 或 section_distance >= 1 → 源码层面引用与定义相距较远

第三步：结合视觉检测
- 从 PDF 页图或文本层提取图表实际渲染页码与首次引用页码
- 若视觉页码差值 >= 2，记录缺陷
- 若源码距离近但视觉距离远 → 典型 LaTeX 浮动体放置问题（见本节允许手法）
- 若源码距离远且视觉距离远 → 需调整源码结构（移动引用或图表定义）

第四步：尺寸异常检测
- 从页图测量图表实际渲染宽度，与源码指定的\linewidth 比例对比
- 若指定 0.9\linewidth 但实际宽度不足栏宽 50%，或图表被异常压缩 → 标记为 B1-B（placement 异常导致的尺寸压缩）
```

#### B2 浮动体大小不适配栏宽（major（强烈建议））

图片或表格的宽度未充分利用当前栏宽，过窄或过宽；表格使用 \resizebox 暴力缩放导致字号不一

- **需要页图**：是（必须看渲染页图，不能只读源码）
- **视觉判据**：
  - 图表宽度明显小于栏宽（两侧留白过大）
  - 图表超出栏宽导致内容被截断或溢出
  - 表格使用 \resizebox 导致字号不一致
- **日志信号**：`Overfull \hbox (图片相关)`
- **阈值**：无显式阈值（人工判读）
- **执行**：按本节「允许手法」做一次最小改动，经 `vto_fix`（先 `apply:false` 预检）写入
- **允许手法**：
  - 图片设置 \includegraphics[width=\textwidth]
  - 表格使用 tabularx + \textwidth + 弹性 X 列
  - 微调 \tabcolsep 列间距
  - 双栏模板使用 table*/figure* 跨栏
  - 绝对禁止 \resizebox 暴力缩放
- **禁止手法**：`resizebox`、`bare-vspace`、`newpage-abuse`、`tiny-font`、`scriptsize-font`；尤其不许用缩放/缩字号把问题藏起来。
- **语义级改动**：**不允许**，只能改排版参数
- **验收指标**：`float_width_utilization` = ">0.95 且 <=1.0"

#### B3 浮动体连续堆叠（minor（时间充裕时））

连续多个图表堆叠在一起，中间缺少正文间隔，形成'图表页'

- **需要页图**：是（必须看渲染页图，不能只读源码）
- **视觉判据**：
  - 同一页或连续两页出现 >=3 个图表且正文极少
- **阈值**：无显式阈值（人工判读）
- **执行**：按本节「允许手法」做一次最小改动，经 `vto_fix`（先 `apply:false` 预检）写入
- **允许手法**：
  - 分散浮动体位置参数
  - 在图表间插入少量正文
  - 将部分图表移至附录
- **禁止手法**：`resizebox`、`bare-vspace`、`newpage-abuse`、`tiny-font`、`scriptsize-font`；尤其不许用缩放/缩字号把问题藏起来。
- **语义级改动**：**不允许**，只能改排版参数
- **验收指标**：`max_consecutive_floats` = "<=2"

#### B4 浮动体跨页分裂（minor（时间充裕时））

一个图表（特别是跨页的长表格）在不适当的位置断开，跨两页显示

- **需要页图**：是（必须看渲染页图，不能只读源码）
- **视觉判据**：
  - 表格被分页符截断，表头未在第二页重复
- **阈值**：无显式阈值（人工判读）
- **执行**：按本节「允许手法」做一次最小改动，经 `vto_fix`（先 `apply:false` 预检）写入
- **允许手法**：
  - 对于表格，使用 longtable 或 supertabular
  - 调整浮动体大小避免分页
  - 手动控制分页点
- **禁止手法**：`resizebox`、`bare-vspace`、`newpage-abuse`、`tiny-font`、`scriptsize-font`；尤其不许用缩放/缩字号把问题藏起来。
- **语义级改动**：**不允许**，只能改排版参数
- **验收指标**：`float_split_improper` = 0

### C 类 · 排版一致性缺陷（Consistency Defects）

#### C1 表格字号不统一（minor（时间充裕时））

全篇表格使用了不同字号，通常由 \resizebox 或手动 \tiny/\small 滥用造成

- **需要页图**：是（必须看渲染页图，不能只读源码）
- **视觉判据**：
  - 不同表格的字号大小明显不一致
- **日志信号**：`\resizebox 命令的过度使用`
- **阈值**：无显式阈值（人工判读）
- **执行**：按本节「允许手法」做一次最小改动，经 `vto_fix`（先 `apply:false` 预检）写入
- **允许手法**：
  - 移除 \resizebox，重构表格列格式
  - 统一使用 \small 或模板默认字号
  - 确保所有表格风格一致
- **禁止手法**：`resizebox`、`bare-vspace`、`newpage-abuse`、`tiny-font`、`scriptsize-font`；尤其不许用缩放/缩字号把问题藏起来。
- **语义级改动**：**不允许**，只能改排版参数
- **验收指标**：`table_font_size_consistency` = true

#### C2 图片分辨率/风格不一致（minor（时间充裕时））

论文中图片分辨率差异大，或风格（如字体、配色）不统一

- **需要页图**：是（必须看渲染页图，不能只读源码）
- **视觉判据**：
  - 图片模糊、锯齿严重
  - 矢量图与低分辨率位图混用
  - 不同图的配色、线条风格差异大
- **阈值**：无显式阈值（人工判读）
- **执行**：按本节「允许手法」做一次最小改动，经 `vto_fix`（先 `apply:false` 预检）写入
- **允许手法**：
  - 提示用户替换低质量图片
  - 若为矢量图，检查编译方式
  - （本系统不自动重绘图片，仅诊断）
- **禁止手法**：`resizebox`、`bare-vspace`、`newpage-abuse`、`tiny-font`、`scriptsize-font`；尤其不许用缩放/缩字号把问题藏起来。
- **语义级改动**：**不允许**，只能改排版参数
- **验收指标**：`figure_quality_consistency` = true

#### C3 Caption 格式不统一（minor（时间充裕时））

图表标题的字体、间距、编号格式、结尾标点不一致

- **需要页图**：是（必须看渲染页图，不能只读源码）
- **视觉判据**：
  - 有的 caption 加粗，有的未加粗
  - 有的以句号结尾，有的无标点
  - 表格标题位置不一致（有的在上，有的在下）
- **阈值**：无显式阈值（人工判读）
- **执行**：按本节「允许手法」做一次最小改动，经 `vto_fix`（先 `apply:false` 预检）写入
- **允许手法**：
  - 使用 \captionsetup 统一设置
  - 确保所有 caption 命令前后一致
  - 检查并统一标点
- **禁止手法**：`resizebox`、`bare-vspace`、`newpage-abuse`、`tiny-font`、`scriptsize-font`；尤其不许用缩放/缩字号把问题藏起来。
- **语义级改动**：**不允许**，只能改排版参数
- **验收指标**：`caption_format_consistency` = true

### D 类 · 溢出与对齐缺陷（Overflow & Alignment Defects）

#### D1 Overfull hbox（major（强烈建议））

文本行或表格单元格内容超出栏宽，LaTeX 无法自动断行

- **需要页图**：是（必须看渲染页图，不能只读源码）
- **视觉判据**：
  - 内容伸出右边界，可能被截断
- **日志信号**：`Overfull \hbox (pt 值) in paragraph`、`Overfull \hbox (pt 值) in alignment`
- **阈值**：无显式阈值（人工判读）
- **执行**：按本节「允许手法」做一次最小改动，经 `vto_fix`（先 `apply:false` 预检）写入
- **允许手法**：
  - 对于文本：调整断词、引入 \- 连字符、微调句子
  - 对于表格：重构列格式、允许换行
  - 对于公式：改用 align/multline 环境
- **禁止手法**：`resizebox`、`bare-vspace`、`newpage-abuse`、`tiny-font`、`scriptsize-font`；尤其不许用缩放/缩字号把问题藏起来。
- **语义级改动**：允许（仅允许局部微调单词或句子结构）
- **验收指标**：`overfull_hbox_count` = 0

#### D2 长公式未合理断行（major（强烈建议））

过长的数学公式未在多行环境中断行，导致溢出或视觉拥挤

- **需要页图**：是（必须看渲染页图，不能只读源码）
- **视觉判据**：
  - 公式明显超出栏宽
  - 公式在等号处未对齐
- **日志信号**：`Overfull \hbox 在 equation 环境`
- **阈值**：无显式阈值（人工判读）
- **执行**：按本节「允许手法」做一次最小改动，经 `vto_fix`（先 `apply:false` 预检）写入
- **允许手法**：
  - 将 equation 替换为 align、multline 或 split
  - 在运算符处断行并合理对齐
- **禁止手法**：`resizebox`、`bare-vspace`、`newpage-abuse`、`tiny-font`、`scriptsize-font`；尤其不许用缩放/缩字号把问题藏起来。
- **语义级改动**：**不允许**，只能改排版参数
- **验收指标**：`long_equation_overflow_count` = 0

#### D3 URL/长标识符溢出（minor（时间充裕时））

参考文献或正文中的 URL、DOI、长标识符超出栏宽

- **需要页图**：是（必须看渲染页图，不能只读源码）
- **视觉判据**：
  - URL 伸出右边界
- **日志信号**：`Overfull \hbox 在参考文献区域`
- **阈值**：无显式阈值（人工判读）
- **执行**：按本节「允许手法」做一次最小改动，经 `vto_fix`（先 `apply:false` 预检）写入
- **允许手法**：
  - 使用 \url 命令（可自动断行）
  - 在参考文献样式中启用断行
  - 手动添加断行点
- **禁止手法**：`resizebox`、`bare-vspace`、`newpage-abuse`、`tiny-font`、`scriptsize-font`；尤其不许用缩放/缩字号把问题藏起来。
- **语义级改动**：**不允许**，只能改排版参数
- **验收指标**：`url_overflow_count` = 0

### E 类 · 跨模板迁移缺陷（Cross-Template Transfer Defects）

#### E1 单栏↔双栏图表尺寸失配（critical（必须修复））

模板切换后，原为全宽的图表在新模板下尺寸不当（过小或溢出）

- **需要页图**：是（必须看渲染页图，不能只读源码）
- **视觉判据**：
  - 原单栏全宽图在双栏中仍占单栏，显得过小
  - 原双栏跨栏图在单栏中尺寸异常
- **阈值**：无显式阈值（人工判读）
- **执行**：按本节「允许手法」做一次最小改动，经 `vto_fix`（先 `apply:false` 预检）写入
- **允许手法**：
  - 检测图片宽高比，智能决定使用 figure 还是 figure*
  - 将 \textwidth 替换为 \linewidth 或 \columnwidth
  - 重新计算图表尺寸
- **禁止手法**：`resizebox`、`bare-vspace`、`newpage-abuse`、`tiny-font`、`scriptsize-font`；尤其不许用缩放/缩字号把问题藏起来。
- **语义级改动**：**不允许**，只能改排版参数
- **验收指标**：`figure_width_adaptation` = true

#### E2 页数预算不匹配（critical（必须修复））

模板切换后总页数与目标页数相差较大（如 9 页→14 页）

- **需要页图**：否（可用日志/页数判定）
- **视觉判据**：
  - PDF 总页数与目标模板预期不符
- **阈值**：无显式阈值（人工判读）
- **执行**：按本节「允许手法」做一次最小改动，经 `vto_fix`（先 `apply:false` 预检）写入
- **允许手法**：
  - 分析各章节信息密度，计算扩写/缩写弹性
  - 在 Discussion、Related Work 等处进行语义级扩写或精炼
  - 调整图表尺寸和浮动体位置
- **禁止手法**：`resizebox`、`bare-vspace`、`newpage-abuse`、`tiny-font`、`scriptsize-font`；尤其不许用缩放/缩字号把问题藏起来。
- **语义级改动**：允许（优先在非核心章节操作；不引入新实验数据）
- **验收指标**：`page_budget_match` = true

#### E3 模板特定宏兼容性（critical（必须修复））

新模板中使用了已废弃或冲突的宏包、命令

- **需要页图**：否（可用日志/页数判定）
- **视觉判据**：
  - 编译失败或部分内容未渲染
- **日志信号**：`Undefined control sequence`、`Option clash for package`
- **阈值**：无显式阈值（人工判读）
- **执行**：按本节「允许手法」做一次最小改动，经 `vto_fix`（先 `apply:false` 预检）写入
- **允许手法**：
  - 根据新模板文档替换或删除冲突命令
  - 使用条件编译适配不同模板
  - 提供替代宏包建议
- **禁止手法**：`resizebox`、`bare-vspace`、`newpage-abuse`、`tiny-font`、`scriptsize-font`；尤其不许用缩放/缩字号把问题藏起来。
- **语义级改动**：**不允许**，只能改排版参数
- **验收指标**：`compilation_success` = true

## 3. 关于上游技能名

本目录**就是**本插件的修复手册：18 类缺陷的允许手法、禁止手法、阈值与验收指标都在这里。
早期版本把每类缺陷指向 PaperFit 的 7 个技能名（`space-util-fixer` 等），但那些技能从未随本插件注册；0.2.1 起不再指向它们，模型只需读本目录与 `latex-vto-loop`。
## 4. 使用顺序

1. `vto_inspect` 拿页图 + checklist（checklist 里 `thresholds` 就是本目录的阈值）。
2. 对照本目录判断缺陷 id，挑**允许手法**里最不侵入的一条。
3. `vto_fix`（默认 `apply:false`）看 diff 与预检结论；确认后再 `apply:true`。
4. `vto_verify` 复核：任一 `checks` 为 fail 就该回滚，而不是继续叠改动。
