# CAgent 契约参考生成器

## 离线命令包及最终候选制品

```sh
bun scripts/cagent/bundle-kit.mjs --out /local/new-kit --json
node /local/new-kit/protected/scripts/cagent/verify-kit.mjs --kit /local/new-kit --digest <owner-digest> --json
bun scripts/cagent/finalize-adapter.mjs --workspace /local/workspace --kit-digest <workspace-digest> --node /absolute/path/to/node --out /local/new-artifact --json
```

命令包包含七个独立命令、69 份生成参考、双语 START-HERE 文件及项目／Zod／TypeScript 许可证。它将已安装依赖打包为 ESM，拒绝剩余的非 Node 内置模块导入，不复制本地 API 输入、凭据或候选文件。维护者另行提供验证过的 Node 和 Bun 可执行文件。新目录测试在工作树之外、不含 `node_modules` 的环境中执行映射接收、准备、子进程夹具及最终组装。测试证明当前 Windows 工具链，不能证明其他操作系统或本地模型。

打包路径保留工作进程及参考文件布局。准确的 `protected/` 清单由校验树外的 `control/manifest.json` 覆盖。通过独立渠道传递预期摘要，并保护整个包不被候选写入。如果维护者允许替换校验命令，命令不能验证自身真实性。已有输出在构建前即被拒绝。构建失败不创建输出；写入失败保留不完整目录，不发布最终清单。此包提供可执行命令流程，仍未完成全部 CA-02 交付：文档提取、声明式代码生成、扩展模板、模型校准及目标权限尚待落实。

最终组装读取保护注册表，以原生持久化修正上限重新检查每项注册任务，并将捕获且通过检查的字节一起打包。随后在新的有界子进程中，对组合适配器执行每项操作的保护夹具。多个工厂组合后的行为不一致会阻止发布。命令不将候选进度报告当作验收证据。

新输出包含 `artifact/adapter.mjs`、`control/manifest.json` 及 `report.json`。清单准确覆盖加载器制品目录，最后以原子重命名发布。报告记录工具包／候选／制品摘要及固定夹具结果。全部 22 项能力保持未验证，启用保持不可用。使用宿主批准写入器前须独立审阅并保护验收证据。写入失败保留不完整输出供检查；解决原因后选择新目录。设置失败与候选失败保持区分。这些命令不调用真实操作。

```sh
CAGENT_TEST_NODE=/absolute/path/to/node bun test scripts/cagent/bundle-kit.test.mjs scripts/cagent/finalize-adapter.test.mjs
```

Windows 应先设置进程环境变量 `CAGENT_TEST_NODE` 再运行 Bun。

## 受保护夹具检查及适配器组装

`fixture-checks.mjs` 校验宿主自有的版本 1 夹具定义，包含操作 ID 及唯一案例。每个案例提供规范输入、身份、有序请求／响应或传输失败交换，以及预期中立结果或固定失败。执行前使用应用运行时解析器检查输入／输出。宿主提供工厂加载入口，该入口接收任务运行器捕获的候选源码。

每项检查创建新的处理器，比较每次传输请求、身份及转发的取消信号。错误或额外请求即使被候选捕获异常，仍判失败；所有预期交换都必须被消费。预期投影还要准确比较，因此跨作用域结果不能仅凭 schema 通过。文档规定的后端失败必须保持失败。夹具构造／加载失败是检查设置错误，不是操作语义失败证据。案例 ID 是须由环境内维护者审阅的报告标识。

`adapter-assembly.mjs` 使用已安装的 Bun 构建器和 TypeScript 解析器，在内存中打包捕获的单文件操作模块。不读取候选路径，构建时不执行候选工厂。源数量／字节遵循任务限制，拒绝重复及未知操作，输入顺序规范化。每个模块只能导出 `createOperation`；拒绝解析出的导入及 `require`／`eval` 标识符。构建器仅解析自有的虚拟模块清单，注释按注释解析。这是文件依赖约束，不是 JavaScript 沙箱，不能证明任意候选代码安全。

输出仅包含一个异步 `createAdapter` 工厂，创建新的处理器，保持全部能力未验证。宿主生成准确制品清单后，可通过现有制品加载器加载。组装返回源码字节及摘要，不修改运行时选择、证据或批准。

```sh
node --test scripts/cagent/fixture-checks.test.mjs
bun test scripts/cagent/adapter-assembly.test.mjs scripts/cagent/fixture-workspace.test.mjs
```

组合测试使用真实临时文件、打包、保护快照校验及原生检查点持久化。它拒绝不发请求却返回合理数据的候选，接受修正后的投影，从磁盘恢复，保留三次失败上限，并拒绝保护夹具篡改。这些合成测试不能证明真实 CAgent API。完整工具包仍需落实环境权限、文档接收、冻结的可执行宿主组合、扩展模板、校准及真实验收。

## 有界任务检查命令

