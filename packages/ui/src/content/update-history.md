---
title: File previews and project controls
---

Cumulative official and personal update history from 1.22.0, including 1.22.0 itself. Reviewed on 2026-09-14. This is a retrospective summary, not a claim that every historical item is new in the next release.

Official entries identify the community release that introduced the behavior. Personal entries describe the cumulative fork changes through 1.23.0-DIJIANG.3.2. The current personal package includes the official line through 1.23.0; every 1.23.1 entry and the v2 preview are marked not merged. Historical behavior can be superseded by a later entry.

Two differences matter when reading this history. Official 1.23.1 removed automatic MCP reconnection, while this personal build retains managed reconnection with idle-release safeguards. Official desktop update improvements describe community builds; the personal build keeps notification-only updates. Portable refers to the executable, while settings and session data still use the established user directories.

Official sources: [1.22.0](https://github.com/openchamber/openchamber/releases/tag/v1.22.0), [1.22.1](https://github.com/openchamber/openchamber/releases/tag/v1.22.1), [1.22.2](https://github.com/openchamber/openchamber/releases/tag/v1.22.2), [1.23.0](https://github.com/openchamber/openchamber/releases/tag/v1.23.0), [1.23.1](https://github.com/openchamber/openchamber/releases/tag/v1.23.1), and the [v2 preview](https://github.com/openchamber/openchamber/releases/tag/v2-preview). The preview paragraph records its published snapshot only; it does not describe unpublished branch work.

Personal sources: [the published 3.1 build](https://github.com/CastleYu/openchamber/releases/tag/v1.23.0-DIJIANG.3.1), [the cumulative difference from official 1.23.0](https://github.com/CastleYu/openchamber/compare/d073858d...9ab28d4a), and [file-opening behavior](../../../../docs/maintenance/FILE-OPENING-3.0.md). The audit covers 301 commits after the 1.22.0 tag through personal 3.1, comprising 229 official and 72 personal commits, plus the 46 official 1.23.1 commits. It also checks 69 PR descriptions and every App/VS Code bullet in the five stable release sources.

App covers web, desktop and mobile only where the named feature is available. VS Code is listed separately from its mounted interfaces. Test-only work, merge bookkeeping and reverted intermediate behavior are folded into their final change or maintenance entry. No future maintenance-plan item is presented as implemented.

## App

### New

- Personal / Settings: Update history preserves the complete official and personal summary offline, with source and application filters (thanks to @CastleYu).
- Official 1.23.0 / **Git:** Stage, unstage, or discard individual blocks of changes with controls beside each block in the web and desktop Changes view (thanks to @LABCAT).
- **Personal / Files:** Preview video, audio, images and SVGs in Files, with playback controls and an external-open fallback when a format cannot be decoded (thanks to @CastleYu).
- Official 1.22.0 / Linear: connect a workspace in Settings → Integrations, browse and filter issues, and start a session or worktree from an issue. OpenChamber reports session progress back to Linear and can attach an issue to your next message (thanks to @AlexKutas).
- Official 1.22.0 / Git: a project with several repositories can switch between them from the Git tab. The diff, pull request, walkthrough, mobile Changes, and work status all follow the repository you pick (thanks to @jaygupta17).
- Official 1.22.1 / Message queue: messages you queue while a session is busy are now sent by the OpenChamber server. They go out even if you close the tab that queued them, and every device shows the same queue.
- Official 1.22.1 / Git: switching branches with uncommitted changes now stops at a dialog to commit or revert first, with an optional push. A failed push cancels the switch (thanks to @yulia-ivashko).
- Official 1.22.1 / Chat: the plus button inside a chat opens a new chat draft (thanks to @yulia-ivashko).
- Official 1.22.1 / Git: the mobile Changes view has a branch picker (thanks to @yulia-ivashko).
- Official 1.22.1 / Settings: Fixel Text is available as an interface font.
- Official 1.22.1 / Usage: exe.dev usage windows are tracked.
- Official 1.22.1 / Desktop: dev server previews work over the private relay.
- Official 1.22.2 / Chat: prompt history. Arrow up and down in the composer bring back your earlier prompts, attachments included, and the history survives a reload. It covers the current session; Settings → Chat can widen it to every project on this server and set how many prompts to keep, 40 by default (thanks to @mattv8).
- Official 1.22.2 / Chat: an "Enter sends" switch in Settings → Chat. On, Enter sends and Shift+Enter adds a line; off, the other way round. Ctrl/Cmd+Enter always sends. Nothing changes until you flip it (thanks to @claymor333).
- Official 1.22.2 / Server: `OPENCHAMBER_CHATS_DIR` moves the folder that holds chats without a project, for setups where OpenCode runs as a different user (thanks to @steffenmaechtel).
- Official 1.22.2 / CLI: on Linux, `openchamber startup enable` warns when the service would stop at logout and shows the `loginctl` command that keeps it running (thanks to @IbrahimKhan12).
- Official 1.22.2 / Project actions in worktrees: a session in a worktree can use the parent project's saved actions (thanks to @mattv8).
- Official 1.23.0 / Turn stats: The work status panel now shows response speed, model and tool time, tokens, and reported cost after a turn finishes. It's enabled by default (thanks to @alvins82).
- Official 1.23.0 / Projects: Move project actions, worktree setup commands, and draft starters into the repository for teammates to use. Repository commands ask for trust before running, and ask again when they change.
- Official 1.23.0 / Plans: Move plans into the repository, or point the Plans tab at an existing folder of Markdown files in your project.
- Official 1.23.0 / Git: Choose a recent commit to review in Changes or Walkthrough, with the same selection shared between both panels.
- Official 1.23.0 / Mobile: Compare branches and review individual commits from the Changes panel (thanks to @gaojunran).
- Official 1.23.0 / Mobile: Manage snippets, agents, commands, plugins, and skills from Settings on your phone.
- Official 1.23.0 / Mobile: Start a session in a project's root folder with the + beside its name in the sessions drawer.
- Official 1.23.0 / Sessions: Search projects by name or path in the new-session project picker on web and desktop (thanks to @maximtop).
- Official 1.23.0 / Sessions: Paste a full session ID into sidebar or archive search to find an exact match on web and desktop (thanks to @yulia-ivashko).
- Official 1.23.0 / Chat: Open and close collapsible Markdown sections in replies, including while the answer is still arriving.
- Official 1.23.0 / Usage: ClinePass shows five-hour, weekly, and monthly limits in Usage settings, with an option to show them in work status (thanks to @NemeZZiZZ).
- Official 1.23.0 / Usage: Charm Hyper now shows your remaining Hypercredits and their dollar value (thanks to @airtaxi).
- Official 1.23.0 / Settings: "Always show scrollbars" keeps scrollbars visible on this device when you move the pointer away.
- Official 1.23.1 (not merged) / Diff review: Review the changes in a published pull request directly in Changes, on desktop and mobile.
- Official 1.23.1 (not merged) / Sessions: Ask AI to rename a session based on its recent conversation from the session menu or mobile actions.
- Official 1.23.1 (not merged) / Settings/Sessions: Limit retention cleanup to archived sessions, with the retention period starting when each session was archived.
- Official 1.23.1 (not merged) / Chat: Paste or drop non-image files into a message, with file references added to the draft automatically.
- Personal / Files: Browse ZIP filenames and original/compressed sizes without extracting files. ZIP64, split archives and oversized directories report an unsupported preview (thanks to @CastleYu).
- Personal / Desktop files: Save a copy, open it with the system application, choose another application, or reveal its folder from the file toolbar (thanks to @CastleYu).
- Personal / Desktop: Discover installed JetBrains IDEs, including Toolbox installations, in Open in; a file can also be handed to a selected executable (thanks to @CastleYu).
- Personal / Chat: File links have their own Open, System open, Reveal and Copy path menu. Desktop folder links and project menus can open the system file manager (thanks to @CastleYu).
- Personal / Chat: Markdown images appear where they occur in the reply, with the existing image gallery and enlarged preview (thanks to @CastleYu).
- Personal / Performance: The header shows memory, CPU or process count, with recent history and an expandable process breakdown for the connected server (thanks to @CastleYu).
- Personal / Settings: Resource occupancy controls cover Git diff preloading, untracked walkthrough files, hidden panels, browser-tab retention and idle polling, with concurrency and file-count limits (thanks to @CastleYu).
- Personal / Git: Pause automatic monitoring per project and refresh manually, including when opening a paused project's Changes panel for the first time (thanks to @CastleYu).
- Personal / Logs: Settings lists dated server logs with refresh, download and path-copy actions. A local desktop can open the log or reveal its directory (thanks to @CastleYu).
- Personal / MCP: Failed connections show likely causes and suggested actions for missing commands, Windows command shims, refused connections, timeouts, login, certificates and wrong addresses (thanks to @CastleYu).
- Personal / Performance: Export recent sampling failures and recovery events from the performance panel for troubleshooting (thanks to @CastleYu).

### Improvements

- Official 1.22.0 / Chat: a session you open from the sidebar lands at the latest message and stays there. Switching sessions no longer jumps, renders half a conversation, crossfades, or shifts the tab title.
- Official 1.22.0 / Voice: local text-to-speech and macOS say pick a voice that matches the language of the reply. More local models download the first time you need them, and the voice picker lists voices from every installed model.
- Official 1.22.0 / Settings: each OpenChamber instance remembers its own theme, so windows connected to different instances keep the look you gave them (thanks to @kydorn).
- Official 1.22.0 / Settings: your GitHub account now lives in Settings → Integrations. The pull-request panel has account controls, and its rail icon appears only once you are connected.
- Official 1.22.0 / Files: Ctrl/Cmd+F opens search in the Markdown preview even when the preview is not focused.
- Official 1.22.1 / OpenCode Go: every request OpenChamber sends on its own, such as commit messages, pull request text, recaps and follow-ups, walkthroughs, Goal Mode checks, notes, and usage, now carries the `x-opencode-session` header OpenCode Go requires from 6 September. Chat traffic already had it. Update before that date if you use OpenCode Go.
- Official 1.22.1 / Chat: a queued message keeps its attached context, file mentions, and skill, and editing it brings them back to the composer.
- Official 1.22.1 / Worktrees: Archiving a worktree's sessions takes about a second for 121 sessions; bulk sidebar archiving receives the same improvement (thanks to @yulia-ivashko).
- Official 1.22.1 / MCP: a server that failed to start or lost its connection reconnects on its own, waiting up to thirty seconds between tries. Disabled servers and ones waiting for a login are left alone. Web and Desktop only.
- Official 1.22.1 / Git: the branch picker lists recent branches and marks the ones with unpushed commits (thanks to @yulia-ivashko).
- Official 1.22.1 / Git: a draft over a directory with uncommitted changes shows a warning on its branch selector (thanks to @yulia-ivashko).
- Official 1.22.1 / Git: status refreshes after a tool finishes a change or a worktree changes (thanks to @yulia-ivashko).
- Official 1.22.1 / Chat: a new session opens on the Chat or Project side you used last (thanks to @yulia-ivashko).
- Official 1.22.1 / Sessions: starting a rename selects the whole title (thanks to @yulia-ivashko).
- Official 1.22.1 / Settings: new installs start on the OpenChamber light and dark themes. An existing Flexoki choice is kept.
- Official 1.22.1 / Desktop: the instance switcher keeps its statuses between opens, never shows the connected instance as checking, waits up to fifteen seconds for a relay instance before calling it unreachable, and shows the full instance name.
- Official 1.22.2 / Project actions: the running state of a saved action is reliable now. It shows as running only while the command is really running, every device sees the same state, and the sidebar shows which project has something running (thanks to @mattv8).
- Official 1.22.2 / Chat: Markdown tables are readable again, columns take the width their content needs (thanks to @ChangeHow).
- Official 1.22.2 / Chat: the Summary, Tree, or Raw view you pick for a JSON tool result is remembered for every JSON card and after a reload (thanks to @karimodm).
- Official 1.22.2 / Mobile: with a draft typed, the collapsed composer always has a send button. While the agent is working, that button queues the message (thanks to @ChangeHow).
- Official 1.22.2 / Server: OpenCode config paths respect `XDG_CONFIG_HOME` (thanks to @travisdoherty).
- Official 1.22.2 / Updates: the update dialog shows each new release with its title and its New, Improvements, and Fixes groups.
- Official 1.23.0 / Chat: Completed live Activity can collapse into a summary of tools used and files changed, keeping the final answer visible. It follows your Activity Default setting.
- Official 1.23.0 / Chat: `/btw` now opens a separate composer with its own draft, model, and effort. Select message text and choose "By the way…" to ask about it, or use `/btw <question>` to send immediately (thanks to @ChangeHow).
- Official 1.23.0 / Files: Returning to a file restores your place in its code or Markdown preview, including the cursor position in the editor.
- Official 1.23.0 / Settings: Theme, fonts, and chat layout can differ between web, desktop, mobile, and VS Code. Panel sizes and other device choices stay on the device.
- Official 1.23.0 / Desktop: Zoom controls act on the focused browser, terminal, or file editor, and adjust interface scale when you're in chat or Mini Chat (thanks to @khafaji-ahmed).
- Official 1.23.0 / Mobile: Back steps through Settings from an item to its list, then to the settings menu.
- Official 1.23.0 / Mobile: Choose project sorting from the sessions drawer header. The drawer follows the same project order as desktop.
- Official 1.23.0 / Mobile: Close either drawer with the reverse edge swipe. Swipe session, project, and worktree rows right to reveal their actions.
- Official 1.23.0 / Comments: Enter attaches a code comment on desktop; Shift+Enter adds a newline.
- Official 1.23.0 / Terminal: Text renders consistently across tabs, borders and block graphics join cleanly, and touch users get a copy button beside the tabs.
- Official 1.23.0 / Chat: Ctrl+N/P navigation works across model lists, menus, and autocomplete. Reopening the model picker brings the selected model into view (thanks to @ChangeHow).
- Official 1.23.0 / Settings/Chat: Send-shortcut choices and large-text paste behavior have clearer descriptions (thanks to @ChangeHow).
- Official 1.23.0 / Chat: Tighter text and Activity spacing, stronger headings, and a softer divider make final answers easier to read. Message action buttons are smaller, with touch actions grouped in a menu.
- Official 1.23.0 / Chat: Selected text uses the same visible highlight in messages, file previews, and comments across themes.
- Official 1.23.1 (not merged) / Chat: Visual refinements across the message box, attachments, menus, and panels give the conversation more room and a more consistent look on desktop and mobile.
- Official 1.23.1 (not merged) / Chat: Attachments and linked issues sit inside the message box, with model and agent controls grouped together on mobile. Queued messages start collapsed.
- Official 1.23.1 (not merged) / Chat: Recaps retain the substance of recent work after short closing exchanges, and follow-up suggestions can stay quiet when there's nothing useful to add.
- Official 1.23.1 (not merged) / Sessions: Markdown exports include attached quotes and comments with their source.
- Official 1.23.1 (not merged) / App: Hidden Files, Changes, terminal, and walkthrough panels pause background work while you're using another panel.
- Official 1.23.1 (not merged) / Chat: Inline code colors follow the selected theme.
- Official 1.23.1 (not merged) / Mobile: A dot on the workspace button marks uncommitted changes.
- Official 1.23.1 (not merged) / Chat: Removed the extra changed-files dropdown under answers in non-Git folders.
- Personal / Sessions: Background project history loading is optional and off by default; the current project loads first, and complete history is fetched when needed (original work by wq.pan; integrated by @CastleYu).
- Personal / Sidebar: Collapsed and inactive projects avoid unnecessary session and worktree discovery; expanding or selecting a project loads its content (original work by wq.pan; integrated by @CastleYu).
- Personal / Startup: Desktop shows its initial interface before optional global history work and avoids preloading inactive project configuration (original work by wq.pan; integrated by @CastleYu).
- Personal / Projects: Foreground work gets faster updates; quiet projects and hidden windows reduce background work while running tasks, approvals and unread completions remain protected (thanks to @CastleYu).
- Personal / Git: Diff preloading respects concurrency limits until requests finish, skips idle projects and releases disposable previews when they are no longer needed (thanks to @CastleYu).
- Personal / Walkthrough: Untracked-file previews skip binary and oversized files and cap file count, parallel reads and total size (thanks to @CastleYu).
- Personal / Walkthrough: Leaving a hidden panel stops unnecessary reads while an already-started generation continues (thanks to @CastleYu).
- Personal / Browser: Turning off tab retention closes inactive embedded browser tabs and releases them when the panel closes (thanks to @CastleYu).
- Personal / Tray: Session activity uses live updates where available and avoids repeated polling of already-synchronized directories (original work by wq.pan; integrated by @CastleYu).
- Personal / MCP: Managed servers can release idle local tools and restore them before the next prompt; active sessions, pending approvals and another active window prevent premature release (thanks to @CastleYu).
- Personal / Windows MCP: Idle background-process-mcp release also checks active tasks and retained task history; uncertain status keeps the process available (thanks to @CastleYu).
- Personal / Windows: Process sampling is faster and accounts for the managed process tree, including reparented descendants, while excluding the sampling helper (thanks to @CastleYu).
- Personal / Logs: Server output is retained in daily structured logs with managed OpenCode startup, exit and cleanup events; repeated MCP failure reports are bounded (thanks to @CastleYu).
- Personal / Language: Logs, MCP failure hints, file actions and resource settings include translations across the existing 12 interface languages; Turkish Git labels retain matching keys (thanks to @CastleYu).
- Official 1.23.1 (not merged) / Sidebar: The activity header changes when it sticks during scrolling, keeping the current sidebar context visible.
- Official 1.23.1 (not merged) / Chat: The composer and recap float over the conversation, autocomplete stays outside the composer, and suggested follow-ups are docked inside it.
- Official 1.22.2 / Settings: Behavior settings shows the effective global AGENTS.md filename, including a custom OpenCode configuration directory (thanks to @travisdoherty).

### Fixes

- Official 1.22.0 / Chat: command, skill, and file autocomplete in a chat without a project no longer uses the project you had selected before.
- Official 1.22.0 / Chat: reverting to a message or forking from one brings its attached context back to the composer. Review comments, chat and file quotes, terminal selections, and browser annotations are kept.
- Official 1.22.0 / Chat: a stopped or unanswered turn now says what happened. The status report lists recent session, send, and managed OpenCode errors, and where to find the logs.
- Official 1.22.0 / Scheduled tasks: Goal, Auto-accept, and the other task settings survive when an older OpenChamber build shares the same project config.
- Official 1.22.0 / Git: the commit graph no longer leaves a lane gap when the same branch is merged twice (thanks to @Naputt1).
- Official 1.22.0 / Desktop: on Windows and Linux the close button reaches the top-right corner and follows the theme on hover (thanks to @kydorn).
- Official 1.22.1 / Worktrees: removing a worktree no longer freezes the interface. It runs in the background with a progress toast (thanks to @yulia-ivashko).
- Official 1.22.1 / Worktrees: a worktree created from a branch behind its upstream now fetches first and branches from the remote (thanks to @jtatum).
- Official 1.22.1 / Worktrees: the New Worktree dialog keeps what you typed when the worktree list changes while it is open (thanks to @yulia-ivashko).
- Official 1.22.1 / Worktrees: a removed worktree leaves the sidebar under every project it was listed in (thanks to @yulia-ivashko).
- Official 1.22.1 / Git: status no longer flashes half-finished changes while a new worktree runs its setup commands (thanks to @yulia-ivashko).
- Official 1.22.1 / Chat: starting an isolated-worktree session from an answer picks the right project when the open session already lives in a worktree (thanks to @yulia-ivashko).
- Official 1.22.1 / Chat: resizing the window no longer snaps an idle reader back to the end of the conversation.
- Official 1.22.1 / Thinking effort: picking Default sticks after a send and across agent or session switches, and a reopened session restores the effort its last message used (thanks to @yulia-ivashko).
- Official 1.22.1 / Settings: the theme no longer flips when you switch sessions across directories, and missing theme fields keep your current preference (thanks to @kydorn).
- Official 1.22.1 / Terminal: text no longer renders wrong until you resize the terminal, and terminals connect on servers running under Bun.
- Official 1.22.1 / Server: a browser on https behind an HTTP proxy hop is no longer rejected as a mismatched origin.
- Official 1.22.1 / Sidebar: the project label no longer shifts when its hover actions appear.
- Official 1.22.1 / Desktop: switching instances clears the previous instance's Linear and GitHub logins, quotas, MCP status, skills, and memory.
- Official 1.22.1 / Turkish interface: the missing Git repository discovery labels are back (thanks to @kydorn).
- Official 1.22.2 / Settings/Providers: Editing a custom provider keeps its existing provider options and model settings (thanks to @hehuaiyu).
- Official 1.22.2 / Sessions: opening a session from a deleted worktree moves it back to the project (thanks to @yulia-ivashko). Official 1.23.0 later made relocation a user decision.
- Official 1.22.2 / Sessions: restoring an archived session from a deleted worktree moves it back to the project (thanks to @mattv8 and @yulia-ivashko). Official 1.23.0 later made relocation a user decision.
- Official 1.22.2 / Sidebar: a missing worktree stays visible with a warning until you remove it (thanks to @yulia-ivashko).
- Official 1.22.2 / Sessions: forks, side threads, and subagents keep working after their original chat is deleted (thanks to @yulia-ivashko).
- Official 1.22.2 / Chat: huge patches in tool cards open without freezing the page (thanks to @karimodm).
- Official 1.22.2 / Files: an open file stops flickering through reloads when nothing changed, and an edit made in another app shows up in place while your unsaved changes stay (thanks to @IbrahimKhan12).
- Official 1.22.2 / Chat: pressing Enter to confirm text on a Japanese, Chinese, or Korean keyboard no longer sends a comment by accident (thanks to @ChangeHow).
- Official 1.22.2 / Chat: a queued slash command with attached context is delivered correctly, and the "Queued messages" card disappears after the last message goes out.
- Official 1.22.2 / Goal Mode: when a reply is cut off by the length limit, the goal continues, and Resume gives it another try (thanks to @bashrusakh).
- Official 1.22.2 / Sessions: subagent sessions are found in projects with more than 200 sessions (thanks to @bashrusakh).
- Official 1.22.2 / Server: the terminal works in the Docker image, and non-Latin text renders correctly there (thanks to @yulia-ivashko).
- Official 1.22.2 / CLI: on Windows, `openchamber` starts the server under Bun when Bun is installed.
- Official 1.23.0 / Chat: Queued messages already sent by the server disappear from the queue after reconnecting (thanks to @IbrahimKhan12).
- Official 1.23.0 / Sessions: Creating a session or opening a worktree session no longer shows a false history-loading error.
- Official 1.23.0 / Remote access: Large streamed replies no longer hold up other requests on slow tunnel connections, and broken connections stop leaving new requests hanging.
- Official 1.23.0 / Chat: Forking a user message restores its text and attachments in the new composer's draft and preserves the source draft (thanks to @karimodm).
- Official 1.23.0 / Chat: Interrupted tools stop showing an endless running timer after a reload (thanks to @alvins82).
- Official 1.23.0 / Chat: Attached images no longer appear twice just after sending.
- Official 1.23.0 / Chat: Opening panels or resizing the window keeps you at the end when following the latest reply. Sending or collapsing Activity no longer leaves a large blank area below it.
- Official 1.23.0 / Chat: Message details fit narrow columns without leaving gaps, keeping the model name readable as less important details disappear.
- Official 1.23.0 / Chat: Streaming Thinking stays inside its scroll box. Scrolling or dragging upward pauses its automatic scrolling so you can read earlier reasoning (thanks to @alvins82).
- Official 1.23.0 / Chat: Enter adds a newline in the expanded composer; Ctrl/Cmd+Enter sends. Keyboard selection of a project or worktree returns focus to the input (thanks to @ChangeHow).
- Official 1.23.0 / Chat: Narrow Markdown tables fit their columns, removing the empty bordered space on the right (thanks to @ChangeHow).
- Official 1.23.0 / Sessions: Opening or restoring a session whose worktree was deleted leaves moving it to another directory up to you.
- Official 1.23.0 / Mobile: The uncommitted-changes warning no longer flashes over the chat when starting a session.
- Official 1.23.0 / Mobile/Android: Settings, drawers, and chat controls stay clear of the system navigation bar.
- Official 1.23.0 / Terminal: Switching projects or tabs keeps each terminal's output separate. Reopening or resizing the panel no longer leaves stray prompt fragments.
- Official 1.23.0 / Terminal: Exiting Node-based commands on macOS and Linux no longer prints an empty IPC-channel warning.
- Official 1.23.0 / Updates: Updating a desktop host from the browser uses its native updater, confirms the installed version, and reports restart failures with a retry option (thanks to @ChangeHow).
- Official 1.23.0 / Git: Switching to a token-based identity no longer fails with a credential-helper permission error (thanks to @ICEY16360).
- Official 1.23.0 / Git: Branch comparisons include local edits and follow the selected base branch when you switch comparisons.
- Official 1.23.0 / Git: New-file diffs and walkthroughs still load when Git prints line-ending warnings (thanks to @jakoss).
- Official 1.23.0 / Usage: A failed refresh keeps the last known usage visible and shows the error without clearing other providers.
- Official 1.23.0 / Usage: OpenCode Go shows the correct reset countdowns for its usage limits.
- Official 1.23.0 / Usage: OpenRouter shows per-key spending and limits, or monthly spending for unlimited keys, fixing misleading zero balances (thanks to @leducmaxime).
- Official 1.23.0 / Usage: Ollama Cloud's dollar-based plans show monthly spending and extra credits, fixing missing usage and rejected credentials (thanks to @kydorn).
- Official 1.23.0 / Usage: NeuralWatt allowance rows show usage percentages and respond to the used/remaining toggle (thanks to @kydorn).
- Official 1.23.0 / Usage: Slow connections to providers such as z.ai no longer fail because the connection attempt ends too early (thanks to @ouyangjian28).
- Official 1.23.0 / Model tools: Summaries, titles, and walkthroughs use the selected model's connection details, fixing failures with providers whose models use different addresses (thanks to @mcowger).
- Official 1.23.0 / Desktop: Reachable instances no longer appear offline just because their connection check takes longer to respond (thanks to @jibanez-staticduo).
- Official 1.23.0 / Layout: Interface scaling keeps panels and controls usable, with room for macOS window buttons at smaller scales (thanks to @khafaji-ahmed).
- Official 1.23.0 / Sidebar: Closing and reopening the sidebar preserves the width you chose.
- Official 1.23.0 / Desktop/Linux: "Open in" no longer lists unrelated editors or launches the wrong app when an installed app has a non-Latin name (thanks to @ouyangjian28).
- Official 1.23.0 / Scrollbars: Hovering over a scrollable area reveals its scrollbar, including in Settings and dialogs, without shifting the content (thanks to @sergiofspedro).
- Official 1.23.0 / Language/Turkish: Agent and prompt labels use consistent terminology in Activity, turn stats, and input-history settings (thanks to @fitzgpt).
- Official 1.23.1 (not merged) / Sessions: Default model, agent, and thinking choices survive restarts and instance switches, with faster loading in the model and agent pickers (thanks to @alvins82).
- Official 1.23.1 (not merged) / Chat: Model favorites save from the first change, including when you reload immediately (thanks to @alvins82).
- Official 1.23.1 (not merged) / Chat: Reading older messages keeps your place as earlier history loads, and a growing message box keeps the latest message in view.
- Official 1.23.1 (not merged) / Chat: Reasoning and shell output keep scrolling with incoming text until you scroll up yourself.
- Official 1.23.1 (not merged) / Chat: File lists under answers use the turn's direct edits, reducing unrelated files from other sessions. Long lists collapse after four files (thanks to @yulia-ivashko).
- Official 1.23.1 (not merged) / Chat: Queued messages containing only quotes or comments show a preview of their attached context.
- Official 1.23.1 (not merged) / Chat: Slash commands stay available when switching projects.
- Official 1.23.1 (not merged) / Chat: Session recaps disappear without making the conversation jump when you send a message.
- Official 1.23.1 (not merged) / Files: Large text files can be edited and saved in full without cutting off their contents or changing line endings.
- Official 1.23.1 (not merged) / Sessions: Retention cleanup protects child sessions that should be kept and avoids false failures when deleting session families.
- Official 1.23.1 (not merged) / Sessions: Pressing Enter saves a renamed session.
- Official 1.23.1 (not merged) / Worktrees: New sessions pick up the project's settings after checkout, fixing missing configuration in freshly created worktrees.
- Official 1.23.1 (not merged) / Worktrees: Worktrees added or removed in another window, by an agent, or from a terminal appear in the sidebar on the next Git refresh (thanks to @yulia-ivashko).
- Official 1.23.1 (not merged) / Projects: Deeply nested projects can save settings, notes, plans, and memory without file-name errors (thanks to @yulia-ivashko).
- Official 1.23.1 (not merged) / Scheduled tasks: A project that fails to load no longer stops tasks in other projects from starting (thanks to @yulia-ivashko).
- Official 1.23.1 (not merged) / Scheduled tasks: Run now works for paused tasks while their schedule stays paused.
- Official 1.23.1 (not merged) / Terminal: Right-click opens Copy and Paste actions again.
- Official 1.23.1 (not merged) / Terminal: On macOS, Option+Left/Right moves by word and Option+Backspace deletes the previous word at shell prompts.
- Official 1.23.1 (not merged) / Terminal: Attaching selected output to chat puts the cursor in the message box.
- Official 1.23.1 (not merged) / Shortcuts: Cmd/Ctrl number shortcuts for sessions and panels work while typing in chat.
- Official 1.23.1 (not merged) / Desktop: After an AppImage update, OpenCode starts from the current app bundle, fixing stale paths and incorrect upgrade offers (thanks to @yulia-ivashko).
- Official 1.23.1 (not merged) / Sessions: Long tab titles fade before the buttons when you hover over a tab.
- Personal / Files: Failed authorization or reads end the loading indicator and offer Retry. A later successful authorization can recover the preview (thanks to @CastleYu).
- Personal / Files: Failed refreshes preserve unsaved text and diagram changes; pending text autosave stops until the file is recovered or explicitly saved (thanks to @CastleYu).
- Personal / Files: Video and audio stay out of text refresh and text-save operations, and late reads cannot replace a different file's preview (thanks to @CastleYu).
- Personal / Desktop files: Downloads remain temporary until all bytes arrive; cancellation, failed opening and closed windows release their copies (thanks to @CastleYu).
- Personal / Desktop files: Save as preserves the current text draft and line endings, and replacing an existing destination uses the same complete-copy checks (thanks to @CastleYu).
- Personal / Desktop files: Save and open handles unsaved edits explicitly; cancelling or switching file, project or server prevents the old operation from opening afterward (thanks to @CastleYu).
- Personal / Desktop files: Missing applications report launch failure and allow other launch candidates to be tried; custom app selection follows the same unsaved-edit decision (thanks to @CastleYu).
- Personal / Desktop: Missing interface files show a self-contained recovery page with Retry. Missing scripts and media return a file error without being mistaken for an HTML page (thanks to @CastleYu).
- Personal / Windows: Closing managed OpenCode and MCP connections also cleans up owned descendants, while incomplete cleanup remains available for a later retry (thanks to @CastleYu).
- Personal / MCP: Failed status reads and stale activity checks cannot make an active directory appear idle; tools owned by external OpenCode instances are left alone (thanks to @CastleYu).
- Personal / Git: A fatal error in one untracked-file diff leaves that entry empty and preserves other results; incomplete output is no longer shown as a valid patch (thanks to @CastleYu).
- Personal / Sessions: Initial history loading and background refreshes keep their project boundaries, avoiding repeated discovery loops and stale cross-project results (original work by wq.pan; integrated by @CastleYu).
- Personal / Files: File-versus-folder classification follows the filesystem and the current project, so folder links do not open as text files (thanks to @CastleYu).

### Misc

- Official 1.22.1 / Settings → Integrations no longer offers the Claude Code and Cursor plugin installs. It now holds GitHub and Linear.
- Official 1.23.0 / Server: `OPENCHAMBER_DATA_DIR` also covers project settings, themes, speech models, and new managed chats. Existing managed chats stay in their current location.
- Official 1.23.1 (not merged) / MCP: Removed OpenChamber's automatic reconnects, which could repeatedly start failed local servers. Failed connections now need manual reconnection.
- Official 1.23.1 (not merged) / Desktop: Updated Electron to 43.7.0.
- Personal / Distribution: Windows x64 releases use a versioned portable executable; previous executables and existing settings, sessions and OpenCode data are retained during replacement (thanks to @CastleYu).
- Personal / Versions: DIJIANG uses feature.fix numbering. Features and refactors advance the first number; fixes and optimizations advance the second. This summary ends at 1.23.0-DIJIANG.3.1 (thanks to @CastleYu).
- Personal / Updates: Upstream releases produce a notice and link. App, web and CLI update paths cannot automatically download or replace the personal build; OpenCode's own updater is separate (thanks to @CastleYu).
- Personal / Windows packaging: Local and CI builds use the same portable pipeline and record source/build metadata; this release provides an EXE, build information and SHA-256 checksums (thanks to @CastleYu).
- Personal / Diagnostics: Optional DEBUG builds expose bounded process diagnostics. Normal release builds keep that endpoint disabled, and diagnostic events omit commands and credentials (thanks to @CastleYu).
- Personal / Remote files: The desktop can download an authenticated remote file into a local temporary copy for opening. Edits to that copy are not uploaded back to the remote server (thanks to @CastleYu).
- Personal / Windows MCP: Recognized installed background-process-mcp 1.2.8 launches use a stable local copy; preparing it does not install a package or rewrite user MCP configuration (thanks to @CastleYu).
- Personal / Maintenance: Branch-preservation guidance, module contracts, failure records, packaging evidence and regression coverage accompany the changes; research notes and future maintenance plans are not shipped features (thanks to @CastleYu).
- Personal / Runtime: The published 3.1 Windows package uses Electron 43.3.0 and bundled OpenCode 1.18.30; the official 1.23.1 runtime upgrade is not included (thanks to @CastleYu).
- Official v2 preview (not merged) / Desktop: The published snapshot is 2.0.0-preview.4 with OpenCode 2.0.3. Preview files are replaced on each build and do not update themselves to stable releases.
- Official 1.22.2 / Development: Windows launchers find the real Bun executable, and npm-based commands work inside the checkout after dependency overrides were aligned (thanks to @hehuaiyu and @knorby).
- Official 1.22.2 / Maintenance: Release notes gained per-version sources, separate extension notes, titles and grouped update dialogs; obsolete API wrappers were removed and regression checks expanded.
- Official 1.23.0 / Runtime: OpenCode SDK updates progressed through 1.18.28 and 1.18.29 to 1.18.30, and the terminal moved to the in-repository libghostty adapter.
- Official 1.23.1 (not merged) / Remote access: Relay connections report the app identity and version for the connected client.
- Official 1.22.1 / Development: Remote development deployments can run on Bun-only hosts.
- Official 1.23.0 / Development: Mini Chat opens the selected development interface while testing desktop changes.
- Personal / Settings history: Earlier worktree-discovery switches and interval controls were removed from the interface as discovery became demand-driven; background history loading remains configurable (original work by wq.pan; integrated by @CastleYu).
- Personal / Version history: Early three-part and single-number personal labels preceded the current feature.fix convention; the current display retains the upstream version alongside DIJIANG (thanks to @CastleYu).

- Personal / Releases: GitHub Actions builds and publishes new personal versions after verifying their source and attachments; previously published versions stay unchanged (thanks to @CastleYu).

## VS Code

### New

- Personal / Settings: Update history is available in the extension, including a separately classified VS Code history (thanks to @CastleYu).
- Official 1.22.1 / Settings: Fixel Text is available as an interface font.
- Official 1.22.1 / Usage: exe.dev usage windows are tracked.
- Official 1.22.2 / Comments on code. Select lines, click the `+` in the gutter or right-click → OpenChamber → Add Comment, and write your note. It stays pinned to the code and goes out with your next message as a context card. Works in diffs too (thanks to @felipegenef).
- Official 1.22.2 / The extension is available in Turkish (thanks to @fitzgpt).
- Official 1.22.2 / Chat: prompt history. Arrow up and down in the composer bring back your earlier prompts, attachments included, and the history survives a reload. It covers the current session; Settings → Chat can widen it to every project and set how many prompts to keep, 40 by default (thanks to @mattv8).
- Official 1.22.2 / Chat: an "Enter sends" switch in Settings → Chat. On, Enter sends and Shift+Enter adds a line; off, the other way round. Ctrl/Cmd+Enter always sends. Nothing changes until you flip it (thanks to @claymor333).
- Official 1.23.0 / Chat: Replies can contain collapsible Markdown sections that stay open as the answer streams.
- Official 1.23.0 / Projects: Store worktree setup commands and draft starters in the repository from Project settings. Repository commands require trust before running and after changes.
- Official 1.23.0 / Usage: ClinePass now shows five-hour, weekly, and monthly usage limits (thanks to @NemeZZiZZ).
- Official 1.23.0 / Usage: Charm Hyper shows your remaining Hypercredits and their dollar value (thanks to @airtaxi).
- Official 1.23.0 / Settings: "Always show scrollbars" keeps scrollbars visible when the pointer leaves a scrollable area.
- Official 1.23.1 (not merged) / Settings/Sessions: Retention cleanup can target archived sessions only, counting their age from the archive date.
- Official 1.23.1 (not merged) / Chat: Pasted and dropped files get references in the message draft automatically.
- Personal / Local files: Supported webview actions can hand a local path to the VS Code host for opening with the system application (thanks to @CastleYu).
- Personal / MCP: Connection failures show the same translated cause and troubleshooting hints as the shared MCP interface (thanks to @CastleYu).
- Official 1.23.0 / Turn stats: Work status shows completed-turn speed, time, tokens and reported cost, with the shared default-on preference (thanks to @alvins82).

### Improvements

- Official 1.22.0 / Chat: a session you open from the sidebar lands at its end and stays there. Switching sessions no longer jumps or renders half a conversation.
- Official 1.22.1 / OpenCode Go: the usage request the extension sends now carries the `x-opencode-session` header OpenCode Go requires from 6 September. Chat traffic already had it.
- Official 1.22.1 / Chat: a queued message keeps its attached context, file mentions, and skill, and editing it brings them back to the composer.
- Official 1.22.1 / Sessions: starting a rename selects the whole title (thanks to @yulia-ivashko).
- Official 1.22.2 / Chat: Markdown tables are readable again, columns take the width their content needs (thanks to @ChangeHow).
- Official 1.22.2 / Chat: the Summary, Tree, or Raw view you pick for a JSON tool result is remembered for every JSON card and after a reload (thanks to @karimodm).
- Official 1.22.2 / A fresh install uses VS Code's display language until you choose one in Settings.
- Official 1.23.0 / Chat: `/btw` now has a separate composer with its own draft, model, and effort. The "By the way…" text-selection action prefills a question with the selected passage (thanks to @ChangeHow).
- Official 1.23.0 / Chat: Completed live Activity can collapse into a tool and file-change summary while the final answer stays visible, following your Activity Default setting.
- Official 1.23.0 / Settings: VS Code keeps its own appearance and chat layout preferences, separate from web, desktop, and mobile.
- Official 1.23.0 / Settings: In narrow panels, Back returns from an item to its list before returning to the settings menu.
- Official 1.23.0 / Chat: Ctrl+N/P navigation works across model lists, menus, and autocomplete. The model picker reopens with your selected model in view (thanks to @ChangeHow).
- Official 1.23.0 / Settings/Chat: Send-shortcut and large-text paste options have clearer descriptions (thanks to @ChangeHow).
- Official 1.23.0 / Chat: More compact Markdown, smaller action buttons, and a softer final-answer divider make replies easier to scan.
- Official 1.23.0 / Chat: Text selection and comment highlights use a consistent, readable accent tint across themes.
- Official 1.23.1 (not merged) / Chat: Visual refinements to the message box, attachments, and menus make better use of the space in the sidebar and editor tabs.
- Official 1.23.1 (not merged) / Chat: Attachments sit inside the message box, and queued messages start collapsed.
- Official 1.23.1 (not merged) / Sessions: Markdown exports preserve attached quotes and comments with their source.
- Official 1.23.1 (not merged) / Chat: Removed the changed-files bar above the message box and the extra file dropdown under answers in non-Git folders.
- Official 1.23.1 (not merged) / Chat: Inline code uses colors from your VS Code theme.
- Personal / Sessions: Project history follows workspace ownership and loading demand, with optional background loading and less unnecessary discovery (original work by wq.pan; integrated by @CastleYu).
- Personal / Chat: Markdown images stay beside the text that references them and retain the image gallery controls (thanks to @CastleYu).
- Personal / Resources: Shared session activity and background polling follow visibility and project priority; these controls do not stop the extension's OpenCode process (thanks to @CastleYu).
- Personal / Language: Shared resource controls and MCP failure hints are translated into the existing interface languages (thanks to @CastleYu).
- Official 1.22.2 / Settings: Global OpenCode configuration honors XDG_CONFIG_HOME, and Behavior settings shows the effective AGENTS.md filename (thanks to @travisdoherty).

### Fixes

- Official 1.22.0 / Chat: a turn that OpenCode stopped no longer ends with nothing on screen. What OpenCode reported shows under the last message, and a message an idle session left unanswered is named as such.
- Official 1.22.0 / Chat: the status report (Ctrl/Cmd+Shift+L) lists the last session errors and rejected sends.
- Official 1.22.1 / Worktrees: removing a worktree no longer freezes the interface. It runs in the background with a progress toast (thanks to @yulia-ivashko).
- Official 1.22.1 / Worktrees: a worktree created from a branch behind its upstream now fetches first and branches from the remote (thanks to @jtatum).
- Official 1.22.1 / Worktrees: the New Worktree dialog keeps what you typed when the worktree list changes while it is open (thanks to @yulia-ivashko).
- Official 1.22.1 / Worktrees: a removed worktree leaves the sidebar under every project it was listed in (thanks to @yulia-ivashko).
- Official 1.22.1 / Thinking effort: picking Default sticks after a send and across agent or session switches, and a reopened session restores the effort its last message used (thanks to @yulia-ivashko).
- Official 1.22.1 / Settings: the theme no longer flips when you switch sessions across directories, and a theme the extension cannot fully report keeps your current preference (thanks to @kydorn).
- Official 1.22.2 / Settings/Providers: editing a custom provider keeps all of its model settings, and the protocol you chose is saved (thanks to @hehuaiyu).
- Official 1.22.2 / Chat: huge patches in tool cards open without freezing the page (thanks to @karimodm).
- Official 1.22.2 / Chat: pressing Enter to confirm text on a Japanese, Chinese, or Korean keyboard no longer sends a comment by accident (thanks to @ChangeHow).
- Official 1.22.2 / Sessions: subagent sessions are found in projects with more than 200 sessions (thanks to @bashrusakh).
- Official 1.22.2 / Permission auto-accept works again with the stable OpenCode (thanks to @bashrusakh).
- Official 1.22.2 / On Windows, the status command and adding a folder to the workspace handle drive-letter case correctly (thanks to @pttydou).
- Official 1.23.0 / Sessions: New sessions and worktree sessions open without false history-loading errors.
- Official 1.23.0 / Settings: A failed screen load no longer triggers a broken reload of the chat.
- Official 1.23.0 / Chat: Forking a user message fills the destination composer with its prompt and attachments while keeping the original session's draft intact (thanks to @karimodm).
- Official 1.23.0 / Chat: Tools interrupted before a reload no longer keep a running timer indefinitely (thanks to @alvins82).
- Official 1.23.0 / Chat: Images attached to a sent message appear only once.
- Official 1.23.0 / Chat: Resizing the chat keeps the latest reply in view when following the end. Sending or collapsing Activity no longer creates a large blank space below it.
- Official 1.23.0 / Chat: Message details adapt to narrow panels without leaving gaps between the model, effort, and duration.
- Official 1.23.0 / Chat: Long Thinking output stays in a capped scroll box while streaming; scrolling upward pauses its automatic scrolling (thanks to @alvins82).
- Official 1.23.0 / Chat: Narrow tables keep their border and toolbar close to the columns (thanks to @ChangeHow).
- Official 1.23.0 / Usage: Failed refreshes keep the last known figures visible with an error, while other providers continue to load.
- Official 1.23.0 / Usage: OpenRouter reports key spending and limits accurately, including monthly spending for unlimited keys (thanks to @leducmaxime).
- Official 1.23.0 / Usage: Ollama Cloud dollar-based plans show monthly spending and extra credits; credential checks reject unreadable usage pages (thanks to @kydorn).
- Official 1.23.0 / Usage: NeuralWatt shows allowance percentages correctly in both used and remaining modes (thanks to @kydorn).
- Official 1.23.0 / Usage: Provider requests have enough time to connect on slower networks, fixing premature "fetch failed" errors (thanks to @ouyangjian28).
- Official 1.23.0 / Scrollbars: Hover reveals scrollbars in chat, Settings, and shared dialogs without moving the content sideways (thanks to @sergiofspedro).
- Official 1.23.0 / Language/Turkish: Activity and input-history settings use consistent agent and prompt terminology (thanks to @fitzgpt).
- Official 1.23.1 (not merged) / Sessions: Saved model, agent, and thinking defaults survive reloads and temporary provider unavailability, and their pickers display saved choices sooner (thanks to @alvins82).
- Official 1.23.1 (not merged) / Chat: The first model you add to favorites stays saved after reloading the panel (thanks to @alvins82).
- Official 1.23.1 (not merged) / Chat: Reloading panels or moving them between windows now closes old background connections, fixing a connection leak.
- Official 1.23.1 (not merged) / Chat: Loading older history keeps your reading position, and the latest message stays in view as the message box grows.
- Official 1.23.1 (not merged) / Chat: Reasoning and shell output continue following incoming text until you scroll up.
- Official 1.23.1 (not merged) / Chat: File lists under answers use the turn's direct edits, reducing unrelated files from other sessions. Show more reveals files beyond the first four (thanks to @yulia-ivashko).
- Official 1.23.1 (not merged) / Chat: Queued quotes and comments show their context in the message preview.
- Official 1.23.1 (not merged) / Chat: Switching projects preserves the available slash commands.
- Official 1.23.1 (not merged) / Sessions: Retention cleanup keeps protected child sessions and avoids false deletion failures for session families.
- Official 1.23.1 (not merged) / Sessions: Enter saves a session rename from the sidebar.
- Official 1.23.1 (not merged) / Projects: Settings save correctly for deeply nested workspace paths (thanks to @yulia-ivashko).
- Personal / Sessions: Scoped loading preserves current session data while preventing inactive projects and stale requests from driving repeated background refreshes (original work by wq.pan; integrated by @CastleYu).
- Personal / Files: File-reference checks retain project scoping and distinguish real directories from files (thanks to @CastleYu).
- Official 1.23.0 / Connections: Unsupported app-only event subscriptions are skipped, avoiding repeated failed authorization and stream requests in standalone webviews.

### Misc

- Official 1.22.1 / The Settings Integrations page, which offered the Claude Code and Cursor plugin installs, is gone.
- Official 1.22.2 / Goal Mode: The official notes also listed length-limit continuation and Resume for the extension. Automatic goal execution requires the app server; the standalone extension does not run that loop (thanks to @bashrusakh).
- Personal / Availability: Native media previews, the Files toolbar, embedded terminal, performance header and managed MCP cleanup belong to the app; the extension does not mount those surfaces.
- Personal / Logs: The shared Logs page requires an OpenChamber log service. A standalone extension has no server log endpoint, so this is not advertised as working standalone log export.
