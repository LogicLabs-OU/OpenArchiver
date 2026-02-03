import { count, desc, eq, asc, and } from 'drizzle-orm';
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
} from '@open-archiver/types';
import { StorageService } from './StorageService';
import { SearchService } from './SearchService';
import type { Readable } from 'stream';
import { AuditService } from './AuditService';
import { User } from '@open-archiver/types';
import { checkDeletionEnabled } from '../helpers/deletionGuard';

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
	private static auditService = new AuditService();
	private static mapRecipients(dbRecipients: unknown): Recipient[] {
		const { to = [], cc = [], bcc = [] } = dbRecipients as DbRecipients;

		const allRecipients = [...to, ...cc, ...bcc];

		return allRecipients.map((r) => ({
			name: r.name,
			email: r.address,
		}));
	}

	public static async getArchivedEmails(
		ingestionSourceId: string,
		page: number,
		limit: number,
		userId: string
	): Promise<PaginatedArchivedEmails> {
		const offset = (page - 1) * limit;
		const { drizzleFilter } = await FilterBuilder.create(userId, 'archive', 'read');
		const where = and(eq(archivedEmails.ingestionSourceId, ingestionSourceId), drizzleFilter);

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

		const itemsQuery = db
			.select()
			.from(archivedEmails)
			.leftJoin(ingestionSources, eq(archivedEmails.ingestionSourceId, ingestionSources.id))
			.orderBy(desc(archivedEmails.sentAt))
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

	public static async getArchivedEmailById(
		emailId: string,
		userId: string,
		actor: User,
		actorIp: string
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

		await this.auditService.createAuditLog({
			actorIdentifier: actor.id,
			actionType: 'READ',
			targetType: 'ArchivedEmail',
			targetId: emailId,
			actorIp,
			details: {},
		});

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

	public static async deleteArchivedEmail(
		emailId: string,
		actor: User,
		actorIp: string
	): Promise<void> {
		checkDeletionEnabled();
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
			const attachmentsForEmail = await db
				.select({
					attachmentId: attachments.id,
					storagePath: attachments.storagePath,
				})
				.from(emailAttachments)
				.innerJoin(attachments, eq(emailAttachments.attachmentId, attachments.id))
				.where(eq(emailAttachments.emailId, emailId));

			try {
				for (const attachment of attachmentsForEmail) {
					// Delete the link between this email and the attachment record.
					await db
						.delete(emailAttachments)
						.where(
							and(
								eq(emailAttachments.emailId, emailId),
								eq(emailAttachments.attachmentId, attachment.attachmentId)
							)
						);

					// Check if any other emails are linked to this attachment record.
					const [recordRefCount] = await db
						.select({ count: count() })
						.from(emailAttachments)
						.where(eq(emailAttachments.attachmentId, attachment.attachmentId));

					// If no other emails are linked to this record, it's safe to delete it and the file.
					if (recordRefCount.count === 0) {
						await storage.delete(attachment.storagePath);
						await db
							.delete(attachments)
							.where(eq(attachments.id, attachment.attachmentId));
					}
				}
			} catch (error) {
				console.error('Failed to delete email attachments', error);
				throw new Error('Failed to delete email attachments');
			}
		}

		// Delete the email file from storage
		await storage.delete(email.storagePath);

		const searchService = new SearchService();
		await searchService.deleteDocuments('emails', [emailId]);

		await db.delete(archivedEmails).where(eq(archivedEmails.id, emailId));

		await this.auditService.createAuditLog({
			actorIdentifier: actor.id,
			actionType: 'DELETE',
			targetType: 'ArchivedEmail',
			targetId: emailId,
			actorIp,
			details: {
				reason: 'ManualDeletion',
			},
		});
	}
}
