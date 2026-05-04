import { Component, createEffect, createSignal, onMount } from 'solid-js';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import Editor from './components/Editor';
import Sidebar from './components/Sidebar';
import {
  listDirectoryFiles,
  listWorkspaceFiles,
  openDirectory,
  renameFile,
  searchWorkspaceFiles,
  type SearchResult,
} from './utils/fileOperations';
import { t } from './utils/i18n';
import './App.css';

const RECENT_FILES_KEY = 'dongshan_recent_files';
const WORKSPACE_PATH_KEY = 'dongshan_workspace_path';
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

const replaceStoredPath = (paths: string[], oldPath: string, newPath: string) =>
  paths.map(path => path === oldPath ? newPath : path);

const loadWorkspacePath = (): string | null => {
  try {
    return localStorage.getItem(WORKSPACE_PATH_KEY);
  } catch {
    return null;
  }
};

const saveWorkspacePath = (filePath: string | null) => {
  try {
    if (filePath) localStorage.setItem(WORKSPACE_PATH_KEY, filePath);
    else localStorage.removeItem(WORKSPACE_PATH_KEY);
  } catch { /* ignore */ }
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
  const [workspacePath, setWorkspacePath] = createSignal<string | null>(loadWorkspacePath());
  const [workspaceFiles, setWorkspaceFiles] = createSignal<string[]>([]);
  const [workspaceSearchResults, setWorkspaceSearchResults] = createSignal<SearchResult[]>([]);
  const [pendingJump, setPendingJump] = createSignal<{ filePath: string; lineNumber: number } | null>(null);
  const [renamedFile, setRenamedFile] = createSignal<{ oldPath: string; newPath: string } | null>(null);

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

  const refreshWorkspaceFiles = async (rootPath = workspacePath()) => {
    if (!rootPath) {
      setWorkspaceFiles([]);
      return;
    }
    const files = await listWorkspaceFiles(rootPath);
    setWorkspaceFiles(files);
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

  const handleOpenWorkspace = async () => {
    try {
      const dirPath = await openDirectory();
      if (!dirPath) return;
      setWorkspacePath(dirPath);
      saveWorkspacePath(dirPath);
      const files = await listWorkspaceFiles(dirPath);
      setWorkspaceFiles(files);
      setWorkspaceSearchResults([]);
      setSidebarVisible(true);
    } catch {
      console.error(t('dir.workspaceFailed'));
    }
  };

  const handleWorkspaceSearch = async (query: string) => {
    const rootPath = workspacePath();
    if (!rootPath || !query.trim()) {
      setWorkspaceSearchResults([]);
      return;
    }
    const results = await searchWorkspaceFiles(rootPath, query);
    setWorkspaceSearchResults(results);
  };

  const handleRenameFile = async (oldPath: string, newName: string) => {
    try {
      const newPath = await renameFile(oldPath, newName);
      if (newPath === oldPath) return;

      setOpenFiles(prev => replaceStoredPath(prev, oldPath, newPath));
      setRecentFiles(prev => {
        const next = replaceStoredPath(prev, oldPath, newPath);
        saveRecentFiles(next);
        return next;
      });
      if (currentFilePath() === oldPath) {
        setCurrentFilePath(newPath);
      }
      setRenamedFile({ oldPath, newPath });
      await refreshDirFiles(newPath);
      await refreshWorkspaceFiles();
    } catch {
      alert(t('dir.renameFailed'));
    }
  };

  const handleHeadingClick = (lineNumber: number, headingText?: string) => {
    if ((window as any).__editorJumpToLine) {
      (window as any).__editorJumpToLine(lineNumber, headingText);
    }
  };

  createEffect(() => {
    const jump = pendingJump();
    if (!jump || currentFilePath() !== jump.filePath) return;
    setTimeout(() => {
      if ((window as any).__editorJumpToLine) {
        (window as any).__editorJumpToLine(jump.lineNumber);
      }
      setPendingJump(null);
    }, 120);
  });

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

    const storedWorkspacePath = workspacePath();
    if (storedWorkspacePath) {
      refreshWorkspaceFiles(storedWorkspacePath);
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
        workspacePath={workspacePath()}
        workspaceFiles={workspaceFiles()}
        searchResults={workspaceSearchResults()}
        onOpenWorkspace={handleOpenWorkspace}
        onRenameFile={handleRenameFile}
        onWorkspaceSearch={handleWorkspaceSearch}
        onFileClick={(filePath, lineNumber) => {
          if (lineNumber) setPendingJump({ filePath, lineNumber });
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
          renamedFile={renamedFile()}
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
