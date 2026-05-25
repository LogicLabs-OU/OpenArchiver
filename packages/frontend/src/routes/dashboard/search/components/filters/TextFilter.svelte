<script lang="ts">
	/**
	 * Generic single-string filter — reused for `subject` (op=contains) and
	 * `attachments.sha256` (op=eq, hex-validated). The producer decides which
	 * operator the value carries.
	 *
	 * Per sub-plan §3.3.
	 */
	import type { StringFilter } from '@open-archiver/types';
	import { Input } from '$lib/components/ui/input';
	import FilterField from './FilterField.svelte';
	import { t } from '$lib/translations';

	type Props = {
		field: 'subject' | 'attachments.sha256';
		label: string;
		helpKey?: string;
		placeholder?: string;
		op: 'contains' | 'eq';
		value: StringFilter | undefined;
		onChange: (v: StringFilter | undefined) => void;
		/** Optional synchronous validator. Return null if the input is acceptable. */
		validator?: (s: string) => string | null;
	};

	let {
		field,
		label,
		helpKey,
		placeholder,
		op,
		value,
		onChange,
		validator,
	}: Props = $props();

	const initial = (() => {
		if (!value) return '';
		if (value.op === 'in') return value.value.join(', ');
		return value.value;
	})();

	let text = $state(initial);
	let error = $state<string | null>(null);

	const inputId = `filter-${field.replace(/\W+/g, '-')}`;

	function commit(next: string) {
		const trimmed = next.trim();
		if (trimmed.length === 0) {
			error = null;
			onChange(undefined);
			return;
		}
		const v = validator ? validator(trimmed) : null;
		error = v;
		if (v) return;
		onChange({ op, value: trimmed } as StringFilter);
	}

	function handleInput(e: Event) {
		const next = (e.currentTarget as HTMLInputElement).value;
		text = next;
		commit(next);
	}
</script>

<FilterField {label} {helpKey} for={inputId}>
	<Input
		id={inputId}
		type="text"
		value={text}
		oninput={handleInput}
		placeholder={placeholder ?? $t('app.search.filters.text_placeholder')}
		aria-invalid={error ? 'true' : undefined}
	/>
	{#if error}
		<p class="text-destructive text-xs">{error}</p>
	{/if}
</FilterField>
