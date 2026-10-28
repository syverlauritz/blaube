# Blaube design brief

What Blaube should look and feel like. Written from the creative director's
notes; judges review screenshots and frame strips against this, and nothing
ships that breaks a "must".

## The feel
- Kawaii. Soft, round, friendly, a little silly. Never angry, never creepy.
- Alive and physical: everything has weight and springiness. Things that are
  attached to a Blaube move with it, lag a little behind it, and settle. Nothing
  floats loose, slides around, pops, or stops dead.
- Calm by default. Information shows up when it matters or when you ask
  (hover); it does not nag.

## Musts
1. Flat. No outlines, no strokes around shapes, no glow, no drop shadows on
   anything (bodies, bubbles, pets, accessories). Only a soft floor shadow
   under bodies is allowed.
2. One bubble style. Every bubble (speech, status, hover, "!", "?", thought)
   is the same white, rounded shape family, same corner roundness, same pointed
   tail shape, same text colour (#1b2440), same padding rules. A thought bubble
   differs only in having two small puffs instead of a tail.
3. Legible. Bubble text is easy to read at a glance on a dark or light
   desktop: at least 14 px, the name line bold. Display fonts only where they
   stay readable at that size; status lines use the plain UI font.
4. Bubbles never cover another Blaube's face, and never hang off-screen.
5. Accessories are attached: sit on top of the head (where the face says
   "up"), follow every hop, squish, drag and head-turn, and swing on a spring
   with a trailing tip. They never end up on the side or bottom of a Blaube,
   never float above it, and never visibly snap to a limit.
6. Faces stay mostly upright; expressions read instantly (working = calm
   concentration, not anger; done = happy; needs you = worried).
7. Colours: the first Blaube is Claude orange #D97757; others pick from the
   palette. Accessories in the body colour grow out of the body seamlessly.
8. No flicker. Icons and bubbles don't toggle faster than you can read them.

## Decided by the creative director (not up for review)
- Balloon trick squeeze eyes are > < (left eye >, right eye <), pointing inward.
- A full context shows as a red tint that spreads in a circle from the
  middle of the face (a radial gradient) as the context fills, with sweat
  drops on the body. This is wanted.
- Working = eyes squeezed shut in concentration (downward arcs), a short
  straight mouth, and level brows that are always there and now and then,
  for a moment, pull together or lift. This face is approved: do not redesign it.
  (Open "glancing up" eyes read shell-shocked; half-lidded eyes read bored
  and judging; keep those for specific reactions only.)
- With the cursor over or near it while it works, it looks up at you: its eyes ease fully open (no
  squint, no half-lid, brows staying, still blinking) and follow the cursor;
  when you move off they ease shut again. Dizzy, struggling or talking
  faces win over it.
- The Halloween ghost: a plain white sheet (flat, no outline) draped over
  the body and whatever it wears, with two dark eye holes and a scalloped
  hem; it is pulled down over the head and pulled off upward, never popped.
- A cursor resting on a blob's face: it looks right at you (no shy looking
  away or peeking back); keep it up and it giggles and squirms.
- Calm gaze: looking around has a cooldown and glides; blobs doing work stay
  focused, and mouse movement never wakes a sleeping blob.
- About half of the blobs wear nothing. Horns are one to five blunt, rounded
  triangles; accessories anchor smoothly and never twitch.
- The mother is always the biggest blob; helpers are sized by their tokens.
- No goo, no witch hats, no hand-on-head play: removed, not coming back.
  Blobs are blobs, not slime.
- Faces turn far toward the mouse (the face slides round the head); the
  "Eyes follow the mouse" amount is set high on purpose.
- Pets are small rigid squares with black beady eyes, in a shade of their
  owner's colour, that hop after their owner and show a heart when close.
- High effort wears glasses; low effort drools; max effort floats.
- Brows never pop in and out: a face either has them the whole time or not.
- Done shows a "!" balloon; needs you shows a "?" balloon with an "o" mouth.
- Max effort has flat white half-closed eyes.
- Expressions and faces are the creative director's call. Judges may note
  how a face reads, but never redesign an approved face.
