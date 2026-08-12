<script lang="ts">
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { ChevronDown, Plus, Trash2 } from 'lucide-svelte';
	import { t } from '$lib/translations';
	import type { AppActions, AppSubjects, SafeIngestionSource } from '@open-archiver/types';
	import {
		ALL_ACTIONS,
		ALL_SUBJECTS,
		catalogForSubjects,
		type Effect,
	} from '$lib/policy-editor/catalog';
	import {
		emptyCondition,
		type UiCondition,
		type UiStatement,
		type ValidationIssue,
	} from '$lib/policy-editor/transform';
	import ConditionRow from './ConditionRow.svelte';

	interface Props {
		statement: UiStatement;
		index: number;
		sources: SafeIngestionSource[] | null;
		users: { id: string; email: string }[] | null;
		/** Problems already scoped to this statement. */
		issues: ValidationIssue[];
		onChange: (next: UiStatement) => void;
		onRemove: () => void;
	}

	let { statement, index, sources, users, issues, onChange, onRemove }: Props = $props();

	const catalog = $derived(catalogForSubjects(statement.subjects));
	const fields = $derived(catalog.kind === 'fields' ? catalog.fields : []);

	const statementIssues = $derived(issues.filter((i) => !i.conditionId));
	const issueFor = (conditionId: string) => issues.find((i) => i.conditionId === conditionId);

	const actionLabel = (action: AppActions) => $t(`app.components.role_form.action_${action}`);
	const subjectLabel = (subject: AppSubjects) =>
		$t(`app.components.role_form.subject_${subject}`);

	const summarise = <T,>(selected: T[], label: (value: T) => string, emptyKey: string) => {
		if (selected.length === 0) return $t(emptyKey);
		if (selected.length <= 2) return selected.map(label).join(', ');
		return ($t as any)('app.components.role_form.n_selected', { count: selected.length });
	};

	const actionsLabel = $derived(
		summarise(statement.actions, actionLabel, 'app.components.role_form.select_actions')
	);
	const subjectsLabel = $derived(
		summarise(statement.subjects, subjectLabel, 'app.components.role_form.select_subjects')
	);

	const toggleAction = (action: AppActions, checked: boolean) =>
		onChange({
			...statement,
			actions: checked
				? [...statement.actions, action]
				: statement.actions.filter((a) => a !== action),
		});

	const toggleSubject = (subject: AppSubjects, checked: boolean) =>
		onChange({
			...statement,
			subjects: checked
				? [...statement.subjects, subject]
				: statement.subjects.filter((s) => s !== subject),
		});

	const setEffect = (effect: Effect) => onChange({ ...statement, effect });

	const addCondition = () => {
		if (fields.length === 0) return;
		const field = fields[0];
		onChange({
			...statement,
			conditions: [
				...statement.conditions,
				emptyCondition(field.key, field.allowedOperators[0] ?? 'eq'),
			],
		});
	};

	const updateCondition = (id: string, next: UiCondition) =>
		onChange({
			...statement,
			conditions: statement.conditions.map((c) => (c.id === id ? next : c)),
		});

	const removeCondition = (id: string) =>
		onChange({ ...statement, conditions: statement.conditions.filter((c) => c.id !== id) });

	const setReason = (reason: string) => onChange({ ...statement, reason });
</script>

<div
	class="space-y-3 rounded-md border p-4 {statement.effect === 'deny'
		? 'border-destructive/50'
		: ''}"
