import { Component, createSignal, onMount } from 'solid-js';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import Editor from './components/Editor';
import Sidebar from './components/Sidebar';
import { listDirectoryFiles } from './utils/fileOperations';
import { t } from './utils/i18n';
import './App.css';

const RECENT_FILES_KEY = 'dongshan_recent_files';
const MAX_RECENT = 20;

const loadRecentFiles = (): string[] => {
  try {
    const data = localStorage.getItem(RECENT_FILES_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
};

const saveRecentFiles = (files: string[]) => {
  try {
    localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(files));
  } catch { /* ignore */ }
};

const addRecentFile = (filePath: string) => {
  const recent = loadRecentFiles();
  const filtered = recent.filter(f => f !== filePath);
  filtered.unshift(filePath);
  const trimmed = filtered.slice(0, MAX_RECENT);
  saveRecentFiles(trimmed);
  return trimmed;
};

const getInitialTheme = (): string => {
  const stored = localStorage.getItem('theme');
  if (stored) return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

const applyTheme = (theme: string) => {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
};

const getDirPath = (filePath: string): string | null => {
  const lastSlash = filePath.lastIndexOf('/');
  const lastBack = filePath.lastIndexOf('\\');
  const lastSep = Math.max(lastSlash, lastBack);
  if (lastSep <= 0) return null;
  return filePath.slice(0, lastSep);
};

const App: Component = () => {
  const [sidebarVisible, setSidebarVisible] = createSignal(false);
  const [markdownContent, setMarkdownContent] = createSignal<string>('');
  const [fileToOpen, setFileToOpen] = createSignal<string | null>(null);
  const [openFiles, setOpenFiles] = createSignal<string[]>([]);
  const [currentFilePath, setCurrentFilePath] = createSignal<string | null>(null);
  const [dirFiles, setDirFiles] = createSignal<string[]>([]);
  const [recentFiles, setRecentFiles] = createSignal<string[]>(loadRecentFiles());

  onMount(() => {
    applyTheme(getInitialTheme());
  });

  const toggleSidebar = () => {
    setSidebarVisible(!sidebarVisible());
  };

  const refreshDirFiles = async (filePath: string | null) => {
    if (!filePath) {
      setDirFiles([]);
      return;
    }
    const dirPath = getDirPath(filePath);
    if (!dirPath) {
      setDirFiles([]);
      return;
    }
    const files = await listDirectoryFiles(dirPath);
    setDirFiles(files);
  };

  const handleContentChange = (content: string) => {
    setMarkdownContent(content);
  };

  const handleFilePathChange = (filePath: string | null) => {
    setCurrentFilePath(filePath);
    if (filePath) {
      setOpenFiles(prev => {
        if (!prev.includes(filePath)) {
          return [...prev, filePath];
        }
        return prev;
      });
      setRecentFiles(addRecentFile(filePath));
      refreshDirFiles(filePath);
    } else {
      setDirFiles([]);
    }
  };

  const handleHeadingClick = (lineNumber: number, headingText?: string) => {
    if ((window as any).__editorJumpToLine) {
      (window as any).__editorJumpToLine(lineNumber, headingText);
    }
  };

  onMount(async () => {
    let unlisten: UnlistenFn | null = null;
    const isTauri = Boolean((window as any).__TAURI_INTERNALS__);
    if (isTauri) {
      try {
        unlisten = await listen<string>('open-file', (event) => {
          const filePath = event.payload;
          if (filePath) {
            setFileToOpen(filePath);
          }
        });
      } catch (error) {
        console.error('监听文件打开事件失败:', error);
      }
    }

    if (import.meta.env.DEV) {
      (window as any).__devOpenFile = (filePath: string) => {
        setFileToOpen(filePath);
      };
    }

    if (isTauri) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const args = await invoke<string[]>('get_file_args').catch(() => null);

        if (args && args.length > 0) {
          const cleanPath = (path: string) => path.trim().replace(/^["']|["']$/g, '');

          const fileArgs = args
            .map(cleanPath)
            .filter(arg => {
              const lowerArg = arg.toLowerCase();
              return (
                lowerArg.endsWith(".md") ||
                lowerArg.endsWith(".markdown") ||
                lowerArg.endsWith(".txt")
              ) && !lowerArg.endsWith(".exe");
            });

          if (fileArgs.length > 0) {
            const filePath = fileArgs[0];
            setFileToOpen(filePath);
          }
        }
      } catch (error) {
        console.error('获取启动参数失败:', error);
      }
    }

    return () => {
      unlisten?.();
    };
  });

  return (
    <div class="app">
      <Sidebar 
        visible={sidebarVisible()} 
        onToggle={toggleSidebar}
        markdownContent={markdownContent()}
        onHeadingClick={handleHeadingClick}
        openFiles={openFiles()}
        currentFilePath={currentFilePath()}
        dirFiles={dirFiles()}
        recentFiles={recentFiles()}
        onFileClick={(filePath) => {
          setFileToOpen(filePath);
          refreshDirFiles(filePath);
        }}
      />
      <div class="main-content" classList={{ 'with-sidebar': sidebarVisible() }}>
        <Editor 
          onContentChange={handleContentChange}
          onHeadingClick={handleHeadingClick}
          initialFilePath={fileToOpen()}
          onFilePathChange={handleFilePathChange}
        />
      </div>
      {!sidebarVisible() && (
        <button class="sidebar-toggle" onClick={toggleSidebar} title={t('sidebar.toggle')}>
          &#9776;
        </button>
      )}
    </div>
  );
};

export default App;
