# Changelog

Each release's notes on GitHub come from its section here (`.github/workflows/build.yml`).

## [Unreleased]

- Settings has "How sessions talk": the style every session you start in Blaube is asked to reply in, yours to change (and "Back to Blaube's own" to undo).

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
