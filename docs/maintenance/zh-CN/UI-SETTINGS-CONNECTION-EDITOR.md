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

只读发现提供保存的记录、五种模式、来源和可用性。候选只填充草稿，不写入或启动。用户确认完整记录后请求宿主 prepare 接口。审阅显示实际候选、忙碌会话、权限、问题、排队消息和未知客户端覆盖范围。忙碌会话区分全服务器与配置目录范围，并显示权限／问题实际检查的目录。上游读取失败保持未知。用户确认对其他客户端的影响后，选择仅空闲时切换或显式停止并切换。刷新清除确认，取消保留草稿。apply 接口负责持久化、重新检查活动及进程替换；编辑器不再通过通用设置写入和重载完成切换。

命令参数每行一个，保留空格和空参数；环境引用采用 NAME=REFERENCE，不保存变量值。活动冲突要求重新审阅，不改变保存意图。启动失败可能发生在持久化之后，发现接口刷新已保存记录但不覆盖草稿。重试和返回上一个连接都重新 prepare 并要求确认，恢复不自动执行。就绪失败时也通过已有归属方刷新共用连接状态。应用成功后退出旧 SDK 绑定，由已有配置归属方重新连接。请求有时限，重复点击共用一次操作；宿主变化使发现、审阅及完成结果失效。语言变化保留草稿和审阅状态。自定义 apply 请求上报已有设置保存状态。

旧 opencodeBinary 编辑器已删除，因为它不能覆盖确认记录；旧值仍作为迁移候选。更新通知和显式配置重启保留既有实现。设置搜索使用 general.opencode-connection，所有端可见，包括 VS Code 的不支持说明。
