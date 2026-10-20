# R2 write foundation scope

- Web: production host kernel and session metadata routes admit minimum Legacy writes. Generic proxy and UI remain unaccepted.
- Electron: same in-process host implementation; packaged UI acceptance remains open.
- Hosted mobile: uses selected host implementation; shared UI remains unaccepted.
- Capacitor mobile: uses selected host, without a local process or shell change.
- VS Code: explicit Legacy refusal remains until its bridge and UI acceptance.

Next phase: connect the shared facade, proxy, metadata projections and event transport
to exact Legacy, then validate UI+host conversation and VS Code forwarding. Preserve
existing OC1/OC2 behavior. R2 remains open until those workflows pass.
