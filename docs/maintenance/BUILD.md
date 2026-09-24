# 个人构建与更新策略

## 版本归属

工作区 `package.json` 中的版本继续跟随社区发布。独立的个人修订版本记录在 `packages/web/personal-build.json` 的 `featureVersion` 中，始终使用两个数字层级：`feature.fix`。

- 新功能或重构会递增 `feature`，并将 `fix` 重置为零。
- 优化、错误修复或维护性修正会递增 `fix`。
- 同时包含新功能和修复的版本按新功能递增。
- `feature` 从一开始，`fix` 从零开始。两者都不能带前导零。

由维护者界定功能范围。图表渲染、导出和查看器交互属于现有 DIJIANG 3.x“更多打开方式”功能的扩展，因此此项工作将版本从 `3.4` 提升到 `3.5`，而不是 `4.0`。
- 仅合并社区代码不会重置或递增个人修订版本。

旧版 `DIJIANG.1` 是 `DIJIANG.1.0` 的历史基线。按此规则发布的第一个修复版本为 `1.23.0-DIJIANG.1.1`。后续修复版本依次为 `1.2`、`1.3` 等；下一个新功能或重构版本为 `2.0`。读取器继续接受旧的单层级已安装版本标识，但新构建使用两个层级。

版本标识示例：`1.23.0-DIJIANG.1.1`。CI 使用相同标识，并将运行和尝试次数记录在 `build-info.json` 中，不增加版本层级。SemVer 将此视为预发布标识；更新检查器只比较社区版本部分。构建元数据会记录两个版本，以及可用时的 CI 源提交。

## 本地 Windows x64 构建

使用 `bun install --frozen-lockfile` 安装现有锁文件中的依赖，然后运行 `bun run electron:build`。运行 `node scripts/build-personal.mjs --version` 可查看下一个版本标识，但不执行构建。

该脚本会使用现有的 Web 资源暂存、固定版本的 OpenCode 准备与验证、Electron 打包、原生模块重建和 `electron-builder`。脚本会明确指定 `portable`、Windows x64 和 `--publish=never`。输出位于 `packages/electron/dist/personal/<version>/`，包含一个 `.exe` 和 `build-info.json`。可通过包脚本并明确指定目标来使用 NSIS 安装程序打包；Windows 默认目标为 portable。

此处的 portable 指无需安装步骤即可独立运行的可执行文件。Electron 用户数据和日志、OpenCode 配置仍使用既有的 AppData/home 位置。替换可执行文件时应保留这些数据。当前未实现完整的可移动驱动器数据隔离。

收到本地打包和安装请求时，先部署 portable 发布可执行文件。使用带版本号的目录和指向该可执行文件的快捷方式，保留上一版本构建和现有用户数据，并验证部署后的启动。仅在维护者明确要求时使用 NSIS 安装路径。正式发布不带 `-DEBUG` 后缀，并保持性能诊断关闭。

如需本地诊断版 portable 构建，运行 `node scripts/build-personal.mjs --debug`。此构建保留个人修订版本并追加 `-DEBUG`，例如 `1.23.0-DIJIANG.1.1-DEBUG`。调试版桌面应用会启用现有服务器的 `/api/system/performance/debug` 端点；普通桌面构建对此端点返回 404。CI 保持正常构建参数。

## 操作

`.github/workflows/personal-portable.yml` 会在向 `codex/personal` 推送或手动派发该分支时运行，且仅限 `CastleYu/openchamber`。它使用相同的本地构建脚本、固定版本的 actions、Node 22 和 Bun 1.4.2。构建作业只有只读权限，并将 portable EXE 和元数据作为 Actions 制品保留 30 天；不包含解包后的应用文件。

单独的发布作业具有 `contents: write` 权限。`scripts/publish-personal.mjs` 会检查构建版本、源提交、架构和仅通知策略，创建标签为 `v<personal-version>` 的草稿发布，并上传 EXE、`build-info.json`、完整的 `update-history.md`、其简体中文对应文件 `update-history.zh-CN.md` 以及 `SHA256SUMS.txt`。发布前会检查每个附件的 GitHub 文件大小和 SHA-256。发布说明取自同一源提交中的 `changelog/unreleased.md`。

后续推送会跳过已发布的版本。失败的草稿只能从其原始源提交重试。草稿或标签冲突需要有意递增版本；上传或摘要验证失败时会保留草稿。不会生成 npm 包、更新器清单或修改版本的提交。

社区发布工作流仍受限于社区仓库。获得授权并推送后，应检查个人构建的两个作业和公开发布资源；仅推送成功或构建成功并不能证明发布已经完成。

## 仅通知行为

`packages/web/personal-build.json` 是事实来源，`server/lib/personal-build.js` 负责强制执行。桌面应用只检查 GitHub 发布元数据，并使用有时限的请求。请求失败仍作为错误处理。在个人模式下，它不会要求 electron-updater 下载元数据或制品，也不会安装更新。自动下载和退出时自动安装均保持禁用。

桌面下载/安装 IPC 和待安装重启路径都会拒绝替换。Web 更新安装路由会在调用包管理器或进程操作前返回 403。CLI `update` 会在发现或停止运行实例前拒绝执行。直接运行包管理器也受到保护。共享更新对话框会保留发布说明和发布链接，并将安装控件替换为已翻译的个人构建提示。

OpenCode 自身的更新功能不受 OpenChamber 此替换策略约束；RUN-01 将规定对受管及外部 OpenCode 进程的控制方式。在 OpenChamber 之外手动运行包管理器仍属于明确的外部操作。

## 验证与交接

运行个人更新测试、HTTP/CLI 策略测试、工作区类型检查和 lint、dead-code 检查及真实打包脚本。检查打包应用的启动、版本显示、更新提示和关闭过程，并验证打包的原生模块/OpenCode。将实际结果记录在 [PLAN.md](PLAN.md)；编译成功不等于打包应用已启动，也不等于 Actions 运行成功。

替换过程为手动操作：从已审查的集成版本构建，关闭正在运行的应用，保留先前的可执行文件和数据，然后启动新可执行文件。如果启动后出现回归，关闭新版本并重新打开先前的构建。今后若有持久化数据迁移，在旧版二进制文件使用这些数据前，先审查迁移情况。
