<script lang="ts">
	import type { Role, CaslPolicy, SafeIngestionSource } from '@open-archiver/types';
	import * as Alert from '$lib/components/ui/alert';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Label } from '$lib/components/ui/label';
	import { CircleAlert } from 'lucide-svelte';
	import { t } from '$lib/translations';
	import PolicyEditor from './policy-editor/PolicyEditor.svelte';
	import EnterpriseFeatureNotice from './ee/EnterpriseFeatureNotice.svelte';
	import { ALL_ACTIONS, ALL_SUBJECTS } from '$lib/policy-editor/catalog';
	import {
		policiesToUiModel,
		uiModelToPolicies,
		validateUiModel,
		type UiModel,
		type Unsupported,
	} from '$lib/policy-editor/transform';

	interface Props {
		role: Role | null;
		onSubmit: (formData: Partial<Role>) => void;
		/** null when the ingestion sources could not be loaded for this admin. */
		sources?: SafeIngestionSource[] | null;
		users?: { id: string; email: string }[] | null;
		/**
		 * The visual editor is an Enterprise Edition feature. In an open-source build the JSON
		 * editor remains fully usable and the visual tab explains the difference.
		 */
		enterpriseMode?: boolean | null;
	}

	let { role, onSubmit, sources = null, users = null, enterpriseMode = false }: Props = $props();

	let name = $state(role?.name || '');

	const initial = policiesToUiModel(role?.policies ?? []);

	// The visual tab is the default. It only gives way to JSON when the visual editor is available
	// but cannot draw the policy; without the Enterprise Edition it opens on the notice, which is
	// where the feature should be discovered.
	let mode = $state<'visual' | 'json'>(!enterpriseMode || initial.ok ? 'visual' : 'json');
	let model = $state<UiModel>(initial.ok ? initial.model : { statements: [] });
	let jsonText = $state(JSON.stringify(role?.policies ?? [], null, 2));
	/** Set while the current JSON cannot be represented in the visual editor. */
	let unsupported = $state<Unsupported | null>(initial.ok ? null : initial);
	let formError = $state<string | null>(null);

	/** Turns an unsupported-shape report into the sentence shown to the user. */
	const describe = (reason: Unsupported): string =>
		($t as any)(`app.components.role_form.reason_${reason.code}`, {
			index: reason.statementIndex ?? '',
			detail: reason.detail ?? '',
		});

	/** True while the visual editor is actually mounted, rather than the upgrade notice. */
	const visualActive = $derived(mode === 'visual' && !!enterpriseMode);

	const issues = $derived(visualActive ? validateUiModel(model) : []);

	const showVisual = () => {
		if (mode === 'visual') return;
		// Without the Enterprise Edition the tab shows what the feature does rather than an
		// editor, so there is no JSON to parse into a model.
		if (!enterpriseMode) {
			formError = null;
			mode = 'visual';
			return;
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(jsonText);
		} catch {
			formError = $t('app.components.role_form.invalid_json');
			return;
		}
		const result = policiesToUiModel(parsed);
		if (!result.ok) {
			unsupported = result;
			formError = describe(result);
			return;
		}
		model = result.model;
		unsupported = null;
		formError = null;
		mode = 'visual';
	};

	const showJson = () => {
		if (mode === 'json') return;
		// Only re-serialize when the model could actually be edited. Otherwise the JSON the user
		// has been typing is the only source of truth and must survive the switch.
		if (enterpriseMode) {
			jsonText = JSON.stringify(uiModelToPolicies(model), null, 2);
		}
		formError = null;
		mode = 'json';
	};

	/**
	 * Mirrors the checks the server performs, so a bad action or subject is caught before the
	 * request. Conditions are not validated server-side; unrecognised ones only warn.
	 */
	const validateRawPolicies = (parsed: unknown): string | null => {
		if (!Array.isArray(parsed)) return describe({ code: 'not_array' });
		for (let i = 0; i < parsed.length; i += 1) {
			const policy = parsed[i];
			const at = i + 1;
			if (typeof policy !== 'object' || policy === null || Array.isArray(policy)) {
				return describe({ code: 'not_object', statementIndex: at });
			}
			const { action, subject } = policy as Record<string, unknown>;
			if (action === undefined || subject === undefined) {
				return describe({ code: 'missing_action_or_subject', statementIndex: at });
			}
			for (const value of Array.isArray(action) ? action : [action]) {
				if (typeof value !== 'string' || !ALL_ACTIONS.includes(value as never)) {
					return describe({
						code: 'invalid_action',
						statementIndex: at,
						detail: String(value),
					});
				}
			}
			for (const value of Array.isArray(subject) ? subject : [subject]) {
				if (typeof value !== 'string' || !ALL_SUBJECTS.includes(value as never)) {
					return describe({
						code: 'invalid_subject',
						statementIndex: at,
						detail: String(value),
					});
				}
			}
		}
		return null;
	};

	/**
	 * Shown while editing, not on save: the dialog closes as soon as a save succeeds, so a warning
	 * raised at submit time would never be read.
	 */
	const jsonWarning = $derived.by(() => {
		if (mode !== 'json') return null;
		let parsed: unknown;
		try {
			parsed = JSON.parse(jsonText);
		} catch {
			return null;
		}
		// A shape the server would reject is reported as an error on save instead.
		if (validateRawPolicies(parsed)) return null;
		return policiesToUiModel(parsed).ok
			? null
			: $t('app.components.role_form.json_catalog_warning');
	});

	const handleSubmit = () => {
		formError = null;

		// Saving from the visual tab only means something when the editor is really there; on the
		// upgrade notice the JSON is still what the user has been editing.
		if (visualActive) {
			if (issues.length > 0) {
				formError = $t('app.components.role_form.fix_errors_before_save');
				return;
			}
			onSubmit({ name, policies: uiModelToPolicies(model) });
			return;
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(jsonText);
		} catch {
			formError = $t('app.components.role_form.invalid_json');
			return;
		}

		const problem = validateRawPolicies(parsed);
		if (problem) {
			formError = problem;
			return;
		}

		onSubmit({ name, policies: parsed as CaslPolicy[] });
	};
