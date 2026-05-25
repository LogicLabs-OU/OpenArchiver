<script lang="ts">
	/**
	 * Path filter with include + exclude chip lists. Per sub-plan §3.6.
	 *
	 * Emits `{op:'in', value:[...includes], exclude:[...excludes]}` (`exclude`
	 * only when non-empty). When both lists are empty the value is `undefined`.
	 */
	import type { PathFilter as PathFilterT } from '@open-archiver/types';
	import { Badge } from '$lib/components/ui/badge';
	import FilterField from './FilterField.svelte';
	import XIcon from '@lucide/svelte/icons/x';
	import { t } from '$lib/translations';

	type Props = {
		value: PathFilterT | undefined;
		onChange: (v: PathFilterT | undefined) => void;
	};

	let { value, onChange }: Props = $props();

	let includes = $state<string[]>(value?.value ? [...value.value] : []);
	let excludes = $state<string[]>(value?.exclude ? [...value.exclude] : []);

	let includeBuffer = $state('');
	let excludeBuffer = $state('');

	function emit() {
		const incC = includes.map((s) => s.trim()).filter((s) => s.length > 0);
		const excC = excludes.map((s) => s.trim()).filter((s) => s.length > 0);
		if (incC.length === 0 && excC.length === 0) {
			onChange(undefined);
			return;
		}
		const out: PathFilterT = { op: 'in', value: incC };
		if (excC.length > 0) out.exclude = excC;
		onChange(out);
	}

	function addChip(target: 'include' | 'exclude', raw: string) {
		const parts = raw
			.split(/[\n,]+/)
			.map((p) => p.trim())
			.filter((p) => p.length > 0);
		if (parts.length === 0) return;
		if (target === 'include') {
			for (const p of parts) if (!includes.includes(p)) includes = [...includes, p];
			includeBuffer = '';
		} else {
			for (const p of parts) if (!excludes.includes(p)) excludes = [...excludes, p];
			excludeBuffer = '';
		}
		emit();
	}

	function removeChip(target: 'include' | 'exclude', idx: number) {
		if (target === 'include') includes = includes.filter((_, i) => i !== idx);
		else excludes = excludes.filter((_, i) => i !== idx);
		emit();
	}

	function handleKeyDown(target: 'include' | 'exclude') {
		return (e: KeyboardEvent) => {
			const buffer = target === 'include' ? includeBuffer : excludeBuffer;
			const list = target === 'include' ? includes : excludes;
			if (e.key === 'Enter' || e.key === ',' || e.key === 'Tab') {
				if (buffer.trim().length === 0) return;
				e.preventDefault();
				addChip(target, buffer);
				return;
			}
			if (
				e.key === 'Backspace' &&
				(e.currentTarget as HTMLInputElement).value === '' &&
				list.length > 0
			) {
				e.preventDefault();
				removeChip(target, list.length - 1);
			}
		};
	}
</script>

<FilterField label={$t('app.search.filters.path_label')} helpKey="app.search.filters.path_help">
	<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
		<div class="flex flex-col gap-1">
			<span class="text-muted-foreground text-xs">{$t('app.search.filters.path_include')}</span>
			<div
				class="border-input bg-transparent focus-within:border-ring flex min-h-9 flex-wrap items-center gap-1 rounded-md border px-2 py-1"
			>
				{#each includes as chip, i (chip + i)}
					<Badge variant="secondary" class="gap-1 py-0.5">
						{chip}
						<button
							type="button"
							class="hover:text-destructive ml-0.5"
							aria-label={$t('app.search.filters.remove')}
							onclick={() => removeChip('include', i)}
						>
							<XIcon class="size-3" />
						</button>
					</Badge>
				{/each}
				<input
					type="text"
					bind:value={includeBuffer}
					onkeydown={handleKeyDown('include')}
					onblur={() => includeBuffer.trim() && addChip('include', includeBuffer)}
					placeholder={$t('app.search.filters.path_include_placeholder')}
					class="placeholder:text-muted-foreground min-w-[6rem] flex-1 bg-transparent text-sm outline-none"
				/>
			</div>
		</div>

		<div class="flex flex-col gap-1">
			<span class="text-muted-foreground text-xs">{$t('app.search.filters.path_exclude')}</span>
			<div
				class="border-input bg-transparent focus-within:border-ring flex min-h-9 flex-wrap items-center gap-1 rounded-md border px-2 py-1"
			>
				{#each excludes as chip, i (chip + i)}
					<Badge variant="outline" class="gap-1 py-0.5">
						{chip}
						<button
							type="button"
							class="hover:text-destructive ml-0.5"
							aria-label={$t('app.search.filters.remove')}
							onclick={() => removeChip('exclude', i)}
						>
							<XIcon class="size-3" />
						</button>
					</Badge>
				{/each}
				<input
					type="text"
					bind:value={excludeBuffer}
					onkeydown={handleKeyDown('exclude')}
					onblur={() => excludeBuffer.trim() && addChip('exclude', excludeBuffer)}
					placeholder={$t('app.search.filters.path_exclude_placeholder')}
					class="placeholder:text-muted-foreground min-w-[6rem] flex-1 bg-transparent text-sm outline-none"
				/>
			</div>
		</div>
	</div>
</FilterField>
