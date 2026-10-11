# PaperFit 排版诊断报告 — 第 {{ROUND}} 轮

**时间**：{{TIMESTAMP}}
**状态**：{{STATUS_LINE}}

## 编译摘要

- 编译状态：{{COMPILE_STATUS}}
- 日志错误数：{{LOG_ERROR_COUNT}}
- 日志警告数：{{LOG_WARN_COUNT}}

## OpenCV 列空洞（A5 机检摘要）

> 本段由 `orchestrator` 在**页图渲染成功后**对双栏任务自动运行 `detect_column_void` 后，根据 `data/state.json` 的 `artifacts` / `cv_signals_summary` 填写。

- 机检报告路径：`{{COLUMN_VOID_REPORT}}`
- A5 候选条数：**{{CV_A5_COUNT}}**
- 涉及页码：**{{CV_A5_PAGES}}**

### 按页摘要（来自 `cv_signals_summary.by_page`）

{{CV_BY_PAGE_MARKDOWN}}

*说明：上表为行向墨迹投影结果，须与逐页 VLM 核对后再写入正式 `defects`；若未运行机检（单栏任务），填「本栏不适用」。*

## 缺陷消除进度

| 缺陷类别 | 初始数量 | 剩余数量 | 消除率 |
|----------|----------|----------|--------|
| A 空间利用 | {{A_INIT}} | {{A_REM}} | {{A_PCT}} |
| B 浮动体 | {{B_INIT}} | {{B_REM}} | {{B_PCT}} |
| C 一致性 | {{C_INIT}} | {{C_REM}} | {{C_PCT}} |
| D 溢出 | {{D_INIT}} | {{D_REM}} | {{D_PCT}} |
| E 跨模板 | {{E_INIT}} | {{E_REM}} | {{E_PCT}} |
| **合计** | **{{T_INIT}}** | **{{T_REM}}** | **{{T_PCT}}** |

## 本轮修改摘要

{{CHANGES_SUMMARY}}

## 剩余缺陷（若状态为 CONTINUE）

{{REMAINING_DEFECTS_TABLE}}

## 内容完整性验证

> 本节由 `quality-gatekeeper` 根据 `code-surgeon-agent` 提供的 `pre_repair_snapshot.json` 和 `post_repair_validation.json` 填写。若本轮不涉及修复，填「本栏不适用」。

- 修复前学术内容哈希：`{{PRE_HASH}}`
- 修复后学术内容哈希：`{{POST_HASH}}`（{{HASH_STATUS}}）
- 学术词汇数量变化：{{WORD_COUNT_BEFORE}} → {{WORD_COUNT_AFTER}}（{{WORD_COUNT_CHANGE}}%）
- 关键章节检查：
  - Abstract：{{ABSTRACT_STATUS}}
  - Conclusions：{{CONCLUSIONS_STATUS}}
- 内容变更详情：{{CONTENT_CHANGE_DETAILS}}

{{CONTENT_INTEGRITY_ALERT}}

## 质量门禁判定依据

{{GATE_CHECKLIST}}

**结论**：{{CONCLUSION_LINE}}