# Blaube

A squishy Claude-orange slime that lives on your desktop. Grab it, toss it, watch it splat against the edges of your screen. It also keeps an eye on your Claude Code sessions: every session (one per terminal) is its own big slime, every subagent it runs splits off as a little slime, and they tell you when Claude is working, needs you, or is done.

*Blau* is German for blue, *blob* is a blob. It's orange now. You can work out the rest.

## What it does

- **Real softbody physics.** Blaube is a ring of point masses held together by springs, gas pressure and shape matching. Every hop, bounce, squash and wobble comes out of the simulation. There are no canned animations.
- **Toss it around.** Grab it anywhere: a damped spring pulls the spot you're holding toward the cursor, so the rest of the body dangles, stretches and swings. Fling it and it bounces off the screen edges, the menu bar, the macOS Dock (its real width, so it can sit beside or on top of it), the Windows taskbar and its own little slimes.
- **One big slime per Claude Code session.** The first session takes over the big slime. Each new one splits off (on a gooey spring) and grows to full size. When a session ends, it hops over and merges into another one. The last one stays as Blaube.
- **One little slime per subagent.** When a session starts a subagent, a little slime splits off that session's big slime, named after the task it was given ("Ring Globe: Manta logo mode"). When the subagent finishes, it hops back to its mother and merges in. Subagents working in their own git worktree are recognised too.
  - **Working:** eyes squeezed shut in concentration, brows that now and then furrow or lift, and a thought bubble with a spinning gear while it thinks, or a `>_` while it runs a tool.
  - **Needs you:** worried face and a "?" bubble. It hops for attention until you look.
  - **Done:** happy face, bounces up and down with a "!" bubble until you look.
  - **You send it a message:** it nods and gives you a 👍.
  - Slimes only jump to get your attention. "Looking" means clicking the slime or, on Windows, bringing the session's terminal window to the front. Each slime breathes at its own pace, gets sleepy (Z's) when nothing happens, and looks at your cursor when it isn't busy.
