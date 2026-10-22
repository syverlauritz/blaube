// Opens a new terminal window that resumes a Claude Code session in its
// project folder. This uses your local `claude` CLI, not the API.
const { spawn, execFile } = require('node:child_process');
const path = require('node:path');

function resumeCommand(sessionId) {
  if (!/^[\w-]+$/.test(sessionId)) throw new Error('Unexpected session id');
  return `claude --resume ${sessionId}`;
}

function shQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

function openResumeTerminal(session, platform = process.platform) {
  const cmd = resumeCommand(session.id);
  const cwd = session.cwd || require('node:os').homedir();
  if (platform === 'darwin') {
    const script = `cd ${shQuote(cwd)} && ${cmd}`;
    const apple = `tell application "Terminal"\n activate\n do script ${JSON.stringify(script)}\nend tell`;
    spawn('osascript', ['-e', apple], { detached: true, stdio: 'ignore' }).unref();
  } else if (platform === 'win32') {
    spawn('cmd.exe', ['/c', 'start', '"Blaube"', 'cmd.exe', '/k', cmd], { cwd, detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref();
  } else {
    spawn('x-terminal-emulator', ['-e', 'bash', '-lc', `cd ${shQuote(cwd)} && ${cmd}; exec bash`], { detached: true, stdio: 'ignore' }).unref();
  }
}

// Apps a Claude Code session can be running in, keyed by $TERM_PROGRAM.
const MAC_APPS = {
  Apple_Terminal: 'Terminal',
  'iTerm.app': 'iTerm',
  vscode: 'Visual Studio Code',
  cursor: 'Cursor',
  WarpTerminal: 'Warp',
  ghostty: 'Ghostty',
  WezTerm: 'WezTerm',
};

// The focus script must be a real file for PowerShell to run it, so in a
// packaged app it's unpacked next to app.asar.
const FOCUS_PS1 = path.join(__dirname, 'win', 'focus.ps1').replace(/app\.asar([\\/])/,'app.asar.unpacked$1');

// Brings the window (and on Windows Terminal, the tab) a session runs in to
// the front. Calls done(ok); ok is false when we can't find it. Never
// opens anything new.
function focusSessionApp(session, done = () => {}, platform = process.platform) {
  if (platform === 'win32') {
    if (!session.pid) return done(false);
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', FOCUS_PS1, '-ProcessId', String(session.pid)],
      { timeout: 8000, windowsHide: true }, (err) => done(!err));
    return;
  }
  if (platform !== 'darwin') return done(false);
  // Sessions started from the Claude desktop app have no terminal; their
  // entrypoint says so (or, with older Claude Code, nothing is set at all).
  const fromDesktop = /desktop/i.test(session.entry || '') || (!session.term && !session.entry && session.hooked);
  const name = fromDesktop ? 'Claude' : MAC_APPS[session.term];
  if (!name) return done(false);
  spawn('open', ['-a', name], { detached: true, stdio: 'ignore' }).unref();
  done(true);
}

module.exports = { openResumeTerminal, resumeCommand, focusSessionApp };
