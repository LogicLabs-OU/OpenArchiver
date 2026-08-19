import 'dotenv/config';
import { logger } from '../config/logger';

/**
 * Reads an integer setting, falling back loudly rather than silently.
 *
 * `parseInt` is too forgiving to use directly for configuration. It returns `NaN` for a typo, and
 * `NaN` propagates: a chunk size of `NaN` makes the indexing loop iterate once over an empty slice
 * and report success, leaving every row unindexed with nothing in the log to say so. Worse, it stops
 * at the first character it cannot read, so `1_000` — the digit-separator style used for the
 * defaults in the config modules, and an easy thing to paste into a `.env` — parses as `1`. That
 * silent misreading is the dangerous one: `INDEXING_WORKER_CONCURRENCY=1_000` would quietly restore
 * the one-job-at-a-time behaviour the setting exists to escape, and a `min` of 1 would not catch it
 * because 1 is a legal value. Hence the strict pattern rather than a range check alone.
 *
 * `min` and `max` then reject plausible-but-absurd values the same way a malformed one is rejected —
 * `max` matters for the concurrency knobs, where a stray digit turns into an out-of-memory crash
 * loop rather than a fast import.
 */
export const intFromEnv = (name: string, fallback: number, min: number, max?: number): number => {
	const raw = process.env[name];
	if (raw === undefined || raw.trim() === '') {
		return fallback;
	}

	const trimmed = raw.trim();
	const rejected = (reason: string): number => {
		logger.warn(
			{ variable: name, value: raw, min, max, using: fallback, reason },
			'Ignoring unusable configuration value'
		);
		return fallback;
	};

	// Digits only. Anything parseInt would silently truncate — `1_000`, `10k`, `4.5` — is a typo,
	// and guessing at what it meant is how a typo becomes a production incident.
	if (!/^[+-]?\d+$/.test(trimmed)) {
		return rejected('not an integer');
	}

	const parsed = Number.parseInt(trimmed, 10);
	if (!Number.isFinite(parsed) || parsed < min) {
		return rejected('below minimum');
	}
	if (max !== undefined && parsed > max) {
		return rejected('above maximum');
	}
	return parsed;
};
