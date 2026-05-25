<script lang="ts" module>
	/**
	 * Feature flag — enable when backend ships /v1/archive/mailboxes (sub-plan
	 * §3.5). With the flag off this component renders nothing; consumers can
	 * still mount it unconditionally for forward compatibility.
	 */
	export const MAILBOX_FILTER_ENABLED = false;
</script>

<script lang="ts">
	import type { StringFilter } from '@open-archiver/types';
	import { Input } from '$lib/components/ui/input';
	import FilterField from './FilterField.svelte';
	import { t } from '$lib/translations';

	type Props = {
		value: StringFilter | undefined;
		onChange: (v: StringFilter | undefined) => void;
	};

	let { value, onChange }: Props = $props();

	let text = $state(value && value.op !== 'in' ? value.value : '');

	function handleInput(e: Event) {
		const v = (e.currentTarget as HTMLInputElement).value;
		text = v;
		const trimmed = v.trim();
		if (trimmed.length === 0) onChange(undefined);
		else onChange({ op: 'eq', value: trimmed });
	}
</script>

{#if MAILBOX_FILTER_ENABLED}
	<FilterField label={$t('app.search.filters.mailbox_label')}>
		<Input value={text} oninput={handleInput} placeholder={$t('app.search.filters.mailbox_placeholder')} />
	</FilterField>
{/if}
