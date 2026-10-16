import pino from 'pino';

export const logger = pino({
	level: process.env.LOG_LEVEL || 'info',
	redact: ['password'],
	// Pino only applies its error serializer to the `err` key. A lot of call sites log
	// `{ error }` instead, and an Error keeps `message` and `stack` non-enumerable, so those
	// entries render as an empty `error: {}` and hide the actual failure. Serializing `error`
	// the same way makes both spellings print the message and stack.
	serializers: {
		error: pino.stdSerializers.err,
	},
	transport: {
		target: 'pino-pretty',
		options: {
			colorize: true,
		},
	},
});
