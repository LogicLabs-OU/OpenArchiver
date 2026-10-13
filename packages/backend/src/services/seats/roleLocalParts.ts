/**
 * Local parts that name a function rather than a person.
 *
 * A mailbox called `info@` or `noreply@` is a desk, a form target or an autoresponder: emails
 * accumulate there, but no employee sits behind it, so billing a seat for it charges for
 * nobody. The list opens with RFC 2142, which standardises exactly this idea — addresses an
 * organization is expected to operate irrespective of who works there — and continues with the
 * role names that have become conventional since.
 *
 * Matching is on the whole local part and nothing less. `support2@` and `sales.jane@` are
 * ordinary mailboxes that happen to begin with a role word, and a prefix or substring rule would
 * quietly stop billing for them — which is precisely the abuse this feature has to avoid while
 * solving the customer's problem.
 *
 * Nothing here can be removed by configuration. A real person who owns `info@` is
 * handled the other way round, by declaring that one mailbox a user, which is recorded and
 * reported. Removing a default wholesale would be indistinguishable from evasion.
 */
export const DEFAULT_ROLE_LOCAL_PARTS: readonly string[] = [
	// RFC 2142 — business and network operations
	'postmaster',
	'hostmaster',
	'webmaster',
	'abuse',
	'noc',
	'security',
	'usenet',
	'news',
	'uucp',
	'ftp',
	'sales',
	'marketing',
	'support',
	'info',
	// Conventional role addresses
	'contact',
	'noreply',
	'no-reply',
	'no_reply',
	'donotreply',
	'do-not-reply',
	'admin',
	'billing',
	'hr',
	'jobs',
	'careers',
	'newsletter',
	'notifications',
	'alerts',
	'helpdesk',
	'service',
	'office',
	'hello',
	'mailer-daemon',
	'team',
];

/**
 * The role names in force: the built-in list plus whatever an administrator added.
 *
 * Returned as a Set because the caller tests one local part per mailbox against it, for every
 * mailbox, on every reconciliation.
 */
export const effectiveRoleLocalParts = (additional: readonly string[] = []): Set<string> => {
	const set = new Set(DEFAULT_ROLE_LOCAL_PARTS);
	for (const entry of additional) {
		const normalized = entry.trim().toLowerCase();
		if (normalized) {
			set.add(normalized);
		}
	}
	return set;
};
