# R2 read foundation scope

- Web: generation-bound host read operations admitted; generic proxy and shared UI still refuse Legacy.
- Electron: same in-process host read foundation; packaged UI remains unaccepted.
- Hosted mobile: selected host read foundation; shared UI remains disabled.
- Capacitor mobile: selected host read foundation; no local process or new shell behavior.
- VS Code: explicit Legacy refusal retained until the R2 bridge implementation and validation.

Mutations, metadata persistence, streaming, shared UI and native forwarding remain subsequent R2 work. Default-model lookup remains OC2-only; Legacy selection uses the existing catalog. Exact 1.2.27 read validation does not pass the complete R2 conversation gate.

Command discovery corrections: packages/ui has no package README; its applicable module documentation is used. The SDK factory is in client.ts, not a separate sdk.ts. Discover paths before future reads.
