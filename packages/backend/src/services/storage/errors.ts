/**
 * Thrown by a storage provider's `put()` when `overwrite: false` was requested and an object
 * already exists at the path.
 *
 * Callers test for it with {@link isStorageObjectExistsError}, which matches on `name` — the
 * same idiom the workers use for BullMQ's `UnrecoverableError`.
 */
export class StorageObjectExistsError extends Error {
	public readonly path: string;

	constructor(path: string) {
		super(`An object already exists at storage path: ${path}`);
		this.name = 'StorageObjectExistsError';
		this.path = path;
	}
}

/** Whether `error` is a {@link StorageObjectExistsError}. */
export const isStorageObjectExistsError = (error: unknown): error is StorageObjectExistsError =>
	error instanceof Error && error.name === 'StorageObjectExistsError';
