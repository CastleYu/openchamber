# 设置连接编辑器中文归档

英文交付依据为 [Settings DOCUMENTATION](../../../packages/ui/src/lib/settings/DOCUMENTATION.md) 中 Requested OpenCode selection、Cold-start profile correction、Confirmed host connection metadata 和 Confirmed connection editor 四节。本文件同步归档这四节的实现约束；注册表其他既有内容仍以英文模块文档为准。进度及验收记录见 [里程碑](OPENCODE-INTEGRATION-MILESTONES.md)。

## 兼容模式选择

opencodeSelection 是实例设置，保存 Auto、OC1、OC2 或 Legacy 1.2.27 的用户意图，不保存探测结果。常量由 lib/opencode/runtime.ts 管理。无效值和缺失值会被丢弃，不替换成默认值。两份生成的宿主设置快照都包含该字段；注册表不绑定全局 store。

General 设置在 Web、Electron、VS Code 和两种移动端使用 OpenCodeModeSettings。读取失败时禁用控件，写入失败保留此前显示的选择。端点变更会重新挂载。宿主在持久化模式变更后淘汰旧身份，客户端通过已有连接检查重新连接，先退出旧 SDK 和同步源，再进行发现。连接失败保留可编辑的已保存选择，并与写入失败分开显示。目录重新加载仍由已有配置所有者负责。

控件订阅既有客户端运行时通知，以所有语言显示服务端版本、确认模式和准入原因。拒绝或未验证的诊断可显示，但不会启用 SDK 操作。重连清除诊断，过时的发现结果不能恢复它。非法状态解析失败；旧描述符没有状态时保持原有发现行为。Legacy 操作仍等待 INT-03 验收。

## 冷启动恢复

主 App 初始化重试耗尽后由 apps/StartupInitializationRecovery.tsx 显示恢复页面，共用模式控件，并保留进程诊断和手动重试。该页面不依赖已准入 SDK 或同步源。应用已经初始化时，保存模式后调用 checkConnection；冷启动时直接调用 initializeApp，由它负责连接检查和配置初始化，不重复探测。成功要求同一运行时所有者下 connected 和 initialized 同时成立。保存后的初始化异常属于连接失败。启动重试次数、端点淘汰和目录加载仍由原模块管理。

Web 和 Electron 主 App 使用恢复页面。VS Code 保留已有设置布局，托管移动端和原生移动端保留既有设置外壳；共用模式控件采用相同冷初始化路径。Electron 目标选择器、认证配对页面和 mini-chat 是独立入口，不增加此页面。React 与回环 HTTP 测试覆盖恢复组合及无项目初始化；真实目录、打包宿主和 IDE 是单独的验收门槛。

## 已确认连接记录

opencodeConnection 是实例级 version-1 有限记录，只支持 external、command、path、configured、bundled 五种模式。注册表和生成宿主快照保留它，但不绑定全局 store，也不自动保存。Web/Electron 宿主负责操作系统路径、环境变量引用、进程所有权和持久化验证。移动端编辑其连接的宿主。

OpenCodeConnectionSettings 在 General 和主 App 初始化恢复页面提供显式编辑器。VS Code 连接管理器接入仍是 INT-02 门槛；发现路由返回 501，编辑器显示不支持且不提供写入控件。opencodeSelection 负责兼容模式意图，与连接记录分别管理。

## 编辑与确认

lib/opencode/connection.ts 管理共用记录 schema、发现响应解析和命令草稿转换，注册表复用该 schema。文件系统、环境引用和进程生命周期只有宿主能够验证。Web、Electron、托管移动端及 Capacitor 客户端填写的路径属于连接的宿主。

只读发现提供保存的记录、五种模式、来源和可用性。迁移候选只填充草稿，不写入或启动。内置推荐只提供信息。用户确认时验证完整记录，通过共用设置持久化，再请求同一宿主重新加载，随后交给已有客户端和配置所有者重新连接。命令参数每行一个，保留空格和空参数；环境引用采用 NAME=REFERENCE，每行一项，不保存变量值。

写入失败保留草稿和原保存记录，不重新加载。启动失败保留已持久化记录，重试不再写设置。已启动连接的变更仍由宿主返回 409，等待串行替换实现。重复点击只有一个进行中的操作。宿主变更淘汰旧发现及完成结果，语言变更保留草稿和保存状态。

旧 opencodeBinary 编辑器已删除，因为它不能覆盖确认记录；旧值仍作为迁移候选。更新通知和显式配置重启保留既有实现。设置搜索使用 general.opencode-connection，所有端可见，包括 VS Code 的不支持说明。

## 本批验收和后续

本批完成编辑、确认和冷恢复。React/HTTP 测试覆盖参数边界、显式确认、重复点击、保存和启动失败、重试、语言切换，以及读取和保存期间的宿主切换。真实 React 控件已在隔离生产宿主上确认并启动 OC2 2.0.20，保存记录和备份，完成现有客户端初始化。宿主会话增删查及自有进程退出通过。

仍需完成活动连接串行替换、VS Code 管理器接入，以及真实 IDE、打包桌面和移动端验收。OC1 托管插件启动、Legacy、真实 CAgent、模型对话和附件未由本批证明。CA-02 已发布版本保持冻结。

每轮 goal 完成一个依赖完整的批次，包含实现、必要回归和适用的真实运行验收、英文与中文同步文档、审查、本地提交和实时配额检查。批次按接口或模块契约划分，不以文件数划分，也不为填满一轮而扩大产品需求。保留既定配额停止阈值和发布边界。
