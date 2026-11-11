// Cuts the recorded take (out/raw.mp4, and the blobs' sound out/sound.webm)
// down to its shots, back to back, at 1080x1920:
//
//   node scripts/film/cut.js              # -> out/blaube-trailer.mp4, and each shot whole in out/shots/
//
// CUT says which bits of each shot to keep, in order: [from its start, for
// how long] (seconds). A shot can be cut into more than once (jump cuts),
// and one left out of CUT is left out of the film.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FFMPEG = 'C:/ffmpeg/bin/ffmpeg.exe';
const HERE = __dirname, OUT = path.join(HERE, 'out');
const RAW = path.join(OUT, 'raw.mp4'), SOUND = path.join(OUT, 'sound.webm');
// The film is cut to a waltz: downbeats at FIRST + k * BAR seconds into the song.
const MUSIC = path.join(HERE, "music", "waltzing-in-paris.mp3");
const BAR = 1.0738, FIRST = 0.44;
const TALK = 0.3, SING = 0.8; // how loud the blobs’ talking and their singing are (1: as in draft 2)
const SKIP = 3; // bars of the song’s intro left out: the film starts on its fourth downbeat
const MUSIC_START = FIRST + SKIP * BAR;
// [shot, how many bars it gets, where to cut in]. Where: { from } seconds
// after the shot starts, or { cue, lead }: the shot’s cue (trailer.js) lands
// lead bars into its slot (a beat is a third of a bar). mute: no blob sound.
const CUT = [
	["pipe", 5, { cue: "cue", lead: 3 }], // (the yank on the fourth downbeat)
	["chat", 3, { cue: "cue", lead: 1 / 3 }],
	["flick", 2, { cue: "cue", lead: 1 / 3 }],
	["yank", 2, { cue: "cue", lead: 1 / 3 }],
	["tower", 2, { from: 0.35 }],
	["rain", 2, { from: 0.1 }],
	["balloon", 3, { from: 1.6 }],
	["choir", 4, { cue: "sing", lead: -0.8 / BAR, onset: true, bar: 22 }], // (they sing along: their first note on the song’s bar 22, which it was written for)
	["family", 2, { cue: "cue", lead: 1 / 3 }],
	["family", 2, { cue: "home", lead: 0 }],
	["dizzy", 2, { from: 1.3 }],
	["dizzy", 2, { cue: "barf", lead: 2 / 3 }],
	["end", 5, { from: 0.3 }],
];

function load() {
	const take = JSON.parse(fs.readFileSync(path.join(HERE, 'marks.json'), 'utf8'));
	// Where the magenta square first shows in the video: the clock time
	// take.flash. (Its top-left corner, sampled at 60 frames a second.)
	let seen = null;
	if (take.flash) {
		const px = execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-t', '12', '-i', RAW, '-vf', 'crop=20:20:20:20,scale=1:1,fps=60', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 24 });
		for (let i = 0; i + 2 < px.length; i += 3) if (px[i] > 200 && px[i + 1] < 80 && px[i + 2] > 200) { seen = i / 3 / 60; break; }
	}
	return {
		take, seen,
		// A moment of the take (seconds after take.t0) in the video, and in the sound.
		inVideo: (s) => seen === null ? s : seen + (take.t0 + s * 1000 - take.flash) / 1000,
		inSound: (s) => (take.t0 + s * 1000 - take.sound) / 1000,
		sound: !!take.sound && fs.existsSync(SOUND),
	};
}
module.exports = { load, FFMPEG, RAW, OUT };
if (require.main !== module) return;