>
	<div class="flex flex-wrap items-center gap-2">
		<span class="text-muted-foreground text-xs font-medium">
			{$t('app.components.role_form.statement')} #{index + 1}
		</span>
		<Badge variant={statement.effect === 'deny' ? 'destructive' : 'secondary'}>
			{statement.effect === 'deny'
				? $t('app.components.role_form.deny')
				: $t('app.components.role_form.allow')}
		</Badge>

		<div class="bg-muted ml-auto inline-flex gap-1 rounded-md p-1">
			<Button
				type="button"
				size="sm"
				class="h-6 px-2 text-xs"
				variant={statement.effect === 'allow' ? 'default' : 'ghost'}
				onclick={() => setEffect('allow')}
			>
				{$t('app.components.role_form.allow')}
			</Button>
			<Button
				type="button"
				size="sm"
				class="h-6 px-2 text-xs"
				variant={statement.effect === 'deny' ? 'default' : 'ghost'}
				onclick={() => setEffect('deny')}
			>
				{$t('app.components.role_form.deny')}
			</Button>
		</div>

		<Button
			type="button"
			variant="ghost"
			size="icon"
			class="text-destructive hover:text-destructive h-8 w-8 shrink-0"
			onclick={onRemove}
			aria-label={$t('app.components.role_form.remove_statement')}
		>
			<Trash2 class="h-4 w-4" />
		</Button>
	</div>

	{#if statement.effect === 'deny'}
		<p class="text-muted-foreground text-xs">{$t('app.components.role_form.deny_hint')}</p>
	{/if}

	<div class="grid gap-3 sm:grid-cols-2">
		<div class="space-y-1.5">
			<Label class="text-xs">{$t('app.components.role_form.actions_label')}</Label>
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							type="button"
							variant="outline"
							size="sm"
							class="w-full justify-between text-xs font-normal"
						>
							<span class="truncate">{actionsLabel}</span>
							<ChevronDown class="ml-1 size-4 shrink-0" />
						</Button>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content class="max-h-72 overflow-y-auto">
					{#each ALL_ACTIONS as action (action)}
						<DropdownMenu.CheckboxItem
							checked={statement.actions.includes(action)}
							onCheckedChange={(checked) => toggleAction(action, checked === true)}
						>
							{actionLabel(action)}
						</DropdownMenu.CheckboxItem>
					{/each}
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		</div>

		<div class="space-y-1.5">
			<Label class="text-xs">{$t('app.components.role_form.subjects_label')}</Label>
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							type="button"
							variant="outline"
							size="sm"
							class="w-full justify-between text-xs font-normal"
						>
							<span class="truncate">{subjectsLabel}</span>
							<ChevronDown class="ml-1 size-4 shrink-0" />
						</Button>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content class="max-h-72 overflow-y-auto">
					{#each ALL_SUBJECTS as subject (subject)}
						<DropdownMenu.CheckboxItem
							checked={statement.subjects.includes(subject)}
							onCheckedChange={(checked) => toggleSubject(subject, checked === true)}
						>
							{subjectLabel(subject)}
						</DropdownMenu.CheckboxItem>
					{/each}
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		</div>
	</div>

	{#each statementIssues as issue (issue.code)}
		<p class="text-destructive text-xs">
			{$t(`app.components.role_form.error_${issue.code}`)}
		</p>
	{/each}

	<div class="space-y-2">
		<Label class="text-xs">{$t('app.components.role_form.conditions_label')}</Label>

		{#if catalog.kind === 'inert'}
			<p class="text-muted-foreground text-xs">
				{$t('app.components.role_form.conditions_inert')}
			</p>
		{:else if catalog.kind === 'wildcard'}
			<p class="text-muted-foreground text-xs">
				{$t('app.components.role_form.conditions_wildcard')}
			</p>
		{:else if catalog.kind === 'conflict'}
			<p class="text-muted-foreground text-xs">
				{$t('app.components.role_form.conditions_split_subjects')}
			</p>
		{:else}
			{#if statement.conditions.length === 0}
				<p class="text-muted-foreground text-xs">
					{$t('app.components.role_form.conditions_hint')}
				</p>
			{/if}
			{#each statement.conditions as condition (condition.id)}
				<ConditionRow
					{condition}
					{fields}
					{sources}
					{users}
					issue={issueFor(condition.id)}
					onChange={(next) => updateCondition(condition.id, next)}
					onRemove={() => removeCondition(condition.id)}
				/>
			{/each}
			<Button type="button" variant="outline" size="sm" onclick={addCondition}>
				<Plus class="mr-1.5 h-4 w-4" />
				{$t('app.components.role_form.add_condition')}
			</Button>
		{/if}
	</div>

	<div class="space-y-1.5">
		<Label class="text-xs" for="statement-note-{statement.id}">
			{$t('app.components.role_form.note_label')}
		</Label>
		<Input
			id="statement-note-{statement.id}"
			class="h-8 text-xs"
			value={statement.reason}
			oninput={(e) => setReason((e.target as HTMLInputElement).value)}
			placeholder={$t('app.components.role_form.note_placeholder')}
		/>
	</div>
</div>
