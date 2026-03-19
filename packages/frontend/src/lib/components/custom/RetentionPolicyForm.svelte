<script lang="ts">
	import { t } from '$lib/translations';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Button } from '$lib/components/ui/button';
	import { Switch } from '$lib/components/ui/switch';
	import { Badge } from '$lib/components/ui/badge';
	import * as Select from '$lib/components/ui/select/index.js';
	import { enhance } from '$app/forms';
	import { Trash2, Plus, Database } from 'lucide-svelte';
	import type {
		RetentionPolicy,
		RetentionRule,
		ConditionField,
		ConditionOperator,
		LogicalOperator,
		SafeIngestionSource,
	} from '@open-archiver/types';

	interface Props {
		/** Existing policy to edit; undefined means create mode */
		policy?: RetentionPolicy;
		isLoading?: boolean;
		/** All available ingestion sources for scope selection */
		ingestionSources?: SafeIngestionSource[];
		/** Form action to target, e.g. '?/create' or '?/update' */
		action: string;
		onCancel: () => void;
		/** Called after successful submission so the parent can close the dialog */
		onSuccess: () => void;
	}

	let {
		policy,
		isLoading = $bindable(false),
		ingestionSources = [],
		action,
		onCancel,
		onSuccess,
	}: Props = $props();

	// --- Form state ---
	let name = $state(policy?.name ?? '');
	let description = $state(policy?.description ?? '');
	let priority = $state(policy?.priority ?? 10);
	let retentionPeriodDays = $state(policy?.retentionPeriodDays ?? 365);
	let isEnabled = $state(policy?.isActive ?? true);

	// Conditions state
	let logicalOperator = $state<LogicalOperator>(policy?.conditions?.logicalOperator ?? 'AND');
	let rules = $state<RetentionRule[]>(
		policy?.conditions?.rules ? [...policy.conditions.rules] : []
	);

	// Ingestion scope: set of selected ingestion source IDs
	// Empty set = null scope = applies to all
	let selectedIngestionIds = $state<Set<string>>(new Set(policy?.ingestionScope ?? []));

	// The conditions JSON that gets sent as a hidden form field
	const conditionsJson = $derived(JSON.stringify({ logicalOperator, rules }));

	// The ingestionScope value: comma-separated UUIDs, or empty string for null (all)
	const ingestionScopeValue = $derived(
		selectedIngestionIds.size > 0 ? [...selectedIngestionIds].join(',') : ''
	);

	// --- Field options ---
	const fieldOptions: { value: ConditionField; label: string }[] = [
		{ value: 'sender', label: $t('app.retention_policies.field_sender') },
		{ value: 'recipient', label: $t('app.retention_policies.field_recipient') },
		{ value: 'subject', label: $t('app.retention_policies.field_subject') },
		{ value: 'attachment_type', label: $t('app.retention_policies.field_attachment_type') },
	];

	// --- Operator options (grouped for readability) ---
	const operatorOptions: { value: ConditionOperator; label: string }[] = [
		{ value: 'equals', label: $t('app.retention_policies.operator_equals') },
		{ value: 'not_equals', label: $t('app.retention_policies.operator_not_equals') },
		{ value: 'contains', label: $t('app.retention_policies.operator_contains') },
		{ value: 'not_contains', label: $t('app.retention_policies.operator_not_contains') },
		{ value: 'starts_with', label: $t('app.retention_policies.operator_starts_with') },
		{ value: 'ends_with', label: $t('app.retention_policies.operator_ends_with') },
		{ value: 'domain_match', label: $t('app.retention_policies.operator_domain_match') },
		{ value: 'regex_match', label: $t('app.retention_policies.operator_regex_match') },
	];

	function addRule() {
		rules = [...rules, { field: 'sender', operator: 'contains', value: '' }];
	}

	function removeRule(index: number) {
		rules = rules.filter((_, i) => i !== index);
	}

	function updateRuleField(index: number, field: ConditionField) {
		rules = rules.map((r, i) => (i === index ? { ...r, field } : r));
	}

	function updateRuleOperator(index: number, operator: ConditionOperator) {
		rules = rules.map((r, i) => (i === index ? { ...r, operator } : r));
	}

	function updateRuleValue(index: number, value: string) {
		rules = rules.map((r, i) => (i === index ? { ...r, value } : r));
	}

	function toggleIngestionSource(id: string) {
		const next = new Set(selectedIngestionIds);
		if (next.has(id)) {
			next.delete(id);
		} else {
			next.add(id);
		}
		selectedIngestionIds = next;
	}
