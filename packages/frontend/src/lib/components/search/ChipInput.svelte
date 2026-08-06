<script lang="ts">
	import { Input } from '$lib/components/ui/input';
	import { Badge } from '$lib/components/ui/badge';
	import { X } from 'lucide-svelte';
	import { t } from '$lib/translations';

	let {
		values = $bindable([]),
		placeholder = '',
		id = undefined,
		loadSuggestions = undefined,
	}: {
		values: string[];
		placeholder?: string;
		id?: string;
		/** Optional async source of typeahead suggestions for the current draft. */
		loadSuggestions?: (query: string) => Promise<string[]>;
	} = $props();

	let draft = $state('');
	let suggestions = $state<string[]>([]);
	let highlighted = $state(-1);
	let open = $state(false);
	// Monotonic request id so a slow response cannot overwrite a newer one.
	let requestSeq = 0;
	let debounceTimer: ReturnType<typeof setTimeout> | undefined;

	const addValue = (value: string) => {
		const clean = value.trim().replace(/,+$/, '');
		if (clean && !values.includes(clean)) {
			values = [...values, clean];
		}
		draft = '';
		closeSuggestions();
	};

	// Adds one or more values, splitting on commas so pasted comma-separated lists
	// (e.g. "a@x.com, b@x.com") become individual chips instead of one malformed value.
	const addValues = (raw: string) => {
		const parts = raw
			.split(',')
			.map((v) => v.trim())
			.filter(Boolean);
		let next = values;
		for (const p of parts) if (!next.includes(p)) next = [...next, p];
		values = next;
		draft = '';
		closeSuggestions();
	};

	const addDraft = () => addValues(draft);

	const remove = (value: string) => {
		values = values.filter((v) => v !== value);
	};

	const closeSuggestions = () => {
		open = false;
		suggestions = [];
		highlighted = -1;
	};

	const fetchSuggestions = (query: string) => {
		if (!loadSuggestions) return;
		clearTimeout(debounceTimer);
		if (query.trim() === '') {
			closeSuggestions();
			return;
		}
		debounceTimer = setTimeout(async () => {
			const seq = ++requestSeq;
			try {
				const result = await loadSuggestions(query);
				if (seq !== requestSeq) return; // a newer request superseded this one
				suggestions = result.filter((v) => !values.includes(v));
				highlighted = -1;
				open = suggestions.length > 0;
			} catch {
				closeSuggestions();
			}
		}, 200);
	};

	const handleInput = () => fetchSuggestions(draft);

	const handleKeydown = (event: KeyboardEvent) => {
		if (open && suggestions.length > 0) {
			if (event.key === 'ArrowDown') {
				event.preventDefault();
				highlighted = (highlighted + 1) % suggestions.length;
				return;
			}
			if (event.key === 'ArrowUp') {
				event.preventDefault();
				highlighted = (highlighted - 1 + suggestions.length) % suggestions.length;
				return;
			}
			if (event.key === 'Escape') {
				event.preventDefault();
				closeSuggestions();
				return;
			}
		}
		if (event.key === 'Enter' || event.key === ',') {
			event.preventDefault();
			if (open && highlighted >= 0 && highlighted < suggestions.length) {
				addValue(suggestions[highlighted]);
			} else {
				addDraft();
			}
		} else if (event.key === 'Backspace' && draft === '' && values.length > 0) {
			values = values.slice(0, -1);
		}
	};
</script>

<div class="space-y-1.5">
	<div class="relative">
		<Input
			{id}
			type="text"
			{placeholder}
			autocomplete="off"
			role={loadSuggestions ? 'combobox' : undefined}
			aria-expanded={loadSuggestions ? open : undefined}
			bind:value={draft}
			oninput={handleInput}
			onkeydown={handleKeydown}
			onpaste={(e) => {
				const text = e.clipboardData?.getData('text') ?? '';
				if (text.includes(',')) {
					e.preventDefault();
					addValues(text);
				}
			}}
			onblur={() => {
				// Close the suggestion list on blur, but never auto-commit the typed value —
				// values are only added on Enter/comma or by picking a suggestion.
				setTimeout(() => {
					closeSuggestions();
				}, 120);
			}}
			onfocus={() => draft.trim() !== '' && fetchSuggestions(draft)}
		/>
		{#if open && suggestions.length > 0}
			<ul
				class="bg-popover text-popover-foreground absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-md border shadow-md"
				role="listbox"
			>
				{#each suggestions as suggestion, i (suggestion)}
					<li role="option" aria-selected={i === highlighted}>
						<button
							type="button"
							class="hover:bg-accent hover:text-accent-foreground w-full cursor-pointer truncate px-2 py-1.5 text-left text-sm {i ===
							highlighted
								? 'bg-accent text-accent-foreground'
								: ''}"
							onmousedown={(e) => {
								e.preventDefault();
								addValue(suggestion);
							}}
						>
							{suggestion}
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
	{#if values.length > 0}
		<div class="flex flex-wrap gap-1">
			{#each values as value (value)}
				<Badge variant="secondary" class="max-w-full gap-1 font-normal">
					<span class="truncate">{value}</span>
					<button
						type="button"
						class="hover:text-destructive cursor-pointer"
						onclick={() => remove(value)}
					>
						<X class="size-3" />
						<span class="sr-only"
							>{$t('app.search.remove_value', { value } as any)}</span
						>
					</button>
				</Badge>
			{/each}
		</div>
	{/if}
</div>
