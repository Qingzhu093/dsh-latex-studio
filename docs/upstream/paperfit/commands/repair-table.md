# /repair-table — 修复表格

**作用**: 针对所有表格执行修复闭环

## 工具调用约定

验证阶段在论文根目录使用 **`paperfit run scripts/compile.sh`** / **`paperfit render`**，勿假设项目内存在包级 `scripts/`。

## 用法

```
/repair-table
```

## 执行流程

1. 定位所有表格
2. 分析表格溢出问题
3. 重构列格式、调整列间距
4. 重新编译验证

## 调度

- 代码外科医生：`agents/code-surgeon-agent.md`
- 技能：`skills/overflow-repair/`
