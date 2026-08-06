<script lang="ts">
	import type { PageData } from './$types';
	import { Badge } from '$lib/components/ui/badge';
	import {
		Card,
		CardContent,
		CardHeader,
		CardTitle,
		CardDescription,
	} from '$lib/components/ui/card';
	import {
		Table,
		TableBody,
		TableCell,
		TableHead,
		TableHeader,
		TableRow,
	} from '$lib/components/ui/table';
	import { AlertTriangle, Loader2 } from 'lucide-svelte';
	import { Progress } from '$lib/components/ui/progress';
	import { format, formatDistanceToNow } from 'date-fns';
	import { t } from '$lib/translations';
	import { Button } from '$lib/components/ui/button';
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { invalidateAll } from '$app/navigation';

	let { data }: { data: PageData } = $props();

	let isRevalidating = $state(false);

	// Seat usage as a 0–100 percentage, capped at 100 for the progress bar.
	const seatUsagePercentage = $derived(
		data.licenseStatus.planSeats > 0
			? Math.min((data.licenseStatus.activeSeats / data.licenseStatus.planSeats) * 100, 100)
			: 0
	);

	// License has been revoked or the overage grace period has expired.
	const isInvalid = $derived(data.licenseStatus.remoteStatus === 'INVALID');

	// Seats exceed the plan but the 14-day grace period is still active.
	const isInOverageGrace = $derived(
		data.licenseStatus.remoteStatus === 'VALID' &&
			!!data.licenseStatus.gracePeriodEnds &&
			new Date(data.licenseStatus.gracePeriodEnds) > new Date()
	);
</script>

<svelte:head>
	<title>{$t('app.license_page.title')} - Open Archiver</title>
	<meta name="description" content={$t('app.license_page.meta_description')} />
</svelte:head>

