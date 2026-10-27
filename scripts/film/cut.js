// Cuts the recorded take down to its scenes (marks.json, from trailer.js),
// back to back, at 1080x1920:
//
//   node scripts/film/cut.js            # out/raw.mp4 -> out/blaube-trailer.mp4
//
// KEEP says which bit of each scene to keep: [from its start, for how long] (seconds).
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const HERE = __dirname, OUT = path.join(HERE, 'out');
const all = JSON.parse(fs.readFileSync(path.join(HERE, 'marks.json'), 'utf8'));
const KEEP = { painting: [0, 9], title: [0.2, 4.8], watches: [0.2, 4.2], talk: [0.2, 3.6], cookies: [0.3, 3.2], tower: [0.2, 3], leapfrog: [0.2, 2.8], rope: [0.8, 3], dogpile: [0.5, 3.6], sings: [0, 0], shake: [0.3, 5.6], soft: [0, 5.4], end: [0, 4] };
const marks = all.filter((m) => !KEEP[m.name] || KEEP[m.name][1] > 0); // (a scene kept for 0 s is left out)
const span = (m) => { const [a, d] = KEEP[m.name] || [0.2, 9]; return [m.start + a, Math.min(m.end, m.start + a + d)]; };
const parts = marks.map((m, i) => {
	const [a, b] = span(m);
	return `[0:v]trim=${a.toFixed(3)}:${b.toFixed(3)},setpts=PTS-STARTPTS,scale=1080:1920:flags=lanczos,fps=60[v${i}]`;
});
const graph = parts.join(';') + ';' + marks.map((_, i) => `[v${i}]`).join('') + `concat=n=${marks.length}:v=1:a=0[out]`;
execFileSync('C:\\ffmpeg\\bin\\ffmpeg.exe', ['-hide_banner', '-loglevel', 'warning', '-y', '-i', path.join(OUT, 'raw.mp4'), '-filter_complex', graph, '-map', '[out]',
	'-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(OUT, 'blaube-trailer.mp4')], { stdio: 'inherit' });
const total = marks.reduce((s, m) => { const [a, b] = span(m); return s + b - a; }, 0);
console.log(`out/blaube-trailer.mp4: ${marks.length} scenes, ${total.toFixed(1)} s`);
