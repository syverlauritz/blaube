// A session's whole conversation, from the transcript Claude Code writes
// (~/.claude/projects/<project>/<session>.jsonl), for its talk box: what
// you typed, Claude's replies and the steps it took, in the same shapes as
// the talk box's own log (inbox.js), so what came before Blaube was
// watching looks the same as what it saw. Read a page at a time from the
// end, a few MB at most, without holding up the main process.
const fs = require('node:fs');
const { stepEntry } = require('./inbox');

const PAGE = 2 << 20; // bytes read at a time
const LEAST = 20; // turns a page is read back for, unless...
const MOST = 16 << 20; // ...it has read this much
const TURNS = 100; // turns on a page, at most

const textOf = (c) => typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n') : '';

// Something you typed (not a tool result, a command, a reminder, the
// summary a compaction starts from, or a wake-up).
function prompt(e) {
	if (!e || e.type !== 'user' || e.isSidechain || e.isMeta || e.isCompactSummary || e.isVisibleInTranscriptOnly || !e.message) return '';
	const c = e.message.content;
	if (Array.isArray(c) && c.some((b) => b && b.type === 'tool_result')) return '';
	const text = textOf(c).trim();
	if (!text || /^</.test(text)) return ''; // <command-name>, <local-command-stdout>, <task-notification>...
	return text;
}

// The log entries a run of transcript lines ([{ off, e }], oldest first)
// comes to. A turn's reply is the last thing Claude said in it, after its
// last step (what it said on the way isn't kept, as in the live log).
// Thinking isn't shown; neither are helpers' own lines (a helper is a step).
function entries(lines) {
	const out = [];
	const uses = new Map(); // tool_use id -> { name, input }
	let turn = null, said = null;
	const end = () => {
		if (said) {
			const t = turn ? { took: Math.max(0, said.at - turn.at), steps: turn.steps, files: [...turn.files] } : null;
			out.push(Object.assign({ who: 'claude', text: said.text, at: said.at, n: said.n }, t ? { turn: t } : {}));
		}
		said = null;
	};
	for (const { off, e } of lines) {
		if (!e || typeof e !== 'object' || e.isSidechain) continue;
		const at = Date.parse(e.timestamp) || 0;
		let k = 0;
		const n = () => -((off + 1) * 16 + Math.min(15, k++)); // (stable, and never one of the live log's)
		if (e.type === 'system' && e.subtype === 'compact_boundary') {
			end();
			out.push({ who: 'note', text: 'Context compacted', divider: true, at, n: n() });
			turn = null;
			continue;
		}
		if (!e.message) continue;
		const c = e.message.content;
		if (e.type === 'assistant') {
			if (e.isApiErrorMessage) {
				const t = textOf(c).trim();
				if (t) { said = null; out.push({ who: 'note', text: `Claude Code: ${t}`, error: true, at, n: n() }); }
				continue;
			}
			for (const b of Array.isArray(c) ? c : []) {
				if (!b) continue;
				if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
					// (One message in a few pieces is one reply.)
					if (said && said.mid && said.mid === e.message.id) said.text += '\n\n' + b.text.trim();
					else said = { text: b.text.trim(), at, n: n(), mid: e.message.id };
				} else if (b.type === 'tool_use' && b.id) {
					uses.set(b.id, { name: b.name, input: b.input && typeof b.input === 'object' ? b.input : {} });
					said = null; // (it carried on after saying that)
				}
			}
			continue;
		}
		if (e.type !== 'user' || e.isMeta || e.isCompactSummary || e.isVisibleInTranscriptOnly) continue;
		if (Array.isArray(c) && c.some((b) => b && b.type === 'tool_result')) {
			const results = c.filter((b) => b && b.type === 'tool_result');
			for (const r of results) {
				const u = uses.get(r.tool_use_id);
				if (!u) continue; // (its call is on an earlier page)
				const failed = !!r.is_error;
				const step = stepEntry({
					tool_name: u.name, tool_input: u.input,
					tool_response: results.length === 1 ? e.toolUseResult : undefined,
					hook_event_name: failed ? 'PostToolUseFailure' : 'PostToolUse',
					error: failed ? textOf(r.content) || (typeof r.content === 'string' ? r.content : '') : undefined,
				});
				if (!step) continue;
				out.push(Object.assign(step, { at, n: n() }));
				if (turn) { turn.steps++; if (step.file && step.kind === 'edit') turn.files.add(step.file); }
			}
			continue;
		}
		const text = textOf(c).trim();
		if (/^\[Request interrupted by user/.test(text)) {
			end();
			out.push({ who: 'note', text: 'Interrupted', at, n: n() });
			continue;
		}
		const p = prompt(e);
		if (!p) continue;
		end();
		out.push({ who: 'you', text: p, via: 'terminal', at, n: n() });
		turn = { at, steps: 0, files: new Set() };
	}
	end();
	return out;
}

