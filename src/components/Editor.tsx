import { Component, onMount, onCleanup, createSignal, createEffect } from 'solid-js';
import Cherry from 'cherry-markdown';
import 'cherry-markdown/dist/cherry-markdown.css';
import './Editor.css';
import { openFile, saveFile, saveToFile } from '../utils/fileOperations';
import { exportFile, ExportProgressCallback } from '../utils/exportUtils';
import { convertFileSrc } from '@tauri-apps/api/core';
import { mkdir, writeFile } from '@tauri-apps/plugin-fs';

type ViewMode = 'edit' | 'preview';

interface EditorProps {
    onContentChange?: (content: string) => void;
    onHeadingClick?: (lineNumber: number, headingText?: string) => void;
    initialFilePath?: string | null;
    onFilePathChange?: (filePath: string | null) => void;
}

const Editor: Component<EditorProps> = (props) => {
    let editorContainer: HTMLDivElement | undefined;
    let cherryInstance: Cherry | null = null;
    let cmInstance: any = null; // CodeMirror 实例
    const [viewMode, setViewMode] = createSignal<ViewMode>('edit');
    const [markdownContent, setMarkdownContent] = createSignal<string>('');
    const [currentFilePath, setCurrentFilePath] = createSignal<string | null>(props.initialFilePath || null);
    const [isModified, setIsModified] = createSignal<boolean>(false);
    const [showExportMenu, setShowExportMenu] = createSignal<boolean>(false);
    const [isExporting, setIsExporting] = createSignal<boolean>(false);
    const [exportProgress, setExportProgress] = createSignal<number>(0);
    const [exportMessage, setExportMessage] = createSignal<string>('');
    const [showSettings, setShowSettings] = createSignal<boolean>(false);
    const [imagePasteMode, setImagePasteMode] = createSignal<'base64' | 'relative'>(
        (localStorage.getItem('imagePasteMode') as 'base64' | 'relative') || 'base64'
    );
    let progressBarElement: HTMLDivElement | undefined;
    let lastScrollRatio: { edit: number; preview: number } = { edit: 0, preview: 0 };

    const findScrollableContainer = (element: HTMLElement | null) => {
        let current: HTMLElement | null = element;
        while (current) {
            const style = window.getComputedStyle(current);
            if (style.overflowY === 'auto' || style.overflowY === 'scroll' ||
                style.overflow === 'auto' || style.overflow === 'scroll') {
                return current;
            }
            current = current.parentElement;
        }
        return element;
    };

    const getCodeMirrorInstance = () => {
        if (cmInstance && typeof cmInstance.getCursor === 'function') {
            return cmInstance;
        }
        const editorElement = editorContainer?.querySelector('.CodeMirror');
        if (editorElement) {
            return (editorElement as any).CodeMirror;
        }
        if (cherryInstance) {
            const instance = cherryInstance as any;
            if (instance.editor?.codemirror) return instance.editor.codemirror;
            const editor = instance.getEditor?.();
            if (editor?.codemirror) return editor.codemirror;
            if (instance.codemirror) return instance.codemirror;
        }
        return null;
    };

    const insertMarkdownAtCursor = (markdown: string) => {
        const cm = getCodeMirrorInstance();
        if (cm && typeof cm.replaceSelection === 'function') {
            cm.replaceSelection(markdown);
            return;
        }
        if (cherryInstance && (cherryInstance as any).insert) {
            (cherryInstance as any).insert(markdown);
        }
    };

    const getFileBaseName = (filePath: string) => {
        const parts = filePath.split(/[/\\]/);
        const name = parts[parts.length - 1] || 'document';
        return name.replace(/\.[^/.]+$/, '') || 'document';
    };

    const getFileDir = (filePath: string) => filePath.replace(/[\\/][^\\/]*$/, '');

    const getImageFileName = (file: File) => {
        const original = file.name && file.name !== 'image.png' ? file.name : '';
        if (original) return original;
        const ext = file.type ? file.type.split('/')[1] : 'png';
        const safeExt = ext ? ext.replace(/[^a-z0-9]+/gi, '') : 'png';
        return `image-${Date.now()}.${safeExt || 'png'}`;
    };

    const handleImageInsert = async (file: File) => {
        if (imagePasteMode() === 'base64') {
            const dataUrl = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result as string);
                reader.onerror = () => reject(reader.error);
                reader.readAsDataURL(file);
            });
            insertMarkdownAtCursor(`![${file.name || 'image'}](${dataUrl})`);
            return;
        }

        const mdPath = currentFilePath();
        if (!mdPath) {
            // 未保存的文档无法生成相对路径，退回 base64
            const dataUrl = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result as string);
                reader.onerror = () => reject(reader.error);
                reader.readAsDataURL(file);
            });
            insertMarkdownAtCursor(`![${file.name || 'image'}](${dataUrl})`);
            return;
        }

        const baseDir = getFileDir(mdPath);
        const baseName = getFileBaseName(mdPath);
        const folderPath = `${baseDir}\\${baseName}`;
        await mkdir(folderPath, { recursive: true });

        const fileName = getImageFileName(file);
        const targetPath = `${folderPath}\\${fileName}`;
        const buffer = new Uint8Array(await file.arrayBuffer());
        await writeFile(targetPath, buffer);

        const relativePath = `${baseName}/${fileName}`.replace(/\\/g, '/');
        insertMarkdownAtCursor(`![${file.name || fileName}](${relativePath})`);
    };

    const handlePasteEvent = async (event: ClipboardEvent) => {
        if (viewMode() !== 'edit') return;
        const items = event.clipboardData?.items;
        if (!items) return;
        const imageItem = Array.from(items).find(item => item.type.startsWith('image/'));
        if (!imageItem) return;
        const file = imageItem.getAsFile();
        if (!file) return;
        event.preventDefault();
        try {
            await handleImageInsert(file);
        } catch (error) {
            console.error('粘贴图片失败:', error);
        }
    };

    const handleDropEvent = async (event: DragEvent) => {
        if (viewMode() !== 'edit') return;
        const files = Array.from(event.dataTransfer?.files || []).filter(file => file.type.startsWith('image/'));
        if (files.length === 0) return;
        event.preventDefault();
        try {
            for (const file of files) {
                await handleImageInsert(file);
            }
        } catch (error) {
            console.error('拖拽图片失败:', error);
        }
    };

    const getCurrentCursorLine = () => {
        const cm = getCodeMirrorInstance();
        if (!cm || typeof cm.getCursor !== 'function') return 1;
        const cursor = cm.getCursor();
        return Math.max(1, (cursor?.line ?? 0) + 1);
    };

    const getMarkdownHeadings = () => {
        const content = markdownContent();
        if (!content) return [];
        const lines = content.split('\n');
        const headings: Array<{ lineNumber: number; text: string; level: number }> = [];
        lines.forEach((line, index) => {
            const match = line.trim().match(/^(#{1,6})\s+(.+)$/);
            if (match) {
                headings.push({
                    lineNumber: index + 1,
                    text: match[2].trim(),
                    level: match[1].length,
                });
            }
        });
        return headings;
    };

    const findHeadingFromLine = (lineNumber: number) => {
        const content = markdownContent();
        if (!content) return null;
        const lines = content.split('\n');
        const maxIndex = Math.min(lines.length, Math.max(1, lineNumber));
        for (let i = maxIndex - 1; i >= 0; i -= 1) {
            const match = lines[i].match(/^(#{1,6})\s+(.*)$/);
            if (match) {
                return { text: match[2].trim(), line: i + 1 };
            }
        }
        return null;
    };

    const findHeadingLineByText = (headingText: string) => {
        const content = markdownContent();
        if (!content || !headingText) return null;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i += 1) {
            const match = lines[i].match(/^(#{1,6})\s+(.*)$/);
            if (match) {
                const text = match[2].trim();
                if (text === headingText || text.includes(headingText) || headingText.includes(text)) {
                    return i + 1;
                }
            }
        }
        return null;
    };

    const getNearestPreviewHeadingText = () => {
        const previewContainer = getScrollContainer('preview');
        if (!previewContainer) return null;
        const headings = previewContainer.querySelectorAll('h1, h2, h3, h4, h5, h6');
        if (headings.length === 0) return null;
        const containerRect = previewContainer.getBoundingClientRect();
        let bestText: string | null = null;
        let bestDistance: number | null = null;
        headings.forEach((heading) => {
            const rect = heading.getBoundingClientRect();
            const distance = Math.abs(rect.top - containerRect.top);
            const text = heading.textContent?.trim() || '';
            if (!text) return;
            if (bestDistance === null || distance < bestDistance) {
                bestText = text;
                bestDistance = distance;
            }
        });
        return bestText;
    };

    const getScrollContainer = (mode: ViewMode) => {
        if (!editorContainer) return null;
        if (mode === 'edit') {
            return editorContainer.querySelector('.CodeMirror-scroll') as HTMLElement | null;
        }
        const previewElement =
            editorContainer.querySelector('.cherry-editor__preview') ||
            editorContainer.querySelector('.cherry-previewer') ||
            editorContainer.querySelector('.cherry-markdown') ||
            editorContainer.querySelector('[class*="preview"]');
        return findScrollableContainer(previewElement as HTMLElement | null);
    };

    const tryScrollEditToLine = (lineNumber: number) => {
        const cm = getCodeMirrorInstance();
        if (!cm || typeof cm.setCursor !== 'function') return false;
        const line = Math.max(0, lineNumber - 1);
        cm.setCursor(line, 0);
        if (typeof cm.scrollIntoView === 'function') {
            cm.scrollIntoView({ line, ch: 0 }, 200);
        }
        if (typeof cm.focus === 'function') {
            cm.focus();
        }
        return true;
    };

    const captureScrollRatio = (mode: ViewMode) => {
        const container = getScrollContainer(mode);
        if (!container) return 0;
        const maxScroll = Math.max(1, container.scrollHeight - container.clientHeight);
        return Math.min(1, Math.max(0, container.scrollTop / maxScroll));
    };

    const restoreScrollRatio = (mode: ViewMode, ratio: number) => {
        const container = getScrollContainer(mode);
        if (!container) return;
        const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
        container.scrollTop = Math.round(maxScroll * ratio);
    };

    const switchViewMode = (nextMode: ViewMode, options?: { preservePosition?: boolean }) => {
        const currentMode = viewMode();
        if (currentMode === nextMode) return;
        const preservePosition = options?.preservePosition === true;
        let headingInfo: { text: string; line: number } | null = null;
        let previewHeadingText: string | null = null;
        const ratio = captureScrollRatio(currentMode);
        // 无论是否同步位置，都记录当前模式的滚动位置，保持“各自独立”
        lastScrollRatio[currentMode] = ratio;
        if (preservePosition) {
            const cursorLine = currentMode === 'edit' ? getCurrentCursorLine() : null;
            headingInfo = currentMode === 'edit' && cursorLine ? findHeadingFromLine(cursorLine) : null;
            previewHeadingText = currentMode === 'preview' ? getNearestPreviewHeadingText() : null;
        }
        setViewMode(nextMode);
        updateEditorMode(nextMode);
        // 多次尝试同步位置，避免切换后又被重置到顶部
        const delays = [120, 300, 600];
        delays.forEach((delay) => {
            setTimeout(() => {
            if (nextMode === 'preview') {
                    fixPreviewImages();
                    if (preservePosition && headingInfo?.text) {
                        const scrolled = scrollToHeadingInPreviewOnce(headingInfo.text, headingInfo.line);
                        if (!scrolled && preservePosition) {
                        restoreScrollRatio(nextMode, ratio);
                        }
                } else if (!preservePosition) {
                    // 仅恢复预览自身上次位置，不做跨模式对齐
                    restoreScrollRatio(nextMode, lastScrollRatio[nextMode]);
                } else {
                    restoreScrollRatio(nextMode, ratio);
                    }
                } else if (nextMode === 'edit') {
                    if (preservePosition && previewHeadingText) {
                        const line = findHeadingLineByText(previewHeadingText) || 1;
                        const moved = tryScrollEditToLine(line);
                        if (!moved && preservePosition) {
                        restoreScrollRatio(nextMode, ratio);
                        }
                } else if (!preservePosition) {
                    restoreScrollRatio(nextMode, lastScrollRatio[nextMode]);
                } else {
                    restoreScrollRatio(nextMode, ratio);
                    }
                }
            }, delay);
        });
    };

    // 切换显示模式（只在源码和预览之间切换）
    const toggleViewMode = () => {
        const newMode: ViewMode = viewMode() === 'edit' ? 'preview' : 'edit';
        switchViewMode(newMode);
    };

    // 将本地图片路径转换为可在 Tauri WebView 中访问的资源地址
    const resolveLocalImageSrc = (src: string, baseFilePath: string | null) => {
        const trimmedSrc = src.trim();
        if (!trimmedSrc) return null;

        const decodedSrc = (() => {
            try {
                return decodeURIComponent(trimmedSrc);
            } catch {
                return trimmedSrc;
            }
        })();

        // 远程或已处理的 URL 保持不变
        if (
            trimmedSrc.startsWith('http://') ||
            trimmedSrc.startsWith('https://') ||
            trimmedSrc.startsWith('data:') ||
            trimmedSrc.startsWith('blob:') ||
            trimmedSrc.startsWith('asset:') ||
            trimmedSrc.startsWith('tauri:') ||
            trimmedSrc.startsWith('app:')
        ) {
            // 但如果是应用自身 URL（如 tauri.localhost/localhost/tauri://localhost/app://localhost），尝试解析为本地路径
            if (
                trimmedSrc.startsWith('http://') ||
                trimmedSrc.startsWith('https://') ||
                trimmedSrc.startsWith('tauri://') ||
                trimmedSrc.startsWith('app://')
            ) {
                try {
                    const url = new URL(trimmedSrc);
                    const host = url.hostname;
                    const isAppScheme = url.protocol === 'tauri:' || url.protocol === 'app:';
                    const isAppHost = host === 'tauri.localhost' || host === 'localhost' || host === '';
                    if (isAppScheme || isAppHost) {
                        let path = decodeURIComponent(url.pathname);
                        // 处理 /C:/path 这种形式
                        if (path.startsWith('/') && /^[a-zA-Z]:[\\/]/.test(path.slice(1))) {
                            path = path.slice(1);
                        }
                        // 绝对 Windows 路径
                        if (/^[a-zA-Z]:[\\/]/.test(path)) {
                            return convertFileSrc(path);
                        }
                        // 绝对 Unix 路径
                        if (path.startsWith('/')) {
                            return convertFileSrc(path);
                        }
                        // 作为相对路径处理
                        if (baseFilePath) {
                            const separator = /^[a-zA-Z]:[\\/]/.test(baseFilePath) ? '\\' : '/';
                            const baseDir = baseFilePath.replace(/[\\/][^\\/]*$/, '');
                            const cleanedBase = baseDir.replace(/[\\/]+$/, '');
                            const cleanedSrc = path.replace(/^[\\/]+/, '');
                            return convertFileSrc(`${cleanedBase}${separator}${cleanedSrc}`);
                        }
                    }
                } catch {
                    // ignore
                }
            }
            return null;
        }

        const isWindowsPath = /^[a-zA-Z]:[\\/]/.test(trimmedSrc) || /^[a-zA-Z]:[\\/]/.test(decodedSrc);
        const isUnixAbsPath = trimmedSrc.startsWith('/') || decodedSrc.startsWith('/');
        const isFileUrl = trimmedSrc.startsWith('file://');

        let resolvedPath = decodedSrc;

        if (isFileUrl) {
            // file:///C:/path -> C:/path, file:///home -> /home
            resolvedPath = decodeURIComponent(trimmedSrc.replace(/^file:\/+/, ''));
        } else if (!isWindowsPath && !isUnixAbsPath) {
            // 相对路径需要基于当前文件目录解析
            if (!baseFilePath) return null;
            const separator = /^[a-zA-Z]:[\\/]/.test(baseFilePath) ? '\\' : '/';
            const baseDir = baseFilePath.replace(/[\\/][^\\/]*$/, '');
            const cleanedBase = baseDir.replace(/[\\/]+$/, '');
            const cleanedSrc = resolvedPath.replace(/^[\\/]+/, '');
            resolvedPath = `${cleanedBase}${separator}${cleanedSrc}`;
        }

        if (!resolvedPath) return null;
        return convertFileSrc(resolvedPath);
    };

    const fixPreviewImages = () => {
        if (!editorContainer || viewMode() !== 'preview') return;
        const baseFilePath = currentFilePath();

        // 延迟到预览渲染完成后处理
        setTimeout(() => {
            const previewElement =
                editorContainer?.querySelector('.cherry-editor__preview') ||
                editorContainer?.querySelector('.cherry-previewer') ||
                editorContainer?.querySelector('.cherry-markdown') ||
                editorContainer?.querySelector('[class*="preview"]');

            if (!previewElement) return;

            const images = previewElement.querySelectorAll('img');
            images.forEach((img) => {
                const element = img as HTMLImageElement;
                const originalSrc = element.getAttribute('data-original-src') || element.getAttribute('src') || '';
                const convertedSrc = resolveLocalImageSrc(originalSrc, baseFilePath);
                if (convertedSrc && element.src !== convertedSrc) {
                    element.setAttribute('data-original-src', originalSrc);
                    element.src = convertedSrc;
                }
            });
        }, 50);
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

    // 从文件路径加载文件
    const loadFileFromPath = async (filePath: string) => {
        try {
            // 清理文件路径，移除可能的引号
            let cleanedPath = filePath.trim().replace(/^["']|["']$/g, '');
            console.log('准备加载文件，原始路径:', cleanedPath);

            // 注意：后端已经处理了路径转换，这里直接使用接收到的路径
            // 如果是相对路径（Windows 文件关联可能传递相对路径），后端会转换为绝对路径

            // 检查文件扩展名
            const lowerPath = cleanedPath.toLowerCase();
            const isTextFile = lowerPath.endsWith('.txt') ||
                lowerPath.endsWith('.md') ||
                lowerPath.endsWith('.markdown');

            if (!isTextFile) {
                console.warn('不支持的文件类型:', cleanedPath);
                alert('不支持的文件类型，仅支持 .md、.markdown 和 .txt 文件');
                return;
            }

            const { readTextFile } = await import('@tauri-apps/plugin-fs');
            console.log('开始读取文件:', cleanedPath);
            const content = await readTextFile(cleanedPath);
            
            // 先设置文件路径和状态
            setCurrentFilePath(cleanedPath);
            setIsModified(false);
            
            // 通知父组件文件路径变化
            if (props.onFilePathChange) {
                props.onFilePathChange(cleanedPath);
            }
            
            // 确保编辑器实例存在且内容正确设置
            if (cherryInstance) {
                const instance = cherryInstance as any;
                // 使用 setMarkdown 设置内容
                if (instance.setMarkdown) {
                    instance.setMarkdown(content);
                    console.log('文件内容已设置，长度:', content.length);
                } else {
                    console.error('编辑器实例没有 setMarkdown 方法');
                    return;
                }
                
                // 切换到预览模式
                setTimeout(() => {
                    switchViewMode('preview', { preservePosition: false });
                }, 200);
            } else {
                console.error('编辑器实例不存在，无法加载文件内容');
            }
            
            console.log('文件加载成功:', cleanedPath);
        } catch (error) {
            console.error('加载文件失败:', error);
            alert(`加载文件失败: ${error instanceof Error ? error.message : '未知错误'}`);
        }
    };

    // 打开文件
    const handleOpenFile = async () => {
        try {
            const result = await openFile();
            if (result) {
                setCurrentFilePath(result.path);
                setIsModified(false);
                // 通知父组件文件路径变化
                if (props.onFilePathChange) {
                    props.onFilePathChange(result.path);
                }
                if (cherryInstance) {
                    (cherryInstance as any).setMarkdown(result.content);
                    // 切换到预览模式
                    setTimeout(() => {
                        switchViewMode('preview', { preservePosition: false });
                    }, 100);
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
                    // 通知父组件文件路径变化
                    if (props.onFilePathChange) {
                        props.onFilePathChange(savedPath);
                    }
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
                // 通知父组件文件路径变化
                if (props.onFilePathChange) {
                    props.onFilePathChange(savedPath);
                }
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
                    switchViewMode('preview', { preservePosition: false });
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

    const closeSettings = () => setShowSettings(false);

    onMount(() => {
        if (!editorContainer) return;

        // 添加键盘事件监听
        window.addEventListener('keydown', handleKeyDown);

        // 添加点击外部关闭菜单的监听
        document.addEventListener('click', handleClickOutside);
        editorContainer.addEventListener('paste', handlePasteEvent);
        editorContainer.addEventListener('drop', handleDropEvent);
        editorContainer.addEventListener('dragover', (e) => {
            if (viewMode() === 'edit') {
                e.preventDefault();
            }
        });

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

            // 如果有初始文件路径，加载文件（延迟确保编辑器完全初始化）
            const initialPath = props.initialFilePath;
            if (initialPath) {
                console.log('检测到初始文件路径，将在编辑器初始化后加载:', initialPath);
                // 增加延迟，确保编辑器完全准备好
                setTimeout(() => {
                    if (cherryInstance) {
                        loadFileFromPath(initialPath);
                    } else {
                        console.error('编辑器初始化超时，无法加载初始文件');
                    }
                }, 400);
            }

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

    // 响应式监听 initialFilePath 的变化（用于文件关联打开等场景）
    createEffect(() => {
        const filePath = props.initialFilePath;
        if (!filePath) return;
        
        // 如果文件路径相同，不需要重新加载
        if (filePath === currentFilePath()) {
            console.log('文件路径相同，跳过加载:', filePath);
            return;
        }

        // 只有当编辑器已初始化时才加载（避免与 onMount 中的加载冲突）
        if (cherryInstance) {
            console.log('Editor initialFilePath 变化，开始加载:', filePath);
            const timeoutId = window.setTimeout(() => {
                loadFileFromPath(filePath);
            }, 100);
            
            // 清理函数
            return () => {
                clearTimeout(timeoutId);
            };
        } else {
            // 编辑器未初始化时，会在 onMount 中处理
            console.log('编辑器未初始化，将在 onMount 中处理文件加载');
        }
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

    const scrollToHeadingInPreviewOnce = (headingText: string | undefined, lineNumber: number) => {
        if (!editorContainer) return false;
                // 查找预览区域 - 尝试多种选择器
                let previewElement: Element | null = null;

                // 方式1: 查找 .cherry-editor__preview
                if (editorContainer) {
                    previewElement = editorContainer.querySelector('.cherry-editor__preview');
                }

                // 方式2: 查找 .cherry-previewer（实际内容容器）
                if (!previewElement && editorContainer) {
                    previewElement = editorContainer.querySelector('.cherry-previewer');
                }

                // 方式3: 查找包含 markdown 内容的容器
                if (!previewElement && editorContainer) {
                    previewElement = editorContainer.querySelector('.cherry-markdown');
                }

                // 方式4: 查找任何包含 preview 的类
                if (!previewElement && editorContainer) {
                    previewElement = editorContainer.querySelector('[class*="preview"]');
                }

                // 方式5: 在整个容器中查找
                if (!previewElement && editorContainer) {
                    previewElement = editorContainer;
                }

                if (!previewElement) {
            return false;
                }

                // 查找所有标题元素 (h1-h6)
                const headings = previewElement.querySelectorAll('h1, h2, h3, h4, h5, h6');

                if (headings.length === 0) {
            return false;
        }

        // 优先按行号匹配标题索引（更稳定，避免同名标题误匹配）
        if (lineNumber > 0) {
            const markdownHeadings = getMarkdownHeadings();
            const targetIndex = markdownHeadings.findIndex(h => h.lineNumber === lineNumber);
            if (targetIndex >= 0 && targetIndex < headings.length) {
                const heading = headings[targetIndex];
                let scrollContainer: Element | null = heading;
                while (scrollContainer && scrollContainer !== previewElement) {
                    const style = window.getComputedStyle(scrollContainer);
                    if (style.overflowY === 'auto' || style.overflowY === 'scroll' ||
                        style.overflow === 'auto' || style.overflow === 'scroll') {
                        break;
                    }
                    scrollContainer = scrollContainer.parentElement;
                }
                const headingRect = heading.getBoundingClientRect();
                if (scrollContainer && scrollContainer instanceof HTMLElement) {
                    const containerRect = scrollContainer.getBoundingClientRect();
                    const scrollTop = scrollContainer.scrollTop + headingRect.top - containerRect.top - 100;
                    scrollContainer.scrollTo({ top: scrollTop, behavior: 'smooth' });
                } else if (previewElement && previewElement instanceof HTMLElement) {
                    const containerRect = previewElement.getBoundingClientRect();
                    const scrollTop = previewElement.scrollTop + headingRect.top - containerRect.top - 100;
                    previewElement.scrollTo({ top: scrollTop, behavior: 'smooth' });
                } else {
                    heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
                heading.classList.add('heading-highlight');
                setTimeout(() => {
                    heading.classList.remove('heading-highlight');
                }, 1000);
                return true;
            }
        }

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

                    return true;
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

                        return true;
                    }
                }
            }
        }

        return false;
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
                const ok = scrollToHeadingInPreviewOnce(headingText, lineNumber);
                if (ok) return;
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
        if (editorContainer) {
            editorContainer.removeEventListener('paste', handlePasteEvent);
            editorContainer.removeEventListener('drop', handleDropEvent);
        }
        if (cherryInstance) {
            cherryInstance.destroy();
            cherryInstance = null;
        }
    });

    createEffect(() => {
        // 当内容、文件路径或模式切换时，刷新预览图片路径
        markdownContent();
        currentFilePath();
        if (viewMode() === 'preview') {
            fixPreviewImages();
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
                            onClick={() => switchViewMode('edit')}
                            title="源码模式 (Ctrl+/)"
                        >
                            源码
                        </button>
                        <button
                            class={`mode-btn ${viewMode() === 'preview' ? 'active' : ''}`}
                            onClick={() => switchViewMode('preview')}
                            title="预览模式 (Ctrl+/)"
                        >
                            预览
                        </button>
                    </div>
                    <button
                        class="file-btn"
                        onClick={() => setShowSettings(true)}
                        title="设置"
                    >
                        ⚙ 设置
                    </button>
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
            {showSettings() && (
                <div class="settings-overlay" onClick={closeSettings}>
                    <div class="settings-dialog" onClick={(e) => e.stopPropagation()}>
                        <div class="settings-title">设置</div>
                        <div class="settings-row">
                            <div class="settings-label">图片粘贴方式</div>
                            <select
                                class="settings-select"
                                value={imagePasteMode()}
                                onChange={(e) => {
                                    const value = (e.currentTarget.value as 'base64' | 'relative') || 'base64';
                                    setImagePasteMode(value);
                                    localStorage.setItem('imagePasteMode', value);
                                }}
                            >
                                <option value="base64">Base64（嵌入）</option>
                                <option value="relative">相对路径（保存文件）</option>
                            </select>
                        </div>
                        <div class="settings-actions">
                            <button class="file-btn" onClick={closeSettings}>关闭</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Editor;

