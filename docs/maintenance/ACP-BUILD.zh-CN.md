# ACP 便携包构建

ACP 集成版本来自 `CastleYu/openchamber` 的 `codex/acp-integration` 分支。独立的[工作流](../../../.github/workflows/acp-portable.yml)会在推送后构建 Windows x64 便携包。手动运行默认只构建；勾选 `publish` 才会将通过校验的制品发布为 GitHub 预发布版本。

## 本地构建

用 `bun install --frozen-lockfile` 安装锁定的依赖，然后运行：

```sh
node scripts/build-personal.mjs --acp --version
node scripts/build-personal.mjs --acp
```

版本格式为 `<upstream>-DIJIANG.<feature.fix>-ACP.local`，例如 `2.0.4-DIJIANG.4.0-ACP.local`。CI 将 `local` 替换为 `<run_number>.<run_attempt>`，每次尝试都有独立版本。添加 `--debug` 可为本地诊断包追加 `-DEBUG`。

脚本复用个人构建的 Web 资源暂存、固定版本 OpenCode 准备与校验、Electron 打包、原生模块重建及便携包生成。EXE 和 `build-info.json` 输出到 `packages/electron/dist/acp/<version>/`。元数据记录 ACP 通道、源提交和仅通知更新策略。

## 发布与替换

工作流只允许个人仓库的 ACP 分支发布。`scripts/publish-acp.mjs` 校验下载制品的身份，创建标签为 `v<version>` 的草稿，上传 EXE、元数据和 `SHA256SUMS.txt`，并校验 GitHub 上的文件大小与 SHA-256。随后以 `prerelease=true`、`make_latest=false` 发布。

上传或校验失败时保留草稿。重新运行工作流会使用新版本构建并发布下一次尝试。稳定个人版工作流和社区更新源保持现有行为。

替换便携包前关闭正在运行的应用，保留上一版 EXE 和现有 AppData/OpenCode 数据。回退时关闭 ACP 版本，再打开上一版 EXE。便携包使用现有应用数据目录；ACP 后缀用于区分构建制品和发布标签。

## 检查

```sh
node --test scripts/acp-build.test.mjs scripts/publish-acp.test.mjs scripts/build-personal.test.mjs packages/electron/personal-updates.test.mjs
```

工作流还会在打包前执行工作区类型检查。Actions 构建成功可验证打包过程；应用启动和 ACP Agent 交互需要使用生成的 Windows EXE 验证。

2026-10-14 本地验证已生成 Windows x64 的 `2.0.4-DIJIANG.4.0-ACP.local`（171,635,242 字节）。SHA-256：`f1602aed154e46e54a6dc2c0d5769909515c321248f86a7c1775fc7dd95b146a`。生产 Web 资源已通过本地 ACP 模拟 Agent 的对话与审批流程；尚未启动打包后的 Electron 应用进行验收。本地构建没有源提交标识，发布时由 CI 提供该标识。

[English](ACP-BUILD.md) · [个人构建策略](BUILD.md)
