import { Component, onMount, onCleanup, createSignal, createEffect } from 'solid-js';
import Cherry from 'cherry-markdown';
import 'cherry-markdown/dist/cherry-markdown.css';
import './Editor.css';
import { openFile, saveFile, saveToFile } from '../utils/fileOperations';
import { exportFile, ExportProgressCallback } from '../utils/exportUtils';

type ViewMode = 'edit' | 'preview';

interface EditorProps {
    onContentChange?: (content: string) => void;
    onHeadingClick?: (lineNumber: number, headingText?: string) => void;
}

const Editor: Component<EditorProps> = (props) => {
    let editorContainer: HTMLDivElement | undefined;
    let cherryInstance: Cherry | null = null;
    let cmInstance: any = null; // CodeMirror 实例
    const [viewMode, setViewMode] = createSignal<ViewMode>('edit');
    const [, setMarkdownContent] = createSignal<string>('');
    const [currentFilePath, setCurrentFilePath] = createSignal<string | null>(null);
    const [isModified, setIsModified] = createSignal<boolean>(false);
    const [showExportMenu, setShowExportMenu] = createSignal<boolean>(false);
    const [isExporting, setIsExporting] = createSignal<boolean>(false);
    const [exportProgress, setExportProgress] = createSignal<number>(0);
    const [exportMessage, setExportMessage] = createSignal<string>('');
    let progressBarElement: HTMLDivElement | undefined;

    // 切换显示模式（只在源码和预览之间切换）
    const toggleViewMode = () => {
        const newMode: ViewMode = viewMode() === 'edit' ? 'preview' : 'edit';
        setViewMode(newMode);
        updateEditorMode(newMode);
    };

    // 更新编辑器模式
    const updateEditorMode = (mode: ViewMode) => {
        if (!cherryInstance) return;

        // 使用 setTimeout 确保 DOM 更新完成后再切换
        setTimeout(() => {
            try {
                const instance = cherryInstance as any;

                switch (mode) {
                    case 'edit':
                        // 尝试多种可能的 API 调用方式
                        if (instance.switchModel) {
                            instance.switchModel('editOnly');
                        } else if (instance.switchMode) {
                            instance.switchMode('editOnly');
                        } else if (instance.setModel) {
                            instance.setModel('editOnly');
                        }
                        break;
                    case 'preview':
                        if (instance.switchModel) {
                            instance.switchModel('previewOnly');
                        } else if (instance.switchMode) {
                            instance.switchMode('previewOnly');
                        } else if (instance.setModel) {
                            instance.setModel('previewOnly');
                        }
                        break;
                }

                // 切换后刷新编辑器布局
                if (instance.refresh) {
                    instance.refresh();
                } else if (instance.updateLayout) {
                    instance.updateLayout();
                }

                // 强制重新渲染
                if (instance.getMarkdown) {
                    const content = instance.getMarkdown();
                    if (content !== undefined) {
                        instance.setMarkdown(content);
                    }
                }
            } catch (error) {
                console.error('切换模式失败:', error);
            }
        }, 50);
    };

    // 打开文件
    const handleOpenFile = async () => {
        try {
            const result = await openFile();
            if (result) {
                setCurrentFilePath(result.path);
                setIsModified(false);
                if (cherryInstance) {
                    (cherryInstance as any).setMarkdown(result.content);
                }
            }
        } catch (error) {
            console.error('打开文件失败:', error);
            alert('打开文件失败，请重试');
        }
    };

    // 保存文件
    const handleSaveFile = async () => {
        try {
            if (!cherryInstance) return;

            const content = (cherryInstance as any).getMarkdown?.() || '';
            const filePath = currentFilePath();

            if (filePath) {
                // 保存到当前文件
                await saveToFile(filePath, content);
                setIsModified(false);
                console.log('文件已保存:', filePath);
            } else {
                // 另存为
                const savedPath = await saveFile(content);
                if (savedPath) {
                    setCurrentFilePath(savedPath);
                    setIsModified(false);
                    console.log('文件已保存:', savedPath);
                }
            }
        } catch (error) {
            console.error('保存文件失败:', error);
            alert('保存文件失败，请重试');
        }
    };

    // 另存为
    const handleSaveAsFile = async () => {
        try {
            if (!cherryInstance) return;

            const content = (cherryInstance as any).getMarkdown?.() || '';
            const savedPath = await saveFile(content, currentFilePath() || undefined);

            if (savedPath) {
                setCurrentFilePath(savedPath);
                setIsModified(false);
                console.log('文件已另存为:', savedPath);
            }
        } catch (error) {
            console.error('另存为失败:', error);
            alert('另存为失败，请重试');
        }
    };

    // 导出功能
    const handleExport = async (format: 'word' | 'pdf' | 'png' | 'html') => {
        try {
            if (!cherryInstance || isExporting()) return;

            setIsExporting(true);
            setExportProgress(0);
            setExportMessage('准备导出...');
            setShowExportMenu(false);

            const content = (cherryInstance as any).getMarkdown?.() || '';
            const fileName = getFileName().replace(/\.[^/.]+$/, '') || 'Document';

            // 如果是 PDF 或 PNG，需要确保在预览模式
            if (format === 'pdf' || format === 'png') {
                if (viewMode() !== 'preview') {
                    setExportMessage('正在切换到预览模式...');
                    setViewMode('preview');
                    updateEditorMode('preview');
                    // 等待预览渲染完成
                    await new Promise(resolve => setTimeout(resolve, 800));
                }
            }

            // 进度回调函数
            const onProgress: ExportProgressCallback = (progress, message) => {
                setExportProgress(progress);
                setExportMessage(message);
            };

            // 异步导出
            await exportFile(format, content, fileName, onProgress);

            // 导出完成
            setTimeout(() => {
                setIsExporting(false);
                setExportProgress(0);
                setExportMessage('');
            }, 500);
        } catch (error) {
            console.error(`导出 ${format} 失败:`, error);
            setIsExporting(false);
            setExportProgress(0);
            setExportMessage('');
            alert(`导出失败: ${error instanceof Error ? error.message : '未知错误'}`);
        }
    };

    // 快捷键处理
    const handleKeyDown = (e: KeyboardEvent) => {
        if (e.ctrlKey && e.key === '/') {
            e.preventDefault();
            toggleViewMode();
        } else if (e.ctrlKey && e.key === 'o') {
            e.preventDefault();
            handleOpenFile();
        } else if (e.ctrlKey && e.key === 's') {
            e.preventDefault();
            handleSaveFile();
        }
    };

    // 点击外部关闭导出菜单
    const handleClickOutside = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        if (!target.closest('.export-menu-container')) {
            setShowExportMenu(false);
        }
    };

    onMount(() => {
        if (!editorContainer) return;

        // 添加键盘事件监听
        window.addEventListener('keydown', handleKeyDown);

        // 添加点击外部关闭菜单的监听
        document.addEventListener('click', handleClickOutside);

        const options: any = {
            id: 'editor',
            value: '# 欢迎使用 DongshanMD\n\n这是一个基于 CherryMarkdown 的 Markdown 编辑器。\n\n## 功能特性\n\n- 实时预览\n- 语法高亮\n- 丰富的工具栏\n- Typora 风格界面\n\n开始编写你的 Markdown 文档吧！',
            editor: {
                defaultModel: 'editOnly',
            },
            toolbars: {
                toolbar: [
                    'bold',
                    'italic',
                    'strikethrough',
                    '|',
                    'color',
                    'header',
                    '|',
                    'list',
                    '|',
                    'code',
                    'formula',
                    '|',
                    'drawIo',
                    '|',
                    'settings',
                ],
            },
        };

        cherryInstance = new Cherry(options);

        // 等待编辑器初始化完成
        let intervalId: number | null = null;

        setTimeout(() => {
            if (!cherryInstance) return;

            const instance = cherryInstance as any;

            // 防抖函数，避免频繁更新
            let updateTimer: number | null = null;
            const updateContent = () => {
                if (updateTimer !== null) {
                    clearTimeout(updateTimer);
                }
                updateTimer = window.setTimeout(() => {
                    try {
                        if (instance.getMarkdown) {
                            const content = instance.getMarkdown();
                            const currentContent = content || '';
                            setMarkdownContent(currentContent);
                            if (props.onContentChange) {
                                props.onContentChange(currentContent);
                            }
                            // 标记为已修改（如果有打开的文件）
                            if (currentFilePath()) {
                                setIsModified(true);
                            }
                        }
                    } catch (error) {
                        console.error('获取内容失败:', error);
                    }
                    updateTimer = null;
                }, 150); // 150ms 防抖延迟
            };

            // 立即获取初始内容（不使用防抖）
            try {
                if (instance.getMarkdown) {
                    const initialContent = instance.getMarkdown() || '';
                    setMarkdownContent(initialContent);
                    if (props.onContentChange) {
                        props.onContentChange(initialContent);
                    }
                }
            } catch (error) {
                console.error('获取初始内容失败:', error);
            }

            // 监听 CodeMirror 的 change 事件（最可靠的方式）
            const editorElement = editorContainer?.querySelector('.CodeMirror');
            if (editorElement) {
                cmInstance = (editorElement as any).CodeMirror;
                if (cmInstance && typeof cmInstance.on === 'function') {
                    cmInstance.on('change', updateContent);
                }
            }

            // 也尝试监听 CherryMarkdown 的事件（但可能不需要，因为 CodeMirror 已经监听了）
            // 注释掉避免重复触发
            // if (instance.on && typeof instance.on === 'function') {
            //     instance.on('change', updateContent);
            //     instance.on('afterChange', updateContent);
            // }

            // 移除 MutationObserver，因为它会触发太频繁
            // observer = new MutationObserver(() => {
            //     updateContent();
            // });

            // 移除定期检查，因为 CodeMirror 的 change 事件已经足够
            // intervalId = window.setInterval(() => {
            //     updateContent();
            // }, 500);
        }, 300);

        // 清理函数
        onCleanup(() => {
            // observer 相关代码已注释，暂时不需要清理
            // if (observer) {
            //     observer.disconnect();
            // }
            if (intervalId !== null) {
                clearInterval(intervalId);
            }
        });
    });

    // 跳转到指定行
    const jumpToLine = (lineNumber: number, headingText?: string) => {
        if (!cherryInstance || !editorContainer) return;

        const currentMode = viewMode();

        // 如果是预览模式，尝试在预览区域中滚动
        if (currentMode === 'preview') {
            scrollToHeadingInPreview(headingText, lineNumber);
            return;
        }

        // 编辑模式：跳转到源码中的指定行
        // 多次尝试跳转，确保编辑器已加载
        const tryJump = (attempts = 0) => {
            if (attempts > 10) {
                console.error('跳转失败：无法找到编辑器');
                return;
            }

            try {
                // 尝试多种方式获取 CodeMirror 实例
                let cm: any = null;

                // 方式1: 使用保存的 CodeMirror 实例
                if (cmInstance && typeof cmInstance.setCursor === 'function') {
                    cm = cmInstance;
                }

                // 方式2: 直接从 DOM 获取
                if (!cm) {
                    const editorElement = editorContainer?.querySelector('.CodeMirror');
                    if (editorElement) {
                        cm = (editorElement as any).CodeMirror;
                    }
                }

                // 方式3: 从 CherryMarkdown 实例获取
                if (!cm && cherryInstance) {
                    const instance = cherryInstance as any;
                    if (instance.editor && instance.editor.codemirror) {
                        cm = instance.editor.codemirror;
                    } else if (instance.getEditor) {
                        const editor = instance.getEditor();
                        if (editor && editor.codemirror) {
                            cm = editor.codemirror;
                        }
                    } else if (instance.codemirror) {
                        cm = instance.codemirror;
                    }
                }

                // 方式4: 从全局查找
                if (!cm && (window as any).CodeMirror) {
                    const CodeMirror = (window as any).CodeMirror;
                    if (CodeMirror.instances && CodeMirror.instances.length > 0) {
                        cm = CodeMirror.instances[0];
                    }
                }

                // 方式5: 通过 DOM 查找所有 CodeMirror 实例
                if (!cm) {
                    const allCodeMirrors = document.querySelectorAll('.CodeMirror');
                    if (allCodeMirrors.length > 0) {
                        cm = (allCodeMirrors[0] as any).CodeMirror;
                    }
                }

                if (cm && typeof cm.setCursor === 'function') {
                    // 跳转到指定行（行号从 0 开始）
                    const line = Math.max(0, lineNumber - 1);
                    cm.setCursor(line, 0);
                    cm.scrollIntoView({ line, ch: 0 }, 200);
                    cm.focus();
                    console.log(`跳转到第 ${lineNumber} 行`);
                } else {
                    // 如果还没找到，延迟重试
                    setTimeout(() => tryJump(attempts + 1), 100);
                }
            } catch (error) {
                console.error('跳转失败:', error);
                setTimeout(() => tryJump(attempts + 1), 100);
            }
        };

        // 延迟执行，确保编辑器已加载
        setTimeout(() => tryJump(), 150);
    };

    // 在预览模式中滚动到指定标题
    const scrollToHeadingInPreview = (headingText: string | undefined, lineNumber: number) => {
        if (!editorContainer) return;

        // 多次尝试，确保预览区域已渲染
        const tryScroll = (attempts = 0) => {
            if (attempts > 10) {
                console.error('预览模式滚动失败：无法找到预览区域或标题');
                return;
            }

            try {
                // 查找预览区域 - 尝试多种选择器
                let previewElement: Element | null = null;

                // 方式1: 查找 .cherry-editor__preview
                previewElement = editorContainer?.querySelector('.cherry-editor__preview');

                // 方式2: 查找 .cherry-previewer（实际内容容器）
                if (!previewElement) {
                    previewElement = editorContainer?.querySelector('.cherry-previewer');
                }

                // 方式3: 查找包含 markdown 内容的容器
                if (!previewElement) {
                    previewElement = editorContainer?.querySelector('.cherry-markdown');
                }

                // 方式4: 查找任何包含 preview 的类
                if (!previewElement) {
                    previewElement = editorContainer?.querySelector('[class*="preview"]');
                }

                // 方式5: 在整个容器中查找
                if (!previewElement) {
                    previewElement = editorContainer;
                }

                if (!previewElement) {
                    console.warn(`尝试 ${attempts + 1}: 未找到预览区域`);
                    setTimeout(() => tryScroll(attempts + 1), 100);
                    return;
                }

                // 查找所有标题元素 (h1-h6)
                const headings = previewElement.querySelectorAll('h1, h2, h3, h4, h5, h6');

                if (headings.length === 0) {
                    console.warn(`尝试 ${attempts + 1}: 未找到标题元素，找到的预览元素:`, previewElement.className);
                    setTimeout(() => tryScroll(attempts + 1), 100);
                    return;
                }

                console.log(`找到 ${headings.length} 个标题元素`);

                // 如果提供了标题文本，优先使用文本匹配
                if (headingText) {
                    for (let i = 0; i < headings.length; i++) {
                        const heading = headings[i];
                        const text = heading.textContent?.trim();

                        // 精确匹配或包含匹配
                        if (text === headingText || text?.includes(headingText) || headingText.includes(text || '')) {
                            // 找到可滚动的父容器
                            let scrollContainer: Element | null = heading;

                            // 向上查找可滚动的容器
                            while (scrollContainer && scrollContainer !== previewElement) {
                                const style = window.getComputedStyle(scrollContainer);
                                if (style.overflowY === 'auto' || style.overflowY === 'scroll' ||
                                    style.overflow === 'auto' || style.overflow === 'scroll') {
                                    break;
                                }
                                scrollContainer = scrollContainer.parentElement;
                            }

                            // 计算标题相对于滚动容器的位置
                            const headingRect = heading.getBoundingClientRect();

                            // 优先使用找到的滚动容器
                            if (scrollContainer && scrollContainer instanceof HTMLElement) {
                                const containerRect = scrollContainer.getBoundingClientRect();
                                const scrollTop = scrollContainer.scrollTop + headingRect.top - containerRect.top - 100;
                                scrollContainer.scrollTo({ top: scrollTop, behavior: 'smooth' });
                            } else if (previewElement && previewElement instanceof HTMLElement) {
                                // 使用预览元素作为滚动容器
                                const containerRect = previewElement.getBoundingClientRect();
                                const scrollTop = previewElement.scrollTop + headingRect.top - containerRect.top - 100;
                                previewElement.scrollTo({ top: scrollTop, behavior: 'smooth' });
                            } else {
                                // 使用 scrollIntoView 作为后备方案
                                heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
                            }

                            // 高亮标题
                            heading.classList.add('heading-highlight');
                            setTimeout(() => {
                                heading.classList.remove('heading-highlight');
                            }, 1000);

                            console.log(`成功滚动到标题: ${headingText}`);
                            return;
                        }
                    }
                }

                // 如果文本匹配失败，尝试根据行号提取标题文本
                const markdownContent = cherryInstance ? (cherryInstance as any).getMarkdown?.() : '';
                if (markdownContent) {
                    const lines = markdownContent.split('\n');
                    const targetLine = lines[lineNumber - 1];

                    if (targetLine && targetLine.trim().startsWith('#')) {
                        // 提取标题文本
                        const extractedText = targetLine.replace(/^#+\s*/, '').trim();

                        // 再次尝试匹配
                        for (let i = 0; i < headings.length; i++) {
                            const heading = headings[i];
                            const text = heading.textContent?.trim();

                            if (text === extractedText || text?.includes(extractedText)) {
                                // 找到可滚动的父容器
                                let scrollContainer: Element | null = heading;

                                while (scrollContainer && scrollContainer !== previewElement) {
                                    const style = window.getComputedStyle(scrollContainer);
                                    if (style.overflowY === 'auto' || style.overflowY === 'scroll' ||
                                        style.overflow === 'auto' || style.overflow === 'scroll') {
                                        break;
                                    }
                                    scrollContainer = scrollContainer.parentElement;
                                }

                                // 计算标题相对于滚动容器的位置
                                const headingRect = heading.getBoundingClientRect();

                                // 优先使用找到的滚动容器
                                if (scrollContainer && scrollContainer instanceof HTMLElement) {
                                    const containerRect = scrollContainer.getBoundingClientRect();
                                    const scrollTop = scrollContainer.scrollTop + headingRect.top - containerRect.top - 100;
                                    scrollContainer.scrollTo({ top: scrollTop, behavior: 'smooth' });
                                } else if (previewElement && previewElement instanceof HTMLElement) {
                                    // 使用预览元素作为滚动容器
                                    const containerRect = previewElement.getBoundingClientRect();
                                    const scrollTop = previewElement.scrollTop + headingRect.top - containerRect.top - 100;
                                    previewElement.scrollTo({ top: scrollTop, behavior: 'smooth' });
                                } else {
                                    // 使用 scrollIntoView 作为后备方案
                                    heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                }

                                heading.classList.add('heading-highlight');
                                setTimeout(() => {
                                    heading.classList.remove('heading-highlight');
                                }, 1000);

                                console.log(`成功滚动到标题: ${extractedText}`);
                                return;
                            }
                        }
                    }
                }

                console.warn(`尝试 ${attempts + 1}: 未找到对应的标题元素，标题文本: ${headingText}`);
                setTimeout(() => tryScroll(attempts + 1), 100);
            } catch (error) {
                console.error(`预览模式滚动失败 (尝试 ${attempts + 1}):`, error);
                setTimeout(() => tryScroll(attempts + 1), 100);
            }
        };

        // 延迟执行，确保预览区域已渲染
        setTimeout(() => tryScroll(), 100);
    };

    // 暴露跳转方法给父组件
    createEffect(() => {
        (window as any).__editorJumpToLine = jumpToLine;
    });

    // 更新进度条宽度
    createEffect(() => {
        if (progressBarElement) {
            progressBarElement.style.width = `${exportProgress()}%`;
        }
    });

    onCleanup(() => {
        window.removeEventListener('keydown', handleKeyDown);
        document.removeEventListener('click', handleClickOutside);
        if (cherryInstance) {
            cherryInstance.destroy();
            cherryInstance = null;
        }
    });

    // 获取文件名显示
    const getFileName = () => {
        const path = currentFilePath();
        if (!path) return '未命名文档';
        const parts = path.split(/[/\\]/);
        return parts[parts.length - 1] || '未命名文档';
    };

    return (
        <div class="editor-container">
            <div class="editor-header">
                <div class="header-left">
                    <h1>DongshanMD</h1>
                    <span class="file-name" title={currentFilePath() || ''}>
                        {getFileName()}
                        {isModified() && <span class="modified-indicator"> *</span>}
                    </span>
                </div>
                <div class="header-right">
                    <div class="file-actions">
                        <button
                            class="file-btn"
                            onClick={handleOpenFile}
                            title="打开文件 (Ctrl+O)"
                        >
                            📂 打开
                        </button>
                        <button
                            class="file-btn"
                            onClick={handleSaveFile}
                            title="保存文件 (Ctrl+S)"
                        >
                            💾 保存
                        </button>
                        <button
                            class="file-btn"
                            onClick={handleSaveAsFile}
                            title="另存为"
                        >
                            💾 另存为
                        </button>
                        <div class="export-menu-container">
                            <button
                                class="file-btn"
                                onClick={() => setShowExportMenu(!showExportMenu())}
                                title="导出文档"
                            >
                                📤 导出
                            </button>
                            {showExportMenu() && (
                                <div class="export-menu">
                                    <button
                                        class="export-menu-item"
                                        onClick={() => handleExport('word')}
                                    >
                                        📄 Word (.docx)
                                    </button>
                                    <button
                                        class="export-menu-item"
                                        onClick={() => handleExport('pdf')}
                                    >
                                        📑 PDF (.pdf)
                                    </button>
                                    <button
                                        class="export-menu-item"
                                        onClick={() => handleExport('png')}
                                    >
                                        🖼️ PNG (.png)
                                    </button>
                                    <button
                                        class="export-menu-item"
                                        onClick={() => handleExport('html')}
                                    >
                                        🌐 HTML (.html)
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                    <div class="view-mode-indicator">
                        <span class="mode-label">显示模式:</span>
                        <button
                            class={`mode-btn ${viewMode() === 'edit' ? 'active' : ''}`}
                            onClick={() => { setViewMode('edit'); updateEditorMode('edit'); }}
                            title="源码模式 (Ctrl+/)"
                        >
                            源码
                        </button>
                        <button
                            class={`mode-btn ${viewMode() === 'preview' ? 'active' : ''}`}
                            onClick={() => { setViewMode('preview'); updateEditorMode('preview'); }}
                            title="预览模式 (Ctrl+/)"
                        >
                            预览
                        </button>
                    </div>
                </div>
            </div>
            <div ref={editorContainer} id="editor" class="cherry-editor" />
            {isExporting() && (
                <div class="export-progress-overlay">
                    <div class="export-progress-dialog">
                        <div class="export-progress-title">正在导出...</div>
                        <div class="export-progress-bar-container">
                            <div
                                ref={progressBarElement}
                                class="export-progress-bar"
                            />
                        </div>
                        <div class="export-progress-message">{exportMessage()}</div>
                        <div class="export-progress-percent">{exportProgress()}%</div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Editor;

