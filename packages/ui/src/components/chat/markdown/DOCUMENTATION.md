# Markdown diagrams

`decorate.ts` shares the diagram viewport and actions between Mermaid and
PlantUML fences. `mermaidViewer.ts` owns pan, zoom and fit for both SVG formats.
`diagramExport.ts` saves source/SVG blobs and rasterizes the original SVG for PNG,
independently of the viewport's current zoom. PNG output is bounded to 8192 pixels
per edge and 16 megapixels. Rasterization loads an SVG data URL, which is allowed
by the existing VS Code image CSP; it does not require blob image permissions.

`DiagramMenu.tsx` supplies the shared right-click menu through the public Markdown
wrappers. It offers expanded preview, fit, source copy and exports for either
language, with `.puml` export for PlantUML. The expanded viewer omits another
preview action. A local lazy popup handles file previews without a chat popup
callback. Non-diagram events continue to their existing handlers.

Inline diagrams keep normal conversation scrolling; Ctrl/Meta-wheel can zoom.
Expanded diagrams accept plain wheel zoom, left-button drag and menu-based reset.
Zoom buttons are hidden in both surfaces. Pointer drag suppression prevents a
drag release from also opening a preview. The two surfaces share the same viewer
controller and original SVG export path.

Mermaid defaults to beautiful-mermaid with the application palette. The Chat
settings style picker also offers beautiful-mermaid's GitHub light/dark, Nord and
Tokyo Night palettes, plus Mermaid's native, Forest, Neutral and hand-drawn looks.
ASCII remains available through beautiful-mermaid. The style is a profile setting
in the settings registry and server sanitizer.

In the application palette's dark variant, Mermaid strokes use the muted
foreground token rather than the low-contrast interactive border token. Native
and hand-drawn Mermaid follow the light/dark variant. Explicit palettes retain
their own backgrounds, including the light Forest, Neutral and GitHub Light
palettes. PlantUML receives the engine's dark option and uses the application
surface as its background when the source does not specify one.

`deferredDiagrams.ts` holds results for one renderer's current diagram sources,
style and theme. It drops sources no longer present. Native Mermaid and PlantUML
render after streaming settles, even when stream animations are disabled;
partial fences remain source text. Preparation
is cancelled at the Markdown effect boundary, and the renderer checks its revision
again before committing async results. A failed diagram keeps its source and
shows a localized error without discarding other diagrams.

`diagramEngines.ts` lazy-loads the local engines and serializes their stateful
render calls. PlantUML uses the pinned MIT `@plantuml/core` browser build and its
bundled Viz.js and themes. This build requires DOM/canvas access; it does not run
in a Web Worker. No public rendering service is used. External includes, external
themes, image loads and JSON/YAML/XML loads are unavailable. Generated SVG is
sanitized before insertion and download, including external asset references.

`lib/diagramSource.ts` recognizes `.puml`, `.plantuml` and `.pu` files and wraps
their source in a fence longer than any backtick run it contains. FilesView uses
the shared Markdown renderer in preview/fullscreen modes and retains raw source
for editing and saving. Diagram preview does not map rendered labels to source
line comments. The existing diagram popup carries the fence language so PlantUML
continues to render correctly when expanded from a conversation.

Shared browser rendering applies to web, desktop, VS Code and mobile. Engine
scripts are bundled application assets. Native file-save behavior continues to
use each browser/webview's existing download handling; platform packaging and
device acceptance must be reported separately from browser fixture tests.

Upstream references: [Mermaid](https://github.com/mermaid-js/mermaid),
[beautiful-mermaid](https://github.com/lukilabs/beautiful-mermaid), and
[PlantUML browser engine](https://github.com/plantuml/plantuml/blob/master/PUBLISHING_NPM.md).
