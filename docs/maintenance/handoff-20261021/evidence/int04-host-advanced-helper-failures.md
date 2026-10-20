
2026-10-11T17:15:10.062Z | Error: session.prompt: {"error":"unaccepted","profile":"legacy-1.2.27"}
    at body (file:///C:/Users/74756/.codex/worktrees/cdee/openchamber/artifacts/r3-host-advanced.mjs:37:27)
    at file:///C:/Users/74756/.codex/worktrees/cdee/openchamber/artifacts/r3-host-advanced.mjs:113:18
    at process.processTicksAndRejections (node:internal/process/task_queues:105:5) | fixture=C:/Users/74756/.codex/worktrees/dijiang-next/openchamber/artifacts/int04-host-advanced-Nz22XG | checks=exact 1.2.27 binary version verified on isolated loopback,isolated host gate refuses unauthenticated request,session.create ses_ed409eaa5ffeHllY4fBeAWLHh1

2026-10-11T17:16:32.355Z | AssertionError [ERR_ASSERTION]: The expression evaluated to a falsy value:

  assert.ok(body(await client.find.files({directory:dir,query:'r3-probe'}),'find.files').some(file=>file.includes('r3-probe.txt')))

    at file:///C:/Users/74756/.codex/worktrees/cdee/openchamber/artifacts/r3-host-advanced.mjs:142:10
    at process.processTicksAndRejections (node:internal/process/task_queues:105:5) | fixture=C:/Users/74756/.codex/worktrees/dijiang-next/openchamber/artifacts/int04-host-advanced-DRWucE | checks=exact 1.2.27 binary version verified on isolated loopback,isolated host gate refuses unauthenticated request,session.create ses_ed408b32affew0MGaQv0dQR4pQ,session.prompt completed deterministic controlled-model turn,session.command invoked listed command init,session.shell executed isolated echo,session.fork copies full history with new identities and excludes boundary message
