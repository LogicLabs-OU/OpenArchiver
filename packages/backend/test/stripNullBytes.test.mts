/**
 * Unit test for the NUL-byte helpers. Runs against the compiled backend (`pnpm build` first):
 *
 *   node --test test/stripNullBytes.test.mts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { stripNullBytes, stripNullBytesOrEmpty } from '../dist/helpers/stripNullBytes.js';

describe('stripNullBytes', () => {
	test('removes NUL characters', () => {
		assert.equal(stripNullBytes('Subject\0'), 'Subject');
	});
});

describe('stripNullBytesOrEmpty', () => {
	test('removes NUL characters from a string', () => {
		assert.equal(stripNullBytesOrEmpty('text/\0calendar'), 'text/calendar');
	});

	// mailparser returns `contentType: false` for "Content-Type: ; name=..." (#509).
	for (const value of [false, undefined, null, 0]) {
		test(`returns an empty string for ${String(value)}`, () => {
			assert.equal(stripNullBytesOrEmpty(value), '');
		});
	}
});
