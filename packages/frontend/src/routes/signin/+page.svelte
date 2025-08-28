<script lang="ts">
	import { goto } from '$app/navigation';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { api } from '$lib/api.client';
	import { authStore } from '$lib/stores/auth.store';
	import type { LoginResponse } from '@open-archiver/types';
	import { setAlert } from '$lib/components/custom/alert/alert-state.svelte';
	import { t } from '$lib/translations';

	let email = '';
	let password = '';
	let isLoading = false;

	async function handleSubmit() {
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
				} catch (e) {
					errorMessage = response.statusText;
				}
				throw new Error(errorMessage);
			}

			const loginData: LoginResponse = await response.json();
			authStore.login(loginData.accessToken, loginData.user);
			// Redirect to a protected page after login
			goto('/dashboard');
		} catch (e: any) {
			setAlert({
				type: 'error',
				title: 'Login Failed',
				message: e.message,
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
		</Card.Content>
	</Card.Root>
</div>
