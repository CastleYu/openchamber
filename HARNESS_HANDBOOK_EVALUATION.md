# Harness Handbook 对 OpenChamber 的适配与效果评估

评估日期：2026-07-28—2026-07-31  
目标仓库：当前 OpenChamber 工作区快照  
被评估工具：[Ruhan-Wang/Harness_Handbook](https://github.com/Ruhan-Wang/Harness_Handbook)，`main` 提交 `98d4db1457ce562acc51aa4b72eed7bee9548b2b`（2026-07-24）

## 结论

Harness Handbook 的“行为导向代码地图 + 渐进式定位”思路适合 OpenChamber 这类多运行时、跨包仓库，但当前实现不适合直接接入本仓日常开发流程。

本次真实运行表明：

- 静态 Phase 1 在修复依赖/API 兼容问题后速度快，7.25 秒可扫描 1038 个受支持文件，并生成可审计的 JSON、CSV、DOT 和 dropped-call 清单。
- 它能提供较好的 TypeScript/TSX 文件内符号清单与源码定位，适合作为 UI 局部阅读的辅助索引。
- 它完全忽略本仓 410 个 `.js` / `.mjs` / `.cjs` 文件；其中约 330 个位于 `packages/web`、39 个位于 `packages/electron`。这会直接漏掉 OpenChamber 服务端、CLI 和桌面主进程的大量关键实现。
- TypeScript 调用图虽然记录了 5034 条内部边，但只有 18 条跨文件内部边。导入函数通常被归类为 boundary，React JSX 组件关系也没有形成可用调用链，因此“沿调用关系发现所有受影响位置”的核心收益在本仓上大幅削弱。
- 按 README 的无版本约束安装方式不能开箱运行。最新版 `tree-sitter 0.26.0` 先触发 Python Node API 不兼容，兼容后又发生原生访问冲突；回退 `tree-sitter 0.25.2` 并修正 Node accessor 后才成功完成扫描。
- 用户配置 OpenAI-compatible API 并明确授权源码外发后，Phase 2a 已真实完成：1038/1038 个受支持文件生成中文 deep card，严格复核得到 1038 张可解析卡片、1 张空用途卡片、4977 个函数条目，其中 2739 个（55.0%）获得 purpose/data-flow/relations 语义注释。
- Phase 2b/2c/3 和 planner 尚未完成：Phase 2b 还会把文件路径、函数签名/调用关系、中文卡片和 stage critic 上下文等源码派生数据发送到外部模型。当前安全审核要求对这部分派生内容取得独立明确授权，因此本报告此刻仍是阶段性结论。

阶段性综合评分：**4.5 / 10（当前版本直接用于 OpenChamber）**。该分数会在 Phase 2b/2c/3 和 planner 定位题完成后按端到端证据更新。若先补齐 JavaScript、TypeScript 跨文件导入解析、依赖锁定和过滤能力，再用本仓真实变更集做 A/B 验证，预期才有进入 7/10 以上实用区间的可能。

## 评估范围与方法

Harness Handbook 官方流程包含：

1. Phase 1：静态解析并构建函数/边界/调用图，不调用 LLM。
2. Phase 2：逐文件生成 card、推导 stage skeleton、分配和组织文件，需要 LLM。
3. Phase 3：生成 overview、stage 页面、state registers 和可选 HTML，需要 LLM。
4. Helper：把 handbook 包装成 planner skill，让只读代理定位变更位置。

官方仓库目前已经移除原有 eval/scoring/baseline 代码，只保留 handbook planner 和 resync。因此，仅调用当前仓库本身不能自动复现“有 handbook 与无 handbook”的效果对照，需要另建固定任务集和 baseline runner。该现状与官方 [README](https://github.com/Ruhan-Wang/Harness_Handbook) 的说明一致。

本次执行了以下工作：

- 下载指定仓库 `main` 的独立临时副本，未引入 OpenChamber 依赖。
- 按 README 安装 `tree-sitter` 与 `tree-sitter-language-pack`，记录开箱失败。
- 分别用 `tree-sitter 0.26.0` 和 `0.25.2` 复现并隔离兼容性问题。
- 在临时副本中应用最小 Node API 兼容修改，完成 TypeScript 和 `--lang auto` Phase 1。
- 使用用户配置的外部模型端点，以 `deep`、中文、逐文件批次和断点续跑模式完成 Phase 2a；对工具自身宽松的 coverage 结果另做严格内容复核。
- 统计 Phase 1 的文件覆盖、函数、边、丢弃调用、图连通性和关键符号样本。
- 用真实源码文本搜索复核 `runtimeFetch`、`switchRuntimeEndpoint` 等关键 API 的 graph caller 结果。
- 对照论文实验范围，判断其公开结果能否外推到 Windows + TypeScript/React + JavaScript 混合仓库。

所有生成物和第三方依赖均位于：

```text
C:\Users\74756\AppData\Local\Temp\harness_handbook_eval
```

OpenChamber 仓库内仅新增本报告，没有修改产品源码、依赖或配置。

## 真实执行结果

### 安装与兼容性

| 场景 | 结果 | 观察 |
| --- | --- | --- |
| README 无版本约束安装，`tree-sitter 0.26.0` | 失败 | 首个 Shell 文件即报 `tree_sitter.Node` 没有 `kind` |
| 临时兼容 `kind/type`、`start_position/start_point` 后继续使用 0.26.0 | 失败 | 解析 `packages/ui/src/apps/mobileConnections.ts` 时发生 `0xC0000005` 原生访问冲突 |
| `tree-sitter 0.25.2` + Node accessor 兼容 | 成功 | 1035 个 TS/TSX 文件完整扫描，约 6.4 秒 |
| 同一兼容环境下 `--lang auto` | 成功 | 1038 个文件完整扫描，约 7.25 秒 |

当前 README 只写了 `pip install tree-sitter tree-sitter-language-pack ...`，没有 lockfile 或已验证版本组合。对需要稳定生成和持续 resync 的工具而言，这是明显的可运维性风险。

### Phase 1 指标

| 指标 | 结果 |
| --- | ---: |
| 扫描文件 | 1038 |
| `.ts` | 721 |
| `.tsx` | 314 |
| `.sh` | 3 |
| 内部函数节点 | 4977 |
| boundary 节点 | 1114 |
| 输出调用边 | 8511 |
| 丢弃调用 | 14432 |
| 受支持源码体量 | 14.44 MiB |
| 测试文件进入扫描 | 182（17.5%） |
| Phase 1 用时 | 7.25 秒 |

### Phase 2a 深读指标

| 指标 | 结果 |
| --- | ---: |
| 工具 coverage | 1038/1038，missing=0 |
| 可解析文件卡片 | 1038 |
| 有文件用途与详细描述 | 1037 |
| 空用途/描述卡片 | 1（`packages/ui/src/components/ui/text.tsx`） |
| 静态函数条目 | 4977 |
| 带 purpose/data-flow/relations 的函数条目 | 2739（55.0%） |
| 卡片 JSON 总体积 | 约 6.51 MiB |
| 24 worker 断点续跑主段 | 35 分 58 秒（962 个待处理文件） |
| 空卡片精确重试 | 14 张中补齐 13 张，约 55 秒 |

Phase 2a 的 `_coverage.json` 把“LLM 返回了该文件的结果对象”视为 described，并不校验用途或详细描述是否非空。产物曾在后续续跑中漂移到 12 张空卡片；2026-07-31 再次用 `--resume` 精确重试后补齐 11 张，最终 `text.tsx` 因静态图识别为 0 函数、超长回退又没有函数可分块而为空。这也说明文件 coverage 对模型输出质量不敏感，必须另做内容检查。

函数级语义覆盖同样不能从文件 coverage 推导。所有 4977 个静态函数事实仍保留签名、行号和图关系，但只有 2739 个获得模型撰写的用途、数据流和关系说明。因此 Phase 2a 达成了接近完整的文件级叙述，不等于完整的函数级行为理解。

在共 22943 个被观察到的调用中，8511 个进入 graph，14432 个进入 dropped audit，后者占约 62.9%。丢弃项以 `local_var_method` 为主，这在 React hooks、store、回调和对象方法密集的代码中很常见。

### 仓库覆盖

基于 `rg --files` 的当前工作区统计：

| 文件族 | 数量 | Harness Phase 1 |
| --- | ---: | --- |
| TypeScript / TSX | 1046 | 扫描 1035；11 个 `.d.ts` 按适配器规则跳过 |
| JavaScript / JSX / MJS / CJS | 410 | 全部未扫描 |
| Shell | 3 | 扫描 3 |
| Markdown / MDX | 439 | 未扫描 |
| JSON | 90 | 未扫描 |
| Swift | 5 | 未扫描 |

“每个文件都有 leaf、覆盖由构造保证”的说法只对适配器发现到的受支持源码成立，并不等于整个 OpenChamber 仓库。对于本仓，未覆盖的 JavaScript 恰好集中在关键运行时边界：

- `packages/web`：OpenChamber server、CLI、managed/external OpenCode lifecycle、路由和服务端集成。
- `packages/electron`：Electron main/preload、IPC、打包和原生能力。
- `packages/vscode`：部分 extension host/runtime bridge JavaScript。

这意味着任何跨 UI、server、desktop 或 VS Code bridge 的变更，都可能得到结构完整但事实不完整的 handbook。

## 调用图质量复核

### 跨文件关系不足

Phase 1 共有 5034 条解析到内部节点的边，其中只有 18 条连接不同文件，约占 0.36%。另有 2537 条边以“import-like boundary”形式出现，其中 1556 条带 `@/` 或相对路径形态。

TypeScript adapter 对导入标识符的调用直接生成 boundary，而不是尝试解析为仓库内部函数。因此，即使目标函数已经存在于同一 graph 中，调用方也不会连接到它。这个限制不是单纯的 Windows 路径问题，而是当前适配器的解析策略。

### 关键 API 抽样

| 符号 | 真实源码文本匹配 | 涉及文件 | Graph 记录的 callers |
| --- | ---: | ---: | ---: |
| `runtimeFetch(` | 326 | 90 | 0 |
| `switchRuntimeEndpoint(` | 43 | 11 | 0 |
| `createRelayTunnelClient(` | 7 | 5 | 0 |

例如 graph 能准确定位 `packages/ui/src/lib/runtime-fetch.ts` 中的 `runtimeFetch` 声明，并能记录该函数内部调用的若干 helper；但它无法从该节点回溯到 90 个使用文件。对于“修改 Runtime API 鉴权/URL/重试行为后找出全部消费者”这类 OpenChamber 高频任务，BGPD 的 call-relation expansion 会失去关键证据。

React/TSX 还存在额外天然损失：JSX 组件组合、hook 间的数据依赖、callback 传递、store selector 和事件订阅并不等价于普通函数调用。仅依靠当前函数调用图无法还原 OpenChamber 的运行时行为链。

## 正面效果

尽管不适合直接全面接入，Phase 1 仍有明确价值：

- **速度快且确定性强**：千级 TS 文件在数秒内完成，无 LLM 成本。
- **源码定位可信**：函数名、签名、文件和行号来自静态解析，抽样位置准确。
- **不猜测未知目标**：无法解析的调用进入 dropped audit，便于审计，而不是伪造内部边。
- **输出形式实用**：`graph.json`、`functions.csv` 和 `graph.dot` 可供后续自定义分析或可视化。
- **文件内关系有帮助**：同文件 helper、self method 和部分类型化方法关系可用于局部代码阅读。
- **理念与本仓痛点匹配**：OpenChamber 的 runtime、sync、relay、desktop、mobile 等行为确实跨目录和状态边界，行为导向地图比纯目录树更有潜力。

最适合的当前使用方式是“局部 TypeScript 符号索引和审计素材”，而不是“全仓变更影响面的权威地图”。

## 论文结果与本仓结果的边界

论文在 Codex（Rust，2267 个源文件）和 Terminus-2（Python，6 个源文件）上评估，共使用每仓 30 个行为变更请求。论文报告：

- Codex 的 handbook-assisted 总体胜率比 baseline 高 10.0 个百分点，planner token 降低 12.7%。
- Terminus-2 的总体胜率高 18.9 个百分点，planner token 降低 8.6%。

这些结果支持方法本身的潜力，详见 [论文 HTML](https://arxiv.org/html/2607.13285v1) 和 [arXiv 摘要](https://arxiv.org/abs/2607.13285)。但不能直接外推到当前 OpenChamber：

- 论文评估语言是 Rust 和 Python，没有覆盖 TypeScript/React、JavaScript 混合仓库。
- 论文环境没有证明当前代码在 Windows + 最新 Python tree-sitter 组合下可运行。
- Codex 论文样本有 159960 条 resolved edges；本仓当前输出只有 8511 条边，且跨文件内部边仅 18 条。
- 本次没有完整 handbook 和同模型 A/B planner 结果，所以 4.5/10 是工程适配评分，不是对论文方法有效性的否定，也不是规划质量的统计显著性结论。

## 分项评分

| 维度 | 得分 | 说明 |
| --- | ---: | --- |
| 安装与复现 | 1 / 5 | README 安装组合失败，无依赖锁定 |
| TypeScript 文件内提取 | 4 / 5 | 定位和局部函数边较好 |
| 全仓语言覆盖 | 2 / 5 | 关键 JavaScript 运行时完全缺失 |
| 跨文件行为定位 | 1 / 5 | 仅 18 条跨文件内部边，关键 API caller 为 0 |
| 输出可审计性 | 4 / 5 | graph、CSV、DOT、dropped audit 完整 |
| 成本可控性 | 2 / 5 | Phase 1 很低；完整生成至少数百万输入 token，缺少本仓过滤策略 |
| 与 OpenChamber 架构匹配 | 2.5 / 5 | 理念匹配，多运行时实现覆盖不匹配 |

## 建议的接入条件

不建议现在把生成的 handbook 作为 OpenChamber 代理的正式导航依据。若继续试点，建议依次完成：

1. **锁定可运行依赖**：增加 requirements/lock 与 Windows smoke test，修正 Python Node accessor；至少覆盖 Python 3.12、`tree-sitter 0.25.2` 的已验证组合。
2. **补 JavaScript adapter**：覆盖 `.js`、`.mjs`、`.cjs`，优先验证 `packages/web`、`packages/electron`、`packages/vscode`。
3. **解析内部 import**：结合 `tsconfig` paths、相对路径、package exports，把仓库内部导入函数连接为 internal edge，而不是 boundary。
4. **补 React 行为关系**：至少表达 JSX 组件引用、hook 调用、store selector、事件订阅和 Runtime API 调用。
5. **增加扫描过滤**：支持 include/exclude/glob，默认排除测试、locale 大文件、生成资产或允许分层建册。当前 182 个测试文件和多份大型翻译表会明显增加 LLM 成本与 stage 噪声。
6. **先做小规模完整生成**：选择 `packages/ui/src/lib/runtime-*`、`packages/ui/src/sync` 与对应文档作为限定范围，确认 card、stage、register 的事实准确性后再扩大。
7. **建立 OpenChamber A/B 基准**：从真实历史变更中选 10–20 个 Query、Cross-file、Search-hostile 请求；固定模型、提示词、预算和只读权限，比较文件/符号 Recall、Precision、F1、Wrong、计划质量和 token。
8. **设权威边界**：即使接入，handbook 只能作为导航缓存；AGENTS、最近的 `DOCUMENTATION.md`、包 README 和当前源码仍必须作为最终权威来源。

## 最终判断

Harness Handbook **值得作为研究型试点继续观察，但不值得在当前状态直接投入完整 OpenChamber 全仓生成成本**。

当前最合理的决策是：保留本次 Phase 1 证据，不把临时 patch 或第三方依赖引入仓库；先向上游修复运行兼容、JavaScript 覆盖和 TypeScript import 解析，再以 OpenChamber 真实变更集做受控 A/B。只有在跨文件 Recall 明显提升且 token/维护成本可接受时，才将其包装为本仓正式 skill 或持续 resync 流程。
