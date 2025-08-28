<script lang="ts">
	import PostalMime, { type Email } from 'postal-mime';
	import type { Buffer } from 'buffer';
	import { t } from '$lib/translations';

	let {
		raw,
		rawHtml,
	}: { raw?: Buffer | { type: 'Buffer'; data: number[] } | undefined; rawHtml?: string } =
		$props();

	let parsedEmail: Email | null = $state(null);
	let isLoading = $state(true);

	// By adding a <base> tag, all relative and absolute links in the HTML document
	// will open in a new tab by default.
	let emailHtml = $derived(() => {
		if (parsedEmail && parsedEmail.html) {
			return `<base target="_blank" />${parsedEmail.html}`;
		} else if (parsedEmail && parsedEmail.text) {
			return `<base target="_blank" />${parsedEmail.text}`;
		} else if (rawHtml) {
			return `<base target="_blank" />${rawHtml}`;
		}
		return null;
	});

	$effect(() => {
		async function parseEmail() {
			if (raw) {
				try {
					let buffer: Uint8Array;
					if ('type' in raw && raw.type === 'Buffer') {
						buffer = new Uint8Array(raw.data);
					} else {
						buffer = new Uint8Array(raw as Buffer);
					}
					const parsed = await new PostalMime().parse(buffer);
					parsedEmail = parsed;
				} catch (error) {
					console.error('Failed to parse email:', error);
				} finally {
					isLoading = false;
				}
			} else {
				isLoading = false;
			}
		}
		parseEmail();
	});
</script>

<div class="mt-2 rounded-md border bg-white p-4">
	{#if isLoading}
		<p>{$t('components.email_preview.loading')}</p>
	{:else if emailHtml}
		<iframe
			title={$t('archive.email_preview')}
			srcdoc={emailHtml()}
			class="h-[600px] w-full border-none"
		></iframe>
	{:else if raw}
		<p>{$t('components.email_preview.render_error')}</p>
	{:else}
		<p class="text-gray-500">{$t('components.email_preview.not_available')}</p>
	{/if}
</div>
