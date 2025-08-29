<script lang="ts">
	import { t } from '$lib/translations';
</script>

<footer class="bg-muted py-6 md:py-0">
	<div
		class="container mx-auto flex flex-col items-center justify-center gap-4 md:h-24 md:flex-row"
	>
		<div class="flex flex-col items-center gap-2">
			<p class="text-balance text-center text-xs font-medium leading-loose">
				© {new Date().getFullYear()}
				<a href="https://openarchiver.com/" target="_blank">Open Archiver</a>. {$t(
					'app.components.footer.all_rights_reserved'
				)}
			</p>
		</div>
	</div>
</footer>
