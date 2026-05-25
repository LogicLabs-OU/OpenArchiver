<script lang="ts">
	/**
	 * Chip strip rendered between the search bar and the results, showing each
	 * active filter as a removable badge. Per sub-plan §3a.
	 *
	 * Removing a chip immediately re-applies (so the user gets instant feedback
	 * for the destructive direction). The parent owns the URL update via
	 * `onRemove(filterKey)`.
	 */
	import type { SearchQueryDraft } from '../url-state';
	import { Badge } from '$lib/components/ui/badge';
	import XIcon from '@lucide/svelte/icons/x';
	import { t } from '$lib/translations';

	type SourceOption = { id: string; name: string; providerType?: string };

	type Props = {
		draft: SearchQueryDraft;
		sources: SourceOption[];
		onRemove: (filterKey: string) => void;
	};

	let { draft, sources, onRemove }: Props = $props();

	type Chip = { key: string; label: string };

	function formatList(values: string[], max = 3): string {
		if (values.length <= max) return values.join(', ');
		return `${values.slice(0, max).join(', ')} +${values.length - max}`;
	}

	function shortIso(s: string): string {
		try {
			return new Date(s).toLocaleDateString(undefined, {
				year: 'numeric',
				month: 'short',
				day: 'numeric',
			});
		} catch {
			return s;
		}
	}

	function bytesShort(n: number): string {
		const k = 1024;
		if (n < k) return `${n} B`;
		const sizes = ['KB', 'MB', 'GB', 'TB'];
		const i = Math.min(sizes.length - 1, Math.floor(Math.log(n) / Math.log(k)) - 1);
		const v = n / Math.pow(k, i + 1);
		return `${Number(v.toFixed(2))} ${sizes[i]}`;
	}

	const chips = $derived.by<Chip[]>(() => {
		const out: Chip[] = [];
		const f = draft.filters ?? {};

		// Date
		if (draft.datePreset && draft.datePreset !== 'custom') {
			out.push({
				key: 'timestamp',
				label: `${$t('app.search.filters.date_label')}: ${$t(`app.search.filters.date_${draft.datePreset.replace(/-/g, '_')}`)}`,
			});
		} else if (f.timestamp) {
			const v = f.timestamp;
			let body = '';
			if (v.op === 'between') body = `${shortIso(v.value[0])} – ${shortIso(v.value[1])}`;
			else if (v.op === 'gte') body = `≥ ${shortIso(v.value)}`;
			else if (v.op === 'lte') body = `≤ ${shortIso(v.value)}`;
			else body = shortIso(v.value);
			out.push({ key: 'timestamp', label: `${$t('app.search.filters.date_label')}: ${body}` });
		}

		// From / To / Cc / Bcc
		const addressFields: Array<{ key: 'from' | 'to' | 'cc' | 'bcc'; labelKey: string }> = [
			{ key: 'from', labelKey: 'app.search.filters.from_label' },
			{ key: 'to', labelKey: 'app.search.filters.to_label' },
			{ key: 'cc', labelKey: 'app.search.filters.cc_label' },
			{ key: 'bcc', labelKey: 'app.search.filters.bcc_label' },
		];
		for (const { key, labelKey } of addressFields) {
			const v = f[key];
			if (!v) continue;
			let body = '';
			if (v.op === 'in' || v.op === 'any' || v.op === 'all') body = formatList(v.value);
			else body = typeof v.value === 'string' ? v.value : '';
			if (!body) continue;
			out.push({ key, label: `${$t(labelKey)}: ${body}` });
		}

		if (f.subject) {
			out.push({
				key: 'subject',
				label: `${$t('app.search.filters.subject_label')}: ${
					f.subject.op === 'in' ? formatList(f.subject.value) : f.subject.value
				}`,
			});
		}

		if (f.ingestionSourceId) {
			const ids =
				typeof f.ingestionSourceId === 'string'
					? [f.ingestionSourceId]
					: f.ingestionSourceId.op === 'in'
						? f.ingestionSourceId.value
						: [f.ingestionSourceId.value];
			const names = ids.map((id) => sources.find((s) => s.id === id)?.name ?? id);
			out.push({
				key: 'ingestionSourceId',
				label: `${$t('app.search.filters.source_label')}: ${formatList(names)}`,
			});
		}

		if (f.userEmail) {
			out.push({
				key: 'userEmail',
				label: `${$t('app.search.filters.mailbox_label')}: ${
					f.userEmail.op === 'in' ? formatList(f.userEmail.value) : f.userEmail.value
				}`,
			});
		}

		if (f.path) {
			const inc = f.path.value ?? [];
			const exc = f.path.exclude ?? [];
			const parts: string[] = [];
			if (inc.length > 0) parts.push(`+${formatList(inc)}`);
			if (exc.length > 0) parts.push(`-${formatList(exc)}`);
			out.push({ key: 'path', label: `${$t('app.search.filters.path_label')}: ${parts.join(' ')}` });
		}

		if (f.hasAttachments !== undefined) {
			const b = typeof f.hasAttachments === 'boolean' ? f.hasAttachments : f.hasAttachments.value;
			out.push({
				key: 'hasAttachments',
				label: `${$t('app.search.filters.has_attachments_label')}: ${
					b ? $t('app.search.filters.tri_yes') : $t('app.search.filters.tri_no')
				}`,
			});
		}

		if (f.isOnLegalHold !== undefined) {
			const b = typeof f.isOnLegalHold === 'boolean' ? f.isOnLegalHold : f.isOnLegalHold.value;
			out.push({
				key: 'isOnLegalHold',
				label: `${$t('app.search.filters.legal_hold_label')}: ${
					b ? $t('app.search.filters.tri_yes') : $t('app.search.filters.tri_no')
				}`,
			});
		}

		if (f.tags) {
			const opLbl = f.tags.op === 'all' ? $t('app.search.filters.op_all') : $t('app.search.filters.op_any');
			out.push({
				key: 'tags',
				label: `${$t('app.search.filters.tags_label')} (${opLbl}): ${formatList(f.tags.value)}`,
			});
		}

		if (f.attachments?.sha256) {
			const sha = f.attachments.sha256;
			const v = sha.op === 'in' ? sha.value[0] : sha.value;
			const short = typeof v === 'string' && v.length > 12 ? `${v.slice(0, 8)}…${v.slice(-4)}` : v;
			out.push({
				key: 'attachments',
				label: `${$t('app.search.filters.sha_label')}: ${short}`,
			});
		}

		if (f.sizeBytes) {
			const v = f.sizeBytes;
			let body = '';
			if (v.op === 'between') body = `${bytesShort(v.value[0])} – ${bytesShort(v.value[1])}`;
			else if (v.op === 'gte') body = `≥ ${bytesShort(v.value)}`;
			else if (v.op === 'lte') body = `≤ ${bytesShort(v.value)}`;
			else body = bytesShort(v.value);
			out.push({ key: 'sizeBytes', label: `${$t('app.search.filters.size_label')}: ${body}` });
		}

		return out;
	});
</script>

{#if chips.length > 0}
	<div class="mb-3 flex flex-wrap gap-1.5" data-testid="active-filter-badges">
		{#each chips as chip (chip.key)}
			<Badge variant="secondary" class="gap-1 py-0.5">
				<span>{chip.label}</span>
				<button
					type="button"
					class="hover:text-destructive ml-0.5"
					aria-label={$t('app.search.filters.remove')}
					onclick={() => onRemove(chip.key)}
				>
					<XIcon class="size-3" />
				</button>
			</Badge>
		{/each}
	</div>
{/if}
