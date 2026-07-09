<script lang="ts">
	import { goto } from '$app/navigation';
	import { api } from '$lib/api.client';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { authStore } from '$lib/stores/auth.store';
	import { setAlert } from '$lib/components/custom/alert/alert-state.svelte';
	import { t } from '$lib/translations';
	import type { MfaSetupResponse, LoginResponse } from '@open-archiver/types';

	type Step = 'loading' | 'qr';
	let step = $state<Step>('loading');
	let setupData = $state<MfaSetupResponse | null>(null);
	let code = $state('');
	let isLoading = $state(false);

	/** Fetch the QR code from the forced-enrollment endpoint using the mfaPending cookie. */
	async function loadSetup() {
		try {
			const res = await api('/auth/mfa/enroll-forced', { method: 'POST' });
			if (!res.ok) {
				const err = (await res.json().catch(() => ({}))) as { message?: string };
				throw new Error(err.message ?? $t('app.security.setup_failed'));
			}
			setupData = (await res.json()) as MfaSetupResponse;
			step = 'qr';
		} catch (e: unknown) {
			setAlert({
				type: 'error',
				title: $t('app.security.setup_failed'),
				message: e instanceof Error ? e.message : String(e),
				duration: 5000,
				show: true,
			});
		}
	}

	// Fetch QR code on component mount
	$effect(() => {
		loadSetup();
	});

	/** Confirm the TOTP code and exchange the mfaPending cookie for a full-access token. */
	async function handleConfirm(e: SubmitEvent) {
		e.preventDefault();
		isLoading = true;
		try {
			const res = await api('/auth/mfa/enroll-forced/confirm', {
				method: 'POST',
				body: JSON.stringify({ code }),
			});
			if (!res.ok) {
				const err = (await res.json().catch(() => ({}))) as { message?: string };
				throw new Error(err.message ?? $t('app.security.enroll_failed'));
			}
			const loginData: LoginResponse = await res.json();
			authStore.login(loginData.accessToken, loginData.user);
			goto('/dashboard');
		} catch (e: unknown) {
			setAlert({
				type: 'error',
				title: $t('app.security.enroll_failed'),
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
	<title>{$t('app.security.forced_enrollment_title')} - Open Archiver</title>
	<meta
		name="description"
		content="Set up two-factor authentication to complete sign-in to Open Archiver."
	/>
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
			<Card.Title class="text-2xl">{$t('app.security.forced_enrollment_title')}</Card.Title>
			<Card.Description>{$t('app.security.forced_enrollment_desc')}</Card.Description>
		</Card.Header>

		<Card.Content class="grid gap-4">
			{#if step === 'loading'}
				<p class="text-muted-foreground text-sm">{$t('app.common.loading')}</p>
			{:else if step === 'qr' && setupData}
				<p class="text-sm">{$t('app.security.qr_instruction')}</p>

				<div class="flex justify-center">
					<img
						src={setupData.qrCodeDataUrl}
						alt="TOTP QR Code"
						class="h-48 w-48 rounded border"
					/>
				</div>

				<details class="text-muted-foreground text-xs">
					<summary class="cursor-pointer">{$t('app.security.manual_entry')}</summary>
					<div class="bg-muted mt-2 break-all rounded p-2 font-mono">
						{setupData.otpAuthUrl}
					</div>
				</details>

				<form onsubmit={handleConfirm} class="space-y-3">
					<div class="grid gap-2">
						<Label for="code">{$t('app.security.enter_code_to_confirm')}</Label>
						<Input
							id="code"
							type="text"
							inputmode="numeric"
							maxlength={6}
							placeholder="000000"
							autocomplete="one-time-code"
							bind:value={code}
							required
						/>
					</div>
					<Button type="submit" class="w-full" disabled={isLoading}>
						{isLoading
							? $t('app.common.working')
							: $t('app.security.confirm_enrollment')}
					</Button>
				</form>
			{/if}
		</Card.Content>

		<Card.Footer>
			<a href="/signin" class="text-muted-foreground text-sm hover:underline">
				← {$t('app.auth.back_to_login')}
			</a>
		</Card.Footer>
	</Card.Root>
</div>
