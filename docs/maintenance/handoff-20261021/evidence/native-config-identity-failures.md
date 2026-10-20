# Native config identity validation notes

- The first focused Web lifecycle run timed out the path-mode case at its existing 15-second per-test limit after adding a real managed restart. The restart started a replacement process; the timeout came from insufficient test budget. Increased this lifecycle case timeout to 35 seconds before rerunning.
- The main VS Code type-check attempt used the guessed workspace filter @openchamber/vscode and failed with No packages matched the filter. The package name is openchamber; run the package type-check script from packages/vscode instead. A read of a nonexistent legacy-config.d.ts also failed; discover declaration paths before reading.
