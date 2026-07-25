<script lang="ts">
	import type { ComponentType } from 'svelte';
	import { Button } from '$lib/components/ui/button/index.js';

	let {
		icon: Icon,
		header,
		text,
		buttonText,
		click,
	}: {
		icon: ComponentType;
		header: string;
		text: string;
		buttonText?: string;
		click?: () => void;
	} = $props();
</script>

<div class="space-y-4 rounded-lg border-2 border-dashed border-gray-300 p-6 text-center">
	<div>
		<Icon class="mx-auto size-12 text-gray-400" />
	</div>

	<h3 class="0 mt-2 text-sm font-semibold">{header}</h3>
	<p class="mt-1 text-sm">{text}</p>
	{#if buttonText && click}
		<div>
			<Button
				variant="outline"
				class="cursor-pointer"
				onclick={() => {
					click?.();
				}}
			>
				{buttonText}
			</Button>
		</div>
	{/if}
</div>
