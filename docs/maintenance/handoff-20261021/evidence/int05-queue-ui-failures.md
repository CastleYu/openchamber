- 2026-10-13: packages/ui/README.md was absent. File discovery confirms no package README; use nearest stores/composer DOCUMENTATION.md.
- Locale delegate corrected PowerShell parser/prefix verification errors, then verified all 130 keys. No product command or dependency change involved.
- 2026-10-13: batching Bun local/server/React queue tests leaked existing mock.module fixtures and produced 10 local-suite failures. Run each file in a fresh Bun process.
- 2026-10-13: scoped PowerShell text replacement failed because the multiline anchor did not match CRLF formatting; no files were changed by that command. Switched to apply_patch for the exact test insertion.

- Read of guessed locale path failed; discovered actual messages/en.ts. A read of an absent actual-root helper also returned exit 1; helpers are in cdee/artifacts.

- Dialog DOM test exposed missing global requestAnimationFrame in the happy-dom harness; supplied browser-bound DOM animation/layout globals.

- A PowerShell read used Bash brace expansion and failed parsing; corrected to rg directory/glob. Reads of not-yet-created static logs failed; use completed-check inventory before reading logs.

- Expected focused Oxlint failure: removed the new redundant test assertion; final run retains four pre-existing helper/persistence diagnostics. A no-match rg status 1 is not an environment failure.
