<script lang="ts">
	import type { ActionData, PageData } from './$types';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import EmailPreview from '$lib/components/custom/EmailPreview.svelte';
	import EmailThread from '$lib/components/custom/EmailThread.svelte';
	import { api } from '$lib/api.client';
	import { browser } from '$app/environment';
	import { formatBytes } from '$lib/utils';
	import { goto } from '$app/navigation';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Select from '$lib/components/ui/select/index.js';
	import { setAlert } from '$lib/components/custom/alert/alert-state.svelte';
	import { t } from '$lib/translations';
	import { ShieldCheck, ShieldAlert, AlertTriangle } from 'lucide-svelte';
	import * as Alert from '$lib/components/ui/alert';
	import { Badge } from '$lib/components/ui/badge';
	import * as HoverCard from '$lib/components/ui/hover-card';
	import {
		Clock,
		Trash2,
		CalendarClock,
		AlertCircle,
		Shield,
		CircleAlert,
		Tag,
		FileDown,
	} from 'lucide-svelte';
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import type { LegalHold, EmailLegalHoldInfo } from '@open-archiver/types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let email = $derived(data.email);
	let integrityReport = $derived(data.integrityReport);
	let retentionPolicy = $derived(data.retentionPolicy);
	let retentionLabels = $derived(data.retentionLabels);
	let emailRetentionLabel = $derived(data.emailRetentionLabel);
	let legalHolds = $derived(data.legalHolds as LegalHold[]);
	let emailLegalHolds = $derived(data.emailLegalHolds as EmailLegalHoldInfo[]);
	let enterpriseMode = $derived(page.data.enterpriseMode);

	/** Scheduled deletion date from the matching retention policy: sentAt + appliedRetentionDays */
	let scheduledDeletionDate = $derived.by(() => {
		if (!email || !retentionPolicy || retentionPolicy.appliedRetentionDays === 0) return null;
		const sentDate = new Date(email.sentAt);
		const deletionDate = new Date(sentDate);
		deletionDate.setDate(deletionDate.getDate() + retentionPolicy.appliedRetentionDays);
		return deletionDate;
	});

	/**
	 * Scheduled deletion date derived from the applied retention label.
	 * Only computed when a label is active (not disabled).
	 */
	let scheduledDeletionDateByLabel = $derived.by(() => {
		if (!email || !emailRetentionLabel || emailRetentionLabel.isLabelDisabled) return null;
		const sentDate = new Date(email.sentAt);
		const deletionDate = new Date(sentDate);
		deletionDate.setDate(deletionDate.getDate() + emailRetentionLabel.retentionPeriodDays);
		return deletionDate;
	});

	let isDeleteDialogOpen = $state(false);
	let isDeleting = $state(false);

	// --- Label state ---
	let selectedLabelId = $state('');
	let isApplyingLabel = $state(false);
	let isRemovingLabel = $state(false);

	// --- Legal hold state (enterprise only) ---
	let selectedHoldId = $state('');
	let isApplyingHold = $state(false);
	let isRemovingHoldId = $state<string | null>(null);

	// --- Integrity report PDF download state (enterprise only) ---
	let isDownloadingReport = $state(false);

	// React to form results for label and hold actions
	$effect(() => {
		if (form) {
			if (form.success === false && form.message) {
				setAlert({
					type: 'error',
					title: $t('app.archive_labels.apply_error'),
					message: String(form.message),
					duration: 5000,
					show: true,
				});
			}
			if (form.success && form.action === 'applied') {
				setAlert({
					type: 'success',
					title: $t('app.archive_labels.apply_success'),
					message: '',
					duration: 3000,
					show: true,
				});
				selectedLabelId = '';
			}
			if (form.success && form.action === 'removed') {
				setAlert({
					type: 'success',
					title: $t('app.archive_labels.remove_success'),
					message: '',
					duration: 3000,
					show: true,
				});
				selectedLabelId = '';
			}
			if (form.success && form.action === 'holdApplied') {
				setAlert({
					type: 'success',
					title: $t('app.archive_legal_holds.apply_success'),
					message: '',
					duration: 3000,
					show: true,
				});
				selectedHoldId = '';
			}
			if (form.success && form.action === 'holdRemoved') {
				setAlert({
					type: 'success',
					title: $t('app.archive_legal_holds.remove_success'),
					message: '',
					duration: 3000,
					show: true,
				});
			}
		}
	});

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
		}
	}

	/** Downloads the enterprise integrity verification PDF report. */
	async function downloadIntegrityReportPdf() {
		if (!browser || !email) return;

		try {
			isDownloadingReport = true;
			const response = await api(`/enterprise/integrity-report/${email.id}/pdf`);

			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}

			const blob = await response.blob();
			const url = window.URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `integrity-report-${email.id}.pdf`;
			document.body.appendChild(a);
			a.click();
			window.URL.revokeObjectURL(url);
			a.remove();
		} catch (error) {
			console.error('Integrity report download failed:', error);
			setAlert({
				type: 'error',
				title: $t('app.archive.integrity_report_download_error'),
				message: '',
				duration: 5000,
				show: true,
			});
		} finally {
			isDownloadingReport = false;
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
							<p class="text-muted-foreground text-sm">
								{$t('app.archive.to')}: {email.recipients
									.map((r) => r.email || r.name)
									.join(', ')}
							</p>
						</div>
						<div class="space-y-1">
							<h3 class="font-semibold">{$t('app.archive.meta_data')}</h3>
							<div class="text-muted-foreground space-y-2 text-sm">
								{#if email.path}
									<div class="flex flex-wrap items-center gap-2">
										<span>{$t('app.archive.folder')}:</span>
										<span class="bg-muted truncate rounded p-1.5 text-xs"
											>{email.path || '/'}</span
										>
									</div>
								{/if}
								{#if email.tags && email.tags.length > 0}
									<div class="flex flex-wrap items-center gap-2">
										<span> {$t('app.archive.tags')}: </span>
										{#each email.tags as tag}
											<span class="bg-muted truncate rounded p-1.5 text-xs"
												>{tag}</span
											>
										{/each}
									</div>
								{/if}
								<div class="flex flex-wrap items-center gap-2">
									<span>{$t('app.archive.size')}:</span>
									<span class="bg-muted truncate rounded p-1.5 text-xs"
										>{formatBytes(email.sizeBytes)}</span
									>
								</div>
							</div>
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
												class="text-xs"
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
						class="text-xs"
						onclick={() =>
							download(email.storagePath, `${email.subject || 'email'}.eml`)}
						>{$t('app.archive.download_eml')}</Button
					>
					<Button
						variant="destructive"
						class="text-xs"
						onclick={() => (isDeleteDialogOpen = true)}
					>
						{$t('app.archive.delete_email')}
					</Button>
				</Card.Content>
			</Card.Root>

			{#if integrityReport && integrityReport.length > 0}
				<Card.Root>
					<Card.Header>
						<Card.Title>{$t('app.archive.integrity_report')}</Card.Title>
						<Card.Description class="text-xs">
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
											<p class="truncate text-xs font-medium">
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
						{#if enterpriseMode}
							<Button
								variant="outline"
								size="sm"
								class="mt-2 w-full text-xs"
								onclick={downloadIntegrityReportPdf}
								disabled={isDownloadingReport}
							>
								<FileDown class="mr-1.5 h-3.5 w-3.5" />
								{#if isDownloadingReport}
									{$t('app.archive.downloading_integrity_report')}
								{:else}
									{$t('app.archive.download_integrity_report_pdf')}
								{/if}
							</Button>
						{/if}
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
			<!-- Thread discovery -->
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
			<!-- Legal Holds card (Enterprise only) -->
			{#if enterpriseMode}
				<Card.Root>
					<Card.Header>
						<Card.Title class="flex items-center gap-2">
							{$t('app.archive_legal_holds.section_title')}
						</Card.Title>
						<Card.Description class="text-xs">
							<span class="mt-1">
								{$t('app.archive_legal_holds.section_description')}
								<a
									href="https://docs.openarchiver.com/enterprise/legal-holds/guide.html"
									target="_blank"
									class="text-primary underline underline-offset-2"
									>{$t('app.common.read_docs')}</a
								>.
							</span>
						</Card.Description>
					</Card.Header>
					<Card.Content class="space-y-3">
						<!-- List of holds already applied to this email -->
						{#if emailLegalHolds && emailLegalHolds.length > 0}
							<div class="space-y-2">
								{#each emailLegalHolds as holdInfo (holdInfo.legalHoldId)}
									<div
										class="flex items-center justify-between rounded-md border p-2"
									>
										<div class="min-w-0 flex-1">
											<div class="flex items-center gap-2">
												<span class="truncate text-xs font-medium">
													{holdInfo.holdName}
												</span>
												{#if holdInfo.isActive}
													<Badge
														class="bg-destructive text-xs text-white"
													>
														{$t('app.legal_holds.active')}
													</Badge>
												{:else}
													<Badge variant="secondary" class="text-xs">
														{$t('app.legal_holds.inactive')}
													</Badge>
												{/if}
											</div>
											<p class="text-muted-foreground mt-0.5 text-xs">
												{$t('app.archive_legal_holds.applied_at')}:
												{new Date(holdInfo.appliedAt).toLocaleDateString()}
											</p>
										</div>
										<form
											method="POST"
											action="?/removeHold"
											use:enhance={() => {
												isRemovingHoldId = holdInfo.legalHoldId;
												return async ({ update }) => {
													isRemovingHoldId = null;
													await update();
												};
											}}
										>
											<input
												type="hidden"
												name="holdId"
												value={holdInfo.legalHoldId}
											/>
											<Button
												type="submit"
												variant="ghost"
												size="sm"
												class="text-muted-foreground hover:text-destructive ml-2 shrink-0 text-xs"
												disabled={isRemovingHoldId === holdInfo.legalHoldId}
											>
												{#if isRemovingHoldId === holdInfo.legalHoldId}
													{$t('app.archive_legal_holds.removing')}
												{:else}
													{$t('app.archive_legal_holds.remove')}
												{/if}
											</Button>
										</form>
									</div>
								{/each}
							</div>
						{:else}
							<p class="text-muted-foreground text-xs">
								{$t('app.archive_legal_holds.no_holds')}
							</p>
						{/if}

						<!-- Apply an additional hold to this email -->
						{#if legalHolds && legalHolds.length > 0}
							<form
								method="POST"
								action="?/applyHold"
								class="space-y-2"
								use:enhance={() => {
									isApplyingHold = true;
									return async ({ update }) => {
										isApplyingHold = false;
										await update();
									};
								}}
							>
								<input type="hidden" name="holdId" value={selectedHoldId} />
								<Select.Root
									type="single"
									value={selectedHoldId}
									onValueChange={(v) => (selectedHoldId = v)}
								>
									<Select.Trigger class="w-full text-xs">
										{#if selectedHoldId}
											{legalHolds.find((h) => h.id === selectedHoldId)
												?.name ??
												$t(
													'app.archive_legal_holds.apply_hold_placeholder'
												)}
										{:else}
											{$t('app.archive_legal_holds.apply_hold_placeholder')}
										{/if}
									</Select.Trigger>
									<Select.Content class="text-xs">
										{#each legalHolds as hold (hold.id)}
											<Select.Item value={hold.id} class="text-xs"
												>{hold.name}</Select.Item
											>
										{/each}
									</Select.Content>
								</Select.Root>
								<Button
									type="submit"
									variant="outline"
									size="sm"
									class="w-full text-xs"
									disabled={isApplyingHold || !selectedHoldId}
								>
									{#if isApplyingHold}
										{$t('app.archive_legal_holds.applying')}
									{:else}
										{$t('app.archive_legal_holds.apply')}
									{/if}
								</Button>
							</form>
						{:else if !emailLegalHolds?.length}
							<p class="text-muted-foreground text-xs">
								{$t('app.archive_legal_holds.no_active_holds')}
							</p>
						{/if}
					</Card.Content>
				</Card.Root>
			{/if}
			{#if enterpriseMode && retentionPolicy}
				<Card.Root>
					<Card.Header>
						<Card.Title>{$t('app.archive.retention_policy')}</Card.Title>
						<Card.Description class="text-xs">
							<span class="mt-1">
								{$t('app.archive.retention_policy_description')}
								<a
									href="https://docs.openarchiver.com/enterprise/retention-policy/guide.html"
									target="_blank"
									class="text-primary underline underline-offset-2"
									>{$t('app.common.read_docs')}</a
								>.
							</span>
						</Card.Description>
					</Card.Header>
					<Card.Content class="space-y-3">
						<!-- Override notice: shown when an active retention label is applied -->
						{#if emailRetentionLabel && !emailRetentionLabel.isLabelDisabled}
							<div
								class="bg-muted-foreground text-muted flex items-start gap-2 rounded-md px-2 py-1.5 align-middle"
							>
								<CircleAlert class=" h-4 w-4 flex-shrink-0" />
								<div class=" text-xs">
									{$t('app.archive.retention_policy_overridden_by_label')}
									<span class="font-medium">{emailRetentionLabel.labelName}</span
									>.
								</div>
							</div>
						{/if}
						{#if retentionPolicy.appliedRetentionDays === 0}
							<p class="text-muted-foreground text-xs">
								{$t('app.archive.retention_no_policy')}
							</p>
						{:else}
							<div class="space-y-2">
								<div class="flex items-center gap-2">
									<Clock class="text-muted-foreground h-4 w-4 flex-shrink-0" />
									<span class="text-xs font-medium"
										>{$t('app.archive.retention_period')}:</span
									>
									<Badge variant="secondary">
										{retentionPolicy.appliedRetentionDays}
										{$t('app.retention_policies.days')}
									</Badge>
								</div>
								{#if scheduledDeletionDate}
									<div class="flex items-center gap-2">
										<CalendarClock
											class="text-muted-foreground h-4 w-4 flex-shrink-0"
										/>
										<span class="text-xs font-medium"
											>{$t('app.archive.retention_scheduled_deletion')}:</span
										>
										<Badge
											variant={scheduledDeletionDate <= new Date()
												? 'destructive'
												: 'secondary'}
										>
											{scheduledDeletionDate.toLocaleDateString()}
										</Badge>
									</div>
								{/if}
								<div class="flex items-center gap-2">
									<Trash2 class="text-muted-foreground h-4 w-4 flex-shrink-0" />
									<span class="text-xs font-medium"
										>{$t('app.archive.retention_action')}:</span
									>
									<Badge variant="outline">
										{$t('app.archive.retention_delete_permanently')}
									</Badge>
								</div>
								{#if retentionPolicy.matchingPolicyIds.length > 0}
									<div class="space-y-2">
										<div class="text-xs font-medium">
											{$t('app.archive.retention_matching_policies')}:
										</div>
										<div class="flex flex-wrap gap-1">
											{#each retentionPolicy.matchingPolicyIds as policyId}
												<Badge variant="outline" class="font-mono text-xs">
													{policyId}
												</Badge>
											{/each}
										</div>
									</div>
								{/if}
							</div>
						{/if}
					</Card.Content>
				</Card.Root>
			{/if}

			<!-- Retention Label section (Enterprise only) -->
			{#if enterpriseMode}
				<Card.Root>
					<Card.Header>
						<Card.Title class="flex items-center gap-2">
							{$t('app.archive_labels.section_title')}
						</Card.Title>
						<Card.Description class="text-xs">
							<span class="mt-1">
								{$t('app.archive_labels.section_description')}
								<a
									href="https://docs.openarchiver.com/enterprise/retention-labels/guide.html"
									target="_blank"
									class="text-primary underline underline-offset-2"
									>{$t('app.common.read_docs')}</a
								>.
							</span>
						</Card.Description>
					</Card.Header>
					<Card.Content class="space-y-3">
						{#if emailRetentionLabel}
							<!-- A label is applied to this email -->
							{#if emailRetentionLabel.isLabelDisabled}
								<!-- Label exists but has been disabled — show inactive state -->
								<div class="space-y-2">
									<div class="flex items-center gap-2">
										<span class="text-muted-foreground text-xs">
											{$t('app.archive_labels.current_label')}:
										</span>
										<Badge variant="secondary">
											{emailRetentionLabel.labelName}
										</Badge>
										<Badge
											variant="outline"
											class="text-muted-foreground text-xs"
										>
											{$t('app.archive_labels.label_inactive')}
										</Badge>
									</div>
									<div
										class="flex items-start gap-2 rounded-md border border-dashed p-2"
									>
										<AlertCircle
											class="text-muted-foreground mt-0.5 h-4 w-4 flex-shrink-0"
										/>
										<p class="text-muted-foreground text-xs">
											{$t('app.archive_labels.label_inactive_note')}
										</p>
									</div>
									<!-- Still allow removal of the inactive label -->
									<form
										method="POST"
										action="?/removeLabel"
										use:enhance={() => {
											isRemovingLabel = true;
											return async ({ update }) => {
												isRemovingLabel = false;
												await update();
											};
										}}
									>
										<Button
											type="submit"
											variant="outline"
											size="sm"
											class="w-full text-xs"
											disabled={isRemovingLabel}
										>
											{#if isRemovingLabel}
												{$t('app.archive_labels.removing')}
											{:else}
												{$t('app.archive_labels.remove')}
											{/if}
										</Button>
									</form>
								</div>
							{:else}
								<!-- Active label applied — show full details including scheduled deletion -->
								<div class="space-y-2">
									<div class="flex items-center gap-2">
										<span class="text-muted-foreground text-xs">
											{$t('app.archive_labels.current_label')}:
										</span>
										<Badge variant="default">
											{emailRetentionLabel.labelName}
										</Badge>
									</div>
									<div class="flex items-center gap-2">
										<Clock
											class="text-muted-foreground h-4 w-4 flex-shrink-0"
										/>
										<span class="text-xs font-medium">
											{$t('app.archive.retention_period')}:
										</span>
										<Badge variant="secondary">
											{emailRetentionLabel.retentionPeriodDays}
											{$t('app.retention_labels.days')}
										</Badge>
									</div>
									{#if scheduledDeletionDateByLabel}
										<div class="flex items-center gap-2">
											<CalendarClock
												class="text-muted-foreground h-4 w-4 flex-shrink-0"
											/>
											<span class="text-xs font-medium">
												{$t('app.archive.retention_scheduled_deletion')}:
											</span>
											<Badge
												variant={scheduledDeletionDateByLabel <= new Date()
													? 'destructive'
													: 'secondary'}
											>
												{scheduledDeletionDateByLabel.toLocaleDateString()}
											</Badge>
										</div>
									{/if}
									<p class="text-muted-foreground text-xs">
										{$t('app.archive_labels.label_overrides_policy')}
									</p>
									<form
										method="POST"
										action="?/removeLabel"
										use:enhance={() => {
											isRemovingLabel = true;
											return async ({ update }) => {
												isRemovingLabel = false;
												await update();
											};
										}}
									>
										<Button
											type="submit"
											variant="outline"
											size="sm"
											class="w-full text-xs"
											disabled={isRemovingLabel}
										>
											{#if isRemovingLabel}
												{$t('app.archive_labels.removing')}
											{:else}
												{$t('app.archive_labels.remove')}
											{/if}
										</Button>
									</form>
								</div>
							{/if}
						{:else if retentionLabels.length > 0}
							<!-- No label applied — show selector -->
							<p class="text-muted-foreground text-xs">
								{$t('app.archive_labels.no_label')}
							</p>
							<form
								method="POST"
								action="?/applyLabel"
								class="space-y-2"
								use:enhance={() => {
									isApplyingLabel = true;
									return async ({ update }) => {
										isApplyingLabel = false;
										await update();
									};
								}}
							>
								<input type="hidden" name="labelId" value={selectedLabelId} />
								<Select.Root
									type="single"
									value={selectedLabelId}
									onValueChange={(v) => (selectedLabelId = v)}
								>
									<Select.Trigger class="w-full text-xs">
										{#if selectedLabelId}
											{retentionLabels.find((l) => l.id === selectedLabelId)
												?.name ??
												$t('app.archive_labels.select_label_placeholder')}
										{:else}
											{$t('app.archive_labels.select_label_placeholder')}
										{/if}
									</Select.Trigger>
									<Select.Content class="text-xs">
										{#each retentionLabels as label (label.id)}
											<Select.Item value={label.id}>
												{label.name}
												<span class="text-muted-foreground ml-1 text-xs">
													({label.retentionPeriodDays}
													{$t('app.retention_labels.days')})
												</span>
											</Select.Item>
										{/each}
									</Select.Content>
								</Select.Root>

								<Button
									type="submit"
									variant="outline"
									size="sm"
									class="w-full text-xs"
									disabled={isApplyingLabel || !selectedLabelId}
								>
									{#if isApplyingLabel}
										{$t('app.archive_labels.applying')}
									{:else}
										{$t('app.archive_labels.apply')}
									{/if}
								</Button>
							</form>
						{:else}
							<p class="text-muted-foreground text-xs">
								{$t('app.archive_labels.no_labels_available')}
							</p>
						{/if}
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
