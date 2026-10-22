// Tiny HTTP server on localhost that Claude Code hooks POST their JSON to.
const http = require('node:http');
const { findClaudeAncestor } = require('./win/procs');

const DEFAULT_PORT = 47821;
const HOOK_PATH = '/blaube/hook';

function startHookServer(tracker, port = DEFAULT_PORT) {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/blaube/ping') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, app: 'blaube' }));
    }
    if (req.method !== 'POST' || !req.url.startsWith(HOOK_PATH)) {
      res.writeHead(404);
      return res.end();
    }
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c) => {
      body += c;
      if (body.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const term = req.headers['x-blaube-term'];
        if (term) payload._term = String(term).slice(0, 64);
        const entry = req.headers['x-blaube-entry'];
        if (entry) payload._entry = String(entry).slice(0, 64);
        tracker.handle(payload);
        // The first time we hear from a session, find its claude.exe while
        // the hook's shell is still alive, so a click can focus its window.
        const s = tracker.sessions.get(String(payload.session_id));
        const hookPid = req.headers['x-blaube-pid'];
        if (s && !s.pid && !s.findingPid && hookPid) {
          s.findingPid = true;
          return findClaudeAncestor(String(hookPid), (pid) => {
            s.findingPid = false;
            if (pid) s.pid = pid;
            res.writeHead(204);
            res.end();
          });
        }
      } catch { /* ignore junk */ }
      res.writeHead(204);
      res.end();
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

module.exports = { startHookServer, DEFAULT_PORT, HOOK_PATH };
