<script lang="ts">
	import { goto } from '$app/navigation';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { authStore } from '$lib/stores/auth.store';
	import type { LoginResponse } from '@open-archiver/types';
	import { setAlert } from '$lib/components/custom/alert/alert-state.svelte';
	import { t } from '$lib/translations';

	let code = $state('');
	let isLoading = $state(false);
	let useBackupCode = $state(false);

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		isLoading = true;
		try {
			// The mfaPendingToken travels automatically as an httpOnly cookie — not in the body.
			const response = await fetch('/api/v1/auth/mfa/verify', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({ code }),
			});

			if (!response.ok) {
				let errorMessage = $t('app.auth.mfa_failed');
				try {
					const errorData = await response.json();
					errorMessage = errorData.message || errorMessage;
				} catch {
					errorMessage = response.statusText;
				}
				throw new Error(errorMessage);
			}

			const loginData: LoginResponse = await response.json();
			authStore.login(loginData.accessToken, loginData.user);
			goto('/dashboard');
		} catch (e: unknown) {
			setAlert({
				type: 'error',
				title: $t('app.auth.mfa_failed'),
				message: e instanceof Error ? e.message : String(e),
				duration: 5000,
				show: true,
			});
		} finally {
			isLoading = false;
		}
	}

	function toggleBackupCode() {
		useBackupCode = !useBackupCode;
		code = '';
	}
</script>

<svelte:head>
	<title>{$t('app.auth.mfa_title')} - Open Archiver</title>
	<meta name="description" content="Two-factor authentication verification for Open Archiver." />
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
			<Card.Title class="text-2xl">{$t('app.auth.mfa_title')}</Card.Title>
			<Card.Description>
				{useBackupCode ? $t('app.auth.mfa_backup_tip') : $t('app.auth.mfa_tip')}
			</Card.Description>
		</Card.Header>
		<Card.Content class="grid gap-4">
			<form onsubmit={handleSubmit} class="grid gap-4">
				<div class="grid gap-2">
					<Label for="code">
						{useBackupCode
							? $t('app.auth.mfa_backup_code_label')
							: $t('app.auth.mfa_code_label')}
					</Label>
					<Input
						id="code"
						type={useBackupCode ? 'text' : 'text'}
						placeholder={useBackupCode ? 'xxxxxxxx' : '000000'}
						bind:value={code}
						maxlength={useBackupCode ? 8 : 6}
						autocomplete="one-time-code"
						inputmode={useBackupCode ? 'text' : 'numeric'}
						required
					/>
				</div>

				<Button type="submit" class="w-full" disabled={isLoading}>
					{isLoading ? $t('app.common.working') : $t('app.auth.mfa_verify')}
				</Button>
			</form>

			<div class="text-center">
				<Button
					variant="link"
					class="text-muted-foreground text-sm"
					onclick={toggleBackupCode}
				>
					{useBackupCode ? $t('app.auth.mfa_use_totp') : $t('app.auth.mfa_use_backup')}
				</Button>
			</div>
		</Card.Content>
		<Card.Footer>
			<a href="/signin" class="text-muted-foreground text-sm hover:underline">
				← {$t('app.auth.back_to_login')}
			</a>
		</Card.Footer>
	</Card.Root>
</div>
