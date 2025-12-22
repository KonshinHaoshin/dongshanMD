import { Component, createSignal, onMount } from 'solid-js';
import { listen } from '@tauri-apps/api/event';
import Editor from './components/Editor';
import Sidebar from './components/Sidebar';
import './App.css';

const App: Component = () => {
  const [sidebarVisible, setSidebarVisible] = createSignal(false);
  const [markdownContent, setMarkdownContent] = createSignal<string>('');
  const [fileToOpen, setFileToOpen] = createSignal<string | null>(null);
  const [openFiles, setOpenFiles] = createSignal<string[]>([]);
  const [currentFilePath, setCurrentFilePath] = createSignal<string | null>(null);

  const toggleSidebar = () => {
    setSidebarVisible(!sidebarVisible());
  };

  const handleContentChange = (content: string) => {
    setMarkdownContent(content);
  };

  const handleFilePathChange = (filePath: string | null) => {
    console.log('handleFilePathChange 被调用:', filePath);
    setCurrentFilePath(filePath);
    if (filePath) {
      // 添加到打开文件列表（如果不存在）
      setOpenFiles(prev => {
        if (!prev.includes(filePath)) {
          const newList = [...prev, filePath];
          console.log('更新文件列表:', newList);
          return newList;
        }
        return prev;
      });
    }
  };

  const handleHeadingClick = (lineNumber: number, headingText?: string) => {
    // 调用编辑器的跳转方法
    if ((window as any).__editorJumpToLine) {
      (window as any).__editorJumpToLine(lineNumber, headingText);
    }
  };

  // 监听文件打开事件
  onMount(async () => {
    try {
      // 监听来自 Rust 后端的文件打开事件
      const unlisten = await listen<string>('open-file', (event) => {
        const filePath = event.payload;
        if (filePath) {
          console.log('收到文件打开事件:', filePath);
          setFileToOpen(filePath);
          // 立即添加到文件列表
          handleFilePathChange(filePath);
        }
      });
      
      // 开发模式下暴露测试函数
      if (import.meta.env.DEV) {
        (window as any).__devOpenFile = (filePath: string) => {
          console.log('开发模式：手动打开文件', filePath);
          setFileToOpen(filePath);
          handleFilePathChange(filePath);
        };
      }

      // 清理函数
      return () => {
        unlisten();
      };
    } catch (error) {
      console.error('监听文件打开事件失败:', error);
    }

    // 检查启动参数中的文件路径
    try {
      // 通过 Rust 后端获取命令行参数
      const { invoke } = await import('@tauri-apps/api/core');
      const args = await invoke<string[]>('get_file_args').catch(() => null);
      
      if (args && args.length > 0) {
        // 清理文件路径，移除可能的引号
        const cleanPath = (path: string) => path.trim().replace(/^["']|["']$/g, '');
        
        // 过滤出文件路径（排除程序路径和可执行文件）
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
          // 使用第一个有效的文件路径
          const filePath = fileArgs[0];
          console.log('从启动参数加载文件:', filePath);
          setFileToOpen(filePath);
          // 立即添加到文件列表
          handleFilePathChange(filePath);
        }
      }
    } catch (error) {
      console.error('获取启动参数失败:', error);
    }
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
        onFileClick={(filePath) => setFileToOpen(filePath)}
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
        <button class="sidebar-toggle" onClick={toggleSidebar} title="显示侧边栏">
          ☰
        </button>
      )}
    </div>
  );
};

export default App;

