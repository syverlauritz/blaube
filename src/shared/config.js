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
      ['childHueSpread', 18, 0, 60, 1, 'Small slime hue spread (°)'],
      ['childLightSpread', 7, 0, 30, 1, 'Small slime lightness spread (%)'],
      ['outline', 0, 0, 6, 0.5, 'Outline width'],
      ['shadow', true, 0, 0, 0, 'Floor shadow'],
      ['glow', true, 0, 0, 0, 'Status glow'],
    ]],
    ['Face', [
      ['faceScale', 0.85, 0.5, 1.6, 0.05, 'Face size'],
      ['faceInk', '#1b2440', 0, 0, 0, 'Face colour (eyes, mouth)'],
      ['eyeWhites', false, 0, 0, 0, 'White in the eyes'],
      ['eyeShine', false, 0, 0, 0, 'Shine in the eyes'],
      ['eyeSize', 0.55, 0.4, 2, 0.05, 'Eye size'],
      ['pupilSize', 0.55, 0.3, 1, 0.05, 'Pupil size (with whites)'],
      ['eyeSpacing', 1, 0.5, 1.6, 0.05, 'Eye spacing'],
      ['eyeHeight', -0.11, -0.3, 0.3, 0.01, 'Eye height (up/down)'],
      ['eyeRoundness', 0.55, 0.4, 1.6, 0.01, 'Eye width / height'],
      ['lookAround', 2, 0, 2, 0.05, 'Eyes follow the mouse'],
      ['faceLine', 1, 0.4, 2.5, 0.05, 'Line thickness'],
      ['mouthSize', 1.1, 0.4, 2, 0.05, 'Mouth size'],
      ['mouthHeight', -0.03, -0.2, 0.3, 0.01, 'Mouth height (up/down)'],
      ['brows', true, 0, 0, 0, 'Eyebrows (worried, focused)'],
      ['cheeks', 0.36, 0, 0.8, 0.02, 'Blush strength'],
      ['cheekColor', '#e0001a', 0, 0, 0, 'Blush colour'],
    ]],
    ['Size', [
      ['mainRadius', 129, 30, 220, 1, 'Big slime radius'],
      ['childRadius', 86, 15, 120, 1, 'Small slime radius'],
      ['mainMinRadius', 64, 20, 200, 1, 'Big slime min radius (after splits)'],
      ['mainPoints', 27, 12, 80, 1, 'Big slime skin points'],
      ['childPoints', 28, 10, 64, 1, 'Small slime skin points'],
    ]],
    ['Body physics', [
      ['gravity', 1950, 0, 6000, 50, 'Gravity (px/s²)'],
      ['damping', 0.994, 0.95, 1, 0.001, 'Air damping per step'],
      ['iterations', 5, 1, 16, 1, 'Solver iterations'],
      ['edgeStiffness', 0.03, 0, 1, 0.01, 'Skin stretch stiffness'],
      ['bending', 0.07, 0, 0.5, 0.01, 'Skin smoothing'],
      ['pressure', 0.4, 0, 1.5, 0.01, 'Gas pressure'],
      ['fullness', 0.7, 0.5, 1, 0.01, 'Fullness (lower = saggier)'],
      ['shapeStiffness', 0.002, 0, 0.2, 0.001, 'Shape memory'],
      ['upright', 0.01, 0, 0.3, 0.005, 'Self-righting'],
      ['bounce', 0.92, 0, 1, 0.01, 'Bounciness'],
      ['friction', 0.14, 0, 1, 0.01, 'Friction'],
      ['maxSpeed', 9500, 500, 12000, 100, 'Speed limit (px/s)'],
      ['breathe', 0.06, 0, 0.15, 0.005, 'Breathing'],
    ]],
    ['Dragging', [
      ['grabSpring', 400, 20, 5000, 10, 'Grab spring stiffness'],
      ['grabDamping', 14, 0, 80, 1, 'Grab spring damping'],
      ['grabRadius', 0.15, 0.1, 2.5, 0.05, 'Grab spread (radii)'],
      ['grabGravity', 1, 0, 1, 0.05, 'Gravity while held'],
    ]],
    ['Behaviour', [
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

  // Colours you can pick for a Blaube from its right-click menu.
  const PALETTE = [
    ['Orange', '#D97757'],
    ['Blue', '#5B8DEF'],
    ['Green', '#5FB57A'],
    ['Purple', '#9B7BD8'],
    ['Pink', '#E07BA8'],
    ['Yellow', '#E8B84A'],
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

  const api = { GROUPS, DEFAULTS, PALETTE, sanitize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BlaubeConfig = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
