// A shell command in plain words, for what a slime is doing: what it's for,
// never the raw line. "cd x && npm test" -> "Running the tests",
// "sed -n 1,80p src/main.js" -> "Reading main.js", "for f in src/*.js; do
// node --check $f; done" -> "Running a loop over files". The line is read
// the way a shell would (quotes, pipes, && chains, subshells, heredocs,
// redirections), setup (cd, VAR=1, export) is passed over, and of what's
// left the program that matters is picked: the grep in "cat x | grep y",
// not the head in "git log | head". Known programs get their own words;
// any other is "Running <program>" and, maybe, a subcommand or file name.
// Never a fragment like "Running for p".

const MAX = 44; // (longer than this, the short form is used)

// Lines of a heredoc (cat > x <<'EOF' ... EOF) are its text, not commands.
function dropHeredocs(cmd) {
	const out = [];
	let end = null;
	for (const line of String(cmd).split('\n')) {
		if (end) { if (line.trim() === end) end = null; continue; }
		const m = line.match(/<<-?\s*(['"]?)([A-Za-z_]\w*)\1/);
		if (m) { end = m[2]; out.push(line.replace(m[0], '')); continue; }
		out.push(line);
	}
	return out.join('\n');
}

// Words and operators, as a shell splits them. A word keeps its raw text
// (quotes and all) and its value; a redirection takes its target along
// ({ redir, target }); && || ; | & newline ( ) are { op }.
function tokens(cmd) {
	const s = dropHeredocs(cmd).replace(/\\\r?\n/g, ' ');
	const out = [];
	let i = 0;
	const isSpace = (c) => c === ' ' || c === '\t' || c === '\r';
	while (i < s.length) {
		const c = s[i];
		if (isSpace(c)) { i++; continue; }
		if (c === '#' && (i === 0 || isSpace(s[i - 1]) || s[i - 1] === '\n')) { while (i < s.length && s[i] !== '\n') i++; continue; }
		const two = s.slice(i, i + 2);
		if (two === '&&' || two === '||' || two === ';;') { out.push({ op: two }); i += 2; continue; }
		if (c === ';' || c === '|' || c === '&' || c === '\n' || c === '(' || c === ')') { out.push({ op: c }); i++; continue; }
		// A word (or a redirection: 2>&1, >> log, <in, &>/dev/null).
		let raw = '', val = '', redir = false;
		while (i < s.length) {
			const ch = s[i];
			if (ch === '"' || ch === "'") {
				const close = s.indexOf(ch, i + 1);
				const j = close < 0 ? s.length : close;
				raw += s.slice(i, j + 1);
				val += s.slice(i + 1, j);
				i = j + 1;
				continue;
			}
			if (ch === '$' && s[i + 1] === '(') {
				// $( ... ), nested: part of the word.
				let depth = 0, j = i + 1;
				for (; j < s.length; j++) { if (s[j] === '(') depth++; else if (s[j] === ')' && --depth === 0) break; }
				raw += s.slice(i, j + 1);
				val += s.slice(i, j + 1);
				i = j + 1;
				continue;
			}
			if (ch === '`') {
				const close = s.indexOf('`', i + 1);
				const j = close < 0 ? s.length : close;
				raw += s.slice(i, j + 1);
				val += s.slice(i, j + 1);
				i = j + 1;
				continue;
			}
			if (ch === '>' || ch === '<') {
				if (raw && !/^\d+$/.test(raw)) break; // (foo>bar: the redirection is next)
				redir = true;
				while (s[i] === '>' || s[i] === '<') raw += s[i++];
				if (s[i] === '&') { raw += s[i++]; while (/[\d-]/.test(s[i] || '')) raw += s[i++]; }
				break;
			}
			if (isSpace(ch) || ch === '\n' || ch === ';' || ch === '|' || ch === '&' || ch === '(' || ch === ')') break;
			raw += ch;
			val += ch;
			i++;
		}
		if (redir) {
			const tok = { redir: raw, target: '' };
			if (!/&[\d-]+$/.test(raw)) {
				// Its target is the next word.
				while (isSpace(s[i] || '')) i++;
				const m = s.slice(i).match(/^("[^"]*"|'[^']*'|[^\s;|&()<>]+)/);
				if (m) { tok.target = m[1].replace(/^(["'])(.*)\1$/, '$2'); i += m[1].length; }
			}
			out.push(tok);
		} else if (raw) out.push({ raw, val });
	}
	return out;
}

// The simple commands in it: { words, out, piped } (out: the file its
// output goes to; piped: its output goes into the next one).
function commands(cmd) {
	const list = [];
	let cur = { words: [], out: '', piped: false };
	const flush = (op) => {
		if (op === '|') cur.piped = true;
		if (cur.words.length) list.push(cur);
		cur = { words: [], out: '', piped: false };
	};
	for (const t of tokens(cmd)) {
		if (t.op) flush(t.op);
		else if (t.redir) { if (/>/.test(t.redir) && t.target && !/^\/dev\/null$|^nul$|^\$null$/i.test(t.target)) cur.out = t.target; }
		else cur.words.push(t);
	}
	flush('');
	return list;
}

const unq = (t) => String(t || '').replace(/^(["'])(.*)\1$/, '$2');
const base = (t) => unq(t).split(/[\\/]/).filter(Boolean).pop() || '';
const progName = (t) => base(t).replace(/\.(exe|cmd|bat|com)$/i, '').toLowerCase();
const fileish = (t) => /[\\/]|\.\w{1,6}$/.test(t);
// A name worth showing: short, and nothing a shell would still expand.
const showable = (t) => !!t && t.length <= 28 && /[a-z\d]/i.test(t) && !/[$*?{}<>|`=]/.test(t);
const named = (verb, t, fallback) => (showable(base(t)) && (verb + ' ' + base(t)).length <= MAX ? verb + ' ' + base(t) : fallback);

// Words that set up, wrap or close a command, not the command itself.
const SETUP = new Set(['cd', 'pushd', 'popd', 'set', 'export', 'unset', 'source', '.', 'alias', 'shopt', 'trap', 'local', 'declare', 'typeset', 'set-location', 'sl', 'chdir', 'ulimit', 'umask', 'setlocal', 'endlocal', '@echo']);
const WRAP = new Set(['sudo', 'nohup', 'nice', 'exec', 'command', 'builtin', 'time', 'env', 'stdbuf', 'caffeinate', 'winpty', 'call', '&']);
const KEYWORD = new Set(['if', 'then', 'else', 'elif', 'do', '!', '{', 'function']);
const CLOSE = new Set(['done', 'fi', 'esac', '}', ';;', 'in']);
// Ones that only tidy or show what another made: picked last.
const MINOR = new Set(['echo', 'printf', 'true', 'false', ':', 'sleep', 'head', 'tail', 'sort', 'uniq', 'wc', 'tr', 'cut', 'tee', 'column', 'nl', 'less', 'more', 'test', '[', '[[', 'read', 'exit', 'return', 'wait', 'write-host', 'write-output', 'select-object', 'out-null', 'out-string', 'format-table', 'measure-object', 'start-sleep', 'clear', 'cls']);

// A command's words with its setup taken off: VAR=1, sudo, env -i, if, do,
// timeout 30, xargs -n1, $env:X = ... Returns the words left ([] for setup).
function core(words) {
	let w = words.slice();
	for (let guard = 0; guard < 12 && w.length; guard++) {
		const first = w[0].val, low = first.toLowerCase();
		if (/^[A-Za-z_]\w*=/.test(first)) { w.shift(); continue; }
		if (KEYWORD.has(low)) { w.shift(); continue; }
		if (WRAP.has(low)) {
			w.shift();
			while (w.length && (/^-/.test(w[0].val) || /^[A-Za-z_]\w*=/.test(w[0].val))) w.shift();
			continue;
		}
		if (low === 'timeout') { w.shift(); while (w.length && /^(-|\d)/.test(w[0].val)) w.shift(); continue; }
		if (low === 'xargs') {
			w.shift();
			while (w.length && /^-/.test(w[0].val)) { const f = w.shift().val; if (/^-[InLPdsE]$/.test(f) && w.length) w.shift(); }
			continue;
		}
		break;
	}
	if (!w.length) return [];
	const low = w[0].val.toLowerCase();
	if (SETUP.has(low) || CLOSE.has(low) || low === 'case' || /^\$/.test(w[0].val) || (w[1] && w[1].val === '=')) return [];
	return w;
}

// The first argument that isn't a flag (and not a flag's value, for the
// flags named in takes).
function positional(args, takes = '') {
	const out = [];
	const want = new Set(takes.split(' ').filter(Boolean));
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (/^--?\w/.test(a) || /^\/[a-z?]$/i.test(a)) { if (want.has(a) && !a.includes('=')) i++; continue; }
		out.push(a);
	}
	return out;
}
const has = (args, re) => args.some((a) => re.test(a));

// Test runners and friends, by name (also through npx, npm exec, ...).
const TESTS = new Set(['jest', 'vitest', 'mocha', 'ava', 'tap', 'pytest', 'py.test', 'playwright', 'cypress', 'karma', 'jasmine', 'phpunit', 'rspec']);
const RUNTIMES = new Set(['node', 'nodejs', 'bun', 'deno', 'python', 'python3', 'python2', 'py', 'ruby', 'perl', 'php', 'tsx', 'ts-node', 'lua', 'Rscript', 'electron']);

// Words for one program and its arguments (values, unquoted), or ''.
function describe(prog, args, cmd) {
	const pos = (takes) => positional(args, takes);
	switch (prog) {
	case 'sed': case 'gsed': {
		const p = pos('-e -f --expression --file');
		const script = has(args, /^(-e|--expression|-f)$/) ? null : p.shift();
		const file = p[p.length - 1];
		if (has(args, /^(-i|--in-place)/) || /^-\w*i/.test(args.find((a) => /^-[a-z]+$/.test(a)) || '')) return named('Editing', file, 'Editing text with sed');
		if (has(args, /^-\w*n/) && /p\s*$/.test(script || '')) return file ? named('Reading', file, 'Reading a file') : 'Reading text with sed';
		return 'Editing text with sed';
	}
	case 'awk': case 'gawk': case 'mawk': return 'Working through text with awk';
	case 'grep': case 'egrep': case 'fgrep': case 'rg': case 'ag': case 'ack': case 'findstr': case 'select-string': case 'sls': {
		const e = args.indexOf('-e');
		const pat = e >= 0 ? args[e + 1] : pos('-A -B -C -m -f -g -t -T --glob --type --include --exclude --max-count -Pattern -Path')[0];
		const tool = prog === 'select-string' || prog === 'sls' ? 'Select-String' : prog;
		return pat && /^[\w .:'#@-]{2,24}$/.test(pat) && !/^\s|\s$/.test(pat) ? `Searching for "${pat}"` : `Searching with ${tool}`;
	}
	case 'find': {
		const n = args.findIndex((a) => a === '-name' || a === '-iname');
		const what = n >= 0 ? args[n + 1] : '';
		return what && /^[\w.*-]{1,24}$/.test(what) ? `Looking for ${what}` : 'Looking for files';
	}
	case 'fd': case 'fdfind': case 'locate': return 'Looking for files';
	case 'ls': case 'dir': case 'tree': case 'll': case 'la': case 'gci': case 'get-childitem': {
		const at = args.findIndex((a) => /^-(Path|LiteralPath)$/i.test(a));
		const where = at >= 0 ? args[at + 1] : pos('-Filter -Depth -I -L')[0];
		return where && where !== '.' ? named('Listing files in', where, 'Listing files') : 'Listing files';
	}
	case 'cat': case 'type': case 'bat': case 'get-content': case 'gc': case 'head': case 'tail': case 'less': case 'more': case 'nl': {
		if (cmd.out) return named('Writing', cmd.out, 'Writing a file');
		const file = pos('-n -c -Tail -TotalCount -Head -First -Last -Encoding')[0];
		if ((prog === 'tail' && has(args, /^-\w*[fF]/)) || has(args, /^-Wait$/i)) return named('Watching', file, 'Watching a file');
		return file ? named('Reading', file, 'Reading a file') : 'Reading a file';
	}
	case 'wc': { const f = pos()[0]; return f ? named('Counting lines in', f, 'Counting lines') : 'Counting lines'; }
	case 'diff': case 'cmp': case 'fc': case 'compare-object': return 'Comparing files';
	case 'echo': case 'printf': case 'write-host': case 'write-output': return cmd.out ? named('Writing', cmd.out, 'Writing a file') : 'Printing a message';
	case 'sleep': case 'start-sleep': return 'Waiting a moment';
	case 'jq': return 'Reading JSON';
	case 'tar': return has(args, /^-?\w*x/) ? 'Unpacking files' : 'Packing files';
	case 'unzip': case 'gunzip': case 'expand-archive': return 'Unpacking files';
	case 'zip': case 'gzip': case '7z': case 'compress-archive': return 'Packing files';
	case 'rm': case 'del': case 'rmdir': case 'rd': case 'erase': case 'remove-item': case 'ri': {
		const p = pos('-Path');
		return p.length === 1 ? named('Removing', p[0], 'Removing files') : 'Removing files';
	}
	case 'mkdir': case 'md': { const p = pos(); const f = base(p[0]); return p.length === 1 && showable(f) && f.length <= 20 ? `Making the ${f} folder` : p.length > 1 ? 'Making folders' : 'Making a folder'; }
	case 'cp': case 'copy': case 'copy-item': case 'xcopy': case 'robocopy': case 'rsync': { const p = pos(); return p.length ? named('Copying', p[0], 'Copying files') : 'Copying files'; }
	case 'mv': case 'move': case 'move-item': case 'ren': case 'rename': case 'rename-item': { const p = pos(); return p.length ? named('Moving', p[0], 'Moving files') : 'Moving files'; }
	case 'touch': case 'new-item': case 'ni': { const p = pos('-ItemType -Path -Value'); return has(args, /^directory$/i) ? 'Making a folder' : p.length ? named('Making', p[0], 'Making a file') : 'Making a file'; }
	case 'chmod': case 'chown': case 'icacls': case 'attrib': return 'Changing file permissions';
	case 'ln': return 'Linking files';
	case 'pwd': return 'Checking where it is';
	case 'kill': case 'pkill': case 'killall': case 'taskkill': case 'stop-process': return 'Stopping a process';
	case 'ps': case 'tasklist': case 'get-process': case 'top': case 'htop': case 'pgrep': return 'Looking at running programs';
	case 'which': case 'where': case 'whereis': case 'get-command': case 'gcm': { const p = pos()[0]; return p && showable(p) ? `Looking for ${p}` : 'Looking for a program'; }
	case 'curl': case 'wget': case 'invoke-webrequest': case 'iwr': case 'invoke-restmethod': case 'irm': case 'http': case 'xh': {
		const url = args.find((a) => /^[a-z][\w+.-]*:\/\//i.test(a)) || pos('-o -O -X -H -d -u -A -e -w --data --header --request --output -Uri -Method -OutFile -Body -Headers')[0];
		let host = '';
		try { host = new URL(/:\/\//.test(url || '') ? url : 'http://' + url).hostname; } catch { /* none */ }
		return host && /^[\w.-]+$/.test(host) && host.length <= 30 ? `Fetching ${host.replace(/^www\./, '')}` : 'Fetching a web page';
	}
	case 'ssh': case 'scp': case 'sftp': { const h = pos('-i -p -P -o -l -F')[0]; const host = h ? h.split('@').pop().split(':')[0] : ''; return host && showable(host) ? `Connecting to ${host}` : 'Connecting to a server'; }
	case 'open': case 'xdg-open': case 'start': case 'start-process': case 'explorer': case 'code': case 'cursor': { const p = pos()[0]; return p ? named('Opening', p, 'Opening something') : prog === 'code' || prog === 'cursor' ? 'Opening the editor' : 'Opening something'; }
	case 'tsc': case 'vue-tsc': return 'Checking types';
	case 'eslint': case 'tslint': case 'stylelint': case 'standard': case 'ruff': case 'flake8': case 'pylint': case 'golangci-lint': case 'clippy': return 'Checking the code';
	case 'prettier': case 'black': case 'gofmt': case 'rustfmt': case 'dprint': return 'Formatting the code';
	case 'make': case 'gmake': case 'nmake': case 'just': { const t = pos('-C -f -j')[0]; return t && /^[\w:.-]{1,20}$/.test(t) ? (/^test/.test(t) ? 'Running the tests' : `Running make ${t}`) : 'Running make'; }
	case 'pip': case 'pip3': case 'uv': case 'poetry': case 'pipx': case 'gem': case 'brew': case 'apt': case 'apt-get': case 'winget': case 'choco': case 'scoop': case 'cargo-install': {
		const sub = pos()[0] || '';
		if (/^(install|add|i|sync|upgrade|update)$/.test(sub)) return 'Installing packages';
		if (/^(uninstall|remove|rm)$/.test(sub)) return 'Removing a package';
		if (prog === 'uv' && sub === 'run') return describeWords(args.slice(args.indexOf('run') + 1), cmd) || 'Running uv run';
		break;
	}
	case 'docker': case 'podman': case 'kubectl': { const sub = pos()[0]; return sub && /^[a-z-]{2,14}$/.test(sub) ? `Running ${prog} ${sub}` : `Running ${prog}`; }
	}
	if (TESTS.has(prog)) return 'Running the tests';
	if (RUNTIMES.has(prog)) {
		if (has(args, /^(-e|-p|-c|--eval|--print)$/)) return `Running a quick ${prog === 'py' || prog === 'python3' ? 'python' : prog} script`;
		if (has(args, /^--test$/)) return 'Running the tests';
		const m = args.indexOf('-m');
		if (m >= 0 && args[m + 1]) { const mod = args[m + 1]; return TESTS.has(mod) || mod === 'unittest' ? 'Running the tests' : /^(pip)$/.test(mod) ? describe('pip', args.slice(m + 2), cmd) : named('Running', mod, `Running ${prog}`); }
		const p = positional(args, '-r --require --import --loader -W -X --env-file');
		const file = prog === 'deno' && p[0] === 'run' ? p[1] : p[0];
		return file ? named('Running', file, `Running ${prog}`) : `Running ${prog}`;
	}
	if (prog === 'npx' || prog === 'bunx' || prog === 'pnpx' || prog === 'dlx') {
		const rest = args.slice();
		while (rest.length && /^-/.test(rest[0])) { const f = rest.shift(); if ((f === '-p' || f === '--package') && rest.length) rest.shift(); }
		return describeWords(rest, cmd) || 'Running a package tool';
	}
	if (prog === 'npm' || prog === 'pnpm' || prog === 'yarn' || prog === 'bun') {
		const p = pos('--prefix -C -w --workspace --filter');
		const sub = p[0] || '';
		if (!sub) return prog === 'yarn' ? 'Installing packages' : `Running ${prog}`;
		if (/^(t|test|tst)$/.test(sub)) return 'Running the tests';
		if (/^(i|install|ci|add|update|up|upgrade)$/.test(sub)) return 'Installing packages';
		if (/^(uninstall|remove|rm|un)$/.test(sub)) return 'Removing a package';
		if (sub === 'start') return 'Starting the app';
		if (/^(ls|list|outdated|audit|why|explain)$/.test(sub)) return 'Checking the packages';
		if (/^(view|info|show|search)$/.test(sub)) return 'Looking up a package';
		if (sub === 'publish') return 'Publishing a package';
		if (sub === 'exec' || sub === 'dlx' || sub === 'x') return describeWords(args.slice(args.indexOf(sub) + 1).filter((a) => a !== '--'), cmd) || `Running ${prog} ${sub}`;
		const script = sub === 'run' || sub === 'run-script' ? p[1] : prog === 'npm' ? '' : sub;
		if (script && /^[\w:.-]{1,24}$/.test(script)) return /^test(:|$)/.test(script) ? 'Running the tests' : /^(build|lint|format|dev)(:|$)/.test(script) ? { build: 'Building', lint: 'Checking the code', format: 'Formatting the code', dev: 'Starting the app' }[script.split(':')[0]] : `Running the ${script} script`;
		return /^[a-z-]{2,14}$/.test(sub) ? `Running ${prog} ${sub}` : `Running ${prog}`;
	}
	if (prog === 'git') {
		const a = args.slice();
		while (a.length && /^-/.test(a[0])) { const f = a.shift(); if ((f === '-C' || f === '-c') && a.length) a.shift(); }
		const sub = a[0] || '';
		const GIT = {
			status: 'Checking git status', diff: 'Looking at the changes', log: 'Reading the git history', show: 'Looking at a commit', add: 'Staging changes',
			commit: 'Committing changes', push: 'Pushing changes', pull: 'Pulling changes', fetch: 'Fetching from the remote', checkout: 'Switching branches', switch: 'Switching branches',
			branch: 'Looking at branches', merge: 'Merging branches', 'merge-base': 'Comparing branches', rebase: 'Rebasing', stash: 'Stashing changes', clone: 'Cloning a repository', blame: 'Reading git blame',
			grep: 'Searching the code', worktree: 'Managing worktrees', reset: 'Resetting changes', restore: 'Restoring files', rm: 'Removing files', mv: 'Moving files',
			tag: 'Looking at tags', remote: 'Checking the remotes', 'rev-parse': 'Checking the repository', 'ls-files': 'Listing files', 'cherry-pick': 'Picking a commit', revert: 'Reverting a commit',
			init: 'Making a repository', config: 'Checking git settings', bisect: 'Hunting down a change', submodule: 'Updating submodules', clean: 'Cleaning up files', reflog: 'Reading the git history', describe: 'Checking the version',
		};
		return GIT[sub] || (/^[a-z-]{2,16}$/.test(sub) ? `Running git ${sub}` : 'Running git');
	}
	if (prog === 'gh') {
		const [area, act] = pos('-R --repo');
		if (area === 'pr') return act === 'create' ? 'Opening a pull request' : act === 'merge' ? 'Merging a pull request' : act === 'checkout' ? 'Switching to a pull request' : act === 'comment' || act === 'review' ? 'Commenting on a pull request' : 'Checking pull requests';
		if (area === 'issue') return act === 'create' ? 'Filing an issue' : 'Checking issues';
		if (area === 'run' || area === 'workflow') return 'Checking CI runs';
		if (area === 'api') return 'Asking GitHub';
		if (area === 'repo') return 'Looking at the repository';
		if (area === 'release') return 'Checking releases';
		return area && /^[a-z-]{2,12}$/.test(area) ? `Running gh ${area}` : 'Running gh';
	}
	if (/^(cargo|go|dotnet|mvn|gradle|gradlew|swift|mix|zig|flutter)$/.test(prog)) {
		const sub = pos()[0] || '';
		if (sub === 'test') return 'Running the tests';
		if (/^(build|compile|assemble)$/.test(sub)) return 'Building';
		if (sub === 'run') return 'Running the app';
		if (/^(fmt|format)$/.test(sub)) return 'Formatting the code';
		if (/^(check|vet|clippy|lint)$/.test(sub)) return 'Checking the code';
		return sub && /^[a-z-]{2,14}$/.test(sub) ? `Running ${prog} ${sub}` : `Running ${prog}`;
	}
	return '';
}

// Words for a command's words: through a shell's -c (bash -c "...",
// powershell -Command "...", cmd /c ...), else its program's own words,
// else "Running <program>" and maybe a subcommand or file.
function describeWords(vals, cmd = { out: '' }) {
	if (!vals.length) return '';
	const prog = progName(vals[0]);
	const args = vals.slice(1);
	if (!prog || /^[^\w.[]/.test(prog)) return '';
	if (/^(bash|sh|zsh|dash|ksh|fish|git-bash)$/.test(prog)) {
		const c = args.indexOf('-c');
		if (c >= 0 && args[c + 1]) return plain(args[c + 1]);
		const file = positional(args)[0];
		return file ? named('Running', file, 'Running a script') : 'Running a shell';
	}
	if (/^(powershell|pwsh)$/.test(prog)) {
		const c = args.findIndex((a) => /^-(c|command)$/i.test(a));
		if (c >= 0) return plain(args.slice(c + 1).join(' '));
		const f = args.findIndex((a) => /^-(f|file)$/i.test(a));
		if (f >= 0 && args[f + 1]) return named('Running', args[f + 1], 'Running a script');
		return 'Running PowerShell';
	}
	if (prog === 'cmd') {
		const c = args.findIndex((a) => /^\/[ck]$/i.test(a));
		return c >= 0 ? plain(args.slice(c + 1).join(' ')) : 'Running cmd';
	}
	if (/\.(sh|ps1|py|js|mjs|cjs|ts|rb|pl|bat|cmd)$/i.test(base(vals[0])) && fileish(vals[0])) return named('Running', vals[0], 'Running a script');
	const known = describe(prog, args, cmd);
	if (known) return known;
	// Any other program: its name, and a subcommand or file if there is one.
	const first = positional(args)[0] || '';
	let hint = '';
	if (fileish(first) && showable(base(first))) hint = base(first);
	else if (/^[a-z][\w:-]{1,19}$/.test(first)) hint = first;
	const out = `Running ${prog}${hint ? ' ' + hint : ''}`;
	return out.length <= MAX ? out : `Running ${prog}`.slice(0, MAX);
}

// The whole line: the command that matters, in words.
function plain(line) {
	const cmds = commands(line);
	const real = [];
	let loop = null, loopAt = 0, cdTo = '';
	for (const c of cmds) {
		const first = c.words[0].val.toLowerCase();
		if (first === 'cd' || first === 'pushd' || first === 'set-location') { const to = c.words[1] && c.words[1].val; if (to && to !== '-') cdTo = to; }
		// A loop: for x in ...; while ...; until ...
		if (first === 'for' || first === 'foreach' || first === 'while' || first === 'until' || first === 'select') {
			if (loop) continue;
			loopAt = real.length;
			const ws = c.words.map((w) => w.val);
			const list = first === 'for' && ws.indexOf('in') > 0 ? ws.slice(ws.indexOf('in') + 1) : [];
			const lines = (first === 'while' || first === 'until') && ws[1] === 'read';
			loop = list.some((w) => /[*?\\/]|\.\w{1,6}$|\$\((ls|find|git ls-files|fd|rg --files)\b/.test(w)) ? 'Running a loop over files' : lines ? 'Running a loop over lines' : 'Running a loop';
			continue;
		}
		const w = core(c.words);
		if (w.length) real.push({ vals: w.map((x) => x.val), cmd: c });
	}
	const minor = (r) => MINOR.has(progName(r.vals[0])) || (r.cmd.piped && /^(cat|type|get-content|gc|echo|printf)$/.test(progName(r.vals[0])));
	// (A loop, unless something that matters came before it.)
	if (loop && !real.slice(0, loopAt).some((r) => !minor(r))) return loop;
	const pick = real.find((r) => !minor(r)) || real[0];
	if (!pick) return cdTo ? named('Going to', cdTo, '') : '';
	return describeWords(pick.vals, pick.cmd);
}

function plainCommand(cmd) {
	let out = '';
	try { out = plain(String(cmd || '')); } catch { out = ''; }
	return out || 'Running a command';
}

module.exports = { plainCommand };
