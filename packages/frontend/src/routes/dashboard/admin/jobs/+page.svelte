<script lang="ts">
	import type { PageData } from './$types';
	import * as Card from '$lib/components/ui/card';
	import { t } from '$lib/translations';
	import { Badge } from '$lib/components/ui/badge';

	let { data }: { data: PageData } = $props();
	let queues = $derived(data.queues);
</script>

<svelte:head>
	<title>{$t('app.jobs.title')} - Open Archiver</title>
</svelte:head>

<div class="space-y-4">
	<h1 class="text-2xl font-bold">{$t('app.jobs.queues')}</h1>

	<div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
		{#each queues as queue}
			<a href={`/dashboard/admin/jobs/${queue.name}`} class="block">
				<Card.Root class=" hover:shadow-md">
					<Card.Header>
						<Card.Title class="capitalize">{queue.name.split('_').join(' ')}</Card.Title
						>
					</Card.Header>
					<Card.Content class="grid grid-cols-2 gap-2">
						<div class="flex items-center justify-between">
							<span class="text-sm font-medium">{$t('app.jobs.active')}</span>
							<Badge>{queue.counts.active}</Badge>
						</div>
						<div class="flex items-center justify-between">
							<span class="text-sm font-medium">{$t('app.jobs.completed')}</span>
							<Badge variant="default" class="bg-green-500"
								>{queue.counts.completed}</Badge
							>
						</div>
						<div class="flex items-center justify-between">
							<span class="text-sm font-medium">{$t('app.jobs.failed')}</span>
							<Badge variant="destructive">{queue.counts.failed}</Badge>
						</div>
						<div class="flex items-center justify-between">
							<span class="text-sm font-medium">{$t('app.jobs.delayed')}</span>
							<Badge variant="secondary">{queue.counts.delayed}</Badge>
						</div>
						<div class="flex items-center justify-between">
							<span class="text-sm font-medium">{$t('app.jobs.waiting')}</span>
							<Badge variant="outline">{queue.counts.waiting}</Badge>
						</div>
						<div class="flex items-center justify-between">
							<span class="text-sm font-medium">{$t('app.jobs.paused')}</span>
							<Badge variant="secondary">{queue.counts.paused}</Badge>
						</div>
					</Card.Content>
				</Card.Root>
			</a>
		{/each}
	</div>
</div>
