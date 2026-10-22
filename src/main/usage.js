// Token usage of a Claude Code session, read from its transcript (and its
// helpers' transcripts). Each assistant message in a transcript carries the
// API usage for that call.
//   total   - tokens the session has used: new input, cache writes and
//             output, summed over every call (cache reads aren't counted,
//             or a long session would count its context again every turn)
//   context - how full the context window is: everything the last call read
//   limit   - the context window size: 1M when the session uses the 1M
//             context, otherwise 200k
// It also collects the background tasks the session started (and the ones
// Claude stopped), so tasks started before Blaube was running still count,
// the effort level of the newest call (low, medium, high, xhigh, max), and
// a few facts for the hover bubble: the session's title, git branch, model.
// Files are read incrementally, so a long transcript is only read once, and
// a few MB at a time, so a huge one never holds up the app for long.
const fs = require('node:fs');
const path = require('node:path');

const files = new Map(); // file -> { offset, rest, ids, total, context, big, started, tasks, killed }
const KILL_TOOLS = new Set(['KillShell', 'KillBash', 'TaskStop']);
const CHUNK = 4 << 20; // read at most this much per file per call

function readNew(file) {
	let st;
	try { st = fs.statSync(file); } catch { return null; }
	let u = files.get(file);
	if (!u || st.size < u.offset) {
		u = { offset: 0, rest: '', ids: new Set(), total: 0, context: 0, big: false, started: new Map(), tasks: new Map(), killed: new Set() };
		files.set(file, u);
	}
	if (st.size === u.offset) return u;
	const len = Math.min(st.size - u.offset, CHUNK);
	const buf = Buffer.alloc(len);
	try {
		const fd = fs.openSync(file, 'r');
		try { fs.readSync(fd, buf, 0, len, u.offset); } finally { fs.closeSync(fd); }
	} catch { return u; }
	u.offset += len;
	const lines = (u.rest + buf.toString('utf8')).split('\n');
	u.rest = lines.pop(); // a line still being written
	for (const line of lines) addLine(u, line);
	return u;
}

function addLine(u, line) {
	if (!u.big && (line.includes('context-1m') || line.includes('[1m]'))) u.big = true;
	addInfo(u, line);
	const hasTask = line.includes('run_in_background') || line.includes('backgroundTaskId') || /"name":"(KillShell|KillBash|TaskStop)"/.test(line);
	if (!line.includes('"usage"') && !hasTask) return;
	let e;
	try { e = JSON.parse(line); } catch { return; }
	if (!e) return;
	// Helper (subagent) lines only add to the total: their context, words
	// and tasks are their own, not the session's.
	const own = !e.isSidechain;
	if (hasTask && own) addTaskLine(u, e);
	const m = e.type === 'assistant' && e.message;
	if (m && e.effort) {
		// A helper's own transcript is all sidechain, so keep both.
		u.anyEffort = String(e.effort).toLowerCase();
		if (own) u.effort = u.anyEffort;
	}
	if (!m || !m.usage) return;
	const n = (k) => Number(m.usage[k]) || 0;
	if (own) {
		const said = (Array.isArray(m.content) ? m.content : []).filter((c) => c.type === 'text' && c.text).map((c) => c.text).join(' ').trim();
		if (said) u.lastText = said;
		u.context = n('input_tokens') + n('cache_creation_input_tokens') + n('cache_read_input_tokens');
		if (u.context > 200000) u.big = true;
	}
	// One API call can be written as several lines with the same usage.
	if (m.id && u.ids.has(m.id)) return;
	if (m.id) u.ids.add(m.id);
	u.total += n('input_tokens') + n('cache_creation_input_tokens') + n('output_tokens');
}

// Facts for the hover bubble, picked out cheaply before any JSON parsing:
// the title (a /rename beats Claude's own), the git branch and the model.
function addInfo(u, line) {
	const own = !line.includes('"isSidechain":true');
	if (own && line.includes('"is_error":true')) u.errors = (u.errors || 0) + 1;
	if (line.includes('"customTitle"') || line.includes('"aiTitle"')) {
		try {
			const e = JSON.parse(line);
			if (e.customTitle) u.customTitle = String(e.customTitle);
			if (e.aiTitle) u.aiTitle = String(e.aiTitle);
		} catch { /* half a line */ }
	}
	if (!own) return;
	const branch = /"gitBranch":"([^"]*)"/.exec(line);
	if (branch && branch[1] && !branch[1].startsWith('worktree-agent-')) u.branch = branch[1];
	const model = /"model":"(claude-[^"]+)"/.exec(line);
	if (model && line.includes('"type":"assistant"')) u.model = model[1];
}

