# How Blaube's look is reviewed

Nothing visual goes to the creative director until it has passed this loop.

1. **Render.** `npm run shots` plays every scene in `scripts/shots/main.js`
   in an off-screen window and saves `shots/<scene>.png`. Motion scenes (like
   `shake`) save a numbered strip of frames and print measured checks for
   every accessory (swing peak, biggest jump between frames, distance from the
   crown). Scenes cover dark and light desktops, crowds, hovering, every
   state, every look and every effort level. When a new feature lands, it
   gets a scene.
2. **Judge.** Fresh agents that never see the author's reasoning review the
   pictures against `docs/DESIGN.md`, one lens each:
   - style consistency and legibility/layout,
   - motion and physicality (frame strips plus the measured checks),
   - creative director (taste, character, charm).
   Each starts from FAIL, may report at most 6-7 findings, and must point at a
   file and a spot, with a concrete fix. Severity is blocker, major or minor.
3. **Fix** every blocker and major, then render again and judge again with
   new judges (they don't see the earlier findings). Stop after a round with
   no blockers or majors, or after 4 rounds; then report what is still open.
4. **The real creative director decides taste.** The "creative director"
   judge is only an advisor: its notes on faces, expressions and character
   are suggestions to bring to the real creative director, never changes to
   make on its say-so. Objective findings (outlines, overlaps, legibility,
   things coming loose, jitter) get fixed.
5. **The brief wins.** If a judge flags something the creative director
   decided (see "Decided by the creative director" in DESIGN.md), it is not
   a finding. New decisions from the creative director go into DESIGN.md
   straight away, so the judges learn them.
