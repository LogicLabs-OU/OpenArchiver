<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Separator } from '$lib/components/ui/separator';
	import { api } from '$lib/api.client';
	import { authStore } from '$lib/stores/auth.store';
	import type { LoginResponse, PublicSsoConfig } from '@open-archiver/types';
	import { setAlert } from '$lib/components/custom/alert/alert-state.svelte';
	import { t } from '$lib/translations';

	interface Props {
		data: { publicSso: PublicSsoConfig | null };
	}

	let { data }: Props = $props();

	let email = $state('');
	let password = $state('');
	let isLoading = $state(false);
	let ssoLoadingId = $state<string | null>(null);

	const sso = $derived(data.publicSso);
	const hasSso = $derived(Boolean(sso?.enabled && sso.connections.length > 0));
	/**
	 * When SSO is required, the password form is hidden behind a link rather than
	 * removed. Super Admins are exempt from enforcement, and that link is how they
	 * get in when the identity provider is misconfigured.
	 */
	const ssoEnforced = $derived(Boolean(sso?.enforced));
	let showPasswordForm = $state(false);
	const passwordFormVisible = $derived(!ssoEnforced || showPasswordForm);

	// The callback page redirects here with a reason when an SSO login fails.
	$effect(() => {
		const ssoError = page.url.searchParams.get('ssoError');
		if (!ssoError) return;
		setAlert({
			type: 'error',
			title: $t('app.auth.sso_failed'),
			message: $t('app.auth.sso_failed_tip'),
			duration: 6000,
			show: true,
		});
	});

	async function startSso(connection: { id: string; protocol: string }) {
		ssoLoadingId = connection.id;
		try {
			const response = await api(
				`/enterprise/sso/${connection.protocol}/${connection.id}/start`,
				{ method: 'POST' }
			);
			if (!response.ok) {
				const { message } = await response.json().catch(() => ({ message: '' }));
				throw new Error(message || $t('app.auth.sso_failed_tip'));
			}
			const { authorizationUrl }: { authorizationUrl: string } = await response.json();
			// A full navigation, not a fetch: the user has to meet the identity
			// provider's own login page.
			window.location.assign(authorizationUrl);
		} catch (e: unknown) {
			ssoLoadingId = null;
			setAlert({
				type: 'error',
				title: $t('app.auth.sso_failed'),
				message: e instanceof Error ? e.message : String(e),
				duration: 5000,
				show: true,
			});
		}
	}

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		isLoading = true;
		try {
			const response = await api('/auth/login', {
				method: 'POST',
				body: JSON.stringify({ email, password }),
			});
			if (!response.ok) {
				let errorMessage = 'Failed to login';
				try {
					const errorData = await response.json();
					errorMessage = errorData.message || errorMessage;
				} catch {
					errorMessage = response.statusText;
				}
				throw new Error(errorMessage);
			}

			const loginData: LoginResponse | { requiresMfa: true; enrollmentRequired?: boolean } =
				await response.json();

			// MFA challenge: the mfaPendingToken is set as an httpOnly cookie by the server.
			// If enrollmentRequired is true, the user's grace period has expired and they must
			// enroll in TOTP before getting access — redirect to the forced enrollment page.
			if ('requiresMfa' in loginData && loginData.requiresMfa) {
				if ('enrollmentRequired' in loginData && loginData.enrollmentRequired) {
					goto('/signin/mfa/enroll');
				} else {
					goto('/signin/mfa');
				}
				return;
			}

			// Normal login: persist the full-access token and go to the dashboard.
			const fullLogin = loginData as LoginResponse;
			authStore.login(fullLogin.accessToken, fullLogin.user);
			goto('/dashboard');
		} catch (e: unknown) {
			setAlert({
				type: 'error',
				title: $t('app.auth.login_failed'),
				message: e instanceof Error ? e.message : String(e),
				duration: 5000,
				show: true,
			});
		} finally {
			isLoading = false;
		}
	}
</script>

<svelte:head>
	<title>{$t('app.auth.login')} - Open Archiver</title>
	<meta name="description" content="Login to your Open Archiver account." />
</svelte:head>

<div
	class="flex min-h-screen flex-col items-center justify-center space-y-16 bg-gray-100 dark:bg-gray-900"
>
	<div>
		<a
			href="https://openarchiver.com/"
			target="_blank"
			class="flex flex-row items-center gap-2 font-bold"
		>
			<img src="/logos/logo-sq.svg" alt="OpenArchiver Logo" class="h-16 w-16" />
			<span class="text-2xl">Open Archiver</span>
		</a>
	</div>
	<Card.Root class="w-full max-w-md">
		<Card.Header class="space-y-1">
			<Card.Title class="text-2xl">{$t('app.auth.login')}</Card.Title>
			<Card.Description>{$t('app.auth.login_tip')}</Card.Description>
		</Card.Header>
		<Card.Content class="grid gap-4">
			{#if hasSso && sso}
				<div class="grid gap-2">
					{#each sso.connections as connection (connection.id)}
						<Button
							type="button"
							variant={ssoEnforced ? 'default' : 'outline'}
							class="w-full"
							disabled={ssoLoadingId !== null}
							onclick={() => startSso(connection)}
						>
							{ssoLoadingId === connection.id
								? $t('app.common.working')
								: $t('app.auth.sso_continue_with', {
										name: connection.name,
									} as any)}
						</Button>
					{/each}
				</div>

				{#if passwordFormVisible}
					<div class="flex items-center gap-3">
						<Separator class="flex-1" />
						<span class="text-muted-foreground text-xs uppercase"
							>{$t('app.auth.sso_or')}</span
						>
						<Separator class="flex-1" />
					</div>
				{/if}
			{/if}

			{#if passwordFormVisible}
				<form onsubmit={handleSubmit} class="grid gap-4">
					<div class="grid gap-2">
						<Label for="email">{$t('app.auth.email')}</Label>
						<Input
							id="email"
							type="email"
							placeholder="m@example.com"
							bind:value={email}
							required
						/>
					</div>
					<div class="grid gap-2">
						<Label for="password">{$t('app.auth.password')}</Label>
						<Input id="password" type="password" bind:value={password} required />
					</div>

					<Button type="submit" class=" w-full" disabled={isLoading}>
						{isLoading ? $t('app.common.working') : $t('app.auth.login')}
					</Button>
				</form>
			{:else}
				<button
					type="button"
					class="text-muted-foreground hover:text-foreground text-center text-xs underline"
					onclick={() => (showPasswordForm = true)}
				>
					{$t('app.auth.sso_use_password')}
				</button>
			{/if}
		</Card.Content>
	</Card.Root>
</div>
