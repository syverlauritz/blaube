# Blaube

A squishy Claude-orange slime that lives on your desktop. Grab it, toss it, watch it splat against the edges of your screen. It also keeps an eye on your Claude Code sessions: every session (one per terminal) is its own big slime, every subagent it runs splits off as a little slime, and they tell you when Claude is working, needs you, or is done.

*Blau* is German for blue, *blob* is a blob. It's orange now. You can work out the rest.

## What it does

- **What it's doing, at a glance.** While Claude thinks, its slime's thought bubble has a turning gear. While a tool runs, the bubble shows what kind: a magnifier for reading and searching, a pencil for editing, a flask for tests, a tick for a commit, arrows for a push or a pull, a parcel for installing, a bin for deleting, a folder, a globe for the web, a checklist for its to-do list, two little slimes for a helper, a plug for a connected app, and `>_` for any other command (`src/shared/actions.js`). A few moments get a little reaction: a hop and "Pushed!", a happy hop when tests pass, a wince when they fail, a nod for a commit, a sweat drop when it deletes something.
- **They talk.** When a slime says something (a reply, even with its talk box open; "Done", "needs you", "Pushed!", a 👍), it babbles it out loud through a talkbox in a cute made-up language, its mouth opening and shutting with each syllable. The voice is one buzzy synth note per line (saw and square, a little vibrato and grit) gliding between pitches through three resonant "mouth" filters that sweep from vowel to vowel, with a wah on the attack of every syllable. The babble follows the words: one syllable per vowel sound, pauses at commas and full stops, a rise at the end of a question. Bigger slimes have lower, darker voices; helpers are higher. It's all synthesized on the spot with Web Audio (`src/renderer/voice.js`), no sound files. Helpers softly murmur what they're doing as each tool starts; a session's own status bubbles stay quiet. Tickle one (rub the cursor over it) and it giggles. Turn it off with **Sounds** in the menu, or set the volume and the wah in Settings.
- **Choir.** **Play > Choir** and every slime sings a song together, in parts (`src/shared/choir.js`): one slime sings the tune, two add a bass ("bum, doo"), three an alto, four a tenor, five a high "oo" over it all, and more double the parts a hair apart, like a real choir. The biggest slimes take the bottom. They sway to the beat with their eyes shut and little notes float up. Songs (all public domain): Silent Night, Pachelbel's Canon, Ode to Joy, Twinkle Twinkle. Add your own in `src/shared/songs.js` (notes, beats, syllables and chords).
- **Real softbody physics.** Blaube is a ring of point masses held together by springs, gas pressure and shape matching. Every hop, bounce, squash and wobble comes out of the simulation. There are no canned animations.
- **Toss it around.** Grab it anywhere: a damped spring pulls the spot you're holding toward the cursor, so the rest of the body dangles, stretches and swings. Fling it and it bounces off the screen edges, the menu bar, the macOS Dock (its real width, so it can sit beside or on top of it; on newer macOS that needs **Bump into the Dock’s sides…** in the menu, which asks for Accessibility so Blaube can read where the icons are), the Windows taskbar and its own little slimes.
- **One big slime per Claude Code session.** The first session takes over the big slime. Each new one splits off (on a gooey spring) and grows to full size. When a session ends, it hops over and merges into another one. The last one stays as Blaube.
- **One little slime per subagent.** When a session starts a subagent, a little slime splits off that session's big slime, named after the task it was given ("Ring Globe: Manta logo mode"). When the subagent finishes, it hops back to its mother and merges in. Subagents working in their own git worktree are recognised too.
  - **Working:** eyes squeezed shut in concentration, brows that now and then furrow or lift, and a thought bubble with a spinning gear while it thinks, or a `>_` while it runs a tool.
  - **Needs you:** worried face and a "?" bubble. It hops for attention until you look.
  - **Done:** happy face, bounces up and down with a "!" bubble until you look.
  - **You send it a message:** it nods and gives you a 👍.
  - Slimes only jump to get your attention. "Looking" means clicking the slime (to talk or to go to its terminal) or, on Windows, bringing the session's terminal window to the front. Each slime breathes at its own pace, gets sleepy (Z's) when nothing happens, and looks at your cursor when it isn't busy.
