<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Building2, ExternalLink } from 'lucide-svelte';
	import { t } from '$lib/translations';
	import { cn } from '$lib/utils';

	/**
	 * Explains that a feature belongs to the Enterprise Edition, and links to the edition
	 * comparison.
	 *
	 * Purely presentational: it never reads `enterpriseMode` itself, so the caller decides when the
	 * notice appears and the component can be dropped into any layout.
	 *
	 * Sizes itself from its container rather than the viewport, via `@container`. That distinction
	 * matters here: the same notice fills a dashboard page and sits inside a dialog or a form tab,
	 * and a viewport breakpoint would blow the dialog copy up to page size on a wide screen. Every
	 * step below keys off how much room the notice was actually given.
	 */
	interface Props {
		/** Name of the gated feature, already translated. Shown as the heading. */
		feature: string;
		/** Optional line telling the user what they can do instead, already translated. */
		instructions?: string;
		/** Extra classes for the outer element, so a caller can cap or pad it. */
		class?: string;
	}

	let { feature, instructions, class: className = '' }: Props = $props();

	/** The `utm_source` marks visits that started from an in-product notice in an OSS build. */
	const PRICING_URL = 'https://openarchiver.com/pricing?utm_source=oss_feature_notice';
</script>

<div
	class={cn(
		'@container @lg:p-10 @3xl:p-14 w-full rounded-md border border-dashed p-6 text-center',
		className
	)}
>
	<Building2 class="text-muted-foreground @lg:size-10 @3xl:size-12 mx-auto size-8" />

	<!-- The default variant is `bg-primary text-primary-foreground`, and both are theme variables
	     defined under :root and .dark, so the badge follows the theme without a dark: override. -->
	<Badge class="@lg:mt-4 mt-3">
		{$t('app.components.enterprise_feature_notice.badge')}
	</Badge>

	<h3 class="@lg:text-base @3xl:text-lg mt-2 text-sm font-semibold">{feature}</h3>

	<!-- The measure grows with the container but never to its full width: a line of text running the
	     whole way across a dashboard page is hard to read, however much room there is. -->
	<p
		class="text-muted-foreground @lg:mt-2 @lg:max-w-2xl @lg:text-base @3xl:max-w-3xl mx-auto mt-1 max-w-lg text-balance text-sm"
	>
		{$t('app.components.enterprise_feature_notice.description')}
		{$t('app.components.enterprise_feature_notice.upgrade')}
	</p>

	{#if instructions}
		<p
			class="text-muted-foreground @lg:max-w-2xl @lg:text-base @3xl:max-w-3xl mx-auto mt-2 max-w-lg text-balance text-sm"
		>
			{instructions}
		</p>
	{/if}

	<!-- The button's own size is a prop, so the taller variants come from classes; tailwind-merge
	     keeps both, since a container-prefixed utility never conflicts with the unprefixed one. -->
	<Button
		href={PRICING_URL}
		target="_blank"
		rel="noopener noreferrer"
		size="sm"
		class="@lg:mt-6 @lg:h-10 @lg:px-6 mt-4"
	>
		{$t('app.components.enterprise_feature_notice.cta')}
		<ExternalLink class="ml-1.5 size-4" />
	</Button>
</div>