维护者以操作 ID 为键提供经过审阅的版本 1 夹具定义。`--fixtures` 要求准确覆盖 mapping-ready 操作，校验规范输入及预期输出，并将每项定义冻结在保护快照中。不提供此参数时，准备过程保留仅含语法检查的任务元数据。

```sh
node scripts/cagent/prepare-packets.mjs --catalog /local/reviewed-catalog.json --mapping /local/candidate-mapping.json --fixtures /local/reviewed-fixtures.json --out /local/new-workspace --json
bun scripts/cagent/check-packet.mjs --workspace /local/new-workspace --operation getSession --node /absolute/path/to/node --kit-digest <owner-recorded-digest> --json
node --test scripts/cagent/fixture-process.test.mjs
```

操作 ID 使用生成任务中的值。显式 Node 可执行文件须支持 `--permission`，当前实际测试版本为 Node 24.9.0。Bun 执行宿主命令及组装器。宿主从准备报告取得工具包摘要，并将其保存于候选写权限之外。候选清单或报告不能提供批准。

命令校验保护清单，捕获唯一允许的处理器，在不执行其工厂的情况下组装，然后在新的子进程中运行夹具。Windows 子进程仅继承 `SystemRoot` 和 `WINDIR`，其他平台使用空环境。拒绝文件写入、子进程和工作线程；读取权限包括当前工作树及解析后的依赖目录。默认期限为 5 秒，`--timeout` 可设为 10 至 30000 毫秒。输入最多 1 MiB，合并输出最多 64 KiB。超时或输出超限触发强制终止，宿主等待进程关闭后才报告。

启动握手将权限功能缺失或设置失败与候选失败区分。设置失败不消耗修正次数。候选组装失败、夹具失败、超时、损坏输出或启动后的异常退出计为失败。原生进度在命令重启后保留三次失败上限。JSON 报告仅含固定检查及案例 ID，不含原始候选异常或 API 文档。通过不能授予能力或启用许可。

