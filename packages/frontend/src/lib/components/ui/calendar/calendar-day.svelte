<script lang="ts">
	import { Calendar as CalendarPrimitive } from "bits-ui";
	import { cn, type WithoutChildrenOrChild } from "$lib/utils.js";
	import { buttonVariants } from "$lib/components/ui/button/button.svelte";

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: WithoutChildrenOrChild<CalendarPrimitive.DayProps> = $props();
</script>

<CalendarPrimitive.Day
	bind:ref
	class={cn(
		buttonVariants({ variant: "ghost" }),
		"size-8 p-0 font-normal aria-selected:opacity-100",
		"[&[data-today]:not([data-selected])]:bg-accent [&[data-today]:not([data-selected])]:text-accent-foreground",
		"data-[selected]:bg-primary data-[selected]:text-primary-foreground data-[selected]:hover:bg-primary data-[selected]:hover:text-primary-foreground data-[selected]:focus:bg-primary data-[selected]:focus:text-primary-foreground",
		"data-[disabled]:text-muted-foreground data-[disabled]:opacity-50",
		"data-[unavailable]:text-muted-foreground data-[unavailable]:line-through",
		"data-[outside-month]:text-muted-foreground data-[outside-month]:opacity-50 data-[outside-month]:aria-selected:bg-accent/50 data-[outside-month]:aria-selected:text-muted-foreground",
		className
	)}
	{...restProps}
/>
