// The hidden tuning panel: one control per parameter in shared/config.js.
// Every change is applied to the running slimes immediately.
(function () {
  'use strict';
  const { GROUPS, DEFAULTS } = globalThis.BlaubeConfig;
  const api = window.blaubeTuning;
  const controls = {};
  let cfg = Object.assign({}, DEFAULTS);

  const status = (text) => {
    document.getElementById('status').textContent = text;
    clearTimeout(status.t);
    status.t = setTimeout(() => (document.getElementById('status').textContent = ''), 2500);
  };

  function build() {
    const root = document.getElementById('groups');
    for (const [title, params] of GROUPS) {
      const sec = document.createElement('section');
      sec.innerHTML = `<h2>${title}<button class="mini">Reset</button></h2>`;
      // Puts just this section back to its defaults.
      sec.querySelector('.mini').addEventListener('click', () => {
        const back = {};
        for (const [key] of params) { back[key] = DEFAULTS[key]; cfg[key] = DEFAULTS[key]; }
        api.set(back);
        render();
        status(`${title} back to defaults.`);
      });
      for (const [key, def, min, max, step, label] of params) {
        if (typeof def === 'boolean') {
          const row = document.createElement('label');
          row.className = 'check';
          row.innerHTML = `<input type="checkbox"> <span>${label}</span>`;
          const input = row.querySelector('input');
          input.addEventListener('change', () => set(key, input.checked));
          controls[key] = { set: (v) => (input.checked = v) };
          sec.appendChild(row);
        } else if (typeof def === 'string') {
          const row = document.createElement('div');
          row.className = 'row';
          row.innerHTML = `<label><span>${label}</span><span class="key">${key}</span></label><input type="color"><input type="text">`;
          const [color, text] = row.querySelectorAll('input');
          text.style.width = '64px';
          color.addEventListener('input', () => { text.value = color.value; set(key, color.value); });
          text.addEventListener('change', () => { if (/^#[0-9a-f]{6}$/i.test(text.value)) { color.value = text.value; set(key, text.value); } });
          controls[key] = { set: (v) => { color.value = v; text.value = v; }, row };
          sec.appendChild(row);
        } else {
          const row = document.createElement('div');
          row.className = 'row';
          row.innerHTML = `<label><span>${label}</span><span class="key">${key}</span></label><input type="range" min="${min}" max="${max}" step="${step}"><input type="number" min="${min}" max="${max}" step="${step}">`;
          const [range, num] = row.querySelectorAll('input');
          range.addEventListener('input', () => { num.value = range.value; set(key, Number(range.value)); });
          num.addEventListener('change', () => { range.value = num.value; set(key, Number(num.value)); });
          controls[key] = { set: (v) => { range.value = v; num.value = v; }, row };
          sec.appendChild(row);
        }
      }
      root.appendChild(sec);
    }
  }

  function render() {
    for (const k of Object.keys(controls)) {
      controls[k].set(cfg[k]);
      if (controls[k].row) controls[k].row.classList.toggle('changed', cfg[k] !== DEFAULTS[k]);
    }
  }

  function set(key, value) {
    cfg[key] = value;
    if (controls[key].row) controls[key].row.classList.toggle('changed', value !== DEFAULTS[key]);
    api.set({ [key]: value });
  }

  document.getElementById('copy').addEventListener('click', async () => {
    await api.copy();
    status('Copied. Paste it to Claude to bake it in as the new defaults.');
  });
  document.getElementById('pasteToggle').addEventListener('click', () => {
    const p = document.getElementById('paste');
    p.style.display = p.style.display === 'block' ? 'none' : 'block';
  });
  document.getElementById('pasteApply').addEventListener('click', async () => {
    try {
      const parsed = JSON.parse(document.getElementById('pasteText').value);
      cfg = await api.replace(parsed.blaube || parsed);
      render();
      status('Applied.');
    } catch (e) {
      status('That is not valid JSON: ' + e.message);
    }
  });
  document.getElementById('reset').addEventListener('click', async () => {
    cfg = await api.replace({});
    render();
    status('Back to defaults.');
  });
  document.getElementById('demo').addEventListener('click', () => api.demo());
  document.getElementById('lifeDemo').addEventListener('click', () => api.lifeDemo && api.lifeDemo());
  // (Singing knobs apply from the next song: press Sing again to hear a change.)
  document.getElementById('sing').addEventListener('click', () => api.sing(true));
  document.getElementById('singStop').addEventListener('click', () => api.sing(false));

  build();
  api.get().then((c) => { cfg = c; render(); });
})();
