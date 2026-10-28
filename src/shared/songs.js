// Songs the choir knows (Sing together, in the menu). Old and famous; mostly public domain.
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
      bpm: 92,
      // Franz Gruber, 1818; English words by John Freeman Young, 1859.
      notes: `
        G4:1.5:Si A4:.5:lent G4:1:night E4:3:-
        G4:1.5:Ho A4:.5:ly G4:1:night E4:3:-
        D5:2:All D5:1:is B4:3:calm
        C5:2:All C5:1:is G4:3:bright
        A4:2:Round A4:1:yon C5:1.5:vir B4:.5:gin A4:1:mo
        G4:1.5:ther A4:.5:and G4:1:child E4:3:-
        A4:2:Ho A4:1:ly C5:1.5:in B4:.5:fant A4:1:so
        G4:1.5:ten A4:.5:der G4:1:and E4:3:mild
        D5:2:Sleep D5:1:in F5:1.5:hea D5:.5:ven B4:1:ly
        C5:3:peace E5:3:-
        C5:1.5:Sleep G4:.5:in E4:1:hea G4:1.5:ven F4:.5:ly D4:1:peace
        C4:6:-`,
      chords: 'C:12 G:6 C:6 F:6 C:6 F:6 C:6 G:3 G7:3 C:6 C:3 G7:3 C:6',
    },
    {
      id: 'canon',
      title: 'Canon in D (Pachelbel)',
      bpm: 66,
      // Johann Pachelbel, around 1680. Sung on "ah" over its eight chords.
      notes: `
        F#5:2:ah E5:2:ah D5:2:ah C#5:2:ah B4:2:ah A4:2:ah B4:2:ah C#5:2:ah
        D5:2:la C#5:2:la B4:2:la A4:2:la G4:2:la F#4:2:la G4:2:la E4:2:la
        F#5:2:ah E5:2:ah D5:2:ah C#5:2:ah B4:2:ah A4:2:ah B4:2:ah C#5:2:ah
        D5:6:ah`,
      chords: 'D:2 A:2 Bm:2 F#m:2 G:2 D:2 G:2 A:2 D:2 A:2 Bm:2 F#m:2 G:2 D:2 G:2 A:2 D:2 A:2 Bm:2 F#m:2 G:2 D:2 G:2 A:2 D:6',
    },
    {
      id: 'ode-to-joy',
      title: 'Ode to Joy',
      bpm: 112,
      // Ludwig van Beethoven, 1824; words by Friedrich Schiller, 1785.
      notes: `
        E4:1:Freu E4:1:de F4:1:schö G4:1:ner G4:1:Göt F4:1:ter E4:1:fun D4:1:ken
        C4:1:Toch C4:1:ter D4:1:aus E4:1:E E4:1.5:ly D4:.5:si D4:2:um
        E4:1:Wir E4:1:be F4:1:tre G4:1:ten G4:1:feu F4:1:er E4:1:trun D4:1:ken
        C4:1:Himm C4:1:li D4:1:sche E4:1:dein D4:1.5:Hei C4:.5:lig C4:2:tum
        D4:1:Dei D4:1:ne E4:1:Zau C4:1:ber D4:1:bin E4:.5:den F4:.5:- E4:1:wie C4:1:der
        D4:1:was E4:.5:die F4:.5:- E4:1:Mo D4:1:de C4:1:streng D4:1:ge G3:2:teilt
        E4:1:al E4:1:le F4:1:Men G4:1:schen G4:1:wer F4:1:den E4:1:Brü D4:1:der
        C4:1:wo C4:1:dein D4:1:sanf E4:1:ter D4:1.5:Flü C4:.5:gel C4:2:weilt`,
      chords: 'C:4 G:4 C:4 G:2 C:2 C:4 G:4 C:4 G:2 C:2 G:2 C:2 G:2 C:2 G:2 C:2 C:2 G:2 C:4 G:4 C:4 G:2 C:2',
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
      bpm: 68,
      // Harold Arlen / E.Y. Harburg, 1939 (The Wizard of Oz). The main
      // theme twice, 16 bars, in C.
      notes: `
        C4:2:Some C5:2:where
        B4:1:o G4:0.5:ver A4:0.5:the B4:1:rain C5:1:bow
        C4:2:way A4:2:up
        G4:4:high
        C4:2:There's F4:2:a
        E4:1:land C4:0.5:that D4:0.5:I E4:1:heard F4:1:of
        D4:1:once B3:0.5:in C4:0.5:a D4:1:lull E4:1:a
        C4:4:by
        C4:2:Some C5:2:where
        B4:1:o G4:0.5:ver A4:0.5:the B4:1:rain C5:1:bow
        C4:2:skies A4:2:are
        G4:4:blue
        C4:2:And F4:2:the
        E4:1:dreams C4:0.5:that D4:0.5:you E4:1:dare F4:1:to
        D4:1:dream B3:0.5:real C4:0.5:ly D4:1:do E4:1:come
        C4:4:true`,
      chords: 'C:4 Em:4 F:4 C:4 F:4 C:3 F:1 G7:2 C:2 C:4 C:4 Em:4 F:4 C:4 F:4 C:3 F:1 G7:2 C:2 C:4',
    },
    {
      id: 'fly-me-to-the-moon',
      title: 'Fly Me to the Moon',
      bpm: 120,
      // Bart Howard, 1954 ("In Other Words"). The melody from a
      // virtual-piano transcription, in C.
      notes: `
        C5:3:Fly B4:.333:me A4:.333:to G4:.334:the
        F4:1:moon G4:2.5:let A4:.5:me
        C5:.5:play B4:2:a A4:1:mong G4:.25:the F4:.25:stars E4:5.5:-
        A4:.5:let G4:.5:me F4:.5:see E4:1:what
        D4:1.5:spring E4:.5:is F4:.5:like A4:1.5:on
        G#4:2.5:Ju F4:1:pi E4:.25:ter D4:.25:and
        C4:3.5:Mars C4:.5:In
        D4:.5:oth A4:1.5:er A4:4:words
        C5:1.5:hold B4:.5:my G4:7.5:hand
        C4:.5:In C4:.5:oth F4:.5:er F4:4:words
        A4:1.5:ba G4:1.5:by F4:1.5:kiss E4:6.5:me`,
      chords: 'Am7:4 Dm7:4 G7:4 C:4 F:4 Bm7:4 E7:4 Am7:3 A7:1 Dm7:4 G7:4 C:4 A7:4 Dm7:4 G7:4 C:8',
    },
    {
      id: 'cant-help-falling-in-love',
      title: "Can't Help Falling in Love",
      bpm: 100,
      // Hugo Peretti, Luigi Creatore & George David Weiss, 1961 (Elvis
      // Presley); the tune is Martini's "Plaisir d'amour", 1784. Here in G.
      notes: `
        G4:2:Wise D5:2:men G4:2:say
        A4:1:on B4:1:ly C5:1:fools B4:1:rush A4:2:in
        D4:1:But E4:1:I F#4:1:can't G4:1:help A4:1:fall B4:1:ing
        C5:1:in B4:1:love A4:1:with G4:3:you
        G4:2:Shall D5:2:I G4:2:stay
        A4:1:would B4:1:it C5:1:be B4:1:a A4:2:sin
        D4:1:If E4:1:I F#4:1:can't G4:1:help A4:1:fall B4:1:ing
        C5:1:in B4:1:love A4:1:with G4:6:you`,
      chords: 'G:2 D:2 Em:2 C:2 G:2 D:2 C:2 D:2 Em:2 Am:2 D:1 G:3 G:2 D:2 Em:2 C:2 G:2 D:2 C:2 D:2 Em:2 Am:2 D:1 G:6',
    },
  ];

  const api = { SONGS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BlaubeSongs = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
