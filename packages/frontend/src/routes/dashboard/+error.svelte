<script lang="ts">
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
</script>

<div class="flex h-full w-full flex-col items-center justify-center">
	<div class="bg-card space-y-4 rounded-lg border p-10 text-center shadow-sm">
		<h1 class="text-destructive text-4xl font-bold">{page.status}</h1>
		<p class="text-muted-foreground mt-4 text-lg">Oops! Something went wrong.</p>
		<p class=" bg-muted mt-2 rounded-md p-4 font-mono text-base">
			{page.error?.message}
		</p>
		<div>
			<a href="/dashboard" class="mt-6">
				<Button>Go to Dashboard</Button>
			</a>
		</div>
	</div>
</div>