- **Hover a slime** to see its session's title, what it's doing right now ("Editing face.js"), and its git branch and model.
- **Size and strain.** A session grows as it uses tokens (its subagents' tokens count too). As its context window fills, it puffs up and gets firmer, a red flush spreads from its face, then it sweats, and near the limit it strains. `/compact` brings it back.
- **Effort.** Low effort zones out and drools while it works; high effort wears nerd glasses (a hard landing knocks them off, and it goes to fetch them, or drag them back yourself); max effort floats and meditates.
- **Looks.** Each session's slime wears its own little something: a curl, a bow, antennas, horns, cat ears, bunny ears or a sprout, randomly sized and placed, swinging on a spring as it moves. Open sessions don't share a look.
- **Pets.** Every background task a session starts (a dev server, a watcher) becomes a little square pet that hops after its slime and shows a heart when it reaches it. Click a pet to see its command; drag it around.
- **Click a session's slime** (or one of its little ones) to jump to that session. On macOS it brings the terminal/editor the session runs in to the front (Terminal, iTerm, VS Code, Cursor, Warp, Ghostty, WezTerm). On Windows it brings the session's own window to the front, and in Windows Terminal it also picks the right tab. A click never opens a new terminal: if Blaube can't find the window, the slime tells you, and **Resume in new terminal** is in its right-click menu.
- **Right-click a session's slime** to pick its **Colour** (orange, blue, green, purple, pink, yellow; it sticks to the project folder), and for its status, "Resume in new terminal", "Copy resume command", "Open project folder" and "Merge back in".
- **With no sessions**, click Blaube for a summary. Right-click it (or use the tray/menu bar icon, or the **Blaube** item in a session's menu) for settings, including **Colour** and **Live on display** to pick which screen it lives on.
- **Settings…** (in that menu) has the everyday settings: overall **Size**, the **Font**, whether status bubbles pop up by themselves or only on hover, and **Fun looks** on or off.

## Hidden tuning panel

Press **⌘⌥⇧B** (Ctrl+Alt+Shift+B on Windows), or **Option/Alt + right-click** a big slime. Every parameter (colour, sizes, all the physics, dragging, hops, Dock collision, a physics debug overlay) has a live slider. **Copy config** puts the current values on the clipboard as JSON (the full config plus just what you changed), ready to paste back to Claude to bake in as the new defaults. **Paste config** applies a JSON blob. Settings are saved between launches.

## No API tokens

Blaube never calls the Anthropic API. The physics runs locally, and session status comes from two local sources:

- [Claude Code hooks](https://docs.claude.com/en/docs/claude-code/hooks) that `curl` each event to a tiny server Blaube runs on `127.0.0.1:47821`. These give the richest status, including "needs you". If Blaube isn't running, the hooks just do nothing.
- `claude agents --json`, polled every few seconds, which lists the Claude Code sessions running on this machine as busy or idle. This works even before you connect the hooks.

Only sessions running **on your computer** can show up. Chats in the Claude apps and cloud sessions (claude.ai/code, Projects threads) run on Anthropic's servers and can't reach Blaube.

### Checking the connection

```sh
grep -c blaube ~/.claude/settings.json          # hooks installed? (> 0)
curl http://127.0.0.1:47821/blaube/ping           # Blaube listening?
echo '{"session_id":"test","hook_event_name":"UserPromptSubmit","cwd":"/tmp/test"}' \
  | curl -s --data-binary @- http://127.0.0.1:47821/blaube/hook   # a "test" slime should split off
```

## Getting started

Download the latest build from the [latest release](https://github.com/syverlauritz/blaube/releases/tag/latest), no GitHub login needed:

- macOS: [Apple Silicon](https://github.com/syverlauritz/blaube/releases/download/latest/Blaube-mac-arm64.dmg) · [Intel](https://github.com/syverlauritz/blaube/releases/download/latest/Blaube-mac-x64.dmg)
- Windows: [x64](https://github.com/syverlauritz/blaube/releases/download/latest/Blaube-Setup-windows-x64.exe) · [ARM](https://github.com/syverlauritz/blaube/releases/download/latest/Blaube-Setup-windows-arm64.exe)

Or run from source:

```sh
npm install
npm start
```

Then right-click Blaube and choose **Connect Claude Code…**. That adds Blaube's hooks to `~/.claude/settings.json` (a backup is saved as `settings.json.blaube-backup`, and your existing hooks are kept). Restart any running Claude Code sessions to pick them up. **Disconnect Claude Code** removes exactly what was added.

Want to see it without Claude running? Choose **Demo sessions** from the menu.

### First launch (builds aren't notarized yet)

- **macOS:** open Blaube once and dismiss the warning ("Apple could not verify…"). Then go to **System Settings → Privacy & Security**, scroll down to "Blaube was blocked" and click **Open Anyway**. (On recent macOS, right-click → Open no longer skips this.) Or in Terminal: `xattr -dr com.apple.quarantine /Applications/Blaube.app`
- **Windows:** SmartScreen may warn you. Choose **More info → Run anyway**.

#### Signing and notarizing the Mac build

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

## How it works

| Piece | File |
| --- | --- |
| Softbody physics (Verlet, edge springs, bending, pressure, shape matching, wall and body collisions) | `src/renderer/softbody.js` |
| Drawing: body, face, bubbles, pets, effects | `src/renderer/face.js` |
| Looks (accessories) and their springs | `src/renderer/looks.js` |
| Token usage, context fill, effort, title/branch/model and background tasks from transcripts | `src/main/usage.js` |
| Which background tasks are still running | `src/main/tasks.js` |
| Settings window | `src/settings/` |
| Slimes, splitting/merging, behaviour, mouse input | `src/renderer/renderer.js` |
| Transparent always-on-top click-through window, tray, menus, display choice | `src/main/main.js` |
| Window placement and Dock detection | `src/main/dock.js` |
| `claude agents` poller | `src/main/agents.js` |
| Tunable parameters and their ranges | `src/shared/config.js` |
| Hidden tuning panel | `src/tuning/` |
| Session state machine from hook events | `src/main/sessions.js` |
| Local hook server | `src/main/hookServer.js` |
| Installing/removing hooks in `~/.claude/settings.json` | `src/main/claudeHooks.js` |

The window covers the screen's work area but lets clicks pass through everywhere except the slimes themselves. The window tells the app where the slimes are; the app watches the cursor and switches click-catching on and off itself (re-applying it while you're over a slime), so a click never gets lost.

## Development

```sh
npm test                 # physics, session tracking, transcripts, looks and hook installer tests
npm start                # run the app (it restarts itself when you change its code)
npm run shots            # render every scene to shots/*.png, for reviewing the look
BLAUBE_DEMO=1 npm start  # run with fake sessions
npm run dist:mac         # build a .dmg (on macOS; ad-hoc signed, never uses your keychain)
npm run build:mac:local  # just build dist/mac-*/Blaube.app
npm run dist:win         # build an installer (on Windows)
node scripts/make-icons.js  # re-render the icons (needs playwright)
```

Set `BLAUBE_PORT` to use a different port; reconnect Claude Code afterwards so the hooks point at it.

How the look is decided and reviewed: `docs/DESIGN.md` (the brief, including what the creative director has decided) and `docs/REVIEW.md` (render, independent judges, fix, repeat). Problems that only show on a real desktop are logged to `blaube.log` in the app's data folder.

## Ideas for later

- Type to a session straight from its slime (via a Claude Code channel/plugin).
- Roaming across multiple monitors (for now, pick one with **Live on display**).
- Showing cloud sessions, if Anthropic ever offers a local, token-free way to read their status.
- Sounds, feeding, more tricks.
