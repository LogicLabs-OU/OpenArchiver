<script lang="ts">
	import { Calendar as CalendarPrimitive } from "bits-ui";
	import ChevronLeftIcon from "@lucide/svelte/icons/chevron-left";
	import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";
	import CalendarDay from "./calendar-day.svelte";
	import { cn, type WithoutChildrenOrChild } from "$lib/utils.js";
	import { buttonVariants } from "$lib/components/ui/button/button.svelte";

	let {
		ref = $bindable(null),
		class: className,
		weekdayFormat = "short",
		buttonVariant = "ghost",
		captionLayout = "label",
		...restProps
	}: WithoutChildrenOrChild<CalendarPrimitive.RootProps> & {
		buttonVariant?: "default" | "outline" | "ghost" | "secondary" | "link" | "destructive";
		captionLayout?: "label" | "dropdown";
	} = $props();
</script>

<CalendarPrimitive.Root
	bind:ref
	{weekdayFormat}
	data-slot="calendar"
	class={cn("bg-background group/calendar p-3", className)}
	{...restProps}
>
	{#snippet children({ months, weekdays })}
		<CalendarPrimitive.Header class="flex justify-center pt-1 relative items-center">
			<CalendarPrimitive.PrevButton
				class={cn(
					buttonVariants({ variant: buttonVariant }),
					"size-7 bg-transparent p-0 opacity-50 hover:opacity-100 absolute left-1"
				)}
			>
				<ChevronLeftIcon class="size-4" />
			</CalendarPrimitive.PrevButton>
			<CalendarPrimitive.Heading class="text-sm font-medium" />
			<CalendarPrimitive.NextButton
				class={cn(
					buttonVariants({ variant: buttonVariant }),
					"size-7 bg-transparent p-0 opacity-50 hover:opacity-100 absolute right-1"
				)}
			>
				<ChevronRightIcon class="size-4" />
			</CalendarPrimitive.NextButton>
		</CalendarPrimitive.Header>
		<div class="flex flex-col sm:flex-row gap-4 mt-4">
			{#each months as month (month.value)}
				<CalendarPrimitive.Grid class="w-full border-collapse space-y-1">
					<CalendarPrimitive.GridHead>
						<CalendarPrimitive.GridRow class="flex">
							{#each weekdays as day (day)}
								<CalendarPrimitive.HeadCell
									class="text-muted-foreground rounded-md w-8 font-normal text-[0.8rem]"
								>
									{day.slice(0, 2)}
								</CalendarPrimitive.HeadCell>
							{/each}
						</CalendarPrimitive.GridRow>
					</CalendarPrimitive.GridHead>
					<CalendarPrimitive.GridBody>
						{#each month.weeks as weekDates (weekDates[0].toString())}
							<CalendarPrimitive.GridRow class="flex w-full mt-2">
								{#each weekDates as date (date.toString())}
									<CalendarPrimitive.Cell
										{date}
										month={month.value}
										class="relative p-0 text-center text-sm focus-within:relative focus-within:z-20 [&:has([data-selected])]:bg-accent [&:has([data-selected][data-outside-month])]:bg-accent/50 first:[&:has([data-selected])]:rounded-l-md last:[&:has([data-selected])]:rounded-r-md"
									>
										<CalendarDay />
									</CalendarPrimitive.Cell>
								{/each}
							</CalendarPrimitive.GridRow>
						{/each}
					</CalendarPrimitive.GridBody>
				</CalendarPrimitive.Grid>
			{/each}
		</div>
	{/snippet}
</CalendarPrimitive.Root>
