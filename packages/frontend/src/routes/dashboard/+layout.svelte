<script lang="ts">
	import * as NavigationMenu from '$lib/components/ui/navigation-menu/index.js';
	import Button from '$lib/components/ui/button/button.svelte';
	import { authStore } from '$lib/stores/auth.store';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import ThemeSwitcher from '$lib/components/custom/ThemeSwitcher.svelte';
	const navItems: {
		href?: string;
		label: string;
		subMenu?: {
			href: string;
			label: string;
		}[];
	}[] = [
		{ href: '/dashboard', label: 'Dashboard' },
		{ href: '/dashboard/ingestions', label: 'Ingestions' },
		{ href: '/dashboard/archived-emails', label: 'Archived emails' },
		{ href: '/dashboard/search', label: 'Search' },
		{
			label: 'Settings',
			subMenu: [
				{
					href: '/dashboard/settings/users',
					label: 'Users',
				},
				{
					href: '/dashboard/settings/roles',
					label: 'Roles',
				},
			],
		},
	];
	let { children } = $props();
	function handleLogout() {
		authStore.logout();
		goto('/signin');
	}
</script>

<header class="bg-background sticky top-0 z-40 border-b">
	<div class="container mx-auto flex h-16 flex-row items-center justify-between">
		<a href="/dashboard" class="flex flex-row items-center gap-2 font-bold">
			<img src="/logos/logo-sq.svg" alt="OpenArchiver Logo" class="h-8 w-8" />
			<span>Open Archiver</span>
		</a>
		<NavigationMenu.Root viewport={false}>
			<NavigationMenu.List class="flex items-center space-x-4">
				{#each navItems as item}
					{#if item.subMenu && item.subMenu.length > 0}
						<NavigationMenu.Item
							class={item.subMenu.some((sub) =>
								page.url.pathname.startsWith(
									sub.href.substring(0, sub.href.lastIndexOf('/'))
								)
							)
								? 'bg-accent rounded-md'
								: ''}
						>
							<NavigationMenu.Trigger class="cursor-pointer font-normal">
								{item.label}
							</NavigationMenu.Trigger>
							<NavigationMenu.Content>
								<ul class="grid w-fit min-w-28 gap-1 p-1">
									{#each item.subMenu as subItem}
										<li>
											<NavigationMenu.Link href={subItem.href}>
												{subItem.label}
											</NavigationMenu.Link>
										</li>
									{/each}
								</ul>
							</NavigationMenu.Content>
						</NavigationMenu.Item>
					{:else if item.href}
						<NavigationMenu.Item
							class={page.url.pathname === item.href ? 'bg-accent rounded-md' : ''}
						>
							<NavigationMenu.Link href={item.href}>
								{item.label}
							</NavigationMenu.Link>
						</NavigationMenu.Item>
					{/if}
				{/each}
			</NavigationMenu.List>
		</NavigationMenu.Root>
		<div class="flex items-center gap-4">
			<ThemeSwitcher />
			<Button onclick={handleLogout} variant="outline">Logout</Button>
		</div>
	</div>
</header>

<main class="container mx-auto my-10">
	{@render children()}
</main>