</script>

<form
	method="POST"
	{action}
	class="space-y-5"
	use:enhance={() => {
		isLoading = true;
		return async ({ result, update }) => {
			isLoading = false;
			if (result.type === 'success') {
				onSuccess();
			}
			await update({ reset: false });
		};
	}}
>
	<!-- Hidden fields for policy id (edit mode), serialized conditions, and ingestion scope -->
	{#if policy}
		<input type="hidden" name="id" value={policy.id} />
	{/if}
	<input type="hidden" name="conditions" value={conditionsJson} />
	<input type="hidden" name="ingestionScope" value={ingestionScopeValue} />
	<!-- isEnabled as hidden field since Switch is not a native input -->
	<input type="hidden" name="isEnabled" value={String(isEnabled)} />

	<!-- Name -->
	<div class="space-y-1.5">
		<Label for="rp-name">{$t('app.retention_policies.name')}</Label>
		<Input
			id="rp-name"
			name="name"
			bind:value={name}
			required
			placeholder="e.g. Legal Department 7-Year"
		/>
	</div>

	<!-- Description -->
	<div class="space-y-1.5">
		<Label for="rp-description">{$t('app.retention_policies.description')}</Label>
		<Input
			id="rp-description"
			name="description"
			bind:value={description}
			placeholder="Optional description"
		/>
	</div>

	<div class="grid grid-cols-2 gap-4">
		<!-- Priority -->
		<div class="space-y-1.5">
			<Label for="rp-priority">{$t('app.retention_policies.priority')}</Label>
			<Input
				id="rp-priority"
				name="priority"
				type="number"
				min={1}
				bind:value={priority}
				required
			/>
		</div>

		<!-- Retention Period -->
		<div class="space-y-1.5">
			<Label for="rp-days">{$t('app.retention_policies.retention_period_days')}</Label>
			<Input
				id="rp-days"
				name="retentionPeriodDays"
				type="number"
				min={1}
				bind:value={retentionPeriodDays}
				required
			/>
		</div>
	</div>

	<!-- Action on Expiry (fixed to delete_permanently for Phase 1) -->
	<div class="space-y-1.5">
		<Label>{$t('app.retention_policies.action_on_expiry')}</Label>
		<Input value={$t('app.retention_policies.delete_permanently')} disabled />
	</div>

	<!-- Enabled toggle — value written to hidden input above -->
	<div class="flex items-center gap-3">
		<Switch id="rp-enabled" checked={isEnabled} onCheckedChange={(v) => (isEnabled = v)} />
		<Label for="rp-enabled">{$t('app.retention_policies.active')}</Label>
	</div>

	<!-- Ingestion Scope -->
	{#if ingestionSources.length > 0}
		<div class="space-y-2">
			<div class="flex items-center gap-2">
				<Database class="text-muted-foreground h-4 w-4" />
				<Label>{$t('app.retention_policies.ingestion_scope')}</Label>
			</div>
			<p class="text-muted-foreground text-xs">
				{$t('app.retention_policies.ingestion_scope_description')}
			</p>
			<div class="bg-muted/40 rounded-md border p-3">
				<!-- "All sources" option -->
				<label class="flex cursor-pointer items-center gap-2.5 py-1">
					<input
						type="checkbox"
						class="h-4 w-4 rounded"
						checked={selectedIngestionIds.size === 0}
						onchange={() => {
							selectedIngestionIds = new Set();
						}}
					/>
					<span class="text-sm font-medium italic">
						{$t('app.retention_policies.ingestion_scope_all')}
					</span>
				</label>
				<div class="my-2 border-t"></div>
				{#each ingestionSources as source (source.id)}
					<label class="flex cursor-pointer items-center gap-2.5 py-1">
						<input
							type="checkbox"
							class="h-4 w-4 rounded"
							checked={selectedIngestionIds.has(source.id)}
							onchange={() => toggleIngestionSource(source.id)}
						/>
						<span class="text-sm">{source.name}</span>
						<Badge variant="secondary" class="ml-auto text-[10px]">
							{source.provider.replace(/_/g, ' ')}
						</Badge>
					</label>
				{/each}
			</div>
			{#if selectedIngestionIds.size > 0}
				<p class="text-muted-foreground text-xs">
					{($t as any)('app.retention_policies.ingestion_scope_selected', {
						count: selectedIngestionIds.size,
					})}
				</p>
			{/if}
		</div>
	{/if}

	<!-- Conditions builder -->
	<div class="space-y-3">
		<div class="flex items-center justify-between">
			<Label>{$t('app.retention_policies.conditions')}</Label>
			{#if rules.length > 1}
				<Select.Root
					type="single"
					value={logicalOperator}
					onValueChange={(v) => (logicalOperator = v as LogicalOperator)}
				>
					<Select.Trigger class="h-8 w-24 text-xs">
						{logicalOperator}
					</Select.Trigger>
					<Select.Content>
						<Select.Item value="AND">{$t('app.retention_policies.and')}</Select.Item>
						<Select.Item value="OR">{$t('app.retention_policies.or')}</Select.Item>
					</Select.Content>
				</Select.Root>
			{/if}
		</div>
		<p class="text-muted-foreground text-xs">
			{$t('app.retention_policies.conditions_description')}
		</p>

		{#each rules as rule, i (i)}
			<div class="bg-muted/40 flex items-center gap-2 rounded-md border p-3">
				<!-- Field selector -->
				<Select.Root
					type="single"
					value={rule.field}
					onValueChange={(v) => updateRuleField(i, v as ConditionField)}
				>
					<Select.Trigger class="h-8 flex-1 text-xs">
						{fieldOptions.find((f) => f.value === rule.field)?.label ?? rule.field}
					</Select.Trigger>
					<Select.Content>
						{#each fieldOptions as opt}
							<Select.Item value={opt.value}>{opt.label}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>

				<!-- Operator selector -->
				<Select.Root
					type="single"
					value={rule.operator}
					onValueChange={(v) => updateRuleOperator(i, v as ConditionOperator)}
				>
					<Select.Trigger class="h-8 flex-1 text-xs">
						{operatorOptions.find((o) => o.value === rule.operator)?.label ??
							rule.operator}
					</Select.Trigger>
					<Select.Content>
						{#each operatorOptions as opt}
							<Select.Item value={opt.value}>{opt.label}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>

				<!-- Value input -->
				<Input
					class="h-8 flex-1 text-xs"
					value={rule.value}
					oninput={(e) => updateRuleValue(i, (e.target as HTMLInputElement).value)}
					placeholder={$t('app.retention_policies.value_placeholder')}
					required
				/>

				<!-- Remove rule -->
				<Button
					type="button"
					variant="ghost"
					size="icon"
					class="h-8 w-8 shrink-0"
					onclick={() => removeRule(i)}
					aria-label={$t('app.retention_policies.remove_rule')}
				>
					<Trash2 class="h-4 w-4" />
				</Button>
			</div>
		{/each}

		<Button type="button" variant="outline" size="sm" onclick={addRule}>
			<Plus class="mr-1.5 h-4 w-4" />
			{$t('app.retention_policies.add_rule')}
		</Button>
	</div>

	<!-- Actions -->
	<div class="flex justify-end gap-2 pt-2">
		<Button type="button" variant="outline" onclick={onCancel} disabled={isLoading}>
			{$t('app.retention_policies.cancel')}
		</Button>
		<Button type="submit" disabled={isLoading}>
			{#if isLoading}
				{$t('app.components.common.submitting')}
			{:else if policy}
				{$t('app.retention_policies.save')}
			{:else}
				{$t('app.retention_policies.create')}
			{/if}
		</Button>
	</div>
</form>
