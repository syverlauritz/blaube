// Songs the choir knows (Sing together, in the menu). All public domain.
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
			id: 'can-can',
			title: 'Can-can (Offenbach)',
			bpm: 150,
			// Jacques Offenbach, the Infernal Galop from Orpheus in the Underworld, 1858. Sung on "la".
			notes: `
				C4:1:la C4:.5:la D4:.5:la F4:.5:la E4:.5:la D4:.5:la G4:.5:la G4:1:la G4:.5:la A4:.5:la E4:.5:la F4:.5:la D4:.5:la
				D4:1:la D4:.5:la F4:.5:la E4:.5:la D4:.5:la C4:.5:la C5:.5:la B4:.5:la A4:.5:la G4:.5:la F4:.5:la E4:.5:la D4:.5:la C4:1.5:la
				C4:1:la C4:.5:la D4:.5:la F4:.5:la E4:.5:la D4:.5:la G4:.5:la G4:1:la G4:.5:la A4:.5:la E4:.5:la F4:.5:la D4:.5:la
				D4:1:la D4:.5:la F4:.5:la E4:.5:la D4:.5:la C4:.5:la G4:.5:la D4:.5:la E4:.5:la C4:3.5:la`,
			chords: 'C:4 G:4 G:2 C:2 G:2 C:2 C:4 G:4 G:2 C:2 G:2 C:2',
		},
  ];

  const api = { SONGS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BlaubeSongs = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
