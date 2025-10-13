import { count, desc, eq, asc, and, sql } from 'drizzle-orm';
import { db } from '../database';
import {
	archivedEmails,
	attachments,
	emailAttachments,
	ingestionSources,
} from '../database/schema';
import { FilterBuilder } from './FilterBuilder';
import { AuthorizationService } from './AuthorizationService';
import type {
	PaginatedArchivedEmails,
	ArchivedEmail,
	Recipient,
	ThreadEmail,
	ArchivedEmailsQuery,
	EmailFolder,
} from '@open-archiver/types';
import { StorageService } from './StorageService';
import { SearchService } from './SearchService';
import type { Readable } from 'stream';

interface DbRecipients {
	to: { name: string; address: string }[];
	cc: { name: string; address: string }[];
	bcc: { name: string; address: string }[];
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		stream.on('data', (chunk) => chunks.push(chunk));
		stream.on('error', reject);
		stream.on('end', () => resolve(Buffer.concat(chunks)));
	});
}

export class ArchivedEmailService {
	private static mapRecipients(dbRecipients: unknown): Recipient[] {
		const { to = [], cc = [], bcc = [] } = dbRecipients as DbRecipients;

		const allRecipients = [...to, ...cc, ...bcc];

		return allRecipients.map((r) => ({
			name: r.name,
			email: r.address,
		}));
	}

	public static async getArchivedEmails(
		query: ArchivedEmailsQuery,
		userId: string
	): Promise<PaginatedArchivedEmails> {
		const {
			ingestionSourceId,
			page,
			limit,
			path,
			sortBy = 'sentAt',
			sortOrder = 'desc',
		} = query;
		const offset = (page - 1) * limit;
		const { drizzleFilter } = await FilterBuilder.create(userId, 'archive', 'read');

		const conditions = [eq(archivedEmails.ingestionSourceId, ingestionSourceId), drizzleFilter];

		// Only add path filtering if path is explicitly provided (not undefined)
		if (path !== undefined) {
			if (path === null || path === 'null') {
				conditions.push(sql`${archivedEmails.path} IS NULL`);
			} else {
				conditions.push(eq(archivedEmails.path, path));
			}
		}
		// If path is undefined, don't add any path filter - return all emails

		const where = and(...conditions.filter(Boolean));

		const countQuery = db
			.select({
				count: count(archivedEmails.id),
			})
			.from(archivedEmails)
			.leftJoin(ingestionSources, eq(archivedEmails.ingestionSourceId, ingestionSources.id));

		if (where) {
			countQuery.where(where);
		}

		const [total] = await countQuery;

		// Dynamic sorting
		const orderByClause =
			sortOrder === 'desc' ? desc(archivedEmails[sortBy]) : asc(archivedEmails[sortBy]);

		const itemsQuery = db
			.select()
			.from(archivedEmails)
			.leftJoin(ingestionSources, eq(archivedEmails.ingestionSourceId, ingestionSources.id))
			.orderBy(orderByClause)
			.limit(limit)
			.offset(offset);

		if (where) {
			itemsQuery.where(where);
		}

		const results = await itemsQuery;
		const items = results.map((r) => r.archived_emails);

		return {
			items: items.map((item) => ({
				...item,
				recipients: this.mapRecipients(item.recipients),
				tags: (item.tags as string[] | null) || null,
				path: item.path || null,
			})),
			total: total.count,
			page,
			limit,
		};
	}

	public static async getFolderStructure(
		ingestionSourceId: string,
		userId: string
	): Promise<EmailFolder[]> {
		const { drizzleFilter } = await FilterBuilder.create(userId, 'archive', 'read');
		const where = and(eq(archivedEmails.ingestionSourceId, ingestionSourceId), drizzleFilter);

		const pathsQuery = db
			.select({
				path: archivedEmails.path,
				count: sql<number>`count(*)::int`,
			})
			.from(archivedEmails)
			.where(where)
			.groupBy(archivedEmails.path);

		const paths = await pathsQuery;

		// Build folder tree
		const folderMap = new Map<string, EmailFolder>();
		const rootFolders: EmailFolder[] = [];

		// Add root folder for emails without path
		const nullPathFolder = paths.find((p) => p.path === null);
		if (nullPathFolder) {
			rootFolders.push({
				path: '',
				name: 'Inbox',
				count: nullPathFolder.count,
				children: [],
			});
		}

		// Process all paths
		paths.forEach(({ path, count }) => {
			if (!path) return;

			const parts = path.split('/').filter(Boolean);
			let currentPath = '';

			parts.forEach((part, index) => {
				const parentPath = currentPath;
				currentPath = currentPath ? `${currentPath}/${part}` : part;

				if (!folderMap.has(currentPath)) {
					const folder: EmailFolder = {
						path: currentPath,
						name: part,
						count: index === parts.length - 1 ? count : 0,
						children: [],
					};

					folderMap.set(currentPath, folder);

					if (parentPath) {
						const parent = folderMap.get(parentPath);
						if (parent) {
							parent.children.push(folder);
						}
					} else {
						rootFolders.push(folder);
					}
				}
			});
		});

		return rootFolders;
	}