const breathe = () => new Promise((r) => setImmediate(r));

// The lines of `buf` (which starts at byte `base` of the file) worth
// reading, oldest first: only what could be said or done, not the many
// lines of bookkeeping (and not one still being written).
async function parse(buf, base) {
	const out = [];
	let at = 0, t0 = Date.now();
	while (at < buf.length) {
		let nl = buf.indexOf(10, at);
		if (nl < 0) nl = buf.length;
		if (nl > at) {
			const s = buf.toString('utf8', at, nl);
			if (s.includes('"type":"user"') || s.includes('"type":"assistant"') || s.includes('compact_boundary')) {
				try { out.push({ off: base + at, e: JSON.parse(s) }); } catch { /* half a line */ }
			}
		}
		at = nl + 1;
		if (Date.now() - t0 > 8) { await breathe(); t0 = Date.now(); } // (a big page doesn't hold anything else up)
	}
	return out;
}

// A page of a transcript, the turns just before byte `before` (the end of
// the file to start with): read back `bytes` at a time until it has
// `least` turns or has read `most` bytes (a transcript is mostly
// bookkeeping, a few MB can be a couple of turns), and at most `turns` of
// them. Pages start where a turn does, so a step is on the same page as
// its call. { entries, from }: from is where the page starts (0: nothing
// earlier), the `before` for the page before it.
async function page(file, { before = Infinity, bytes = PAGE, least = LEAST, most = MOST, turns = TURNS } = {}) {
	const fh = await fs.promises.open(file, 'r');
	let lines = [], start, carry = Buffer.alloc(0), prompts = [];
	try {
		const size = (await fh.stat()).size;
		const end = Math.max(0, Math.min(Number(before) >= 0 ? Number(before) : size, size));
		start = end;
		while (start > 0 && prompts.length < least && end - start < most) {
			const from = Math.max(0, start - bytes);
			const buf = Buffer.alloc(start - from);
			await fh.read(buf, 0, buf.length, from);
			const all = carry.length ? Buffer.concat([buf, carry]) : buf;
			start = from;
			// (Whole lines only: the first may have started before what was read.)
			const nl = from > 0 ? all.indexOf(10) : -1;
			if (from > 0 && nl < 0) { carry = all; continue; }
			carry = from > 0 ? all.subarray(0, nl + 1) : Buffer.alloc(0);
			const got = await parse(from > 0 ? all.subarray(nl + 1) : all, from + (from > 0 ? nl + 1 : 0));
			lines = got.concat(lines);
			prompts = got.filter((l) => prompt(l.e)).map((l) => l.off).concat(prompts);
		}
	} finally { await fh.close(); }
	let from = start + carry.length; // (the first whole line read)
	if (prompts.length > turns) from = prompts[prompts.length - turns];
	else if (from > 0 && prompts.length) from = prompts[0]; // (the turn it starts in the middle of goes on the page before)
	return { entries: entries(lines.filter((l) => l.off >= from)), from };
}

module.exports = { page, entries, prompt };
