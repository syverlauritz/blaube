# Developing Blaube

## Running from source

```sh
npm install
npm start
```

That runs whatever branch your checkout is on. Blaube's menu says which branch it's from and how far behind `main` it is, and a notification says so when it's behind.

### Blaube (dev) on Windows: always the newest main

```powershell
powershell -ExecutionPolicy Bypass -File scripts\dev\install.ps1
```

This puts **Blaube (dev)** in the Start menu and on the desktop. It runs Blaube from a folder of its own, `.run-main` next to `.git`, which is always exactly `origin/main`. Each launch fetches main, runs `npm ci` when `package-lock.json` changed, and starts Blaube with no terminal. Your own checkout's branch doesn't matter. If a Blaube is already running, it's asked to stop and the newest main starts in its place; the sessions it started come back. (Quitting from Blaube's menu lets them go.)

## Scripts


```sh
npm test                 # physics, session tracking, transcripts, looks and hook installer tests
npm start                # run the app (it restarts itself when you change its code)
npm run shots            # render every scene to shots/*.png, for reviewing the look
npm run e2e:life         # the real app, invisible, through fake hooks: the blobs' life and voice (no tokens)
npm run e2e:jar          # the snack jar, with made-up usage: hover, drag and keep, a cookie into a mouth, empty and refill
BLAUBE_DEMO=1 npm start  # run with fake sessions
npm run dist:mac         # build the .dmgs and update zips (on macOS; ad-hoc signed, never uses your keychain)
npm run build:mac:local  # just build dist/mac-*/Blaube.app
npm run dist:win         # build the installer, for x64 and ARM (on Windows)
BLAUBE_TEST=scripts/e2e/steer.js BLAUBE_PORT=47873 npx electron .  # the real app, invisible: steps, Stop, mid-turn messages, slash commands, the overview (no tokens)
BLAUBE_TEST=scripts/e2e/owned.js BLAUBE_PORT=47876 npx electron .  # a session Blaube started, against a stand-in for Claude Code: /model, /plan, ⇧⇥ modes, Stop at once, bringing one in from a terminal (no tokens)
BLAUBE_TEST=scripts/e2e/many.js BLAUBE_PORT=47874 npx electron .   # load: a dozen busy sessions at once, and nothing kept once they’re gone
BLAUBE_TEST=scripts/e2e/media.js BLAUBE_PORT=47961 npx electron .  # pictures in the talk box: what shows (and what never does), big on a tap, drawing on one (no tokens)
BLAUBE_TEST=scripts/e2e/keep.js BLAUBE_PORT=47962 npx electron .   # Keep as a command and Repeat…: kept in the project, suggested after /; a routine listed, run now (a stand-in for Claude Code) and stopped (no tokens)
node scripts/make-icons.js  # re-render the icons (needs playwright)
```

Set `BLAUBE_PORT` to use a different port; reconnect Claude Code afterwards so the hooks point at it.

**End-to-end scripts** (`scripts/e2e/`) run the real app invisibly, with fake hooks and a stand-in for Claude Code, so they cost no tokens (only `start` uses the real one, on Haiku). Each is `BLAUBE_TEST=scripts/e2e/<name>.js BLAUBE_PORT=<port> npx electron .`, run one at a time from Git Bash on Windows (or any shell on macOS); the port is in the script's header, and it exits non-zero on a failure. `talk`, `start`, `life`, `grab`, `blobs` and `jar` also have `npm run e2e…` shortcuts (`npm run e2e` is `talk`).

| Script | Checks |
| --- | --- |
| `life` | the blobs themselves: healthy bodies, a turn's end said once, the choir, away/charger/battery reactions |
| `talk` | talking to a blob: clicking it, the talk box, the inbox and permission hooks |
| `opens` | opening the talk box over and over, including Windows handing the focus straight back |
| `perch` | blobs sitting on talk boxes, riding them, falling when they close, staying in front |
| `grab` | picking a blob up at any moment of a hop, trick or somersault |
| `blobs` | the Blobs overview: eyes to show and hide, helpers, Max blobs |
| `menus` | right-click and tray menus: order, per-blob tray submenus, sound options |
| `jar` | the snack jar with made-up usage: hover, drag, a cookie into a mouth, empty and refill |
| `caret` | a blob's eyes following the caret while you type |
| `helpers` | helpers whose stop never arrives still go home; the talk box lists the same ones |
| `giveup` | helpers that truly can't reach their mother give up and rest |
| `crowd` | crowded blobs grumble and spread out, up onto window tops |
| `history` | a session's conversation from its transcript, Show earlier |
| `quiet` | blobs never nag: one "needs you" per wait, no repeated "okay!" |
| `steer` | steering a session from its talk box while it works |
| `owned` | a session Blaube started, against a stand-in for Claude Code |
| `many` | load: a dozen busy sessions at once |
| `start` | a real, cheap session started from Blaube |

