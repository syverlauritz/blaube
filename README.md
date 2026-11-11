<p align="center"><img src="docs/img/blobs.png" alt="Five orange Blaube blobs in a row, wearing a curl, horns, cat ears, antennas and a bow; two have thought bubbles with turning gears" width="720"></p>

<h1 align="center">Blaube</h1>

<p align="center"><b>A squishy desktop buddy that keeps an eye on your Claude Code sessions.</b><br>
Every session is a soft little blob on your screen. It shows you what Claude is doing, tells you when it needs you, and you can talk to it right there.</p>

<p align="center">
  <a href="https://github.com/syverlauritz/blaube/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/syverlauritz/blaube?color=D97757&label=download"></a>
  <a href="https://github.com/syverlauritz/blaube/actions/workflows/build.yml"><img alt="Build" src="https://img.shields.io/github/actions/workflow/status/syverlauritz/blaube/build.yml?branch=main"></a>
  <img alt="macOS and Windows" src="https://img.shields.io/badge/macOS%20%C2%B7%20Windows-555">
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/github/license/syverlauritz/blaube?color=555"></a>
</p>

<p align="center">
  <a href="https://github.com/syverlauritz/blaube/releases/latest/download/Blaube-mac-arm64.dmg"><b>Download for Mac (Apple Silicon)</b></a> ·
  <a href="https://github.com/syverlauritz/blaube/releases/latest/download/Blaube-mac-x64.dmg">Mac (Intel)</a> ·
  <a href="https://github.com/syverlauritz/blaube/releases/latest/download/Blaube-Setup-windows.exe"><b>Download for Windows</b></a>
</p>

<p align="center">Or install with one line (no security warnings to click through): <a href="#install-with-one-line">see how</a></p>

---

## What Claude is doing, at a glance

Each Claude Code session (one per terminal) is its own blob, and its thought bubble shows what it's up to: a gear while it thinks, a magnifier while it reads, a pencil while it edits, a flask for tests, arrows for a push. Done, it bounces with a **!**. Waiting on you, it looks worried with a **?**.

<p align="center"><img src="docs/img/actions.png" alt="A row of blobs, each with a thought bubble showing a different tool: a command, a download, a flask, a checklist, a pencil, a magnifier" width="820"></p>

Every subagent a session sends off splits off as a little blob of its own, and merges back when it's done.

<p align="center"><img src="docs/img/helpers.png" alt="A big blob with a happy face and a '!' bubble, between a little helper running a command and one thinking" width="600"></p>

## Talk to it

