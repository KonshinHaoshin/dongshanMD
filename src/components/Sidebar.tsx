import { Component, Show, For, createSignal, createEffect } from 'solid-js';
import { t } from '../utils/i18n';
import type { SearchResult, TreeNode } from '../utils/fileOperations';
import { expandTreeNode, createNewFile } from '../utils/fileOperations';
import './Sidebar.css';

interface SidebarProps {
  visible: boolean;
  onToggle: () => void;
  markdownContent?: string;
  onHeadingClick?: (lineNumber: number, headingText?: string) => void;
  openFiles?: string[];
  currentFilePath?: string | null;
  dirFiles?: string[];
  recentFiles?: string[];
  workspacePath?: string | null;
  workspaceFiles?: string[];
  searchResults?: SearchResult[];
  directoryTree?: TreeNode[];
  onOpenWorkspace?: () => void;
  onRenameFile?: (filePath: string, newName: string) => void;
  onWorkspaceSearch?: (query: string) => void;
  onFileClick?: (filePath: string, lineNumber?: number) => void;
  onClearRecent?: () => void;
  onNewFile?: (filePath: string) => void;
  onTreeRefresh?: () => void;
}

interface Heading {
  level: number;
  text: string;
  lineNumber: number;
  id: string;
}

type SidebarTab = 'dir' | 'recent' | 'outline';

