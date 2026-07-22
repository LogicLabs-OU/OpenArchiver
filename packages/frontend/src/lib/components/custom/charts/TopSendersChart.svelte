<script lang="ts">
	import * as Chart from '$lib/components/ui/chart/index.js';
	import { BarChart } from 'layerchart';
	import type { TopSender } from '@open-archiver/types';
	import type { ChartConfig } from '$lib/components/ui/chart';
	import { t } from '$lib/translations';

	export let data: TopSender[];

	// Show the resolved display name when known, falling back to the address (#413).
	$: chartData = data.map((d) => ({ ...d, sender: d.senderName || d.sender }));

	const chartConfig = {
		count: {
			label: $t('app.components.charts.emails'),
		},
	} satisfies ChartConfig;
</script>

<Chart.Container config={chartConfig} class="min-h-[300px] w-full">
	<BarChart
		data={chartData}
		x="count"
		y="sender"
		orientation="horizontal"
		xDomain={[0, Math.max(...chartData.map((d) => d.count)) * 1.1]}
		axis={'x'}
		legend={false}
		series={[
			{
				key: 'count',
				...chartConfig.count,
			},
		]}
		cRange={[
			'var(--color-chart-1)',
			'var(--color-chart-2)',
			'var(--color-chart-3)',
			'var(--color-chart-4)',
			'var(--color-chart-5)',
		]}
		labels={{}}
	>
		{#snippet tooltip()}
			<Chart.Tooltip />
		{/snippet}
	</BarChart>
</Chart.Container>