// Background tasks: a tool call with run_in_background, whose result
// carries the task id. Kill tools name the task they stop.
function addTaskLine(u, e) {
	const content = e.message && Array.isArray(e.message.content) ? e.message.content : [];
	for (const c of content) {
		if (c.type !== 'tool_use' || !c.input) continue;
		if (c.input.run_in_background && c.input.command) u.started.set(c.id, { command: String(c.input.command), description: String(c.input.description || '') });
		if (KILL_TOOLS.has(c.name)) u.killed.add(String(c.input.shell_id || c.input.task_id || c.input.bash_id || ''));
	}
	const r = e.toolUseResult;
	if (r && r.backgroundTaskId) {
		const call = content.find((c) => c.type === 'tool_result' && u.started.has(c.tool_use_id));
		if (call) u.tasks.set(String(r.backgroundTaskId), u.started.get(call.tool_use_id));
	}
}

// Background tasks in a transcript that Claude hasn't stopped:
// [{ id, command, description }]. Some may have ended by themselves.
function sessionTasks(file) {
	const u = file && readNew(file);
	if (!u) return [];
	return [...u.tasks].filter(([id]) => !u.killed.has(id)).map(([id, t]) => Object.assign({ id }, t));
}

// Transcripts of the session's helpers, kept next to its own:
// <session>.jsonl and <session>/subagents/agent-*.jsonl.
function helperFiles(file) {
	const dir = path.join(file.replace(/\.jsonl$/, ''), 'subagents');
	try { return fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(dir, f)); } catch { return []; }
}

// { total, context, limit } for a transcript file, or null if it can't be
// read. The total includes what the session's helpers used.
function sessionUsage(file) {
	if (!file) return null;
	const u = readNew(file);
	if (!u) return null;
	let total = u.total;
	for (const f of helperFiles(file)) {
		const h = readNew(f);
		if (h) total += h.total;
	}
	return { total, context: u.context, limit: u.big ? 1000000 : 200000 };
}

// The last thing Claude wrote in a transcript (its own words, not tools).
function lastText(file) {
	const u = file && readNew(file);
	return (u && u.lastText) || '';
}

// The effort level of the session's newest call, or of one helper's when
// agentId is given. '' if the transcript doesn't say.
function sessionEffort(file, agentId) {
	if (!file) return '';
	if (!agentId) {
		const u = readNew(file);
		return (u && u.effort) || '';
	}
	const h = readNew(path.join(file.replace(/\.jsonl$/, ''), 'subagents', `agent-${agentId}.jsonl`));
	return (h && h.anyEffort) || '';
}

// { title, branch, model } for a transcript ('' where it doesn't say).
function sessionInfo(file) {
	const u = file && readNew(file);
	if (!u) return { title: '', branch: '', model: '' };
	return { title: u.customTitle || u.aiTitle || '', branch: u.branch || '', model: u.model || '' };
}

// How many tool calls in the session have failed so far.
function sessionErrors(file) {
	const u = file && readNew(file);
	return (u && u.errors) || 0;
}

// Reads on until a transcript and its helpers' are read to the end (at most
// 64 MB per call); true once they are. A missing file counts as read.
function catchUp(file) {
	if (!file) return true;
	let budget = 16;
	const done = (f) => {
		let st;
		try { st = fs.statSync(f); } catch { return true; }
		while (budget > 0) {
			const u = readNew(f);
			if (!u || u.offset >= st.size) return true;
			budget--;
		}
		return false;
	};
	let all = done(file);
	for (const f of helperFiles(file)) all = done(f) && all;
	return all;
}

// Drops cached files that don't belong to one of the given transcripts.
function forget(keep) {
	const dirs = [...keep].map((f) => f.replace(/\.jsonl$/, '') + path.sep);
	for (const f of files.keys()) if (!keep.has(f) && !dirs.some((d) => f.startsWith(d))) files.delete(f);
}

module.exports = { sessionUsage, sessionTasks, sessionEffort, sessionInfo, sessionErrors, lastText, catchUp, forget };
