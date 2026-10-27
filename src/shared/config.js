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
      ['childHueSpread', 17, 0, 60, 1, 'Small blob hue spread (°)'],
      ['childLightSpread', 6, 0, 30, 1, 'Small blob lightness spread (%)'],
      ['shadow', false, 0, 0, 0, 'Floor shadow'],
    ]],
    ['Face', [
      ['faceScale', 0.85, 0.5, 1.6, 0.05, 'Face size'],
      ['faceInk', '#1b2440', 0, 0, 0, 'Face colour (eyes, mouth)'],
      ['eyeWhites', false, 0, 0, 0, 'White in the eyes'],
      ['eyeShine', false, 0, 0, 0, 'Shine in the eyes'],
      ['eyeSize', 0.5, 0.4, 2, 0.05, 'Eye size'],
      ['pupilSize', 0.55, 0.3, 1, 0.05, 'Pupil size (with whites)'],
      ['eyeSpacing', 1.15, 0.5, 1.6, 0.05, 'Eye spacing'],
      ['eyeHeight', -0.11, -0.3, 0.3, 0.01, 'Eye height (up/down)'],
      ['eyeRoundness', 1, 0.4, 1.6, 0.01, 'Eye width / height'],
      ['lookAround', 2, 0, 2, 0.05, 'Eyes follow the mouse'],
      ['faceLine', 1.1, 0.4, 2.5, 0.05, 'Line thickness'],
      ['mouthSize', 1.25, 0.4, 2, 0.05, 'Mouth size'],
      ['mouthHeight', 0.03, -0.2, 0.3, 0.01, 'Mouth height (up/down)'],
      ['brows', true, 0, 0, 0, 'Eyebrows (worried, focused)'],
      ['cheeks', 0.26, 0, 0.8, 0.02, 'Blush strength'],
      ['cheekColor', '#e0001a', 0, 0, 0, 'Blush colour'],
    ]],
    ['Size', [
      ['mainRadius', 112, 30, 220, 1, 'Big blob radius'],
      ['childRadius', 80, 15, 120, 1, 'Small blob radius'],
      ['mainPoints', 16, 12, 80, 1, 'Big blob skin points'],
      ['childPoints', 16, 10, 64, 1, 'Small blob skin points'],
      ['tokenGrowth', 0.15, 0, 0.5, 0.01, 'Growth each time tokens used double (from 100k)'],
      ['maxTokenGrowth', 2.5, 1, 2.5, 0.05, 'Biggest size from tokens (×)'],
    ]],
    ['Body physics', [
      ['gravity', 1950, 0, 6000, 50, 'Gravity (px/s²)'],
      ['damping', 0.994, 0.95, 1, 0.001, 'Air damping per step'],
      ['iterations', 5, 1, 16, 1, 'Solver iterations'],
      ['edgeStiffness', 0.22, 0, 1, 0.01, 'Skin stretch stiffness'],
      ['bending', 0.07, 0, 0.5, 0.01, 'Skin smoothing'],
      ['pressure', 0.1, 0, 1.5, 0.01, 'Gas pressure'],
      ['fullness', 0.71, 0.5, 1, 0.01, 'Fullness (lower = saggier)'],
      ['shapeStiffness', 0.002, 0, 0.2, 0.001, 'Shape memory'],
      ['upright', 0.05, 0, 0.3, 0.005, 'Self-righting'],
      ['bounce', 0, 0, 1, 0.01, 'Bounciness'],
      ['friction', 0.15, 0, 1, 0.01, 'Friction'],
      ['maxSpeed', 4000, 500, 12000, 100, 'Speed limit (px/s)'],
      ['breathe', 0.06, 0, 0.15, 0.005, 'Breathing'],
    ]],
    ['Dragging', [
      ['grabSpring', 710, 20, 5000, 10, 'Grab spring stiffness'],
      ['grabDamping', 18, 0, 80, 1, 'Grab spring damping'],
      ['grabRadius', 0.6, 0.1, 2.5, 0.05, 'Grab spread (radii)'],
      ['grabGravity', 1, 0, 1, 0.05, 'Gravity while held'],
    ]],
    ['Behaviour', [
      ['doneHopStrength', 750, 0, 2000, 10, 'Done bounce strength'],
      ['doneHopEvery', 0.8, 0.3, 4, 0.05, 'Done bounce interval (s)'],
      ['waitingHopStrength', 600, 0, 2000, 10, 'Needs-you hop strength'],
      ['splitImpulse', 1120, 0, 2000, 10, 'Split launch speed'],
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
      ['tumble', 1, 0, 2, 0.05, 'Thrown hard, it tumbles head over heels through the air (how much); lots of turns and it lands dizzy'],
      ['rolls', 1, 0, 2, 0.05, 'A bored blob now and then rolls over along the floor (a roly-poly), face and ears going all the way round'],
      ['shapes', 1, 0, 1, 0.05, 'Now and then a bored blob in a good mood squeezes itself into a heart for a moment (how far)'],
      ['balloon', 1, 0, 1.5, 0.05, 'Now and then a bored blob puffs itself up like a balloon, floats, then lets go and zips about going down'],
      ['flightStretch', 0.3, 0, 1, 0.01, 'Stretch out while flying'],
      ['earTwitch', 1, 0, 2, 0.05, 'Ears and antennas twitch now and then, and prick up when your cursor comes close'],
      ['doneStretch', 1, 0, 2, 0.05, 'After a long turn (over 5 minutes) it has a good long stretch and a yawn'],
      ['contactJiggle', 1, 0, 3, 0.05, 'A hard landing jiggles blobs it touches'],
      ['droop', 0.2, 0, 0.5, 0.01, 'Deflates on a failed tool or test'],
      ['tapAfter', 60, 0, 600, 5, 'One tool running this many seconds: it waits, tapping a foot (0 = never)'],
      ['planBeads', 1, 0, 1.5, 0.05, 'Wears its todo list as a row of beads that fill in as it goes, with a little hop for each one done (size; 0 = off)'],
      ['teeter', 1, 0, 1.5, 0.05, 'Standing at the very edge of a window, it teeters, looks down worried, and shuffles back'],
      ['workLife', 1, 0, 1.5, 0.05, 'At work its head follows what it does: scanning lines as it reads, typing as it edits, looking up on the web'],
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
      ['queasy', 1, 0, 2, 0.05, 'Keep shaking a held blob and it swells up and turns green, then barfs (0 = never)'],
      ['shy', 1, 0, 1, 0.05, 'Rest the cursor on its face and it looks right at you, then giggles and squirms'],
      ['feelings', 1, 0, 2, 0.05, 'Thank it in a prompt and it blushes and squirms; tell it off and it looks sheepish'],
      ['scrollSquish', 1, 0, 3, 0.05, 'Scroll over a blob to squish it flat or pull it tall'],
      ['swing', 1, 0, 1.5, 0.05, 'Held and swung gently from side to side, it loves it ("wheee!"); a hard shake still makes it dizzy'],
      ['circleDizzy', 3, 0, 10, 0.5, 'Run the cursor round a blob this many times and it gets dizzy; its eyes follow it round (0 = off)'],
      ['hugs', 1, 0, 1.5, 0.05, 'Hold a blob you carry gently against another for a moment and they hug, hearts and all'],
      ['catching', 1, 0, 1.5, 0.05, 'Throw a blob at a calm one and it may brace and catch it (and how hard a throw it can take)'],
      ['bowling', 1, 0, 1, 1, 'Throw a blob into two or more others and it cheers ("strike!")'],
      ['headPat', 1, 0, 3, 0.05, 'Rest the cursor on its head: it pushes up into it like a cat'],
      ['listen', 1, 0, 2, 0.05, 'Typing to it in its talk box: it watches and bobs along'],
      ['seekYou', 1, 0, 2, 0.05, 'Needing you a while, it hops over to your cursor'],
      ['seekAfter', 20, 3, 120, 1, 'Starts coming to you after waiting (s)'],
    ]],
    ['Life: mood', [
      ['moods', 1, 0, 3, 0.05, 'Remembers how you treat it for a few minutes: fond after petting, grumpy after shaking'],
      ['raspberry', 1, 0, 3, 0.05, 'Really grumpy and you come close: now and then it blows you a raspberry (pbbbt!)'],
      ['personality', 0.6, 0, 1, 0.05, 'How different each blob\'s character is'],
      ['idleFidget', 1, 0, 3, 0.05, 'Idle fidgets (weight shifts, settling)'],
      ['tricks', 1, 0, 5, 0.05, 'Bored but awake, it amuses itself now and then (three hops, each higher)'],
      ['flips', 1, 0, 2, 0.05, 'Now and then the last hop of a trick is a somersault'],
      ['nightcap', 1, 0, 1, 1, 'Asleep at night (10 pm to 7 am), it wears a floppy nightcap'],
      ['trickTreat', 1, 0, 2, 0.05, 'Halloween week: a calm blob now and then hops over to another, "trick or treat!" (a sweet, or a boo)'],
      ['ghosts', 1, 0, 3, 0.05, 'Halloween week: now and then one goes as a ghost under a sheet and creeps up on another ("boooo!")'],
      ['snoreBubble', 1, 0, 2, 0.05, 'Fast asleep, it blows a bubble that swells and shrinks with each breath, and pops when it wakes'],
      ['busySweat', 10, 0, 60, 1, 'Working through this many tools a minute, it breaks a sweat (0 = never)'],
      ['sleepTalk', 1, 0, 3, 0.05, 'Fast asleep, it mumbles now and then, often about what it was last doing'],
      ['dreams', 1, 0, 3, 0.05, 'Fast asleep, now and then it dreams in a thought balloon: of sheep jumping a fence, or what it was last working on'],
      ['keepy', 1, 0, 3, 0.05, 'A bored blob now and then plays keepy-uppy with its task pet, bouncing it up off its head and counting'],
      ['petNap', 1, 0, 1, 1, 'Its blob fast asleep, a task pet climbs onto its head to nap there too'],
      ['bubbles', 1, 0, 2, 0.05, 'A bored blob now and then blows a bubble; touch it with the cursor to pop it'],
      ['quirks', 1, 0, 10, 0.1, 'Rare little quirks, like a fit of hiccups (how often)'],
      ['sneezeGust', 1, 0, 1.5, 0.05, 'A sneeze at a blob beside it blows that one back a step ("bless you!" or "eww!")'],
      ['sleepSlump', 0.1, 0, 0.3, 0.01, 'Slumps while dozing (and stretches on waking)'],
      ['nightSleepy', 1, 0, 2, 0.05, 'Sleepier late at night (doze sooner, more yawns)'],
      ['huddle', 1, 0, 2, 0.05, 'Dozing off, a blob shuffles over to curl up beside a neighbour'],
      ['breathSync', 1, 0, 3, 0.05, 'Blobs resting together fall into breathing together'],
    ]],
    ['Life: together', [
      ['socialize', 1, 0, 3, 0.05, 'Calm blobs chat; mothers lean in to catch helpers'],
      ['nuzzle', 1, 0, 3, 0.05, 'Helpers nuzzle their mother'],
      ['crowding', 1, 0, 2, 0.05, 'Packed in tight a while, a blob grumbles and shoves, and one at a time they spread out: to emptier floor, or up onto a window top with room (or down from a crowded one)'],
      ['gulp', 1, 0, 3, 0.05, 'A mother gulps a helper back in (ripple and swell)'],
      ['trampoline', 1, 0, 1.5, 0.05, 'Drop one onto another from high up and the one below gives like a trampoline and springs it back up'],
      ['burps', 1, 0, 3, 0.05, 'Now and then gulping a helper back in is followed by a little burp (and a blush)'],
      ['petEmpathy', 1, 0, 2, 0.05, 'Task pets rush to a dizzy blob and cheer when it\'s happy'],
      ['spectate', 1, 0, 2, 0.05, 'Watch a blob fly past (and duck if it comes right at them)'],
      ['cheerOthers', 1, 0, 2, 0.05, 'When one finishes, the others look over and nearby ones are pleased for it'],
      ['play', 1, 0, 2, 0.05, 'Two bored blobs now and then play tag: hop after, bump, "tag!", swap'],
      ['fetch', 1, 0, 2, 0.05, 'Throw a blob\'s task pet and it chases after it, then brings it back to you'],
      ['greetNew', 1, 0, 2, 0.05, 'A new session\'s blob lands and the nearest calm one hops over to say hi'],
      ['allDoneWave', 1, 0, 2, 0.05, 'When the last busy session finishes, they do a wave of hops along the row: all done!'],
      ['highFive', 1, 0, 2, 0.05, 'Two sessions that finish close together jump up and bump in the air: high five!'],
      ['comfort', 1, 0, 2, 0.05, 'A calm blob now and then hops over to one that keeps failing, leans in and cheers it on'],
      ['leapfrog', 1, 0, 2, 0.05, 'Now and then two bored blobs side by side play leapfrog, taking turns hopping right over each other'],
      ['tower', 1, 0, 3, 0.05, 'Two bored blobs now and then make a tower: one hops up onto the other\'s head and stands tall'],
      ['measure', 1, 0, 2, 0.05, 'Two bored blobs now and then stand back to back and stretch up to see who\'s taller'],
      ['skipRope', 1, 0, 2, 0.05, 'With three bored blobs about, two now and then swing a rope and the third skips over it'],
      ['hideSeek', 1, 0, 2, 0.05, 'Now and then bored blobs play hide and seek: one counts, the others crouch in the corners'],
      ['dogpile', 1, 0, 2, 0.05, 'With three or more bored blobs about, now and then they all pile on top of one'],
      ['parade', 1, 0, 2, 0.05, 'Now and then, with a few calm blobs about, one leads a parade and the others hop along behind'],
      ['copycat', 0.6, 0, 1, 0.05, 'Chance a calm blob nearby copies another\'s trick, hop for hop'],
      ['farewell', 1, 0, 2, 0.05, 'When a session ends, the others watch its blob go, a little deflated, and the nearest says bye'],
      ['jealous', 1, 0, 3, 0.05, 'Petting one: another comes over for some too'],
      ['pranks', 1, 0, 5, 0.05, 'Now and then one sneaks up on another: boo! (more on Halloween)'],
    ]],
    ['Life: world', [
      ['windowCurious', 1, 0, 3, 0.05, 'Curious about new windows and ones you drag'],
      ['rideWobble', 1, 0, 3, 0.05, 'Riding a window you move: it wobbles as the window starts and stops'],
      ['gust', 1, 0, 3, 0.05, 'A window swept past fast blows leaves along and makes blobs lean away'],
      ['clockLife', 1, 0, 3, 0.05, 'They feel the time of day: lunch at noon, coffee mid-afternoon, Friday afternoon excitement, a Monday morning sigh'],
      ['seasons', 1, 0, 4, 0.05, 'Spring petals, summer butterflies, autumn leaves and winter snow (how many)'],
      ['nibble', 1, 0, 3, 0.05, 'Now and then a bored blob eats a leaf (or petal, or bit of snow) lying beside it'],
      ['snowballs', 1, 0, 2, 0.05, 'In snowy weather two bored blobs now and then have a snowball fight'],
      ['skating', 1, 0, 2, 0.05, 'In snowy weather a bored blob now and then takes a run-up and slides along the icy floor'],
      ['systemLife', 1, 0, 2, 0.05, 'React to the computer: wake up with it, perk up on the charger, tire on low battery'],
      ['awayAfter', 300, 30, 1800, 10, 'You count as away after this long without keyboard or mouse (s)'],
      ['welcomeBack', true, 0, 0, 0, 'Back from away: say what changed while you were gone'],
      ['lowBattery', 0.15, 0, 0.5, 0.01, 'Tired below this battery level (0 = never)'],
      ['waitNudge', 3, 0, 30, 0.5, 'Needing you this many minutes: it reminds you, once (0 = never)'],
      ['sulkAfter', 8, 0, 60, 0.5, 'Needing you this many minutes: a little rain cloud gathers over it until you point at it (0 = never)'],
      ['fullWarning', 0.85, 0, 1, 0.01, 'Says so when its context gets this full (0 = never)'],
      ['stuckAfter', 4, 0, 10, 1, 'This many errors in two minutes and a working blob gets steamed up: puffs and a cross face (0 = never)'],
    ]],
    ['World', [
      ['dockCollision', true, 0, 0, 0, 'Collide with the Dock / taskbar'],
      ['maxFps', 75, 20, 240, 1, 'Frame rate cap (an even share of the screen refresh)'],
      ['calmFps', 30, 10, 120, 1, 'Frame rate while nothing moves fast (breathing, working)'],
      ['debugOverlay', false, 0, 0, 0, 'Show physics debug overlay'],
      ['pollClaudeAgents', true, 0, 0, 0, 'Also watch `claude agents` (no hooks needed)'],
    ]],
  ];

  // Settings for everyone, in the Settings window (not the tuning panel).
  // A list in place of min means "pick one of these".
  const FONTS = ['System', 'Coiny', 'Concert One', 'DynaPuff', 'Rubik Spray Paint'];
  const SETTINGS = [
    ['size', 0.75, 0.5, 2, 0.05, 'Size'],
    // (0: no limit. Past it, the least relevant blobs are put away; one that
    // needs you always shows. See main/visibility.js.)
    ['maxBlobs', 0, 0, 20, 1, 'Max blobs on screen (ones that need you always show)'],
    ['font', 'Coiny', FONTS, 0, 0, 'Speech bubble font'],
    ['statusBubbles', 'On hover', ['On hover', 'Always'], 0, 0, 'Status bubbles'],
    ['looks', 'On', ['On', 'Off'], 0, 0, 'Fun looks (bows, ears, antennas...)'],
    ['windowLedges', 'On', ['On', 'Off'], 0, 0, 'Land on top of other windows'],
    ['snackJar', 'On', ['On', 'Off'], 0, 0, 'Snack jar (your usage limits)'],
    ['onTop', 'On', ['On', 'Off'], 0, 0, 'Stay in front of other windows'],
    ['notify', 'Behind windows', ['Behind windows', 'Always', 'Off'], 0, 0, 'Notifications when a session needs you or finishes'],
    // (Ctrl+Alt is AltGr on many Windows keyboards: Ctrl+Alt+B can be a letter there.)
    ['talkKey', 'Ctrl/⌘+Alt+B', ['Ctrl/⌘+Alt+B', 'Alt+Shift+B', 'Off'], 0, 0, 'Talk shortcut (from any app)'],
    ['voice', 'On', ['On', 'Off'], 0, 0, 'Say it out loud when they talk'],
    ['voiceVolume', 0.5, 0, 1, 0.05, 'Voice volume'],
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

  // How much bigger tokens make a slime (×): a step bigger each time the
  // total doubles, counted from `from` (100k for a session, 20k for a helper,
  // which uses far fewer).
  function tokenGrowth(cfg, total, from) {
    if (!total) return 1;
    return Math.min(cfg.maxTokenGrowth, 1 + cfg.tokenGrowth * Math.log2(1 + total / from));
  }

  // A mother is always at least this much bigger (×) than her biggest child.
  const MOTHER_STEP = 1.2;

  // A session's radius from its tokens, which count its helpers' too: she
  // grows as her children do.
  const motherRadius = (cfg, sessionTokens) => cfg.mainRadius * tokenGrowth(cfg, sessionTokens, 100000);

  // Her helpers' radii, each from its own tokens. If the biggest would come
  // within a step of her, they're all scaled down together, so they still
  // differ by their tokens and she stays the biggest. motherTokens null: no
  // mother to stay under.
  function childRadii(cfg, motherTokens, tokens) {
    const want = tokens.map((t) => cfg.childRadius * tokenGrowth(cfg, t, 20000));
    if (motherTokens == null || !want.length) return want;
    const room = motherRadius(cfg, motherTokens) / MOTHER_STEP, top = Math.max(...want);
    return top <= room ? want : want.map((r) => r * room / top);
  }

  const api = { GROUPS, SETTINGS, DEFAULTS, PALETTE, sanitize, tokenGrowth, motherRadius, childRadii, MOTHER_STEP };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BlaubeConfig = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
