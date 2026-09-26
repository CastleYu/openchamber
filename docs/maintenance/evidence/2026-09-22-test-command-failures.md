# 2026-09-22 针对性测试命令失败记录

本文记录 DIJIANG 3.7 基线运行和针对性复测的情况。记录环境和夹具证据，但不将完整基线描述为全部通过。

## 基线运行

- `node scripts/run-isolated-tests.mjs scripts`：8 个文件中 7 个通过。`scripts/bump-version.test.mjs` 失败，因为版本号更新后的临时夹具打包进了工作区依赖 `1.23.1`，而预期版本是 `1.24.0`。
- `bun run --cwd packages/sdk test`：14 个文件中 13 个通过。`packages/sdk/scripts/examples.test.ts` 报告，仓库已提交的捆绑包哈希与当前 SDK 生成的捆绑包哈希不同。
- `bun run --cwd packages/vscode test`：46 个文件中 43 个通过。报告的三个失败项为 `bridge-git-process-runtime.test.ts`、`managed-opencode-process.test.ts` 和 `gitPathDiff.test.ts`。
- `bun run --cwd packages/web test`：提升权限运行的 Vitest 在首个 90 秒后仍未结束。其日志记录了 settings-helper、lifecycle-process、long-path、SSH install、OpenChamber routes、walkthrough、auth-store、worktree readiness 以及若干零测试/错误套件中的失败。进程会话留给主代理负责处理。

四条命令首次在非提升权限下运行时，均在执行测试前因 Windows `spawn EPERM` 失败。随后使用相同参数，通过限定范围的提升权限运行器重试。日志位于 `.codex-temp/37-*-baseline.log`。

## 针对性复测

三个 VS Code 失败项在相同 Windows 环境中分别重现后，均通过：

- `bun test src/bridge-git-process-runtime.test.ts`：3 项通过，1 项因平台原因跳过。
- `bun test src/managed-opencode-process.test.ts`：4 项通过。
- `bun test src/gitPathDiff.test.ts`：4 项通过。

这表明基线失败可能受到并发负载或子进程争用影响。没有删除任何断言，也没有将任何平台测试改为跳过。

使用已安装的 Bun 重新生成 SDK 示例捆绑包后，针对性测试套件通过：3 个测试、24 项断言。尝试运行 `npx --yes bun@1.4.2 --version` 时，无法使用本地缓存，也没有下载新工具（`ENOTCACHED`）；没有进行全局安装或配置更改。

bump-version 测试仍需要仓库预期的 Bun 1.4.2 行为，或需要修复发布脚本以保留 frozen-lockfile 打包行为。没有静默修改该测试以接受过期的依赖版本。
