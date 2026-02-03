<script lang="ts">
	import { page } from '$app/state';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import * as Alert from '$lib/components/ui/alert/index.js';
</script>

<div class="flex h-full w-full flex-col items-center justify-center space-y-4">
	<Alert.Root variant="destructive">
		<CircleAlertIcon class="size-4" />
		<Alert.Title>
			<h1 class=" font-bold">Error: {page.status}</h1>
		</Alert.Title>
		<Alert.Description>
			<div class=" space-y-2">
				<div>
					{page.error?.message}
				</div>
			</div>
		</Alert.Description>
	</Alert.Root>
</div>
