const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { latestThinking, tailOf, thinkingOf, helperFile, plainCommand } = require('../src/main/thinking.js');

const FIX = path.join(__dirname, 'fixtures', 'thinking');
const SESSION = path.join(FIX, 'fixture-session.jsonl');
const L = (o) => JSON.stringify(o);
const think = (t, extra = {}) => L(Object.assign({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: t, signature: 's' }] } }, extra));

test('the newest real thinking of this turn, past empty and redacted blocks, tools and text', () => {
	const t = latestThinking(fs.readFileSync(SESSION, 'utf8'));
	assert.ok(t.startsWith('The batter recipe lives in recipes/pancakes.md.'), t);
	assert.ok(t.endsWith('a note about frozen berries.'), t);
	assert.ok(!/\s{2,}|\n/.test(t), 'whitespace collapsed');
});

test('a helper transcript (all sidechain) is read as its own', () => {
	const raw = fs.readFileSync(helperFile(SESSION, 'fixture-helper'), 'utf8');
	assert.match(latestThinking(raw, false), /^Buttermilk shows up/);
	assert.strictEqual(latestThinking(raw, true), '', 'a session skips helper lines');
});

test('nothing from an earlier turn, and nothing when it is all empty or redacted', () => {
	assert.strictEqual(latestThinking([think('old idea'), L({ type: 'user', message: { content: 'next thing' } })].join('\n')), '');
	assert.strictEqual(latestThinking([
		L({ type: 'user', message: { content: 'go' } }),
		think(''),
		L({ type: 'assistant', message: { content: [{ type: 'redacted_thinking', data: 'abc' }] } }),
		L({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't', name: 'Bash', input: {} }] } }),
		L({ type: 'assistant', message: { content: [{ type: 'text', text: 'thinking out loud' }] } }),
	].join('\n')), '');
	// A tool's result coming back isn't a new turn; a half line is skipped.
	assert.strictEqual(latestThinking([think('keep going'), L({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't', content: 'ok' }] } }), '{"type":"assistant","message":{"content":[{"type":"thin'].join('\n')), 'keep going');
});

test('tail: the end of it, cut at a word', () => {
	assert.strictEqual(tailOf('short and sweet'), 'short and sweet');
	const t = tailOf('alpha beta gamma delta epsilon', 14);
	assert.strictEqual(t, '…delta epsilon');
});

test('reads only the end of a big file, and keeps the answer until the file changes', async () => {
	const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'blaube-')), 't.jsonl');
	const filler = L({ type: 'assistant', message: { content: [{ type: 'text', text: 'x'.repeat(1000) }] } });
	fs.writeFileSync(file, [L({ type: 'user', message: { content: 'go' } }), think('lost far back'), ...Array(400).fill(filler), think('the plan is to fix the hover bubble first')].join('\n') + '\n');
	assert.strictEqual(await thinkingOf(file), 'the plan is to fix the hover bubble first');
	fs.appendFileSync(file, think('and then the blush') + '\n');
	assert.strictEqual(await thinkingOf(file), 'and then the blush');
	assert.strictEqual(await thinkingOf(path.join(path.dirname(file), 'missing.jsonl')), '');
	assert.strictEqual(await thinkingOf(''), '');
});

