// Every tunable Blaube parameter, with its default and slider range. The
// hidden tuning panel is generated from this list, and "Copy config" puts
// the current values on the clipboard as JSON.
(function (root) {
  'use strict';

  // [key, default, min, max, step, label]; a string default is a colour,
  // a boolean default is a checkbox.
  const GROUPS = [
    ['Look', [
      ['color', '#D97757', 0, 0, 0, 'Body colour'],
      ['childHueSpread', 7, 0, 60, 1, 'Small slime hue spread (°)'],
      ['childLightSpread', 8, 0, 30, 1, 'Small slime lightness spread (%)'],
      ['outline', 0, 0, 6, 0.5, 'Outline width'],
      ['faceScale', 1, 0.5, 1.6, 0.05, 'Face size'],
      ['shadow', true, 0, 0, 0, 'Floor shadow'],
      ['glow', true, 0, 0, 0, 'Status glow'],
    ]],
    ['Size', [
      ['mainRadius', 96, 30, 220, 1, 'Big slime radius'],
      ['childRadius', 46, 15, 120, 1, 'Small slime radius'],
      ['mainMinRadius', 64, 20, 200, 1, 'Big slime min radius (after splits)'],
      ['mainPoints', 40, 12, 80, 1, 'Big slime skin points'],
      ['childPoints', 28, 10, 64, 1, 'Small slime skin points'],
    ]],
    ['Body physics', [
      ['gravity', 2400, 0, 6000, 50, 'Gravity (px/s²)'],
      ['damping', 0.996, 0.95, 1, 0.001, 'Air damping per step'],
      ['iterations', 6, 1, 16, 1, 'Solver iterations'],
      ['edgeStiffness', 0.3, 0, 1, 0.01, 'Skin stretch stiffness'],
      ['bending', 0.05, 0, 0.5, 0.01, 'Skin smoothing'],
      ['pressure', 0.6, 0, 1.5, 0.01, 'Gas pressure'],
      ['fullness', 0.8, 0.5, 1, 0.01, 'Fullness (lower = saggier)'],
      ['shapeStiffness', 0.01, 0, 0.2, 0.001, 'Shape memory'],
      ['upright', 0.03, 0, 0.3, 0.005, 'Self-righting'],
      ['bounce', 0.3, 0, 1, 0.01, 'Bounciness'],
      ['friction', 0.3, 0, 1, 0.01, 'Friction'],
      ['maxSpeed', 4500, 500, 12000, 100, 'Speed limit (px/s)'],
      ['breathe', 0.025, 0, 0.15, 0.005, 'Breathing'],
    ]],
    ['Dragging', [
      ['grabSpring', 700, 20, 5000, 10, 'Grab spring stiffness'],
      ['grabDamping', 14, 0, 80, 1, 'Grab spring damping'],
      ['grabRadius', 0.6, 0.1, 2.5, 0.05, 'Grab spread (radii)'],
      ['grabGravity', 1, 0, 1, 0.05, 'Gravity while held'],
    ]],
    ['Behaviour', [
      ['idleHopEvery', 18, 0, 120, 1, 'Idle hop every (s, 0 = never)'],
      ['idleHopStrength', 520, 0, 2000, 10, 'Idle hop strength'],
      ['doneHopStrength', 750, 0, 2000, 10, 'Done bounce strength'],
      ['doneHopEvery', 0.8, 0.3, 4, 0.05, 'Done bounce interval (s)'],
      ['waitingHopStrength', 600, 0, 2000, 10, 'Needs-you hop strength'],
      ['splitImpulse', 700, 0, 2000, 10, 'Split launch speed'],
      ['dizzySpeed', 2300, 500, 8000, 50, 'Dizzy after impact over (px/s)'],
    ]],
    ['World', [
      ['dockCollision', true, 0, 0, 0, 'Collide with the Dock / taskbar'],
      ['debugOverlay', false, 0, 0, 0, 'Show physics debug overlay'],
      ['pollClaudeAgents', true, 0, 0, 0, 'Also watch `claude agents` (no hooks needed)'],
    ]],
  ];

  const DEFAULTS = {};
  for (const [, params] of GROUPS) for (const [k, v] of params) DEFAULTS[k] = v;

  // Keeps only known keys with the right type, clamped to range.
  function sanitize(input) {
    const out = Object.assign({}, DEFAULTS);
    if (!input || typeof input !== 'object') return out;
    for (const [, params] of GROUPS) {
      for (const [k, def, min, max] of params) {
        if (!(k in input)) continue;
        const v = input[k];
        if (typeof def === 'boolean') out[k] = !!v;
        else if (typeof def === 'string') { if (/^#[0-9a-f]{6}$/i.test(v)) out[k] = v; }
        else if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.min(max, Math.max(min, v));
      }
    }
    return out;
  }

  const api = { GROUPS, DEFAULTS, sanitize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BlaubeConfig = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
