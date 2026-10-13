<script lang="ts">
	import { t } from '$lib/translations';
</script>

<svelte:head>
	<title>{$t('app.auth.sso_signing_in')} - Open Archiver</title>
</svelte:head>

<!--
	The load function always redirects, so this renders only for the moment before
	the redirect lands, or if JavaScript is disabled and the browser is mid-navigation.
-->
<div class="flex min-h-screen flex-col items-center justify-center gap-4">
	<img src="/logos/logo-sq.svg" alt="OpenArchiver Logo" class="h-12 w-12 animate-pulse" />
	<p class="text-muted-foreground text-sm">{$t('app.auth.sso_signing_in')}</p>
</div>
