<script lang="ts">
	import { Popover as PopoverPrimitive } from "bits-ui";
	import type { Snippet } from "svelte";

	let {
		open = $bindable(false),
		onOpenChange,
		children,
		...restProps
	}: PopoverPrimitive.RootProps & {
		children?: Snippet;
	} = $props();
</script>

<PopoverPrimitive.Root bind:open {onOpenChange} {...restProps}>
	{@render children?.()}
</PopoverPrimitive.Root>
