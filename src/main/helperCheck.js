// Every so often, each helper (subagent) is checked against what Claude Code
// wrote down about it. A helper stays out only while there's good reason to
// think it's still at work: its mother is still here, Claude Code hasn't
// marked it finished or told her it's done (a task-notification), and its
// own transcript was written to lately. A missed SubagentStop (a helper
// that failed on an API error, was stopped, or finished in the background,
// or one that was going before Blaube started) would otherwise leave its
// slime out for good.
const fs = require('node:fs');
const path = require('node:path');

const CHECK_MS = 20e3; // how often
const DONE_QUIET_MS = 60e3; // it ended its turn and has said nothing since
const THINK_QUIET_MS = 5 * 60e3; // nothing written while it should be thinking
const TOOL_QUIET_MS = 20 * 60e3; // a long tool call (tests, a build) writes nothing until it's done
const BLIND_QUIET_MS = 15 * 60e3; // no transcript to look at: its hooks are all we have
const WAIT_QUIET_MS = 60 * 60e3; // asking you something can take a while
const FG_GRACE_MS = 30e3; // a foreground helper outliving its mother's turn
const TAIL = 64 * 1024;
const NOTE_FIRST = 4 << 20; // (a long transcript: only its end the first time)

// Why a helper should go home now, or '' while it still looks busy.
// agent: as the tracker keeps it; ev: what its files say (see evidence());
// mother: { alive, working }.
function verdict(agent, ev, mother, now) {
	if (!mother.alive) return 'its mother is gone';
	const e = ev || {};
	if (e.finished) return 'marked finished';
	// Told her it's done (completed, failed, killed), and hasn't been at it
	// since (a helper she sends another message carries on, same id).
	if (e.noteAt && e.noteAt >= (e.lastAt || 0) - 2000) return `she was told it ${e.noteStatus || 'ended'}`;
	const last = Math.max(e.lastAt || 0, agent.updatedAt || 0);
	const quiet = now - last;
	if (e.foreground && !mother.working && quiet > FG_GRACE_MS) return 'its mother finished her turn';
	if (e.lastKind === 'done' && quiet > DONE_QUIET_MS) return 'it ended its turn';
	if (agent.state === 'waiting') return quiet > WAIT_QUIET_MS ? 'quiet too long' : '';
	const limit = !e.lastAt ? BLIND_QUIET_MS : e.lastKind === 'tool' ? TOOL_QUIET_MS : THINK_QUIET_MS;
	return quiet > limit ? 'quiet too long' : '';
}

// Where Claude Code keeps a session's helpers' files.
function subagentsDir(transcript) {
	return transcript ? path.join(path.dirname(transcript), path.basename(transcript, '.jsonl'), 'subagents') : '';
}

async function tail(file, bytes) {
	const h = await fs.promises.open(file, 'r');
	try {
		const { size } = await h.stat();
		const len = Math.min(size, bytes);
		const buf = Buffer.alloc(len);
		await h.read(buf, 0, len, size - len);
		return buf.toString('utf8');
	} finally { await h.close(); }
}

// What its last transcript entry says: 'done' (ended its turn), 'tool'
// (a tool call under way) or 'busy' (anything else).
function kindOf(entry) {
	if (!entry || entry.type !== 'assistant' || !entry.message) return 'busy';
	const c = entry.message.content;
	if (Array.isArray(c) && c.some((x) => x && x.type === 'tool_use')) return 'tool';
	return entry.message.stop_reason === 'end_turn' ? 'done' : 'busy';
}

// What a helper's own files say: { finished, foreground, lastAt, lastKind }.
async function evidence(transcript, agentId) {
	const dir = subagentsDir(transcript);
	const out = { finished: false, foreground: false, lastAt: 0, lastKind: '' };
	if (!dir) return out;
	try {
		const meta = JSON.parse(await fs.promises.readFile(path.join(dir, `agent-${agentId}.meta.json`), 'utf8'));
		out.finished = !!meta.finished;
		out.foreground = meta.requestShape === 'foreground';
	} catch {}
	const file = path.join(dir, `agent-${agentId}.jsonl`);
	try {
		out.lastAt = (await fs.promises.stat(file)).mtimeMs;
		const lines = (await tail(file, TAIL)).split('\n');
		for (let i = lines.length - 1; i >= 0; i--) {
			let o;
			try { o = JSON.parse(lines[i]); } catch { continue; }
			if (!o || (o.type !== 'assistant' && o.type !== 'user')) continue; // (its bookkeeping: api requests, attachments)
			out.lastKind = kindOf(o);
			break;
		}
		if (!out.lastKind) out.lastKind = 'busy';
	} catch {}
	return out;
}

// The task-notifications in a session's transcript, as they come: agent id
// -> { at, status } of its latest one. Read a bit more each time.
const notes = new Map(); // transcript -> { size, rest, map }
function noteLine(line, map) {
	if (!line.includes('<task-notification>')) return;
	let o;
	try { o = JSON.parse(line); } catch { return; }
	const at = Date.parse(o.timestamp || '');
	if (!at) return; // (copies inside an API request carry no time of their own)
	const re = /<task-id>([0-9a-z]+)<\/task-id>[\s\S]{0,600}?<status>(\w+)<\/status>/gi;
	for (let m; (m = re.exec(line));) {
		const prev = map.get(m[1]);
		if (!prev || prev.at <= at) map.set(m[1], { at, status: m[2] });
	}
}
async function notifications(transcript) {
	if (!transcript) return new Map();
	let st;
	try { st = await fs.promises.stat(transcript); } catch { return new Map(); }
	let hit = notes.get(transcript);
	if (!hit || st.size < hit.size) hit = { size: Math.max(0, st.size - NOTE_FIRST), rest: '', map: new Map() };
	const midLine = !hit.read && hit.size > 0; // (a long transcript, only its end read)
	if (st.size > hit.size) {
		const h = await fs.promises.open(transcript, 'r');
		try {
			const len = st.size - hit.size;
			const buf = Buffer.alloc(len);
			await h.read(buf, 0, len, hit.size);
			const lines = (hit.rest + buf.toString('utf8')).split('\n');
			hit.rest = lines.pop();
			if (midLine) lines.shift(); // (started mid-line)
			for (const l of lines) noteLine(l, hit.map);
			hit.size = st.size;
			hit.read = true;
		} finally { await h.close(); }
	}
	notes.set(transcript, hit);
	if (notes.size > 50) notes.delete(notes.keys().next().value);
	return hit.map;
}

// Checks every helper of every session; calls end(session, agent, why) for
// each one that should go home. Demo sessions are left alone.
async function reconcile(sessions, transcriptOf, end, now = Date.now) {
	for (const s of sessions) {
		if (!s.agents || !s.agents.length || String(s.id).startsWith('demo-')) continue;
		const file = transcriptOf(s);
		const told = await notifications(file);
		for (const a of s.agents.slice()) {
			const ev = Object.assign(await evidence(file, a.id), told.has(a.id) ? { noteAt: told.get(a.id).at, noteStatus: told.get(a.id).status } : {});
			const why = verdict(a, ev, { alive: true, working: s.state === 'working' || s.state === 'waiting' }, now());
			if (why) end(s, a, why);
		}
	}
}

module.exports = { verdict, evidence, notifications, reconcile, subagentsDir, CHECK_MS };