test('a command in plain words: what it is for, never the raw line', () => {
	const cases = [
		// Loops: never "Running for p".
		['for p in src/main/*.js; do node --check "$p"; done', 'Running a loop over files'],
		['for f in $(git ls-files "*.md"); do wc -l "$f"; done', 'Running a loop over files'],
		['for p in alpha beta; do echo $p; done', 'Running a loop'],
		['cd /c/Git/blaube && for f in test/*.test.js; do\n\tnode --test "$f" || break\ndone', 'Running a loop over files'],
		['while read f; do wc -l "$f"; done < files.txt', 'Running a loop over lines'],
		['git ls-files | while read f; do echo "$f"; done', 'Listing files'],
		// sed, grep and friends by what they do.
		["sed -n '1,80p' src/main/main.js", 'Reading main.js'],
		["sed -i 's/foo/bar/g' src/talk/talk.js", 'Editing talk.js'],
		["sed -i.bak -e 's/a/b/' notes.txt", 'Editing notes.txt'],
		["sed 's/a/b/' x | sort", 'Editing text with sed'],
		['grep -rn "helperTokens" src | head -20', 'Searching for "helperTokens"'],
		['grep -rnE "function \\w+\\(" src', 'Searching with grep'],
		['rg -n plainCommand src test', 'Searching for "plainCommand"'],
		['cat src/a.js | grep -i foo', 'Searching for "foo"'],
		["awk '{print $1}' access.log", 'Working through text with awk'],
		['find . -name "*.test.js" | xargs grep -l describe', 'Looking for *.test.js'],
		['find src -type f | wc -l', 'Looking for files'],
		['ls -la src/main', 'Listing files in main'],
		['ls | wc -l', 'Listing files'],
		['cat package.json', 'Reading package.json'],
		['head -50 README.md', 'Reading README.md'],
		['tail -f logs/app.log', 'Watching app.log'],
		['wc -l src/main/*.js | sort -n | tail -5', 'Counting lines'],
		// Heredocs, redirections, echo.
		["cat > /tmp/x.json <<'EOF'\n{\"a\": 1}\nfor x in y; do\nEOF", 'Writing x.json'],
		["node - <<'EOF'\nconsole.log(1)\nEOF", 'Running node'],
		['echo "all done"', 'Printing a message'],
		['echo hi > out.txt', 'Writing out.txt'],
		// Runtimes and files.
		['node C:/Users/syver/AppData/Local/Temp/claude/probe-3f2a.js --fast', 'Running probe-3f2a.js'],
		['node -e "console.log(1)"', 'Running a quick node script'],
		['node --test test/*.test.js', 'Running the tests'],
		['python -I scripts\\make_report.py', 'Running make_report.py'],
		['python3 -c "import sys; print(sys.version)"', 'Running a quick python script'],
		['python -m pytest tests/', 'Running the tests'],
		['BLAUBE_TEST=1 "C:/Program Files/nodejs/node.exe" -e "1"', 'Running a quick node script'],
		['timeout 30 node test/run.js', 'Running run.js'],
		['export FOO=1; ./scripts/build.sh', 'Running build.sh'],
		// Package managers.
		['cd /c/Git/blaube && npm test', 'Running the tests'],
		['cd /c/Git/blaube && npm test 2>&1 | tail -30', 'Running the tests'],
		['npm test -- --test-name-pattern=foo', 'Running the tests'],
		['npm run build', 'Building'],
		['npm run shots -- --only talk', 'Running the shots script'],
		['npm install', 'Installing packages'],
		['npm ci --silent', 'Installing packages'],
		['yarn lint', 'Checking the code'],
		['npx tsc --noEmit', 'Checking types'],
		['npx -y prettier --write .', 'Formatting the code'],
		['npx electron scripts/shots/main.js', 'Running main.js'],
		['BLAUBE_TEST=scripts/e2e/talk.js BLAUBE_PORT=47912 npx electron . &', 'Running electron'],
		['$env:BLAUBE_TEST="x"; npx electron .', 'Running electron'],
		['sudo apt-get install -y jq', 'Installing packages'],
		['pip install -r requirements.txt', 'Installing packages'],
		// git and gh.
		['git commit -m "Fix the hover bubble"', 'Committing changes'],
		['git -C /c/Git/blaube log --oneline -5', 'Reading the git history'],
		['git log --oneline main..HEAD | cat', 'Reading the git history'],
		['git status --short', 'Checking git status'],
		['git diff HEAD~1 -- src/main.js', 'Looking at the changes'],
		['git add -A && git commit -m "x" && git push', 'Staging changes'],
		['git frobnicate', 'Running git frobnicate'],
		['gh pr create --title x --body y', 'Opening a pull request'],
		['gh pr checks 12', 'Checking pull requests'],
		// The web.
		['curl -s https://api.github.com/repos/x/y | jq .name', 'Fetching api.github.com'],
		['curl -sSf localhost:47900/state', 'Fetching localhost'],
		['sleep 5 && curl http://127.0.0.1:3000/', 'Fetching 127.0.0.1'],
		['wget -q https://www.example.com/file.zip', 'Fetching example.com'],
		// Shells inside shells, subshells, conditions.
		['(cd src && ls)', 'Listing files'],
		['bash -c "cd x && make test"', 'Running the tests'],
		['powershell -NoProfile -Command "Get-ChildItem -Path C:\\Git"', 'Listing files in Git'],
		['cmd /c "dir /b"', 'Listing files'],
		['if [ -f package.json ]; then npm test; fi', 'Running the tests'],
		['diff <(sort a) <(sort b)', 'Comparing files'],
		// Files.
		['rm -rf node_modules', 'Removing node_modules'],
		['mkdir -p docs/shots', 'Making the shots folder'],
		['cp build/icon.png dist/', 'Copying icon.png'],
		// Others: the program and a word, if any.
		['docker compose up -d', 'Running docker compose'],
		['cargo test --release', 'Running the tests'],
		['some-tool --flag', 'Running some-tool'],
		['cd somewhere', 'Going to somewhere'],
		['', 'Running a command'],
		['&&', 'Running a command'],
	];
	for (const [cmd, want] of cases) assert.strictEqual(plainCommand(cmd), want, cmd);
	// Never the dangling first words of a shell construct, never too long.
	for (const cmd of ['for p in a b; do x; done', 'while true; do sleep 1; done', 'until false; do :; done', 'case $x in a) ls;; esac', 'if true; then :; fi', 'select x in a b; do echo; done']) {
		const out = plainCommand(cmd);
		assert.ok(!/\b(for|while|until|case|in|if|then|do|done|select|esac)\b/.test(out.replace('a loop', '')), `${cmd} -> ${out}`);
	}
	for (const [cmd] of cases) assert.ok(plainCommand(cmd).length <= 44, cmd);
});
