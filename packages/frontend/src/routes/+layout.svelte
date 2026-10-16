<script lang="ts">
	import '../app.css';
	import { authStore } from '$lib/stores/auth.store';
	import { theme } from '$lib/stores/theme.store';
	import { dateSettings } from '$lib/stores/dateFormat.store';
	import { browser } from '$app/environment';
	import Footer from '$lib/components/custom/Footer.svelte';
	import { getAlert } from '$lib/components/custom/alert/alert-state.svelte';
	import Alerts from '$lib/components/custom/alert/Alerts.svelte';

	let { data, children } = $props();

	// The date format is a system setting. Set before the first render, not in an effect, so the
	// server renders the admin's format too; the effect keeps it current after a settings save.
	const applyDateSettings = () =>
		dateSettings.set({
			format: data.systemSettings?.dateFormat ?? 'language',
			language: data.systemSettings?.language ?? 'en',
		});
	applyDateSettings();
	$effect(applyDateSettings);

	$effect(() => {
		authStore.syncWithServer(data.user, data.accessToken);
	});

	// The date format used to be a per-browser preference (#469); drop the key it left behind.
	$effect(() => {
		if (browser) {
			try {
				localStorage.removeItem('dateFormat');
			} catch {
				// Storage can be unavailable (private mode, blocked site data); nothing to clean.
			}
		}
	});

	$effect(() => {
		if (browser) {
			let finalTheme = $theme;

			if (finalTheme === 'system') {
				finalTheme = data.systemSettings?.theme || 'system';
			}

			const isDark =
				finalTheme === 'dark' ||
				(finalTheme === 'system' &&
					window.matchMedia('(prefers-color-scheme: dark)').matches);
			document.documentElement.classList.toggle('dark', isDark);
		}
	});
</script>

<Alerts {...getAlert()}></Alerts>
<div class="flex min-h-screen flex-col">
	<main class="flex-1">
		{@render children()}
	</main>
	<Footer currentVersion={data.currentVersion} newVersionInfo={data.newVersionInfo} />
</div>
