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
	import { AlertTriangle } from 'lucide-svelte';
	import { Progress } from '$lib/components/ui/progress';
	import { format, formatDistanceToNow } from 'date-fns';
	import { t } from '$lib/translations';

	export let data: PageData;

	const seatUsagePercentage =
		data.licenseStatus.planSeats > 0
			? (data.licenseStatus.activeSeats / data.licenseStatus.planSeats) * 100
			: 0;
</script>

<svelte:head>
	<title>{$t('app.license_page.title')} - Open Archiver</title>
	<meta name="description" content={$t('app.license_page.meta_description')} />
</svelte:head>

<div class="space-y-6">
	<h1 class="text-2xl font-bold">{$t('app.license_page.title')}</h1>

	{#if data.licenseStatus.remoteStatus === 'REVOKED'}
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
				<p>
					{$t('app.license_page.revoked_message', {
						grace_period: data.licenseStatus.gracePeriodEnds
							? $t('app.license_page.revoked_grace_period', {
									date: format(
										new Date(data.licenseStatus.gracePeriodEnds),
										'PPP'
									),
								} as any)
							: $t('app.license_page.revoked_immediately'),
					} as any)}
				</p>
			</CardContent>
		</Card>
	{/if}

	{#if data.licenseStatus.activeSeats > data.licenseStatus.planSeats}
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
					} as any)}
				</p>
			</CardContent>
		</Card>
	{/if}

	<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
		<Card>
			<CardHeader>
				<CardTitle class="text-base">{$t('app.license_page.license_details')}</CardTitle>
			</CardHeader>
			<CardContent class="space-y-3 text-sm">
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
					{#if data.licenseStatus.remoteStatus === 'VALID' && !data.licenseStatus.isExpired}
						<Badge variant="default" class="bg-green-500 text-white"
							>{$t('app.license_page.active')}</Badge
						>
					{:else if data.licenseStatus.isExpired}
						<Badge variant="destructive">{$t('app.license_page.expired')}</Badge>
					{:else if data.licenseStatus.remoteStatus === 'REVOKED'}
						<Badge variant="destructive">{$t('app.license_page.revoked')}</Badge>
					{:else}
						<Badge variant="secondary">{$t('app.license_page.unknown')}</Badge>
					{/if}
				</div>
			</CardContent>
		</Card>
		<Card>
			<CardHeader>
				<CardTitle class="text-base">{$t('app.license_page.seat_usage')}</CardTitle>
				<CardDescription>
					{$t('app.license_page.seats_used', {
						activeSeats: data.licenseStatus.activeSeats,
						planSeats: data.licenseStatus.planSeats,
					} as any)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<Progress value={seatUsagePercentage} class="w-full" />
			</CardContent>
		</Card>
	</div>

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
							<TableCell class="font-medium capitalize"
								>{feature.replace('-', ' ')}</TableCell
							>
							<TableCell class="text-right">
								{#if enabled || data.licenseStatus.features.all === true}
									<Badge variant="default" class="bg-green-500 text-white"
										>{$t('app.license_page.enabled')}</Badge
									>
								{:else}
									<Badge variant="destructive"
										>{$t('app.license_page.disabled')}</Badge
									>
								{/if}
							</TableCell>
						</TableRow>
					{/each}
				</TableBody>
			</Table>
		</CardContent>
	</Card>
</div>
