import type { IngestionCredentials, IngestionProvider } from '@open-archiver/types';

/**
 * Merge rules for editing a non-OAuth ingestion source's credentials.
 *
 * The edit dialog can never show what is stored (SafeIngestionSource strips credentials), so
 * what arrives from it is whatever the admin typed into a blank form — usually nothing. Until
 * this helper existed, IngestionService.update stored that blank object wholesale, and a
 * rename-only edit destroyed a working source's secrets: one production Microsoft 365 source
 * was left holding `{type, secure, allowInsecureCert}` — no client id, no tenant, no secret,
 * plus two IMAP form defaults that leaked in from the dialog's initial state.
 *
 * The rules mirror mergeOAuthCredentials, which already protects oauth_mailbox:
 *
 * - Only the provider's own fields are read from the incoming config; stray keys from other
 *   providers' form sections are dropped, never stored.
 * - An incoming field that is undefined or '' keeps the stored value. Blank means "the form
 *   could not show it", never "erase it". `false` and `0` are real values and pass through.
 * - Changing the provider type replaces the credentials outright, but only when the incoming
 *   config is complete for the new provider — a half-filled provider switch is exactly what
 *   produced the destroyed source above.
 */

/** Every field a provider's credentials may carry. Anything else from the client is dropped. */
const PROVIDER_FIELDS: Partial<Record<IngestionProvider, readonly string[]>> = {
	generic_imap: ['host', 'port', 'secure', 'allowInsecureCert', 'username', 'password'],
	microsoft_365: ['clientId', 'clientSecret', 'tenantId'],
	google_workspace: ['serviceAccountKeyJson', 'impersonatedAdminEmail'],
	pst_import: ['uploadedFileName', 'uploadedFilePath', 'localFilePath'],
	eml_import: ['uploadedFileName', 'uploadedFilePath', 'localFilePath'],
	mbox_import: ['uploadedFileName', 'uploadedFilePath', 'localFilePath'],
};

/** The fields that must be non-empty after the merge for the source to be able to connect. */
const REQUIRED_FIELDS: Partial<Record<IngestionProvider, readonly string[]>> = {
	generic_imap: ['host', 'username', 'password'],
	microsoft_365: ['clientId', 'clientSecret', 'tenantId'],
	google_workspace: ['serviceAccountKeyJson', 'impersonatedAdminEmail'],
};

const isBlank = (value: unknown): boolean => value === undefined || value === '';

const missingFields = (config: Record<string, any>, provider: IngestionProvider): string[] =>
	(REQUIRED_FIELDS[provider] ?? []).filter((field) => isBlank(config[field]));

export type CredentialMergeResult =
	| { ok: true; merged: Record<string, any> }
	| { ok: false; message: string };

/**
 * Produces the credentials an edit should store, or the reason it must be refused.
 *
 * `oauth_mailbox` never reaches here — IngestionService.update routes it to
 * mergeOAuthCredentials first — and a provider this table does not know keeps the historical
 * replace-wholesale behavior rather than guessing at its field semantics.
 */
export const mergeProviderCredentials = (
	original: IngestionCredentials,
	incoming: Record<string, any>
): CredentialMergeResult => {
	const incomingType: IngestionProvider =
		typeof incoming.type === 'string' && incoming.type !== ''
			? (incoming.type as IngestionProvider)
			: original.type;

	const fields = PROVIDER_FIELDS[incomingType];
	if (!fields) {
		return { ok: true, merged: { ...incoming, type: incomingType } };
	}

	if (incomingType !== original.type) {
		// A provider switch may not inherit anything: the old fields mean nothing to the new
		// connector, so the incoming config must stand entirely on its own.
		const replaced: Record<string, any> = { type: incomingType };
		for (const field of fields) {
			if (!isBlank(incoming[field])) {
				replaced[field] = incoming[field];
			}
		}
		const missing = missingFields(replaced, incomingType);
		if (missing.length > 0) {
			return {
				ok: false,
				message:
					`Changing the provider requires complete connection settings. ` +
					`Missing: ${missing.join(', ')}`,
			};
		}
		return { ok: true, merged: replaced };
	}

	const merged: Record<string, any> = { type: incomingType };
	for (const field of fields) {
		const value = isBlank(incoming[field])
			? (original as Record<string, any>)[field]
			: incoming[field];
		if (value !== undefined) {
			merged[field] = value;
		}
	}
	const missing = missingFields(merged, incomingType);
	if (missing.length > 0) {
		return { ok: false, message: `Missing required connection fields: ${missing.join(', ')}` };
	}
	return { ok: true, merged };
};
