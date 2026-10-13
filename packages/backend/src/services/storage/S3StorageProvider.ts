import { IStorageProvider, S3StorageConfig, StoragePutOptions } from '@open-archiver/types';
import {
	S3Client,
	GetObjectCommand,
	PutObjectCommand,
	DeleteObjectCommand,
	HeadObjectCommand,
	NotFound,
	ListObjectsV2Command,
	DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { Readable } from 'stream';
import { streamToBuffer } from '../../helpers/streamToBuffer';
import { logger } from '../../config/logger';
import { StorageObjectExistsError } from './errors';

/** How a failed conditional PutObject should be read. */
type ConditionalPutOutcome = 'exists' | 'conflict' | 'unsupported' | 'other';

export class S3StorageProvider implements IStorageProvider {
	private readonly client: S3Client;
	private readonly bucket: string;
	/** Sticky once the backend has answered "not implemented" to a conditional write. */
	private conditionalPutUnsupported = false;

	constructor(config: S3StorageConfig) {
		this.client = new S3Client({
			endpoint: config.endpoint,
			region: config.region,
			credentials: {
				accessKeyId: config.accessKeyId,
				secretAccessKey: config.secretAccessKey,
			},
			forcePathStyle: config.forcePathStyle,
		});
		this.bucket = config.bucket;
	}

	async put(
		path: string,
		content: Buffer | NodeJS.ReadableStream,
		options?: StoragePutOptions
	): Promise<void> {
		if (options?.overwrite === false && !this.conditionalPutUnsupported) {
			// A conditional single-part put. `Upload` from lib-storage (3.844) does not forward
			// IfNoneMatch, and StorageService always hands the provider a Buffer, so a plain
			// PutObject is the right call.
			const body = Buffer.isBuffer(content)
				? content
				: await streamToBuffer(content as NodeJS.ReadableStream);

			// Two attempts at most. S3 answers the loser of two conditional PUTs racing for one
			// key with 409 ConditionalRequestConflict and documents retrying it; the retry then
			// sees the object committed and answers 412, which is the refusal the caller wants.
			for (let attempt = 0; attempt < 2; attempt++) {
				try {
					await this.client.send(
						new PutObjectCommand({
							Bucket: this.bucket,
							Key: path,
							Body: body,
							IfNoneMatch: '*',
						})
					);
					return;
				} catch (error) {
					const outcome = S3StorageProvider.classify(error);
					if (outcome === 'exists') {
						throw new StorageObjectExistsError(path);
					}
					if (outcome === 'conflict' && attempt === 0) {
						continue;
					}
					if (outcome === 'unsupported') {
						// Most backends without conditional-write support ignore the header and
						// behave as an unconditional put; a few reject the request outright. Give
						// up on the header rather than failing every ingestion, and say so once —
						// on such a backend the caller's own serialisation is the only guard.
						this.conditionalPutUnsupported = true;
						logger.warn(
							{ err: error, bucket: this.bucket },
							'Storage backend does not support conditional writes (If-None-Match); falling back to unconditional uploads for the rest of this process'
						);
						break;
					}
					throw error;
				}
			}
		}

		const upload = new Upload({
			client: this.client,
			params: {
				Bucket: this.bucket,
				Key: path,
				Body: content instanceof Readable ? content : Readable.from(content),
			},
		});

		await upload.done();
	}

	/**
	 * Reads a failed conditional PutObject.
	 *
	 * - 412 PreconditionFailed — the object exists. The refusal the caller asked for.
	 * - 409 ConditionalRequestConflict — another conditional PUT for the same key is in flight.
	 *   AWS documents a retry for this; it is not an answer about whether the object exists.
	 * - 501 NotImplemented — the backend has no conditional-write support at all.
	 */
	private static classify(error: unknown): ConditionalPutOutcome {
		const err = error as { name?: string; $metadata?: { httpStatusCode?: number } } | null;
		const status = err?.$metadata?.httpStatusCode;
		if (err?.name === 'PreconditionFailed' || status === 412) {
			return 'exists';
		}
		if (err?.name === 'ConditionalRequestConflict' || status === 409) {
			return 'conflict';
		}
		if (err?.name === 'NotImplemented' || status === 501) {
			return 'unsupported';
		}
		return 'other';
	}

	async get(path: string): Promise<NodeJS.ReadableStream> {
		const command = new GetObjectCommand({
			Bucket: this.bucket,
			Key: path,
		});

		try {
			const response = await this.client.send(command);
			if (response.Body instanceof Readable) {
				return response.Body;
			}
			throw new Error('Readable stream not found in S3 response');
		} catch (error) {
			if (error instanceof NotFound) {
				throw new Error('File not found');
			}
			throw error;
		}
	}

	async delete(path: string): Promise<void> {
		// List all objects with the given prefix
		const listCommand = new ListObjectsV2Command({
			Bucket: this.bucket,
			Prefix: path,
		});
		const listedObjects = await this.client.send(listCommand);

		if (!listedObjects.Contents || listedObjects.Contents.length === 0) {
			return;
		}

		// Create a list of objects to delete
		const deleteParams = {
			Bucket: this.bucket,
			Delete: {
				Objects: listedObjects.Contents.map(({ Key }) => ({ Key })),
			},
		};

		// Delete the objects
		const deleteCommand = new DeleteObjectsCommand(deleteParams);
		await this.client.send(deleteCommand);
	}

	async exists(path: string): Promise<boolean> {
		const command = new HeadObjectCommand({
			Bucket: this.bucket,
			Key: path,
		});

		try {
			await this.client.send(command);
			return true;
		} catch (error) {
			if (error instanceof NotFound) {
				return false;
			}
			throw error;
		}
	}
}
