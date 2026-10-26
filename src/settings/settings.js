// The Settings window: one slider per setting in shared/config.js, applied
// to the running slimes as you drag.
(function () {
	'use strict';
	const { SETTINGS } = globalThis.BlaubeConfig;
	const api = window.blaubeTuning;
	const root = document.getElementById('rows');
	const pct = (v) => `${Math.round(v * 100)}%`;
	// key -> shows a value, so a change made elsewhere (a right-click menu)
	// shows here too.
	const shows = new Map();

	api.get().then((cfg) => {
		for (const [key, , min, max, step, label] of SETTINGS) {
			const row = document.createElement('div');
			row.className = 'row';
			if (Array.isArray(min)) {
				// Pick one, with a preview in that font.
				const preview = key === 'font' ? '<div class="preview">kalkis</div>' : '';
				row.innerHTML = `<label><span>${label}</span></label><select></select>${preview}`;
				const select = row.querySelector('select'), shown = row.querySelector('.preview');
				for (const name of min) select.add(new Option(name, name));
				const show = (name) => { if (shown) shown.style.fontFamily = name === 'System' ? '' : `"${name}", system-ui`; };
				select.value = cfg[key];
				show(cfg[key]);
				select.addEventListener('change', () => { show(select.value); api.set({ [key]: select.value }); });
				shows.set(key, (v) => { select.value = v; show(v); });
				root.appendChild(row);
				continue;
			}
			row.innerHTML = `<label><span>${label}</span><output></output></label><input type="range"><div class="ends"><span>${pct(min)}</span><span>${pct(max)}</span></div>`;
			const input = row.querySelector('input'), out = row.querySelector('output');
			Object.assign(input, { min, max, step, value: cfg[key] });
			out.textContent = pct(cfg[key]);
			input.addEventListener('input', () => {
				const v = Number(input.value);
				out.textContent = pct(v);
				api.set({ [key]: v });
			});
			shows.set(key, (v) => { if (document.hasFocus() && document.activeElement === input) return; input.value = v; out.textContent = pct(v); }); // (not the one you're dragging)
			root.appendChild(row);
		}
		if (api.onChange) api.onChange((next) => { for (const [key, show] of shows) if (next[key] !== undefined) show(next[key]); });
	});
})();
