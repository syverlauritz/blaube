// What the words sound like, for the voice (voice.js): text becomes
// phonemes, written as the CMU Pronouncing Dictionary writes them (ARPABET:
// "okay" is OW2 K EY1, the digit on a vowel its stress: 1 main, 2 some, 0
// none). The words slimes say most (their little exclamations, the
// end-of-turn cheers, what Claude Code's notifications say) are written
// out here by hand; any other word is spelled out by English spelling
// rules, which get most words close enough to be understood.
//
// words(text) returns [{ word, phones: ['OW2', 'K', 'EY1'], pause }] where
// pause is what follows the word: '' (straight on), 'word', 'comma',
// 'stop', '?' or '!'.
(function (root) {
  'use strict';

  const LEXICON = {
    // Answers, cheers, exclamations.
    okay: 'OW2 K EY1', ok: 'OW2 K EY1', yes: 'Y EH1 S', no: 'N OW1', yay: 'Y EY1', hurray: 'HH AH0 R EY1', hooray: 'HH UH0 R EY1',
    yippee: 'Y IH0 P IY1', tada: 'T AH0 D AA1', woohoo: 'W UW1 HH UW1', woo: 'W UW1', hoo: 'HH UW1', all: 'AO1 L', done: 'D AH1 N',
    hehe: 'HH IY1 HH IY0', hehehe: 'HH IY1 HH IY0 HH IY0', haha: 'HH AA1 HH AA0', ahaha: 'AA0 HH AA1 HH AA0', hihi: 'HH IY1 HH IY0',
    hihihi: 'HH IY1 HH IY0 HH IY0', hee: 'HH IY1', tee: 'T IY1', kiki: 'K IY1 K IY0', ha: 'HH AA1', hi: 'HH AY1', hey: 'HH EY1',
    bye: 'B AY1', whoa: 'W OW1', whee: 'W IY1', boo: 'B UW1', achoo: 'AA0 CH UW1', eww: 'IY1 W UW0', ew: 'IY1 W UW0',
    eek: 'IY1 K', eep: 'IY1 P', oof: 'UW1 F', ugh: 'AH1 G', hmm: 'HH AH1 M', mm: 'AH0 M', hm: 'HH AH1 M', oh: 'OW1', aw: 'AO1',
    uh: 'AH1', huh: 'HH AH1', oops: 'UW1 P S', whoops: 'W UW1 P S', pop: 'P AA1 P', boing: 'B OY1 NG', nom: 'N AA1 M', yum: 'Y AH1 M',
    brr: 'B ER1', hic: 'HH IH1 K', burp: 'B ER1 P', pbbbt: 'P B AH1 T', pbbt: 'P B AH1 T', pfffbt: 'P F AH1 T', pffbt: 'P F AH1 T',
    eh: 'EH1', ah: 'AA1', la: 'L AA1', doo: 'D UW1', bum: 'B AH1 M',
    // Small words, and ones spelling gets wrong.
    a: 'AH0', an: 'AH0 N', the: 'DH AH0', of: 'AH0 V', to: 'T UW0', too: 'T UW1', two: 'T UW1', do: 'D UW1', you: 'Y UW1',
    your: 'Y AO1 R', "you'll": 'Y UW1 L', "you're": 'Y UH1 R', i: 'AY1', "i'm": 'AY1 M', "i'll": 'AY1 L', me: 'M IY1', my: 'M AY1',
    we: 'W IY1', he: 'HH IY1', she: 'SH IY1', it: 'IH1 T', "it's": 'IH1 T S', is: 'IH1 Z', are: 'AA1 R', was: 'W AA1 Z',
    were: 'W ER1', be: 'B IY1', been: 'B IH1 N', have: 'HH AE1 V', has: 'HH AE1 Z', said: 'S EH1 D', says: 'S EH1 Z',
    what: 'W AH1 T', who: 'HH UW1', "who's": 'HH UW1 Z', where: 'W EH1 R', there: 'DH EH1 R', their: 'DH EH1 R', they: 'DH EY1',
    them: 'DH EH1 M', then: 'DH EH1 N', this: 'DH IH1 S', that: 'DH AE1 T', these: 'DH IY1 Z', those: 'DH OW1 Z', with: 'W IH1 DH',
    one: 'W AH1 N', once: 'W AH1 N S', any: 'EH1 N IY0', many: 'M EH1 N IY0', some: 'S AH1 M', come: 'K AH1 M', from: 'F R AH1 M',
    for: 'F AO1 R', or: 'AO1 R', and: 'AE1 N D', not: 'N AA1 T', "don't": 'D OW1 N T', "can't": 'K AE1 N T', "won't": 'W OW1 N T',
    again: 'AH0 G EH1 N', give: 'G IH1 V', live: 'L IH1 V', love: 'L AH1 V', know: 'N OW1', now: 'N AW1', how: 'HH AW1',
    'let\'s': 'L EH1 T S', gonna: 'G AH1 N AH0', got: 'G AA1 T', get: 'G EH1 T', go: 'G OW1', so: 'S OW1', on: 'AA1 N',
    off: 'AO1 F', up: 'AH1 P', out: 'AW1 T', over: 'OW1 V ER0', thanks: 'TH AE1 NG K S', thank: 'TH AE1 NG K',
    sorry: 'S AA1 R IY0', anytime: 'EH1 N IY0 T AY2 M', please: 'P L IY1 Z', claude: 'K L AO1 D', code: 'K OW1 D',
    // What slimes say, and Claude Code's notifications.
    coffee: 'K AO1 F IY0', lunch: 'L AH1 N CH', time: 'T AY1 M', bless: 'B L EH1 S', trick: 'T R IH1 K', treat: 'T R IY1 T',
    sweets: 'S W IY1 T S', funny: 'F AH1 N IY0', copycat: 'K AA1 P IY0 K AE2 T', leapfrog: 'L IY1 P F R AA2 G',
    taller: 'T AO1 L ER0', ready: 'R EH1 D IY0', everyone: 'EH1 V R IY0 W AH2 N', dogpile: 'D AA1 G P AY2 L', tower: 'T AW1 ER0',
    follow: 'F AA1 L OW0', happy: 'HH AE1 P IY0', year: 'Y IH1 R', almost: 'AO1 L M OW2 S T', weekend: 'W IY1 K EH2 N D',
    monday: 'M AH1 N D EY2', keeps: 'K IY1 P S', failing: 'F EY1 L IH0 NG', glasses: 'G L AE1 S IH0 Z', pushed: 'P UH1 SH T',
    tests: 'T EH1 S T S', test: 'T EH1 S T', pass: 'P AE1 S', need: 'N IY1 D', needs: 'N IY1 D Z', permission: 'P ER0 M IH1 SH AH0 N',
    use: 'Y UW1 Z', waiting: 'W EY1 T IH0 NG', input: 'IH1 N P UH2 T', skipping: 'S K IH1 P IH0 NG', rope: 'R OW1 P',
    found: 'F AW1 N D', catch: 'K AE1 CH', caught: 'K AO1 T', strike: 'S T R AY1 K', tag: 'T AE1 G', high: 'HH AY1', five: 'F AY1 V',
    new: 'N UW1', still: 'S T IH1 L', gone: 'G AO1 N', bash: 'B AE1 SH', approve: 'AH0 P R UW1 V', idle: 'AY1 D AH0 L',
    // Numbers, for counting.
    zero: 'Z IH1 R OW0', three: 'TH R IY1', four: 'F AO1 R', six: 'S IH1 K S', seven: 'S EH1 V AH0 N', eight: 'EY1 T', nine: 'N AY1 N',
    ten: 'T EH1 N', eleven: 'IH0 L EH1 V AH0 N', twelve: 'T W EH1 L V', twenty: 'T W EH1 N T IY0', thirty: 'TH ER1 T IY0',
    forty: 'F AO1 R T IY0', fifty: 'F IH1 F T IY0', hundred: 'HH AH1 N D R AH0 D',
  };

  // Spelling rules: [letters, phones, (optional) a test on what's around
  // them], tried longest first at each place in the word.
  const V = 'aeiouy';
  const isV = (c) => !!c && V.includes(c);
  const atEnd = (w, i, n) => i + n === w.length;
  const RULES = [
    ['tion', 'SH AH N'], ['sion', 'ZH AH N', (w, i) => isV(w[i - 1])], ['sion', 'SH AH N'], ['ture', 'CH ER'], ['eigh', 'EY'], ['ough', 'AO'], ['augh', 'AO'],
    ['tch', 'CH'], ['sch', 'S K'], ['igh', 'AY'], ['dge', 'JH'], ['ing', 'IH NG', (w, i) => atEnd(w, i, 3)],
    ['ph', 'F'], ['sh', 'SH'], ['ch', 'CH'], ['th', 'TH'], ['ck', 'K'], ['ng', 'NG'], ['qu', 'K W'], ['wh', 'W'],
    ['wr', 'R', (w, i) => i === 0], ['kn', 'N', (w, i) => i === 0], ['gh', 'G', (w, i) => i === 0], ['gh', ''],
    ['ee', 'IY'], ['ea', 'IY'], ['oo', 'UW'], ['ou', 'AW'], ['ow', 'OW', (w, i) => atEnd(w, i, 2)], ['ow', 'AW'], ['oi', 'OY'], ['oy', 'OY'],
    ['ai', 'EY'], ['ay', 'EY'], ['au', 'AO'], ['aw', 'AO'], ['ey', 'IY', (w, i) => atEnd(w, i, 2)], ['ie', 'IY', (w, i) => atEnd(w, i, 2)],
    ['oa', 'OW'], ['ue', 'UW'], ['ew', 'UW'], ['ui', 'UW'],
    ['er', 'ER', (w, i) => !isV(w[i + 2])], ['ir', 'ER', (w, i) => !isV(w[i + 2])], ['ur', 'ER', (w, i) => !isV(w[i + 2])],
    ['ar', 'AA R', (w, i) => !isV(w[i + 2])], ['or', 'AO R', (w, i) => !isV(w[i + 2])],
    ['le', 'AH L', (w, i) => atEnd(w, i, 2) && i > 0 && !isV(w[i - 1])],
    ['ed', 'D', (w, i) => atEnd(w, i, 2) && i > 1 && !/[td]/.test(w[i - 1])], ['ed', 'IH D', (w, i) => atEnd(w, i, 2) && i > 1],
    ['es', 'IH Z', (w, i) => atEnd(w, i, 2) && /(s|x|z|ch|sh)$/.test(w.slice(0, i))],
    ['e', '', (w, i) => atEnd(w, i, 1) && i > 1], ['e', '', (w, i) => i > 1 && /^(s|d)$/.test(w.slice(i + 1)) && !isV(w[i - 1]) && isV(w[i - 2])],
    ['c', 'S', (w, i) => /[eiy]/.test(w[i + 1] || '')], ['g', 'JH', (w, i) => /[eiy]/.test(w[i + 1] || '') && i > 0],
    ['s', 'Z', (w, i) => atEnd(w, i, 1) && i > 0 && /[aeioubdglmnrvwy]/.test(w[i - 1])],
    ['y', 'Y', (w, i) => i === 0], ['y', 'AY', (w, i) => atEnd(w, i, 1) && w.length <= 3], ['y', 'IY', (w, i) => atEnd(w, i, 1)], ['y', 'IH'],
    ['x', 'K S'], ['b', 'B'], ['c', 'K'], ['d', 'D'], ['f', 'F'], ['g', 'G'], ['h', 'HH'], ['j', 'JH'], ['k', 'K'], ['l', 'L'],
    ['m', 'M'], ['n', 'N'], ['p', 'P'], ['q', 'K'], ['r', 'R'], ['s', 'S'], ['t', 'T'], ['v', 'V'], ['w', 'W'], ['z', 'Z'],
  ];
  // A vowel letter: long when a single consonant and a silent e follow it
  // ("time", "code"), short otherwise.
  const SHORT = { a: 'AE', e: 'EH', i: 'IH', o: 'AA', u: 'AH' };
  const LONG = { a: 'EY', e: 'IY', i: 'AY', o: 'OW', u: 'UW' };
  const magicE = (w, i) => !isV(w[i + 1]) && w[i + 1] && !/[xwh]/.test(w[i + 1]) && (w[i + 2] === 'e' && (i + 3 === w.length || /^(s|d)$/.test(w.slice(i + 3))));

  function spell(w) {
    const out = [];
    for (let i = 0; i < w.length;) {
      if (w[i] === w[i + 1] && !isV(w[i])) { i++; continue; } // a double consonant is one
      if (isV(w[i]) && w[i] !== 'y' && !(RULES.some(([k, , ok]) => w.startsWith(k, i) && (!ok || ok(w, i))))) {
        out.push(magicE(w, i) ? LONG[w[i]] : atEnd(w, i, 1) && w.length <= 2 ? LONG[w[i]] : SHORT[w[i]]);
        i++;
        continue;
      }
      const r = RULES.find(([k, , ok]) => w.startsWith(k, i) && (!ok || ok(w, i)));
      if (!r) { i++; continue; }
      if (r[1]) out.push(...r[1].split(' '));
      i += r[0].length;
    }
    // An ending s or d after a voiceless sound is said voiceless too
    // ("likes", "stopped").
    const n = out.length;
    if (n > 1 && /^(P|T|K|F|TH|S|SH|CH)$/.test(out[n - 2])) out[n - 1] = { Z: 'S', D: 'T' }[out[n - 1]] || out[n - 1];
    // Stress: on the first vowel. The others are said lightly, a short
    // a, e or o as "uh".
    let stressed = false;
    return out.map((p) => {
      if (!/^[AEIOU]/.test(p)) return p;
      const s = stressed ? '0' : '1';
      if (stressed && /^(AE|EH|AA)$/.test(p)) p = 'AH';
      stressed = true;
      return p + s;
    });
  }

  const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  function number(n) {
    if (n < 20) return [ONES[n]];
    if (n < 100) return [TENS[Math.floor(n / 10)], ...(n % 10 ? [ONES[n % 10]] : [])];
    if (n < 1000) return [ONES[Math.floor(n / 100)], 'hundred', ...(n % 100 ? number(n % 100) : [])];
    return String(n).split('').map((d) => ONES[+d]);
  }

  // One word's phonemes: from the dictionary, or spelled out. A drawn-out
  // word ("wheee", "boooo") is looked up without the extra letters and
  // comes back marked long.
  function pronounce(word) {
    const w = word.toLowerCase().replace(/[’`]/g, "'").replace(/-/g, '');
    if (LEXICON[w]) return { phones: LEXICON[w].split(' '), long: false };
    const short = w.replace(/(.)\1{2,}/g, '$1$1');
    const long = short !== w;
    for (const k of [short, short.replace(/(.)\1+/g, '$1')]) if (LEXICON[k]) return { phones: LEXICON[k].split(' '), long };
    return { phones: spell(short.replace(/'/g, '')), long };
  }

  function words(text) {
    const out = [];
    const tokens = String(text).replace(/[’`]/g, "'").match(/\d+|[\p{L}]+(?:['’-][\p{L}]+)*|[.,!?;:…]/gu) || [];
    for (const tok of tokens) {
      if (/^[.,!?;:…]$/.test(tok)) {
        if (out.length) out[out.length - 1].pause = tok === '?' ? '?' : tok === '!' ? '!' : /[,;:]/.test(tok) ? 'comma' : 'stop';
        continue;
      }
      for (const w of /^\d+$/.test(tok) ? number(+tok) : [tok]) {
        const { phones, long } = pronounce(w);
        if (phones.some((p) => /\d$/.test(p))) out.push({ word: w, phones, long, pause: 'word' });
      }
    }
    return out;
  }

  const api = { words, pronounce, spell, LEXICON };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BlaubeWords = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
