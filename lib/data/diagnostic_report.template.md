# LaTeX 排版诊断报告 — 第 {{ROUND}} 轮

**时间**：{{TIMESTAMP}}
**结论**：{{STATUS_LINE}}

> 本报告由 dsh-latex-studio 的 `vto_report` 生成：所有数字来自 `<workDir>/state.json` 的缺陷台账与本轮门禁记录，缺值时写 `—`，不臆造。

## 1. 编译

- 状态：{{COMPILE_STATUS}}
- 日志错误：{{LOG_ERROR_COUNT}} 条 / 警告：{{LOG_WARN_COUNT}} 条

## 2. 缺陷台账

| 缺陷 | 页码 | 严重度 | 阻断门禁 | 状态 | 证据 | 修复轮次 |
|------|------|--------|----------|------|------|----------|
{{LEDGER_TABLE}}

> 台账是跨轮持久的：`status=fixed` 的条目若在本轮重新变回 `open`，`vto_verify` 会记一条 `ledgerRegression`。

## 3. 缺陷消除进度

| 缺陷类别 | 初始数量 | 剩余数量 | 消除率 |
|----------|----------|----------|--------|
| A 空间利用 | {{A_INIT}} | {{A_REM}} | {{A_PCT}} |
| B 浮动体 | {{B_INIT}} | {{B_REM}} | {{B_PCT}} |
| C 一致性 | {{C_INIT}} | {{C_REM}} | {{C_PCT}} |
| D 溢出 | {{D_INIT}} | {{D_REM}} | {{D_PCT}} |
| E 跨模板 | {{E_INIT}} | {{E_REM}} | {{E_PCT}} |
| **合计** | **{{T_INIT}}** | **{{T_REM}}** | **{{T_PCT}}** |

## 4. 本轮修改

{{CHANGES_SUMMARY}}

## 5. 剩余缺陷

{{REMAINING_DEFECTS_TABLE}}

## 6. 内容完整性

- 受保护内容哈希：`{{PRE_HASH}}` → `{{POST_HASH}}`（{{HASH_STATUS}}）
- 学术词数变化：{{WORD_COUNT_BEFORE}} → {{WORD_COUNT_AFTER}}（{{WORD_COUNT_CHANGE}}）

{{CONTENT_INTEGRITY_ALERT}}

## 7. 门禁判定依据

{{GATE_CHECKLIST}}

**结论**：{{CONCLUSION_LINE}}
