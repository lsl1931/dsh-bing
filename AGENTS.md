# Repository rules for dsh-bing

These rules apply to every file in this repository. Read them before changing code.

## Hard constraints

- **Zero runtime dependencies.** The host half is plain ESM; the client half is a raw CJS body wrapped by build.mjs. Do not add TypeScript, JSX, zod, rolldown, or a bundler.
- **Never modify the DSH installation or profile config from this repository.** Installation is a user-run link command documented in README.
- **lib/ is committed.** A profile links this directory, so the built host and client files must always match src/.
- **Sounds are generated, not hand-edited.** Change the recipe in scripts/generate-sounds.mjs, run npm run sounds, and commit the wavs. npm run sounds:check must pass.
- **The single source for the built-in sound list is sounds/catalog.json.** Do not duplicate labels in code; the settings UI reads the catalog through the host route.

## Measured constraints (do not "optimise" these away)

These come from the reference implementation's field notes and are load-bearing on this machine:

- The toast child must keep piped stdio and drain it. stdio: 'ignore' starts and exits cleanly but Windows shows no toast.
- The toast is raised from Windows PowerShell 5.1; use its absolute path, not a bare powershell name.
- File sounds must play through System.Media.SoundPlayer. WinRT/WPF/WMP cannot open a media file from a spawned child here.
- A toast's audio element only accepts ms-winsoundevent values. To play your own sound, mute the toast and play it in the host.
- The AUMID is electron.app.DeepSeek Harness; the click path is dsh://open.
- document.hasFocus() is not trustworthy (the question view steals focus). Ask the host for the OS foreground answer and keep a short grace window.
- The projection fold must return the SAME state reference for events it does not handle; the registry gates change notifications on Object.is.
- Client-visible routes are outside /api, so each handler owns its method + same-origin header check.
- Service-level asks (plan review) never reach the session log; observe user-questions/request with { global: true } on the host and poll from the client.
- Logged asks already have a client-visible projection: userQuestions (active[{callId,questions,state:open|continued}] + settled). Read it; do not fold ask_user_question again, and treat a continued ask as still waiting. If a Session has no userQuestions projection, fall back to the host /questions queue for all its asks.
- The host toast click path is only dsh://open. It raises the window; it cannot jump to a Session. Do not promise a jump in UI or docs.
- Projection definitions must set stateVersion, and the wire view must be cached in state: the registry compares views with Object.is, so a fresh object per apply re-notifies every client on every event.
- SAFE_SOUND_NAME must reject '.' and '..' segments explicitly, not only separators.

## Architecture boundaries

- Host: src/index.js + src/shared/*. It owns the projection, routes, toast, and audio.
- Client: src/client/*. It owns the session watcher, copy, settings, and UI. It never spawns processes and never receives a filesystem path from the host.
- Shared wire constants live in src/shared/protocol.js and are duplicated in src/client/protocol.js because the client bundle is CJS. Keep them identical; a test should compare them once both exist.

## UI rules

- Mount the sound pickers in both settings.section (id bing) and settings.plugins.tab (id bing-sounds). The tab lives in the Settings Plugins page (the built-in plugins section), not the desktop shell's top-level plugin manager, which exposes no slot; the Settings section is the complete page and the fallback if the tab slot changes.
- Use DSH design tokens (var(--dsw-alias-...)); do not hard-code light/dark colours.
- No layout shift: the picker opens as an overlay panel, max-height 320px with scroll.
- Every preview plays only the sound, never a toast.
- All UI copy goes through the plugin locale namespace (zh + en).

## Quality gates

Before a commit:

    npm run check

- Every pure function gets a node:test case when it is added (project label, summary, decision, settings clamp, schema).
- New route: test method rejection, missing header rejection, oversized body, and the happy path with fake req/res.
- New sound: update catalog.json, run npm run sounds, confirm npm run sounds:check, listen to it before committing.

## Commit style

- Conventional prefixes: feat:, fix:, chore:, docs:, test:.
- One concern per commit. Scaffold, sound pack, and each milestone land separately.
- Do not commit node_modules, .tmp, or editor droppings.