<script lang="ts">
	import * as Chart from '$lib/components/ui/chart/index.js';
	import { AreaChart } from 'layerchart';
	import { curveMonotoneX } from 'd3-shape';
	import type { ChartConfig } from '$lib/components/ui/chart';
	import { niceAxisMax } from '$lib/utils';
	import { t } from '$lib/translations';

	export let data: { date: Date; count: number }[];

	$: axisMax = niceAxisMax(Math.max(...data.map((d) => d.count)));

	// Room for the widest y-axis label, which is always the topmost one. layerchart reserves a
	// flat 20px for a y axis, and the tick labels are drawn to the left of the plot inside it —
	// so "20,000" spilled past the card's edge and was cut off. Derived from the label rather
	// than fixed, because the archive decides how many digits it has: a 12px label runs about
	// 7px per character, plus the gap to the plot.
	$: yAxisWidth = axisMax.toLocaleString().length * 7 + 14;

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
		yDomain={[0, axisMax]}
		axis
		legend={false}
		padding={{ top: 12, right: 16, bottom: 24, left: yAxisWidth }}
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
			// Spacing rather than a fixed tick count, so the axis still answers to the height it
			// is actually given — a taller card earns more labels. The default of 50px asks for
			// enough ticks that d3 settles on a finer step and returns roughly twice as many as
			// it was asked for (#433).
			yAxis: { tickSpacing: 90 },
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
