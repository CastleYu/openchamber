# File tree loading and visibility

CSV and TSV files default to a table preview and retain the source editor via
the toolbar toggle. The mode is remembered per path. The parser handles quoted
delimiters, newlines and escaped quotes, retains at most 2,000 data rows, and
reports the full row count and truncation. The preview uses the current draft;
switching modes does not replace file content.

TTF, OTF, WOFF and WOFF2 fonts use the existing runtime asset loader and remain
binary, so they cannot enter autosave. The font specimen registers a temporary
FontFace, removes it on source change or unmount, and reports load failures.
These file previews use OpenChamber file APIs and do not depend on the OpenCode
API generation.

`FilesView` and `SidebarFilesTree` keep directory snapshots in component state.
`DirectoryRequests` owns shared in-flight reads and supersession. Repeated
same-path callers await the same request; an explicit mutation refresh can
replace it. Scope changes and unmount clear the coordinator, so old completions
cannot publish or remove a newer request's slot. Callers also check runtime
identity at completion.

Directory arrays retain their references when every rendered field and ordering
matches. `fileTreeStatus.ts` builds path and ancestor indexes once per Git
snapshot. Open-file membership has its own set, so changing tabs does not
rebuild the Git index.

Desktop `FilesView` in editor-only mode neither loads nor constructs its unused
tree. Mobile retains its tree. The context panel passes actual visibility,
including the panel's open state, its active tab, and the editor toggle, to each file surface.
Hidden surfaces retain drafts, loaded content and scroll state. They stop
directory and file metadata polling; reopening checks freshness once before
normal polling resumes. Autosave is independent of visibility.

Background polling never supersedes an in-flight directory read. Explicit
refresh after file mutations does. Each directory failure remains local and
preserves its previous successful snapshot.

Opening a file outside the workspace reads it directly through the active
runtime, in both editor-only and full Files modes. Chat navigation and file
loading do not request native file grants. Server-backed text reads and metadata
requests have a 30-second deadline, including response-body reads, so a stalled
request reaches the existing error handler instead of leaving loading pending.

Sidebar root/runtime changes remount the scoped tree. Its bounded module cache
provides continuity between mounts; request cancellation for collapsed paths
stops queued batches, while already-started reads may populate the same-scope
cache. Runtime changes and unmount invalidate those active reads.

Sidebar rows use browser `content-visibility: auto` to skip layout and paint for
offscreen row contents without unmounting them. The explicit row height follows
the meta line height, the icon minimum and vertical padding, so remembered
offscreen dimensions cannot retain an old font size. Expanded child lists
sit outside each row's containment, so expansion, scrolling, focus and menus keep
their existing DOM structure. Reopening still refreshes directory contents.

Agent `file.open` requests use the OpenChamber control event stream and are
validated in `openchamberEvents.ts`. The desktop context panel and mobile files
drawer route the accepted path through the existing `openContextFile` action.
The server reports no delivery when no control-stream client is connected;
delivery is not proof that the user has inspected the file.
