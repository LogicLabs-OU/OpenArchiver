import type { Request, Response } from 'express';
import { z } from 'zod';
import { and, asc, count, eq, ilike, inArray, or } from 'drizzle-orm';
import { db } from '../../database';
import { mailboxes } from '../../database/schema/mailboxes';
import { AuditService } from '../../services/AuditService';
import type { MailboxKind } from '@open-archiver/types';
import { seatAccountingService } from '../../services/seats/SeatAccountingService';
import { seatPolicyService } from '../../services/seats/SeatPolicyService';
import { DEFAULT_ROLE_LOCAL_PARTS } from '../../services/seats/roleLocalParts';
import { deriveProviderKind } from '../../services/seats/seatRules';
import { normalizeEmailAddress } from '../../helpers/emailAddress';

const auditService = new AuditService();

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 200;

/**
 * How old the stored report may be before a page load that asks for it triggers a fresh scan.
 * Long enough that browsing the Seats page does not rescan the archive on every click; short
 * enough that someone watching an import sees the numbers move.
 */
const REPORT_STALE_AFTER_MS = 10 * 60 * 1000;

/** Matches the journaling module's domain validation, so one organization has one idea of a domain. */
const domainName = z
	.string()
	.trim()
	.toLowerCase()
	.regex(
		/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/,
		'Must be a valid domain name (e.g. example.com).'
	);

/**
 * Unlike the journaling setting, a group here must have at least one alias: a primary domain on
 * its own merges nothing, so saving it would only look like configuration.
 */
const organizationDomainGroup = z.object({
	main: domainName,
	aliases: z.array(domainName).min(1, 'At least one alias domain is required.').max(50),
});

const UpdatePolicySchema = z.object({
	organizationDomainGroups: z.array(organizationDomainGroup).max(100).optional(),
	additionalRoleLocalParts: z
		.array(
			z
				.string()
				.trim()
				.toLowerCase()
				// No wildcards: the whole point of exact matching is that `support2@` is not
				// swept up by a rule aimed at `support@`.
				.regex(/^[a-z0-9._+-]{1,64}$/, 'Must be a plain mailbox name, without wildcards.')
		)
		.max(200)
		.optional(),
});

const ClassificationSchema = z.object({
	/** `null` withdraws the declaration and lets the ordinary rules decide again. */
	kind: z.enum(['shared', 'user']).nullable(),
	reason: z.string().trim().max(500).optional(),
});

/**
 * The target may be named by id or by address, so the page can link to a mailbox that is not on
 * the rows it currently shows. Both absent, or `null`, unlinks.
 */
const IdentityLinkSchema = z.object({
	targetMailboxId: z.string().uuid().nullable().optional(),
	targetAddress: z.string().trim().min(1).max(320).nullable().optional(),
	reason: z.string().trim().max(500).optional(),
});

/** The seat summary, plus the policy in force. */
export const getReport = async (req: Request, res: Response): Promise<Response> => {
	try {
		// `reconcileStale` is what the Seats page sends: a row the directory listed shows zero
		// emails until the archive has been scanned, so the page asks for a scan when the stored
		// report is missing or old rather than making the administrator press Recount.
		const reconcileStale = String(req.query.reconcileStale ?? '') === 'true';
		const [report, policy] = await Promise.all([
			reconcileStale
				? seatAccountingService.reconcileIfStale(REPORT_STALE_AFTER_MS)
				: seatAccountingService.getStoredReport(),
			seatPolicyService.getPolicy(),
		]);

		return res.json({
			report,
			policy,
			defaultRoleLocalParts: DEFAULT_ROLE_LOCAL_PARTS,
		});
	} catch (error) {
		console.error('getSeatReport error:', error);
		return res.status(500).json({ message: req.t('errors.internalServerError') });
	}
};