<div class="space-y-6">
	<h1 class="text-2xl font-bold">{$t('app.license_page.title')}</h1>

	<!-- INVALID banner: license revoked or overage grace period expired -->
	{#if isInvalid}
		<Card class="border-destructive">
			<CardHeader>
				<div class="flex items-center gap-3">
					<AlertTriangle class="text-destructive h-6 w-6" />
					<CardTitle class="text-destructive"
						>{$t('app.license_page.revoked_title')}</CardTitle
					>
				</div>
			</CardHeader>
			<CardContent>
				<p>{$t('app.license_page.revoked_message')}</p>
				{#if data.licenseStatus.message}
					<p class="mt-2 font-semibold">{data.licenseStatus.message}</p>
				{/if}
			</CardContent>
		</Card>
	{/if}

	<!-- Message banner: warning or info from server (only shown if not invalid, to avoid clutter) -->
	{#if !isInvalid && data.licenseStatus.message}
		<Card class="border-yellow-500">
			<CardHeader>
				<div class="flex items-center gap-3">
					<AlertTriangle class="h-6 w-6 text-yellow-500" />
					<CardTitle class="text-yellow-600"
						>{$t('app.license_page.notice_title')}</CardTitle
					>
				</div>
			</CardHeader>
			<CardContent>
				<p>{data.licenseStatus.message}</p>
			</CardContent>
		</Card>
	{/if}

	<!-- Seat overage warning: grace period still active -->
	{#if isInOverageGrace && data.licenseStatus.gracePeriodEnds}
		<Card class="border-yellow-500">
			<CardHeader>
				<div class="flex items-center gap-3">
					<AlertTriangle class="h-6 w-6 text-yellow-500" />
					<CardTitle class="text-yellow-600"
						>{$t('app.license_page.seat_limit_exceeded_title')}</CardTitle
					>
				</div>
			</CardHeader>
			<CardContent>
				<p>
					{$t('app.license_page.seat_limit_exceeded_message', {
						planSeats: data.licenseStatus.planSeats,
						activeSeats: data.licenseStatus.activeSeats,
					} as never)}
				</p>
				<p class="text-muted-foreground mt-1 text-sm">
					{$t('app.license_page.seat_limit_grace_deadline', {
						date: format(new Date(data.licenseStatus.gracePeriodEnds), 'PPP'),
					} as never)}
				</p>
			</CardContent>
		</Card>
	{/if}

	<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
		<!-- License details -->
		<Card>
			<CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
				<CardTitle class="text-base">{$t('app.license_page.license_details')}</CardTitle>
				<form
					method="POST"
					action="?/revalidate"
					use:enhance={() => {
						isRevalidating = true;
						return async ({ result }) => {
							isRevalidating = false;
							if (result.type === 'success') {
								await invalidateAll();
								toast.success($t('app.license_page.revalidate_success'));
							} else {
								toast.error($t('app.license_page.could_not_load_message'));
							}
						};
					}}
				>
					<Button variant="outline" size="sm" type="submit" disabled={isRevalidating}>
						{#if isRevalidating}
							<Loader2 class="mr-2 h-4 w-4 animate-spin" />
							{$t('app.license_page.revalidating')}
						{:else}
							{$t('app.license_page.revalidate')}
						{/if}
					</Button>
				</form>
			</CardHeader>
			<CardContent class="space-y-3 pt-4 text-sm">
				<div class="flex justify-between">
					<span class="text-muted-foreground">{$t('app.license_page.customer')}</span>
					<span class="font-medium">{data.licenseStatus.customerName}</span>
				</div>
				<div class="flex justify-between">
					<span class="text-muted-foreground">{$t('app.license_page.expires')}</span>
					<span class="font-medium">
						{format(new Date(data.licenseStatus.expiresAt), 'PPP')}
						({formatDistanceToNow(new Date(data.licenseStatus.expiresAt), {
							addSuffix: true,
						})})
					</span>
				</div>
				<div class="flex justify-between">
					<span class="text-muted-foreground">{$t('app.license_page.status')}</span>
					{#if data.licenseStatus.isExpired}
						<Badge variant="destructive">{$t('app.license_page.expired')}</Badge>
					{:else if isInvalid}
						<Badge variant="destructive">{$t('app.license_page.revoked')}</Badge>
					{:else if isInOverageGrace}
						<Badge class="border-yellow-500 bg-yellow-100 text-yellow-700">
							{$t('app.license_page.overage')}
						</Badge>
					{:else if data.licenseStatus.remoteStatus === 'VALID'}
						<Badge variant="default" class="bg-green-500 text-white">
							{$t('app.license_page.active')}
						</Badge>
					{:else}
						<Badge variant="secondary">{$t('app.license_page.unknown')}</Badge>
					{/if}
				</div>
				{#if data.licenseStatus.lastCheckedAt}
					<div class="flex justify-between">
						<span class="text-muted-foreground"
							>{$t('app.license_page.last_checked')}</span
						>
						<span class="text-muted-foreground text-xs">
							{formatDistanceToNow(new Date(data.licenseStatus.lastCheckedAt), {
								addSuffix: true,
							})}
						</span>
					</div>
				{/if}
			</CardContent>
		</Card>

		<!-- Seat usage -->
		<Card>
			<CardHeader>
				<CardTitle class="text-base">{$t('app.license_page.seat_usage')}</CardTitle>
				<CardDescription>
					{$t('app.license_page.seats_used', {
						activeSeats: data.licenseStatus.activeSeats,
						planSeats: data.licenseStatus.planSeats,
					} as never)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<Progress
					value={seatUsagePercentage}
					class={isInOverageGrace ? '[&>div]:bg-yellow-500' : 'w-full'}
				/>
			</CardContent>
		</Card>
	</div>

	<!-- Feature status table -->
	<Card>
		<CardHeader>
			<CardTitle>{$t('app.license_page.enabled_features')}</CardTitle>
			<CardDescription>
				{$t('app.license_page.enabled_features_description')}
			</CardDescription>
		</CardHeader>
		<CardContent>
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>{$t('app.license_page.feature')}</TableHead>
						<TableHead class="text-right">{$t('app.license_page.status')}</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{#each Object.entries(data.licenseStatus.features) as [feature, enabled]}
						<TableRow>
							<TableCell class="font-medium capitalize">
								{feature.replace(/-/g, ' ')}
							</TableCell>
							<TableCell class="text-right">
								{#if enabled}
									<Badge variant="default" class="bg-green-500 text-white">
										{$t('app.license_page.enabled')}
									</Badge>
								{:else}
									<Badge variant="destructive">
										{$t('app.license_page.disabled')}
									</Badge>
								{/if}
							</TableCell>
						</TableRow>
					{/each}
				</TableBody>
			</Table>
		</CardContent>
	</Card>
</div>
