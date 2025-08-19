<script lang="ts">
	import type { Role, CaslPolicy } from '@open-archiver/types';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Label } from '$lib/components/ui/label';

	let { role, onSubmit }: { role: Role | null; onSubmit: (formData: Partial<Role>) => void } =
		$props();

	let name = $state(role?.name || '');
	let policies = $state(JSON.stringify(role?.policies || [], null, 2));

	const handleSubmit = () => {
		try {
			const parsedPolicies: CaslPolicy[] = JSON.parse(policies);
			onSubmit({ name, policies: parsedPolicies });
		} catch (error) {
			alert('Invalid JSON format for policies.');
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
		<Label for="name" class="text-right">Name</Label>
		<Input id="name" bind:value={name} class="col-span-3" />
	</div>
	<div class="grid grid-cols-4 items-center gap-4">
		<Label for="policies" class="text-right">Policies (JSON)</Label>
		<Textarea id="policies" bind:value={policies} class="col-span-3" rows={10} />
	</div>
	<div class="flex justify-end">
		<Button type="submit">Save</Button>
	</div>
</form>
