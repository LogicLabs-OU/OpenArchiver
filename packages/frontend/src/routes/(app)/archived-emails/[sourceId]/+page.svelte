<script lang="ts">
	import { page } from '$app/state'; // Updated import
	import { api } from '$lib/api.client';
	import type { ArchivedEmail, EmailFolder } from '@open-archiver/types';
	import EmailFolderTree from '$lib/components/EmailFolderTree.svelte';
	import { ArrowUpDown } from 'lucide-svelte';
	import { onMount } from 'svelte';

	let sourceId = $derived(page.params.sourceId); // Removed $ before page
	let currentPage = $state(1);
	let limit = $state(50);
	let selectedPath = $state<string | null>(null);
	let sortBy = $state<'sentAt' | 'senderEmail' | 'subject'>('sentAt');
	let sortOrder = $state<'asc' | 'desc'>('desc');

	let emails = $state<ArchivedEmail[]>([]);
	let folders = $state<EmailFolder[]>([]);
	let total = $state(0);
	let loading = $state(false);

	// API: load folders
	async function loadFolders() {
		try {
			const response = await api(`/archived-emails/ingestion-source/${sourceId}/folders`);
			if (response.ok) {
				folders = await response.json();
			}
		} catch (error) {
			console.error('Failed to load folders:', error);
		}
	}

	// API: load emails
	async function loadEmails() {
		loading = true;
		try {
			const params = new URLSearchParams({
				page: currentPage.toString(),
				limit: limit.toString(),
				sortBy,
				sortOrder,
			});

			if (selectedPath !== null) {
				params.append('path', selectedPath);
			} else {
				params.append('path', 'null');
			}

			const response = await api(`/archived-emails/ingestion-source/${sourceId}?${params}`);
			if (response.ok) {
				const data = await response.json();
				emails = data.items;
				total = data.total;
			}
		} catch (error) {
			console.error('Failed to load emails:', error);
		} finally {
			loading = false;
		}
	}

	function handleFolderSelect(path: string | null) {
		selectedPath = path;
		currentPage = 1;
		loadEmails();
	}

	function toggleSort(field: typeof sortBy) {
		if (sortBy === field) {
			sortOrder = sortOrder === 'asc' ? 'desc' : 'asc';
		} else {
			sortBy = field;
			sortOrder = 'desc';
		}
		loadEmails();
	}

	onMount(() => {
		loadFolders();
		loadEmails();
	});

	$effect(() => {
		if (sourceId) {
			loadFolders();
			loadEmails();
		}
	});
</script>

<div class="email-view-container">
	<aside class="folder-sidebar">
		<h2>Folders</h2>
		<EmailFolderTree {folders} bind:selectedPath onSelectFolder={handleFolderSelect} />
	</aside>

	<main class="email-list">
		<div class="toolbar">
			<div class="sort-controls">
				<button onclick={() => toggleSort('sentAt')}>
					Date {sortBy === 'sentAt' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
				</button>
				<button onclick={() => toggleSort('senderEmail')}>
					Sender {sortBy === 'senderEmail' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
				</button>
				<button onclick={() => toggleSort('subject')}>
					Subject {sortBy === 'subject' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
				</button>
			</div>
		</div>

		{#if loading}
			<div class="loading">Loading emails...</div>
		{:else if emails.length === 0}
			<div class="empty">No emails found in this folder</div>
		{:else}
			<div class="email-table">
				{#each emails as email}
					<a href="/archived-emails/{sourceId}/{email.id}" class="email-row">
						<div class="email-sender">{email.senderEmail}</div>
						<div class="email-subject">{email.subject || '(No subject)'}</div>
						<div class="email-date">
							{new Date(email.sentAt).toLocaleDateString()}
						</div>
					</a>
				{/each}
			</div>

			<div class="pagination">
				<button
					disabled={currentPage === 1}
					onclick={() => {
						currentPage--;
						loadEmails();
					}}
				>
					Previous
				</button>
				<span>Page {currentPage} of {Math.ceil(total / limit)}</span>
				<button
					disabled={currentPage * limit >= total}
					onclick={() => {
						currentPage++;
						loadEmails();
					}}
				>
					Next
				</button>
			</div>
		{/if}
	</main>
</div>

<style>
	.email-view-container {
		display: grid;
		grid-template-columns: 250px 1fr;
		gap: 1rem;
		height: calc(100vh - 100px);
	}

	.folder-sidebar {
		border-right: 1px solid hsl(var(--border));
		padding: 1rem;
		overflow-y: auto;
	}

	.folder-sidebar h2 {
		font-size: 1.125rem;
		font-weight: 600;
		margin-bottom: 1rem;
	}

	.email-list {
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.toolbar {
		padding: 1rem;
		border-bottom: 1px solid hsl(var(--border));
	}

	.sort-controls {
		display: flex;
		gap: 0.5rem;
	}

	.sort-controls button {
		padding: 0.5rem 1rem;
		border: 1px solid hsl(var(--border));
		background: hsl(var(--background));
		border-radius: 4px;
		cursor: pointer;
	}

	.sort-controls button:hover {
		background: hsl(var(--muted));
	}

	.email-table {
		flex: 1;
		overflow-y: auto;
	}

	.email-row {
		display: grid;
		grid-template-columns: 200px 1fr 150px;
		gap: 1rem;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid hsl(var(--border));
		text-decoration: none;
		color: inherit;
		transition: background-color 0.2s;
	}

	.email-row:hover {
		background-color: hsl(var(--muted));
	}

	.email-sender {
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.email-subject {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.email-date {
		text-align: right;
		color: hsl(var(--muted-foreground));
	}

	.pagination {
		padding: 1rem;
		display: flex;
		justify-content: center;
		align-items: center;
		gap: 1rem;
		border-top: 1px solid hsl(var(--border));
	}

	.loading,
	.empty {
		padding: 2rem;
		text-align: center;
		color: hsl(var(--muted-foreground));
	}
</style>
