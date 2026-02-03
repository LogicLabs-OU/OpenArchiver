<script lang="ts">
	import type { PageData } from './$types';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import EmailPreview from '$lib/components/custom/EmailPreview.svelte';
	import EmailThread from '$lib/components/custom/EmailThread.svelte';
	import { api } from '$lib/api.client';
	import { browser } from '$app/environment';
	import { formatBytes } from '$lib/utils';
	import { goto } from '$app/navigation';
	import * as Dialog from '$lib/components/ui/dialog';
	import { setAlert } from '$lib/components/custom/alert/alert-state.svelte';
	import { t } from '$lib/translations';
	import { ShieldCheck, ShieldAlert, AlertTriangle } from 'lucide-svelte';
	import * as Alert from '$lib/components/ui/alert';
	import { Badge } from '$lib/components/ui/badge';
	import * as HoverCard from '$lib/components/ui/hover-card';

	let { data }: { data: PageData } = $props();
	let email = $derived(data.email);
	let integrityReport = $derived(data.integrityReport);
	let isDeleteDialogOpen = $state(false);
	let isDeleting = $state(false);

	async function download(path: string, filename: string) {
		if (!browser) return;

		try {
			const response = await api(`/storage/download?path=${encodeURIComponent(path)}`);

			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}

			const blob = await response.blob();
			const url = window.URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = filename;
			document.body.appendChild(a);
			a.click();
			window.URL.revokeObjectURL(url);
			a.remove();
		} catch (error) {
			console.error('Download failed:', error);
			// Optionally, show an error message to the user
		}
	}

	async function confirmDelete() {
		if (!email) return;
		try {
			isDeleting = true;
			const response = await api(`/archived-emails/${email.id}`, {
				method: 'DELETE',
			});
			if (!response.ok) {
				const errorData = await response.json().catch(() => null);
				const message = errorData?.message || 'Failed to delete email';
				console.error('Delete failed:', message);
				setAlert({
					type: 'error',
					title: 'Failed to delete archived email',
					message: message,
					duration: 5000,
					show: true,
				});
				return;
			}
			await goto('/dashboard/archived-emails', { invalidateAll: true });
		} catch (error) {
			console.error('Delete failed:', error);
		} finally {
			isDeleting = false;
			isDeleteDialogOpen = false;
		}
	}
</script>

<svelte:head>
	<title>{email?.subject} | {$t('app.archive.title')} - OpenArchiver</title>
</svelte:head>