权限模型减少意外的进程访问，不能证明网络隔离或恶意代码沙箱。参见 [Node 权限模型](https://nodejs.org/download/release/v24.21.0/docs/api/permissions.html)。目标维护者仍须落实保护文件只读、进度／批准的独立权限，以及所需的执行／网络策略。夹具预期须依据本地 API 文档审阅；schema 校验不能证明这些语义。

## 候选任务包准备

```sh
node scripts/cagent/prepare-packets.mjs --catalog /local/reviewed-catalog.json --mapping /local/candidate-mapping.json --out /local/new-workspace --json
node --test scripts/cagent/packet-plan.test.mjs scripts/cagent/prepare-packets.test.mjs
```

准备过程复用严格映射接收，为每个 mapping-ready 操作生成一个任务包。任务包含英文目标、七项证据维度、引用的端点／文档元数据、当前 schema 及双语参考。候选编辑范围仅为 `candidate/<operation>/handler.mjs`。生成的工厂在实现前以 unverified 拒绝执行。固定注册清单保持全部 22 项能力未验证。不推断或调用任何 API 路由。

保护快照位于 `protected/`，准确文件清单最后写入校验树外的 `control/manifest.json`。候选文件有意不纳入该快照。清单是指纹，不是验收或启用许可。目录名和所有者权限模式本身不能证明 Windows ACL 隔离；完整工具包仍须落实候选和宿主的独立写权限。

命令要求输出为现有规范父目录下的新目录。已有输出会被拒绝，不作修改。写入失败保留部分目录，报告 `workspace-incomplete`，不发布最终清单；保留现场检查，修正原因后使用新目录。输入复用每份 1 MiB 的有界读取器。全部模式不交互；JSON 输出仅包含数量、摘要和固定错误，不包含私有路径或 API 文档。`--quiet` 输出一行简要结果。

生成的检查命令默认只是语法检查元数据；提供审阅过的夹具后，改为有界语义检查命令。准备过程本身不执行候选代码。检查命令组装临时单操作适配器以执行夹具，不发布最终多操作制品、不授予能力，也不实现模型校准、扩展任务包、离线安装或真实验收。这些仍属 CA-02／CA-03。最终适配器须打包辅助代码，不能引用候选工作目录。

## 映射接收

`mapping-intake.mjs` 比较维护者核准的本地端点目录与弱 Agent 提交的操作映射。输入分开存放：目录位于候选代码可写工作区之外。schema 检查不能证明路由来自文档，也不能证明维护者已经审阅。环境内维护者必须先核对 API 文档，再使用本工具。

```sh
node scripts/cagent/check-mapping.mjs --catalog /local/reviewed-catalog.json --mapping /local/candidate-mapping.json --json
node --test scripts/cagent/mapping-intake.test.mjs scripts/cagent/check-mapping.test.mjs
```

只读命令必须提供两个路径，支持 `--quiet`，使用 `--json` 时只输出一个 JSON 对象。不提示输入，不写文件。每个输入限制为 1 MiB。设置、解析及一致性错误返回固定代码并以非零退出。报告不含源路径、API 定义、自由文本问题及原始异常。覆盖报告仍包含操作、端点和动作 ID；从私有环境导出前，环境内维护者须审阅报告。

映射失败包含固定检查 ID 和下一步动作，能够安全定位时还包含规范操作 ID。功能行列出缺失的必需操作及备选依赖分支。全部未解决的清单可以通过结构接收，但所有功能仍被阻止；此处零退出不代表适配器可用。

版本 1 的目录记录修订号、文档 ID／修订号／摘要／章节 ID，以及端点 ID、文档规定的方法／路径、请求／响应引用、影响类型和引文。端点使用相对 API 路径，不包含服务器地址或凭据。版本 1 的映射同时绑定目录修订号和规范摘要。全部 22 个操作分别记录为映射、带引文的明确缺失／不兼容，或未解决问题。映射行列出核准的端点、声明式／自定义 codec 选择，以及传输、认证、作用域、结果、失败、完成和取消的引文。每个端点还要归入共享操作、扩展或范围外；共享映射的双向引用必须一致。

编译器拒绝缺失行、未知 ID、无效章节、过期目录内容、矛盾引用及不匹配的读取／变更影响。候选功能就绪状态由应用自有依赖规则计算。所有功能和扩展的可用性保持 false。`mapping-ready` 和 `candidate-ready` 是工作流程结果，不是运行时支持或验收。表单／动作／结果扩展仍需独立候选实现与验收；其他交互需要宿主开发。

目录指纹使用解析后的 JSON，递归排序对象键，保留数组顺序。内容变化后，即使修订号不变，也要重新审阅并绑定映射。本组件不提取 OpenAPI／自然语言文档、不生成处理器、不实现 codec、不运行真实检查，也不暂停已经启用的适配器。这些责任仍属于完整 CA-02 工具包及宿主启用流程。

## 操作参考

本文件是[英文交接文档](../../../scripts/cagent/DOCUMENTATION.md)的中文审查副本，最终交接前同步维护。

此维护者工具为每个中立操作生成一份英文页和一份中文页、一份机器可读 schema／样例文件，另生成两个索引及参考清单。它导入当前操作常量、输入／输出解析器和功能依赖规则。`operation-reference.mjs` 负责已审查的双语语义及合成样例，不含真实 CAgent API 映射。

使用工作树已安装的依赖和 Node.js 22 或更新版本。以下命令不需要网络或服务器。这是可执行的参考生成步骤，并非独立离线工具包安装器。

```sh
node scripts/cagent/build-contracts.mjs --write --json
node scripts/cagent/build-contracts.mjs --check --json
node --test scripts/cagent/contract-pages.test.mjs
```

默认命令检查现有参考。`--write` 重新生成仓库内 `docs/maintenance/cagent-contracts` 及 `docs/maintenance/zh-CN/cagent-contracts` 下的固定文件，不删除额外文件。过时参考须通过已审查的源修改移除；存在额外条目时，生成和检查命令均失败。`--check` 与 `--write` 互斥。未知参数和位置参数在写入前失败。

全部模式均不交互。默认及 `--quiet` 输出一行简要结果。`--json` 只输出一个 JSON 结果，失败也遵循此规则。文件缺失、变化或出现额外条目时，以 `reference-stale` 返回非零；其他设置／生成失败以 `reference-generation-failed` 返回非零。报告仅包含数量、参考摘要及固定错误码，不含 API 文档、凭据或原始异常文字。写入失败可能留下部分重新生成的文件；交付前重新生成并要求检查通过。

生成页列出必需／可选的顶层输入字段、操作语义、有效输入／结果、被拒绝的结果和相关功能 ID。JSON 文件保留完整结构 schema。权限选项和消息 part ID 唯一性等运行时细化检查无法完全由生成的 schema 表达。受保护验收仍须使用运行时解析器，并验证作用域、请求构造及文档语义。夹具有效不能证明真实 CAgent 支持。

清单对其他 68 份生成文件的准确 UTF-8 内容计算哈希，再对有序文件／哈希列表计算汇总摘要。它只是参考指纹，并非适配器制品清单、应用修订、独立证据、批准记录或启用许可。完整 CA-02 工具包须同时固定应用、工具链、任务定义、受保护夹具及参考摘要。

架构负责人重新生成并审查这些文件。环境内弱 Agent 只接收指定操作页、该操作的 schema、已审查 API 摘录及允许修改的候选任务包。参考文件不在候选写权限内。参考生成及独立映射接收命令不能替代任务包生成、模型校准、扩展模板、可执行工具包安装或隔离真实检查；这些仍属 CA-02 待完成工作。

Web、Electron、托管移动端和 Capacitor 在宿主验收后可使用相同中立契约。本生成器不改变运行时行为或功能可用性。VS Code 保持不支持的 Agent 命名空间。参考生成不修改 OpenCode／Legacy 代码路径或发布制品。
