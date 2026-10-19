/**
 * Which Tika server API an instance speaks, read from `GET /version`.
 *
 * Tika 4 changed the server's output: a bare `PUT /tika` returns Markdown whatever the `Accept`
 * header says, and plain text comes from `/tika/text`. On Tika 2.x and 3.x that same path is the
 * JSON endpoint, so sending every server the 4.x request would store `{"X-TIKA:content": …}` as an
 * attachment's text wherever an operator runs their own older Tika behind TIKA_URL. The two shapes
 * below are the only difference the archiver cares about.
 */

/** The major version in a `/version` answer such as `Apache Tika 4.1.0`, or undefined. */
export const parseTikaMajor = (versionText: string): number | undefined => {
	const match = /Apache Tika (\d+)\./i.exec(versionText);
	return match ? Number(match[1]) : undefined;
};

export interface TikaRequestShape {
	/** Path under TIKA_URL that returns body-only plain text. */
	endpoint: '/tika/text' | '/tika';
	/** `Accept` header to send, for a server that chooses its output by it. */
	accept?: 'text/plain';
	/**
	 * Whether a 422 carries the text Tika managed to extract before the parser failed. True on
	 * 4.x; on 3.x the body is the parser's error message, which must not be stored as text.
	 */
	partialContentOn422: boolean;
}

/** The request that yields plain text from a server of the given major version. */
export const tikaRequestShape = (major: number): TikaRequestShape =>
	major >= 4
		? { endpoint: '/tika/text', partialContentOn422: true }
		: { endpoint: '/tika', accept: 'text/plain', partialContentOn422: false };
