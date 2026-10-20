# R3 recovery baseline environment failures

- Initial Node Vitest path `node_modules/vitest/vitest.mjs` was absent in this checkout; Node exited 1 with MODULE_NOT_FOUND. The original output is preserved in `artifacts/int04-web-initial-runner-path-failure.log`. Correct installed entrypoint: `packages/web/node_modules/vitest/vitest.mjs`.
