<script lang="ts">
	/**
	 * The advanced-filter container. Per sub-plan §1.4 and §3a.
	 *
	 * Layout:
	 *  - Trigger header (always visible): title, active-count badge, chevron,
	 *    "Clear all" link.
	 *  - Body (when expanded, viewport >= md): 2-column grid of filter components.
	 *  - Footer (when expanded): Apply (primary) and Reset (secondary — discards
	 *    in-panel edits).
	 *  - Viewport < md: body renders inside a Sheet (right-side drawer) instead
	 *    of inline.
	 *
	 * Apply semantics (sub-plan §3a):
	 *  - In-panel changes mutate `draft` but do NOT trigger a search.
	 *  - "Apply filters" fires `onApply(draft)` which the parent persists to the URL.
	 *  - Pressing Enter inside the search input (parent) also applies.
	 *  - Removing a chip via `ActiveFilterBadges` immediately applies (parent
	 *    plumbing).
	 */
	import type { SearchQueryDraft } from '../url-state';
	import { hasAnyFilter, emptyDraft } from '../url-state';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import * as Sheet from '$lib/components/ui/sheet';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronUpIcon from '@lucide/svelte/icons/chevron-up';
	import SlidersIcon from '@lucide/svelte/icons/sliders-horizontal';
	import { t } from '$lib/translations';
	import { onMount } from 'svelte';

	import DateRangeFilter from './filters/DateRangeFilter.svelte';
	import AddressFilter from './filters/AddressFilter.svelte';
	import TextFilter from './filters/TextFilter.svelte';
	import SourceFilter from './filters/SourceFilter.svelte';
	import MailboxFilter, { MAILBOX_FILTER_ENABLED } from './filters/MailboxFilter.svelte';
	import PathFilter from './filters/PathFilter.svelte';
	import TriStateFilter from './filters/TriStateFilter.svelte';
	import SizeFilter from './filters/SizeFilter.svelte';
	import TagsFilter from './filters/TagsFilter.svelte';

	type SourceOption = { id: string; name: string; providerType?: string };

	type Props = {
		draft: SearchQueryDraft;
		applied: SearchQueryDraft;
		sources: SourceOption[];
		onApply: (next: SearchQueryDraft) => void;
		onClearAll: () => void;
	};

	let { draft = $bindable(), applied, sources, onApply, onClearAll }: Props = $props();

	let expanded = $state(false);
	let isMobile = $state(false);
	let sheetOpen = $state(false);

	onMount(() => {
		if (typeof window === 'undefined') return;
		const mq = window.matchMedia('(max-width: 767px)');
		const sync = () => {
			isMobile = mq.matches;
		};
		sync();
		mq.addEventListener('change', sync);
		return () => mq.removeEventListener('change', sync);
	});

	// Count the active filters on the *currently applied* state so the trigger
	// header reflects what the user has actually committed, not their in-panel
	// edits.
	const activeCount = $derived.by(() => {
		const f = applied.filters ?? {};
		let n = 0;
		if (f.from) n++;
		if (f.to) n++;
		if (f.cc) n++;
		if (f.bcc) n++;
		if (f.subject) n++;
		if (applied.datePreset || f.timestamp) n++;
		if (f.ingestionSourceId) n++;
		if (f.userEmail) n++;
		if (f.path) n++;
		if (f.tags) n++;
		if (f.attachments?.sha256) n++;
		if (f.sizeBytes) n++;
		if (f.hasAttachments !== undefined) n++;
		if (f.isOnLegalHold !== undefined) n++;
		return n;
	});

	const hasFilters = $derived(activeCount > 0 || hasAnyFilter(applied));

	function toggleExpanded() {
		if (isMobile) {
			sheetOpen = !sheetOpen;
		} else {
			expanded = !expanded;
		}
	}

	function handleApply() {
		onApply(draft);
		sheetOpen = false;
	}

	function handleReset() {
		// Snap the local draft back to the last-applied state. Re-cast through
		// `unknown` because `structuredClone` widens tuple value types (e.g. the
		// timestamp 'between' `[string, string]`) to plain arrays.
		draft = structuredClone($state.snapshot(applied)) as unknown as SearchQueryDraft;
	}

	function handleClearAll() {
		const e = emptyDraft();
		draft = e;
		onClearAll();
		sheetOpen = false;
	}

	// --- Filter-cell helpers ---------------------------------------------------
	// Each setter writes back into draft.filters; the parent's binding picks
	// up the change via `bind:draft`.

	function setFilter<K extends keyof SearchQueryDraft['filters']>(
		key: K,
		value: SearchQueryDraft['filters'][K] | undefined
	) {
		const next = { ...(draft.filters ?? {}) };
		if (value === undefined) delete next[key];
		else (next as Record<string, unknown>)[key as string] = value;
		draft = { ...draft, filters: next };
	}

	function setDate(next: {
		value: import('@open-archiver/types').TimestampFilter | undefined;
		preset: import('../url-state').DatePreset | undefined;
	}) {
		const filters = { ...(draft.filters ?? {}) };
		if (next.value === undefined) delete filters.timestamp;
		else filters.timestamp = next.value;
		draft = { ...draft, filters, datePreset: next.preset };
	}

	// SHA-256 hex validator: 64 hex chars (case-insensitive).
	const SHA256_RE = /^[a-fA-F0-9]{64}$/;
	function validateSha(s: string): string | null {
		if (s.length === 0) return null;
		if (!SHA256_RE.test(s)) return $t('app.search.filters.sha_invalid');
		return null;
	}
</script>

