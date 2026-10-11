# /check-visual — 执行视觉检测

**作用**: 仅执行视觉检测，输出诊断报告，不修改源文件

## 工具调用约定

可执行脚本在 **`paperfit-cli` 包内**；在**论文项目根目录**执行：`paperfit render …`、`paperfit run scripts/parse_log.py …`；勿假设项目内有 `scripts/render_pages.py`。兜底：`npx paperfit-cli …`、`python3 "$(paperfit root)/scripts/…"`。

## 用法

```
/check-visual
```

## 执行流程

1. 编译 PDF（如需要）→ 在论文根目录执行 **`paperfit render <输出pdf路径> --output data/pages`**（脚本在全局安装的 `paperfit-cli` 包内，勿使用用户项目下的 `scripts/render_pages.py`）
2. 规则引擎检查编译日志
3. 排版侦探基于 VTO 分类体系识别缺陷
4. 输出结构化诊断报告

## 输出

- 缺陷列表（类别、页码、严重等级、描述）
- 修复建议
- 不修改任何源文件

## 调度

- 规则引擎：`agents/rule-engine-agent.md`
- 排版侦探：`agents/layout-detective-agent.md`
