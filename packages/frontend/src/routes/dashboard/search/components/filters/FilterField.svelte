<script lang="ts">
	/**
	 * Shared shell for every advanced-search filter component.
	 *
	 * Renders the label and (optionally) a help-tooltip trigger; the field body
	 * is supplied via the `children` snippet. Holds no state and does not bind
	 * to any value — it is purely visual scaffolding per P4 §1.2.4.
	 */
	import type { Snippet } from 'svelte';
	import { Label } from '$lib/components/ui/label';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import CircleHelpIcon from '@lucide/svelte/icons/circle-help';
	import { t } from '$lib/translations';
	import { cn } from '$lib/utils';

	type Props = {
		label: string;
		/** Translation key for the help-tooltip body. When omitted, no help icon renders. */
		helpKey?: string;
		/** Optional id of the labelled input; forwarded to `<Label for=...>` when set. */
		for?: string;
		class?: string;
		children: Snippet;
	};

	let { label, helpKey, for: htmlFor, class: className, children }: Props = $props();
</script>

<div class={cn('flex flex-col gap-1.5', className)}>
	<div class="flex items-center gap-1.5">
		<Label for={htmlFor} class="text-xs font-medium">{label}</Label>
		{#if helpKey}
			<Tooltip.Provider>
				<Tooltip.Root>
					<Tooltip.Trigger
						type="button"
						class="text-muted-foreground hover:text-foreground cursor-help"
						aria-label={label}
					>
						<CircleHelpIcon class="size-3.5" />
					</Tooltip.Trigger>
					<Tooltip.Content side="top">{$t(helpKey)}</Tooltip.Content>
				</Tooltip.Root>
			</Tooltip.Provider>
		{/if}
	</div>
	{@render children()}
</div>