/** Recomputes everything from the archive. Explicit, because it scans `archived_emails`. */
export const reconcile = async (req: Request, res: Response): Promise<Response> => {
	try {
		const { report } = await seatAccountingService.reconcile();
		return res.json({ report });
	} catch (error) {
		console.error('reconcileSeats error:', error);
		return res.status(500).json({ message: req.t('errors.internalServerError') });
	}
};

export const listMailboxes = async (req: Request, res: Response): Promise<Response> => {
	try {
		const page = Math.max(parseInt(String(req.query.page ?? '1'), 10) || 1, 1);
		const pageSizeRaw = parseInt(String(req.query.pageSize ?? DEFAULT_PAGE_SIZE), 10);
		const pageSize = Math.min(
			Math.max(Number.isFinite(pageSizeRaw) ? pageSizeRaw : DEFAULT_PAGE_SIZE, 1),
			MAX_PAGE_SIZE
		);

		const filters = [];
		const kind = String(req.query.kind ?? '');
		if (['user', 'shared', 'room', 'equipment', 'unknown'].includes(kind)) {
			filters.push(eq(mailboxes.kind, kind as MailboxKind));
		}
		const evidence = String(req.query.evidence ?? '');
		if (['provider', 'pattern', 'admin', 'none'].includes(evidence)) {
			filters.push(eq(mailboxes.kindEvidence, evidence as 'provider'));
		}
		const sourceId = String(req.query.sourceId ?? '');
		if (/^[0-9a-f-]{36}$/i.test(sourceId)) {
			filters.push(eq(mailboxes.rootSourceId, sourceId));
		}
		const active = String(req.query.active ?? '');
		if (active === 'true' || active === 'false') {
			filters.push(eq(mailboxes.active, active === 'true'));
		}
		const search = String(req.query.search ?? '').trim();
		if (search) {
			filters.push(
				or(
					ilike(mailboxes.address, `%${search}%`),
					ilike(mailboxes.displayName, `%${search}%`)
				)!
			);
		}
		const where = filters.length > 0 ? and(...filters) : undefined;

		const [rows, [{ total }]] = await Promise.all([
			db
				.select()
				.from(mailboxes)
				.where(where)
				.orderBy(asc(mailboxes.address))
				.limit(pageSize)
				.offset((page - 1) * pageSize),
			db.select({ total: count() }).from(mailboxes).where(where),
		]);

		// How many mailboxes share each identity on this page, so the UI can show that a row is
		// one of several addresses belonging to one person.
		const identityKeys = [...new Set(rows.map((row) => row.identityKey))];
		const groupSizes = new Map<string, number>();
		if (identityKeys.length > 0) {
			const sizes = await db
				.select({ identityKey: mailboxes.identityKey, size: count() })
				.from(mailboxes)
				.where(inArray(mailboxes.identityKey, identityKeys))
				.groupBy(mailboxes.identityKey);
			for (const entry of sizes) {
				groupSizes.set(entry.identityKey, entry.size);
			}
		}

		return res.json({
			mailboxes: rows.map((row) => ({
				...row,
				identityGroupSize: groupSizes.get(row.identityKey) ?? 1,
			})),
			total,
			page,
			pageSize,
		});
	} catch (error) {
		console.error('listSeatMailboxes error:', error);
		return res.status(500).json({ message: req.t('errors.internalServerError') });
	}
};

/**
 * Records what an administrator says one mailbox is.
 *
 * Declaring a mailbox a *person* is always accepted — it can only raise the bill. Declaring one
 * *shared* is refused wherever the directory has already answered, because that direction lowers
 * the bill and the provider's answer is the better evidence. "Answered" includes the implied
 * answer: a licensed account is a person somebody is paying for, and a declaration against it
 * would be recorded and reported without ever changing the count.
 */
