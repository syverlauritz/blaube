# Changelog

Each release's notes on GitHub come from its section here (`.github/workflows/build.yml`).

## [Unreleased]

## [0.7.0] - 2026-11-11

- **More than one Claude account** (work and personal, each in its own `~/.claude-<name>` folder): connecting asks which to connect, and **Claude Code** in the menu has a checkbox per account, **New sessions start as**, and **Sign in…** per account. Past sessions from every account can be picked up.
- On Windows, the talk box no longer freezes half faded in when you click a blob.
- Under each reply in the talk box, the time it came ("14:32", "Yesterday 14:32", "3 Nov 14:32"), before how long it took.
- While you're typing in any talk box, the other blobs keep still (their "!" stays up) instead of hopping for you.
- The talk box's git and tools panel is folded into one line, and can be hidden.
- Sign-in and connect rows for MCP servers can be hidden: **Hide** on each, **Hide all** for several, and Blaube remembers.
- A new session stuck while another Claude Code refreshes its sign-in says it's starting up, and starts again by itself (with what you sent meanwhile) if it gives up.
- A restart asked for before Blaube had brought its sessions back no longer forgets them.
- Haiku's freckles are spread apart, so each reads as its own dot.
- Every Windows installer is now installed and started in CI before it's published.

## [0.6.0] - 2026-11-10

- A blob that's done bounces for a few seconds, then rests with its "!" until you look (it used to bounce until you did). One whose turn ended with a build or other job still running in the background doesn't bounce at all: it's only paused. **Done bounces for** in the tuning panel sets how long.
- A session Claude Code didn't name gets a short name from Haiku, once, from what you first said, so two sessions in one repo are easy to tell apart (a `/rename` still wins).
- Hovering a blob shows only what helps you pick one: its title with the repo under it, its branch, how long it's been at it, its plan, and its context once it's nearly full.
- Sessions are told the talk box shows pictures, so they name the image file instead of its folder.
- Blaube no longer logs a faces note every minute or keeps pictures of the stage (they were for hunting the missing blush).
- **Screenshot** by the talk box's field: pick a part of the screen (as ⇧⌘4 does on a Mac, or the Snipping Tool on Windows) and it goes with your message as a picture, with no saving and dragging.
- **Repeat…** under anything you said has it done again by itself, every day, on weekdays or every hour, each time in a fresh session in that folder (while Blaube is open; one it missed runs when Blaube is back). **All sessions** lists them, with **Run now** and **Stop**.
- A session working in its own worktree gets **Bring into main** (or whichever branch the project's folder is on) once it has commits there isn't: merged right there, no model call, and a conflict calls it off and asks Claude instead. Ending such a session takes its worktree away if nothing in it would be lost (its branch too, once merged).
- **Read aloud** on a reply (on hover) reads it out in your computer's own voice, code and links left out; tap again to stop.
- **Keep as a command** under anything you said: name it, keep it for you or for the project, and `/its-name` says it again in any box (or terminal).
- Right-click a blob for New look (another accessory, at random) or Remove look.
- About one blob in three is plain (no look), up from one in five.
- Install with one line: `install.sh` (Mac) and `install.ps1` (Windows) download the newest release, install it and open it, with no "unverified developer" step. Run again to update.
- The demo sessions, screenshots and tests use made-up project names.
- New look always gives a blob a different look (1 in 8 times it changed nothing), and Remove look is greyed out on a plain blob.
- One bad moment in a blob's behaviour no longer freezes every blob for good, and a blob whose shape ever breaks is put back instead of vanishing.
- Claude Code's settings.json (and Blaube's own settings) are written whole or not at all, and a settings.json that's a link (dotfiles) stays a link.
- Pasting a picture over 20 MB, or a TIFF from Preview, in the talk box works (it did nothing before), and one that can't be added says so.
- Sessions show up even when your login shell prints a greeting or colours before `claude agents`.
- On Windows, stopping a session that had already ended can no longer stop another program that got its process number.
## [0.5.1] - 2026-10-29

- Most blobs wear a look again (a bow, ears, antennas...): only about one in five is plain, down from half.
## [0.5.0] - 2026-10-29

- Blobs no longer slide off to the right by themselves (a stiffer skin made them slowly roll that way).
- Switched to "Don't ask", a blob cheers like it means it: a short rising "woo", then a long "hoooo" falling from up high, a bit higher and louder than it talks.
- Big photos (a camera's, up to 60 MB) show as a little picture by the field, and a picture that isn't ready the moment you send it is asked for again instead of left out.
- Settings has "How sessions talk": the style every session you start in Blaube is asked to reply in, yours to change (and "Back to Blaube's own" to undo).
- Four more songs for the choir to sing together: Unchained Melody, Careless Whisper (the sax part), I Will Always Love You and Yesterday.

## [0.4.0] - 2026-10-29

- Pictures in the talk box: what you attach shows as a little picture (and in your message once sent), and pictures Claude makes or points at show in its reply. Tap one to see it big, or draw on it (pen, arrow, box, words) and add the drawing to your message.
- A new blob wears the effort its session really runs at from the start, so it no longer shows up with glasses that fall off the moment you talk to it.
- A helper blob wears its own model's face (Sonnet, Haiku...), not always its mother's.
- On a Mac, Blaube tells you once when a new version is out, with a button to download it.
- Sung notes are flat, with no white outline, and blobs' skin is a little stiffer to stretch.
- A helper asking for permission no longer changes its mother's mode under her talk box (a "Don't ask" session showed "Auto mode"). Mode changes are logged in `blaube.log` with what caused them.

## [0.3.0] - 2026-10-28

- Sessions you start in Blaube survive it restarting (an update, a crash): they come back with their conversation, and one that was mid-turn is told to carry on. Blaube never restarts on one that's still working, asking you something or waiting on its helpers, and one that finished while you were away comes back still done, saying what it did.
- A picked-up session starts in the permission mode it had, and there's a "Don't ask" mode for sessions Blaube starts (⇧⇥ in the talk box, with a warning first).
- The choir sings better: in tune from the very first note, no clicks, a crisper attack, and each singer a little its own. Three new songs: Somewhere Over the Rainbow, Fly Me to the Moon and Can't Help Falling in Love, and La Vie en Rose from a real transcription.
- Tidier menus: Settings and Sound in their own submenus, New session lists your recent folders, a session's extras under Session.
- Seasons and weather (leaves, snow, butterflies, bats...) can be turned off in Settings.
- A blob hopping for your attention holds still when your cursor comes near, so it's easy to catch.

## [0.2.0] - 2026-10-27

The first release.

- A softbody blob on your desktop for every Claude Code session, and a little one for every subagent, showing at a glance whether it's working, needs you or is done.
- Talk to a session from its blob: the conversation, permission prompts, questions and plans, answered right there.
- Start new sessions from Blaube, no terminal needed, or pick up a past one.
- The snack jar shows your Claude usage limit as cookies (your 5-hour session, or the week once that's over 75% used); they tumble about when you shake, tip or drop it.
- Shake a blob too hard and it turns green, swells up and barfs. Swear at it and it's scared and sad.
- Settings for Size (down to 0.3) and Liveliness, from calm to twice as lively.
- They babble what's in their bubbles in a made-up language, and sing together.
- Updates itself: on Windows it installs new versions when you quit; on a Mac it tells you a new version is out (installing it for you needs a signed build).
