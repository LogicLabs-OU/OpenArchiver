import { Request, Response } from 'express';
import type { OAuthMailboxFlow } from '@open-archiver/types';
import { OAuthMailboxService } from '../../services/oauth/OAuthMailboxService';
import { IngestionService } from '../../services/IngestionService';
import { UserService } from '../../services/UserService';
import { AuditService } from '../../services/AuditService';
import { logger } from '../../config/logger';
import { config } from '../../config';

/**
 * HTTP layer of the oauth_mailbox authorization flows. Two of these endpoints sit behind
 * the normal auth middleware; the callback does not — the browser arrives there from the
 * identity provider carrying no JWT, and the HMAC-signed state is what authenticates the
 * request to exactly one in-flight authorization.
 *
 * Nothing secret may leave through these responses: no tokens, no device_code, no PKCE
 * verifier, no client secret.
 */
export class OAuthController {
	private userService = new UserService();
	private auditService = new AuditService();

	/** Starts (or restarts) an authorization for a source. Serves create-time and Re-authorize. */
	public authorize = async (req: Request, res: Response): Promise<Response> => {
		try {
			const { id } = req.params;
			const userId = req.user?.sub;
			if (!userId) {
				return res.status(401).json({ message: req.t('errors.unauthorized') });
			}
			const actor = await this.userService.findById(userId);
			if (!actor) {
				return res.status(401).json({ message: req.t('errors.unauthorized') });
			}

			const source = await IngestionService.findById(id);
			if (source.provider !== 'oauth_mailbox') {
				return res.status(400).json({ message: req.t('ingestion.oauthNotOAuthSource') });
			}

			const flowOverride: OAuthMailboxFlow | undefined =
				req.body?.flow === 'auth_code' || req.body?.flow === 'device_code'
					? req.body.flow
					: undefined;

			const result = await OAuthMailboxService.startAuthorization(id, flowOverride);

			await this.auditService.createAuditLog({
				actorIdentifier: actor.id,
				actionType: 'UPDATE',
				targetType: 'IngestionSource',
				targetId: id,
				actorIp: req.ip || 'unknown',
				details: { action: 'oauth_authorize_started', flow: result.flow },
			});

			return res.status(200).json(result);
		} catch (error) {
			logger.error({ err: error, sourceId: req.params.id }, 'OAuth authorize error');
			if (error instanceof Error && error.message === 'Ingestion source not found') {
				return res.status(404).json({ message: req.t('ingestion.notFound') });
			}
			return res.status(500).json({
				message:
					error instanceof Error && error.message
						? error.message
						: req.t('ingestion.oauthAuthorizeFailed'),
			});
		}
	};

	/** One step of the device-code poll loop; the browser drives the cadence. */
	public poll = async (req: Request, res: Response): Promise<Response> => {
		try {
			const { id } = req.params;
			const source = await IngestionService.findById(id);
			if (source.provider !== 'oauth_mailbox') {
				return res.status(400).json({ message: req.t('ingestion.oauthNotOAuthSource') });
			}
			const result = await OAuthMailboxService.pollDeviceFlow(id);
			return res.status(200).json(result);
		} catch (error) {
			logger.error({ err: error, sourceId: req.params.id }, 'OAuth poll error');
			if (error instanceof Error && error.message === 'Ingestion source not found') {
				return res.status(404).json({ message: req.t('ingestion.notFound') });
			}
			return res.status(500).json({ message: req.t('ingestion.oauthPollFailed') });
		}
	};

	/**
	 * The browser return leg of the auth_code flow. Public route: the signed state is the
	 * credential. Answers 200 with a self-redirecting HTML page rather than a 302 because
	 * the SvelteKit proxy in front of this API follows redirects itself, which would leave
	 * the browser parked on the callback URL rendering the wrong document.
	 */
	public callback = async (req: Request, res: Response): Promise<Response> => {
		const { state, code, error, error_description } = req.query as Record<
			string,
			string | undefined
		>;

		let result: { ok: boolean; sourceId?: string; message?: string };
		try {
			result = await OAuthMailboxService.handleCallback(
				state ?? '',
				code,
				error,
				error_description
			);
		} catch (err) {
			logger.error({ err }, 'OAuth callback error');
			result = { ok: false };
		}

		// A callback that never matched a real in-flight authorization gets a plain 400
		// with nothing to learn from; no redirect, no detail, no writes happened.
		if (!result.sourceId) {
			return res.status(400).send('Invalid authorization callback.');
		}

		// Row owner as actor: there is no authenticated user on this route.
		try {
			const source = await IngestionService.findRowById(result.sourceId);
			await this.auditService.createAuditLog({
				actorIdentifier: source?.userId ?? 'system',
				actionType: 'UPDATE',
				targetType: 'IngestionSource',
				targetId: result.sourceId,
				actorIp: req.ip || 'unknown',
				details: { action: 'oauth_callback', ok: result.ok },
			});
		} catch (err) {
			logger.warn({ err }, 'Failed to write oauth callback audit log');
		}

		// The redirect target is derived from configuration alone — never from request
		// input — so this page cannot be turned into an open redirector.
		const target = `${config.app.publicUrl}/dashboard/ingestions?oauth_result=${
			result.ok ? 'success' : 'error'
		}&source=${encodeURIComponent(result.sourceId)}`;

		return res
			.status(200)
			.type('html')
			.send(
				`<!doctype html><html><head><meta charset="utf-8"><title>Open Archiver</title></head>` +
					`<body><p>Returning to Open Archiver…</p>` +
					`<script>window.location.replace(${JSON.stringify(target)});</script>` +
					`<noscript><a href="${target.replace(/"/g, '&quot;')}">Continue</a></noscript>` +
					`</body></html>`
			);
	};
}
