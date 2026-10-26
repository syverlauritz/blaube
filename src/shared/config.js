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
      ['shadow', true, 0, 0, 0, 'Floor shadow'],
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
      ['cheeks', 0.26, 0, 0.8, 0.02, 'Blush strength'],
      ['cheekColor', '#e0001a', 0, 0, 0, 'Blush colour'],
    ]],
    ['Size', [
      ['mainRadius', 112, 30, 220, 1, 'Big slime radius'],
      ['childRadius', 96, 15, 120, 1, 'Small slime radius'],
      ['mainMinRadius', 64, 20, 200, 1, 'Big slime min radius (after splits)'],
      ['mainPoints', 29, 12, 80, 1, 'Big slime skin points'],
      ['childPoints', 28, 10, 64, 1, 'Small slime skin points'],
      ['tokenGrowth', 0.15, 0, 0.5, 0.01, 'Growth each time tokens used double (from 100k)'],
      ['maxTokenGrowth', 2.5, 1, 2.5, 0.05, 'Biggest size from tokens (×)'],
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
      ['glassesSpeed', 1700, 300, 8000, 50, 'High effort loses its glasses over (px/s)'],
      ['levitateHeight', 70, 0, 300, 1, 'Extra high effort float height (px)'],
      ['contextInflate', 0.56, 0, 1, 0.01, 'Puff up as context fills'],
      ['contextTighten', 2.5, 0, 6, 0.1, 'Get firmer as context fills (× pressure)'],
      ['contextFirm', 1, 0, 2, 0.05, 'Hold round and taut as context fills'],
      ['redAt', 0.3, 0, 1, 0.01, 'Red tint from this much context'],
      ['flushColor', '#ff1e32', 0, 0, 0, 'Red tint colour'],
      ['flushRadius', 0.2, 0.05, 1.5, 0.01, 'Red tint size, when it starts (× radius)'],
      ['flushGrow', 0.87, 0, 1.5, 0.01, 'Red tint growth when full (× radius)'],
      ['flushX', 0, -0.6, 0.6, 0.01, 'Red tint centre, left/right (× radius)'],
      ['flushY', 0.16, -0.8, 0.8, 0.01, 'Red tint centre, up/down (× radius)'],
      ['flushCore', 0.63, 0, 1, 0.01, 'Red tint strength in the middle'],
      ['flushMid', 0.31, 0, 1, 0.01, 'Red tint strength part way out'],
      ['flushMidAt', 0.6, 0.05, 0.95, 0.01, 'Where "part way out" is (0 middle, 1 edge)'],
      ['flushFollowFace', true, 0, 0, 0, 'Red tint follows the face as it turns'],
      ['sweatAt', 0.65, 0.2, 1, 0.01, 'Sweat from this much context'],
      ['painAt', 0.85, 0.2, 1, 0.01, 'In pain from this much context'],
    ]],
    ['Life: body', [
      ['hopCrouch', 0.09, 0, 0.3, 0.01, 'Crouch before a hop (s)'],
      ['crouchDepth', 1, 0, 3, 0.05, 'Crouch depth'],
      ['flightStretch', 0.3, 0, 1, 0.01, 'Stretch out while flying'],
      ['splatSpeed', 1900, 600, 8000, 50, 'Sticks to a wall it hits faster than (px/s)'],
      ['splatHold', 0.7, 0, 2, 0.05, 'Stays stuck to the wall for (s)'],
      ['splashDrops', 1, 0, 3, 0.05, 'Goo droplets fly off on hard hits'],
      ['splashSpeed', 1500, 500, 6000, 50, 'Splashes when it hits faster than (px/s)'],
      ['contactJiggle', 1, 0, 3, 0.05, 'A hard landing jiggles slimes it touches'],
      ['droop', 0.2, 0, 0.5, 0.01, 'Deflates on a failed tool or test'],
      ['strain', 1, 0, 3, 0.05, 'Strained shiver while a tool runs'],
      ['voiceBob', 1, 0, 3, 0.05, 'Body bobs along while it talks or sings'],
      ['eyeLife', 1, 0, 1, 0.05, 'Eye life (blinks on landing, wide eyes, looks where it flies)'],
    ]],
    ['Life: you', [
      ['leanToCursor', 1, 0, 3, 0.05, 'Lean toward a nearby cursor'],
      ['flinch', 1, 0, 3, 0.05, 'Flinch from a cursor whizzing past'],
      ['flinchSpeed', 2600, 500, 8000, 50, 'Flinch when the cursor is faster than (px/s)'],
      ['pokeDent', 1, 0, 3, 0.05, 'Dent where you press'],
      ['wriggle', 1, 0, 3, 0.05, 'Wriggle when held still'],
      ['wriggleAfter', 1.4, 0.3, 5, 0.1, 'Starts wriggling after held still (s)'],
      ['shakeDizzy', 5, 0, 12, 1, 'Shakes that make it dizzy (0 = never)'],
      ['scrollSquish', 1, 0, 3, 0.05, 'Scroll over a slime to squish it flat or pull it tall'],
      ['headPat', 1, 0, 3, 0.05, 'Rest the cursor on its head: it pushes up into it like a cat'],
      ['listen', 1, 0, 2, 0.05, 'Typing to it in its talk box: it watches and bobs along'],
      ['seekYou', 1, 0, 2, 0.05, 'Needing you a while, it hops over to your cursor'],
      ['seekAfter', 20, 3, 120, 1, 'Starts coming to you after waiting (s)'],
    ]],
    ['Life: mood', [
      ['moods', 1, 0, 3, 0.05, 'Remembers how you treat it for a few minutes: fond after petting, grumpy after shaking'],
      ['personality', 0.6, 0, 1, 0.05, 'How different each slime\'s character is'],
      ['idleFidget', 1, 0, 3, 0.05, 'Idle fidgets (weight shifts, settling)'],
      ['tricks', 1, 0, 5, 0.05, 'Bored but awake, it amuses itself now and then (three hops, each higher)'],
      ['quirks', 1, 0, 10, 0.1, 'Rare little quirks, like a fit of hiccups (how often)'],
      ['sleepSlump', 0.1, 0, 0.3, 0.01, 'Slumps while dozing (and stretches on waking)'],
      ['nightSleepy', 1, 0, 2, 0.05, 'Sleepier late at night (doze sooner, more yawns)'],
      ['huddle', 1, 0, 2, 0.05, 'Dozing off, a slime shuffles over to curl up beside a neighbour'],
      ['breathSync', 1, 0, 3, 0.05, 'Slimes resting together fall into breathing together'],
    ]],
    ['Life: together', [
      ['socialize', 1, 0, 3, 0.05, 'Calm slimes chat; mothers lean in to catch helpers'],
      ['nuzzle', 1, 0, 3, 0.05, 'Helpers nuzzle their mother'],
      ['gulp', 1, 0, 3, 0.05, 'A mother gulps a helper back in (ripple and swell)'],
      ['petEmpathy', 1, 0, 2, 0.05, 'Task pets rush to a dizzy slime and cheer when it\'s happy'],
      ['spectate', 1, 0, 2, 0.05, 'Watch a slime fly past (and duck if it comes right at them)'],
      ['cheerOthers', 1, 0, 2, 0.05, 'When one finishes, the others look over and nearby ones are pleased for it'],
      ['jealous', 1, 0, 3, 0.05, 'Petting one: another comes over for some too'],
      ['pranks', 1, 0, 5, 0.05, 'Now and then one sneaks up on another: boo! (more on Halloween)'],
    ]],
    ['Life: world', [
      ['windowCurious', 1, 0, 3, 0.05, 'Curious about new windows and ones you drag'],
      ['rideWobble', 1, 0, 3, 0.05, 'Riding a window you move: it wobbles as the window starts and stops'],
      ['gust', 1, 0, 3, 0.05, 'A window swept past fast blows leaves along and makes slimes lean away'],
      ['seasons', 1, 0, 4, 0.05, 'Autumn leaves and winter snow drift down and settle on them (how many)'],
      ['systemLife', 1, 0, 2, 0.05, 'React to the computer: wake up with it, perk up on the charger, tire on low battery'],
      ['awayAfter', 300, 30, 1800, 10, 'You count as away after this long without keyboard or mouse (s)'],
      ['welcomeBack', true, 0, 0, 0, 'Back from away: say what changed while you were gone'],
      ['lowBattery', 0.15, 0, 0.5, 0.01, 'Tired below this battery level (0 = never)'],
      ['waitNudge', 3, 0, 30, 0.5, 'Needing you this many minutes: it reminds you, once (0 = never)'],
      ['fullWarning', 0.85, 0, 1, 0.01, 'Says so when its context gets this full (0 = never)'],
    ]],
    ['World', [
      ['dockCollision', true, 0, 0, 0, 'Collide with the Dock / taskbar'],
      ['debugOverlay', false, 0, 0, 0, 'Show physics debug overlay'],
      ['pollClaudeAgents', true, 0, 0, 0, 'Also watch `claude agents` (no hooks needed)'],
    ]],
  ];

  // Settings for everyone, in the Settings window (not the tuning panel).
  // A list in place of min means "pick one of these".
  const FONTS = ['System', 'Coiny', 'Concert One', 'DynaPuff', 'Rubik Spray Paint'];
  const SETTINGS = [
    ['size', 0.7, 0.5, 2, 0.05, 'Size'],
    ['font', 'Coiny', FONTS, 0, 0, 'Name font'],
    ['statusBubbles', 'On hover', ['On hover', 'Always'], 0, 0, 'Status bubbles'],
    ['looks', 'On', ['On', 'Off'], 0, 0, 'Fun looks (bows, ears, antennas...)'],
    ['windowLedges', 'On', ['On', 'Off'], 0, 0, 'Land on top of other windows'],
    ['onTop', 'On', ['On', 'Off'], 0, 0, 'Stay in front of other windows'],
    ['voice', 'On', ['On', 'Off'], 0, 0, 'Babble out loud when they talk'],
    ['voiceVolume', 0.5, 0, 1, 0.05, 'Babble volume'],
    ['voiceWah', 0.8, 0, 1, 0.05, 'Wah at the start of each note'],
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
  const ALL = [...GROUPS, ['Settings', SETTINGS]];
  for (const [, params] of ALL) for (const [k, v] of params) DEFAULTS[k] = v;

  // Keeps only known keys with the right type, clamped to range.
  function sanitize(input) {
    const out = Object.assign({}, DEFAULTS);
    if (!input || typeof input !== 'object') return out;
    for (const [, params] of ALL) {
      for (const [k, def, min, max] of params) {
        if (!(k in input)) continue;
        const v = input[k];
        if (Array.isArray(min)) { if (min.includes(v)) out[k] = v; }
        else if (typeof def === 'boolean') out[k] = !!v;
        else if (typeof def === 'string') { if (/^#[0-9a-f]{6}$/i.test(v)) out[k] = v; }
        else if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.min(max, Math.max(min, v));
      }
    }
    return out;
  }

  const api = { GROUPS, SETTINGS, DEFAULTS, PALETTE, sanitize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BlaubeConfig = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