Click a blob to talk to its session: read the conversation, send a message (it goes in at Claude's next step, like typing in the terminal), and answer permission prompts, questions and plans right on the blob. **New session…** in Blaube's menu starts one with no terminal at all.

<table>
  <tr>
    <td width="46%"><img src="docs/img/talk.png" alt="A talk box over two blobs: the conversation, a commit, and buttons for Commit, Open a PR and Run tests"></td>
    <td width="27%"><img src="docs/img/permission.png" alt="A talk box asking to allow a command, with Deny and Allow buttons"></td>
    <td width="27%"><img src="docs/img/question.png" alt="A talk box with a multiple-choice question from Claude"></td>
  </tr>
  <tr>
    <td align="center">The conversation, with the next steps one click away</td>
    <td align="center">Allow or deny, right on the blob</td>
    <td align="center">Claude's questions, answered with a click</td>
  </tr>
</table>

## Which model, by its face

All blobs look alike, except for their faces: each model has its own eyes and blush, so you can tell them apart across the room.

<p align="center"><img src="docs/img/models.png" alt="Four blobs labelled Opus (round dot eyes, oval blush), Sonnet (tall eyes, blush lines), Haiku (small eyes, freckles) and Fable (wide eyes, little hearts)" width="720"></p>

## The snack jar

A little cookie jar shows how much of your Claude usage limit is left: twenty cookies when your session's fresh, one fewer for each 5% used, each one tossed into a blob's mouth (nom). Hover it for the numbers. The cookies are real little things: shake the jar and they tumble about.

<p align="center"><img src="docs/img/jar.png" alt="A blob next to a glass cookie jar with its blue lid, about two thirds full" width="380"> <img src="docs/img/jar-shake.gif" alt="The cookie jar being shaken, cookies tumbling inside" width="300"></p>

## Squishy, and full of life

They're real softbody physics: grab one anywhere and it hangs and swings from your cursor, fling it and it bounces off the screen edges, drop it on a window and it lands on top. Shake one too hard and it turns green and barfs. They also have plenty to do when nobody's looking: tag, leapfrog, towers, a balloon trick, the choir.

<table>
  <tr>
    <td><img src="docs/img/hinge.gif" alt="A blob picked up by its side swings round and hangs from the cursor, then is thrown and skids along the floor"></td>
    <td><img src="docs/img/queasy.gif" alt="A blob shaken hard turns green, swells up and barfs, then gets its colour back"></td>
    <td><img src="docs/img/balloon.gif" alt="A blob puffs itself up like a balloon and zips about as the air rushes out"></td>
  </tr>
  <tr>
    <td align="center">Hangs from wherever you hold it</td>
    <td align="center">Don't shake too hard</td>
    <td align="center">The balloon trick</td>
  </tr>
</table>

They babble what's in their speech bubbles in a little made-up language, and react to you: thank one and it blushes, swear at it and it gets scared. **[Everything they do →](docs/FEATURES.md)**

## Getting started

### Install with one line

The quickest way, and it skips the "unverified developer" warnings below. Paste this into **Terminal** (Mac):

```sh
curl -fsSL https://raw.githubusercontent.com/syverlauritz/blaube/main/install.sh | bash
```

or into **PowerShell** (Windows):

```powershell
irm https://raw.githubusercontent.com/syverlauritz/blaube/main/install.ps1 | iex
```

It downloads the newest release for your computer from this page's [Releases](https://github.com/syverlauritz/blaube/releases), installs it (into Applications on a Mac, just for you on Windows, no admin needed), and opens Blaube. Run it again any time to update. Read what it does first: [install.sh](install.sh), [install.ps1](install.ps1).

Then skip to step 3 below.

### Or download it

1. **Download** Blaube for [Mac (Apple Silicon)](https://github.com/syverlauritz/blaube/releases/latest/download/Blaube-mac-arm64.dmg), [Mac (Intel)](https://github.com/syverlauritz/blaube/releases/latest/download/Blaube-mac-x64.dmg) or [Windows](https://github.com/syverlauritz/blaube/releases/latest/download/Blaube-Setup-windows.exe). On a Mac, drag it into Applications; on Windows, run the installer (no admin needed).
2. **Open it** (the first time needs one extra click, see below).
3. **Connect:** right-click the blob and choose **Connect Claude Code…**. Then start or restart a Claude Code session, and its blob pops out.

Connecting adds Blaube's hooks to `~/.claude/settings.json` (a backup is saved as `settings.json.blaube-backup`, and your existing hooks are kept). Restart any running Claude Code sessions to pick them up. **Claude Code → Disconnect…** removes exactly what was added. If Claude Code isn't installed, Blaube says so and offers **Install Claude Code…**: after a dialog that shows what it runs, Blaube runs Claude Code's official installer itself (`curl -fsSL https://claude.ai/install.sh | bash`, or its PowerShell twin on Windows, as the setup page has you paste into a terminal), then has you sign in through your browser. No terminal needed (**Show me how instead** opens the setup page).

**More than one Claude account** (work and personal, say, each with its own `CLAUDE_CONFIG_DIR` folder such as `~/.claude-personal`): Blaube finds every `~/.claude-<name>` folder Claude Code has used. Connecting asks which accounts to connect, and **Claude Code** in Blaube's menu then has a checkbox per account, **New sessions start as** (the account sessions Blaube starts run as), and **Sign in…** per account. Each account is connected and signed in in its own folder only, so signing one in never touches another's sign-in. Your browser signs in whichever claude.ai account it's on, so Blaube says so first, and afterwards tells you who it signed in as (and warns if that's the same account as another folder). Past sessions from every account can be picked up.

Want to see it without Claude running? Choose **Play → Demo sessions** from the menu.

### Your first five minutes

1. Connect (above), then start or restart a Claude Code session: its blob pops out.
2. Hover a blob for its name and what it's doing; **click** it to talk to the session; **⌥/Alt-click** to jump to its terminal; **right-click** for everything else.
3. When Claude asks for permission, a question or a plan, answer on the blob (or in the terminal; first answer wins).
4. **New session…** in Blaube's menu starts one with no terminal at all.
5. Throw them around. They like it.

### First launch (builds aren't notarized yet)

Installed with the one line above? Nothing to do here. Downloaded it from the browser:

- **macOS:** open Blaube once and dismiss the warning ("Apple could not verify…"). Then go to **System Settings → Privacy & Security**, scroll down to "Blaube was blocked" and click **Open Anyway**. (On recent macOS, right-click → Open no longer skips this.) Or in Terminal: `xattr -dr com.apple.quarantine /Applications/Blaube.app`
- **Windows:** SmartScreen may warn you. Choose **More info → Run anyway**.

### Updates

Blaube looks for a new version when it starts and every four hours after that; **Check for updates…**, under the version at the top of its menu, looks right away.

- **Windows:** the new version downloads in the background and is installed the next time you quit Blaube, or now with **Restart to update to x.y.z**.
- **macOS:** the menu says **Download Blaube x.y.z…**, which opens the release to download it and drag it over the old one (or run the [one-line install](#install-with-one-line) again, which does that for you). (macOS only lets an app replace itself when it's signed with a Developer ID; once the build is signed ([see how](docs/DEVELOPMENT.md#signing-and-notarizing-the-mac-build)), Macs update like Windows does.)

## No API tokens, nothing leaves your computer

Blaube never calls the Anthropic API. It hears from your sessions through Claude Code's own hooks, sent to a tiny server on `127.0.0.1`, and every Claude Code it starts uses your Claude login, never an API key. Only sessions running on your computer show up. [More on how it works →](docs/FEATURES.md#no-api-tokens)

## More

- **[Everything Blaube does](docs/FEATURES.md)**: the full list, the hidden tuning panel, how it works, known issues.
- **[Developing Blaube](docs/DEVELOPMENT.md)**: running from source, tests, the render harness, releasing, signing.
- **[Changelog](CHANGELOG.md)** · **[Design brief](docs/DESIGN.md)** · **[Report a problem](https://github.com/syverlauritz/blaube/issues/new/choose)**

*Blaube* is "blob" as Claude would spell it, if Claude were French.

## License

[MIT](LICENSE)
