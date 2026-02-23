<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { api } from '$lib/api.client';
	import { setAlert } from '$lib/components/custom/alert/alert-state.svelte';

	let processing = $state(true);
	let errorMessage = $state('');

	onMount(async () => {
		try {
			// Get the authorization code and state from URL
			const code = $page.url.searchParams.get('code');
			const returnedState = $page.url.searchParams.get('state');
			const error = $page.url.searchParams.get('error');
			const errorDescription = $page.url.searchParams.get('error_description');

			// Check for errors from OAuth provider
			if (error) {
				throw new Error(errorDescription || `OAuth error: ${error}`);
			}

			if (!code || !returnedState) {
				throw new Error('Missing authorization code or state');
			}

			// Retrieve stored OAuth data
			const storedState = sessionStorage.getItem('outlook_oauth_state');
			const sourceName = sessionStorage.getItem('outlook_oauth_source_name');

			// Validate state (client-side guard; the real validation happens server-side)
			if (!storedState || storedState !== returnedState) {
				throw new Error('Invalid state parameter - possible CSRF attack');
			}

			if (!sourceName) {
				throw new Error('Missing OAuth session data');
			}

			// Exchange code for tokens by calling backend
			const response = await api('/ingestion-sources/oauth/outlook-personal/callback', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					code,
					state: returnedState,
					name: sourceName,
				}),
			});

			if (!response.ok) {
				let errorMsg = 'Failed to complete OAuth flow';
				try {
					const errorData = await response.json();
					errorMsg = errorData.message || errorMsg;
				} catch {
					// Response was not JSON
				}
				throw new Error(errorMsg);
			}

			const source = await response.json();

			// Clean up session storage
			sessionStorage.removeItem('outlook_oauth_state');

			// Show success message
			setAlert({
				type: 'success',
				title: 'Successfully Connected',
				message: `Outlook Personal account connected: ${source.name}`,
				duration: 5000,
				show: true,
			});

			// Redirect to ingestions page
			goto('/dashboard/ingestions');
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
			processing = false;

			// Clean up session storage on error
			sessionStorage.removeItem('outlook_oauth_state');

			// Show error alert
			setAlert({
				type: 'error',
				title: 'OAuth Failed',
				message: errorMessage,
				duration: 10000,
				show: true,
			});

			// Redirect back to ingestions after a short delay
			setTimeout(() => {
				goto('/dashboard/ingestions');
			}, 3000);
		}
	});
</script>

{#if processing}
	<div class="flex min-h-screen items-center justify-center">
		<div class="text-center">
			<div class="mb-4 text-xl font-semibold">Completing authentication...</div>
			<div class="text-muted-foreground">Please wait while we connect your account.</div>
		</div>
	</div>
{:else}
	<div class="flex min-h-screen items-center justify-center">
		<div class="text-center">
			<div class="mb-4 text-xl font-semibold text-red-600">Authentication Failed</div>
			<div class="text-muted-foreground">{errorMessage}</div>
			<div class="mt-4 text-sm text-muted-foreground">Redirecting back to ingestions...</div>
		</div>
	</div>
{/if}
