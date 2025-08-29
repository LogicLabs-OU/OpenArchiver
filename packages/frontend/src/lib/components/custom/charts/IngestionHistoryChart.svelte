<script lang="ts">
	import * as Chart from '$lib/components/ui/chart/index.js';
	import { AreaChart } from 'layerchart';
	import { curveMonotoneX } from 'd3-shape';
	import type { ChartConfig } from '$lib/components/ui/chart';
	import { t } from '$lib/translations';

	export let data: { date: Date; count: number }[];

	const chartConfig = {
		count: {
			label: $t('app.components.charts.emails_ingested'),
			color: 'var(--chart-1)',
		},
	} satisfies ChartConfig;
</script>

<Chart.Container config={chartConfig} class="min-h-[300px] w-full">
	<AreaChart
		{data}
		x="date"
		y="count"
		yDomain={[0, Math.max(...data.map((d) => d.count)) * 1.1]}
		axis
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
		props={{
			xAxis: {
				format: (d) =>
					new Date(d).toLocaleDateString(undefined, {
						month: 'short',
						day: 'numeric',
					}),
			},
			area: { curve: curveMonotoneX },
		}}
	>
		{#snippet tooltip()}
			<Chart.Tooltip
				labelFormatter={(value) =>
					(value instanceof Date ? value : new Date(value)).toLocaleString(undefined, {
						month: 'short',
						day: 'numeric',
						hour: '2-digit',
						minute: '2-digit',
					})}
			/>
		{/snippet}
	</AreaChart>
</Chart.Container>
