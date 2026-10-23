// What a tool call is about, as one word a slime can show: reading,
// editing, running a command, testing, committing, pushing... From the
// tool's name and, for a shell command, the command itself. Used by the
// app (for the slime's thought bubble and its little reactions) and its
// tests. Plain JavaScript, so it runs in both.
(function (root) {
	'use strict';

	// For a shell command: the first of these that matches wins, so a
	// "git add . && git commit && git push" is a push.
	const COMMANDS = [
		['push', /\bgit\s+push\b|\bgh\s+pr\s+(create|merge)\b/],
		['commit', /\bgit\s+commit\b/],
		['pull', /\bgit\s+(pull|fetch|clone)\b/],
		['test', /\b(npm|pnpm|yarn|bun)\s+(run\s+)?(test|e2e)\b|\b(pytest|jest|vitest|mocha|rspec|phpunit)\b|\b(go|cargo|dotnet|swift|mix)\s+test\b|\bnode\s+--test\b|\bmake\s+test\b/],
		['install', /\b(npm|pnpm|yarn|bun)\s+(install|i|add|ci)\b|\bpip3?\s+install\b|\buv\s+(add|pip\s+install|sync)\b|\bbrew\s+install\b|\bcargo\s+(add|install)\b|\bapt(-get)?\s+install\b|\bgem\s+install\b|\bpoetry\s+(add|install)\b/],
		['delete', /(^|[\s;&|(])(rm|rmdir|trash|unlink)\s|\bgit\s+(rm|clean)\b/],
		['web', /(^|[\s;&|(])(curl|wget|http)\s/],
		['folder', /(^|[\s;&|(])(mkdir|mv|cp|ln|rsync|unzip|tar|zip)\s/],
		['read', /^\s*(ls|cat|head|tail|less|grep|rg|ag|find|fd|tree|wc|du|stat|file|which|pwd|git\s+(status|log|diff|show|branch))\b/],
	];

	const TOOLS = {
		Read: 'read', Grep: 'read', Glob: 'read', LS: 'read', NotebookRead: 'read',
		Edit: 'edit', MultiEdit: 'edit', Write: 'edit', NotebookEdit: 'edit',
		WebFetch: 'web', WebSearch: 'web',
		TodoWrite: 'todo', TaskCreate: 'todo', TaskUpdate: 'todo', TaskList: 'todo',
		Agent: 'helper', Task: 'helper',
		AskUserQuestion: 'ask', ExitPlanMode: 'ask',
	};

	// 'read' | 'edit' | 'run' | 'test' | 'commit' | 'push' | 'pull' |
	// 'install' | 'delete' | 'folder' | 'web' | 'todo' | 'helper' | 'ask' | 'app'
	function classify(tool, input) {
		const name = String(tool || '');
		if (TOOLS[name]) return TOOLS[name];
		if (name.startsWith('mcp__')) return 'app';
		if (name === 'Bash' || name === 'PowerShell') {
			const cmd = String((input && input.command) || '');
			for (const [kind, re] of COMMANDS) if (re.test(cmd)) return kind;
		}
		return 'run';
	}

	const api = { classify };
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	else root.BlaubeActions = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