export const updateClassification = async (req: Request, res: Response): Promise<Response> => {
	try {
		const actorId = req.user?.sub;
		if (!actorId) {
			return res.status(401).json({ message: req.t('errors.unauthorized') });
		}

		const parsed = ClassificationSchema.safeParse(req.body);
		if (!parsed.success) {
			return res.status(422).json({
				message: req.t('seats.invalidClassification'),
				errors: parsed.error.flatten(),
			});
		}

		const mailbox = await seatAccountingService.findMailboxById(req.params.id);
		if (!mailbox) {
			return res.status(404).json({ message: req.t('seats.mailboxNotFound') });
		}
		if (mailbox.isSentinel) {
			return res.status(422).json({ message: req.t('seats.sentinelNotAMailbox') });
		}
		if (parsed.data.kind === 'shared') {
			if (mailbox.providerKind) {
				return res.status(422).json({
					message: req.t('seats.providerClassified', { kind: mailbox.providerKind }),
				});
			}
			if (deriveProviderKind(mailbox) === 'user') {
				return res.status(422).json({ message: req.t('seats.licensedUser') });
			}
		}

		const now = new Date();
		await db
			.update(mailboxes)
			.set({
				adminKind: parsed.data.kind,
				adminDeclaredBy: parsed.data.kind ? actorId : null,
				adminDeclaredAt: parsed.data.kind ? now : null,
				adminDeclaredReason: parsed.data.kind ? (parsed.data.reason ?? null) : null,
				updatedAt: now,
			})
			.where(eq(mailboxes.id, mailbox.id));

		await auditService.createAuditLog({
			actorIdentifier: actorId,
			actionType: 'SEAT_CLASSIFICATION_UPDATED',
			targetType: 'Mailbox',
			targetId: mailbox.id,
			actorIp: req.ip ?? 'unknown',
			details: {
				address: mailbox.address,
				previousKind: mailbox.adminKind,
				newKind: parsed.data.kind,
				providerKind: mailbox.providerKind,
				reason: parsed.data.reason ?? null,
			},
		});

		const { report } = await seatAccountingService.recomputeIdentities();
		return res.json({ report });
	} catch (error) {
		console.error('updateSeatClassification error:', error);
		return res.status(500).json({ message: req.t('errors.internalServerError') });
	}
};

/**
 * Links one mailbox to another as the same person, or unlinks it.
 *
 * Refused when it would put two accounts of one directory together: a directory that issued two
 * objects is stating they are two people, and no local declaration outranks that.
 */
