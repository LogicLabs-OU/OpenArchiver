<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { t } from '$lib/translations';
	import { Plus, Trash2 } from 'lucide-svelte';
	import type { OrganizationDomainGroup } from '@open-archiver/types';

	/**
	 * Editor for the domain groups the seat policy uses to say that two addresses are one person.
	 *
	 * Separate from the journaling form's editor on purpose. There a primary domain on its own is
	 * meaningful — it decides which recipient owns a journaled message — while here a group with
	 * no alias merges nothing, so this editor treats the alias field as required and shows the
	 * refusal under the row it concerns.
	 *
	 * `groups` and `errors` are both bindable: the page validates on save and writes one message
	 * per offending row index; editing a row clears its message.
	 */
	let {
		groups = $bindable(),
		errors = $bindable({}),
		disabled = false,
	}: {
		groups: OrganizationDomainGroup[];
		errors?: Record<number, string>;
		disabled?: boolean;
	} = $props();

	function clearError(idx: number) {
		if (errors[idx]) {
			const next = { ...errors };
			delete next[idx];
			errors = next;
		}
	}

	function addGroup() {
		groups = [...groups, { main: '', aliases: [] }];
	}

	function removeGroup(idx: number) {
		groups = groups.filter((_, i) => i !== idx);
		// Messages are keyed by position, so the ones after the removed row shift up with it.
		const next: Record<number, string> = {};
		for (const [key, message] of Object.entries(errors)) {
			const i = Number(key);
			if (i < idx) next[i] = message;
			else if (i > idx) next[i - 1] = message;
		}
		errors = next;
	}

	function updateMain(idx: number, value: string) {
		groups = groups.map((g, i) => (i === idx ? { ...g, main: value } : g));
		clearError(idx);
	}

	function updateAliases(idx: number, raw: string) {
		const aliases = raw
			.split(',')
			.map((d) => d.trim().toLowerCase())
			.filter(Boolean);
		groups = groups.map((g, i) => (i === idx ? { ...g, aliases } : g));
		clearError(idx);
	}
</script>

{#if groups.length === 0}
	<p class="text-muted-foreground text-xs italic">
		{$t('app.seats.no_domain_groups')}
	</p>
{/if}

{#each groups as group, idx (idx)}
	<div
		class="bg-muted/30 space-y-2 rounded-md border p-3 {errors[idx]
			? 'border-destructive'
			: ''}"
	>
		<div class="flex items-center justify-between">
			<span class="text-xs font-medium">
				{$t('app.seats.domain_group')} #{idx + 1}
			</span>
			<Button
				type="button"
				variant="ghost"
				size="icon"
				{disabled}
				class="text-destructive hover:text-destructive h-6 w-6"
				onclick={() => removeGroup(idx)}
			>
				<Trash2 class="h-3.5 w-3.5" />
			</Button>
		</div>
		<div class="space-y-1.5">
			<Label class="text-xs">{$t('app.seats.domain_group_primary')}</Label>
			<Input
				class="h-8 text-sm"
				{disabled}
				placeholder={$t('app.seats.domain_group_primary_placeholder')}
				value={group.main}
				oninput={(e) => updateMain(idx, (e.target as HTMLInputElement).value)}
			/>
		</div>
		<div class="space-y-1.5">
			<Label class="text-xs">{$t('app.seats.domain_group_aliases')}</Label>
			<Input
				class="h-8 text-sm"
				{disabled}
				aria-invalid={errors[idx] ? 'true' : undefined}
				placeholder={$t('app.seats.domain_group_aliases_placeholder')}
				value={group.aliases.join(', ')}
				oninput={(e) => updateAliases(idx, (e.target as HTMLInputElement).value)}
			/>
			{#if errors[idx]}
				<p class="text-destructive text-xs">{errors[idx]}</p>
			{/if}
		</div>
	</div>
{/each}

<Button type="button" variant="outline" size="sm" {disabled} class="h-7 text-xs" onclick={addGroup}>
	<Plus class="mr-1 h-3 w-3" />
	{$t('app.seats.add_domain_group')}
</Button>
