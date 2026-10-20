# INT-05 failure notes

- A combined `apply_patch` did not apply because its expected function signature was stale: the signature had already been changed by the preceding patch. The operation was atomic and made no partial edit. Refresh target context before subsequent patches.
- The first focused Vitest run exposed one stale test assumption: it simulated effective-config provenance by changing `getLegacyConfiguration.providerIds`, which is deliberately no longer compared against a separate SDK snapshot. Update this case to control `compareLegacyProvider.present`, the field now returned alongside comparison from the same SDK response.
- The second focused Vitest run found the unknown-credential guard used the inner outcome string (`unknown`) instead of its owner/provider key because of variable shadowing. Rename the guard key and rerun the focused suite.
- Focused Oxlint flagged a conditional empty object spread while preparing optional baseline input. Replace it with explicit object construction before rerunning static checks.
Focused provider tests failed once after a PowerShell regex replacement expanded the JavaScript template literal. The malformed credentialKey line was repaired; rerunning the focused suite before completion.
