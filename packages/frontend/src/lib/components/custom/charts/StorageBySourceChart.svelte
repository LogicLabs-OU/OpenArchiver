<script lang="ts">
	import * as Chart from '$lib/components/ui/chart/index.js';
	import { PieChart } from 'layerchart';
	import type { IngestionSourceStats } from '@open-archiver/types';
	import type { ChartConfig } from '$lib/components/ui/chart';
	import { formatBytes } from '$lib/utils';

	export let data: IngestionSourceStats[];

	const chartConfig = {
		storageUsed: {
			label: 'Storage Used',
		},
	} satisfies ChartConfig;
</script>

<Chart.Container config={chartConfig} class="h-full min-h-[300px] w-full">
	<PieChart
		{data}
		key="name"
		value="storageUsed"
		label="name"
		legend={{}}
		cRange={[
			'var(--color-chart-1)',
			'var(--color-chart-2)',
			'var(--color-chart-3)',
			'var(--color-chart-4)',
			'var(--color-chart-5)',
		]}
	>
		{#snippet tooltip()}
			<Chart.Tooltip
				formatter={({ value, item }) =>
					`${item.payload.name}: ${formatBytes(Number(value))}`}
			/>
		{/snippet}
	</PieChart>
</Chart.Container>