How the look is decided and reviewed: `docs/DESIGN.md` (the brief, including what the creative director has decided) and `docs/REVIEW.md` (render, independent judges, fix, repeat). Problems that only show on a real desktop are logged to `blaube.log` in the app's data folder.

## The trailer

The trailer in the README is the real app, played live on a portrait screen and recorded (Windows, with ffmpeg in `C:\ffmpeg\bin`):

```sh
BLAUBE_FILM=scripts/film/trailer.js BLAUBE_PORT=47890 npx electron .  # plays every shot and records the screen (FILM_ONLY=pipe,chat for some of them)
node scripts/film/cut.js     # cuts the take to the song’s bars -> scripts/film/out/blaube-trailer.mp4
node scripts/film/sheet.js   # a contact sheet of each shot, to check a take without watching it
```

Film mode (`BLAUBE_FILM`) is test mode that can be seen and heard. The blobs only move by their physics; the cards are real windows, and the sky is a window behind them (no wallpaper is changed). The music (`scripts/film/music/`) and the recordings (`scripts/film/out/`) are not in the repository.

## Talking to Claude Code: official ways only

Blaube never calls Anthropic or claude.ai itself, never uses an API key and never reads your keychain. It talks to Claude Code only, and only in ways Anthropic supports:

- **The `claude` command and its documented options** (`-p`, `--input-format stream-json`, `--resume`, `--fork-session`, `--session-id`, `--model`, `--permission-mode`, `--tools`, …) and its own subcommands (`claude auth status|login|logout`, `claude mcp add|remove|login|list`, `claude plugin …`, `claude doctor`, `claude update`).
- **Hooks** in `~/.claude/settings.json` that post to Blaube on `127.0.0.1` (Claude Code's documented HTTP hooks).
- **Control requests** on a session it started, only the ones Anthropic's Agent SDK (`@anthropic-ai/claude-agent-sdk`) exposes as methods on `Query`: `initialize` (version, models, account), `interrupt`, `set_permission_mode`, `set_model`, `apply_flag_settings`, `mcp_status`, `mcp_reconnect`, `mcp_toggle`, `get_context_usage`, `reload_plugins`, `rewind_files`, `stop_task`, `background_tasks`. One more, `get_usage` (the snack jar's usage limits), is in the SDK's types but marked experimental and has no method.
- **Your own files on disk**: session transcripts, settings, CLAUDE.md and memory files.

Before adding a new control request, check that the Agent SDK has a public method for it (in its `sdk.d.ts`). Ones that only Claude Code's own screens use can change or vanish in any update.

## Releasing

1. Move the notes under **Unreleased** in `CHANGELOG.md` into a new `## [x.y.z] - date` section and commit.
2. `npm run release` (a minor version, 0.2.0 → 0.3.0) or `npm run release:patch` (0.2.0 → 0.2.1). It bumps `package.json`, commits, tags `vx.y.z` and pushes.
3. CI tests it, builds the Mac and Windows installers, and publishes the release with that changelog section as its notes. Installed copies see it within four hours.

The release carries the installers, the Mac zips and the update feeds (`latest.yml`, `latest-mac.yml`) with their blockmaps; don't remove those, or installed copies stop updating.


## Signing and notarizing the Mac build

The Mac build is ad-hoc signed, so it runs but macOS asks once. To make it open with no warning, CI signs and notarizes automatically when these repository secrets are set:

| Secret | What it is |
| --- | --- |
| `MAC_CERT_P12_BASE64` | Your **Developer ID Application** certificate exported as `.p12`, base64-encoded |
| `MAC_CERT_PASSWORD` | The password you set when exporting the `.p12` |
| `APPLE_ID` | Your Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | An app-specific password from appleid.apple.com |
| `APPLE_TEAM_ID` | Your 10-character team ID from developer.apple.com |

This needs a paid Apple Developer Program membership (99 USD/year). Windows signing (to calm SmartScreen) needs a separate code-signing certificate.

On Windows, Claude Code runs hooks through Git Bash, which has `curl`. On macOS `curl` is built in.

