<script lang="ts">
	import * as NavigationMenu from '$lib/components/ui/navigation-menu/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import Button from '$lib/components/ui/button/button.svelte';
	import { authStore } from '$lib/stores/auth.store';
	import { Menu } from 'lucide-svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import ThemeSwitcher from '$lib/components/custom/ThemeSwitcher.svelte';
	import { t } from '$lib/translations';
	let { data, children } = $props();

	interface NavItem {
		href?: string;
		label: string;
		subMenu?: {
			href: string;
			label: string;
		}[];
		position: number; // represents the position of the item in the navigation menu
	}

	const baseNavItems: NavItem[] = [
		{ href: '/dashboard', label: $t('app.layout.dashboard'), position: 0 },
		{
			label: $t('app.archive.title'),
			subMenu: [
				{ href: '/dashboard/ingestions', label: $t('app.layout.ingestions') },
				{
					href: '/dashboard/archived-emails',
					label: $t('app.layout.archived_emails'),
				},
			],
			position: 1,
		},

		{ href: '/dashboard/search', label: $t('app.layout.search'), position: 2 },
		{
			label: $t('app.layout.admin'),
			subMenu: [
				{
					href: '/dashboard/admin/jobs',
					label: $t('app.jobs.jobs'),
				},
				{
					href: '/dashboard/settings/users',
					label: $t('app.layout.users'),
				},
				{
					href: '/dashboard/settings/roles',
					label: $t('app.layout.roles'),
				},
			],
			position: 4,
		},
		{
			label: $t('app.layout.settings'),
			subMenu: [
				{
					href: '/dashboard/settings/system',
					label: $t('app.layout.system'),
				},
				{
					href: '/dashboard/settings/api-keys',
					label: $t('app.layout.api_keys'),
				},
				{
					href: '/dashboard/settings/account',
					label: $t('app.layout.account'),
				},
			],
			position: 5,
		},
	];

	const enterpriseNavItems: NavItem[] = [
		{
			label: 'Compliance',
			subMenu: [{ href: '/dashboard/compliance/audit-log', label: 'Audit Log' }],
			position: 3,
		},
		{
			label: $t('app.layout.admin'),
			subMenu: [{ href: '/dashboard/admin/license', label: 'License status' }],
			position: 4,
		},
	];

	function mergeNavItems(baseItems: NavItem[], enterpriseItems: NavItem[]): NavItem[] {
		const mergedItemsMap = new Map<number, NavItem>();

		for (const item of baseItems) {
			mergedItemsMap.set(item.position, {
				...item,
				subMenu: item.subMenu ? [...item.subMenu] : undefined,
			});
		}

		for (const enterpriseItem of enterpriseItems) {
			const existingItem = mergedItemsMap.get(enterpriseItem.position);

			if (existingItem) {
				if (existingItem.subMenu && enterpriseItem.subMenu) {
					existingItem.subMenu = [...existingItem.subMenu, ...enterpriseItem.subMenu];
				}
			} else {
				mergedItemsMap.set(enterpriseItem.position, {
					...enterpriseItem,
					subMenu: enterpriseItem.subMenu ? [...enterpriseItem.subMenu] : undefined,
				});
			}
		}

		const mergedItems = Array.from(mergedItemsMap.values());
		return mergedItems.sort((a, b) => a.position - b.position);
	}

	let navItems: NavItem[] = $state(baseNavItems);
	if (data.enterpriseMode) {
		navItems = mergeNavItems(baseNavItems, enterpriseNavItems);
	}
	function handleLogout() {
		authStore.logout();
		goto('/signin');
	}
</script>

<header class="bg-background sticky top-0 z-40 border-b px-4 md:px-0">
	<div class="container mx-auto flex h-16 flex-row items-center justify-between">
		<a href="/dashboard" class="flex flex-row items-center gap-2 font-bold">
			<img src="/logos/logo-sq.svg" alt="OpenArchiver Logo" class="h-8 w-8" />
			<span class="hidden sm:inline-block">Open Archiver</span>
		</a>

		<!-- Desktop Navigation -->
		<div class="hidden lg:flex">
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
									<ul class="grid w-fit min-w-32 gap-1 p-1">
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
								class={page.url.pathname === item.href
									? 'bg-accent rounded-md'
									: ''}
							>
								<NavigationMenu.Link href={item.href}>
									{item.label}
								</NavigationMenu.Link>
							</NavigationMenu.Item>
						{/if}
					{/each}
				</NavigationMenu.List>
			</NavigationMenu.Root>
		</div>

		<div class="flex items-center gap-4">
			<!-- Mobile Navigation -->
			<div class="lg:hidden">
				<DropdownMenu.Root>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<Button {...props} variant="ghost" size="icon">
								<Menu class="h-6 w-6" />
							</Button>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content class="w-56" align="end">
						{#each navItems as item}
							{#if item.subMenu && item.subMenu.length > 0}
								<DropdownMenu.Sub>
									<DropdownMenu.SubTrigger>{item.label}</DropdownMenu.SubTrigger>
									<DropdownMenu.SubContent>
										{#each item.subMenu as subItem}
											<a href={subItem.href}>
												<DropdownMenu.Item
													>{subItem.label}</DropdownMenu.Item
												>
											</a>
										{/each}
									</DropdownMenu.SubContent>
								</DropdownMenu.Sub>
							{:else if item.href}
								<a href={item.href}>
									<DropdownMenu.Item>{item.label}</DropdownMenu.Item>
								</a>
							{/if}
						{/each}
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			</div>
			<ThemeSwitcher />
			<Button onclick={handleLogout} variant="outline">{$t('app.layout.logout')}</Button>
		</div>
	</div>
</header>

<main class="container mx-auto my-10 px-4 md:px-0">
	{@render children()}
</main>
