// Opens a new terminal window that resumes a Claude Code session in its
// project folder. This uses your local `claude` CLI, not the API.
const { spawn } = require('node:child_process');

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

// Brings the app the session runs in to the front. Returns false when we
// don't know which app that is, so the caller can resume it instead.
function focusSessionApp(session, platform = process.platform) {
  if (platform !== 'darwin') return false;
  // Sessions started from the Claude desktop app have no terminal; their
  // entrypoint says so (or, with older Claude Code, nothing is set at all).
  const fromDesktop = /desktop/i.test(session.entry || '') || (!session.term && !session.entry && session.hooked);
  const name = fromDesktop ? 'Claude' : MAC_APPS[session.term];
  if (!name) return false;
  spawn('open', ['-a', name], { detached: true, stdio: 'ignore' }).unref();
  return true;
}

module.exports = { openResumeTerminal, resumeCommand, focusSessionApp };
