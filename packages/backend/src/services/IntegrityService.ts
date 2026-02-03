import { db } from '../database';
import { archivedEmails, emailAttachments } from '../database/schema';
import { eq } from 'drizzle-orm';
import { StorageService } from './StorageService';
import { createHash } from 'crypto';
import { logger } from '../config/logger';
import type { IntegrityCheckResult } from '@open-archiver/types';
import { streamToBuffer } from '../helpers/streamToBuffer';

export class IntegrityService {
	private storageService = new StorageService();

	public async checkEmailIntegrity(emailId: string): Promise<IntegrityCheckResult[]> {
		const results: IntegrityCheckResult[] = [];

		// 1. Fetch the archived email
		const email = await db.query.archivedEmails.findFirst({
			where: eq(archivedEmails.id, emailId),
		});

		if (!email) {
			throw new Error('Archived email not found');
		}

		// 2. Check the email's integrity
		const emailStream = await this.storageService.get(email.storagePath);
		const emailBuffer = await streamToBuffer(emailStream);
		const currentEmailHash = createHash('sha256').update(emailBuffer).digest('hex');

		if (currentEmailHash === email.storageHashSha256) {
			results.push({ type: 'email', id: email.id, isValid: true });
		} else {
			results.push({
				type: 'email',
				id: email.id,
				isValid: false,
				reason: 'Stored hash does not match current hash.',
			});
		}

		// 3. If the email has attachments, check them
		if (email.hasAttachments) {
			const emailAttachmentsRelations = await db.query.emailAttachments.findMany({
				where: eq(emailAttachments.emailId, emailId),
				with: {
					attachment: true,
				},
			});

			for (const relation of emailAttachmentsRelations) {
				const attachment = relation.attachment;
				try {
					const attachmentStream = await this.storageService.get(attachment.storagePath);
					const attachmentBuffer = await streamToBuffer(attachmentStream);
					const currentAttachmentHash = createHash('sha256')
						.update(attachmentBuffer)
						.digest('hex');

					if (currentAttachmentHash === attachment.contentHashSha256) {
						results.push({
							type: 'attachment',
							id: attachment.id,
							filename: attachment.filename,
							isValid: true,
						});
					} else {
						results.push({
							type: 'attachment',
							id: attachment.id,
							filename: attachment.filename,
							isValid: false,
							reason: 'Stored hash does not match current hash.',
						});
					}
				} catch (error) {
					logger.error(
						{ attachmentId: attachment.id, error },
						'Failed to read attachment from storage for integrity check.'
					);
					results.push({
						type: 'attachment',
						id: attachment.id,
						filename: attachment.filename,
						isValid: false,
						reason: 'Could not read attachment file from storage.',
					});
				}
			}
		}

		return results;
	}
}
