<script lang="ts">
	import { theme } from '$lib/stores/theme.store';
	import { Button } from '$lib/components/ui/button';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { Sun, Moon, Laptop } from 'lucide-svelte';
	import { t } from '$lib/translations';
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger>
		<Button variant="ghost" size="icon">
			<Sun
				class="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0"
			/>
			<Moon
				class="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100"
			/>
			<span class="sr-only">{$t('app.components.theme_switcher.toggle_theme')}</span>
		</Button>
	</DropdownMenu.Trigger>
	<DropdownMenu.Content align="end">
		<DropdownMenu.Item onclick={() => ($theme = 'light')}>
			<Sun class="mr-2 h-4 w-4" />
			<span>{$t('app.system_settings.light')}</span>
		</DropdownMenu.Item>
		<DropdownMenu.Item onclick={() => ($theme = 'dark')}>
			<Moon class="mr-2 h-4 w-4" />
			<span>{$t('app.system_settings.dark')}</span>
		</DropdownMenu.Item>
		<DropdownMenu.Item onclick={() => ($theme = 'system')}>
			<Laptop class="mr-2 h-4 w-4" />
			<span>{$t('app.system_settings.system')}</span>
		</DropdownMenu.Item>
	</DropdownMenu.Content>
</DropdownMenu.Root>
