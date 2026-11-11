// Run from a git checkout (npm start, not the installed app): which branch,
// and how far behind GitHub's main it is, so an old branch can't pass for
// the newest Blaube. Said in the menu, and once with a notification.
'use strict';
const { execFile } = require('node:child_process');

const git = (dir, args, cb) => execFile('git', args, { cwd: dir, timeout: 20000, windowsHide: true, encoding: 'utf8' }, (err, out) => cb(err ? null : String(out).trim()));

// { branch, behind } -> the menu's line ('' when it's the newest main).
function label(where) {
	if (!where) return '';
	const name = where.branch === 'HEAD' ? 'main' : where.branch; // (detached: Blaube (dev), on origin/main)
	if (!where.behind) return name === 'main' ? '' : `From ${name}`;
	return `From ${name} · ${where.behind} behind main`;
}

// cb({ branch, behind }) or cb(null) when it isn't a git checkout.
function check(dir, cb) {
	git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'], (branch) => {
		if (!branch) return cb(null);
		git(dir, ['fetch', '-q', 'origin', 'main'], () => {
			git(dir, ['rev-list', '--count', 'HEAD..origin/main'], (n) => cb({ branch, behind: Number(n) || 0 }));
		});
	});
}

module.exports = { label, check };
