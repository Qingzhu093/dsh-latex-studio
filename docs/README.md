# docs 索引

这个目录里只放**维护者需要**的东西。用户向的内容在仓库根目录的 [README.md](../README.md) 与 [CHANGELOG.md](../CHANGELOG.md)。

| 文件 | 读它做什么 | 状态 |
|---|---|---|
| [INTERFACES.md](./INTERFACES.md) | 模块契约、工具面、参数基准表 | 现行，改动需同步 |
| [ACCEPTANCE.md](./ACCEPTANCE.md) | 可复现的验收命令与判据 | 现行 |
| [DEVELOPMENT.md](./DEVELOPMENT.md) | **维护者总入口**：架构、工具面、配置、环境、维护配方、排错、已知债，外加历史记录（原 HANDOFF/DESIGN-REVIEW/P0-PROBES 已合并于此） | 现行 |
| [upstream/paperfit/](./upstream/paperfit/) | PaperFit 上游原文（MIT）+ `MANIFEST.json`（逐文件 sha256） | **只读参考**，不随包发布、不注册为技能 |

约定：

- 只读参考与历史文档**不随 npm 包发布**（`package.json` 的 `files` 白名单不含 `docs`）。
- 名词一律用本插件的叫法（`vto_*` 工具、`.latex-studio` 工作目录、`dir`/工程相对等）；引用上游角色时标明它是上游的。
- 文档里禁止写会过期的数字（行数、工具数以外的一切）；工具数/字段数由 `test/docs.test.mjs` 钉住。