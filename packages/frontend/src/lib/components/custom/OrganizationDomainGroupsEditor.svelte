<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { t } from '$lib/translations';
	import { Plus, Trash2 } from 'lucide-svelte';
	import type { OrganizationDomainGroup } from '@open-archiver/types';

	/**
	 * Editor for the journaling source's domain groups: the domains that say which recipient of a
	 * journal report owns the message.
	 *
	 * The Seats page has its own editor (`SeatDomainGroupsEditor`), because the two settings
	 * differ in what a valid group is: here a primary domain on its own is meaningful, there a
	 * group without an alias merges nothing and is refused.
	 *
	 * `groups` is bindable. `name`, when given, also emits a hidden input carrying the serialized
	 * JSON for the form action that saves the source.
	 */
	let {
		groups = $bindable(),
		name,
		disabled = false,
	}: {
		groups: OrganizationDomainGroup[];
		name?: string;
		disabled?: boolean;
	} = $props();

	function addGroup() {
		groups = [...groups, { main: '', aliases: [] }];
	}

	function removeGroup(idx: number) {
		groups = groups.filter((_, i) => i !== idx);
	}

	function updateMain(idx: number, value: string) {
		groups = groups.map((g, i) => (i === idx ? { ...g, main: value } : g));
	}

	function updateAliases(idx: number, raw: string) {
		const aliases = raw
			.split(',')
			.map((d) => d.trim().toLowerCase())
			.filter(Boolean);
		groups = groups.map((g, i) => (i === idx ? { ...g, aliases } : g));
	}

	/** Serialized value for the hidden form input, with empty rows dropped. */
	const serialized = $derived(
		JSON.stringify(
			groups
				.filter((g) => g.main.trim().length > 0)
				.map((g) => ({ main: g.main.trim().toLowerCase(), aliases: g.aliases }))
		)
	);
</script>

{#if groups.length === 0}
	<p class="text-muted-foreground text-xs italic">
		{$t('app.journaling.no_domain_groups')}
	</p>
{/if}

{#each groups as group, idx (idx)}
	<div class="bg-muted/30 space-y-2 rounded-md border p-3">
		<div class="flex items-center justify-between">
			<span class="text-xs font-medium">
				{$t('app.journaling.domain_group_primary')} #{idx + 1}
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
			<Label class="text-xs">{$t('app.journaling.domain_group_primary')}</Label>
			<Input
				class="h-8 text-sm"
				{disabled}
				placeholder={$t('app.journaling.domain_group_primary_placeholder')}
				value={group.main}
				oninput={(e) => updateMain(idx, (e.target as HTMLInputElement).value)}
			/>
		</div>
		<div class="space-y-1.5">
			<Label class="text-xs">{$t('app.journaling.domain_group_aliases')}</Label>
			<Input
				class="h-8 text-sm"
				{disabled}
				placeholder={$t('app.journaling.domain_group_aliases_placeholder')}
				value={group.aliases.join(', ')}
				oninput={(e) => updateAliases(idx, (e.target as HTMLInputElement).value)}
			/>
		</div>
	</div>
{/each}

<Button type="button" variant="outline" size="sm" {disabled} class="h-7 text-xs" onclick={addGroup}>
	<Plus class="mr-1 h-3 w-3" />
	{$t('app.journaling.add_domain_group')}
</Button>

{#if name}
	<input type="hidden" {name} value={serialized} />
{/if}
