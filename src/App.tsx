import { Component, createSignal } from 'solid-js';
import Editor from './components/Editor';
import Sidebar from './components/Sidebar';
import './App.css';

const App: Component = () => {
  const [sidebarVisible, setSidebarVisible] = createSignal(false);
  const [markdownContent, setMarkdownContent] = createSignal<string>('');

  const toggleSidebar = () => {
    setSidebarVisible(!sidebarVisible());
  };

  const handleContentChange = (content: string) => {
    setMarkdownContent(content);
  };

  const handleHeadingClick = (lineNumber: number, headingText?: string) => {
    // 调用编辑器的跳转方法
    if ((window as any).__editorJumpToLine) {
      (window as any).__editorJumpToLine(lineNumber, headingText);
    }
  };

  return (
    <div class="app">
      <Sidebar 
        visible={sidebarVisible()} 
        onToggle={toggleSidebar}
        markdownContent={markdownContent()}
        onHeadingClick={handleHeadingClick}
      />
      <div class="main-content" classList={{ 'with-sidebar': sidebarVisible() }}>
        <Editor 
          onContentChange={handleContentChange}
          onHeadingClick={handleHeadingClick}
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

