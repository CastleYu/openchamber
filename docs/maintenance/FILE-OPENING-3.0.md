# File opening in DIJIANG 3.0

Files open in the built-in viewer. The trailing toolbar offers Save as and
System open, with installed IDEs in its menu. The system file association owns
the default external application; these actions do not persist an app preference.
Projects expose Open in file manager in their context menu. Chat file links have
their own open, system-open and reveal menu; folder links open the file manager.

## Ownership

- Shared UI: `FileActions`, `MediaPreview`, `ImagePreview`, `MarkdownFiles` and
  the file-reference parser/stat modules own presentation and interaction.
- `FilesAPI` exposes optional asset, archive, native-open and save-as operations.
  The web adapter implements transport; Electron supplies native operations.
  Other adapters retain their existing file behavior and expose an explicit
  unsupported preview when they do not implement an asset operation.
- `file-transfers.mjs` owns window-scoped temporary files. Its IPC remains behind
  the existing local-sender gate. Packaged local UI can fetch a remote runtime
  through the shared authenticated transport, then transfer chunks to native
  storage. Remote pages do not gain local filesystem privileges.
- `windows-ides.mjs` discovers JetBrains installs through uninstall registry
  metadata, conventional install folders and Toolbox directories. Custom
  executable selection uses a native picker for the individual open operation.

## File lifecycle

Local assets use authenticated raw URLs. Remote assets finish downloading before
preview. Native downloads write bounded chunks to a `.part` file, verify the
received length and rename on completion. Cancellation discards the partial
file. Preview disposal releases its copy; external-open copies live until the
owning window closes. Copies are not reused between opens, avoiding stale host
or file reuse. External edits to a remote copy are not uploaded.

Save as uses the native dialog and writes a copy through a temporary destination.
Text copies use the current draft and preserve its line-ending format. Opening
an externally edited text buffer requires an explicit save/open-disk decision.

## Media and archives

Video includes MP4, WebM, MKV and MOV; audio uses a compact native audio control.
Container recognition does not imply support for every codec. Decode failure
leaves the system-open and save-as actions available. SVG is rendered as an image.
The raw route streams file data and supports HTTP Range requests.

## Failure boundaries

Desktop file-read options reject a failed local outside-workspace grant before
issuing filesystem HTTP requests. Best-effort link preauthorization keeps its
existing contract; the viewer reports the failure and offers Retry. Failed
grants are not cached permanently, so restoring a file allows a later retry.
Remote runtimes do not request local desktop grants.

Initial authorization errors end the loading state, including the legacy image
reader. A stat or content-read failure stops the selected file's polling lifetime.
Clean previews show an error with Retry. Dirty text and diagram edits stay
visible; pending text autosave is cancelled until a reload or successful explicit
save. Media never enters the text content poller or text-save path. A disposed
content poller cannot apply a late response.

Download setup failure cancels the response body and releases its reader. Abort,
length mismatch and failed system-open release the temporary transfer. Window
cleanup attempts all owned transfers even if one fails, and repeated release is
safe. A closed window cannot start another transfer; a missing completed copy
returns 404 from the native file protocol.

Focused tests cover authorization renewal/failure/runtime switching, content
polling and stale reads, transfer ownership/cancellation/length checks, and
packaged document/subresource failures. The isolated Electron 43.3.0 fixture
exercises MediaPreview errors and retry through bundled and Vite development
origins, plus missing-index recovery and restoration. It does not connect to a
live remote server or replace the installed application.

### Native open and save reliability in 3.1

Save-and-open uses one cancellable operation. Cancellation while saving prevents
the subsequent open; changing file, directory or runtime unmounts the old action
owner. Custom application selection uses the same unsaved-change decision as
system open. Download completion and text-copy completion recheck cancellation
and runtime identity before handing a file to a native open or save dialog.
The action toolbar forwards the preview's directory and outside-file access
options. Asset reads renew local desktop grants at read time, including Save as
after the preview's grant expired.
An operation already handed to the OS cannot be recalled by cancelling the UI.

Native transfer commands execute in order per transfer. Finish requires an exact,
non-negative safe-integer byte count. Release waits for earlier writes and rejects
later operations on the released entry; failed commands still allow cleanup.
Publishing a completed transfer and replacing a Save as target reuse the bounded
Windows file-lock retry policy. The existing destination is never deleted first.

Windows executable launches await the OS spawn result, so asynchronous launch
failure can reach the caller and try the next candidate. Direct executable
arguments are passed without a shell. Existing command-script and explicit
terminal launch paths remain platform-specific. Spawn success means the OS
accepted the process, not that an external application displayed the file.

Validation covers concurrent transfer ordering, invalid final lengths, existing
destination replacement, cancellation at completion, runtime switching, a real
missing-executable failure and real argument round trips. Isolated Electron
interactions cover cancel-during-save, file switch and successful save-and-open
plus Save as authorization through both bundled and Vite development origins. Third-party application UI
and non-Windows native behavior were not revalidated in this round.

ZIP preview reads only the central directory. It does not inflate members or
extract files. ZIP64, split archives and directories above the parser limits
return an explicit failure. The current limit is 10,000 entries / 16 MiB of
directory metadata. Other archive containers are not part of this release.

## Validation evidence

- Native transfer tests cover unpublished partial files, sender ownership,
  length verification, exact-byte save, chunk limit and cancellation.
- ZIP tests verify directory listing leaves only the source archive on disk.
- File-reference tests cover project scoping and filesystem-derived folder kind.
- Markdown renderer regression: 19 tests pass with its lazy boundary preserved.
- Electron 43.3.0 playback: H.264/AAC in MP4, MKV and MOV; VP9/Opus in WebM;
  MP3, WAV, FLAC, M4A and OGG. Playback and seeking were exercised on small samples.
- HMR UI: video, audio, ZIP entries, inline image decoding and file/folder menus
  were exercised. A real raw request returned 206 with the requested four bytes.
  Forced-copy transport returned the original 14,398-byte PNG through native IPC.
- PyCharm 2023.3.3 and IntelliJ IDEA 2023.3.4 were discovered on the maintainer's
  D drive and accepted project/file launch requests. IDE editor content was not
  inspected through native accessibility automation.

Run artifacts are archived outside the repository in the Codex visualization
output directory recorded in `PLAN.md`. Cross-platform
native behavior and a live SSH/relay-host download were not exercised; remote
transfer mechanics were exercised against the local authenticated test server.
