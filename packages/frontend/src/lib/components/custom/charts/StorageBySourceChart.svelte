<script lang="ts">
	import * as Chart from '$lib/components/ui/chart/index.js';
	import { PieChart } from 'layerchart';
	import type { IngestionSourceStats } from '@open-archiver/types';
	import type { ChartConfig } from '$lib/components/ui/chart';
	import { formatBytes } from '$lib/utils';
	import { t } from '$lib/translations';

	export let data: IngestionSourceStats[];

	/**
	 * The slice colours, in the order the pie assigns them.
	 *
	 * PieChart builds an ordinal scale over the keys in data order and cycles this range, so
	 * indexing it the same way reproduces each slice's colour exactly. Keep the list below in
	 * data order for that reason — sorting it would recolour the names.
	 */
	const sliceColors = [
		'var(--color-chart-1)',
		'var(--color-chart-2)',
		'var(--color-chart-3)',
		'var(--color-chart-4)',
		'var(--color-chart-5)',
	];

	const chartConfig = {
		storageUsed: {
			label: $t('app.components.charts.storage_used'),
		},
	} satisfies ChartConfig;
</script>

<!--
	The legend is ours rather than layerchart's, for two reasons that turned out to be the same
	reason.

	It renders every source name in full. layerchart lays its legend out as one non-wrapping row
	that the flex items shrink to fit, and each item truncates — so a dozen ingestion sources
	came out as a row of single letters, a legend naming nothing.

	And it cannot make the chart flicker (#121). That bug was a measurement loop: layerchart binds
	clientWidth/clientHeight on its own root and redraws from them, the container was allowed to
	scroll, and a scrollbar appearing changed the very box being measured — so the chart redrew,
	the overflow changed, and the scrollbar toggled again, for as long as the legend sat near the
	threshold. That is why it came and went with window width, browser zoom and the number of
	sources. A legend that lives outside the measured element cannot participate: the chart box
	below has a fixed height and cannot scroll, and this list scrolls without resizing anything.
-->
<div class="flex h-full flex-col gap-4">
	<Chart.Container config={chartConfig} class="h-[220px] w-full shrink-0 overflow-hidden">
		<PieChart
			{data}
			key="name"
			value="storageUsed"
			label="name"
			legend={false}
			cRange={sliceColors}
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

	<!-- min-h-0 is what lets this scroll instead of stretching the card: a flex child will not
	     shrink below its content without it, so the list would push the card taller. -->
	<ul class="min-h-0 flex-1 space-y-1 overflow-y-auto text-xs">
		{#each data as source, index (source.name)}
			<li class="flex items-center gap-2">
				<span
					class="size-2.5 shrink-0 rounded-[2px]"
					style="background-color: {sliceColors[index % sliceColors.length]}"
				></span>
				<span class="truncate" title={source.name}>{source.name}</span>
				<span class="text-muted-foreground ml-auto shrink-0 tabular-nums">
					{formatBytes(source.storageUsed)}
				</span>
			</li>
		{/each}
	</ul>
</div>
