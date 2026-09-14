# Local installation, 2026-09-11

Installed `1.23.0-DIJIANG.1` from the current working tree, including the restored personal occupancy and walkthrough changes. This is not a clean-commit release artifact.

- Installer: `packages/electron/dist/install-dijiang-1/OpenChamber-1.23.0-DIJIANG.1-win-x64.exe`, 173,734,978 bytes. NSIS exited 0.
- Destination: `C:/Users/74756/AppData/Local/Programs/@openchamberelectron`.
- Previous program directory backed up to `packages/electron/dist/backup-installed-20260911`. User configuration and session directories were not deleted.
- Web resources, Electron main bundle and OpenCode CLI 1.18.30 verification passed.
- Used the existing Windows native modules instead of recompiling against the unavailable Visual Studio Spectre libraries. An actual PTY launched and exited successfully under Electron 43.3.0 before packaging.
- Windows installation registration reports `1.23.0-DIJIANG.1`. The installed executable, launched with isolated test data, returned the same version through its desktop bridge, mounted the Performance control and returned HTTP 200 with seven related processes.
- Test output: `Temp/installed-dijiang-check/result.json`. Build/package logs: `Temp/install-dijiang-*.log`.

PowerShell launches GUI executables asynchronously; wait on their process rather than treating an immediate shell return as test completion. The native test host retained library handles after PTY exit and was stopped only after its executable path and dedicated script command line were verified. CIM inspection required scoped escalation. For ripgrep patterns beginning with `--`, place the argument terminator before the pattern.
