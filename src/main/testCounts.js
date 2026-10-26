// How many tests passed and failed, from what a test run printed (jest,
// vitest, node --test, pytest, mocha, cargo, go, rspec, Playwright):
// { pass, fail }, or null when it doesn't say. Its last summary counts.
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
function testCounts(text) {
  const t = String(text || '').replace(ANSI, '').slice(-20000);
  const last = (re) => { let m, out = null; re.lastIndex = 0; while ((m = re.exec(t))) out = m; return out; };
  const n = (x) => (x ? Number(x) : 0);
  let m;
  // jest: "Tests:       2 failed, 1 skipped, 10 passed, 13 total"
  if ((m = last(/^Tests:\s+(.*\btotal)\s*$/gm))) return { pass: n((/(\d+) passed/.exec(m[1]) || [])[1]), fail: n((/(\d+) failed/.exec(m[1]) || [])[1]) };
  // vitest: "Tests  2 failed | 10 passed (12)"
  if ((m = last(/^\s*Tests\s+(.*)\(\d+\)\s*$/gm)) && /passed|failed/.test(m[1])) return { pass: n((/(\d+) passed/.exec(m[1]) || [])[1]), fail: n((/(\d+) failed/.exec(m[1]) || [])[1]) };
  // node --test: "# pass 10" / "# fail 2" (or "ℹ pass 10")
  const np = last(/^(?:#|ℹ) pass (\d+)\s*$/gm), nf = last(/^(?:#|ℹ) fail (\d+)\s*$/gm);
  if (np || nf) return { pass: n(np && np[1]), fail: n(nf && nf[1]) };
  // cargo: "test result: FAILED. 10 passed; 2 failed;"
  if ((m = last(/test result: \w+\. (\d+) passed; (\d+) failed/g))) return { pass: n(m[1]), fail: n(m[2]) };
  // pytest: "== 2 failed, 10 passed in 0.31s ==" ; Playwright: "2 failed" / "10 passed (3.1s)"
  if ((m = last(/^=+ (.*) in [\d.]+m?s\b.*=+\s*$/gm)) && /passed|failed|error/.test(m[1])) return { pass: n((/(\d+) passed/.exec(m[1]) || [])[1]), fail: n((/(\d+) failed/.exec(m[1]) || [])[1]) + n((/(\d+) errors?/.exec(m[1]) || [])[1]) };
  // rspec: "12 examples, 2 failures"
  if ((m = last(/^(\d+) examples?, (\d+) failures?/gm))) return { pass: n(m[1]) - n(m[2]), fail: n(m[2]) };
  // mocha, Playwright: "10 passing" / "2 failing", "10 passed" / "2 failed"
  const mp = last(/^\s*(\d+) (?:passing|passed)\b/gm), mf = last(/^\s*(\d+) (?:failing|failed)\b/gm);
  if (mp || mf) return { pass: n(mp && mp[1]), fail: n(mf && mf[1]) };
  // go: "--- FAIL: TestX" lines, "ok  pkg" / "FAIL pkg"
  const gf = (t.match(/^\s*--- FAIL: /gm) || []).length, gp = (t.match(/^\s*--- PASS: /gm) || []).length;
  if (gf || gp) return { pass: gp, fail: gf };
  return null;
}
// " · 2 failing", " · 10 pass", or ''.
function words(c) {
  if (!c || (!c.pass && !c.fail)) return '';
  return c.fail ? ` · ${c.fail} failing` : ` · ${c.pass} pass`;
}
module.exports = { testCounts, words };