</script>

<form
	onsubmit={(e) => {
		e.preventDefault();
		handleSubmit();
	}}
	class="flex max-h-[70vh] flex-col gap-4 py-4"
>
	<div class="space-y-1.5">
		<Label for="role-name">{$t('app.roles.name')}</Label>
		<Input id="role-name" bind:value={name} />
	</div>

	<div class="flex flex-wrap items-center gap-2">
		<Label class="mr-auto">{$t('app.components.role_form.permissions_label')}</Label>
		<div class="bg-muted inline-flex gap-1 rounded-md p-1">
			<Button
				type="button"
				size="sm"
				class="h-7 px-3 text-xs"
				variant={mode === 'visual' ? 'default' : 'ghost'}
				onclick={showVisual}
			>
				{$t('app.components.role_form.visual_mode')}
			</Button>
			<Button
				type="button"
				size="sm"
				class="h-7 px-3 text-xs"
				variant={mode === 'json' ? 'default' : 'ghost'}
				onclick={showJson}
			>
				{$t('app.components.role_form.json_mode')}
			</Button>
		</div>
	</div>

	<!-- Only worth saying when the visual editor is reachable; in an open-source build it would
		 describe a tab the user cannot edit in anyway. -->
	{#if mode === 'json' && unsupported && enterpriseMode}
		<Alert.Root>
			<CircleAlert class="size-4" />
			<Alert.Title>{$t('app.components.role_form.too_complex_title')}</Alert.Title>
			<Alert.Description>
				{describe(unsupported)}
				{$t('app.components.role_form.too_complex_hint')}
			</Alert.Description>
		</Alert.Root>
	{/if}

	{#if formError}
		<Alert.Root variant="destructive">
			<CircleAlert class="size-4" />
			<Alert.Description>{formError}</Alert.Description>
		</Alert.Root>
	{/if}

	{#if jsonWarning}
		<Alert.Root>
			<CircleAlert class="size-4" />
			<Alert.Description>{jsonWarning}</Alert.Description>
		</Alert.Root>
	{/if}

	<!-- p-1 rather than pr-1: this element scrolls, so it clips its children, and the focus ring
		 sits 3px outside the field it belongs to. Without room on every side the ring is cut off
		 along the container edges — most visibly on the full-width JSON textarea. -->
	<div class="min-h-0 flex-1 overflow-y-auto p-1">
		{#if visualActive}
			<PolicyEditor bind:model {sources} {users} {issues} />
		{:else if mode === 'visual'}
			<EnterpriseFeatureNotice
				feature={$t('app.components.role_form.visual_editor_feature')}
				instructions={$t('app.components.role_form.oss_json_available')}
			/>
		{:else}
			<div class="space-y-1.5">
				<p class="text-muted-foreground text-xs">
					{$t('app.components.role_form.json_hint')}
				</p>
				<Textarea id="policies" bind:value={jsonText} class="font-mono text-sm" rows={16} />
			</div>
		{/if}
	</div>

	<div class="flex justify-end">
		<Button type="submit">{$t('app.components.common.save')}</Button>
	</div>
</form>
