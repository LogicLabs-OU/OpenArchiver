<script lang="ts">
	import type { PageData } from './$types';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import * as Label from '$lib/components/ui/label';
	import * as RadioGroup from '$lib/components/ui/radio-group';
	import * as Select from '$lib/components/ui/select';
	import { setAlert } from '$lib/components/custom/alert/alert-state.svelte';
	import type { SupportedLanguage } from '@open-archiver/types';

	let { data, form }: { data: PageData; form: any } = $props();
	let settings = $state(data.settings);
	let isSaving = $state(false);

	const languageOptions: { value: SupportedLanguage; label: string }[] = [
		{ value: 'en', label: 'English' },
		{ value: 'es', label: 'Spanish' },
		{ value: 'fr', label: 'French' },
		{ value: 'de', label: 'German' },
		{ value: 'it', label: 'Italian' },
		{ value: 'pt', label: 'Portuguese' },
		{ value: 'nl', label: 'Dutch' },
		{ value: 'ja', label: 'Japanese' },
	];

	const languageTriggerContent = $derived(
		languageOptions.find((lang) => lang.value === settings.language)?.label ??
			'Select a language'
	);

	$effect(() => {
		if (form?.success) {
			settings = form.settings;
			setAlert({
				type: 'success',
				title: 'Settings Updated',
				message: 'Your changes have been saved successfully.',
				duration: 3000,
				show: true,
			});
		} else if (form?.message) {
			setAlert({
				type: 'error',
				title: 'Update Failed',
				message: form.message,
				duration: 5000,
				show: true,
			});
		}
	});
</script>

<svelte:head>
	<title>System Settings - OpenArchiver</title>
</svelte:head>

<div class="space-y-6">
	<div>
		<h1 class="text-2xl font-bold">System Settings</h1>
		<p class="text-muted-foreground">Manage global application settings.</p>
	</div>

	<form method="POST" class="space-y-8" onsubmit={() => (isSaving = true)}>
		<Card.Root>
			<Card.Content class="space-y-4">
				<!-- Hide language setting for now -->
				<!-- <div class="grid gap-2">
					<Label.Root class="mb-1" for="language">Language</Label.Root>
					<Select.Root name="language" bind:value={settings.language} type="single">
						<Select.Trigger class="w-[280px]">
							{languageTriggerContent}
						</Select.Trigger>
						<Select.Content> 
							{#each languageOptions as lang}
								<Select.Item value={lang.value}>{lang.label}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div> -->

				<div class="grid gap-2">
					<Label.Root class="mb-1">Default theme</Label.Root>
					<RadioGroup.Root
						bind:value={settings.theme}
						name="theme"
						class="flex items-center gap-4"
					>
						<div class="flex items-center gap-2">
							<RadioGroup.Item value="light" id="light" />
							<Label.Root for="light">Light</Label.Root>
						</div>
						<div class="flex items-center gap-2">
							<RadioGroup.Item value="dark" id="dark" />
							<Label.Root for="dark">Dark</Label.Root>
						</div>
						<div class="flex items-center gap-2">
							<RadioGroup.Item value="system" id="system" />
							<Label.Root for="system">System</Label.Root>
						</div>
					</RadioGroup.Root>
				</div>

				<div class="grid gap-2">
					<Label.Root class="mb-1" for="supportEmail">Support Email</Label.Root>
					<Input
						id="supportEmail"
						name="supportEmail"
						type="email"
						placeholder="support@example.com"
						bind:value={settings.supportEmail}
						class="max-w-sm"
					/>
				</div>
			</Card.Content>
			<Card.Footer class="border-t px-6 py-4">
				<Button type="submit" disabled={isSaving}>
					{#if isSaving}Saving...{:else}Save Changes{/if}
				</Button>
			</Card.Footer>
		</Card.Root>
	</form>
</div>
