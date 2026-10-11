---
name: latex-daily
description: 日常 LaTeX 编译门控与参考文献审计（A 线）。当任务是生成、修改、修复 .tex/.bib（论文、报告、公式、表格、参考文献），需要"真编译过再交付"时使用。配套工具：latex_doctor / latex_build / latex_lint / bib_tool。
---

# LaTeX 日常编译线（A 线）操作守则

**核心原则：没有编译通过的 LaTeX 不算写完。** 不要一次生成整篇再检查，要小步改、每步编译。

## 0. 本机环境事实（不要凭记忆假设）

| 事实 | 说明 |
|---|---|
| MiKTeX 是**唯一必需件** | 装在 `D:\MiKTeX`；同时自带引擎、biber/bibtex、chktex、**pdftoppm/pdfinfo（Poppler 24.04）**、**mgs.exe（Ghostscript 9.25）** |
| **latexmk 不可用** | MiKTeX 的 latexmk 是 Perl 脚本，本机无 Perl。`latex_build` 自己做多趟驱动，**不要**尝试调 latexmk |
| 页图通道 | ① poppler（MiKTeX 自带）② miktex-ghostscript（mgs）③ read_pdf（会上传，非必要不用） |
| 路径 | 工具入参一律**工作区相对路径**；绝对路径与 `..` 会被拒绝。工作路径含空格与中文是正常的 |

先跑一次 `latex_doctor` 拿到真实环境，再动手。

要确认本地页图通道真的可用（验收标准 3），跑：

```
latex_doctor({ verifyPdfRead: true, pdfPath: "latex-demo/main.pdf" })
```

期望 `renderProbe.status='ok'`、`backend='poppler'`、`bytes>0`。默认 `verifyPdfRead:false` 时只报存在性，不渲染。

## 1. 标准循环（每一轮都必须完整走完）

1. `latex_doctor` —— 确认引擎/biber 可用（缺件会给出安装命令）。
2. 小步改一处（一个段落 / 一张表 / 一个公式）。
3. `latex_build({ dir, entry })` —— 默认自动判定引擎；全部产物落在 `<dir>/.latex-studio/`（`build/` 放 PDF 与日志，`auxfiles/` 放 .aux/.bbl 等辅助文件）。**不要**在项目根建 `build/`、`aux/`：`aux` 是 Windows 保留设备名，会让复制/打包失败。
4. 看返回：
   - `status: "passed"` → 继续；
   - `status: "failed"` → **只看 `errors[0]`**（后面的多半是连锁反应），按 `file:line` 定位；
   - `status: "skipped"` → 外部件缺失，把 `advice` 原样告诉用户，**不要**假装编译过。
5. `latex_lint({ dir, entry })` —— 查伪修复、引用/标签对账、图-引用距离。外部 chktex 通道是**可选增强，默认关闭**（`config.enableChktex: true` 才跑）；返回值 `external.chktex` 三态：`used` / `skipped`（开关关）/ `unavailable`（找不到 chktex）。
6. 需要时 `bib_tool` —— 见 §3。
7. 改完再编译，最多 5 轮；仍失败就把日志尾部交给用户，不要瞎猜。

编译产物：`<dir>/.latex-studio/build/<entry>.pdf`、`<dir>/.latex-studio/auxfiles/<entry>.log`（MiKTeX 把 .log 放在辅助目录）。

## 2. 错误速查

| 日志 | 含义 | 处理 |
|---|---|---|
| `! Undefined control sequence.` + `l.23` | 宏包没引或命令拼错 | 补 `\usepackage` 或改拼写 |
| `File \`x.sty' not found` | 缺宏包 | MiKTeX 会带 `--enable-installer` 自动装；不行就 `mpm --install=x` |
| `! Missing $ inserted` | 数学符号跑到文本模式 | 补 `$...$` |
| `Overfull \hbox ... too wide` | 溢出 | 改列宽/断行，**不要** `\resizebox` |
| `Citation ... undefined` | 引用键不在 .bib 或没跑 bib | `bib_tool action=audit` 对账，再重新编译 |
| `Label(s) may have changed. Rerun` | 需要再跑一趟 | `latex_build` 会自动多趟，不用手点 |

## 3. 参考文献纪律

- **绝不编造文献**。只允许使用已存在于 .bib、或经 `bib_tool action=fill` 从 Crossref 取回的真实条目。
- 写引用前先 `bib_tool({ action: "audit", bib: "refs.bib", tex: ["main.tex"] })`，确认没有 `CITED_NOT_IN_BIB`。
- `format` / `fill` 默认**只预览**（`write: false`）；确要写回才传 `write: true`。
- 结构不完整（缺右括号）时**拒绝写入**并返回 `PARSE_INCOMPLETE`：先修结构，再写。
- 写回会先备份为 `<file>.bak`；写入后再校验，失败自动回滚。

## 4. 编辑纪律（禁止伪修复）

- **改一行，不要重写一节**：整节重生成会顺手改掉无关数值、引用和措辞。
- 一次只动一个语义单元。
- 不碰用户没让改的数值、结论、引用键。
- 禁用伪修复：`\resizebox` 暴力缩表、裸 `\vspace` 硬撑、`\tiny`/`\scriptsize` 缩字号、乱加 `\newpage`。`latex_lint` 会把它们标成 critical/major。
- 表格用 booktabs，列格式显式写；宽表先想 `tabularx`；公式优先 `amsmath`。

## 5. 交付前检查单

- [ ] `latex_build` 最近一次是 `passed`，且 `pages` 合理。
- [ ] `errors` 为空；overfull/underfull 已评估（不是每个都要修，但不能不知道）。
- [ ] `latex_lint` 无 critical/major（info 级 orphan-label 可以接受）。
- [ ] `bib_tool audit` 没有 `CITED_NOT_IN_BIB`；未引用条目已确认。
- [ ] 受保护项（引用键/标签/数字）没有被顺手改掉。
