<script lang="ts">
	import { enhance } from '$app/forms';
	import { t } from '$lib/translations';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Badge } from '$lib/components/ui/badge';
	import { setAlert } from '$lib/components/custom/alert/alert-state.svelte';
	import { invalidateAll } from '$app/navigation';
	import { api } from '$lib/api.client';
	import { ShieldCheck, ShieldOff, Copy, RefreshCw } from 'lucide-svelte';
	import { format } from 'date-fns';
	import type { MfaSetupResponse, MfaEnrollResponse } from '@open-archiver/types';
	import * as Select from '$lib/components/ui/select';
	import { dateFormat, formatDateTime, type DateFormat } from '$lib/stores/dateFormat.store';

	const dateFormatOptions: { value: DateFormat; key: string }[] = [
		{ value: 'locale', key: 'app.account.date_format_locale' },
		{ value: 'iso', key: 'app.account.date_format_iso' },
		{ value: 'eu', key: 'app.account.date_format_eu' },
		{ value: 'us', key: 'app.account.date_format_us' },
	];
	const dateFormatLabel = $derived(
		dateFormatOptions.find((o) => o.value === $dateFormat)?.key ??
			'app.account.date_format_locale'
	);
	const dateFormatPreview = $derived(formatDateTime(new Date(), $dateFormat));

	let { data, form } = $props();
	let user = $derived(data.user);
	/**
	 * Password controls are hidden only for accounts that authenticate through
	 * single sign-on AND hold no password. Both conditions matter: auto-linking
	 * sets `provider` to 'oidc' or 'saml' on an account whose original password
	 * remains a working credential — hiding the controls there would leave a live
	 * password nobody can rotate. `hasPassword === false` is checked explicitly
	 * rather than falsily, so an older payload without the field keeps the
	 * controls visible instead of hiding them by accident.
	 */
	let isSsoAccount = $derived(
		Boolean(user?.provider && user.provider !== 'local' && user.hasPassword === false)
	);
	/**
	 * The address, unlike the password controls, turns on `provider` alone.
	 * `isSsoAccount` is deliberately narrower — it also requires the account to hold
	 * no password — and reusing it here would leave the address editable on exactly
	 * the linked accounts where a self-chosen address does the most damage: it is
	 * what a future assertion links to, and what the "require single sign-on" policy
	 * reads to decide whom it covers.
	 */
	let isFederatedAccount = $derived(Boolean(user?.provider && user.provider !== 'local'));

	// ---- 2FA state (only used in enterprise mode) ----
	type SetupStep = 'idle' | 'qr' | 'backup-codes';
	let setupStep = $state<SetupStep>('idle');
	let setupData = $state<MfaSetupResponse | null>(null);
	let verifyCode = $state('');
	let backupCodes = $state<string[]>([]);
	let mfaLoading = $state(false);

	let isDisable2faDialogOpen = $state(false);
	let disableCode = $state('');

	let isRegenDialogOpen = $state(false);
	let regenCode = $state('');
	let regenBackupCodes = $state<string[]>([]);

	async function startSetup() {
		mfaLoading = true;
		try {
			const res = await api('/auth/mfa/setup', { method: 'POST' });
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(err.message || $t('app.security.setup_failed'));
			}
			setupData = (await res.json()) as MfaSetupResponse;
			setupStep = 'qr';
		} catch (e: unknown) {
			setAlert({
				type: 'error',
				title: $t('app.security.setup_failed'),
				message: e instanceof Error ? e.message : String(e),
				duration: 5000,
				show: true,
			});
		} finally {
			mfaLoading = false;
		}
	}

	async function submitEnroll(e: SubmitEvent) {
		e.preventDefault();
		if (!setupData) return;
		mfaLoading = true;
		try {
			const res = await api('/auth/mfa/enroll', {
				method: 'POST',
				// The secret is stored server-side in Redis — only the code is needed here.
				body: JSON.stringify({ code: verifyCode }),
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(err.message || $t('app.security.enroll_failed'));
			}
			const enrollData: MfaEnrollResponse = await res.json();
			backupCodes = enrollData.backupCodes;
			setupStep = 'backup-codes';
		} catch (e: unknown) {
			setAlert({
				type: 'error',
				title: $t('app.security.enroll_failed'),
				message: e instanceof Error ? e.message : String(e),
				duration: 5000,
				show: true,
			});
		} finally {
			mfaLoading = false;
		}
	}

	async function finishSetup() {
		setupStep = 'idle';
		setupData = null;
		verifyCode = '';
		backupCodes = [];
		await invalidateAll();
	}

	async function submitDisable(e: SubmitEvent) {
		e.preventDefault();
		mfaLoading = true;
		try {
			const res = await api('/auth/mfa/disable', {
				method: 'POST',
				body: JSON.stringify({ code: disableCode }),
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(err.message || $t('app.security.disable_failed'));
			}
			isDisable2faDialogOpen = false;
			disableCode = '';
			setAlert({
				type: 'success',
				title: $t('app.security.disable_success'),
				message: $t('app.security.disable_success_desc'),
				duration: 4000,
				show: true,
			});
			await invalidateAll();
		} catch (e: unknown) {
			setAlert({
				type: 'error',
				title: $t('app.security.disable_failed'),
				message: e instanceof Error ? e.message : String(e),
				duration: 5000,
				show: true,
			});
		} finally {
			mfaLoading = false;
		}
	}

	async function submitRegen(e: SubmitEvent) {
		e.preventDefault();
		mfaLoading = true;
		try {
			const res = await api('/auth/mfa/backup-codes', {
				method: 'POST',
				body: JSON.stringify({ code: regenCode }),
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(err.message || $t('app.security.regen_failed'));
			}
			const regenData: MfaEnrollResponse = await res.json();
			regenBackupCodes = regenData.backupCodes;
			regenCode = '';
		} catch (e: unknown) {
			setAlert({
				type: 'error',
				title: $t('app.security.regen_failed'),
				message: e instanceof Error ? e.message : String(e),
				duration: 5000,
				show: true,
			});
		} finally {
			mfaLoading = false;
		}
	}

	function closeRegenDialog() {
		isRegenDialogOpen = false;
		regenCode = '';
		regenBackupCodes = [];
	}

	async function copyToClipboard(text: string) {
		await navigator.clipboard.writeText(text);
		setAlert({
			type: 'success',
			title: $t('app.security.copied'),
			message: '',
			duration: 2000,
			show: true,
		});
	}

	let isProfileDialogOpen = $state(false);
	let isPasswordDialogOpen = $state(false);
	let isSubmitting = $state(false);

	// Profile form state
	let profileFirstName = $state('');
	let profileLastName = $state('');
	let profileEmail = $state('');

	// Password form state
	let currentPassword = $state('');
	let newPassword = $state('');
	let confirmNewPassword = $state('');

	// Preload profile form
	$effect(() => {
		if (user && isProfileDialogOpen) {
			profileFirstName = user.first_name || '';
			profileLastName = user.last_name || '';
			profileEmail = user.email || '';
		}
	});

	// Handle form actions result
	$effect(() => {
		if (form) {
			isSubmitting = false;
			if (form.success) {
				isProfileDialogOpen = false;
				isPasswordDialogOpen = false;
				setAlert({
					type: 'success',
					title: $t('app.account.operation_successful'),
					message: $t('app.account.operation_successful'),
					duration: 3000,
					show: true,
				});
			} else if (form.profileError || form.passwordError) {
				setAlert({
					type: 'error',
					title: $t('app.search.error'),
					message: form.message,
					duration: 3000,
					show: true,
				});
			}
		}
	});

	function openProfileDialog() {
		isProfileDialogOpen = true;
	}

	function openPasswordDialog() {
		currentPassword = '';
		newPassword = '';
		confirmNewPassword = '';
		isPasswordDialogOpen = true;
	}
</script>

<svelte:head>
	<title>{$t('app.account.title')} - OpenArchiver</title>
</svelte:head>

<div class="space-y-6">
	<div>
		<h1 class="text-2xl font-bold">{$t('app.account.title')}</h1>
		<p class="text-muted-foreground">{$t('app.account.description')}</p>
	</div>

	<!-- Personal Information -->
	<Card.Root>
		<Card.Header>
			<Card.Title>{$t('app.account.personal_info')}</Card.Title>
		</Card.Header>
		<Card.Content class="space-y-4">
			<div class="grid grid-cols-2 gap-4">
				<div>
					<Label class="text-muted-foreground">{$t('app.users.name')}</Label>
					<p class="text-sm font-medium">{user?.first_name} {user?.last_name}</p>
				</div>
				<div>
					<Label class="text-muted-foreground">{$t('app.users.email')}</Label>
					<p class="text-sm font-medium">{user?.email}</p>
				</div>
				<div>
					<Label class="text-muted-foreground">{$t('app.users.role')}</Label>
					<p class="text-sm font-medium">{user?.role?.name || '-'}</p>
				</div>
			</div>
		</Card.Content>
		<Card.Footer>
			<Button variant="outline" onclick={openProfileDialog}
				>{$t('app.account.edit_profile')}</Button
			>
		</Card.Footer>
	</Card.Root>

	<!-- Security -->
	<Card.Root>
		<Card.Header>
			<Card.Title>{$t('app.account.security')}</Card.Title>
		</Card.Header>
		<Card.Content>
			<div class="flex items-center justify-between">
				<div>
					<Label class="text-muted-foreground">{$t('app.auth.password')}</Label>
					{#if isSsoAccount}
						<p class="text-muted-foreground text-sm">
							{$t('app.account.password_managed_by_idp')}
						</p>
					{:else}
						<p class="text-sm">*************</p>
					{/if}
				</div>
			</div>
		</Card.Content>
		<!--
			An SSO account has no password to change: it was provisioned by the
			identity provider and authenticates there. Offering the dialog would
			produce a failure with no explanation.
		-->
		{#if !isSsoAccount}
			<Card.Footer>
				<Button variant="outline" onclick={openPasswordDialog}
					>{$t('app.account.change_password')}</Button
				>
			</Card.Footer>
		{/if}
	</Card.Root>

	<!-- Preferences -->
	<Card.Root>
		<Card.Header>
			<Card.Title>{$t('app.account.preferences')}</Card.Title>
			<Card.Description>{$t('app.account.preferences_desc')}</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-4">
			<div class="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
				<div>
					<Label for="date_format">{$t('app.account.date_format')}</Label>
					<p class="text-muted-foreground text-sm">
						{$t('app.account.date_format_desc')}
					</p>
					<p class="text-muted-foreground mt-1 text-xs">
						{dateFormatPreview}
					</p>
				</div>
				<Select.Root
					type="single"
					value={$dateFormat}
					onValueChange={(v) => {
						if (v) $dateFormat = v as DateFormat;
					}}
				>
					<Select.Trigger id="date_format" class="w-full sm:w-[260px]">
						{$t(dateFormatLabel)}
					</Select.Trigger>
					<Select.Content>
						{#each dateFormatOptions as option (option.value)}
							<Select.Item value={option.value}>{$t(option.key)}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
		</Card.Content>
	</Card.Root>
	<!-- Two-Factor Authentication -->
	{#if data.mfaStatus !== null}
		<Card.Root>
			<Card.Header class="flex flex-row items-center justify-between space-y-0">
				<div>
					<Card.Title>{$t('app.security.totp_title')}</Card.Title>
					<Card.Description class="mt-1"
						>{$t('app.security.totp_description')}</Card.Description
					>
				</div>
				{#if data.mfaStatus?.totpEnabled}
					<Badge class="bg-green-500 text-white">
						<ShieldCheck class="mr-1 h-3 w-3" />
						{$t('app.security.enabled')}
					</Badge>
				{:else}
					<Badge variant="secondary">
						<ShieldOff class="mr-1 h-3 w-3" />
						{$t('app.security.not_enabled')}
					</Badge>
				{/if}
			</Card.Header>

			<Card.Content class="space-y-3 text-sm">
				{#if data.mfaStatus?.totpEnabled && data.mfaStatus.enrolledAt}
					<div class="flex justify-between">
						<span class="text-muted-foreground">{$t('app.security.enrolled_at')}</span>
						<span class="font-medium">
							{format(new Date(data.mfaStatus.enrolledAt), 'PPP')}
						</span>
					</div>
				{/if}

				{#if !data.mfaStatus?.totpEnabled}
					{#if data.mfaStatus?.graceDeadline}
						{@const deadline = new Date(data.mfaStatus.graceDeadline)}
						{@const isOverdue = deadline < new Date()}
						<div
							class={[
								'rounded border p-3 text-sm',
								isOverdue
									? 'border-destructive bg-destructive/10 text-destructive'
									: 'border-yellow-400 bg-yellow-50 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200',
							].join(' ')}
						>
							{#if isOverdue}
								{$t('app.security.grace_expired_warning')}
							{:else}
								{$t('app.security.grace_deadline_warning', {
									date: format(deadline, 'PPP'),
								} as never)}
							{/if}
						</div>
					{/if}
					{#if setupStep === 'idle'}
						<p class="text-muted-foreground">{$t('app.security.totp_setup_prompt')}</p>
					{:else if setupStep === 'qr' && setupData}
						<div class="space-y-4">
							<p>{$t('app.security.qr_instruction')}</p>
							<div class="flex justify-center">
								<img
									src={setupData.qrCodeDataUrl}
									alt="TOTP QR Code"
									class="h-48 w-48 rounded border"
								/>
							</div>
							<details class="text-muted-foreground text-xs">
								<summary class="cursor-pointer"
									>{$t('app.security.manual_entry')}</summary
								>
								<div class="bg-muted mt-2 break-all rounded p-2 font-mono">
									{setupData.otpAuthUrl}
								</div>
							</details>
							<form onsubmit={submitEnroll} class="space-y-3">
								<div class="grid gap-2">
									<Label for="verifyCode"
										>{$t('app.security.enter_code_to_confirm')}</Label
									>
									<Input
										id="verifyCode"
										type="text"
										inputmode="numeric"
										maxlength={6}
										placeholder="000000"
										bind:value={verifyCode}
										required
									/>
								</div>
								<div class="flex gap-2">
									<Button type="submit" disabled={mfaLoading}>
										{mfaLoading
											? $t('app.common.working')
											: $t('app.security.confirm_enrollment')}
									</Button>
									<Button
										type="button"
										variant="outline"
										onclick={() => {
											setupStep = 'idle';
											setupData = null;
										}}
									>
										{$t('app.archive.cancel')}
									</Button>
								</div>
							</form>
						</div>
					{:else if setupStep === 'backup-codes'}
						<div class="space-y-4">
							<div
								class="rounded border border-yellow-400 bg-yellow-50 p-3 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200"
							>
								<p class="font-semibold">
									{$t('app.security.backup_codes_warning_title')}
								</p>
								<p class="text-sm">{$t('app.security.backup_codes_warning')}</p>
							</div>
							<div class="grid grid-cols-2 gap-2">
								{#each backupCodes as bCode}
									<div
										class="bg-muted flex items-center justify-between rounded px-3 py-2 font-mono text-sm"
									>
										<span>{bCode}</span>
									</div>
								{/each}
							</div>
							<div class="flex gap-2">
								<Button
									variant="outline"
									onclick={() => copyToClipboard(backupCodes.join('\n'))}
								>
									<Copy class="mr-2 h-4 w-4" />
									{$t('app.security.copy_backup_codes')}
								</Button>
								<Button onclick={finishSetup}>{$t('app.security.done')}</Button>
							</div>
						</div>
					{/if}
				{/if}
			</Card.Content>

			<Card.Footer class="flex gap-2">
				{#if !data.mfaStatus?.totpEnabled && setupStep === 'idle'}
					<Button onclick={startSetup} disabled={mfaLoading}>
						{mfaLoading ? $t('app.common.working') : $t('app.security.setup_2fa')}
					</Button>
				{:else if data.mfaStatus?.totpEnabled}
					<Button
						variant="outline"
						onclick={() => {
							isRegenDialogOpen = true;
						}}
					>
						<RefreshCw class="mr-2 h-4 w-4" />
						{$t('app.security.regenerate_backup_codes')}
					</Button>
					<Button
						variant="destructive"
						onclick={() => {
							isDisable2faDialogOpen = true;
						}}
					>
						{$t('app.security.disable_2fa')}
					</Button>
				{/if}
			</Card.Footer>
		</Card.Root>
	{/if}
</div>

<!-- Profile Edit Dialog -->
<Dialog.Root bind:open={isProfileDialogOpen}>
	<Dialog.Content class="sm:max-w-[425px]">
		<Dialog.Header>
			<Dialog.Title>{$t('app.account.edit_profile')}</Dialog.Title>
			<Dialog.Description>{$t('app.account.edit_profile_desc')}</Dialog.Description>
		</Dialog.Header>
		<form
			method="POST"
			action="?/updateProfile"
			use:enhance={() => {
				isSubmitting = true;
				return async ({ update }) => {
					await update();
					isSubmitting = false;
				};
			}}
			class="grid gap-4 py-4"
		>
			<div class="grid grid-cols-4 items-center gap-4">
				<Label for="first_name" class="text-right">{$t('app.setup.first_name')}</Label>
				<Input
					id="first_name"
					name="first_name"
					bind:value={profileFirstName}
					class="col-span-3"
				/>
			</div>
			<div class="grid grid-cols-4 items-center gap-4">
				<Label for="last_name" class="text-right">{$t('app.setup.last_name')}</Label>
				<Input
					id="last_name"
					name="last_name"
					bind:value={profileLastName}
					class="col-span-3"
				/>
			</div>
			<div class="grid grid-cols-4 items-center gap-4">
				<Label for="email" class="text-right">{$t('app.users.email')}</Label>
				{#if isFederatedAccount}
					<!-- Shown rather than edited. The server refuses the change either way;
					     this is what keeps the form from offering something it cannot do. -->
					<div class="col-span-3 space-y-1">
						<p class="text-sm font-medium">{user?.email}</p>
						<p class="text-muted-foreground text-xs">
							{$t('app.account.email_managed_by_idp')}
						</p>
					</div>
				{:else}
					<Input
						id="email"
						name="email"
						type="email"
						bind:value={profileEmail}
						class="col-span-3"
					/>
				{/if}
			</div>
			<Dialog.Footer>
				<Button type="submit" disabled={isSubmitting}>
					{#if isSubmitting}
						{$t('app.components.common.submitting')}
					{:else}
						{$t('app.components.common.save')}
					{/if}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<!-- Change Password Dialog -->
<Dialog.Root bind:open={isPasswordDialogOpen}>
	<Dialog.Content class="sm:max-w-[425px]">
		<Dialog.Header>
			<Dialog.Title>{$t('app.account.change_password')}</Dialog.Title>
			<Dialog.Description>{$t('app.account.change_password_desc')}</Dialog.Description>
		</Dialog.Header>
		<form
			method="POST"
			action="?/updatePassword"
			use:enhance={({ cancel }) => {
				if (newPassword !== confirmNewPassword) {
					setAlert({
						type: 'error',
						title: $t('app.search.error'),
						message: $t('app.account.passwords_do_not_match'),
						duration: 3000,
						show: true,
					});
					cancel();
					return;
				}
				isSubmitting = true;
				return async ({ update }) => {
					await update();
					isSubmitting = false;
				};
			}}
			class="grid gap-4 py-4"
		>
			<div class="grid grid-cols-4 items-center gap-4">
				<Label for="currentPassword" class="text-right"
					>{$t('app.account.current_password')}</Label
				>
				<Input
					id="currentPassword"
					name="currentPassword"
					type="password"
					bind:value={currentPassword}
					class="col-span-3"
					required
				/>
			</div>
			<div class="grid grid-cols-4 items-center gap-4">
				<Label for="newPassword" class="text-right">{$t('app.account.new_password')}</Label>
				<Input
					id="newPassword"
					name="newPassword"
					type="password"
					bind:value={newPassword}
					class="col-span-3"
					required
				/>
			</div>
			<div class="grid grid-cols-4 items-center gap-4">
				<Label for="confirmNewPassword" class="text-right"
					>{$t('app.account.confirm_new_password')}</Label
				>
				<Input
					id="confirmNewPassword"
					type="password"
					bind:value={confirmNewPassword}
					class="col-span-3"
					required
				/>
			</div>
			<Dialog.Footer>
				<Button type="submit" disabled={isSubmitting}>
					{#if isSubmitting}
						{$t('app.components.common.submitting')}
					{:else}
						{$t('app.components.common.save')}
					{/if}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<!-- Disable 2FA Dialog (enterprise only) -->
<Dialog.Root bind:open={isDisable2faDialogOpen}>
	<Dialog.Content class="sm:max-w-[400px]">
		<Dialog.Header>
			<Dialog.Title>{$t('app.security.disable_2fa')}</Dialog.Title>
			<Dialog.Description>{$t('app.security.disable_2fa_desc')}</Dialog.Description>
		</Dialog.Header>
		<form onsubmit={submitDisable} class="grid gap-4 py-4">
			<div class="grid gap-2">
				<Label for="disableCode">{$t('app.auth.mfa_code_label')}</Label>
				<Input
					id="disableCode"
					type="text"
					inputmode="numeric"
					maxlength={8}
					placeholder="000000"
					bind:value={disableCode}
					required
				/>
			</div>
			<Dialog.Footer>
				<Button
					type="button"
					variant="outline"
					onclick={() => {
						isDisable2faDialogOpen = false;
						disableCode = '';
					}}
				>
					{$t('app.archive.cancel')}
				</Button>
				<Button type="submit" variant="destructive" disabled={mfaLoading}>
					{mfaLoading ? $t('app.common.working') : $t('app.security.disable_2fa')}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<!-- Regenerate Backup Codes Dialog (enterprise only) -->
<Dialog.Root
	open={isRegenDialogOpen}
	onOpenChange={(open) => {
		if (!open) closeRegenDialog();
	}}
>
	<Dialog.Content class="sm:max-w-[400px]">
		<Dialog.Header>
			<Dialog.Title>{$t('app.security.regenerate_backup_codes')}</Dialog.Title>
			<Dialog.Description
				>{$t('app.security.regenerate_backup_codes_desc')}</Dialog.Description
			>
		</Dialog.Header>

		{#if regenBackupCodes.length === 0}
			<form onsubmit={submitRegen} class="grid gap-4 py-4">
				<div class="grid gap-2">
					<Label for="regenCode">{$t('app.auth.mfa_code_label')}</Label>
					<Input
						id="regenCode"
						type="text"
						inputmode="numeric"
						maxlength={8}
						placeholder="000000"
						bind:value={regenCode}
						required
					/>
				</div>
				<Dialog.Footer>
					<Button type="button" variant="outline" onclick={closeRegenDialog}>
						{$t('app.archive.cancel')}
					</Button>
					<Button type="submit" disabled={mfaLoading}>
						{mfaLoading ? $t('app.common.working') : $t('app.security.regenerate')}
					</Button>
				</Dialog.Footer>
			</form>
		{:else}
			<div class="space-y-4 py-4">
				<div
					class="rounded border border-yellow-400 bg-yellow-50 p-3 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200"
				>
					<p class="text-sm">{$t('app.security.backup_codes_warning')}</p>
				</div>
				<div class="grid grid-cols-2 gap-2">
					{#each regenBackupCodes as bCode}
						<div
							class="bg-muted flex items-center justify-between rounded px-3 py-2 font-mono text-sm"
						>
							<span>{bCode}</span>
						</div>
					{/each}
				</div>
				<div class="flex gap-2">
					<Button
						variant="outline"
						onclick={() => copyToClipboard(regenBackupCodes.join('\n'))}
					>
						<Copy class="mr-2 h-4 w-4" />
						{$t('app.security.copy_backup_codes')}
					</Button>
					<Button onclick={closeRegenDialog}>{$t('app.security.done')}</Button>
				</div>
			</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>
