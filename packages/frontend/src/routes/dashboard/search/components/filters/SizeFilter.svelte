<script lang="ts">
	/**
	 * Size filter — two numeric inputs (min, max) with a unit selector.
	 * Per sub-plan §3.10.
	 *
	 * Emits:
	 *   min only -> { op: 'gte', value: bytes }
	 *   max only -> { op: 'lte', value: bytes }
	 *   both     -> { op: 'between', value: [minBytes, maxBytes] }
	 *
	 * `url-state.ts` already accepts these shapes verbatim.
	 */
	import type { NumberFilter } from '@open-archiver/types';
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select';
	import FilterField from './FilterField.svelte';
	import { t } from '$lib/translations';

	type Unit = 'KB' | 'MB' | 'GB';

	const FACTORS: Record<Unit, number> = {
		KB: 1024,
		MB: 1024 * 1024,
		GB: 1024 * 1024 * 1024,
	};

	type Props = {
		value: NumberFilter | undefined;
		onChange: (v: NumberFilter | undefined) => void;
	};

	let { value, onChange }: Props = $props();

	function bytesToHumanIn(unit: Unit, bytes: number): string {
		const v = bytes / FACTORS[unit];
		if (!Number.isFinite(v)) return '';
		// Trim trailing zeros while keeping a sensible precision.
		return Number(v.toFixed(3)).toString();
	}

	function deriveInitial(v: NumberFilter | undefined): { min: string; max: string; unit: Unit } {
		const unit: Unit = 'MB';
		if (!v) return { min: '', max: '', unit };
		if (v.op === 'between') {
			return {
				min: bytesToHumanIn(unit, v.value[0]),
				max: bytesToHumanIn(unit, v.value[1]),
				unit,
			};
		}
		if (v.op === 'gte') return { min: bytesToHumanIn(unit, v.value), max: '', unit };
		if (v.op === 'lte') return { min: '', max: bytesToHumanIn(unit, v.value), unit };
		return { min: bytesToHumanIn(unit, v.value), max: '', unit };
	}

	const initial = deriveInitial(value);

	let minStr = $state(initial.min);
	let maxStr = $state(initial.max);
	let unit = $state<Unit>(initial.unit);

	function parseN(s: string): number | undefined {
		const t = s.trim();
		if (t.length === 0) return undefined;
		const n = Number(t);
		if (!Number.isFinite(n) || n < 0) return undefined;
		return n;
	}

	function emit() {
		const minN = parseN(minStr);
		const maxN = parseN(maxStr);
		if (minN === undefined && maxN === undefined) {
			onChange(undefined);
			return;
		}
		const factor = FACTORS[unit];
		if (minN !== undefined && maxN !== undefined) {
			onChange({ op: 'between', value: [minN * factor, maxN * factor] });
			return;
		}
		if (minN !== undefined) {
			onChange({ op: 'gte', value: minN * factor });
			return;
		}
		if (maxN !== undefined) {
			onChange({ op: 'lte', value: maxN * factor });
		}
	}

	const unitOptions: Unit[] = ['KB', 'MB', 'GB'];
</script>

<FilterField label={$t('app.search.filters.size_label')} helpKey="app.search.filters.size_help">
	<div class="flex items-center gap-2">
		<Input
			type="number"
			min="0"
			step="any"
			value={minStr}
			oninput={(e) => {
				minStr = (e.currentTarget as HTMLInputElement).value;
				emit();
			}}
			placeholder={$t('app.search.filters.size_min')}
			class="w-24"
		/>
		<span class="text-muted-foreground text-sm">–</span>
		<Input
			type="number"
			min="0"
			step="any"
			value={maxStr}
			oninput={(e) => {
				maxStr = (e.currentTarget as HTMLInputElement).value;
				emit();
			}}
			placeholder={$t('app.search.filters.size_max')}
			class="w-24"
		/>
		<Select.Root
			type="single"
			value={unit}
			onValueChange={(v: string) => {
				unit = v as Unit;
				emit();
			}}
		>
			<Select.Trigger class="w-20">{unit}</Select.Trigger>
			<Select.Content>
				{#each unitOptions as u (u)}
					<Select.Item value={u} label={u}>{u}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
	</div>
</FilterField>
