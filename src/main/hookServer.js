// Tiny HTTP server on localhost that Claude Code hooks POST their JSON to.
const http = require('node:http');
const { findClaudeAncestor } = require('./win/procs');

const DEFAULT_PORT = 47821;
const HOOK_PATH = '/blaube/hook';
const INBOX_PATH = HOOK_PATH + '/inbox';
const PERMISSION_PATH = HOOK_PATH + '/permission';

// Reads a request's JSON body, then calls back with it (null if junk).
function readJson(req, cb) {
  let body = '';
  req.setEncoding('utf8');
  req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
  req.on('end', () => { try { cb(JSON.parse(body)); } catch { cb(null); } });
}

// A held-open response that's answered once: text (200) or nothing (204).
function once(res, onGone) {
  let done = false;
  const reply = (text) => {
    if (done) return false;
    done = true;
    if (text) { res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }); res.end(text); } else { res.writeHead(204); res.end(); }
    return true;
  };
  res.on('close', () => { if (!done) { done = true; onGone(reply); } });
  return reply;
}

function startHookServer(tracker, port = DEFAULT_PORT, inbox = null) {
  const server = http.createServer((req, res) => {
    // Only Claude Code's hooks (curl) talk to Blaube. A web page could reach
    // 127.0.0.1 too (fake sessions, words put in a session's mouth, a
    // message from the slime taken before its session gets it); browsers
    // always say where a request comes from, curl never does.
    // (A page served from another name that points here, DNS rebinding,
    // still says where it's from; and the hooks send JSON, which a page
    // can't send here without the browser asking first.)
    const host = String(req.headers.host || '');
    if (req.headers.origin || req.headers['sec-fetch-site'] || req.headers['sec-fetch-mode']
      || (host && !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host))
      || (req.method === 'POST' && !/^application\/json/.test(String(req.headers['content-type'] || '')))) {
      res.writeHead(403);
      return res.end();
    }
    if (req.method === 'GET' && req.url === '/blaube/ping') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, app: 'blaube' }));
    }
    // A session's inbox hook waiting for a message from its slime: held open
    // until there is one (200, the text) or it's let go (204).
    if (req.method === 'POST' && req.url === INBOX_PATH && inbox) {
      return readJson(req, (payload) => {
        const id = payload ? String(payload.session_id || '') : '';
        // (A session Blaube started gets what you say straight in: no waiting.)
        if (!id || inbox.owned.has(id)) { res.writeHead(204); return res.end(); }
        inbox.wait(id, once(res, (reply) => inbox.gone(id, reply)));
      });
    }
    // A session asking permission for a tool: shown on its slime and held
    // open until you answer there (200, the decision) or in the terminal
    // (the hook is cancelled). Only interactive sessions wait: one without
    // a terminal (claude -p, the SDK) gets no answer right away, so a
    // missing Blaube decision never holds it up.
    if (req.method === 'POST' && req.url === PERMISSION_PATH) {
      return readJson(req, (payload) => {
        if (payload) for (const k of Object.keys(payload)) if (k.startsWith('_')) delete payload[k];
        if (!payload || !payload.session_id) { res.writeHead(204); return res.end(); }
        const entry = String(req.headers['x-blaube-entry'] || '');
        if (entry) payload._entry = entry.slice(0, 64);
        const term = req.headers['x-blaube-term'];
        if (term) payload._term = String(term).slice(0, 64);
        tracker.handle(payload);
        const id = String(payload.session_id);
        // (Sessions Blaube started itself have no terminal but do have the slime.)
        const here = !entry || entry === 'cli' || (inbox && inbox.owned.has(id));
        if (!inbox || !here || !tracker.sessions.has(id)) { res.writeHead(204); return res.end(); }
        inbox.ask(id, payload, once(res, (reply) => inbox.unasked(id, reply)));
      });
    }
    if (req.method !== 'POST' || !req.url.startsWith(HOOK_PATH)) {
      res.writeHead(404);
      return res.end();
    }
    let body = '';
    req.setEncoding('utf8');
    // (A tool's whole output comes along: a big file read, a long log.)
    req.on('data', (c) => {
      body += c;
      if (body.length > 32e6) req.destroy();
    });
    req.on('end', () => {
      // What goes back to Claude (tool hooks only; see inbox.step).
      let answer = '';
      const done = () => {
        if (answer) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(answer); } else { res.writeHead(204); res.end(); }
      };
      try {
        const payload = JSON.parse(body);
        for (const k of Object.keys(payload)) if (k.startsWith('_')) delete payload[k]; // ours to set, never the sender's
        const term = req.headers['x-blaube-term'];
        if (term) payload._term = String(term).slice(0, 64);
        const entry = req.headers['x-blaube-entry'];
        if (entry) payload._entry = String(entry).slice(0, 64);
        tracker.handle(payload);
        if (inbox) inbox.observe(payload);
        if (inbox && /^(PreToolUse|PostToolUse|PostToolUseFailure)$/.test(String(payload.hook_event_name))) answer = inbox.step(payload, req.headers['x-blaube-out'] === '1');
        // The first time we hear from a session, find its claude.exe while
        // the hook's shell is still alive, so a click can focus its window.
        const s = tracker.sessions.get(String(payload.session_id));
        const hookPid = req.headers['x-blaube-pid'];
        // (Not when there's an answer for Claude: it must get there before
        // the hook gives up, and the next event can look for the pid.)
        if (s && !s.pid && !s.findingPid && hookPid && !answer) {
          s.findingPid = true;
          return findClaudeAncestor(String(hookPid), (pid) => {
            s.findingPid = false;
            if (pid) s.pid = pid;
            done();
          });
        }
      } catch { /* ignore junk */ }
      done();
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

module.exports = { startHookServer, DEFAULT_PORT, HOOK_PATH, INBOX_PATH, PERMISSION_PATH };
