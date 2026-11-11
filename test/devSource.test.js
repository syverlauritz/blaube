const test = require('node:test');
const assert = require('node:assert');
const { label } = require('../src/main/devSource.js');

test('the menu says when Blaube runs from a branch, or behind main', () => {
	assert.equal(label(null), '');
	assert.equal(label({ branch: 'main', behind: 0 }), '');
	assert.equal(label({ branch: 'HEAD', behind: 0 }), '', 'Blaube (dev): detached on the newest main');
	assert.equal(label({ branch: 'film', behind: 0 }), 'From film');
	assert.equal(label({ branch: 'film', behind: 76 }), 'From film · 76 behind main');
	assert.equal(label({ branch: 'HEAD', behind: 3 }), 'From main · 3 behind main');
});
