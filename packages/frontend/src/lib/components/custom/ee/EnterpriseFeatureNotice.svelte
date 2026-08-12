<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Building2, ExternalLink } from 'lucide-svelte';
	import { t } from '$lib/translations';

	/**
	 * Explains that a feature belongs to the Enterprise Edition, and links to the edition
	 * comparison.
	 *
	 * Purely presentational: it never reads `enterpriseMode` itself, so the caller decides when the
	 * notice appears and the component can be dropped into any layout.
	 */
	interface Props {
		/** Name of the gated feature, already translated. Shown as the heading. */
		feature: string;
		/** Optional line telling the user what they can do instead, already translated. */
		instructions?: string;
	}

	let { feature, instructions }: Props = $props();

	/** The `utm_source` marks visits that started from an in-product notice in an OSS build. */
	const PRICING_URL = 'https://openarchiver.com/pricing?utm_source=oss_feature_notice';
</script>

<div class="rounded-md border border-dashed p-6 text-center">
	<Building2 class="text-muted-foreground mx-auto size-8" />

	<Badge variant="secondary" class="mt-3">
		{$t('app.components.enterprise_feature_notice.badge')}
	</Badge>

	<h3 class="mt-2 text-sm font-semibold">{feature}</h3>

	<p class="text-muted-foreground mx-auto mt-1 max-w-md text-sm">
		{$t('app.components.enterprise_feature_notice.description')}
		{$t('app.components.enterprise_feature_notice.upgrade')}
	</p>

	{#if instructions}
		<p class="text-muted-foreground mx-auto mt-2 max-w-md text-sm">{instructions}</p>
	{/if}

	<Button
		href={PRICING_URL}
		target="_blank"
		rel="noopener noreferrer"
		variant="outline"
		size="sm"
		class="mt-4"
	>
		{$t('app.components.enterprise_feature_notice.cta')}
		<ExternalLink class="ml-1.5 size-4" />
	</Button>
</div>
