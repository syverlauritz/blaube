// Where the text caret is in the talk box's message field, so its slime can
// watch you type: a hidden copy of the field (a "mirror") laid out the
// same, with the text up to the caret in it and a marker after, says where
// the caret sits, wrapping and all. The arithmetic is plain JavaScript (for
// the tests); measure() needs the page.
(function (root) {
	'use strict';

	// What the mirror needs to lay its text out like the field.
	const COPIED = ['boxSizing', 'width', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderStyle',
		'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize',
		'fontSizeAdjust', 'lineHeight', 'fontFamily', 'textAlign', 'textTransform', 'textIndent', 'letterSpacing', 'wordSpacing', 'tabSize', 'direction'];

	// The field's text split at the caret: what goes before the marker, the
	// rest of the word the caret is in (inside the marker, so a word about
	// to wrap wraps in the mirror too), and the rest.
	function splitAt(value, end) {
		value = String(value || '');
		end = Math.max(0, Math.min(value.length, end | 0));
		const m = /^[^\s]*/.exec(value.slice(end));
		const word = m[0];
		return { before: value.slice(0, end), word, after: value.slice(end + word.length) };
	}

	// The caret's point in the page: the marker's spot in the mirror (from
	// the mirror's corner), put on the field and less however far it's
	// scrolled, halfway down the line; kept inside the field (scrolled out
	// of sight, it's at the edge).
	function caretPoint({ box, mark, scroll, lineHeight }) {
		const s = scroll || { left: 0, top: 0 };
		const x = box.left + mark.left - s.left;
		const y = box.top + mark.top - s.top + (lineHeight || 0) / 2;
		return {
			x: Math.max(box.left, Math.min(box.left + box.width, x)),
			y: Math.max(box.top, Math.min(box.top + box.height, y)),
		};
	}

	// The length of the word just typed up to the caret.
	function wordBefore(value, end) {
		const m = /[^\s]*$/.exec(String(value || '').slice(0, Math.max(0, end | 0)));
		return m[0].length;
	}

	// Something to get excited about: a new line, a long word (once, as it
	// gets long) or typing fast (chars a second over the last moment).
	const LONG_WORD = 12, FAST = 9;
	function burst({ key, value, end, rate }) {
		value = String(value || '');
		if (key === 'Enter' && value[end - 1] === '\n') return 'newline';
		if (key && key.length === 1 && wordBefore(value, end) === LONG_WORD) return 'long word';
		if (rate >= FAST) return 'fast';
		return null;
	}

	// Measures the caret in a textarea, in the page's (client) pixels.
	function measure(field) {
		const doc = field.ownerDocument, view = doc.defaultView;
		const css = view.getComputedStyle(field);
		const mirror = doc.createElement('div');
		for (const p of COPIED) mirror.style[p] = css[p];
		Object.assign(mirror.style, { position: 'absolute', visibility: 'hidden', top: '0', left: '-9999px', overflow: 'hidden', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', wordWrap: 'break-word', height: 'auto' });
		mirror.style.width = field.offsetWidth + 'px';
		mirror.style.boxSizing = 'border-box';
		const parts = splitAt(field.value, field.selectionDirection === 'backward' ? field.selectionStart : field.selectionEnd);
		mirror.textContent = parts.before;
		const marker = doc.createElement('span');
		marker.textContent = parts.word || '​';
		mirror.appendChild(marker);
		mirror.appendChild(doc.createTextNode(parts.after));
		doc.body.appendChild(mirror);
		const m = mirror.getBoundingClientRect(), k = marker.getClientRects()[0] || marker.getBoundingClientRect();
		const box = field.getBoundingClientRect();
		const lineHeight = parseFloat(css.lineHeight) || parseFloat(css.fontSize) * 1.2 || 16;
		const p = caretPoint({ box: { left: box.left, top: box.top, width: box.width, height: box.height }, mark: { left: k.left - m.left, top: k.top - m.top }, scroll: { left: field.scrollLeft, top: field.scrollTop }, lineHeight });
		mirror.remove();
		return p;
	}

	const api = { splitAt, caretPoint, wordBefore, burst, measure, LONG_WORD, FAST };
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	else root.BlaubeCaret = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
