# /migrate-template — 跨模板排版迁移

**作用**: 将论文从原模板迁移至目标模板，自动处理图表尺寸、页数、宏兼容性等问题

## 工具调用约定

闭环中的编译与页图渲染使用 **`paperfit run scripts/compile.sh`**（或 `latexmk`）与 **`paperfit render`**，见 `CLAUDE.md` 运行时边界一节。

## 用法

```
/migrate-template
```

## 执行流程

1. 加载模板配置（`config/templates.yaml`）
2. 替换 `\documentclass` 和宏包
3. 调用 `template-migrator` 处理图表和兼容性
4. 启动 VTO 闭环（Category E 优先）
5. 输出迁移报告

## 调度

- 执行器：`agents/orchestrator-agent.md`
- 技能：`skills/template-migrator/SKILL.md`
- 任务类型：`template_migration`
