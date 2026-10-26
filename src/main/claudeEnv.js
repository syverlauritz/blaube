// The environment every Claude Code that Blaube starts gets: Blaube's own,
// less two things. The markers of a Claude Code session Blaube may itself
// have been started from (a session started under them thinks it's that
// one's child and stops saving its transcript). And any API key or token:
// an ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN) handed down from wherever
// Blaube was started wins over your signed-in Claude subscription, and is
// billed by the token. Sessions Blaube starts always use your Claude login.
const KEYS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'];
const MARKER = /^CLAUDE_CODE_(CHILD_SESSION|SESSION_|MESSAGING_|ENTRYPOINT|EXECPATH)/;

function claudeEnv(env = process.env, more = {}) {
	const out = Object.assign({}, env);
	for (const k of Object.keys(out)) {
		if (KEYS.includes(k) || k === 'CLAUDECODE' || k === 'CLAUDE_PID' || k === 'CLAUDE_EFFORT' || MARKER.test(k)) delete out[k];
	}
	return Object.assign(out, more);
}

// For a command line run by a shell Blaube doesn't hand its environment to
// (a new Terminal window on a Mac, whose shell reads your profile): the same
// keys taken out in the line itself.
const unsetPrefix = () => `env ${KEYS.map((k) => `-u ${k}`).join(' ')} `;

module.exports = { claudeEnv, unsetPrefix, KEYS };
