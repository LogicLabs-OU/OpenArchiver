<script lang="ts">
	import type { OAuthPollResponse } from '@open-archiver/types';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { api } from '$lib/api.client';
	import { t } from '$lib/translations';
	import { Copy, ExternalLink, LoaderCircle } from 'lucide-svelte';

	let {
		open = $bindable(false),
		sourceId,
		userCode,
		verificationUri,
		verificationUriComplete = undefined,
		expiresIn,
		interval,
		onComplete,
		onRetry,
	}: {
		open: boolean;
		sourceId: string;
		userCode: string;
		verificationUri: string;
		verificationUriComplete?: string;
		expiresIn: number;
		interval: number;
		/**
		 * Called once when the provider reports the sign-in completed. `warning` carries a
		 * first connection that was refused — the source is authorized either way, so this
		 * is reported alongside the success rather than instead of it.
		 */
		onComplete: (warning?: string) => void;
		/** Called when the user asks to start over after an expiry or denial. */
		onRetry: () => void;
	} = $props();

	let error = $state('');
	let secondsLeft = $state(0);
	let copied = $state(false);

	// The poll loop lives here in the browser: the admin is watching this dialog anyway,
	// and one request per interval stays far under the API rate limit. Closing the dialog
	// stops the loop; the source stays pending_auth and Re-authorize starts over.
	let pollTimer: ReturnType<typeof setTimeout> | null = null;
	let countdownTimer: ReturnType<typeof setInterval> | null = null;

	const stopTimers = () => {
		if (pollTimer) clearTimeout(pollTimer);
		if (countdownTimer) clearInterval(countdownTimer);
		pollTimer = null;
		countdownTimer = null;
	};

	const poll = async (delaySeconds: number) => {
		pollTimer = setTimeout(async () => {
			if (!open) return;
			let next = delaySeconds;
			try {
				const response = await api(`/ingestion-sources/${sourceId}/oauth/poll`, {
					method: 'POST',
				});
				const body: OAuthPollResponse = await response.json();
				if (!response.ok) {
					throw new Error((body as any)?.message || 'Poll failed');
				}
				if (!body.pending) {
					stopTimers();
					if (body.error) {
						error = body.error;
					} else {
						onComplete(body.warning);
					}
					return;
				}
				// slow_down: the provider names the new cadence.
				if (body.interval) next = body.interval;
			} catch (e) {
				// One failed poll is not a failed authorization; keep going until expiry.
				console.error('Device code poll failed', e);
			}
			if (open && secondsLeft > 0) {
				poll(next);
			}
		}, delaySeconds * 1000);
	};

	$effect(() => {
		if (open) {
			error = '';
			secondsLeft = expiresIn;
			stopTimers();
			countdownTimer = setInterval(() => {
				secondsLeft = Math.max(0, secondsLeft - 1);
				if (secondsLeft === 0) stopTimers();
			}, 1000);
			poll(interval);
		} else {
			stopTimers();
		}
		return stopTimers;
	});

	const copyCode = async () => {
		try {
			await navigator.clipboard.writeText(userCode);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch {
			// Clipboard may be unavailable; the code is on screen regardless.
		}
	};
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>{$t('app.ingestions.device_code_title')}</Dialog.Title>
			<Dialog.Description>
				{$t('app.ingestions.device_code_instructions')}
			</Dialog.Description>
		</Dialog.Header>

		<div class="flex flex-col items-center gap-4 py-2">
			<div class="bg-muted rounded-md px-6 py-3 font-mono text-2xl font-bold tracking-widest">
				{userCode}
			</div>
			<div class="flex gap-2">
				<Button type="button" variant="outline" size="sm" onclick={copyCode}>
					<Copy class="mr-1 h-4 w-4" />
					{copied
						? $t('app.ingestions.device_code_copied')
						: $t('app.ingestions.device_code_copy')}
				</Button>
				<Button
					type="button"
					size="sm"
					href={verificationUriComplete || verificationUri}
					target="_blank"
					rel="noopener noreferrer"
				>
					<ExternalLink class="mr-1 h-4 w-4" />
					{$t('app.ingestions.device_code_open_link')}
				</Button>
			</div>

			{#if error}
				<p class="text-center text-sm text-red-600">{error}</p>
				<Button type="button" variant="secondary" size="sm" onclick={() => onRetry()}>
					{$t('app.ingestions.device_code_retry')}
				</Button>
			{:else}
				<div class="text-muted-foreground flex items-center gap-2 text-sm">
					<LoaderCircle class="h-4 w-4 animate-spin" />
					{$t('app.ingestions.device_code_waiting')}
				</div>
				{#if secondsLeft > 0}
					<p class="text-muted-foreground text-xs">
						{$t('app.ingestions.device_code_expires_in', {
							seconds: secondsLeft,
						} as any)}
					</p>
				{/if}
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>
