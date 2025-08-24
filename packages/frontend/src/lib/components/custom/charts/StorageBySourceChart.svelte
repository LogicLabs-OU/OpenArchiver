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

<Chart.Container
	config={chartConfig}
	class=" flex  h-full w-full flex-col overflow-y-auto [&_.lc-legend-swatch-group]:overflow-x-auto "
>
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
			<Chart.Tooltip>
				{#snippet formatter({ value, item })}
					{item.payload.name}: {formatBytes(value as number)}
				{/snippet}
			</Chart.Tooltip>
		{/snippet}
	</PieChart>
</Chart.Container>
