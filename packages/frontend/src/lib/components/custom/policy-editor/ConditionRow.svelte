<script lang="ts">
	import * as Select from '$lib/components/ui/select';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import ChipInput from '$lib/components/search/ChipInput.svelte';
	import { ChevronDown, Trash2 } from 'lucide-svelte';
	import { t } from '$lib/translations';
	import { api } from '$lib/api.client';
	import type { SafeIngestionSource, SearchFacetResult } from '@open-archiver/types';
	import {
		CURRENT_USER_PLACEHOLDER,
		isMultiValueOperator,
		type FieldDef,
		type UiOperator,
	} from '$lib/policy-editor/catalog';
	import type { UiCondition, ValidationIssue } from '$lib/policy-editor/transform';

	interface Props {
		condition: UiCondition;
		/** Fields valid for the statement's current subjects. */
		fields: readonly FieldDef[];
		/** null when the ingestion sources could not be loaded; the row falls back to raw IDs. */
		sources: SafeIngestionSource[] | null;
		users: { id: string; email: string }[] | null;
		issue?: ValidationIssue;
		onChange: (next: UiCondition) => void;
		onRemove: () => void;
	}

	let { condition, fields, sources, users, issue, onChange, onRemove }: Props = $props();

	const definition = $derived(fields.find((f) => f.key === condition.field));
	const operators = $derived(definition?.allowedOperators ?? []);
	const multiValue = $derived(isMultiValueOperator(condition.operator));

	const fieldLabelKeys: Record<string, string> = {
		id: 'app.components.role_form.field_id',
		userId: 'app.components.role_form.field_user_id',
		name: 'app.components.role_form.field_name',
		provider: 'app.components.role_form.field_provider',
		status: 'app.components.role_form.field_status',
		userEmail: 'app.components.role_form.field_user_email',
		ingestionSourceId: 'app.components.role_form.field_ingestion_source_id',
		'ingestionSource.userId': 'app.components.role_form.field_source_owner',
	};
	const operatorLabelKeys: Record<UiOperator, string> = {
		eq: 'app.components.role_form.op_is',
		ne: 'app.components.role_form.op_is_not',
		in: 'app.components.role_form.op_any_of',
		nin: 'app.components.role_form.op_none_of',
	};

	const fieldLabel = (key: string) => $t(fieldLabelKeys[key] ?? key);

	/** Providers reuse the labels already written for the ingestion source form. */
	const enumLabel = (fieldKey: string, value: string) =>
		fieldKey === 'provider'
			? $t(`app.components.ingestion_source_form.provider_${value}`)
			: $t(`app.components.role_form.status_${value}`);

	const sourceLabel = (id: string) => sources?.find((s) => s.id === id)?.name ?? id;

	/**
	 * A merged child never owns any archived email — its messages are stored under the root of its
	 * group — so offering one for an archive condition would build a rule that matches nothing.
	 * Ingestion conditions still list them, since the source list itself is filtered by those.
	 */
	const selectableSources = $derived(
		condition.field === 'ingestionSourceId'
			? (sources ?? []).filter((source) => !source.mergedIntoId)
			: (sources ?? [])
	);

	const userLabel = (id: string) =>
		id === CURRENT_USER_PLACEHOLDER
			? $t('app.components.role_form.current_user')
			: (users?.find((u) => u.id === id)?.email ?? id);

	/** Mailbox suggestions, scoped to what the signed-in admin may search. */
	const loadMailboxSuggestions = async (query: string): Promise<string[]> => {
		try {
			const res = await api(
				`/search/facets?field=mailboxes&query=${encodeURIComponent(query)}`
			);
			if (!res.ok) return [];
			const data = (await res.json()) as SearchFacetResult;
			return data.values ?? [];
		} catch {
			return [];
		}
	};

	const changeField = (key: string) => {
		const next = fields.find((f) => f.key === key);
		if (!next) return;
		// Values rarely carry over between fields, and the operator may not be allowed on the
		// new field, so the row starts fresh.
		const operator = next.allowedOperators.includes(condition.operator)
			? condition.operator
			: 'eq';
		onChange({ ...condition, field: key, operator, values: [] });
	};

	const changeOperator = (operator: UiOperator) => {
		const wasMulti = isMultiValueOperator(condition.operator);
		const nowMulti = isMultiValueOperator(operator);
		// Going from a list to a single value keeps the first entry rather than discarding
		// everything the user picked.
		const values = wasMulti && !nowMulti ? condition.values.slice(0, 1) : condition.values;
		onChange({ ...condition, operator, values });
	};

	const setValues = (values: string[]) => onChange({ ...condition, values });
	const setSingleValue = (value: string) => setValues(value === '' ? [] : [value]);

	const toggleValue = (value: string, checked: boolean) =>
		setValues(
			checked ? [...condition.values, value] : condition.values.filter((v) => v !== value)
		);

	const singleValue = $derived(condition.values[0] ?? '');

	const multiTriggerLabel = $derived.by(() => {
		if (condition.values.length === 0) return $t('app.components.role_form.select_values');
		if (condition.values.length <= 2) {
			return condition.values
				.map((v) =>
					definition?.kind === 'sourceId'
						? sourceLabel(v)
						: definition?.kind === 'userRef'
							? userLabel(v)
							: definition?.kind === 'enum'
								? enumLabel(condition.field, v)
								: v
				)
				.join(', ');
		}
		return ($t as any)('app.components.role_form.n_selected', {
			count: condition.values.length,
		});
	});

	const issueMessage = $derived(
		issue ? $t(`app.components.role_form.error_${issue.code}`) : null
	);

	/** Options for the pickers that offer a fixed list. */
	const enumOptions = $derived(definition?.enumValues ?? []);
	const userOptions = $derived([
		{ id: CURRENT_USER_PLACEHOLDER, label: $t('app.components.role_form.current_user') },
		...(users ?? []).map((u) => ({ id: u.id, label: u.email })),
	]);