{#if email}
	<div class="grid grid-cols-3 gap-6">
		<div class="col-span-3 md:col-span-2">
			<Card.Root>
				<Card.Header>
					<Card.Title>{email.subject || $t('app.archive.no_subject')}</Card.Title>
					<Card.Description>
						{$t('app.archive.from')}: {email.senderEmail || email.senderName} | {$t(
							'app.archive.sent'
						)}: {new Date(email.sentAt).toLocaleString()}
					</Card.Description>
				</Card.Header>
				<Card.Content>
					<div class="space-y-4">
						<div class="space-y-1">
							<h3 class="font-semibold">{$t('app.archive.recipients')}</h3>
							<Card.Description>
								<p>
									{$t('app.archive.to')}: {email.recipients
										.map((r) => r.email || r.name)
										.join(', ')}
								</p>
							</Card.Description>
						</div>
						<div class=" space-y-1">
							<h3 class="font-semibold">{$t('app.archive.meta_data')}</h3>
							<Card.Description class="space-y-2">
								{#if email.path}
									<div class="flex flex-wrap items-center gap-2">
										<span>{$t('app.archive.folder')}:</span>
										<span class="  bg-muted truncate rounded p-1.5 text-xs"
											>{email.path || '/'}</span
										>
									</div>
								{/if}
								{#if email.tags && email.tags.length > 0}
									<div class="flex flex-wrap items-center gap-2">
										<span> {$t('app.archive.tags')}: </span>
										{#each email.tags as tag}
											<span class="  bg-muted truncate rounded p-1.5 text-xs"
												>{tag}</span
											>
										{/each}
									</div>
								{/if}
								<div class="flex flex-wrap items-center gap-2">
									<span>{$t('app.archive.size')}:</span>
									<span class="  bg-muted truncate rounded p-1.5 text-xs"
										>{formatBytes(email.sizeBytes)}</span
									>
								</div>
							</Card.Description>
						</div>
						<div>
							<h3 class="font-semibold">{$t('app.archive.email_preview')}</h3>
							<EmailPreview raw={email.raw} />
						</div>
						{#if email.attachments && email.attachments.length > 0}
							<div>
								<h3 class="font-semibold">
									{$t('app.archive.attachments')}
								</h3>
								<ul class="mt-2 space-y-2">
									{#each email.attachments as attachment}
										<li
											class="flex items-center justify-between rounded-md border p-2"
										>
											<span
												>{attachment.filename} ({formatBytes(
													attachment.sizeBytes
												)})</span
											>
											<Button
												variant="outline"
												size="sm"
												onclick={() =>
													download(
														attachment.storagePath,
														attachment.filename
													)}
											>
												{$t('app.archive.download')}
											</Button>
										</li>
									{/each}
								</ul>
							</div>
						{/if}
					</div>
				</Card.Content>
			</Card.Root>
		</div>
		<div class="col-span-3 space-y-6 md:col-span-1">
			<Card.Root>
				<Card.Header>
					<Card.Title>{$t('app.archive.actions')}</Card.Title>
				</Card.Header>
				<Card.Content class="space-y-2">
					<Button
						onclick={() =>
							download(email.storagePath, `${email.subject || 'email'}.eml`)}
						>{$t('app.archive.download_eml')}</Button
					>
					<Button variant="destructive" onclick={() => (isDeleteDialogOpen = true)}>
						{$t('app.archive.delete_email')}
					</Button>
				</Card.Content>
			</Card.Root>

			{#if integrityReport && integrityReport.length > 0}
				<Card.Root>
					<Card.Header>
						<Card.Title>{$t('app.archive.integrity_report')}</Card.Title>
						<Card.Description>
							<span class="mt-1">
								{$t('app.archive.integrity_report_description')}
								<a
									href="https://docs.openarchiver.com/user-guides/integrity-check.html"
									target="_blank"
									class="text-primary underline underline-offset-2"
									>{$t('app.common.read_docs')}</a
								>.
							</span>
						</Card.Description>
					</Card.Header>
					<Card.Content class="space-y-2">
						<ul class="space-y-2">
							{#each integrityReport as item}
								<li class="flex items-center justify-between">
									<div class="flex min-w-0 flex-row items-center space-x-2">
										{#if item.isValid}
											<ShieldCheck
												class="h-4 w-4 flex-shrink-0 text-green-500"
											/>
										{:else}
											<ShieldAlert
												class="h-4 w-4 flex-shrink-0 text-red-500"
											/>
										{/if}
										<div class="min-w-0 max-w-64">
											<p class="truncate text-sm font-medium">
												{#if item.type === 'email'}
													{$t('app.archive.email_eml')}
												{:else}
													{item.filename}
												{/if}
											</p>
										</div>
									</div>
									{#if item.isValid}
										<Badge variant="default" class="bg-green-500"
											>{$t('app.archive.valid')}</Badge
										>
									{:else}
										<HoverCard.Root>
											<HoverCard.Trigger>
												<Badge variant="destructive" class="cursor-help"
													>{$t('app.archive.invalid')}</Badge
												>
											</HoverCard.Trigger>
											<HoverCard.Content class="w-80 bg-gray-50 text-red-500">
												<p>{item.reason}</p>
											</HoverCard.Content>
										</HoverCard.Root>
									{/if}
								</li>
							{/each}
						</ul>
					</Card.Content>
				</Card.Root>
			{:else}
				<Alert.Root variant="destructive">
					<AlertTriangle class="h-4 w-4" />
					<Alert.Title>{$t('app.archive.integrity_check_failed_title')}</Alert.Title>
					<Alert.Description>
						{$t('app.archive.integrity_check_failed_message')}
					</Alert.Description>
				</Alert.Root>
			{/if}

			{#if email.thread && email.thread.length > 1}
				<Card.Root>
					<Card.Header>
						<Card.Title>{$t('app.archive.email_thread')}</Card.Title>
					</Card.Header>
					<Card.Content>
						<EmailThread thread={email.thread} currentEmailId={email.id} />
					</Card.Content>
				</Card.Root>
			{/if}
		</div>
	</div>

	<Dialog.Root bind:open={isDeleteDialogOpen}>
		<Dialog.Content class="sm:max-w-lg">
			<Dialog.Header>
				<Dialog.Title>{$t('app.archive.delete_confirmation_title')}</Dialog.Title>
				<Dialog.Description>
					{$t('app.archive.delete_confirmation_description')}
				</Dialog.Description>
			</Dialog.Header>
			<Dialog.Footer class="sm:justify-start">
				<Button
					type="button"
					variant="destructive"
					onclick={confirmDelete}
					disabled={isDeleting}
				>
					{#if isDeleting}
						{$t('app.archive.deleting')}...
					{:else}
						{$t('app.archive.confirm')}
					{/if}
				</Button>
				<Dialog.Close>
					<Button type="button" variant="secondary">{$t('app.archive.cancel')}</Button>
				</Dialog.Close>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>
{:else}
	<p>{$t('app.archive.not_found')}</p>
{/if}
