<script lang="ts">
	import { ToggleGroup as ToggleGroupPrimitive } from "bits-ui";
	import { getContext } from "svelte";
	import { cn } from "$lib/utils.js";
	import type { ToggleGroupVariant, ToggleGroupSize } from "./toggle-group.svelte";

	let {
		ref = $bindable(null),
		class: className,
		variant: variantProp,
		size: sizeProp,
		...restProps
	}: ToggleGroupPrimitive.ItemProps & {
		variant?: ToggleGroupVariant;
		size?: ToggleGroupSize;
	} = $props();

	const ctx = getContext<{ variant: ToggleGroupVariant; size: ToggleGroupSize } | undefined>(
		"toggle-group-context"
	);
	const variant = $derived(variantProp ?? ctx?.variant ?? "default");
	const size = $derived(sizeProp ?? ctx?.size ?? "default");

	const sizeClasses = $derived.by(() => {
		if (size === "sm") return "h-8 px-1.5 min-w-8";
		if (size === "lg") return "h-10 px-2.5 min-w-10";
		return "h-9 px-2 min-w-9";
	});

	const variantClasses = $derived.by(() => {
		if (variant === "outline")
			return "border border-input bg-transparent shadow-xs hover:bg-accent hover:text-accent-foreground";
		return "bg-transparent hover:bg-muted hover:text-muted-foreground";
	});
</script>

<ToggleGroupPrimitive.Item
	bind:ref
	data-slot="toggle-group-item"
	data-variant={variant}
	data-size={size}
	class={cn(
		"inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-[color,box-shadow] outline-none aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground min-w-0 flex-1 shrink-0 rounded-none shadow-none first:rounded-l-md last:rounded-r-md focus:z-10 focus-visible:z-10 data-[variant=outline]:border-l-0 data-[variant=outline]:first:border-l",
		sizeClasses,
		variantClasses,
		className
	)}
	{...restProps}
/>
