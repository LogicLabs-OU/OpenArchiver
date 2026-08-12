<script lang="ts">
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { Button } from '$lib/components/ui/button';
	import { ChevronDown, Plus } from 'lucide-svelte';
	import { t } from '$lib/translations';
	import type { SafeIngestionSource } from '@open-archiver/types';
	import { POLICY_PRESETS } from '$lib/policy-editor/presets';
	import {
		emptyStatement,
		policiesToUiModel,
		type UiModel,
		type UiStatement,
		type ValidationIssue,
	} from '$lib/policy-editor/transform';
	import PolicyStatementCard from './PolicyStatementCard.svelte';

	interface Props {
		/** The statements being edited; the parent serializes them on save. */
		model: UiModel;
		/** null when ingestion sources could not be loaded, so pickers fall back to raw IDs. */
		sources: SafeIngestionSource[] | null;
		users: { id: string; email: string }[] | null;
		issues: ValidationIssue[];
	}

	let { model = $bindable(), sources, users, issues }: Props = $props();

	const issuesFor = (statementId: string) =>
		issues.filter((issue) => issue.statementId === statementId);

	const addStatement = () => {
		model = { statements: [...model.statements, emptyStatement()] };
	};

	const updateStatement = (id: string, next: UiStatement) => {
		model = { statements: model.statements.map((s) => (s.id === id ? next : s)) };
	};

	const removeStatement = (id: string) => {
		model = { statements: model.statements.filter((s) => s.id !== id) };
	};

	/** Set when a template could not be drawn as statements, so the click is never a silent no-op. */
	let presetError = $state<string | null>(null);

	/** Templates are plain policies, so they load through the same path as a saved role. */
	const applyPreset = (index: number) => {
		const result = policiesToUiModel(POLICY_PRESETS[index].policies);
		if (!result.ok) {
			presetError = $t('app.components.role_form.preset_failed');
			return;
		}
		presetError = null;
		model = result.model;
	};
</script>

<div class="space-y-3">
	{#if model.statements.length === 0}
		<div class="rounded-md border border-dashed p-6 text-center">
			<p class="text-muted-foreground text-sm">
				{$t('app.components.role_form.no_statements')}
			</p>
			<p class="text-muted-foreground mt-1 text-xs">
				{$t('app.components.role_form.templates_hint')}
			</p>
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<Button {...props} type="button" variant="outline" size="sm" class="mt-3">
							{$t('app.components.role_form.templates_title')}
							<ChevronDown class="ml-1 size-4" />
						</Button>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content>
					{#each POLICY_PRESETS as preset, i (preset.labelKey)}
						<DropdownMenu.Item class="cursor-pointer" onclick={() => applyPreset(i)}>
							{$t(`app.components.role_form.${preset.labelKey}`)}
						</DropdownMenu.Item>
					{/each}
				</DropdownMenu.Content>
			</DropdownMenu.Root>
			{#if presetError}
				<p class="text-destructive mt-2 text-xs">{presetError}</p>
			{/if}
		</div>
	{:else}
		{#each model.statements as statement, index (statement.id)}
			<PolicyStatementCard
				{statement}
				{index}
				{sources}
				{users}
				issues={issuesFor(statement.id)}
				onChange={(next) => updateStatement(statement.id, next)}
				onRemove={() => removeStatement(statement.id)}
			/>
		{/each}
	{/if}

	<Button type="button" variant="outline" size="sm" class="w-full" onclick={addStatement}>
		<Plus class="mr-1.5 h-4 w-4" />
		{$t('app.components.role_form.add_statement')}
	</Button>
</div>
