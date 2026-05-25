<script lang="ts">
	/**
	 * Tags filter — free-text chip list with an op toggle (any/all).
	 * No autocomplete in v1 (sub-plan §3.11a / Q8).
	 */
	import type { StringArrayFilter } from '@open-archiver/types';
	import { Badge } from '$lib/components/ui/badge';
	import * as ToggleGroup from '$lib/components/ui/toggle-group';
	import FilterField from './FilterField.svelte';
	import XIcon from '@lucide/svelte/icons/x';
	import { t } from '$lib/translations';

	type Props = {
		value: StringArrayFilter | undefined;
		onChange: (v: StringArrayFilter | undefined) => void;
	};

	let { value, onChange }: Props = $props();

	function deriveOp(v: StringArrayFilter | undefined): 'any' | 'all' {
		if (!v) return 'any';
		if (v.op === 'any') return 'any';
		if (v.op === 'all') return 'all';
		return 'any'; // 'in' from URL — coerce to 'any'
	}

	let chips = $state<string[]>(value?.value ? [...value.value] : []);
	let op = $state<'any' | 'all'>(deriveOp(value));
	let buffer = $state('');

	function emit() {
		const cleaned = chips.map((s) => s.trim()).filter((s) => s.length > 0);
		if (cleaned.length === 0) onChange(undefined);
		else onChange({ op, value: cleaned } as StringArrayFilter);
	}

	function addChips(raw: string) {
		const parts = raw
			.split(/[\n,]+/)
			.map((p) => p.trim())
			.filter((p) => p.length > 0);
		if (parts.length === 0) return;
		for (const p of parts) if (!chips.includes(p)) chips = [...chips, p];
		buffer = '';
		emit();
	}

	function removeChip(idx: number) {
		chips = chips.filter((_, i) => i !== idx);
		emit();
	}

	function handleKeyDown(e: KeyboardEvent) {
		const target = e.currentTarget as HTMLInputElement;
		if (e.key === 'Enter' || e.key === ',' || e.key === 'Tab') {
			if (buffer.trim().length === 0) return;
			e.preventDefault();
			addChips(buffer);
			return;
		}
		if (e.key === 'Backspace' && target.value === '' && chips.length > 0) {
			e.preventDefault();
			removeChip(chips.length - 1);
		}
	}
</script>

<FilterField label={$t('app.search.filters.tags_label')} helpKey="app.search.filters.tags_help">
	<ToggleGroup.Root
		type="single"
		value={op}
		onValueChange={(v: string) => {
			if (v === 'any' || v === 'all') {
				op = v;
				emit();
			}
		}}
		variant="outline"
		aria-label={$t('app.search.filters.tags_label')}
	>
		<ToggleGroup.Item value="any" class="px-3 text-xs">{$t('app.search.filters.op_any')}</ToggleGroup.Item>
		<ToggleGroup.Item value="all" class="px-3 text-xs">{$t('app.search.filters.op_all')}</ToggleGroup.Item>
	</ToggleGroup.Root>

	<div
		class="border-input bg-transparent focus-within:border-ring flex min-h-9 flex-wrap items-center gap-1 rounded-md border px-2 py-1"
	>
		{#each chips as chip, i (chip + i)}
			<Badge variant="secondary" class="gap-1 py-0.5">
				{chip}
				<button
					type="button"
					class="hover:text-destructive ml-0.5"
					aria-label={$t('app.search.filters.remove')}
					onclick={() => removeChip(i)}
				>
					<XIcon class="size-3" />
				</button>
			</Badge>
		{/each}
		<input
			type="text"
			bind:value={buffer}
			onkeydown={handleKeyDown}
			onblur={() => buffer.trim() && addChips(buffer)}
			placeholder={$t('app.search.filters.tags_placeholder')}
			class="placeholder:text-muted-foreground min-w-[8rem] flex-1 bg-transparent text-sm outline-none"
		/>
	</div>
</FilterField>
