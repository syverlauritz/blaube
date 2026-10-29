// Pictures in the talk box: which image files a message names, so the box
// can show them (Claude's `![](shots/a.png)`, a path it mentions, what you
// attached). Only finds the words; whether a file is really there is the
// app's to say (talk-image). Plain JavaScript, so it runs in the talk box
// and in its tests.
(function (root) {
	'use strict';

	const EXT = 'png|jpe?g|gif|webp|svg';
	const IMAGE = new RegExp(`\\.(?:${EXT})$`, 'i');
	const MAX = 12; // at most this many from one message

	// The line the box adds under what you wrote when files go with it.
	const ATTACHED = /(?:^|\n\n)Attached files? \(open with your Read tool\): ([^\n]+)\s*$/;

	const isImage = (p) => typeof p === 'string' && IMAGE.test(p.replace(/[?#].*$/, ''));

	// A path as written, made plain: a file:// link, %20s, "\ " for a space.
	function clean(p) {
		p = String(p).trim().replace(/^<|>$/g, '');
		if (/^file:\/\//i.test(p)) { p = p.replace(/^file:\/\//i, ''); try { p = decodeURI(p); } catch { /* as it is */ } }
		return p.replace(/\\ /g, ' ');
	}
	// Web addresses and data are not files on this computer.
	const isUrl = (p) => /^[a-z][\w+.-]*:\/\//i.test(p) && !/^file:/i.test(p) || /^data:/i.test(p);

	// Image paths a message names, in the order it names them, each once:
	// markdown images, `code` spans, and plain paths in the words (absolute,
	// ~/, ./ or folder/file). Not in web addresses.
	function imagePaths(text) {
		const src = String(text || '');
		const out = [];
		const add = (p) => { p = clean(p); if (p && !isUrl(p) && isImage(p) && !out.includes(p) && out.length < MAX) out.push(p); };
		const taken = []; // (spans already read, so a plain path inside them isn't found twice)
		let m;
		const md = /!\[[^\]\n]*\]\(\s*(<[^>\n]+>|[^)\s]+)(?:\s+"[^"\n]*")?\s*\)/g;
		while ((m = md.exec(src))) { add(m[1]); taken.push([m.index, m.index + m[0].length]); }
		const code = /`([^`\n]+)`/g;
		while ((m = code.exec(src))) {
			const inner = m[1].trim().replace(/:\d+(?:[-:]\d+)?$/, '');
			if (isImage(inner) && !/^\S+\s+\S/.test(inner.replace(/\\ /g, '_')) || isImage(inner) && /^(?:~|\.{1,2})?\/|^[A-Za-z]:[\\/]/.test(inner)) add(inner); // (spaces only in a full path)
			taken.push([m.index, m.index + m[0].length]);
		}
		// Plain: starts after a space or bracket, made of path letters (a "\ "
		// counts as one), ends at the image's extension.
		const plain = new RegExp(`(^|[\\s(\\[{"'*])((?:file:\\/\\/)?(?:[A-Za-z]:[\\\\/]|~\\/|\\.{1,2}\\/|\\/)?(?:(?:[\\w@%+=,.-]|\\\\ )+[\\\\/])*(?:[\\w@%+=,.-]|\\\\ )+\\.(?:${EXT}))(?=$|[\\s)\\]}"'*.,;:!?])`, 'gi');
		while ((m = plain.exec(src))) {
			const at = m.index + m[1].length;
			if (taken.some(([a, b]) => at >= a && at < b)) continue;
			const before = src.slice(Math.max(0, at - 3), at);
			if (/:\/\/?$|\/$/.test(before)) continue; // (part of a web address)
			add(m[2]);
		}
		return out;
	}

	// What you sent, split into the words you typed and the files that went
	// with it (the line the box adds: see talk.js).
	function attached(text) {
		const src = String(text || '');
		const m = ATTACHED.exec(src);
		if (!m) return { text: src, paths: [] };
		return { text: src.slice(0, m.index), paths: m[1].split(', ').map((p) => p.trim()).filter(Boolean) };
	}

	// A markdown image's own words, for where it stood in the text.
	const MD_IMAGE = /!\[([^\]\n]*)\]\(\s*(?:<[^>\n]+>|[^)\s]+)(?:\s+"[^"\n]*")?\s*\)/;

	const api = { imagePaths, attached, isImage, clean, MD_IMAGE, MAX };
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	else root.BlaubeMedia = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
