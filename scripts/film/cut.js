// Cuts the recorded take down to its scenes (marks.json, from trailer.js),
// back to back, at 1080x1920, with the blobs' sound if it was recorded:
//
//   node scripts/film/cut.js            # out/raw.mp4 (+ out/sound.webm) -> out/blaube-trailer.mp4
//
// KEEP says which bit of each scene to keep: [from its start, for how long] (seconds).
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FFMPEG = 'C:\\ffmpeg\\bin\\ffmpeg.exe';
const HERE = __dirname, OUT = path.join(HERE, 'out');
const RAW = path.join(OUT, 'raw.mp4'), SOUND = path.join(OUT, 'sound.webm');
const take = JSON.parse(fs.readFileSync(path.join(HERE, 'marks.json'), 'utf8'));
const KEEP = { painting: [0, 9], title: [0.2, 4.8], watches: [0.2, 4.2], talk: [0.2, 3.6], cookies: [0.3, 3.2], play: [0.2, 3], yearn: [0.3, 3.5], chase: [0.3, 3.2], fly: [0.5, 6], sings: [0.3, 4.5], dizzy: [0.3, 5.6], soft: [0, 5.4], end: [0, 4] };
const marks = take.scenes.filter((m) => !KEEP[m.name] || KEEP[m.name][1] > 0); // (a scene kept for 0 s is left out)
const span = (m) => { const [a, d] = KEEP[m.name] || [0.2, 9]; return [m.start + a, Math.min(m.end, m.start + a + d)]; };

// Where the magenta square first shows in the video: the clock time
// take.flash. (Its top-left corner, sampled at 60 frames a second.)
function flashAt() {
	if (!take.flash) return null;
	const px = execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-t', '12', '-i', RAW, '-vf', 'crop=20:20:20:20,scale=1:1,fps=60', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 24 });
	for (let i = 0; i + 2 < px.length; i += 3) if (px[i] > 200 && px[i + 1] < 80 && px[i + 2] > 200) return i / 3 / 60;
	return null;
}
const seen = flashAt();
// A moment of the take (seconds after take.t0) in the video, and in the sound.
const inVideo = (s) => seen === null ? s : seen + (take.t0 + s * 1000 - take.flash) / 1000;
const inSound = (s) => (take.t0 + s * 1000 - take.sound) / 1000;
const sound = take.sound && fs.existsSync(SOUND);
console.log(seen === null ? 'no sync square found: the marks are used as they are' : `sync square at ${seen.toFixed(3)} s in the video`);

const parts = marks.map((m, i) => {
	const [a, b] = span(m);
	const v = `[0:v]trim=${inVideo(a).toFixed(3)}:${inVideo(b).toFixed(3)},setpts=PTS-STARTPTS,scale=1080:1920:flags=lanczos,fps=60[v${i}]`;
	// (sound from before it started is silence)
	const s0 = inSound(a), s1 = inSound(b);
	const au = !sound ? '' : s0 >= 0 ? `;[1:a]atrim=${s0.toFixed(3)}:${s1.toFixed(3)},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo[a${i}]`
		: `;aevalsrc=0|0:d=${(b - a).toFixed(3)}:s=48000,aformat=channel_layouts=stereo[a${i}]`;
	return v + au;
});
const pads = marks.map((_, i) => sound ? `[v${i}][a${i}]` : `[v${i}]`).join('');
const graph = parts.join(';') + ';' + pads + `concat=n=${marks.length}:v=1:a=${sound ? 1 : 0}${sound ? '[out][ac];[ac]volume=9dB,alimiter=limit=0.9[aout]' : '[out]'}`; // (the voices up to a good level)
execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'warning', '-y', '-i', RAW, ...(sound ? ['-i', SOUND] : []), '-filter_complex', graph, '-map', '[out]', ...(sound ? ['-map', '[aout]', '-c:a', 'aac', '-b:a', '192k'] : []),
	'-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(OUT, 'blaube-trailer.mp4')], { stdio: 'inherit' });
const total = marks.reduce((s, m) => { const [a, b] = span(m); return s + b - a; }, 0);
console.log(`out/blaube-trailer.mp4: ${marks.length} scenes, ${total.toFixed(1)} s${sound ? ', with sound' : ''}`);
