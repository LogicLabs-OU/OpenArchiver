<script lang="ts">
	import { Popover as PopoverPrimitive } from "bits-ui";
	import CalendarIcon from "@lucide/svelte/icons/calendar";
	import { cn, type WithoutChild } from "$lib/utils.js";
	import { buttonVariants } from "$lib/components/ui/button/button.svelte";
	import type { DateValue } from "@internationalized/date";

	let {
		ref = $bindable(null),
		class: className,
		value,
		placeholder = "Pick a date",
		formatter,
		children,
		...restProps
	}: WithoutChild<PopoverPrimitive.TriggerProps> & {
		value?: DateValue;
		placeholder?: string;
		formatter?: (value: DateValue) => string;
	} = $props();

	const defaultFormat = (v: DateValue) => {
		try {
			const d = v.toDate("UTC");
			return new Intl.DateTimeFormat(undefined, {
				dateStyle: "medium",
			}).format(d);
		} catch {
			return String(v);
		}
	};
</script>

<PopoverPrimitive.Trigger
	bind:ref
	data-slot="date-picker-trigger"
	class={cn(
		buttonVariants({ variant: "outline" }),
		"w-full justify-start text-left font-normal",
		!value && "text-muted-foreground",
		className
	)}
	{...restProps}
>
	<CalendarIcon class="mr-2 size-4" />
	{#if children}
		{@render children()}
	{:else if value}
		{(formatter ?? defaultFormat)(value)}
	{:else}
		{placeholder}
	{/if}
</PopoverPrimitive.Trigger>