export const updateIdentityLink = async (req: Request, res: Response): Promise<Response> => {
	try {
		const actorId = req.user?.sub;
		if (!actorId) {
			return res.status(401).json({ message: req.t('errors.unauthorized') });
		}

		const parsed = IdentityLinkSchema.safeParse(req.body);
		if (!parsed.success) {
			return res
				.status(422)
				.json({ message: req.t('seats.invalidLink'), errors: parsed.error.flatten() });
		}

		const mailbox = await seatAccountingService.findMailboxById(req.params.id);
		if (!mailbox) {
			return res.status(404).json({ message: req.t('seats.mailboxNotFound') });
		}
		if (mailbox.isSentinel) {
			return res.status(422).json({ message: req.t('seats.sentinelCannotLink') });
		}

		const { targetMailboxId, targetAddress } = parsed.data;
		const linking = typeof targetMailboxId === 'string' || typeof targetAddress === 'string';
		let targetId: string | null = null;

		if (linking) {
			const target =
				typeof targetMailboxId === 'string'
					? await seatAccountingService.findMailboxById(targetMailboxId)
					: await seatAccountingService.findMailboxByAddress(
							normalizeEmailAddress(targetAddress as string)
						);
			if (!target) {
				return res.status(404).json({ message: req.t('seats.targetNotFound') });
			}
			if (target.id === mailbox.id) {
				return res.status(422).json({ message: req.t('seats.selfLink') });
			}
			if (target.isSentinel) {
				return res.status(422).json({ message: req.t('seats.sentinelCannotBeTarget') });
			}
			if (target.linkedToMailboxId) {
				return res.status(422).json({ message: req.t('seats.targetAlreadyLinked') });
			}
			if (
				mailbox.providerObjectId &&
				target.providerObjectId &&
				mailbox.providerObjectId !== target.providerObjectId &&
				mailbox.rootSourceId &&
				mailbox.rootSourceId === target.rootSourceId
			) {
				return res.status(422).json({ message: req.t('seats.sameDirectory') });
			}
			targetId = target.id;
		}

		const now = new Date();
		await db
			.update(mailboxes)
			.set({
				linkedToMailboxId: targetId,
				linkedBy: targetId ? actorId : null,
				linkedAt: targetId ? now : null,
				linkReason: targetId ? (parsed.data.reason ?? null) : null,
				updatedAt: now,
			})
			.where(eq(mailboxes.id, mailbox.id));

		await auditService.createAuditLog({
			actorIdentifier: actorId,
			actionType: 'SEAT_IDENTITY_LINK_UPDATED',
			targetType: 'Mailbox',
			targetId: mailbox.id,
			actorIp: req.ip ?? 'unknown',
			details: {
				address: mailbox.address,
				linkedTo: targetId,
				previousLinkedTo: mailbox.linkedToMailboxId,
				reason: parsed.data.reason ?? null,
			},
		});

		const { report } = await seatAccountingService.recomputeIdentities();
		return res.json({ report });
	} catch (error) {
		console.error('updateSeatIdentityLink error:', error);
		return res.status(500).json({ message: req.t('errors.internalServerError') });
	}
};

export const getPolicy = async (req: Request, res: Response): Promise<Response> => {
	try {
		const policy = await seatPolicyService.getPolicy();
		return res.json({ policy, defaultRoleLocalParts: DEFAULT_ROLE_LOCAL_PARTS });
	} catch (error) {
		console.error('getSeatPolicy error:', error);
		return res.status(500).json({ message: req.t('errors.internalServerError') });
	}
};

export const updatePolicy = async (req: Request, res: Response): Promise<Response> => {
	try {
		const actorId = req.user?.sub;
		if (!actorId) {
			return res.status(401).json({ message: req.t('errors.unauthorized') });
		}

		const parsed = UpdatePolicySchema.safeParse(req.body);
		if (!parsed.success) {
			// The one validation failure a form is likely to produce gets its own sentence; the
			// rest are reported field by field.
			const aliasesMissing = parsed.error.issues.some(
				(issue) => issue.code === 'too_small' && issue.path.includes('aliases')
			);
			return res.status(422).json({
				message: req.t(aliasesMissing ? 'seats.aliasesRequired' : 'seats.invalidPolicy'),
				errors: parsed.error.flatten(),
			});
		}

		const before = await seatPolicyService.getPolicy();
		const updated = await seatPolicyService.updatePolicy(parsed.data);

		const beforeParts = new Set(before.additionalRoleLocalParts ?? []);
		const afterParts = new Set(updated.additionalRoleLocalParts ?? []);

		await auditService.createAuditLog({
			actorIdentifier: actorId,
			actionType: 'SEAT_POLICY_UPDATED',
			targetType: 'SeatPolicy',
			targetId: 'seat_policy',
			actorIp: req.ip ?? 'unknown',
			details: {
				groupsBefore: before.organizationDomainGroups,
				groupsAfter: updated.organizationDomainGroups,
				addedLocalParts: [...afterParts].filter((part) => !beforeParts.has(part)),
				removedLocalParts: [...beforeParts].filter((part) => !afterParts.has(part)),
			},
		});

		const { report } = await seatAccountingService.recomputeIdentities();
		return res.json({ policy: updated, report });
	} catch (error) {
		console.error('updateSeatPolicy error:', error);
		return res.status(500).json({ message: req.t('errors.internalServerError') });
	}
};
