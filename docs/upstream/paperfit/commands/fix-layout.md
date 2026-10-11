# /fix-layout — 启动完整 VTO 排版优化

**作用**: 对当前 LaTeX 项目执行完整的视觉排版优化（VTO）闭环

## 工具调用约定

可执行脚本在 **`paperfit-cli` 包内**；在**论文项目根目录**执行，勿假设仓库里自带可运行的 `scripts/`：页图用 `paperfit render <pdf> --output data/pages`，其它用 `paperfit run scripts/<文件> [参数…]`；无全局命令时用 `npx paperfit-cli …` 或 `python3 "$(paperfit root)/scripts/…"`。

## 用法

```
/fix-layout
```

## 执行流程

0. **画像（推荐）**：若用户尚未用 `/paperfit` 建立 `data/paperfit-portrait.yaml`，可先提示执行 **`/paperfit`** 完成问卷与扫描；若已存在画像，**每轮门禁结束或本轮 tex/pdf 更新后**执行 `paperfit run scripts/paperfit_portrait.py refresh` 刷新扫描项与 `state.task.portrait_*`。
1. 识别主 `.tex` 文件（`data/benchmarks/case/*.tex`）
2. 初始化或加载 `state.json`（双栏论文建议：`paperfit run scripts/state_manager.py init main.tex --column-type double`；若已由 `/paperfit` 写入栏型，以 `state.json` / 画像为准）
3. 编译 PDF → 渲染页图 → **双栏任务**下按 `orchestrator-agent` 自动执行 `detect_column_void` + `state_manager.py column-void` 写入机检摘要
4. 规则引擎检测编译日志错误
5. 排版侦探基于 VTO 分类体系检测视觉缺陷（合并 `machine_signals` 与 VLM）
6. 代码外科医生执行修复
7. 重新编译 → 质量门禁验收（诊断报告用 `config/diagnostic_report.template.md`）
8. 迭代至 DONE 或达到最大轮次

## 状态管理

- 每轮迭代前自动备份 `data/benchmarks/case` 目录
- 更新 `data/state.json` 状态
- 生成诊断报告 `diagnostic_report_round*.md`

## 调度

- 主调度器：`agents/orchestrator-agent.md`
- 任务类型：`full_vto`
