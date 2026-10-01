# Original maintainer request (verbatim)

Preserved 2026-09-16. This file quotes the maintainer's own words. Do not edit,
translate, reformat or "clean up" the quoted text, including grammar slips and
duplicated numbering. [DEV-PLAN.md](DEV-PLAN.md) is the interpreted plan; if the
two ever disagree, this file wins.

## Request 1, the development plan

````text
开发计划文件：

1. MCP优化大版本
2. 交互优化大版本
2.1 侧边栏大写显示优化
2.2 更新提示改为基于对应DIJIANG版本仓库的更新提示
2.3 工作中显示优化：对话框显示一个呼吸效果
2.4 添加新的项目优化
3. opencode对接优化
3.1 解耦对接模块，令其未来可以更好地接入其他的agent server
3.2 令OpenChamber对接opencode的行为完全通过UI显式可控，而不是需要配置环境变量，也不进行任何未指定的降级策略；具体来说：
3.2.1 对接server模式：
3.2.1.1 对接外部server模式，通过输入指定端口号和ip来对接制定opencode-like server
3.2.1.2 内启动管理server模式，通过配置的的opencode-like cmd路径来启动server并自动探测其output中的ip:port进行连接，仅一个server实例；
3.2.2 原生模式：按当前默认的启动模式，但是：
3.2.2.1 系统path模式：直接利用系统path的opencode
3.2.2.2 指定cmd模式：使用指定路径配置的的opencode-like cmd
3.2.3 内置模式：使用内置的opencode
（其中部分为当前逻辑的细化，请你结合代码补充说明）
3.3 server模式下，"重新加载opencode"的操作改为向server发送dispose请求
3.4 右键菜单追加中文翻译
3.5 在对话标题处常态显示当前分支名
3.6 创建新会话时，可以主动点击刷新当前分支以让用户明确确定当前分支，避免其他程序中切换分支但是OpenChamber没有更新导致用户误判
3.7 让快捷键的提示在hover tips中展示
4. 第三方平台解耦大版本：对所有第三方平台进行解耦，目的同样是为了未来替换对接其他的平台，解耦后两侧接口各自留下门面层；
5. 内置工具大版本：对内置的开发工具（例如自动发现等功能）进行整体的优化、增强、以及非原生opencode的opencode-like的cmd的支持
````

## Request 2, explicit control instead of silent fallbacks

````text
我的要求是取消所有静默回退的功能，让所有行为都显式指定，当然，后续也可以让用户自己配置回退策略，但是要求有空间进行完全显式控制
````
