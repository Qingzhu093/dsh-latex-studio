# docs 索引

这个目录里只放**维护者需要**的东西。用户向的内容在仓库根目录的 [README.md](../README.md) 与 [CHANGELOG.md](../CHANGELOG.md)。

| 文件 | 读它做什么 | 状态 |
|---|---|---|
| [INTERFACES.md](./INTERFACES.md) | 模块契约、工具面、参数基准表 | 现行，改动需同步 |
| [ACCEPTANCE.md](./ACCEPTANCE.md) | 可复现的验收命令与判据 | 现行 |
| [HANDOFF.md](./HANDOFF.md) | 架构、维护配方、已知问题、历次修订 | 现行（含历史记录） |
| [P0-PROBES.md](./P0-PROBES.md) | 立项时的环境探针证据（2026-10-10） | **历史**，结论可能已过期 |
| [DESIGN-REVIEW.md](./DESIGN-REVIEW.md) | 设计取舍与目标设计（含被否决方案） | **历史**，读结论看 §1 |
| [paperfit-notes.md](./paperfit-notes.md) | PaperFit 论文要点与资产映射 | **历史参考** |
| [upstream/paperfit/](./upstream/paperfit/) | PaperFit 上游原文（MIT）+ `MANIFEST.json`（逐文件 sha256） | **只读参考**，不随包发布、不注册为技能 |

约定：

- 只读参考与历史文档**不随 npm 包发布**（`package.json` 的 `files` 白名单不含 `docs`）。
- 名词一律用本插件的叫法（`vto_*` 工具、`.latex-studio` 工作目录、`dir`/工程相对等）；引用上游角色时标明它是上游的。
- 文档里禁止写会过期的数字（行数、工具数以外的一切）；工具数/字段数由 `test/docs.test.mjs` 钉住。