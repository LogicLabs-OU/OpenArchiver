<script lang="ts">
	import type { EmailFolder } from '@open-archiver/types';
	import { ChevronRight, ChevronDown, Folder, FolderOpen, Inbox } from 'lucide-svelte';
	import EmailFolderTree from './EmailFolderTree.svelte';

	interface Props {
		folders: EmailFolder[];
		selectedPath?: string | null;
		onSelectFolder: (path: string | null) => void;
		level?: number;
	}

	let { folders, selectedPath = $bindable(), onSelectFolder, level = 0 }: Props = $props();

	let expandedFolders = $state<Set<string>>(new Set());

	function toggleFolder(path: string) {
		if (expandedFolders.has(path)) {
			expandedFolders.delete(path);
		} else {
			expandedFolders.add(path);
		}
		expandedFolders = new Set(expandedFolders);
	}

	function selectFolder(path: string | null) {
		selectedPath = path;
		onSelectFolder(path);
	}

	function isSelected(path: string | null) {
		return selectedPath === path;
	}
</script>

<div class="folder-tree" style="padding-left: {level * 16}px">
	{#each folders as folder}
		<div class="folder-item">
			<button
				class="folder-button"
				class:selected={isSelected(folder.path === '' ? null : folder.path)}
				onclick={() => selectFolder(folder.path === '' ? null : folder.path)}
			>
				{#if folder.children.length > 0}
					<span
						class="expand-button"
						role="button"
						tabindex="0"
						onclick={(e) => {
							e.stopPropagation();
							toggleFolder(folder.path);
						}}
						onkeydown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault();
								e.stopPropagation();
								toggleFolder(folder.path);
							}
						}}
					>
						{#if expandedFolders.has(folder.path)}
							<ChevronDown size={16} />
						{:else}
							<ChevronRight size={16} />
						{/if}
					</span>
				{:else}
					<span class="expand-placeholder"></span>
				{/if}

				<span class="folder-icon">
					{#if folder.path === ''}
						<Inbox size={16} />
					{:else if expandedFolders.has(folder.path)}
						<FolderOpen size={16} />
					{:else}
						<Folder size={16} />
					{/if}
				</span>

				<span class="folder-name">{folder.name}</span>
				<span class="folder-count">({folder.count})</span>
			</button>
			{#if folder.children.length > 0 && expandedFolders.has(folder.path)}
				<EmailFolderTree
					folders={folder.children}
					bind:selectedPath
					{onSelectFolder}
					level={level + 1}
				/>
			{/if}
		</div>
	{/each}
</div>

<style>
	.folder-tree {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.folder-item {
		display: flex;
		flex-direction: column;
	}

	.folder-button {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 6px 8px;
		border: none;
		background: transparent;
		cursor: pointer;
		border-radius: 4px;
		transition: background-color 0.2s;
		text-align: left;
		width: 100%;
	}

	.folder-button:hover {
		background-color: hsl(var(--muted));
	}

	.folder-button.selected {
		background-color: hsl(var(--accent));
		font-weight: 500;
	}

	.expand-button {
		padding: 0;
		border: none;
		background: transparent;
		cursor: pointer;
		display: flex;
		align-items: center;
		color: hsl(var(--muted-foreground));
	}

	.expand-placeholder {
		width: 16px;
	}

	.folder-icon {
		color: hsl(var(--muted-foreground));
	}

	.folder-name {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.folder-count {
		color: hsl(var(--muted-foreground));
		font-size: 0.875rem;
	}
</style>
