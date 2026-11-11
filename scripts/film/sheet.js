// Contact sheets of the last take, one per shot (for checking a take without
// watching it): node scripts/film/sheet.js [folder] [frames a second]
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { load, FFMPEG, RAW, OUT } = require('./cut');
const { take, inVideo } = load();
const dir = process.argv[2] || OUT, fps = process.argv[3] || '3';
for (const s of take.scenes) {
	execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(inVideo(s.start)), '-t', String(s.end - s.start), '-i', RAW, '-vf', `fps=${fps},scale=180:320,tile=11x3`, '-frames:v', '1', path.join(dir, `s_${s.name}.jpg`)]);
	console.log(s.name, (s.end - s.start).toFixed(1));
}
