<script lang="ts">
	import type { Role, CaslPolicy } from '@open-archiver/types';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Label } from '$lib/components/ui/label';
	import { t } from '$lib/translations';

	let { role, onSubmit }: { role: Role | null; onSubmit: (formData: Partial<Role>) => void } =
		$props();

	let name = $state(role?.name || '');
	let policies = $state(JSON.stringify(role?.policies || [], null, 2));

	const handleSubmit = () => {
		try {
			const parsedPolicies: CaslPolicy[] = JSON.parse(policies);
			onSubmit({ name, policies: parsedPolicies });
		} catch (error) {
			alert($t('components.role_form.invalid_json'));
		}
	};
</script>

<form
	onsubmit={(e) => {
		e.preventDefault();
		handleSubmit();
	}}
	class="grid gap-4 py-4"
>
	<div class="grid grid-cols-4 items-center gap-4">
		<Label for="name" class="text-right">{$t('roles.name')}</Label>
		<Input id="name" bind:value={name} class="col-span-3" />
	</div>
	<div class="grid grid-cols-4 items-center gap-4">
		<Label for="policies" class="text-right">{$t('components.role_form.policies_json')}</Label>
		<Textarea
			id="policies"
			bind:value={policies}
			class="col-span-3 max-h-96 overflow-y-auto"
			rows={10}
		/>
	</div>
	<div class="flex justify-end">
		<Button type="submit">{$t('components.common.save')}</Button>
	</div>
</form>