- **Hover a slime** to see its session's title, what it's doing right now ("Editing face.js"), and its git branch and model.
- **Size and strain.** A session grows as it uses tokens (its subagents' tokens count too). As its context window fills, it puffs up and goes round and taut, a red flush spreads from its face, then it sweats, and near the limit it strains. `/compact` brings it back.
- **Effort.** Low effort zones out and drools while it works; high effort wears nerd glasses (a hard landing knocks them off, and it goes to fetch them, or drag them back yourself); max effort floats and meditates.
- **Looks.** Each session's slime wears its own little something: a curl, a bow, antennas, horns, cat ears, bunny ears or a sprout, randomly sized and placed, swinging on a spring as it moves. Open sessions don't share a look.
- **Pets.** Every background task a session starts (a dev server, a watcher) becomes a little square pet that hops after its slime and shows a heart when it reaches it. Click a pet to see its command; drag it around. Pets play with each other, and wave goodbye (a hop and a heart) when their task ends.
- **Arrivals.** A new session's slime only appears once Blaube knows its real state (transcript read, old background tasks checked against what's running), then pops out of the middle of the screen in its final colour, look and size. The others turn to look at the newcomer.
- **Play.** Rub the cursor back and forth over a slime or a pet to pet it (hearts!). Fling a slime hard into another and the one that got hit sees stars; a gentle bump gets you a glare. Throw a helper at its mother and she catches it. Helpers squish when a tool starts, rock while they think, glance at their family now and then, follow their mother if she's dragged far away, and celebrate with a heart before they merge back. Long turns get yawns, and a burst of hearts when they finish ("Done in 6m"). A failed tool gets a wince; a compacted context gets a sigh of relief. Yawns are catching. Drop a slime on another's head and the one below glares and shrugs it off (a helper on its mother's head gets to stay for a happy ride). Wiggle the cursor just above an idle slime and it wiggles back, then pounces; catch the cursor and a heart pops out. Drag a slime into others and it shoves them along in one piece; one pinned against the edge squeezes out upwards.
- **Windows are ledges.** Drop a slime (or throw it) so it comes down onto the top of another app's window and it lands softly and stays there; anything going up, or standing in front of a window, passes through. Move the window and whoever is on it rides along; flick it up and they fly off it; yank it away fast and they hang in the air for a surprised moment; close it and they fall. Helpers and pets jump up after their slime. Up there they mind the edge (a mother wanders off now and then). Turn it off with **Land on top of other windows** in Settings. On Windows a small PowerShell helper lists the visible windows; on macOS a JavaScript for Automation loop reads them through CoreGraphics, which needs no permission (`src/main/windows.js`).
- **Bubbles have weight.** Every bubble chases its spot above its slime on a spring and is leashed to it by a short tail (or, for a thought, two trailing puffs).
- **Click a session's slime** (or one of its little ones) to **talk to it**. A white bubble pops out of it with the conversation since Blaube started (what you typed in the terminal, what you sent from the slime, and Claude's replies, with a little formatting) and a field to type in. Your message reaches the session even if you're nowhere near its terminal: a background Stop hook waits for it and wakes Claude up (`src/main/inbox.js`). While it works, little dots and what it's doing right now ("Editing face.js") sit at the end of the log. If Claude is busy, the message goes in at its next step ("at its next step", like typing into the terminal while it works; you can unsend it until then), or when the turn ends if it isn't using tools. Between messages the box shows what Claude did, a quiet line per step ("Read face.js", "Edited talk.js", "Ran npm test", failures in red; tap one to see the change it made, or the command and what it printed), the last few of a long run with the rest a tap away. Under its name, its git status (branch, what's changed, what's not pushed yet), read locally; when it's free, one-tap requests that fit (**Commit**, **Push**, **Open a PR**, **Run tests**, **Pull**, **Fix conflicts**). The ☰ button next to them (or ⌘0) turns the box into an overview of every session: what each is doing and for how long, what it needs from you, its to-do progress, context and git status; tap one to go to it. Below them, start a new session in a recent folder or pick up one of your latest past sessions. Under each reply: how long the turn took, how many steps, and the files it changed (tap one to see it in Finder); replies and code blocks copy with a tap. ⌘F finds things in the conversation, including what its steps printed. A dot per slime in the top corner hops to another session's box (or ⌘1–9, ⌘[ and ⌘]); one that needs you has a red pip. A slash command (`/compact`, `/model`…) typed in the box is typed into the session's Terminal or iTerm tab when it's free (sessions Blaube started get it directly). Paste an image into the field, or drop files on the box, and they go with your message as files Claude can open. Its to-do list sits at the top ("2 of 4 · Running the tests", tap for the whole list), and hovering its slime says how far down the list it is. While it works, **Stop** next to its name stops it before its next step (it says where it got to, and can still hear you after). The slime holds still while you talk, the bubble follows it and sizes itself to what's in it, and replies pop up as a speech bubble when the box is closed. Click the slime again, press Esc or click elsewhere to close it (on macOS, focus goes back to the app you were in).
- **Answer permission prompts from the slime.** When Claude asks to run something, the slime's bubble shows exactly what (the command, or the file and what changes) with **Deny** and **Allow**, plus **Always allow …** naming the rule Claude Code suggests. The terminal shows its own prompt at the same time; whichever you answer first wins. Claude's multiple-choice questions come to the slime too (tap an answer, or type your own), and so do its plans in plan mode (**Go ahead**, or **Keep planning** with what to change). Sessions without a terminal (`claude -p`, the SDK) are never held up.
- **⌘⌥B** (Ctrl+Alt+B on Windows), from any app, opens the talk box of the slime that needs you most (waiting on you, then just finished, then busy); press it again to close it. With no sessions, it starts a new one.
- **Notifications when you can't see them.** With the slimes behind your windows, a session that needs you, or finishes after a while, sends a system notification; click it to talk to that slime. Off with **Notify me when they’re behind windows** in the menu.
- **Pick up a past session**, in Blaube's menu, lists your latest Claude Code sessions on this computer (title, folder, how long ago). Pick one and it carries on in Blaube with no terminal (`claude --resume`), its talk box showing how the conversation ended.
- **Progress you can feel.** Each to-do item a session ticks off gets a little hop ("✓ 2 of 4"), a finished list a proper one ("All 4 done!"); pressing Stop makes it dig in and squash down like braking.
- **Keyboard.** On a permission or plan card, ⌘↩ allows (or goes ahead), ⇧⌘↩ always allows, ⌘⌫ denies; arrow keys move between a question's options and number keys pick one. The talk box tells screen readers about new replies and cards, and calms its own animations when the system asks for reduced motion.
- **Start a session from Blaube, no terminal needed.** **New session…** in Blaube's menu (or **New session in** a recent folder) starts Claude Code in the folder you pick, in print mode with streaming input and output (`src/main/owned.js`). Its slime pops out with its talk box open; what you type goes straight in, even while it's working. Permission prompts, questions and plans come to the slime like any other session's. **End session** or **Continue in terminal** (it resumes there with `claude --resume`) are in its right-click menu; quitting Blaube asks first, since its sessions stop with it.
- **Sessions that started before you connected** (or updated the connection) can still be talked to on macOS: when such a session is idle at its prompt in Terminal or iTerm, Blaube types your message into its tab for you (macOS asks once whether Blaube may control Terminal). Elsewhere, restart the session.
- **Alt-click a session's slime** (or the **>_** button that shows when you hover the top of its talk box) to jump to that session. On macOS it brings the terminal/editor the session runs in to the front (Terminal, iTerm, VS Code, Cursor, Warp, Ghostty, WezTerm). On Windows it brings the session's own window to the front, and in Windows Terminal it also picks the right tab. It never opens a new terminal: if Blaube can't find the window, the slime tells you, and **Resume in a new terminal** is in its right-click menu.
- **Right-click a session's slime** for **Talk**, **Go to its terminal**, its **Colour** (orange, blue, green, purple, pink, yellow; it sticks to the project folder), and for its status, "Resume in a new terminal", "Copy resume command", "Open project folder" and "Hide this slime" (until that session really ends).
- **With no sessions**, click Blaube for a summary. Right-click it (or use the tray/menu bar icon, or the **Blaube** item in a session's menu) for settings, including **Colour** and **Live on display** to pick which screen it lives on.
- **Settings…** (in that menu) has the everyday settings: overall **Size**, the **Name font** (the slime names in bubbles; everything else is Nunito), whether status bubbles pop up by themselves or only on hover, **Fun looks** on or off, **Babble out loud** with its volume and wah, and **Stay in front of other windows** (also a checkbox in the menu: off puts the slimes behind your windows, like the desktop, when you need to see all of one).

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

Then right-click Blaube and choose **Connect Claude Code…** (the slime reminds you on first run). That adds Blaube's hooks to `~/.claude/settings.json` (a backup is saved as `settings.json.blaube-backup`, and your existing hooks are kept). Restart any running Claude Code sessions to pick them up. **Claude Code → Disconnect…** removes exactly what was added. If Claude Code isn't installed, Blaube says so and offers **Install Claude Code…**.

Want to see it without Claude running? Choose **Play → Demo sessions** from the menu.

### Your first five minutes

1. Connect (above), then start or restart a Claude Code session: its slime pops out.
2. Hover a slime for its name and what it's doing; **click** it to talk to the session; **⌥/Alt-click** to jump to its terminal; **right-click** for everything else.
3. When Claude asks for permission, a question or a plan, answer on the slime (or in the terminal; first answer wins).
4. **New session…** in Blaube's menu starts one with no terminal at all.
5. Throw them around. They like it.

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

The window covers the screen's work area but lets clicks pass through everywhere except the slimes themselves.

**Clicks on Windows (don't undo this).** The window's own mouse events can't be trusted on Windows: after a while it simply stops receiving them, even while it's set to catch clicks (seen in the logs many times). So:

- The window reports where grabbable things are (slimes, pets, dropped glasses) as boxes, a few times a second.
- The app polls the cursor 60 times a second and switches click-catching on over those boxes (re-applying it every half second), so clicks there never fall through to apps underneath.
- A small PowerShell helper watches the mouse buttons system-wide; the app turns presses that start over a slime into `pointer` events for the window, and sends the cursor position for dragging and for the eyes.
- Live reload (`npm start` while developing) always restarts the whole app; reloading just the window made clicks fall through.

On macOS and Linux the window's own mouse events are used. Problems that only show on a real desktop are logged to `blaube.log` in the app's data folder (clicks, the click-catching switch, going to a session's window).

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

## Known open issues

- Pressing a slime straight down onto another still squashes it (on purpose, for now).
- The voice and choir were checked by measurement (pitch, levels, harmony notes in their chords) and by the creative director's ears; the talking mouth passed two judge rounds, the choir picture one look, not a full judge round yet.
- `npm run e2e` sometimes fails at "clicking it again closes it" (a second click on the slime doesn't close its box, and the checks after it fail too); a rerun passes. Not tracked down yet.
- The "Phew" on compaction and the "oops" wince on failed tools haven't been seen on a real session yet (the picture rig can't fake them).
- Effort comes from the transcript; if it hasn't said yet, the `effortLevel` in `~/.claude/settings.json` is used (sessions often run at medium even when that says high).

## Ideas for later

- Roaming across multiple monitors (for now, pick one with **Live on display**).
- Showing cloud sessions, if Anthropic ever offers a local, token-free way to read their status.
- Feeding, more tricks.
