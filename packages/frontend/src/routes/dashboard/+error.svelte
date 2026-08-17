<script lang="ts">
	import { page } from '$app/state';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import EnterpriseFeatureNotice from '$lib/components/custom/ee/EnterpriseFeatureNotice.svelte';
	import { t } from '$lib/translations';

	/**
	 * A page that belongs to the Enterprise Edition is not a failure, so it does not get the failure
	 * treatment. The navigation is the same in both editions, so this is a page an open-source user
	 * reaches by ordinary browsing, and the notice explains what lives there.
	 *
	 * Keyed on `code` rather than the 403 status: a 403 is just as likely to be a missing permission,
	 * and answering that with an upgrade pitch would be misleading.
	 */
	let enterpriseOnly = $derived(page.error?.code === 'enterprise_only');
</script>

{#if enterpriseOnly}
	<!-- No width cap here: the notice scales from the room it is given, and the dashboard container
	     already bounds it. It keeps its own reading measure regardless. -->
	<EnterpriseFeatureNotice
		feature={$t(page.error?.featureKey ?? '')}
		instructions={page.error?.pitchKey ? $t(page.error.pitchKey) : undefined}
	/>
{:else}
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
{/if}