- Pets get happy "^ ^" eyes and a heart when they reach their owner.
- The talk box (a blob's chat) is rounder than the little bubbles: 30 px
  corners on the box, pill-shaped buttons, softly rounded rows and code
  boxes, a pointed wedge tail. The little speech and sign bubbles (text, "!", "?") have the same pointed wedge, smaller; only thought bubbles keep their trailing puffs.
  All of Blaube's words are in one rounded font, Nunito (chosen over
  Fredoka, Baloo 2 and Quicksand; not up for review): names, hover status,
  labels, the talk box. The one exception is what a slime says in its
  little speech bubbles ("hehe", "coffee?"), which is in the display font
  picked in Settings (Speech bubble font, Coiny by default).
- A speech bubble is the same size as a sign balloon: one line is exactly
  a sign balloon's height, never narrower; longer lines wrap (at most three). Wanted ("more rounded", "more
  childlike in general").
- The talk box is for reading: only Nunito in it, its name line too (heavier,
  not a display font). It stays exactly where it opened (it never drifts
  after its blob or moves when what's in it grows; that scrolls), you can
  resize it by its edges and corners (the size is kept per screen), and its
  tail slides round the box's whole outline to the edge facing its blob,
  wherever the blob is carried; up against or under the box, the tail
  shrinks away. A pin in its header keeps it open (several pinned boxes at
  once, one per session); dragging its header moves it, and it stays where
  you put it. The tail is always a stubby wedge, never a needle: at most
  70 to 100 px long (a little longer for a bigger blob), its base in
  proportion. It shows only while a full-length tail reaches its blob, and
  fades out over half that length again beyond.
- The talk box has a dark mode (the moon in its header, kept for every
  box): the same flat bubble in a deep slate with light ink, and no tail.
- Blobs babble what's in their bubble, and only that: no sound without a
  bubble saying it ("okay!" with the 👍 on a prompt you typed, a cheer
  when a turn's done, "hehe", "coffee?"). Abstract, not text-to-speech
  ("too text-to-speechy" was rejected): a talkbox (a soft synth note
  through a sweeping vowel filter, a wah opening each syllable) in
  gibberish shaped like the words: one syllable per syllable, its vowel,
  a "bl"/"ba"/hum/click from its first consonant, stressed ones longer, ?
  rising, ! bouncy. Never nagging: a slime that needs you says so once
  per wait. Bigger is deeper, helpers are higher. The talking
  mouth: shut, it's the blob's own mouth; open, a dark oval that drops
  from the top lip, never bigger than a yawn, a pink tongue when wide.
- Shaken hard while held, a blob gets dizzy, then swells up and turns green
  (a plain leafy green faded in over its own colour, evenly, whatever its
  colour; not rising from the bottom, no hue shifting), cheeks full,
  then barfs: heaves, "bleh!", a green stream from its mouth pouring out and
  down, puddles on the floor that fade. A blob it lands on gets splats and
  the zigzag mouth with squeezed eyes ("eww!"). This is wanted (it isn't
  the removed goo).
- The cookies in the snack jar are physical: they tumble when it's shaken,
  tipped or dropped and settle into a new pile.
- The app icon is today's blob (a dome, bead eyes, blush, small smile) on a
  dark rounded square, drawn by the app's own code (scripts/make-icons.js).
- Held, the cursor is a hinge: picked up by its side, a blob swings round
  and hangs from that spot, and its face and what it wears turn with it
  (the creative director's call, over Must 6); let go, they ease back upright.
  Landings and skids are physics: no hidden braking; it only plants its
  feet once it's nearly still.
- The model shows in the face, never in the body: eyes are solid black
  (max effort's white ones aside), only their shape changes, and each model has its own blush. Opus
  is the original look (round dots, soft oval blush); Sonnet tall eyes and
  three slanted blush lines; Haiku small eyes and freckles; Fable wide eyes
  and little hearts. Helpers look like their mother.
- Choir mode: every blob sings in parts, fuller with more blobs, eyes
  shut, swaying, notes floating up. Songs are public domain only.
- A full context makes a blob round and taut, not just bigger.
- Other apps' windows: a Blaube set or dropped on top of one stays there
  (falls off only if it wanders off), and can still be thrown anywhere:
  window tops only catch things coming down onto them, softly.
- A French beret is one of the looks: a flat deep navy felt disc worn tilted
  to one side, overhanging it a little, with the little stalk on top.

## Look and taste notes
- Simple shapes, generous roundness, consistent proportions relative to the
  Blaube's size (accessories scale with the body).
- Restraint: one accent per Blaube (its accessory), not a costume.
- Motion is the fun: wobble, squish, nod, hop, droop. Static decoration is not.
