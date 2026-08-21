<script lang="ts">
	import * as Chart from '$lib/components/ui/chart/index.js';
	import { BarChart } from 'layerchart';
	import type { TopSender } from '@open-archiver/types';
	import type { ChartConfig } from '$lib/components/ui/chart';
	import { t } from '$lib/translations';

	export let data: TopSender[];

	// Show the resolved display name when known, falling back to the address (#413).
	// The chart keys each bar on `sender` (the y-axis category), so it MUST be
	// unique per row — layerchart bands rows sharing a y value into a single
	// stacked bar. Two distinct addresses can resolve to the same display name
	// (e.g. two facebookmail.com addresses both named "Facebook"), so when a name
	// is shared we disambiguate it with the (unique) address to keep them as
	// separate bars instead of one stacked row.
	$: nameCounts = data.reduce((acc, d) => {
		const name = d.senderName || d.sender;
		acc.set(name, (acc.get(name) ?? 0) + 1);
		return acc;
	}, new Map<string, number>());
	$: chartData = data.map((d) => {
		const name = d.senderName || d.sender;
		const label = nameCounts.get(name)! > 1 && d.senderName ? `${name} (${d.sender})` : name;
		return { ...d, sender: label };
	});

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
