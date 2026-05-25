<script lang="ts" module>
	import { type VariantProps, tv } from "tailwind-variants";

	export const toggleGroupVariants = tv({
		base: "group/toggle-group flex w-fit items-center rounded-md data-[variant=outline]:shadow-xs",
		variants: {
			variant: {
				default: "",
				outline: "",
			},
			size: {
				default: "",
				sm: "",
				lg: "",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	});

	export type ToggleGroupVariant = VariantProps<typeof toggleGroupVariants>["variant"];
	export type ToggleGroupSize = VariantProps<typeof toggleGroupVariants>["size"];
</script>

<script lang="ts">
	import { ToggleGroup as ToggleGroupPrimitive } from "bits-ui";
	import { setContext } from "svelte";
	import { cn } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		variant = "default",
		size = "default",
		children,
		...restProps
	}: ToggleGroupPrimitive.RootProps & {
		variant?: ToggleGroupVariant;
		size?: ToggleGroupSize;
	} = $props();

	setContext("toggle-group-context", {
		get variant() {
			return variant;
		},
		get size() {
			return size;
		},
	});
</script>

<ToggleGroupPrimitive.Root
	bind:ref
	data-slot="toggle-group"
	data-variant={variant}
	data-size={size}
	class={cn(toggleGroupVariants({ variant, size }), className)}
	{...restProps}
>
	{@render children?.()}
</ToggleGroupPrimitive.Root>
