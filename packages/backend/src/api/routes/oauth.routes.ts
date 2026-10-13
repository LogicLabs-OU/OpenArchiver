import { Router } from 'express';
import { OAuthController } from '../controllers/oauth.controller';

/**
 * The one route in this module is deliberately public (no requireAuth): the browser lands
 * here straight from the identity provider with no JWT attached. The HMAC-signed `state`
 * parameter — bound to one source, one nonce, one ten-minute window — is what authorizes
 * the request, and the global rate limiter in server.ts still applies.
 */
export const createOAuthRouter = (oauthController: OAuthController): Router => {
	const router = Router();

	/**
	 * @openapi
	 * /v1/oauth/callback:
	 *   get:
	 *     summary: OAuth authorization callback
	 *     description: The browser return leg of an OAuth Mailbox authorization (authorization code flow). The identity provider redirects the administrator's browser here with a code and the signed state issued when the authorization started. On success the granted tokens are stored, the source moves to auth_success and its initial import starts; the response is an HTML page that returns the browser to the ingestion sources list. This endpoint is unauthenticated — the signed, single-use state is the credential — and it never exposes tokens.
	 *     operationId: oauthMailboxCallback
	 *     tags:
	 *       - Ingestion
	 *     security: []
	 *     parameters:
	 *       - name: state
	 *         in: query
	 *         required: true
	 *         schema:
	 *           type: string
	 *       - name: code
	 *         in: query
	 *         required: false
	 *         schema:
	 *           type: string
	 *       - name: error
	 *         in: query
	 *         required: false
	 *         description: Set by the provider when the user declined consent.
	 *         schema:
	 *           type: string
	 *     responses:
	 *       '200':
	 *         description: HTML page that redirects the browser back to the ingestion sources list, with the outcome in the query string.
	 *         content:
	 *           text/html:
	 *             schema:
	 *               type: string
	 *       '400':
	 *         description: The state was missing, forged, expired, or already used.
	 */
	router.get('/callback', oauthController.callback);

	return router;
};
