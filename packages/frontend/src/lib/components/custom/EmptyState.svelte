<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';

	let {
		header,
		text,
		buttonText,
		click,
	}: {
		header: string;
		text: string;
		buttonText?: string;
		click?: () => void;
	} = $props();
</script>

<div class="space-y-4 rounded-lg border-2 border-dashed border-gray-300 p-6 text-center">
	<div>
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			aria-hidden="true"
			class="mx-auto size-12 text-gray-400"
		>
			<path
				d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"
				stroke-width="2"
				vector-effect="non-scaling-stroke"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		</svg>
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
