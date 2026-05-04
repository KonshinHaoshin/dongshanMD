import { Component, Show, For, createSignal, createEffect } from 'solid-js';
import { t } from '../utils/i18n';
import type { SearchResult } from '../utils/fileOperations';
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
  onOpenWorkspace?: () => void;
  onRenameFile?: (filePath: string, newName: string) => void;
  onWorkspaceSearch?: (query: string) => void;
  onFileClick?: (filePath: string, lineNumber?: number) => void;
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

  const handleHeadingClick = (heading: Heading) => {
    if (props.onHeadingClick) {
      props.onHeadingClick(heading.lineNumber, heading.text);
    }
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

  const workspaceList = () => props.workspacePath ? (props.workspaceFiles || []) : (props.dirFiles || []);

  const handleRename = (event: MouseEvent, filePath: string) => {
    event.stopPropagation();
    const nextName = window.prompt(t('dir.renamePrompt'), getFileName(filePath));
    if (nextName) props.onRenameFile?.(filePath, nextName);
  };

  return (
    <Show when={props.visible}>
      <div class="sidebar show">
        <div class="sidebar-header">
          <div class="sidebar-tabs">
            <button
              class={`tab-btn ${activeTab() === 'dir' ? 'active' : ''}`}
              onClick={() => setActiveTab('dir')}
              title={t('sidebar.files')}
            >
              &#128193;
            </button>
            <button
              class={`tab-btn ${activeTab() === 'recent' ? 'active' : ''}`}
              onClick={() => setActiveTab('recent')}
              title={t('dir.open')}
            >
              &#128339;
            </button>
            <button
              class={`tab-btn ${activeTab() === 'outline' ? 'active' : ''}`}
              onClick={() => setActiveTab('outline')}
              title={t('sidebar.outline')}
            >
              &#9776;
            </button>
          </div>
          <button class="sidebar-close" onClick={props.onToggle}>x</button>
        </div>
        <div class="sidebar-content">

          <Show when={activeTab() === 'dir'}>
            <div class="file-tree">
              <div class="workspace-bar">
                <button class="workspace-open" onClick={props.onOpenWorkspace}>{t('dir.open')}</button>
                <div class="workspace-path" title={props.workspacePath || ''}>{props.workspacePath || t('dir.noFolder')}</div>
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
                <div class="workspace-meta">{t('dir.filesCount', { n: workspaceList().length })}</div>
                <Show when={workspaceList().length === 0}>
                  <div class="file-empty">{t('dir.noFolder')}</div>
                </Show>
                <For each={workspaceList()}>
                  {(filePath) => {
                    const fileName = () => props.workspacePath ? getRelativePath(filePath) : getFileName(filePath);
                    const isActive = () => filePath === props.currentFilePath;
                    return (
                      <div
                        class="file-item"
                        classList={{ 'active': isActive() }}
                        onClick={() => props.onFileClick?.(filePath)}
                        title={filePath}
                      >
                        <span class="file-icon">&#128196;</span>
                        <span class="file-name">{fileName()}</span>
                        <button class="file-rename" title={t('dir.rename')} onClick={(event) => handleRename(event, filePath)}>...</button>
                      </div>
                    );
                  }}
                </For>
              </Show>
            </div>
          </Show>

          <Show when={activeTab() === 'recent'}>
            <div class="file-tree">
              <Show when={!props.recentFiles || props.recentFiles.length === 0}>
                <div class="file-empty">{t('dir.noFolder')}</div>
              </Show>
              <For each={props.recentFiles || []}>
                {(filePath) => {
                  const fileName = () => getFileName(filePath);
                  const isActive = () => filePath === props.currentFilePath;
                  return (
                    <div
                      class="file-item"
                      classList={{ 'active': isActive() }}
                      onClick={() => props.onFileClick?.(filePath)}
                      title={filePath}
                    >
                      <span class="file-icon">&#128196;</span>
                      <span class="file-name">{fileName()}</span>
                    </div>
                  );
                }}
              </For>
            </div>
          </Show>

          <Show when={activeTab() === 'outline'}>
            <div class="outline-tree">
              <Show when={headings().length === 0}>
                <div class="outline-empty">-</div>
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
