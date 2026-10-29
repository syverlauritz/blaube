// Songs the choir knows (Sing together, in the menu). Old and famous; mostly public domain,
// and a few well-known pop songs (each says "still in copyright" below).
//
// notes: "pitch:beats:syllable" separated by spaces. A syllable of "-"
// carries the one before over a new note (a slur). bpm counts beats.
// chords: "name:beats", the harmony under the melody; the other parts
// (bass, tenor, alto, a high "oo") are made from it (choir.js). Names like
// C, F#m, G7, Bb.
(function (root) {
  'use strict';

  const SONGS = [
    {
      id: 'silent-night',
      title: 'Silent Night',
      bpm: 80,
      // Franz Gruber, 1818; English words by John Freeman Young, 1859.
      // Notes, timing and chords from a MIDI (bitmidi.com/uploads/93769.mid),
      // in C, 3/4; one verse (the MIDI's two-bar intro is left out).
      notes: `
        G4:1.5:Si A4:.5:lent G4:1:night E4:3:-
        G4:1.5:Ho A4:.5:ly G4:1:night E4:3:-
        D5:2:All D5:1:is B4:3:calm
        C5:2:All C5:1:is G4:3:bright
        A4:2:Round A4:1:yon C5:1.5:vir B4:.5:gin A4:1:mo
        G4:1.5:ther A4:.5:and G4:1:child E4:3:-
        A4:2:Ho A4:1:ly C5:1:in B4:1:fant A4:1:so
        G4:1.5:ten A4:.5:der G4:1:and E4:3:mild
        D5:2:Sleep D5:1:in F5:1:hea D5:1:ven B4:1:ly
        C5:3:peace E5:3:-
        C5:1:Sleep G4:1:in E4:1:hea G4:1:ven F4:1:ly D4:1:peace
        C4:6:-`,
      chords: 'C:12 G7:6 C:6 F:6 C:6 F:6 C:6 G7:6 C:9 G7:3 C:6',
    },
    {
      id: 'canon',
      title: 'Canon in D (Pachelbel)',
      bpm: 80,
      // Johann Pachelbel, around 1680. Notes, timing and chords from a MIDI
      // (pachelbel-mid.mid from bitmidi.com; upload number not known), first
      // violin over the continuo's eight-chord ground. In C (the original is D,
      // moved down a whole tone to sit in range). Each beat here is two beats
      // of the MIDI. Four turns of the ground: the slow descent, the same
      // line lower, the leaping figure, then the rising variation to the end.
      notes: `
        E5:2:ah D5:2:ah C5:2:ah B4:2:ah A4:2:ah G4:2:ah A4:2:ah B4:2:ah
        C5:2:ah B4:2:ah A4:2:ah G4:2:ah F4:2:ah E4:2:ah F4:2:ah D4:2:ah
        C4:1:la E4:1:la G4:1:la F4:1:la E4:1:la C4:1:la E4:1:la D4:1:la
        C4:1:la A3:1:la C4:1:la G4:1:la F4:1:la A4:1:la G4:1:la F4:1:la
        E4:1:la C4:1:la D4:1:la B4:1:la C5:1:la E5:1:la G4:1:la G4:1:la
        A4:1:la F4:1:la G4:1:la E4:1:la C4:1:la C5:1:la C5:1:la B4:1:la
        C5:4:ah`,
      chords: 'C:2 G:2 Am:2 Em:2 F:2 C:2 F:2 G:2 C:2 G:2 Am:2 Em:2 F:2 C:2 F:2 G:2 C:2 G:2 Am:2 Em:2 F:2 C:2 F:2 G:2 C:2 G:2 Am:2 Em:2 F:2 C:2 F:2 G:2 C:4',
    },
    {
      id: 'ode-to-joy',
      title: 'Ode to Joy',
      bpm: 120,
      // Ludwig van Beethoven, 1824; words by Friedrich Schiller, 1785. Notes,
      // timing and chords from a MIDI (bitmidi.com/uploads/34951.mid), in D.
      // Piano-solo file: tune = top voice, chords from the notes under it.
      // The whole theme, then its second half and last phrase once more.
      notes: `
        F#4:1:Freu F#4:1:de G4:1:schö A4:1:ner A4:1:Göt G4:1:ter F#4:1:fun E4:1:ken
        D4:1:Toch D4:1:ter E4:1:aus F#4:1:E F#4:1.5:ly E4:.5:si E4:2:um
        F#4:1:Wir F#4:1:be G4:1:tre A4:1:ten A4:1:feu G4:1:er F#4:1:trun E4:1:ken
        D4:1:Himm D4:1:li E4:1:sche F#4:1:dein E4:1.5:Hei D4:.5:lig D4:2:tum
        E4:1:Dei E4:1:ne F#4:1:Zau D4:1:ber E4:1:bin F#4:.5:den G4:.5:- F#4:1:wie D4:1:der
        E4:1:was F#4:.5:die G4:.5:- F#4:1:Mo E4:1:de D4:1:streng E4:1:ge A3:2:teilt
        F#4:1:Al F#4:1:le G4:1:Men A4:1:schen A4:1:wer G4:1:den F#4:1:Brü E4:1:der
        D4:1:wo D4:1:dein E4:1:sanf F#4:1:ter E4:1.5:Flü D4:.5:gel D4:2:weilt
        E4:1:Dei E4:1:ne F#4:1:Zau D4:1:ber E4:1:bin F#4:.5:den G4:.5:- F#4:1:wie D4:1:der
        E4:1:was F#4:.5:die G4:.5:- F#4:1:Mo E4:1:de D4:1:streng E4:1:ge A3:2:teilt
        F#4:1:Al F#4:1:le G4:1:Men A4:1:schen A4:1:wer G4:1:den F#4:1:Brü E4:1:der
        D4:1:wo D4:1:dein E4:1:sanf F#4:1:ter E4:1.5:Flü D4:.5:gel D4:2:weilt`,
      chords: 'D:4 A:4 D:2 A:1 D:3 A:2 D:4 A:4 D:2 A:1 D:1 A:2 D:2 A:2 D:2 A:2 D:2 A:2 F#7:2 Bm:1 E7:1 A:2 D:4 A:4 D:2 A:1 D:1 A:2 D:2 A:2 D:2 A:2 D:2 A:2 F#7:2 Bm:1 E7:1 A:2 D:4 A:4 D:2 A:1 D:1 A:2 D:2',
    },
    {
      id: 'twinkle',
      title: 'Twinkle, Twinkle, Little Star',
      bpm: 100,
      // A French tune from the 1760s; words by Jane Taylor, 1806.
      notes: `
        C4:1:Twin C4:1:kle G4:1:twin G4:1:kle A4:1:lit A4:1:tle G4:2:star
        F4:1:How F4:1:I E4:1:won E4:1:der D4:1:what D4:1:you C4:2:are
        G4:1:Up G4:1:a F4:1:bove F4:1:the E4:1:world E4:1:so D4:2:high
        G4:1:Like G4:1:a F4:1:dia F4:1:mond E4:1:in E4:1:the D4:2:sky
        C4:1:Twin C4:1:kle G4:1:twin G4:1:kle A4:1:lit A4:1:tle G4:2:star
        F4:1:How F4:1:I E4:1:won E4:1:der D4:1:what D4:1:you C4:2:are`,
      chords: 'C:4 F:2 C:2 F:2 C:2 G:2 C:2 C:2 F:2 C:2 G:2 C:2 F:2 C:2 G:2 C:4 F:2 C:2 F:2 C:2 G:2 C:2',
    },
    {
      id: 'la-vie-en-rose',
      title: 'La Vie en Rose',
      bpm: 184,
      // Louiguy (Louis Guglielmi), 1945; words by Édith Piaf. Still in
      // copyright. The refrain, in C, from a letter-note transcription in D
      // (pianoletternotes.blogspot.com, 2018).
      notes: `
        C5:3:Quand B4:1:il A4:1.5:me G4:.5:prend E4:1.5:dans C5:.5:ses
        B4:3:bras A4:1:il G4:1.5:me E4:.5:par C4:1.5:le B4:.5:tout
        A4:2:bas G4:2:je A4:2:vois B4:2:la C5:2:vie
        A4:2:Il G4:1:me E4:1:dit E4:1:des D4:1:mots C4:1:d'a B3:1:mour C4:1:des D4:1:mots
        E4:1:de F4:1:tous F4:1:les E4:1:jours D4:1:et C#4:1:ça D4:1:me E4:1:fait
        F4:1:quel G4:1:que G4:1:cho F4:1:se E4:1:la D4:1:la E4:1:la F4:1:la
        G4:1:la G4:1:la G4:1:la G4:1:la G4:1:la G4:1:la E4:1:la F#4:1:la G4:4:-
        C5:3:Quand B4:1:il A4:1.5:me G4:.5:prend E4:1.5:dans C5:.5:ses
        B4:3:bras A4:1:il G4:1.5:me E4:.5:par C4:1.5:le B4:.5:tout
        A4:2:bas G4:2:je A4:2:vois B4:2:la C5:4:vie`,
      chords: 'C:8 G7:8 Dm7:4 G7:4 C:4 C:4 G7:4 Dm7:4 A7:4 Dm:4 G7:4 C:4 D7:4 G7:4 C:8 G7:8 Dm7:4 G7:4 C:4',
    },
    {
      id: 'somewhere-over-the-rainbow',
      title: 'Somewhere Over the Rainbow',
      bpm: 72,
      // Harold Arlen / E.Y. Harburg, 1939 (The Wizard of Oz). Notes,
      // timing and chords from a MIDI (bitmidi.com/uploads/83189.mid), in
      // Bb (the MIDI is in Ab; moved up a tone to sit in the choir's range).
      // The main theme twice; the quick notes after "o" are the real ones.
      notes: `
        Bb3:2:Some Bb4:2:where A4:1.5:o F4:.25:ver G4:.25:the A4:1:rain Bb4:2.5:bow
        Bb3:.5:way G4:2:up F4:5.5:high
        G3:.5:There's D#4:2:a D4:1.333:land C4:.333:that D4:.334:I
        D4:1:heard D#4:1:of C4:2.5:once A3:.25:in Bb3:.25:a C4:.5:lull D4:.5:a Bb3:5:by
        Bb3:1:Some Bb4:2:where A4:1.5:o F4:.25:ver G4:.25:the A4:1:rain Bb4:3:bow
        Bb3:1:skies G4:1:are F4:4.5:blue
        D#4:3.25:And D#4:.25:the D4:1.333:dreams Bb3:.333:that C4:.334:you
        D4:1:dare D#4:1:to C4:1.5:dream A3:.25:real Bb3:.25:ly C4:1:do D4:1:come Bb3:3:true`,
      chords: 'Bb:6 Bb7:2 Eb:2 Eb7:2 Gm7:2 Bb7:2 Eb:2 Cm:2 Gm7:2 Ab7:2 C7:2 Eb:2 Gm7:2 F7:2 Bb:4 Dm7:3 Bb7:1 Eb:4 Gm7:2 Bb7:2 Eb:4 Gm7:2 Fm7:2 C7:2 Gm7:2 Bb:3',
    },
    {
      id: 'fly-me-to-the-moon',
      title: 'Fly Me to the Moon',
      bpm: 112,
      // Bart Howard, 1954 ("In Other Words"), in the 4/4 swing of Sinatra and
      // Basie. Notes, timing and chords from a MIDI of the big-band arrangement
      // (bitmidi.com/uploads/58514.mid; tune on Alto Sax 1 / Tenor Sax 1), in C.
      // The swung eighths are thirds of a beat. Up to "baby kiss me", twice;
      // its last note holds over a closing G7 - C (the band plays on there).
      notes: `
        C5:1.333:Fly B4:1:me A4:1:to G4:.667:the F4:3:moon
        G4:.333:let A4:.667:me C5:.333:play B4:1:a A4:1:mong G4:1:the F4:.667:stars
        E4:5:-
        A4:.333:let G4:1:me F4:1:see E4:.667:what D4:1:spring E4:1.333:is
        F4:1:like A4:1:on G#4:1.667:Ju F4:.333:pi E4:1:ter D4:.667:and C4:3:Mars
        C#4:1.333:In D4:1:oth A4:.667:er A4:4:words
        C5:1.333:hold B4:.667:my G4:3:hand
        G4:.333:In A4:.667:oth G4:.333:er B4:1:words B4:1:ba A4:.333:by
        E4:3.334:kiss C4:4.333:me
        C5:1.333:Fly B4:1:me A4:1:to G4:.667:the F4:3:moon
        G4:.333:let A4:.667:me C5:.333:play B4:1:a A4:1:mong G4:1:the F4:.667:stars
        E4:5:-
        A4:.333:let G4:1:me F4:1:see E4:.667:what D4:1:spring E4:1.333:is
        F4:1:like A4:1:on G#4:1.667:Ju F4:.333:pi E4:1:ter D4:.667:and C4:3:Mars
        C#4:1.333:In D4:1:oth A4:.667:er A4:4:words
        C5:1.333:hold B4:.667:my G4:3:hand
        G4:.333:In A4:.667:oth G4:.333:er B4:1:words B4:1:ba A4:.333:by
        E4:3.334:kiss C4:4.333:me`,
      chords: 'Am7:4.333 Dm7:4 G7:4 C:4 F:4 Dm7:4 E7:4 Am7:2 A7:2 Dm7:4 G7:4 C:4 Em7:2 Am7:2 Dm7:4 G7:1 C:1 Am7:4.333 Dm7:4 G7:4 C:4 F:4 Dm7:4 E7:4 Am7:2 A7:2 Dm7:4 G7:4 C:4 Em7:2 Am7:2 Dm7:4 G7:1 C:1',
    },
    {
      id: 'cant-help-falling-in-love',
      title: "Can't Help Falling in Love",
      bpm: 67,
      // Hugo Peretti, Luigi Creatore & George David Weiss, 1961 (Elvis
      // Presley); the tune is Martini's "Plaisir d'amour", 1784. Notes,
      // timing and chords from a karaoke MIDI (bitmidi.com/uploads/21571.mid),
      // in D; it swings in threes (12/8), so the short notes are thirds.
      notes: `
        D4:2:Wise A4:2:men D4:3.333:say E4:.333:on F#4:.334:ly
        G4:2:fools F#4:2:rush E4:3.667:in A3:.333:but
        B3:2:I C#4:2:can't D4:2:help E4:.667:fall F#4:.667:ing G4:.666:in
        F#4:2:love E4:2:with D4:4:you
        D4:2:Shall A4:2:I D4:3.333:stay E4:.333:would F#4:.334:it
        G4:2:be F#4:2:a E4:3.667:sin A3:.333:if
        B3:2:I C#4:2:can't D4:2:help E4:.667:fall F#4:.667:ing G4:.666:in
        F#4:2:love E4:2:with D4:6:you`,
      chords: 'D:2 F#m:2 Bm:4 G:2 D:2 A7:4 G:2 A:2 Bm:2 Em:2 D:2 A7:2 D:4 D:2 F#m:2 Bm:4 G:2 D:2 A7:4 G:2 A:2 Bm:2 Em:2 D:2 A7:2 D:6',
    },
    {
      id: 'o-mio-babbino-caro',
      title: 'O mio babbino caro (Puccini)',
      bpm: 100,
      // Giacomo Puccini, Gianni Schicchi, 1918; words by Giovacchino Forzano.
      // Notes and timing from a MIDI of the tune (bitmidi.com/uploads/86860.mid,
      // a one-line "Lead" over a "Pad"), in F (the MIDI is in Ab, 140 beats a
      // minute; moved down a minor third to sit in range, and slowed). The MIDI
      // flattens the 12/8 into plain beats and has no real harmony (its pad just
      // doubles the tune), so the chords are ours, plain ones under the tune.
      // The first phrases to "Sì, sì, ci voglio andare"; the opening "O" is left
      // out (the MIDI has no note for it), the words are fitted by ear.
      notes: `
        F4:2:mio F4:1:bab A4:2:bi E4:1:no D4:3:ca C4:3:ro
        F4:1:mi G4:1:pia A4:1:ce F4:2:bel F5:1:lo C5:3:bel C5:2:lo
        A4:1:vo C5:2:da G4:1:re Bb4:2:Por A4:1:ta F4:3:Ros F4:3:sa
        F4:1:a G4:1:com A4:1:pe F4:2:rar E4:1:l'a G4:3:nel G4:3:lo
        C4:1:si F4:2:si A4:1:ci F4:1:vo E4:1:glio D4:1:an C4:3:da C4:3:re`,
      chords: 'F:5 C7:1 Bb:3 C7:3 F:1 C:1 F:4 C:3 C:2 F:1 C:3 Bb:2 F:1 F:3 Bb:3 F:1 C:1 F:1 F:2 C7:1 C7:6 C:1 F:2 F:1 F:1 C7:1 Bb:1 C7:3 F:3',
    },
    {
      id: 'nessun-dorma',
      title: 'Nessun dorma (Puccini)',
      bpm: 56,
      // Giacomo Puccini, Turandot, 1926 (completed by Franco Alfano); words by
      // Giuseppe Adami and Renato Simoni. Notes, timing and chords from a MIDI
      // (bitmidi.com/uploads/18966.mid, tenor line on channel 4), in D (the MIDI
      // is in G; moved down a fourth so the high notes sit in range). The MIDI is
      // played with rubato; the timing is rounded to sixteenths. "Nessun dorma"
      // to "speranza", then the end: "Tramontate, stelle", "All'alba vincerò".
      // The aria's odd Eb chord (with D, C and F# in it) is a plain Bb here.
      notes: `
        A4:.75:Nes A4:.25:sun A4:1:dor A4:2:ma A3:.75:Nes A3:.25:sun A3:1:dor A3:4.5:ma
        A4:.5:Tu A4:.5:pu A4:.5:reo A4:.75:Prin G4:.25:ci F#4:1:pes F#4:1:sa F#4:.25:nel
        F#4:.25:la F#4:.5:tua F4:.75:fred C#4:.25:da D4:1:stan D4:1:za C#5:1:guar C#5:.75:di
        B4:.25:a A4:1:stel A4:.5:le A4:.5:che A4:.5:tre A4:.5:ma A4:.75:no G4:.25:d'a
        F#4:1:mo F#4:1.5:re F#4:.5:e F4:.75:di C#4:.25:spe D4:1:ran D4:3.5:za
        C#5:.5:tra C#5:.5:mon C#5:.75:ta A4:.25:te E4:1:stel E4:.5:le E4:.5:al E4:.5:l'al
        E4:.5:ba B4:.75:vin G#4:.25:ce A4:3:ro F#4:.75:Vin A4:.25:ce D5:3:ro A4:.75:Vin
        F#5:.25:ce E5:4:ro`,
      chords: 'Bb:1 D:3 Bb:1 D:7 Bb:1 D:3 Bb:1 D:2 Bb:2 D:3 Bb:1 D:3 Bb:1 D:4.5 Bm:1 D:1 A:3 E7:1 D:8 A:4',
    },
    {
      id: 'pie-jesu',
      title: 'Pie Jesu (Lloyd Webber)',
      bpm: 38,
      // Andrew Lloyd Webber, 1985 (Requiem; the Latin prayer text). Still in
      // copyright. Notes and timing from a MIDI (bitmidi.com/uploads/85062.mid,
      // "PIE-JESU.MID", its Solo Soprano track), the first sung stretch: the
      // two opening phrases, then the falling run and the high held note. The
      // MIDI is in Ab; here it is in C (down eight semitones). The MIDI's
      // accompaniment is single root notes, so the chords are those roots
      // with major or minor read from the tune (the Fm, Cm are minor because
      // the tune sings their minor third). Only the title words are sung.
      notes: `
        E4:.5:pie E4:.5:- F4:1:Je D4:2:su
        A3:.5:oo F4:.5:- E4:1:- D4:2:-
        E4:.5:pie E4:.5:- F4:1:Je D4:2:su
        A3:.5:oo F4:.5:- E4:1:- D4:2.5:-
        G4:.5:oo C5:1:ah B4:.5:- A4:.5:- G4:.5:- F4:.5:- E4:.5:- F4:.5:-
        G4:.5:oo G4:.5:- G4:.5:- E4:.5:- G4:.5:- E4:.25:- C5:2.25:ah
        B4:.5:oo A4:.5:- G4:.5:- F4:.5:- E4:.5:- G4:.5:- E4:.25:- D4:.25:- C4:1.5:-`,
      chords: 'F:5 G:4 F:4 G:4 F:2 G:2 Em:2 Am:2 F:2 G:2 C:2',
    },
    {
      id: 'unchained-melody',
      title: 'Unchained Melody',
      bpm: 66,
      // Alex North (music) and Hy Zaret (words), 1955; the Righteous Brothers
      // made it famous in 1965. Still in copyright. Notes, timing and chords
      // from a MIDI (bitmidi.com/uploads/107032.mid, its "vocal" track and its
      // bass), the opening: the first two stanzas and the climbing line after
      // them (the MIDI's two-bar intro is left out). The MIDI is in C; here it
      // is in Eb, up a minor third to sit in range. The hum on the long "oo" holds
      // through the rests; the quick curls are slurred.
      notes: `
        Eb4:3:oo G4:.5:- F4:.5:-
        Eb4:.25:oo F4:.25:- G4:.25:- F4:.25:- Eb4:2.5:- F4:.5:-
        G4:1:oo Eb4:3:-
        Bb3:1.5:oo D4:.5:- F4:1.5:- G4:.5:-
        Eb4:3.5:oo F4:.5:-
        Eb4:2.75:oo G3:.75:- Ab3:.5:-
        Bb3:7.5:oo Bb3:.5:-
        Eb4:2.5:oo G4:.75:- F4:.25:- Eb4:.25:- F4:.25:-
        G4:.25:oo F4:.25:- Eb4:3:- F4:.5:-
        G4:.5:oo F4:.5:- Eb4:.5:- F4:.25:- Eb4:.25:- C4:1.75:- Eb4:.25:-
        Bb3:2.75:oo Bb3:.25:- F4:.5:- G4:.25:- F4:.25:-
        Eb4:.25:oo F4:.25:- Eb4:3:- F4:.5:-
        G4:.25:oo F4:.25:- G4:.25:- F4:.25:- Eb4:2.75:- Eb4:.25:-
        Bb4:4:oo
        D5:1.335:oo C5:.333:- D5:.167:- C5:.166:- Bb4:.167:- C5:.166:- Bb4:.333:- Ab4:.167:- Bb4:.166:- Ab4:1:-
        G4:1.25:oo Eb4:.5:- Bb3:2.25:-`,
      chords: 'Eb:4 Cm:4 Ab:4 Bb:4 Eb:4 Cm:4 Bb:8 Eb:4 Cm:4 Ab:4 Bb:4 Eb:4 Cm:4 Bb:8 Eb:4',
    },
    {
      id: 'careless-whisper',
      title: 'Careless Whisper (the sax)',
      bpm: 77,
      // George Michael and Andrew Ridgeley, 1984. Still in copyright. Only the
      // saxophone riff that opens it, twice. Notes, timing and chords from a
      // MIDI (bitmidi.com/uploads/22027.mid, its Alto Sax and bass), in D
      // minor like the recording. The MIDI's little four-note run into each
      // repeat is left out; the long low note holds through its rest.
      notes: `
        E5:.5:doo D5:.25:- A4:.5:doo F4:.75:doo E5:.5:doo D5:.25:- A4:.5:doo F4:.75:doo
        C5:.5:doo Bb4:.25:- F4:.5:doo D4:.75:doo C5:.5:doo Bb4:.25:- F4:.25:- F4:1:doo
        Bb4:.5:doo A4:.25:- F4:.5:doo D4:.5:doo Bb3:2.25:doo
        A3:.5:doo Bb3:.5:- C4:.5:- D4:.5:- E4:.5:- F4:.5:- G4:.5:- A4:.5:-
        E5:.5:doo D5:.25:- A4:.5:doo F4:.75:doo E5:.5:doo D5:.25:- A4:.5:doo F4:.75:doo
        C5:.5:doo Bb4:.25:- F4:.5:doo D4:.75:doo C5:.5:doo Bb4:.25:- F4:.25:- F4:1:doo
        Bb4:.5:doo A4:.25:- F4:.5:doo D4:.5:doo Bb3:2.25:doo
        A3:.5:doo Bb3:.5:- C4:.5:- D4:.5:- E4:.5:- F4:.5:- G4:.5:- A4:.5:-`,
      chords: 'Dm:4 Gm:4 Bb:4 Am:4 Dm:4 Gm:4 Bb:4 Am:4',
    },
    {
      id: 'i-will-always-love-you',
      title: 'I Will Always Love You',
      bpm: 67,
      // Dolly Parton, 1973; Whitney Houston's 1992 version is the one followed.
      // Still in copyright. Notes and timing from a MIDI (bitmidi.com/uploads/59408.mid,
      // its MELODY track; chords from its bass and string pad), in A like the
      // recording, the first chorus (the MIDI writes it an octave up; here it
      // is the sung octave). The unaccompanied lead-in and the one-beat pickup
      // before the chorus are left out. The title words are sung where they
      // belong; the rest is "oo". The quick G#, F# and E turns after the long
      // notes are the singer's runs, kept as written.
      notes: `
        A4:5.75:I A4:.375:will Ab4:.5:al A4:1.875:ways
        B4:.25:love A4:1:- B4:.25:you C#5:.25:- B4:.125:- C#5:.25:- B4:.125:- A4:3:-
        A4:.25:oo Ab4:.5:- A4:1.75:-
        A4:.375:oo A4:6.125:-
        Ab4:.25:oo A4:.25:- Ab4:.125:- F#4:.125:- E4:.125:- F#4:.875:-
        F#4:.25:oo E4:.25:- F#4:.25:- E4:.125:- F#4:2.375:-
        E4:.25:oo Ab4:.375:- Ab4:.25:- F#4:3.375:-
        C#4:.25:oo A3:1.75:-`,
      chords: 'A:2 F#m:2 D:2 E:2 A:2 F#m:2 D:2 E:2 A:8 D:4 C#m:4 Bm7:2',
    },
    {
      id: 'all-you-need-is-love',
      title: 'All You Need Is Love',
      bpm: 102,
      // John Lennon and Paul McCartney, 1967. Still in copyright. The chorus,
      // twice. Notes and timing from a MIDI (bitmidi.com/uploads/5174.mid, its
      // CHARANG lead; checked against uploads/100741.mid, a karaoke file whose
      // vocal channel has the same notes); chords from its bass and pads.
      // The MIDI is in G; here it is in D (down a fourth). The singer rests
      // between the repeated lines; here the last note of each holds through
      // the rest. The second time is the same tune, without the words.
      notes: `
        A4:.667:all A4:.333:you A4:.667:need A4:1:is A4:5.333:love
        A4:.667:la A4:.333:- A4:.667:- A4:1:- A4:5.333:-
        A4:.667:la A4:.333:- Bb4:.667:- Bb4:1:- B4:2:- F#4:3.333:-
        E4:.333:la F#4:.333:- E4:1:- D4:.334:- D4:1:-
        A4:.667:la A4:.333:- A4:.667:- A4:1:- A4:5.333:-
        A4:.667:la A4:.333:- A4:.667:- A4:1:- A4:5.333:-
        A4:.667:la A4:.333:- Bb4:.667:- Bb4:1:- B4:2:- F#4:3.333:-
        E4:.333:la F#4:.333:- E4:1:- D4:.334:- D4:3:-`,
      chords: 'D:1 E:2 A:4 D:2 E:2 A:4 D:2 F#7:2 Bm:2 D:2 G:2 A7:2 D:1 E:2 A:4 D:2 E:2 A:4 D:2 F#7:2 Bm:2 D:2 G:2 A7:2 D:2',
    },
    {
      id: 'yesterday',
      title: 'Yesterday',
      bpm: 90,
      // John Lennon and Paul McCartney, 1965. Still in copyright. The first
      // verse, then the second verse's tune (nearly the same, with a few
      // shifted rhythms). Notes, timing and chords from a MIDI
      // (bitmidi.com/uploads/16448.mid, its melody track and the chord names it
      // carries), in C; the first verse's tune checked against uploads/16443.mid,
      // the same tune in F. The title words are sung at the start; the rest is
      // "oo". Csus4 and G/B are written C and G.
      notes: `
        D4:.5:yes C4:.25:ter C4:4.25:day
        E4:.5:oo F#4:.5:- G#4:.25:- A4:.75:- B4:.5:- C5:.5:- B4:1:- A4:.5:- A4:3.5:-
        A4:.5:oo A4:.5:- G4:.5:- F4:.25:- E4:.75:- D4:.5:- F4:1:- E4:.5:- E4:1.5:-
        D4:1:oo C4:1:- E4:.5:- D4:2:- A3:.5:- C4:1:- E4:.5:- E4:2.5:-
        D4:.25:oo C4:.5:- C4:4.25:-
        E4:.5:oo F#4:.5:- G#4:.5:- A4:.25:- B4:.75:- C5:.5:- B4:.5:- A4:.25:- A4:4.25:-
        A4:.5:oo A4:.25:- G4:.5:- F4:.75:- E4:.5:- D4:.5:- F4:1:- E4:.5:- E4:2:-
        D4:.5:oo C4:1:- E4:.5:- D4:2:- A3:.5:- C4:1:- E4:.5:- E4:2.5:-`,
      chords: 'C:4 Bm7:2 E7:2 Am:3 G:1 F:2 G:2 C:3 G:1 Am:2 D:2 F:1 C:3 C:4 Bm7:2 E7:2 Am:3 G:1 F:2 G:2 C:3 G:1 Am:2 D:2 F:1 C:3',
    },
  ];

  const api = { SONGS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BlaubeSongs = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
