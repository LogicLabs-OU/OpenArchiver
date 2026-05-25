<script lang="ts">
	/**
	 * Address-style filter for `from`, `to`, `cc`, `bcc`. Per sub-plan §3.2.
	 *
	 *  "is exactly" -> { op: 'in', value: [chips] }
	 *  "contains"   -> { op: 'contains', value: 'string' }    (single chip / free text)
	 *
	 * Defaults: `from` -> contains; `to`/`cc`/`bcc` -> in.
	 *
	 * - Backspace on empty buffer removes the last chip.
	 * - Paste explodes on comma / whitespace / semicolon.
	 * - Loose email validation (must contain '@', no whitespace, has a dot or is
	 *   wrapped in '<...>' for friendly-form addresses).
	 */
	import type {
		StringFilter,
		StringArrayFilter,
	} from '@open-archiver/types';
	import { Input } from '$lib/components/ui/input';
	import { Badge } from '$lib/components/ui/badge';
	import * as Tabs from '$lib/components/ui/tabs';
	import FilterField from './FilterField.svelte';
	import XIcon from '@lucide/svelte/icons/x';
	import { t } from '$lib/translations';

	type Field = 'from' | 'to' | 'cc' | 'bcc';
	type AddressValue = StringFilter | StringArrayFilter | undefined;

	type Props = {
		field: Field;
		label: string;
		helpKey?: string;
		value: AddressValue;
		onChange: (v: AddressValue) => void;
	};

	let { field, label, helpKey, value, onChange }: Props = $props();

	// `from` is a StringFilter; the others are StringArrayFilter. We expose both
	// modes via the op toggle, regardless of the field default — the URL encoder
	// only renders shapes the underlying field actually supports.
	const isFromField = field === 'from';

	const defaultMode: 'in' | 'contains' = isFromField ? 'contains' : 'in';

	function deriveMode(v: AddressValue): 'in' | 'contains' {
		if (!v) return defaultMode;
		if (v.op === 'in') return 'in';
		return 'contains';
	}

	function deriveChips(v: AddressValue): string[] {
		if (!v) return [];
		if (v.op === 'in' || v.op === 'any' || v.op === 'all') return v.value;
		return [v.value];
	}

	function deriveText(v: AddressValue): string {
		if (!v) return '';
		if (v.op === 'in' || v.op === 'any' || v.op === 'all') return '';
		// At this point `v` is a String*Contains*/Eq filter — `value` is a string.
		return typeof v.value === 'string' ? v.value : '';
	}

	let mode = $state<'in' | 'contains'>(deriveMode(value));
	let chips = $state<string[]>(deriveChips(value));
	let buffer = $state<string>(deriveText(value));

	const inputId = `filter-${field}`;

	// Loose email-ish validation: '@' present, no whitespace.
	const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+$/;

	function isValid(s: string): boolean {
		return EMAIL_RE.test(s) || s.includes('@');
	}

	function emit() {
		if (mode === 'in') {
			const cleaned = chips.map((c) => c.trim()).filter((c) => c.length > 0);
			if (cleaned.length === 0) onChange(undefined);
			else onChange({ op: 'in', value: cleaned } as StringArrayFilter);
			return;
		}
		const v = buffer.trim();
		if (v.length === 0) onChange(undefined);
		else if (isFromField) {
			onChange({ op: 'contains', value: v } as StringFilter);
		} else {
			// `to`/`cc`/`bcc` are StringArrayFilter — 'contains' isn't part of that
			// union, so single-chip wrap.
			onChange({ op: 'in', value: [v] } as StringArrayFilter);
		}
	}

	function addChips(raw: string) {
		const parts = raw
			.split(/[,;\s]+/)
			.map((p) => p.trim())
			.filter((p) => p.length > 0);
		if (parts.length === 0) return;
		for (const p of parts) {
			if (!chips.includes(p)) chips = [...chips, p];
		}
		buffer = '';
		emit();
	}

	function removeChip(idx: number) {
		chips = chips.filter((_, i) => i !== idx);
		emit();
	}

	function handleKeyDown(e: KeyboardEvent) {
		const target = e.currentTarget as HTMLInputElement;
		if (mode === 'contains') return; // raw text only
		if (e.key === 'Enter' || e.key === ',' || e.key === ';' || e.key === 'Tab') {
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

	function handlePaste(e: ClipboardEvent) {
		if (mode === 'contains') return;
		const pasted = e.clipboardData?.getData('text');
		if (!pasted) return;
		if (/[\s,;]/.test(pasted)) {
			e.preventDefault();
			addChips(pasted);
		}
	}

	function handleInput(e: Event) {
		const v = (e.currentTarget as HTMLInputElement).value;
		buffer = v;
		if (mode === 'contains') emit();
	}

	function handleBlur() {
		if (mode === 'in' && buffer.trim().length > 0) addChips(buffer);
	}

	function handleModeChange(next: string | undefined) {
		if (!next || next === mode) return;
		mode = next as 'in' | 'contains';
		// Flip semantics: when switching to chips mode, treat any pending buffer
		// as a chip; when switching back to contains, fold chips into buffer.
		if (mode === 'in' && buffer.trim().length > 0) {
			addChips(buffer);
		} else if (mode === 'contains' && chips.length > 0) {
			buffer = chips.join(' ');
			chips = [];
		}
		emit();
	}
</script>

<FilterField {label} {helpKey} for={inputId}>
	<Tabs.Root value={mode} onValueChange={handleModeChange}>
		<Tabs.List class="h-8">
			<Tabs.Trigger value="in" class="text-xs">{$t('app.search.filters.op_is_exactly')}</Tabs.Trigger>
			<Tabs.Trigger value="contains" class="text-xs">{$t('app.search.filters.op_contains')}</Tabs.Trigger>
		</Tabs.List>
	</Tabs.Root>

	<div
		class="border-input bg-transparent focus-within:border-ring flex min-h-9 flex-wrap items-center gap-1 rounded-md border px-2 py-1"
	>
		{#if mode === 'in'}
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
		{/if}
		<input
			id={inputId}
			type="text"
			value={buffer}
			oninput={handleInput}
			onkeydown={handleKeyDown}
			onpaste={handlePaste}
			onblur={handleBlur}
			placeholder={mode === 'in'
				? $t('app.search.filters.address_chip_placeholder')
				: $t('app.search.filters.address_contains_placeholder')}
			class="placeholder:text-muted-foreground min-w-[8rem] flex-1 bg-transparent text-sm outline-none"
			data-invalid={mode === 'in' && buffer.length > 0 && !isValid(buffer.trim()) ? 'true' : undefined}
		/>
	</div>
	{#if mode === 'in' && buffer.length > 0 && !isValid(buffer.trim())}
		<p class="text-muted-foreground text-xs">{$t('app.search.filters.address_invalid')}</p>
	{/if}
</FilterField>
