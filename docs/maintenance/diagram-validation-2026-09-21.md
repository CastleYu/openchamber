# Diagram and sidebar validation — 2026-09-21

This record covers the DIJIANG sidebar/diagram implementation and the
follow-up audit after interrupted work. It is not a release or installation record.

The subsequent requested portable release is DIJIANG 3.5, classified by the
maintainer as part of the existing 3.x feature. Its actual packaged-launch
acceptance is recorded in [PLAN.md](PLAN.md#local-acceptance-dijiang-35-2026-09-21).
That later acceptance supersedes this record's earlier desktop-packaging gap;
the original scroll-performance and mobile/installed-extension limits remain.

## Dark mode and interaction follow-up

The dark application palette initially gave Mermaid edges and node borders too
little contrast. They now use the muted foreground token; before/after screenshots
were inspected. All nine Mermaid styles were rendered in a dark application.
Explicit light palettes keep their own light backgrounds. PlantUML sequence and
class diagrams already rendered with light text/lines and dark surfaces; no
additional inversion was needed.

Both diagram types were exercised through the public Markdown wrappers:
click/open-preview, plain wheel zoom in the expanded viewer, left-button dragging,
right-click menu, fit/reset, and source/image downloads. Fit restored the original
viewBox after zoom and pan. Ctrl+N/Ctrl+P moved between menu items. File-link context
menus still worked. A FilesView PlantUML preview without a chat popup callback
opened its own large viewer and downloaded PNG and `.puml` from its context menu.
Neither inline nor expanded diagrams display zoom buttons. Inline normal wheel
scrolling remains available to the conversation.

Visual evidence: `.codex-temp/diagrams-qa/mermaid-dark.png` (before contrast fix),
`mermaid-dark-fixed.png`, `plantuml-dark.png`, and `plantuml-dark-menu-final.png`.
The focused viewer/renderer suites passed 44 tests, and UI type/lint checks passed.
The Web production build passed. The completed dead-code report has no finding
for the new DiagramMenu component. This follow-up's production build/dead-code
logs use the `interactions-` prefix.

## Gaps found and fixed during the follow-up audit

1. Disabling stream animations made the Markdown pipeline appear settled while
   the response was still streaming. Native Mermaid and PlantUML could therefore
   run before completion. `MarkdownRendererImpl.tsx` now passes the actual stream
   state separately from animation state. A component regression test covers the
   animation-disabled branch and the transition to a settled error/source view.
   Browser verification observed three pending diagrams, zero SVG diagrams and no
   diagram engine module request during streaming; all three rendered on completion.
2. PNG rasterization loaded an SVG blob URL. VS Code's existing image CSP permits
   data URLs but not blob images. Applying that policy in Chrome reproduced an
   `EncodingError`. `diagramExport.ts` now uses an SVG data URL. With the same
   policy, Mermaid and both PlantUML fixtures produced decodable PNGs. No CSP was
   broadened.

## Chain coverage

| Chain | Evidence |
| --- | --- |
| Style selector → store → profile registry → server sanitizer → generated web/VS Code settings | Nine accepted styles; registry parse/apply and server round-trip checks; invalid/missing server values preserve the live selection; regenerated snapshots were byte-identical. A browser reload retained Forest. |
| Settings discovery and localization | Chat page/search anchor matches the control; field, aria label and nine options exist in all 12 settings locales. |
| Chat fences → renderer → viewport | Mermaid, `plantuml` and `puml` rendered through actual shared components. Earlier browser acceptance covered all nine styles. |
| Stream completion and obsolete work | Component regression plus deferred-engine tests cover the animation-disabled branch, cancellation, source replacement, removal and reuse. |
| Render failure → visible source | Invalid diagrams retain source and show a localized error; a failed diagram does not discard another successful diagram. External PlantUML includes remain unsupported. |
| Inline PlantUML → expanded chat preview | Clicking the inline diagram opened the actual `ToolOutputDialog`; the popup retained the PlantUML language and rendered its labels. |
| File recognition → edit → save → preview → fullscreen | Actual `FilesView` with a synthetic Files API loaded `.puml`, saved edited source and displayed the updated diagram in preview and fullscreen. Helper tests cover `.puml`, `.plantuml`, `.pu` and safe Markdown fencing. Per-file mode and dirty/stale-load guards were reviewed. |
| Diagram → SVG/PNG/source download | Chrome saved Mermaid PNG, PlantUML PNG/SVG and `.puml`; source content was inspected. PNG uses the original SVG rather than the zoomed viewport. |
| Shared browser download → Electron download | An isolated, hidden Electron 43.3.0 window with a temporary profile rendered the actual component fixture and saved four files successfully. The existing application/profile was not opened or changed. |
| Directory poll → unchanged listing → state publication | The state setter returns the old object for an equivalent listing. A 1,000-entry, 100-refresh test retained one list identity with zero replacements. Ordering and each render field still invalidate. This measures a helper/state contract, not chat FPS. |

## Checks against the final implementation

- All workspace type checks passed.
- Eight isolated UI test files passed: 89 tests. The focused web Mermaid sanitizer
  test also passed: one test, 54 unrelated tests intentionally skipped.
- Focused ESLint passed for the renderer, its component regression and export
  helper. Oxlint passed for the new engine, deferred-rendering, export, source and
  file-list helpers.
- Web and VS Code webview production builds passed, including lazy diagram
  engine chunks. Build warnings include large chunks, existing font references
  and Viz.js's browser-externalized Node `url` import.
- Settings registry regeneration produced no changes to either generated snapshot.
- `git diff --check` passed. `AGENTS.md` has exactly one deleted line: the rule
  requiring an explicit dependency request.
- Earlier frozen-lockfile installation passed. The dead-code report was inspected;
  its two engine-export findings refer to methods used through the injected,
  dynamically loaded engine module in `deferredDiagrams.ts`.

The full workspace lint check still fails on the pre-existing unused
`currentFilePath` in `packages/ui/src/components/sections/logs/LogsPage.tsx`.
The broad settings helper suite also has unrelated Windows npm-spawn and existing
registry-fixture issues; only the focused new sanitizer case is claimed above.

## Local evidence

Task-local artifacts are under `.codex-temp/diagrams-qa/`:

- `tests-closure.log`, `settings-closure.log`, `type-check-closure.log`
- `web-closure-build.log`, `vscode-closure-build.log`
- `electron-closure.json`, `electron-closure.log`, `electron-*.png`,
  `electron-plantuml.svg`, `electron-source.puml`
- `closure-mermaid.png`, `closure-plantuml.png`, `closure-plantuml.svg`,
  `closure-source.puml`

The browser fixture uses real shared components with synthetic file persistence.
It has no application backend, so its expected API 404s are not a clean-console
or full live-server acceptance result. The Electron check validates native
Chromium rendering/downloads against that fixture, not a packaged application.

## Remaining acceptance boundaries

The reported sidebar scroll jank was not reproducible. The listing optimization
removes a specific unnecessary state update, but a same-scenario before/after FPS
improvement has not been established. No claim is made that the original jank is
fully resolved.

VS Code was built and its image CSP was exercised in a browser; an installed
extension, mobile devices and a rebuilt portable desktop application were not
tested. No release, commit, installation or replacement was performed. PlantUML
uses local DOM/canvas rendering and bundled themes; it is not a Web Worker and
does not fetch external includes, images or data resources.
