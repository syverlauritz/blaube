const test = require('node:test');
const assert = require('node:assert');
const { imagePaths, attached, isImage, MAX } = require('../src/shared/talkMedia.js');

test('markdown images are found, with or without words, angle brackets or a title', () => {
	assert.deepStrictEqual(imagePaths('Here it is:\n\n![the box](shots/talkChat.png)'), ['shots/talkChat.png']);
	assert.deepStrictEqual(imagePaths('![](/tmp/a.jpg) and ![x](<./my pics/b.webp> "hi")'), ['/tmp/a.jpg', './my pics/b.webp']);
});

test('plain paths in the words are found: absolute, ~/, ./ and folder/file', () => {
	assert.deepStrictEqual(imagePaths('Saved it to /Users/me/Desktop/shot.png, then ~/Pictures/x.GIF and ./out/c.svg.'), ['/Users/me/Desktop/shot.png', '~/Pictures/x.GIF', './out/c.svg']);
	assert.deepStrictEqual(imagePaths('The icon (build/icon.png) and logo.jpeg are done'), ['build/icon.png', 'logo.jpeg']);
	assert.deepStrictEqual(imagePaths('C:\\Users\\me\\a.png'), ['C:\\Users\\me\\a.png']);
});

test('paths in code spans count, also with a line number or spaces in a full path', () => {
	assert.deepStrictEqual(imagePaths('Look at `docs/img/hero.png` and `/Users/me/My Shots/a.png`'), ['docs/img/hero.png', '/Users/me/My Shots/a.png']);
	assert.deepStrictEqual(imagePaths('`npm run shots -- a.png b.png`'), [], 'a command with images in it is not a path');
});

test('a dragged-in terminal path keeps its escaped spaces as spaces', () => {
	assert.deepStrictEqual(imagePaths('/Users/me/Desktop/Screen\\ Shot\\ 1.png what is this'), ['/Users/me/Desktop/Screen Shot 1.png']);
});

test('web addresses, data and other files are left out', () => {
	assert.deepStrictEqual(imagePaths('see https://example.com/a.png and http://x.io/img/b.jpg'), []);
	assert.deepStrictEqual(imagePaths('![w](https://example.com/c.png) ![d](data:image/png;base64,AAA)'), []);
	assert.deepStrictEqual(imagePaths('Edited src/talk.js and README.md, and pngs are nice'), []);
	assert.deepStrictEqual(imagePaths(''), []);
	assert.deepStrictEqual(imagePaths(undefined), []);
});

test('file:// links become paths', () => {
	assert.deepStrictEqual(imagePaths('![a](file:///tmp/My%20Pic.png)'), ['/tmp/My Pic.png']);
});

test('each path once, at most MAX', () => {
	assert.deepStrictEqual(imagePaths('a.png a.png `a.png` ![](a.png)'), ['a.png']);
	const many = Array.from({ length: 30 }, (_, i) => `p${i}.png`).join(' ');
	assert.strictEqual(imagePaths(many).length, MAX);
});

test('what you sent splits into your words and the files that went with it', () => {
	assert.deepStrictEqual(attached('make this bigger\n\nAttached file (open with your Read tool): /tmp/blaube-pastes/pasted-1.png'), { text: 'make this bigger', paths: ['/tmp/blaube-pastes/pasted-1.png'] });
	assert.deepStrictEqual(attached('Attached files (open with your Read tool): /a/b.png, /c/notes.txt'), { text: '', paths: ['/a/b.png', '/c/notes.txt'] });
	assert.deepStrictEqual(attached('just words'), { text: 'just words', paths: [] });
	assert.deepStrictEqual(attached('Attached file (open with your Read tool): x\nmore after'), { text: 'Attached file (open with your Read tool): x\nmore after', paths: [] }, 'only as the last line');
});

test('isImage looks at the extension only', () => {
	assert.ok(isImage('/a/b.JPG'));
	assert.ok(isImage('x.svg'));
	assert.ok(!isImage('x.pdf'));
	assert.ok(!isImage(null));
});
