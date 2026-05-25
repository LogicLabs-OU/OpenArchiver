<script lang="ts">
	import { Tooltip as TooltipPrimitive } from "bits-ui";

	let { delayDuration = 0, ...restProps }: TooltipPrimitive.RootProps = $props();
</script>

<TooltipPrimitive.Root {delayDuration} {...restProps} />
