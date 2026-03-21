/**
 * Generates the OpenAPI specification from swagger-jsdoc annotations in the route files.
 * Outputs the spec to docs/api/openapi.json for use with vitepress-openapi.
 *
 * Run: node packages/backend/scripts/generate-openapi-spec.mjs
 */
import swaggerJsdoc from 'swagger-jsdoc';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const options = {
	definition: {
		openapi: '3.1.0',
		info: {
			title: 'Open Archiver API',
			version: '1.0.0',
			description:
				'REST API for Open Archiver — an open-source email archiving platform. All authenticated endpoints require a Bearer JWT token obtained from `POST /v1/auth/login`, or an API key passed as a Bearer token.',
			license: {
				name: 'SEE LICENSE IN LICENSE',
				url: 'https://github.com/LogicLabs-OU/OpenArchiver/blob/main/LICENSE',
			},
			contact: {
				name: 'Open Archiver',
				url: 'https://openarchiver.com',
			},
		},
		servers: [
			{
				url: 'http://localhost:3000',
				description: 'Local development',
			},
		],
		// Both security schemes apply globally; individual endpoints may override
		security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
		components: {
			securitySchemes: {
				bearerAuth: {
					type: 'http',
					scheme: 'bearer',
					bearerFormat: 'JWT',
					description:
						'JWT obtained from `POST /v1/auth/login`. Pass as `Authorization: Bearer <token>`.',
				},
				apiKeyAuth: {
					type: 'apiKey',
					in: 'header',
					name: 'X-API-KEY',
					description:
						'API key generated via `POST /v1/api-keys`. Pass as `X-API-KEY: <key>`.',
				},
			},
			responses: {
				Unauthorized: {
					description: 'Authentication is required or the token is invalid/expired.',
					content: {
						'application/json': {
							schema: { $ref: '#/components/schemas/ErrorMessage' },
							example: { message: 'Unauthorized' },
						},
					},
				},
				Forbidden: {
					description:
						'The authenticated user does not have permission to perform this action.',
					content: {
						'application/json': {
							schema: { $ref: '#/components/schemas/ErrorMessage' },
							example: { message: 'Forbidden' },
						},
					},
				},
				NotFound: {
					description: 'The requested resource was not found.',
					content: {
						'application/json': {
							schema: { $ref: '#/components/schemas/ErrorMessage' },
							example: { message: 'Not found' },
						},
					},
				},
				InternalServerError: {
					description: 'An unexpected error occurred on the server.',
					content: {
						'application/json': {
							schema: { $ref: '#/components/schemas/ErrorMessage' },
							example: { message: 'Internal server error' },
						},
					},
				},
			},
			schemas: {
				// --- Shared utility schemas ---
				ErrorMessage: {
					type: 'object',
					properties: {
						message: {
							type: 'string',
							description: 'Human-readable error description.',
							example: 'An error occurred.',
						},
					},
					required: ['message'],
				},
				MessageResponse: {
					type: 'object',
					properties: {
						message: {
							type: 'string',
							example: 'Operation completed successfully.',
						},
					},
					required: ['message'],
				},
				ValidationError: {
					type: 'object',
					properties: {
						message: {
							type: 'string',
							example: 'Request body is invalid.',
						},
						errors: {
							type: 'string',
							description: 'Zod validation error details.',
						},
					},
					required: ['message'],
				},
				// --- Auth ---
				LoginResponse: {
					type: 'object',
					properties: {
						accessToken: {
							type: 'string',
							description: 'JWT for authenticating subsequent requests.',
							example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
						},
						user: {
							$ref: '#/components/schemas/User',
						},
					},
					required: ['accessToken', 'user'],
				},
				// --- Users ---
				User: {
					type: 'object',
					properties: {
						id: { type: 'string', example: 'clx1y2z3a0000b4d2' },
						first_name: { type: 'string', nullable: true, example: 'Jane' },
						last_name: { type: 'string', nullable: true, example: 'Doe' },
						email: {
							type: 'string',
							format: 'email',
							example: 'jane.doe@example.com',
						},
						role: {
							$ref: '#/components/schemas/Role',
							nullable: true,
						},
						createdAt: { type: 'string', format: 'date-time' },
					},
					required: ['id', 'email', 'createdAt'],
				},
				// --- IAM ---
				Role: {
					type: 'object',
					properties: {
						id: { type: 'string', example: 'clx1y2z3a0000b4d2' },
						slug: { type: 'string', nullable: true, example: 'predefined_super_admin' },
						name: { type: 'string', example: 'Super Admin' },
						policies: {
							type: 'array',
							items: { $ref: '#/components/schemas/CaslPolicy' },
						},
						createdAt: { type: 'string', format: 'date-time' },
						updatedAt: { type: 'string', format: 'date-time' },
					},
					required: ['id', 'name', 'policies', 'createdAt', 'updatedAt'],
				},
				CaslPolicy: {
					type: 'object',
					description:
						'An CASL-style permission policy statement. `action` and `subject` can be strings or arrays of strings. `conditions` optionally restricts access to specific resource attributes.',
					properties: {
						action: {
							oneOf: [
								{
									type: 'string',
									example: 'read',
								},
								{
									type: 'array',
									items: { type: 'string' },
									example: ['read', 'search'],
								},
							],
						},
						subject: {
							oneOf: [
								{
									type: 'string',
									example: 'archive',
								},
								{
									type: 'array',
									items: { type: 'string' },
									example: ['archive', 'ingestion'],
								},
							],
						},
						conditions: {
							type: 'object',
							description:
								'Optional attribute-level conditions. Supports `${user.id}` interpolation.',
							example: { userId: '${user.id}' },
						},
					},
					required: ['action', 'subject'],
				},
				// --- API Keys ---
				ApiKey: {
					type: 'object',
					properties: {
						id: { type: 'string', example: 'clx1y2z3a0000b4d2' },
						name: { type: 'string', example: 'CI/CD Pipeline Key' },
						key: {
							type: 'string',
							description:
								'Partial/masked key — the raw value is only available at creation time.',
							example: 'oa_live_abc1...',
						},
						expiresAt: { type: 'string', format: 'date-time' },
						createdAt: { type: 'string', format: 'date-time' },
					},
					required: ['id', 'name', 'expiresAt', 'createdAt'],
				},
				// --- Ingestion ---
				SafeIngestionSource: {
					type: 'object',
					description: 'An ingestion source with sensitive credential fields removed.',
					properties: {
						id: { type: 'string', example: 'clx1y2z3a0000b4d2' },
						name: { type: 'string', example: 'Company Google Workspace' },
						provider: {
							type: 'string',
							enum: [
								'google_workspace',
								'microsoft_365',
								'generic_imap',
								'pst_import',
								'eml_import',
								'mbox_import',
							],
							example: 'google_workspace',
						},
						status: {
							type: 'string',
							enum: [
								'active',
								'paused',
								'error',
								'pending_auth',
								'syncing',
								'importing',
								'auth_success',
								'imported',
							],
							example: 'active',
						},
						createdAt: { type: 'string', format: 'date-time' },
						updatedAt: { type: 'string', format: 'date-time' },
						lastSyncStartedAt: { type: 'string', format: 'date-time', nullable: true },
						lastSyncFinishedAt: { type: 'string', format: 'date-time', nullable: true },
						lastSyncStatusMessage: { type: 'string', nullable: true },
					},
					required: ['id', 'name', 'provider', 'status', 'createdAt', 'updatedAt'],
				},
				CreateIngestionSourceDto: {
					type: 'object',
					required: ['name', 'provider', 'providerConfig'],
					properties: {
						name: {
							type: 'string',
							example: 'Company Google Workspace',
						},
						provider: {
							type: 'string',
							enum: [
								'google_workspace',
								'microsoft_365',
								'generic_imap',
								'pst_import',
								'eml_import',
								'mbox_import',
							],
						},
						providerConfig: {
							type: 'object',
							description:
								'Provider-specific configuration. See the ingestion source guides for the required fields per provider.',
							example: {
								serviceAccountKeyJson: '{"type":"service_account",...}',
								impersonatedAdminEmail: 'admin@example.com',
							},
						},
					},
				},
				UpdateIngestionSourceDto: {
					type: 'object',
					properties: {
						name: { type: 'string' },
						provider: {
							type: 'string',
							enum: [
								'google_workspace',
								'microsoft_365',
								'generic_imap',
								'pst_import',
								'eml_import',
								'mbox_import',
							],
						},
						status: {
							type: 'string',
							enum: [
								'active',
								'paused',
								'error',
								'pending_auth',
								'syncing',
								'importing',
								'auth_success',
								'imported',
							],
						},
						providerConfig: { type: 'object' },
					},
				},
				// --- Archived Emails ---
				Recipient: {
					type: 'object',
					properties: {
						name: { type: 'string', nullable: true, example: 'John Doe' },
						email: {
							type: 'string',
							format: 'email',
							example: 'john.doe@example.com',
						},
					},
					required: ['email'],
				},
				Attachment: {
					type: 'object',
					properties: {
						id: { type: 'string', example: 'clx1y2z3a0000b4d2' },
						filename: { type: 'string', example: 'invoice.pdf' },
						mimeType: { type: 'string', nullable: true, example: 'application/pdf' },
						sizeBytes: { type: 'integer', example: 204800 },
						storagePath: {
							type: 'string',
							example: 'open-archiver/attachments/abc123.pdf',
						},
					},
					required: ['id', 'filename', 'sizeBytes', 'storagePath'],
				},
				// Minimal representation of an email within a thread (returned alongside ArchivedEmail)
				ThreadEmail: {
					type: 'object',
					properties: {
						id: {
							type: 'string',
							description: 'ArchivedEmail ID.',
							example: 'clx1y2z3a0000b4d2',
						},
						subject: { type: 'string', nullable: true, example: 'Re: Q4 Invoice' },
						sentAt: { type: 'string', format: 'date-time' },
						senderEmail: {
							type: 'string',
							format: 'email',
							example: 'finance@vendor.com',
						},
					},
					required: ['id', 'sentAt', 'senderEmail'],
				},
				ArchivedEmail: {
					type: 'object',
					properties: {
						id: { type: 'string', example: 'clx1y2z3a0000b4d2' },
						ingestionSourceId: { type: 'string', example: 'clx1y2z3a0000b4d2' },
						userEmail: {
							type: 'string',
							format: 'email',
							example: 'user@company.com',
						},
						messageIdHeader: { type: 'string', nullable: true },
						sentAt: { type: 'string', format: 'date-time' },
						subject: { type: 'string', nullable: true, example: 'Q4 Invoice' },
						senderName: { type: 'string', nullable: true, example: 'Finance Dept' },
						senderEmail: {
							type: 'string',
							format: 'email',
							example: 'finance@vendor.com',
						},
						recipients: {
							type: 'array',
							items: { $ref: '#/components/schemas/Recipient' },
						},
						storagePath: { type: 'string' },
						storageHashSha256: {
							type: 'string',
							description:
								'SHA-256 hash of the raw email file, stored at archival time.',
						},
						sizeBytes: { type: 'integer' },
						isIndexed: { type: 'boolean' },
						hasAttachments: { type: 'boolean' },
						isOnLegalHold: { type: 'boolean' },
						archivedAt: { type: 'string', format: 'date-time' },
						attachments: {
							type: 'array',
							items: { $ref: '#/components/schemas/Attachment' },
						},
						thread: {
							type: 'array',
							description:
								'Other emails in the same thread, ordered by sentAt. Only present on single-email GET responses.',
							items: { $ref: '#/components/schemas/ThreadEmail' },
						},
						path: { type: 'string', nullable: true },
						tags: {
							type: 'array',
							items: { type: 'string' },
							nullable: true,
						},
					},
					required: [
						'id',
						'ingestionSourceId',
						'userEmail',
						'sentAt',
						'senderEmail',
						'recipients',
						'storagePath',
						'storageHashSha256',
						'sizeBytes',
						'isIndexed',
						'hasAttachments',
						'isOnLegalHold',
						'archivedAt',
					],
				},
				PaginatedArchivedEmails: {
					type: 'object',
					properties: {
						items: {
							type: 'array',
							items: { $ref: '#/components/schemas/ArchivedEmail' },
						},
						total: { type: 'integer', example: 1234 },
						page: { type: 'integer', example: 1 },
						limit: { type: 'integer', example: 10 },
					},
					required: ['items', 'total', 'page', 'limit'],
				},
				// --- Search ---
				SearchResults: {
					type: 'object',
					properties: {
						hits: {
							type: 'array',
							description:
								'Array of matching archived email objects, potentially with highlighted fields.',
							items: { type: 'object' },
						},
						total: { type: 'integer', example: 42 },
						page: { type: 'integer', example: 1 },
						limit: { type: 'integer', example: 10 },
						totalPages: { type: 'integer', example: 5 },
						processingTimeMs: {
							type: 'integer',
							description: 'Meilisearch query processing time in milliseconds.',
							example: 12,
						},
					},
					required: ['hits', 'total', 'page', 'limit', 'totalPages', 'processingTimeMs'],
				},
				// --- Integrity ---
				IntegrityCheckResult: {
					type: 'object',
					properties: {
						type: {
							type: 'string',
							enum: ['email', 'attachment'],
							description:
								'Whether this result is for the email itself or one of its attachments.',
						},
						id: { type: 'string', example: 'clx1y2z3a0000b4d2' },
						filename: {
							type: 'string',
							description:
								'Attachment filename. Only present when `type` is `attachment`.',
							example: 'invoice.pdf',
						},
						isValid: {
							type: 'boolean',
							description: 'True if the stored and computed hashes match.',
						},
						reason: {
							type: 'string',
							description: 'Human-readable explanation if `isValid` is false.',
						},
						storedHash: {
							type: 'string',
							description: 'SHA-256 hash stored at archival time.',
							example: 'a3f1b2c4...',
						},
						computedHash: {
							type: 'string',
							description: 'SHA-256 hash computed during this verification run.',
							example: 'a3f1b2c4...',
						},
					},
					required: ['type', 'id', 'isValid', 'storedHash', 'computedHash'],
				},
				// --- Jobs ---
				QueueCounts: {
					type: 'object',
					properties: {
						active: { type: 'integer', example: 0 },
						completed: { type: 'integer', example: 56 },
						failed: { type: 'integer', example: 4 },
						delayed: { type: 'integer', example: 0 },
						waiting: { type: 'integer', example: 0 },
						paused: { type: 'integer', example: 0 },
					},
					required: ['active', 'completed', 'failed', 'delayed', 'waiting', 'paused'],
				},
				QueueOverview: {
					type: 'object',
					properties: {
						name: { type: 'string', example: 'ingestion' },
						counts: { $ref: '#/components/schemas/QueueCounts' },
					},
					required: ['name', 'counts'],
				},
				Job: {
					type: 'object',
					properties: {
						id: { type: 'string', nullable: true, example: '1' },
						name: { type: 'string', example: 'initial-import' },
						data: {
							type: 'object',
							description: 'Job payload data.',
							example: { ingestionSourceId: 'clx1y2z3a0000b4d2' },
						},
						state: {
							type: 'string',
							enum: ['active', 'completed', 'failed', 'delayed', 'waiting', 'paused'],
							example: 'failed',
						},
						failedReason: {
							type: 'string',
							nullable: true,
							example: 'Error: Connection timed out',
						},
						timestamp: { type: 'integer', example: 1678886400000 },
						processedOn: { type: 'integer', nullable: true, example: 1678886401000 },
						finishedOn: { type: 'integer', nullable: true, example: 1678886402000 },
						attemptsMade: { type: 'integer', example: 5 },
						stacktrace: {
							type: 'array',
							items: { type: 'string' },
						},
						returnValue: { nullable: true },
						ingestionSourceId: { type: 'string', nullable: true },
						error: {
							description: 'Shorthand copy of `failedReason` for easier access.',
							nullable: true,
						},
					},
					required: [
						'id',
						'name',
						'data',
						'state',
						'timestamp',
						'attemptsMade',
						'stacktrace',
					],
				},
				QueueDetails: {
					type: 'object',
					properties: {
						name: { type: 'string', example: 'ingestion' },
						counts: { $ref: '#/components/schemas/QueueCounts' },
						jobs: {
							type: 'array',
							items: { $ref: '#/components/schemas/Job' },
						},
						pagination: {
							type: 'object',
							properties: {
								currentPage: { type: 'integer', example: 1 },
								totalPages: { type: 'integer', example: 3 },
								totalJobs: { type: 'integer', example: 25 },
								limit: { type: 'integer', example: 10 },
							},
							required: ['currentPage', 'totalPages', 'totalJobs', 'limit'],
						},
					},
					required: ['name', 'counts', 'jobs', 'pagination'],
				},
				// --- Dashboard ---
				DashboardStats: {
					type: 'object',
					properties: {
						totalEmailsArchived: { type: 'integer', example: 125000 },
						totalStorageUsed: {
							type: 'integer',
							description: 'Total storage used by all archived emails in bytes.',
							example: 5368709120,
						},
						failedIngestionsLast7Days: {
							type: 'integer',
							description:
								'Number of ingestion sources in error state updated in the last 7 days.',
							example: 2,
						},
					},
				},
				IngestionSourceStats: {
					type: 'object',
					description: 'Summary of an ingestion source including its storage usage.',
					properties: {
						id: { type: 'string', example: 'clx1y2z3a0000b4d2' },
						name: { type: 'string', example: 'Company Google Workspace' },
						provider: { type: 'string', example: 'google_workspace' },
						status: { type: 'string', example: 'active' },
						storageUsed: {
							type: 'integer',
							description:
								'Total bytes stored for emails from this ingestion source.',
							example: 1073741824,
						},
					},
					required: ['id', 'name', 'provider', 'status', 'storageUsed'],
				},
				RecentSync: {
					type: 'object',
					description: 'Summary of a recent sync session.',
					properties: {
						id: { type: 'string', example: 'clx1y2z3a0000b4d2' },
						sourceName: { type: 'string', example: 'Company Google Workspace' },
						startTime: { type: 'string', format: 'date-time' },
						duration: {
							type: 'integer',
							description: 'Duration in milliseconds.',
							example: 4500,
						},
						emailsProcessed: { type: 'integer', example: 120 },
						status: { type: 'string', example: 'completed' },
					},
					required: [
						'id',
						'sourceName',
						'startTime',
						'duration',
						'emailsProcessed',
						'status',
					],
				},
				IndexedInsights: {
					type: 'object',
					description: 'Insights derived from the search index.',
					properties: {
						topSenders: {
							type: 'array',
							items: {
								type: 'object',
								properties: {
									sender: { type: 'string', example: 'finance@vendor.com' },
									count: { type: 'integer', example: 342 },
								},
								required: ['sender', 'count'],
							},
						},
					},
					required: ['topSenders'],
				},
				// --- Settings ---
				SystemSettings: {
					type: 'object',
					description: 'Non-sensitive system configuration values.',
					properties: {
						language: {
							type: 'string',
							enum: ['en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'ja', 'et', 'el'],
							example: 'en',
							description: 'Default UI language code.',
						},
						theme: {
							type: 'string',
							enum: ['light', 'dark', 'system'],
							example: 'system',
							description: 'Default color theme.',
						},
						supportEmail: {
							type: 'string',
							format: 'email',
							nullable: true,
							example: 'support@example.com',
							description: 'Public-facing support email address.',
						},
					},
				},
			},
		},
	},
	// Scan all route files for @openapi annotations
	apis: [resolve(__dirname, '../src/api/routes/*.ts')],
};

const spec = swaggerJsdoc(options);

// Output to docs/ directory so VitePress can consume it
const outputPath = resolve(__dirname, '../../../docs/api/openapi.json');
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify(spec, null, 2));

console.log(`✅ OpenAPI spec generated: ${outputPath}`);
console.log(`   Paths: ${Object.keys(spec.paths ?? {}).length}, Tags: ${(spec.tags ?? []).length}`);
