// How a prompt sounds, as far as a slime can tell: thanks and praise
// ("thanks!", "perfect", "nice work") or a telling-off ("no, that's
// wrong", "wtf"). Only short prompts count: a long one that happens to say
// "great" somewhere is just instructions.

const PRAISE = /\b(thanks?|thank you|thx|ty|great( (job|work))?|nice( (one|work|job))?|good (job|work|stuff)|well done|perfect|awesome|amazing|brilliant|excellent|love (it|this)|you rock|legend|bravo|takk)\b|(❤️|🙏|🎉|👏|🥳|😍|💯)/i;
const SCOLD = /\b(wtf|wrong|no+!+|nope|stop it|that'?s not (it|right|what i)|you broke|broken again|ugh|seriously\??|come on|what the|why would you|dumb|stupid|useless)\b|(🤦|😡|🙄)/i;

function toneOf(text) {
  const t = String(text || '').trim();
  if (!t || t.length > 160) return '';
  // A telling-off wins over a "thanks" in the same breath.
  if (SCOLD.test(t) || /^no+[,.!]/i.test(t)) return 'scold';
  if (PRAISE.test(t)) return 'praise';
  return '';
}

module.exports = { toneOf };