</script>

<div
	class="flex flex-wrap items-center gap-2 rounded-md border p-3 {issue
		? 'border-destructive bg-destructive/5'
		: 'bg-muted/40'}"
>
	<Select.Root type="single" value={condition.field} onValueChange={(v) => v && changeField(v)}>
		<Select.Trigger class="min-w-36 flex-1 cursor-pointer text-xs sm:flex-none">
			{definition ? fieldLabel(condition.field) : condition.field}
		</Select.Trigger>
		<Select.Content>
			{#each fields as field (field.key)}
				<Select.Item value={field.key} label={fieldLabel(field.key)} class="cursor-pointer">
					{fieldLabel(field.key)}
				</Select.Item>
			{/each}
		</Select.Content>
	</Select.Root>

	<Select.Root
		type="single"
		value={condition.operator}
		onValueChange={(v) => v && changeOperator(v as UiOperator)}
	>
		<Select.Trigger class="min-w-24 cursor-pointer text-xs">
			{$t(operatorLabelKeys[condition.operator])}
		</Select.Trigger>
		<Select.Content>
			{#each operators as operator (operator)}
				<Select.Item
					value={operator}
					label={$t(operatorLabelKeys[operator])}
					class="cursor-pointer"
				>
					{$t(operatorLabelKeys[operator])}
				</Select.Item>
			{/each}
		</Select.Content>
	</Select.Root>

	<div class="basis-full sm:flex-1 sm:basis-auto">
		{#if definition?.kind === 'email'}
			<!-- "is" and "is not" take one address, so a second entry replaces the first rather
				 than becoming an error the user has to undo. -->
			<ChipInput
				bind:values={() => condition.values, (v) => setValues(multiValue ? v : v.slice(-1))}
				placeholder={$t('app.components.role_form.mailbox_placeholder')}
				loadSuggestions={loadMailboxSuggestions}
			/>
		{:else if definition?.kind === 'sourceId' && sources}
			{#if multiValue}
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
								<span class="truncate">{multiTriggerLabel}</span>
								<ChevronDown class="ml-1 size-4 shrink-0" />
							</Button>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content class="max-h-72 overflow-y-auto">
						{#each selectableSources as source (source.id)}
							<DropdownMenu.CheckboxItem
								checked={condition.values.includes(source.id)}
								onCheckedChange={(checked) =>
									toggleValue(source.id, checked === true)}
							>
								{source.name}
							</DropdownMenu.CheckboxItem>
						{/each}
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			{:else}
				<Select.Root
					type="single"
					value={singleValue}
					onValueChange={(v) => setSingleValue(v ?? '')}
				>
					<Select.Trigger class="w-full cursor-pointer text-xs">
						{singleValue
							? sourceLabel(singleValue)
							: $t('app.components.role_form.select_value')}
					</Select.Trigger>
					<Select.Content class="max-h-72 overflow-y-auto">
						{#each selectableSources as source (source.id)}
							<Select.Item
								value={source.id}
								label={source.name}
								class="cursor-pointer"
							>
								{source.name}
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			{/if}
		{:else if definition?.kind === 'userRef'}
			{#if multiValue}
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
								<span class="truncate">{multiTriggerLabel}</span>
								<ChevronDown class="ml-1 size-4 shrink-0" />
							</Button>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content class="max-h-72 overflow-y-auto">
						{#each userOptions as option (option.id)}
							<DropdownMenu.CheckboxItem
								checked={condition.values.includes(option.id)}
								onCheckedChange={(checked) =>
									toggleValue(option.id, checked === true)}
							>
								{option.label}
							</DropdownMenu.CheckboxItem>
						{/each}
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			{:else}
				<Select.Root
					type="single"
					value={singleValue}
					onValueChange={(v) => setSingleValue(v ?? '')}
				>
					<Select.Trigger class="w-full cursor-pointer text-xs">
						{singleValue
							? userLabel(singleValue)
							: $t('app.components.role_form.select_value')}
					</Select.Trigger>
					<Select.Content class="max-h-72 overflow-y-auto">
						{#each userOptions as option (option.id)}
							<Select.Item
								value={option.id}
								label={option.label}
								class="cursor-pointer"
							>
								{option.label}
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			{/if}
		{:else if definition?.kind === 'enum'}
			{#if multiValue}
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
								<span class="truncate">{multiTriggerLabel}</span>
								<ChevronDown class="ml-1 size-4 shrink-0" />
							</Button>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content class="max-h-72 overflow-y-auto">
						{#each enumOptions as value (value)}
							<DropdownMenu.CheckboxItem
								checked={condition.values.includes(value)}
								onCheckedChange={(checked) => toggleValue(value, checked === true)}
							>
								{enumLabel(condition.field, value)}
							</DropdownMenu.CheckboxItem>
						{/each}
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			{:else}
				<Select.Root
					type="single"
					value={singleValue}
					onValueChange={(v) => setSingleValue(v ?? '')}
				>
					<Select.Trigger class="w-full cursor-pointer text-xs">
						{singleValue
							? enumLabel(condition.field, singleValue)
							: $t('app.components.role_form.select_value')}
					</Select.Trigger>
					<Select.Content class="max-h-72 overflow-y-auto">
						{#each enumOptions as value (value)}
							<Select.Item
								{value}
								label={enumLabel(condition.field, value)}
								class="cursor-pointer"
							>
								{enumLabel(condition.field, value)}
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			{/if}
		{:else if multiValue}
			<ChipInput
				bind:values={() => condition.values, (v) => setValues(v)}
				placeholder={$t('app.components.role_form.value_placeholder')}
			/>
		{:else}
			<Input
				class="h-8 w-full text-xs"
				value={singleValue}
				oninput={(e) => setSingleValue((e.target as HTMLInputElement).value)}
				placeholder={$t('app.components.role_form.value_placeholder')}
			/>
		{/if}
	</div>

	<Button
		type="button"
		variant="ghost"
		size="icon"
		class="text-destructive hover:text-destructive h-8 w-8 shrink-0"
		onclick={onRemove}
		aria-label={$t('app.components.role_form.remove_condition')}
	>
		<Trash2 class="h-4 w-4" />
	</Button>

	{#if issueMessage}
		<p class="text-destructive basis-full text-xs">{issueMessage}</p>
	{:else if definition?.kind === 'sourceId' && !sources}
		<p class="text-muted-foreground basis-full text-xs">
			{$t('app.components.role_form.sources_unavailable_hint')}
		</p>
	{:else if definition?.kind === 'userRef' && !users}
		<p class="text-muted-foreground basis-full text-xs">
			{$t('app.components.role_form.users_unavailable_hint')}
		</p>
	{/if}
</div>
