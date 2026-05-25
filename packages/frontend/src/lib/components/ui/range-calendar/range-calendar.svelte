<script lang="ts">
	import { RangeCalendar as RangeCalendarPrimitive } from "bits-ui";
	import ChevronLeftIcon from "@lucide/svelte/icons/chevron-left";
	import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";
	import RangeCalendarDay from "./range-calendar-day.svelte";
	import { cn, type WithoutChildrenOrChild } from "$lib/utils.js";
	import { buttonVariants } from "$lib/components/ui/button/button.svelte";

	let {
		ref = $bindable(null),
		class: className,
		weekdayFormat = "short",
		buttonVariant = "ghost",
		...restProps
	}: WithoutChildrenOrChild<RangeCalendarPrimitive.RootProps> & {
		buttonVariant?: "default" | "outline" | "ghost" | "secondary" | "link" | "destructive";
	} = $props();
</script>

<RangeCalendarPrimitive.Root
	bind:ref
	{weekdayFormat}
	data-slot="range-calendar"
	class={cn("bg-background group/range-calendar p-3", className)}
	{...restProps}
>
	{#snippet children({ months, weekdays })}
		<RangeCalendarPrimitive.Header class="flex justify-center pt-1 relative items-center">
			<RangeCalendarPrimitive.PrevButton
				class={cn(
					buttonVariants({ variant: buttonVariant }),
					"size-7 bg-transparent p-0 opacity-50 hover:opacity-100 absolute left-1"
				)}
			>
				<ChevronLeftIcon class="size-4" />
			</RangeCalendarPrimitive.PrevButton>
			<RangeCalendarPrimitive.Heading class="text-sm font-medium" />
			<RangeCalendarPrimitive.NextButton
				class={cn(
					buttonVariants({ variant: buttonVariant }),
					"size-7 bg-transparent p-0 opacity-50 hover:opacity-100 absolute right-1"
				)}
			>
				<ChevronRightIcon class="size-4" />
			</RangeCalendarPrimitive.NextButton>
		</RangeCalendarPrimitive.Header>
		<div class="flex flex-col sm:flex-row gap-4 mt-4">
			{#each months as month (month.value)}
				<RangeCalendarPrimitive.Grid class="w-full border-collapse space-y-1">
					<RangeCalendarPrimitive.GridHead>
						<RangeCalendarPrimitive.GridRow class="flex">
							{#each weekdays as day (day)}
								<RangeCalendarPrimitive.HeadCell
									class="text-muted-foreground rounded-md w-8 font-normal text-[0.8rem]"
								>
									{day.slice(0, 2)}
								</RangeCalendarPrimitive.HeadCell>
							{/each}
						</RangeCalendarPrimitive.GridRow>
					</RangeCalendarPrimitive.GridHead>
					<RangeCalendarPrimitive.GridBody>
						{#each month.weeks as weekDates (weekDates[0].toString())}
							<RangeCalendarPrimitive.GridRow class="flex w-full mt-2">
								{#each weekDates as date (date.toString())}
									<RangeCalendarPrimitive.Cell
										{date}
										month={month.value}
										class="relative p-0 text-center text-sm focus-within:relative focus-within:z-20 [&:has([data-selected])]:bg-accent [&:has([data-selected][data-outside-month])]:bg-accent/50 [&:has([data-selection-start])]:rounded-l-md [&:has([data-selection-end])]:rounded-r-md"
									>
										<RangeCalendarDay />
									</RangeCalendarPrimitive.Cell>
								{/each}
							</RangeCalendarPrimitive.GridRow>
						{/each}
					</RangeCalendarPrimitive.GridBody>
				</RangeCalendarPrimitive.Grid>
			{/each}
		</div>
	{/snippet}
</RangeCalendarPrimitive.Root>
