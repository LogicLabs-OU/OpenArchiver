<script lang="ts">
	/**
	 * Multi-select combobox over the user's ingestion sources. Per sub-plan §3.4.
	 *
	 * Always emits `{op:'in', value:[uuid,...]}` (even for a single chip), per
	 * the spec "frontend always sends `{op:'in', value:[]}` for consistency".
	 *
	 * Hides itself entirely when only one source is available.
	 */
	import type { IngestionSourceFilter } from '@open-archiver/types';
	import * as Combobox from '$lib/components/ui/combobox';
	import { Badge } from '$lib/components/ui/badge';
	import FilterField from './FilterField.svelte';
	import XIcon from '@lucide/svelte/icons/x';
	import { t } from '$lib/translations';

	type SourceOption = {
		id: string;
		name: string;
		providerType?: string;
	};

	type Props = {
		value: IngestionSourceFilter | undefined;
		sources: SourceOption[];
		onChange: (v: IngestionSourceFilter | undefined) => void;
	};

	let { value, sources, onChange }: Props = $props();

	function selectedIds(v: IngestionSourceFilter | undefined): string[] {
		if (!v) return [];
		if (typeof v === 'string') return [v];
		if (v.op === 'in') return v.value;
		if (v.op === 'eq') return [v.value];
		return [];
	}

	const selected = $derived(selectedIds(value));

	function emit(next: string[]) {
		const cleaned = next.filter((id) => id && id.length > 0);
		if (cleaned.length === 0) onChange(undefined);
		else onChange({ op: 'in', value: cleaned });
	}

	function remove(id: string) {
		emit(selected.filter((x) => x !== id));
	}

	function labelOf(id: string): string {
		return sources.find((s) => s.id === id)?.name ?? id;
	}
</script>

{#if sources.length > 1}
	<FilterField
		label={$t('app.search.filters.source_label')}
		helpKey="app.search.filters.source_help"
	>
		<Combobox.Root
			type="multiple"
			value={selected}
			onValueChange={(next: string[]) => emit(next)}
		>
			<Combobox.Trigger class="w-full">
				{selected.length > 0
					? $t('app.search.filters.n_selected', { count: selected.length } as any)
					: $t('app.search.filters.source_placeholder')}
			</Combobox.Trigger>
			<Combobox.Content>
				{#each sources as src (src.id)}
					<Combobox.Item value={src.id} label={src.name}>
						<div class="flex flex-col">
							<span>{src.name}</span>
							{#if src.providerType}
								<span class="text-muted-foreground text-xs">{src.providerType}</span>
							{/if}
						</div>
					</Combobox.Item>
				{/each}
				{#if sources.length === 0}
					<Combobox.Empty>{$t('app.search.filters.no_sources')}</Combobox.Empty>
				{/if}
			</Combobox.Content>
		</Combobox.Root>

		{#if selected.length > 0}
			<div class="flex flex-wrap gap-1">
				{#each selected as id (id)}
					<Badge variant="secondary" class="gap-1">
						{labelOf(id)}
						<button
							type="button"
							class="hover:text-destructive ml-0.5"
							aria-label={$t('app.search.filters.remove')}
							onclick={() => remove(id)}
						>
							<XIcon class="size-3" />
						</button>
					</Badge>
				{/each}
			</div>
		{/if}
	</FilterField>
{/if}
