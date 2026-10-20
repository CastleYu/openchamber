
Environment command notes: UI has no package README; discover paths before reading. Helper scripts live in cdee/artifacts, logs in dijiang-next/artifacts. Do not read helper paths from the target checkout.

rg does not expand Windows glob arguments for absent locales paths; query the discovered i18n directory directly.

Initial extraction left the old import in App; corrected it. Initial type-check began before this correction and must be rerun. DOM setup retains inherited directory-store startup logs, including pre-resolver relative fetch; no real-server claim. Cold recovery now calls initializeApp directly, avoiding a redundant preliminary health probe.

Oxlint ignores artifacts baseline copies, yielding non-JSON "No files found". Compare temporary HEAD copies alongside their owning source files, then remove only those exact files. All build/test processes were terminal before this narrow rerun.
