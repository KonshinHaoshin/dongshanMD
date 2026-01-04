import { Component, Show, For, createSignal, createEffect } from 'solid-js';
import './Sidebar.css';

interface SidebarProps {
  visible: boolean;
  onToggle: () => void;
  markdownContent?: string;
  onHeadingClick?: (lineNumber: number, headingText?: string) => void;
  openFiles?: string[];
  currentFilePath?: string | null;
  onFileClick?: (filePath: string) => void;
}

interface Heading {
  level: number;
  text: string;
  lineNumber: number;
  id: string;
}

const Sidebar: Component<SidebarProps> = (props) => {
  const [activeTab, setActiveTab] = createSignal<'files' | 'outline'>('outline');
  const [headings, setHeadings] = createSignal<Heading[]>([]);

  // 提取 Markdown 标题
  const extractHeadings = (content: string): Heading[] => {
    const lines = content.split('\n');
    const headingsList: Heading[] = [];
    let idCounter = 0;

    lines.forEach((line, index) => {
      const trimmed = line.trim();
      // 匹配 ATX 风格的标题 (# ## ### 等)
      const atxMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
      if (atxMatch) {
        const level = atxMatch[1].length;
        const text = atxMatch[2].trim();
        const id = `heading-${idCounter++}`;
        headingsList.push({
          level,
          text,
          lineNumber: index + 1,
          id,
        });
      }
    });

    return headingsList;
  };

  // 监听内容变化，更新大纲
  createEffect(() => {
    if (props.markdownContent) {
      const newHeadings = extractHeadings(props.markdownContent);
      setHeadings(newHeadings);
    }
  });

  // 处理标题点击
  const handleHeadingClick = (heading: Heading) => {
    if (props.onHeadingClick) {
      props.onHeadingClick(heading.lineNumber, heading.text);
    }
  };

  return (
    <Show when={props.visible}>
      <div class="sidebar show">
        <div class="sidebar-header">
          <div class="sidebar-tabs">
            <button
              class={`tab-btn ${activeTab() === 'files' ? 'active' : ''}`}
              onClick={() => setActiveTab('files')}
            >
              文件
            </button>
            <button
              class={`tab-btn ${activeTab() === 'outline' ? 'active' : ''}`}
              onClick={() => setActiveTab('outline')}
            >
              大纲
            </button>
          </div>
          <button class="sidebar-close" onClick={props.onToggle}>×</button>
        </div>
        <div class="sidebar-content">
          <Show when={activeTab() === 'files'}>
            <div class="file-tree">
              <Show when={!props.openFiles || props.openFiles.length === 0}>
                <div class="file-empty">暂无打开的文件</div>
              </Show>
              <Show when={props.openFiles && props.openFiles.length > 0}>
                <For each={props.openFiles}>
                  {(filePath) => {
                    const fileName = () => {
                      const parts = filePath.split(/[/\\]/);
                      return parts[parts.length - 1] || filePath;
                    };
                    const isActive = () => filePath === props.currentFilePath;
                    return (
                      <div
                        class="file-item"
                        classList={{ 'active': isActive() }}
                        onClick={() => {
                          if (props.onFileClick) {
                            props.onFileClick(filePath);
                          }
                        }}
                        title={filePath}
                      >
                        <span class="file-icon">📄</span>
                        <span class="file-name">{fileName()}</span>
                      </div>
                    );
                  }}
                </For>
              </Show>
            </div>
          </Show>
          <Show when={activeTab() === 'outline'}>
            <div class="outline-tree">
              <Show when={headings().length === 0}>
                <div class="outline-empty">暂无标题</div>
              </Show>
              <Show when={headings().length > 0}>
                <For each={headings()}>
                  {(heading) => (
                    <div
                      class="outline-item"
                      classList={{
                        [`level-${heading.level}`]: true,
                      }}
                      onClick={() => handleHeadingClick(heading)}
                      title={`跳转到第 ${heading.lineNumber} 行`}
                    >
                      <span class="outline-text">{heading.text}</span>
                    </div>
                  )}
                </For>
              </Show>
            </div>
          </Show>
        </div>
      </div>
    </Show>
  );
};

export default Sidebar;
