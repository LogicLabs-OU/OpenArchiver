<script lang="ts">
	import { goto } from '$app/navigation';
	import type { ArchivedEmail } from '@open-archiver/types';
	import { ScrollArea } from '$lib/components/ui/scroll-area/index.js';
	import { t } from '$lib/translations';

	let {
		thread,
		currentEmailId,
	}: {
		thread: ArchivedEmail['thread'];
		currentEmailId: string;
	} = $props();
</script>

<div>
	<ScrollArea class="max-h-120 -ml-3 overflow-y-scroll">
		<div class="relative ml-3 border-l-2 border-gray-200 pl-6">
			{#if thread}
				{#each thread as item, i (item.id)}
					<div class="mb-8">
						<span
							class=" ring-sidebar absolute -left-3 flex h-6 w-6 items-center justify-center rounded-full bg-gray-200 ring-8"
						>
							<svg
								class="h-3 w-3 text-gray-600"
								fill="currentColor"
								viewBox="0 0 20 20"
								xmlns="http://www.w3.org/2000/svg"
								><path
									fill-rule="evenodd"
									d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z"
									clip-rule="evenodd"
								></path></svg
							>
						</span>
						<h4
							class:font-bold={item.id === currentEmailId}
							class="text-md mb-2 {item.id !== currentEmailId
								? 'text-blue-500 hover:underline'
								: 'text-gray-900'}"
						>
							{#if item.id !== currentEmailId}
								<a
									href="/dashboard/archived-emails/{item.id}"
									onclick={(e) => {
										e.preventDefault();
										goto(`/dashboard/archived-emails/${item.id}`, {
											invalidateAll: true,
										});
									}}>{item.subject || $t('archive.no_subject')}</a
								>
							{:else}
								{item.subject || $t('archive.no_subject')}
							{/if}
						</h4>
						<div
							class="flex flex-col space-y-2 text-sm font-normal leading-none text-gray-400"
						>
							<span>{$t('archive.from')}: {item.senderEmail}</span>
							<time class="">{new Date(item.sentAt).toLocaleString()}</time>
						</div>
					</div>
				{/each}
			{/if}
		</div>
	</ScrollArea>
</div>