{#snippet body()}
	<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
		<DateRangeFilter
			value={draft.filters.timestamp}
			preset={draft.datePreset}
			onChange={setDate}
		/>

		<AddressFilter
			field="from"
			label={$t('app.search.filters.from_label')}
			helpKey="app.search.filters.from_help"
			value={draft.filters.from}
			onChange={(v) => setFilter('from', v as import('@open-archiver/types').StringFilter | undefined)}
		/>

		<AddressFilter
			field="to"
			label={$t('app.search.filters.to_label')}
			helpKey="app.search.filters.to_help"
			value={draft.filters.to}
			onChange={(v) => setFilter('to', v as import('@open-archiver/types').StringArrayFilter | undefined)}
		/>

		<AddressFilter
			field="cc"
			label={$t('app.search.filters.cc_label')}
			value={draft.filters.cc}
			onChange={(v) => setFilter('cc', v as import('@open-archiver/types').StringArrayFilter | undefined)}
		/>

		<AddressFilter
			field="bcc"
			label={$t('app.search.filters.bcc_label')}
			value={draft.filters.bcc}
			onChange={(v) => setFilter('bcc', v as import('@open-archiver/types').StringArrayFilter | undefined)}
		/>

		<TextFilter
			field="subject"
			label={$t('app.search.filters.subject_label')}
			helpKey="app.search.filters.subject_help"
			placeholder={$t('app.search.filters.subject_placeholder')}
			op="contains"
			value={draft.filters.subject}
			onChange={(v) => setFilter('subject', v)}
		/>

		<SourceFilter
			value={draft.filters.ingestionSourceId}
			{sources}
			onChange={(v) => setFilter('ingestionSourceId', v)}
		/>

		{#if MAILBOX_FILTER_ENABLED}
			<MailboxFilter
				value={draft.filters.userEmail}
				onChange={(v) => setFilter('userEmail', v)}
			/>
		{/if}

		<div class="md:col-span-2">
			<PathFilter
				value={draft.filters.path}
				onChange={(v) => setFilter('path', v)}
			/>
		</div>

		<TriStateFilter
			field="hasAttachments"
			label={$t('app.search.filters.has_attachments_label')}
			helpKey="app.search.filters.has_attachments_help"
			value={typeof draft.filters.hasAttachments === 'boolean'
				? draft.filters.hasAttachments
				: draft.filters.hasAttachments?.value}
			onChange={(v) => setFilter('hasAttachments', v)}
		/>

		<TriStateFilter
			field="isOnLegalHold"
			label={$t('app.search.filters.legal_hold_label')}
			helpKey="app.search.filters.legal_hold_help"
			value={typeof draft.filters.isOnLegalHold === 'boolean'
				? draft.filters.isOnLegalHold
				: draft.filters.isOnLegalHold?.value}
			onChange={(v) => setFilter('isOnLegalHold', v)}
		/>

		<SizeFilter
			value={draft.filters.sizeBytes}
			onChange={(v) => setFilter('sizeBytes', v)}
		/>

		<TagsFilter
			value={draft.filters.tags}
			onChange={(v) => setFilter('tags', v)}
		/>

		<div class="md:col-span-2">
			<TextFilter
				field="attachments.sha256"
				label={$t('app.search.filters.sha_label')}
				helpKey="app.search.filters.sha_help"
				placeholder={$t('app.search.filters.sha_placeholder')}
				op="eq"
				value={draft.filters.attachments?.sha256}
				validator={validateSha}
				onChange={(v) => {
					const filters = { ...(draft.filters ?? {}) };
					if (v === undefined) delete filters.attachments;
					else filters.attachments = { sha256: v };
					draft = { ...draft, filters };
				}}
			/>
		</div>
	</div>
{/snippet}

{#snippet footer()}
	<div class="flex justify-end gap-2 pt-2">
		<Button type="button" variant="ghost" onclick={handleReset}>
			{$t('app.search.filters.reset')}
		</Button>
		<Button type="button" onclick={handleApply}>
			{$t('app.search.filters.apply')}
		</Button>
	</div>
{/snippet}

<div class="border-border rounded-md border">
	<div class="flex items-center justify-between gap-2 p-3">
		<button
			type="button"
			class="hover:text-foreground flex flex-1 items-center gap-2 text-left font-medium"
			onclick={toggleExpanded}
			aria-expanded={isMobile ? sheetOpen : expanded}
		>
			<SlidersIcon class="size-4" />
			<span>{$t('app.search.filters.title')}</span>
			{#if activeCount > 0}
				<Badge variant="secondary" class="ml-1">
					{$t('app.search.filters.n_active', { count: activeCount } as any)}
				</Badge>
			{/if}
			{#if isMobile}
				<!-- Sheet has its own chevron / close icon -->
			{:else if expanded}
				<ChevronUpIcon class="size-4" />
			{:else}
				<ChevronDownIcon class="size-4" />
			{/if}
		</button>
		{#if hasFilters}
			<button
				type="button"
				class="text-muted-foreground hover:text-foreground text-xs underline-offset-2 hover:underline"
				onclick={handleClearAll}
			>
				{$t('app.search.filters.clear_all')}
			</button>
		{/if}
	</div>

	{#if !isMobile && expanded}
		<div class="border-border border-t p-4">
			{@render body()}
			{@render footer()}
		</div>
	{/if}
</div>

{#if isMobile}
	<Sheet.Root bind:open={sheetOpen}>
		<Sheet.Content side="right" class="w-full overflow-y-auto sm:max-w-md">
			<Sheet.Header>
				<Sheet.Title>{$t('app.search.filters.title')}</Sheet.Title>
				<Sheet.Description>{$t('app.search.filters.subtitle')}</Sheet.Description>
			</Sheet.Header>
			<div class="px-4">
				{@render body()}
			</div>
			<Sheet.Footer>
				{@render footer()}
			</Sheet.Footer>
		</Sheet.Content>
	</Sheet.Root>
{/if}
