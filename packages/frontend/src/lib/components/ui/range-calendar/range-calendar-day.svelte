<script lang="ts">
	import { RangeCalendar as RangeCalendarPrimitive } from "bits-ui";
	import { cn, type WithoutChildrenOrChild } from "$lib/utils.js";
	import { buttonVariants } from "$lib/components/ui/button/button.svelte";

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: WithoutChildrenOrChild<RangeCalendarPrimitive.DayProps> = $props();
</script>

<RangeCalendarPrimitive.Day
	bind:ref
	class={cn(
		buttonVariants({ variant: "ghost" }),
		"size-8 p-0 font-normal aria-selected:opacity-100",
		"[&[data-today]:not([data-selected])]:bg-accent [&[data-today]:not([data-selected])]:text-accent-foreground",
		"data-[selected]:bg-primary data-[selected]:text-primary-foreground data-[selected]:hover:bg-primary data-[selected]:hover:text-primary-foreground data-[selected]:focus:bg-primary data-[selected]:focus:text-primary-foreground",
		"data-[selection-start]:bg-primary data-[selection-start]:text-primary-foreground data-[selection-end]:bg-primary data-[selection-end]:text-primary-foreground",
		"data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
		"data-[disabled]:text-muted-foreground data-[disabled]:opacity-50",
		"data-[unavailable]:text-muted-foreground data-[unavailable]:line-through",
		"data-[outside-month]:text-muted-foreground data-[outside-month]:opacity-50",
		className
	)}
	{...restProps}
/>