const Sidebar: Component<SidebarProps> = (props) => {
  const [activeTab, setActiveTab] = createSignal<SidebarTab>('dir');
  const [headings, setHeadings] = createSignal<Heading[]>([]);
  const [workspaceQuery, setWorkspaceQuery] = createSignal('');
  const [expandedDirs, setExpandedDirs] = createSignal<Set<string>>(new Set());
  const [treeNodes, setTreeNodes] = createSignal<TreeNode[]>([]);
  const [loadingDir, setLoadingDir] = createSignal<string | null>(null);

  const extractHeadings = (content: string): Heading[] => {
    const lines = content.split('\n');
    const headingsList: Heading[] = [];
    let idCounter = 0;

    lines.forEach((line, index) => {
      const trimmed = line.trim();
      const atxMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
      if (atxMatch) {
        const level = atxMatch[1].length;
        const text = atxMatch[2].trim();
        const id = `heading-${idCounter++}`;
        headingsList.push({ level, text, lineNumber: index + 1, id });
      }
    });

    return headingsList;
  };

  createEffect(() => {
    if (props.markdownContent) {
      setHeadings(extractHeadings(props.markdownContent));
    }
  });

  createEffect(() => {
    if (props.directoryTree) {
      setTreeNodes(props.directoryTree);
    }
  });

  const handleHeadingClick = (heading: Heading) => {
    props.onHeadingClick?.(heading.lineNumber, heading.text);
  };

  const getFileName = (filePath: string) => {
    const parts = filePath.split(/[/\\]/);
    return parts[parts.length - 1] || filePath;
  };

  const getRelativePath = (filePath: string) => {
    const root = props.workspacePath;
    if (!root || !filePath.toLowerCase().startsWith(root.toLowerCase())) return getFileName(filePath);
    return filePath.slice(root.length).replace(/^[/\\]+/, '');
  };

  const toggleDir = async (dirPath: string) => {
    const expanded = new Set(expandedDirs());
    if (expanded.has(dirPath)) {
      expanded.delete(dirPath);
    } else {
      expanded.add(dirPath);
      setLoadingDir(dirPath);
      try {
        const children = await expandTreeNode(dirPath);
        updateTreeNodeChildren(treeNodes(), dirPath, children);
      } catch { /* ignore */ }
      setLoadingDir(null);
    }
    setExpandedDirs(expanded);
  };

  const updateTreeNodeChildren = (nodes: TreeNode[], dirPath: string, children: TreeNode[]) => {
    const update = (list: TreeNode[]): TreeNode[] =>
      list.map(node => {
        if (node.path === dirPath) {
          return { ...node, children };
        }
        if (node.children) {
          return { ...node, children: update(node.children) };
        }
        return node;
      });
    setTreeNodes(update(nodes));
  };

  const handleNewFile = async () => {
    const dirPath = props.workspacePath;
    if (!dirPath) return;
    const fileName = window.prompt(t('dir.newFilePrompt'));
    if (!fileName) return;
    try {
      const filePath = await createNewFile(dirPath, fileName);
      props.onNewFile?.(filePath);
    } catch {
      alert(t('dir.newFileFailed'));
    }
  };

  const handleClearRecent = () => {
    if (window.confirm(t('dir.clearRecentConfirm'))) {
      props.onClearRecent?.();
    }
  };

  const handleRename = (event: MouseEvent, filePath: string) => {
    event.stopPropagation();
    const nextName = window.prompt(t('dir.renamePrompt'), getFileName(filePath));
    if (nextName) props.onRenameFile?.(filePath, nextName);
  };

  const renderTree = (nodes: TreeNode[], depth: number = 0) => {
    return nodes.map(node => {
      const isExpanded = expandedDirs().has(node.path);
      const isActive = !node.isDirectory && node.path === props.currentFilePath;
      const paddingLeft = `${8 + depth * 16}px`;

      if (node.isDirectory) {
        return (
          <>
            <div
              class="tree-item tree-dir"
              style={{ 'padding-left': paddingLeft }}
              onClick={() => toggleDir(node.path)}
              title={node.path}
            >
              <span class="tree-arrow">{isExpanded ? '\u25BE' : '\u25B8'}</span>
              <span class="tree-name">{node.name}</span>
            </div>
            <Show when={isExpanded && node.children}>
              {renderTree(node.children!, depth + 1)}
            </Show>
            <Show when={isExpanded && loadingDir() === node.path}>
              <div class="tree-loading" style={{ 'padding-left': `${24 + depth * 16}px` }}>...</div>
            </Show>
          </>
        );
      }

      return (
        <div
          class={`tree-item tree-file ${isActive ? 'active' : ''}`}
          style={{ 'padding-left': `${24 + depth * 16}px` }}
          onClick={() => props.onFileClick?.(node.path)}
          title={node.path}
        >
          <span class="tree-name">{node.name}</span>
          <button class="tree-rename" title={t('dir.rename')} onClick={(e) => handleRename(e, node.path)}>...</button>
        </div>
      );
    });
  };

  const renderFlatFiles = (files: string[]) => {
    return files.map(filePath => {
      const fileName = getFileName(filePath);
      const isActive = filePath === props.currentFilePath;
      return (
        <div
          class="file-item"
          classList={{ 'active': isActive }}
          onClick={() => props.onFileClick?.(filePath)}
          title={filePath}
        >
          <span class="file-name">{fileName}</span>
          <button class="file-rename-btn" title={t('dir.rename')} onClick={(e) => handleRename(e, filePath)}>...</button>
        </div>
      );
    });
  };

  const wp = () => props.workspacePath;

  return (
    <Show when={props.visible}>
      <div class="sidebar show">
        <div class="sidebar-header">
          <div class="sidebar-tabs">
            <button class={`tab-btn ${activeTab() === 'dir' ? 'active' : ''}`} onClick={() => setActiveTab('dir')}>{t('sidebar.files')}</button>
            <button class={`tab-btn ${activeTab() === 'recent' ? 'active' : ''}`} onClick={() => setActiveTab('recent')}>{t('sidebar.recent')}</button>
            <button class={`tab-btn ${activeTab() === 'outline' ? 'active' : ''}`} onClick={() => setActiveTab('outline')}>{t('sidebar.outline')}</button>
          </div>
          <button class="sidebar-close" onClick={props.onToggle}>&times;</button>
        </div>

        <div class="sidebar-content">
          <Show when={activeTab() === 'dir'}>
            <div class="file-tree">
              <Show when={!wp()}>
                <div class="ws-placeholder">
                  <button class="ws-open-btn" onClick={props.onOpenWorkspace}>{t('dir.open')}</button>
                  <div class="ws-hint">{t('dir.noFolder')}</div>
                </div>
                <input
                  class="workspace-search"
                  type="text"
                  placeholder={t('dir.search')}
                  value={workspaceQuery()}
                  onInput={(event) => {
                    const query = event.currentTarget.value;
                    setWorkspaceQuery(query);
                    props.onWorkspaceSearch?.(query);
                  }}
                />
                <Show when={workspaceQuery().trim()}>
                  <div class="workspace-meta">{t('search.count', { count: props.searchResults?.length || 0 })}</div>
                  <Show when={!props.searchResults || props.searchResults.length === 0}>
                    <div class="file-empty">{t('dir.searchEmpty')}</div>
                  </Show>
                  <For each={props.searchResults || []}>
                    {(result) => (
                      <div class="search-result" onClick={() => props.onFileClick?.(result.filePath, result.lineNumber)} title={result.filePath}>
                        <div class="search-result-file">{getRelativePath(result.filePath)}:{result.lineNumber}</div>
                        <div class="search-result-line">{result.lineText || '-'}</div>
                      </div>
                    )}
                  </For>
                </Show>
                <Show when={!workspaceQuery().trim()}>
                  <div class="workspace-meta">{t('dir.filesCount', { n: (props.dirFiles || []).length })}</div>
                  <Show when={!props.dirFiles || props.dirFiles.length === 0}>
                    <div class="file-empty">{t('dir.noFolder')}</div>
                  </Show>
                  {renderFlatFiles(props.dirFiles || [])}
                </Show>
              </Show>

              <Show when={wp()}>
                <div class="ws-header">
                  <div class="ws-title" title={wp()!}>
                    {wp()!.split(/[/\\]/).pop() || wp()!}
                  </div>
                  <div class="ws-actions">
                    <button class="ws-icon-btn" onClick={handleNewFile} title={t('dir.newFile')}>+</button>
                    <button class="ws-icon-btn" onClick={() => props.onTreeRefresh?.()} title={t('dir.collapseAll')}>&#8634;</button>
                    <button class="ws-icon-btn" onClick={props.onOpenWorkspace} title={t('dir.open')}>&#128449;</button>
                  </div>
                </div>
                <div class="ws-path" title={wp()!}>{wp()!}</div>
                <Show when={treeNodes().length === 0}>
                  <div class="file-empty">{t('dir.noFolder')}</div>
                </Show>
                <div class="tree-container">
                  {renderTree(treeNodes())}
                </div>
              </Show>
            </div>
          </Show>

          <Show when={activeTab() === 'recent'}>
            <div class="file-tree">
              <Show when={props.recentFiles && props.recentFiles.length > 0}>
                <div class="recent-header">
                  <span class="workspace-meta">{t('dir.filesCount', { n: props.recentFiles!.length })}</span>
                  <button class="clear-recent-btn" onClick={handleClearRecent}>{t('dir.clearRecent')}</button>
                </div>
              </Show>
              <Show when={!props.recentFiles || props.recentFiles.length === 0}>
                <div class="file-empty">{t('dir.noFolder')}</div>
              </Show>
              {renderFlatFiles(props.recentFiles || [])}
            </div>
          </Show>

          <Show when={activeTab() === 'outline'}>
            <div class="outline-tree">
              <Show when={headings().length === 0}>
                <div class="outline-empty">&mdash;</div>
              </Show>
              <For each={headings()}>
                {(heading) => (
                  <div
                    class="outline-item"
                    classList={{ [`level-${heading.level}`]: true }}
                    onClick={() => handleHeadingClick(heading)}
                    title={heading.text}
                  >
                    <span class="outline-text">{heading.text}</span>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      </div>
    </Show>
  );
};

export default Sidebar;
