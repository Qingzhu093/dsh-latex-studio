# /adjust-length — 调整页数

**作用**: 尝试通过排版微调或语义改写逼近目标页数

## 工具调用约定

编译、渲染、日志解析等统一见 `CLAUDE.md`「系统架构与运行时边界」：**`paperfit render`**、**`paperfit run scripts/…`**。

## 用法

```
/adjust-length
```

## 执行流程

1. 分析当前页数与目标页数的偏差
2. 若超页：压缩浮动体、精炼文字、缩减参考文献
3. 若不满页：扩写结论/讨论、微调图表尺寸
4. 语义干预仅在排版手段用尽后使用

## 调度

- 语义润色：`agents/semantic-polish-agent.md`
- 技能：`skills/space-util-fixer/`、`skills/writing-polish/`
