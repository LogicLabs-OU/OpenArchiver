import { randomUUID } from 'node:crypto';
import { AuthenticationResult, DeviceCodeRequest, PublicClientApplication } from '@azure/msal-node';

type DeviceCodeResponse = Parameters<DeviceCodeRequest['deviceCodeCallback']>[0];

const SCOPES = ['https://outlook.office.com/IMAP.AccessAsUser.All', 'offline_access'];
const FLOW_TTL_MS = 15 * 60 * 1000;

type DeviceFlow = {
	userId: string;
	sourceId?: string;
	client: PublicClientApplication;
	createdAt: number;
	result?: AuthenticationResult;
	error?: string;
};

/**
 * Keeps short-lived device-code requests in memory until the browser finishes authentication.
 * Completed MSAL cache data is returned to the UI and encrypted with the ingestion credentials.
 */
export class MicrosoftImapDeviceAuthService {
	private static flows = new Map<string, DeviceFlow>();

	static async start(clientId: string, userId: string, sourceId?: string) {
		this.removeExpiredFlows();
		if (!clientId?.trim()) throw new Error('A Microsoft application client ID is required.');

		const client = new PublicClientApplication({
			auth: {
				clientId: clientId.trim(),
				authority: 'https://login.microsoftonline.com/common',
			},
		});
		const flowId = randomUUID();
		let provideDeviceCode!: (response: DeviceCodeResponse) => void;
		let rejectDeviceCode!: (error: unknown) => void;
		const deviceCode = new Promise<DeviceCodeResponse>((resolve, reject) => {
			provideDeviceCode = resolve;
			rejectDeviceCode = reject;
		});
		const flow: DeviceFlow = { userId, sourceId, client, createdAt: Date.now() };
		this.flows.set(flowId, flow);

		void client
			.acquireTokenByDeviceCode({ scopes: SCOPES, deviceCodeCallback: provideDeviceCode })
			.then((result) => {
				if (!result) throw new Error('Microsoft did not return an authentication result.');
				flow.result = result;
			})
			.catch((error: unknown) => {
				flow.error = error instanceof Error ? error.message : String(error);
				rejectDeviceCode(error);
			});

		let response: DeviceCodeResponse;
		try {
			response = await deviceCode;
		} catch (error) {
			this.flows.delete(flowId);
			throw error;
		}
		return {
			flowId,
			userCode: response.userCode,
			verificationUri: response.verificationUri,
			message: response.message,
			expiresIn: response.expiresIn,
		};
	}

	static poll(flowId: string, userId: string) {
		this.removeExpiredFlows();
		const flow = this.flows.get(flowId);
		if (!flow || flow.userId !== userId)
			throw new Error('Device authentication flow not found.');
		if (flow.error) {
			this.flows.delete(flowId);
			return { status: 'error' as const, message: flow.error };
		}
		if (!flow.result) return { status: 'pending' as const };

		const result = flow.result;
		this.flows.delete(flowId);
		return {
			status: 'complete' as const,
			sourceId: flow.sourceId,
			tokenCache: flow.client.getTokenCache().serialize(),
			homeAccountId: result.account?.homeAccountId,
			username: result.account?.username,
		};
	}

	private static removeExpiredFlows() {
		const cutoff = Date.now() - FLOW_TTL_MS;
		for (const [id, flow] of this.flows) {
			if (flow.createdAt < cutoff) this.flows.delete(id);
		}
	}
}
