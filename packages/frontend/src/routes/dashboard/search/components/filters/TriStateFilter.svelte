<script lang="ts">
	/**
	 * Tri-state boolean filter (Any / Yes / No). Generic — reused for
	 * `hasAttachments` and `isOnLegalHold`. Per sub-plan §3.7.
	 *
	 * Output:
	 *   Any -> undefined  (filter omitted entirely)
	 *   Yes -> true
	 *   No  -> false
	 *
	 * `url-state.ts` encodes `true|false` directly (no wrapper object); we mirror
	 * that here. The encoder also accepts the wrapped `{op:'eq',value:boolean}`
	 * form, but we keep the simpler shape so the URL stays short.
	 */
	import * as ToggleGroup from '$lib/components/ui/toggle-group';
	import FilterField from './FilterField.svelte';
	import { t } from '$lib/translations';

	type Props = {
		field: 'hasAttachments' | 'isOnLegalHold';
		label: string;
		helpKey?: string;
		value: boolean | undefined;
		onChange: (v: boolean | undefined) => void;
	};

	let { field, label, helpKey, value, onChange }: Props = $props();

	// ToggleGroup needs a string value; map our tri-state.
	const stateOf = (v: boolean | undefined): string =>
		v === undefined ? 'any' : v ? 'yes' : 'no';

	let selection = $state(stateOf(value));

	$effect(() => {
		const next = stateOf(value);
		if (next !== selection) selection = next;
	});

	function handleChange(v: string) {
		// Empty string means deselect — treat as Any.
		const normalized = v === '' ? 'any' : v;
		selection = normalized;
		if (normalized === 'any') onChange(undefined);
		else if (normalized === 'yes') onChange(true);
		else onChange(false);
	}
</script>

<FilterField {label} {helpKey}>
	<ToggleGroup.Root
		type="single"
		value={selection}
		onValueChange={handleChange}
		variant="outline"
		aria-label={label}
		data-field={field}
	>
		<ToggleGroup.Item value="any" class="px-3">{$t('app.search.filters.tri_any')}</ToggleGroup.Item>
		<ToggleGroup.Item value="yes" class="px-3">{$t('app.search.filters.tri_yes')}</ToggleGroup.Item>
		<ToggleGroup.Item value="no" class="px-3">{$t('app.search.filters.tri_no')}</ToggleGroup.Item>
	</ToggleGroup.Root>
</FilterField>
