# TTS regression diagnosis command note

- Date: 2026-10-11
- Command: `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'vitest|int02-notification-host-regression' } ...`
- Failure: `Get-CimInstance: 拒绝访问` (Access denied).
- Classification: environment/permission limitation during process inventory; no production/test command failure. Do not repeat this CIM query in this task.
- Fallback: the requested focused Vitest run completed successfully. No live handle was available for the previously interrupted run.
