import { describe, it, expect } from 'vitest';
import {
	canonicalizeMessageId,
	messageIdVariants,
	normalizeMessageIdHeader,
} from '../helpers/messageId';

describe('messageId helpers', () => {
	it('strips angle brackets and whitespace', () => {
		expect(canonicalizeMessageId(' <shared@example.com> ')).toBe('shared@example.com');
		expect(canonicalizeMessageId('shared@example.com')).toBe('shared@example.com');
	});

	it('returns bracketed and bare variants', () => {
		expect(messageIdVariants(' <shared@example.com> ')).toEqual(
			expect.arrayContaining(['<shared@example.com>', 'shared@example.com'])
		);
	});

	it('normalizes stored headers to bracketed form', () => {
		expect(normalizeMessageIdHeader(' shared@example.com ')).toBe('<shared@example.com>');
		expect(normalizeMessageIdHeader('generated-abc-source-id')).toBe(
			'generated-abc-source-id'
		);
	});
});