	public static async getArchivedEmailById(
		emailId: string,
		userId: string
	): Promise<ArchivedEmail | null> {
		const email = await db.query.archivedEmails.findFirst({
			where: eq(archivedEmails.id, emailId),
			with: {
				ingestionSource: true,
			},
		});

		if (!email) {
			return null;
		}

		const authorizationService = new AuthorizationService();
		const canRead = await authorizationService.can(userId, 'read', 'archive', email);

		if (!canRead) {
			return null;
		}

		let threadEmails: ThreadEmail[] = [];

		if (email.threadId) {
			threadEmails = await db.query.archivedEmails.findMany({
				where: and(
					eq(archivedEmails.threadId, email.threadId),
					eq(archivedEmails.ingestionSourceId, email.ingestionSourceId)
				),
				orderBy: [asc(archivedEmails.sentAt)],
				columns: {
					id: true,
					subject: true,
					sentAt: true,
					senderEmail: true,
				},
			});
		}

		const storage = new StorageService();
		const rawStream = await storage.get(email.storagePath);
		const raw = await streamToBuffer(rawStream as Readable);

		const mappedEmail = {
			...email,
			recipients: this.mapRecipients(email.recipients),
			raw,
			thread: threadEmails,
			tags: (email.tags as string[] | null) || null,
			path: email.path || null,
		};

		if (email.hasAttachments) {
			const emailAttachmentsResult = await db
				.select({
					id: attachments.id,
					filename: attachments.filename,
					mimeType: attachments.mimeType,
					sizeBytes: attachments.sizeBytes,
					storagePath: attachments.storagePath,
				})
				.from(emailAttachments)
				.innerJoin(attachments, eq(emailAttachments.attachmentId, attachments.id))
				.where(eq(emailAttachments.emailId, emailId));

			// const attachmentsWithRaw = await Promise.all(
			//     emailAttachmentsResult.map(async (attachment) => {
			//         const rawStream = await storage.get(attachment.storagePath);
			//         const raw = await streamToBuffer(rawStream as Readable);
			//         return { ...attachment, raw };
			//     })
			// );

			return {
				...mappedEmail,
				attachments: emailAttachmentsResult,
			};
		}

		return mappedEmail;
	}

	public static async deleteArchivedEmail(emailId: string): Promise<void> {
		const [email] = await db
			.select()
			.from(archivedEmails)
			.where(eq(archivedEmails.id, emailId));

		if (!email) {
			throw new Error('Archived email not found');
		}

		const storage = new StorageService();

		// Load and handle attachments before deleting the email itself
		if (email.hasAttachments) {
			const emailAttachmentsResult = await db
				.select({
					attachmentId: attachments.id,
					storagePath: attachments.storagePath,
				})
				.from(emailAttachments)
				.innerJoin(attachments, eq(emailAttachments.attachmentId, attachments.id))
				.where(eq(emailAttachments.emailId, emailId));

			try {
				for (const attachment of emailAttachmentsResult) {
					const [refCount] = await db
						.select({ count: count(emailAttachments.emailId) })
						.from(emailAttachments)
						.where(eq(emailAttachments.attachmentId, attachment.attachmentId));

					if (refCount.count === 1) {
						await storage.delete(attachment.storagePath);
						await db
							.delete(emailAttachments)
							.where(
								and(
									eq(emailAttachments.emailId, emailId),
									eq(emailAttachments.attachmentId, attachment.attachmentId)
								)
							);
						await db
							.delete(attachments)
							.where(eq(attachments.id, attachment.attachmentId));
					} else {
						await db
							.delete(emailAttachments)
							.where(
								and(
									eq(emailAttachments.emailId, emailId),
									eq(emailAttachments.attachmentId, attachment.attachmentId)
								)
							);
					}
				}
			} catch {
				throw new Error('Failed to delete email attachments');
			}
		}

		// Delete the email file from storage
		await storage.delete(email.storagePath);

		const searchService = new SearchService();
		await searchService.deleteDocuments('emails', [emailId]);

		await db.delete(archivedEmails).where(eq(archivedEmails.id, emailId));
	}
}
