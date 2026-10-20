
## Probe run 2026-10-11T17:53:49.676Z

- Classification: integration probe failure; not a product verdict unless the failed check is independently confirmed after probe correction.
- Fixture: C:\Users\74756\.codex\worktrees\dijiang-next\openchamber\artifacts\int04-native-recovery-qeyR0Y
- Failed check: Error: created server session selected in production editor

## Probe run 2026-10-11T18:00:42.144Z

- Classification: integration probe failure; not a product verdict unless the failed check is independently confirmed after probe correction.
- Fixture: C:\Users\74756\.codex\worktrees\dijiang-next\openchamber\artifacts\int04-native-recovery-OXDDOA
- Failed check: Journey did not return evidence

## Probe run 2026-10-11T18:02:32.382Z

- Classification: integration probe failure; not a product verdict unless the failed check is independently confirmed after probe correction.
- Fixture: C:\Users\74756\.codex\worktrees\dijiang-next\openchamber\artifacts\int04-native-recovery-Reo4kM
- Failed check: Error: permission request card rendered in production DOM

## Probe run 2026-10-11T18:03:38.770Z

- Classification: integration probe failure; not a product verdict unless the failed check is independently confirmed after probe correction.
- Fixture: C:\Users\74756\.codex\worktrees\dijiang-next\openchamber\artifacts\int04-native-recovery-cQiCpT
- Failed check: Error: production composer accepts and clears submitted text

## Probe run 2026-10-11T18:04:25.769Z

- Classification: integration probe failure; not a product verdict unless the failed check is independently confirmed after probe correction.
- Fixture: C:\Users\74756\.codex\worktrees\dijiang-next\openchamber\artifacts\int04-native-recovery-XG6VDo
- Failed check: Error: production composer accepts Enter submission

## Probe run 2026-10-11T18:05:20.883Z

- Classification: integration probe failure; not a product verdict unless the failed check is independently confirmed after probe correction.
- Fixture: C:\Users\74756\.codex\worktrees\dijiang-next\openchamber\artifacts\int04-native-recovery-smpWAG
- Failed check: Error: permission upstream restart failed

## Probe run 2026-10-11T18:06:37.902Z

- Classification: integration probe failure; not a product verdict unless the failed check is independently confirmed after probe correction.
- Fixture: C:\Users\74756\.codex\worktrees\dijiang-next\openchamber\artifacts\int04-native-recovery-iPgq4x
- Failed check: Error: permission upstream restart failed: Unknown message type: test:restart

## Probe run 2026-10-11T18:10:08.094Z

- Classification: integration probe failure; not a product verdict unless the failed check is independently confirmed after probe correction.
- Fixture: C:\Users\74756\.codex\worktrees\dijiang-next\openchamber\artifacts\int04-native-recovery-EIp5V4
- Failed check: Error: permission stale request card disappears from production DOM

### Supplemental evidence, fixture EIp5V4

- After restart acknowledgement, production webview reported connected, but the original Permission Required / Allow Once card remained in the captured production DOM after the 90-second stale-card wait.
- Captured harness transport trace contains successful api:proxy responses and api:sse:chunk frames; request paths, response bodies, timestamps, and stream identity were not retained.
- Official SDK / production proxy permission and question pending counts and post-restart session status were not captured. No count or new-stream claim is inferred.
- Owned VS Code and upstream PIDs exited; a process lookup returned no matching processes.
- Source HEAD and source hashes are recorded in int04-native-recovery-evidence.json.


## Probe run 2026-10-11T18:31:05.101Z

- Classification: integration probe failure; not a product verdict unless the failed check is independently confirmed after probe correction.
- Fixture: C:\Users\74756\.codex\worktrees\dijiang-next\openchamber\artifacts\int04-native-recovery-4L7mhq
- Failed check: Error: permission request card rendered in production DOM

## Probe run 2026-10-11T18:33:39.960Z

- Classification: integration probe failure; not a product verdict unless the failed check is independently confirmed after probe correction.
- Fixture: C:\Users\74756\.codex\worktrees\dijiang-next\openchamber\artifacts\int04-native-recovery-KZTr4d
- Failed check: Error: configured controlled model hydrated

## Probe run 2026-10-11T18:40:29.593Z

- Classification: integration probe failure; not a product verdict unless the failed check is independently confirmed after probe correction.
- Fixture: C:\Users\74756\.codex\worktrees\dijiang-next\openchamber\artifacts\int04-native-recovery-IBEUzY
- Failed check: Error: permission generating state settles or is explicitly interrupted

## Probe run 2026-10-11T18:52:25.255Z

- Classification: integration probe failure; not a product verdict unless the failed check is independently confirmed after probe correction.
- Fixture: C:\Users\74756\.codex\worktrees\dijiang-next\openchamber\artifacts\int04-native-recovery-FCun7x
- Failed check: Error: permission generating state settles or is explicitly interrupted
