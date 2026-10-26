// What a slime is thinking, for its thought bubble while you hover it: the
// newest thinking Claude wrote in its transcript during the current turn
// (a session's own transcript, or a helper's own subagent one). Only the
// end of the file is read (the last 256 KB), off the main thread's way
// (async), and kept until the file changes.
const fs = require('node:fs');
const path = require('node:path');

const TAIL = 256 << 10;
const KEEP = 400; // characters of thinking handed to the bubble (it shows the last few lines)

// The newest non-empty thinking in some JSONL text, from after the last
// prompt you typed (an older turn's thinking isn't what it thinks now).
// Lines that don't parse (the first one, cut in half by the tail read, or
// one still being written) are skipped. own: skip helper (sidechain) lines,
// for a session's own transcript. Returns the whitespace-collapsed text, or ''.
function latestThinking(text, own = true) {
	const lines = String(text).split('\n');
	for (let i = lines.length - 1; i >= 0; i--) {
		const line = lines[i];
		if (!line || (!line.includes('"thinking"') && !line.includes('"type":"user"'))) continue;
		let e;
		try { e = JSON.parse(line); } catch { continue; }
		if (!e || (own && e.isSidechain)) continue;
		const m = e.message;
		const content = m && Array.isArray(m.content) ? m.content : null;
		if (e.type === 'user') {
			// A prompt (not a tool's result coming back): the turn started here.
			const prompt = m && (typeof m.content === 'string' ? m.content.trim() : content && content.some((c) => c && c.type === 'text' && c.text));
			if (prompt && !e.isMeta) return '';
			continue;
		}
		if (e.type !== 'assistant' || !content) continue;
		for (let j = content.length - 1; j >= 0; j--) {
			const c = content[j];
			if (c && c.type === 'thinking' && typeof c.thinking === 'string') {
				const t = c.thinking.replace(/\s+/g, ' ').trim();
				if (t) return t;
			}
		}
	}
	return '';
}

// The end of a thought, cut at a word: "…and then the tests".
function tailOf(text, max = KEEP) {
	const t = String(text || '').replace(/\s+/g, ' ').trim();
	if (t.length <= max) return t;
	const cut = t.slice(t.length - max);
	const sp = cut.indexOf(' ');
	return '…' + (sp >= 0 && sp < cut.length - 1 ? cut.slice(sp + 1) : cut);
}

const cache = new Map(); // file -> { size, mtimeMs, text, own }

// The tail of the newest thinking in a transcript file, or '' (no file, no
// thinking this turn, only redacted or empty thinking).
async function thinkingOf(file, own = true) {
	if (!file) return '';
	let st;
	try { st = await fs.promises.stat(file); } catch { return ''; }
	const hit = cache.get(file);
	if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs && hit.own === own) return hit.text;
	const len = Math.min(st.size, TAIL);
	let raw = '';
	try {
		const fh = await fs.promises.open(file, 'r');
		try {
			const buf = Buffer.alloc(len);
			await fh.read(buf, 0, len, st.size - len);
			raw = buf.toString('utf8');
		} finally { await fh.close(); }
	} catch { return ''; }
	const text = tailOf(latestThinking(raw, own));
	cache.set(file, { size: st.size, mtimeMs: st.mtimeMs, text, own });
	if (cache.size > 50) cache.delete(cache.keys().next().value);
	return text;
}

// A helper's own transcript: <session>/subagents/agent-<id>.jsonl.
const helperFile = (file, agentId) => path.join(String(file).replace(/\.jsonl$/, ''), 'subagents', `agent-${agentId}.jsonl`);

// A shell command in plain words (see plainCommand.js).
const { plainCommand } = require('./plainCommand');

module.exports = { latestThinking, tailOf, thinkingOf, helperFile, plainCommand };
