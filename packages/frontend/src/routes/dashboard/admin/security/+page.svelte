<script lang="ts">
	import { api } from '$lib/api.client';
	import { t } from '$lib/translations';
	import { setAlert } from '$lib/components/custom/alert/alert-state.svelte';
	import { invalidateAll } from '$app/navigation';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import { format } from 'date-fns';
	import type { AdvancedSecurityPolicy } from '@open-archiver/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Local editable copies of the policy
	let totpEnabled = $state(data.policy.totpEnabled);
	let totpEnforced = $state(data.policy.totpEnforced);
	let gracePeriodDays = $state(data.policy.gracePeriodDays);

	let isLoading = $state(false);

	async function savePolicy(e: SubmitEvent) {
		e.preventDefault();
		isLoading = true;
		try {
			const updatedPolicy: AdvancedSecurityPolicy = {
				totpEnabled,
				totpEnforced,
				gracePeriodDays,
				// Preserve the existing enforcedAt — the backend handles setting it when enforcement is first activated
				enforcedAt: data.policy.enforcedAt,
			};

			const res = await api('/enterprise/advanced-security/policy', {
				method: 'PUT',
				body: JSON.stringify(updatedPolicy),
			});

			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(err.message || $t('app.security.policy_save_failed'));
			}

			setAlert({
				type: 'success',
				title: $t('app.security.policy_saved'),
				message: $t('app.security.policy_saved_desc'),
				duration: 4000,
				show: true,
			});

			await invalidateAll();
		} catch (e: unknown) {
			setAlert({
				type: 'error',
				title: $t('app.security.policy_save_failed'),
				message: e instanceof Error ? e.message : String(e),
				duration: 5000,
				show: true,
			});
		} finally {
			isLoading = false;
		}
	}

	// Reset local state if data changes (after invalidateAll)
	$effect(() => {
		totpEnabled = data.policy.totpEnabled;
		totpEnforced = data.policy.totpEnforced;
		gracePeriodDays = data.policy.gracePeriodDays;
	});
</script>

<svelte:head>
	<title>{$t('app.security.admin_title')} - Open Archiver</title>
	<meta
		name="description"
		content="Configure organization-wide two-factor authentication policy in Open Archiver Enterprise."
	/>
</svelte:head>

<div class="space-y-6">
	<div>
		<h1 class="text-2xl font-bold">{$t('app.security.admin_title')}</h1>
		<p class="text-muted-foreground">{$t('app.security.admin_description')}</p>
	</div>

	<form onsubmit={savePolicy} class="space-y-6">
		<!-- Enable / Disable 2FA feature -->
		<Card.Root>
			<Card.Header>
				<Card.Title>{$t('app.security.totp_feature_title')}</Card.Title>
				<Card.Description>{$t('app.security.totp_feature_description')}</Card.Description>
			</Card.Header>
			<Card.Content>
				<div class="flex items-center justify-between">
					<div>
						<Label>{$t('app.security.enable_totp')}</Label>
						<p class="text-muted-foreground mt-1 text-sm">
							{$t('app.security.enable_totp_desc')}
						</p>
					</div>
					<Switch bind:checked={totpEnabled} />
				</div>
			</Card.Content>
		</Card.Root>

		<!-- Enforcement settings (only relevant when enabled) -->
		{#if totpEnabled}
			<Card.Root>
				<Card.Header>
					<Card.Title>{$t('app.security.enforcement_title')}</Card.Title>
					<Card.Description>{$t('app.security.enforcement_description')}</Card.Description
					>
				</Card.Header>
				<Card.Content class="space-y-6">
					<div class="flex items-center justify-between">
						<div>
							<Label>{$t('app.security.enforce_totp')}</Label>
							<p class="text-muted-foreground mt-1 text-sm">
								{$t('app.security.enforce_totp_desc')}
							</p>
						</div>
						<Switch bind:checked={totpEnforced} />
					</div>

					{#if totpEnforced}
						<div class="grid gap-2">
							<Label for="gracePeriodDays"
								>{$t('app.security.grace_period_label')}</Label
							>
							<p class="text-muted-foreground text-sm">
								{$t('app.security.grace_period_desc')}
							</p>
							<div class="flex items-center gap-2">
								<Input
									id="gracePeriodDays"
									type="number"
									min={0}
									max={90}
									bind:value={gracePeriodDays}
									class="w-24"
									required
								/>
								<span class="text-muted-foreground text-sm"
									>{$t('app.security.days')}</span
								>
							</div>
						</div>

						{#if data.policy.enforcedAt}
							<div class="text-muted-foreground text-sm">
								{$t('app.security.enforcement_started')}:
								<span class="text-foreground font-medium">
									{format(new Date(data.policy.enforcedAt), 'PPP')}
								</span>
							</div>
						{/if}
					{/if}
				</Card.Content>
			</Card.Root>
		{/if}

		<div class="flex justify-end">
			<Button type="submit" disabled={isLoading}>
				{isLoading ? $t('app.common.working') : $t('app.components.common.save')}
			</Button>
		</div>
	</form>
</div>