const { take, seen, inVideo, inSound, sound } = load();
console.log(seen === null ? 'no sync square found: the marks are used as they are' : `sync square at ${seen.toFixed(3)} s in the video`);
const bits = [];
for (const [name, bars, how] of CUT) {
	const m = take.scenes.find((x) => x.name === name);
	if (!m) continue;
	const len = bars * BAR;
	const lead = (how.lead || 0) * BAR;
	const at = bits.reduce((t, p) => t + p.b - p.a, 0);
	if (how.bar !== undefined && Math.abs(MUSIC_START + at - (FIRST + how.bar * BAR)) > 0.01) console.log(`  ${name}: lands on the song’s bar ${((MUSIC_START + at - FIRST) / BAR).toFixed(2)}, not ${how.bar}`);
	const a = how.cue ? m.cues[how.cue] - lead : m.start + how.from;
	if (a < m.start - 0.05 || a + len > m.end + 0.05) console.log(`  ${name}: wants ${(a - m.start).toFixed(2)}..${(a + len - m.start).toFixed(2)} s of a ${(m.end - m.start).toFixed(2)} s shot`);
	bits.push({ name, a, b: a + len, mute: !!how.mute, onset: !!how.onset });
}
// The film is made in three passes (one big filter graph over the long take
// falls over): each piece of picture on its own, then the sound (the blobs’
// own, under the song), then the two together.
const run = (args) => execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "fatal", "-y", ...args], { stdio: "inherit" });
function render(list, file, music) {
	const tmp = path.join(OUT, "tmp");
	fs.mkdirSync(tmp, { recursive: true });
	const total = list.reduce((t, p) => t + p.b - p.a, 0);
	list.forEach((p, i) => run(["-ss", inVideo(p.a).toFixed(3), "-i", RAW, "-t", (p.b - p.a).toFixed(3), "-vf", "scale=1080:1920:flags=lanczos,fps=60", "-an", "-c:v", "libx264", "-preset", "fast", "-crf", "12", "-pix_fmt", "yuv420p", path.join(tmp, `v${i}.mp4`)]));
	fs.writeFileSync(path.join(tmp, "list.txt"), list.map((_, i) => `file 'v${i}.mp4'`).join('\n'));
	const withMusic = music && fs.existsSync(MUSIC), audio = sound || withMusic;
	if (audio) {
		const ins = [], parts = [];
		if (sound) {
			// (the recorder leaves gaps where nothing sounded, and a bad packet now and then: laid out by its clock first)
			run(["-err_detect", "ignore_err", "-i", SOUND, "-af", "aresample=async=1:first_pts=0", "-ar", "48000", "-ac", "2", path.join(tmp, "sound.wav")]);
			ins.push("-i", path.join(tmp, "sound.wav"));
			// (for a piece that must sit on the music to the hundredth: where its first sound really is)
			run(["-i", path.join(tmp, "sound.wav"), "-ac", "1", "-ar", "8000", "-f", "s16le", path.join(tmp, "sound.pcm")]);
			const pcm = fs.readFileSync(path.join(tmp, "sound.pcm"));
			const onsetNear = (t) => { for (let i = Math.max(0, Math.floor((t - 0.4) * 8000)); i < (t + 0.6) * 8000 && i * 2 + 1 < pcm.length; i++) if (Math.abs(pcm.readInt16LE(i * 2)) > 400) return i / 8000; return t; };
			list.forEach((p, i) => {
				const d = (p.b - p.a).toFixed(3), s0 = p.onset ? onsetNear(inSound(p.a)) : inSound(p.a);
				if (p.onset) console.log(`  ${p.name}: first sound ${((s0 - inSound(p.a)) * 1000).toFixed(0)} ms from where the script put it`);
				parts.push(s0 >= 0 && !p.mute ? `[0:a]atrim=${s0.toFixed(3)}:${(s0 + (p.b - p.a)).toFixed(3)},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,volume=${p.name === "choir" ? SING : TALK},apad=whole_dur=${d},atrim=0:${d}[a${i}]` : `aevalsrc=0|0:d=${d}:s=48000,aformat=channel_layouts=stereo[a${i}]`);
			});
			parts.push(list.map((_, i) => `[a${i}]`).join("") + `concat=n=${list.length}:v=0:a=1,volume=${withMusic ? 11 : 9}dB${withMusic ? ",asplit[blobs][key]" : "[blobs]"}`);
		}
		if (withMusic) {
			ins.push("-i", MUSIC);
			parts.push(`[${sound ? 1 : 0}:a]atrim=${MUSIC_START.toFixed(3)}:${(MUSIC_START + total).toFixed(3)},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,volume=-4dB,afade=t=in:st=0:d=0.02,afade=t=out:st=${(total - 1.6).toFixed(3)}:d=1.6[song]`);
		}
		// (the song dips a little under the blobs’ voices)
		parts.push(sound && withMusic ? "[song][key]sidechaincompress=threshold=0.03:ratio=4:attack=15:release=350[duck];[duck][blobs]amix=inputs=2:normalize=0,alimiter=limit=0.95[aout]" : `[${sound ? "blobs" : "song"}]alimiter=limit=0.95[aout]`);
		run([...ins, "-filter_complex", parts.join(";"), "-map", "[aout]", "-c:a", "aac", "-b:a", "256k", path.join(tmp, "a.m4a")]);
	}
	run(["-f", "concat", "-safe", "0", "-i", path.join(tmp, "list.txt"), ...(audio ? ["-i", path.join(tmp, "a.m4a")] : []), "-map", "0:v", ...(audio ? ["-map", "1:a", "-c:a", "copy"] : []), "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-pix_fmt", "yuv420p", "-t", total.toFixed(3), "-movflags", "+faststart", file]);
	fs.rmSync(tmp, { recursive: true, force: true });
	return total;
}
if (process.argv.includes('--shots')) {
	fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true });
	for (const m of take.scenes) render([{ a: m.start, b: m.end }], path.join(OUT, 'shots', `${m.name}.mp4`), false);
}
const total = render(bits, path.join(OUT, 'blaube-trailer.mp4'), true);
console.log(`out/blaube-trailer.mp4: ${bits.length} cuts, ${total.toFixed(1)} s${sound ? ', with the blobs\x27 sound' : ''}${fs.existsSync(MUSIC) ? ', with the song' : ''}`);
