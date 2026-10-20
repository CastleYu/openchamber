1. 2026-10-12: Reading packages/ui/README.md failed because this package README does not exist in the target worktree. Used packages/ui/src/stores/DOCUMENTATION.md and the repository root README as available documentation.
2. 2026-10-12: An rg invocation used a Unix-style wildcard path with Windows PowerShell; rg rejected it. Re-ran the search with explicit paths and a -g filter.
3. 2026-10-12: An optional read of packages/ui/src/lib/i18n/messages/index.ts failed because no index.ts exists there; the locale modules themselves define the merged dictionaries.
4. 2026-10-12: Focused Bun tests launched in the active sandbox could not read the separately authorized actual worktree (`EPERM` for test files and tsconfig). Rerun the same checks with the minimum scoped escalation.
