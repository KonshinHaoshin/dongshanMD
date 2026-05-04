import { Component, createEffect, createSignal, onCleanup, onMount, Show } from 'solid-js';
import { Editor as MilkdownEditor, defaultValueCtx, rootCtx } from '@milkdown/kit/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { history } from '@milkdown/kit/plugin/history';
import { clipboard } from '@milkdown/kit/plugin/clipboard';
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener';
import { trailing } from '@milkdown/kit/plugin/trailing';
import { getMarkdown, insert, replaceAll } from '@milkdown/kit/utils';
import { math } from '@milkdown/plugin-math';
import { diagram } from '@milkdown/plugin-diagram';
import { prism } from '@milkdown/plugin-prism';
import '@milkdown/kit/prose/view/style/prosemirror.css';
import '@milkdown/kit/prose/tables/style/tables.css';
import 'katex/dist/katex.min.css';
import './Editor.css';
import { openFile, saveFile, saveToFile } from '../utils/fileOperations';
import { exportFile, ExportProgressCallback } from '../utils/exportUtils';
import { convertFileSrc } from '@tauri-apps/api/core';
import { mkdir, writeFile } from '@tauri-apps/plugin-fs';
import { t, getLocale, setLocale } from '../utils/i18n';

type ViewMode = 'wysiwyg' | 'source';
type ImagePasteMode = 'base64' | 'relative';

interface MarkdownEditorHandle {
    getMarkdown(): string;
    setMarkdown(markdown: string): void;
    insertMarkdown(markdown: string): void;
    focus(): void;
    destroy(): void;
}

interface EditorProps {
    onContentChange?: (content: string) => void;
    onHeadingClick?: (lineNumber: number, headingText?: string) => void;
    initialFilePath?: string | null;
    onFilePathChange?: (filePath: string | null) => void;
}

const DEFAULT_MARKDOWN = '';

const readFileAsDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });

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

const getLineStartOffset = (content: string, lineNumber: number) => {
    const targetLine = Math.max(1, lineNumber);
    if (targetLine === 1) return 0;
    let line = 1;
    for (let index = 0; index < content.length; index += 1) {
        if (content[index] === '\n') {
            line += 1;
            if (line === targetLine) {
                return index + 1;
            }
        }
    }
    return content.length;
};

const createMilkdownHandle = async (
    root: HTMLElement,
    initialMarkdown: string,
    onMarkdownChange: (markdown: string) => void
): Promise<MarkdownEditorHandle> => {
    let latestMarkdown = initialMarkdown;

    const editor = await MilkdownEditor
        .make()
        .config((ctx) => {
            ctx.set(rootCtx, root);
            ctx.set(defaultValueCtx, initialMarkdown);
            ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
                latestMarkdown = markdown;
                onMarkdownChange(markdown);
            });
        })
        .use(commonmark)
        .use(gfm)
        .use(history)
        .use(clipboard)
        .use(listener)
        .use(trailing)
        .use(math)
        .use(diagram)
        .use(prism)
        .create();

    return {
        getMarkdown() {
            try {
                latestMarkdown = editor.action(getMarkdown());
            } catch (error) {
                console.error(t('file.loadFailed') + ':', error);
            }
            return latestMarkdown;
        },
        setMarkdown(markdown: string) {
            latestMarkdown = markdown;
            editor.action(replaceAll(markdown, true));
        },
        insertMarkdown(markdown: string) {
            editor.action(insert(markdown));
            latestMarkdown = editor.action(getMarkdown());
            onMarkdownChange(latestMarkdown);
        },
        focus() {
            root.querySelector<HTMLElement>('.ProseMirror')?.focus();
        },
        destroy() {
            editor.destroy();
        },
    };
};

const applyTheme = (theme: string) => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
};

const Editor: Component<EditorProps> = (props) => {
    let milkdownRoot: HTMLDivElement | undefined;
    let sourceTextArea: HTMLTextAreaElement | undefined;
    let progressBarElement: HTMLDivElement | undefined;
    let editorHandle: MarkdownEditorHandle | null = null;
    let loadedInitialPath: string | null = null;
    let isProgrammaticChange = false;
    let lastRequestedPath: string | null = null;
    let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;

    const [viewMode, setViewMode] = createSignal<ViewMode>('wysiwyg');
    const [markdownContent, setMarkdownContent] = createSignal<string>(DEFAULT_MARKDOWN);
    const [sourceContent, setSourceContent] = createSignal<string>(DEFAULT_MARKDOWN);
    const [currentFilePath, setCurrentFilePath] = createSignal<string | null>(props.initialFilePath || null);
    const [lastSavedContent, setLastSavedContent] = createSignal<string>(DEFAULT_MARKDOWN);
    const [isModified, setIsModified] = createSignal<boolean>(false);
    const [showExportMenu, setShowExportMenu] = createSignal<boolean>(false);
    const [isExporting, setIsExporting] = createSignal<boolean>(false);
    const [exportProgress, setExportProgress] = createSignal<number>(0);
    const [exportMessage, setExportMessage] = createSignal<string>('');
    const [showSettings, setShowSettings] = createSignal<boolean>(false);
    const [errorMessage, setErrorMessage] = createSignal<string>('');
    const [isEditorReady, setIsEditorReady] = createSignal<boolean>(false);
    const [imagePasteMode, setImagePasteMode] = createSignal<ImagePasteMode>(
        (localStorage.getItem('imagePasteMode') as ImagePasteMode) || 'base64'
    );
    const [autoSaveEnabled, setAutoSaveEnabled] = createSignal<boolean>(
        localStorage.getItem('autoSave') !== 'false'
    );
    const [currentTheme, setCurrentTheme] = createSignal<string>(
        localStorage.getItem('theme') || 'light'
    );
    const [searchVisible, setSearchVisible] = createSignal(false);
    const [searchTerm, setSearchTerm] = createSignal('');
    const [replaceTerm, setReplaceTerm] = createSignal('');
    const [searchIndex, setSearchIndex] = createSignal(0);
    const [searchResults, setSearchResults] = createSignal<number[]>([]);

    const emitContentChange = (content: string) => {
        props.onContentChange?.(content);
    };

    const updateMarkdownState = (content: string, options?: { preserveSource?: boolean }) => {
        setMarkdownContent(content);
        if (!options?.preserveSource) {
            setSourceContent(content);
        }
        setIsModified(content !== lastSavedContent());
        emitContentChange(content);
    };

    const doSave = async () => {
        const content = viewMode() === 'source' ? syncSourceToWysiwyg() : syncFromWysiwyg();
        const filePath = currentFilePath();

        if (filePath) {
            await saveToFile(filePath, content);
            setLastSavedContent(content);
            setIsModified(false);
            setErrorMessage('');
            props.onFilePathChange?.(filePath);
            return;
        }
    };

    const triggerAutoSave = () => {
        if (!autoSaveEnabled()) return;
        if (!currentFilePath()) return;
        if (!isModified()) return;
        if (autoSaveTimer) clearTimeout(autoSaveTimer);
        autoSaveTimer = setTimeout(() => {
            autoSaveTimer = null;
            doSave();
        }, 2000);
    };

    const syncFromWysiwyg = () => {
        if (!editorHandle) return markdownContent();
        const content = editorHandle.getMarkdown();
        updateMarkdownState(content);
        triggerAutoSave();
        return content;
    };

    const syncSourceToWysiwyg = () => {
        const content = sourceContent();
        if (editorHandle) {
            isProgrammaticChange = true;
            editorHandle.setMarkdown(content);
            isProgrammaticChange = false;
        }
        updateMarkdownState(content);
        return content;
    };

    const confirmDiscardChanges = () => {
        if (!isModified()) return true;
        return window.confirm(t('file.confirmDiscard'));
    };

    const setLoadedDocument = (content: string, filePath: string | null) => {
        isProgrammaticChange = true;
        if (editorHandle) {
            editorHandle.setMarkdown(content);
        }
        isProgrammaticChange = false;
        const canonicalContent = editorHandle?.getMarkdown() ?? content;
        setCurrentFilePath(filePath);
        setLastSavedContent(canonicalContent);
        setMarkdownContent(canonicalContent);
        setSourceContent(canonicalContent);
        setIsModified(false);
        setErrorMessage('');
        emitContentChange(canonicalContent);
        props.onFilePathChange?.(filePath);
        if (viewMode() === 'source') {
            setTimeout(() => sourceTextArea?.focus(), 0);
        } else {
            setTimeout(() => {
                editorHandle?.focus();
                fixWysiwygImages();
            }, 0);
        }
    };

    const loadFileFromPath = async (filePath: string) => {
        const cleanedPath = filePath.trim().replace(/^["']|["']$/g, '');
        if (!cleanedPath || cleanedPath === currentFilePath()) return;
        if (!confirmDiscardChanges()) return;

        const lowerPath = cleanedPath.toLowerCase();
        const isTextFile = lowerPath.endsWith('.txt') ||
            lowerPath.endsWith('.md') ||
            lowerPath.endsWith('.markdown');

        if (!isTextFile) {
            setErrorMessage(t('file.onlyMdTxt'));
            return;
        }

        try {
            const { readTextFile } = await import('@tauri-apps/plugin-fs');
            const content = await readTextFile(cleanedPath);
            setLoadedDocument(content, cleanedPath);
        } catch (error) {
            console.error(t('file.loadFailed') + ':', error);
            setErrorMessage(`${t('file.loadFailed')}：${error instanceof Error ? error.message : String(error)}`);
        }
    };

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

        if (
            trimmedSrc.startsWith('http://') ||
            trimmedSrc.startsWith('https://') ||
            trimmedSrc.startsWith('data:') ||
            trimmedSrc.startsWith('blob:') ||
            trimmedSrc.startsWith('asset:')
        ) {
            return null;
        }

        const isWindowsPath = /^[a-zA-Z]:[\\/]/.test(trimmedSrc) || /^[a-zA-Z]:[\\/]/.test(decodedSrc);
        const isUnixAbsPath = trimmedSrc.startsWith('/') || decodedSrc.startsWith('/');
        const isFileUrl = trimmedSrc.startsWith('file://');
        let resolvedPath = decodedSrc;

        if (isFileUrl) {
            resolvedPath = decodeURIComponent(trimmedSrc.replace(/^file:\/+/, ''));
        } else if (!isWindowsPath && !isUnixAbsPath) {
            if (!baseFilePath) return null;
            const separator = /^[a-zA-Z]:[\\/]/.test(baseFilePath) ? '\\' : '/';
            const baseDir = baseFilePath.replace(/[\\/][^\\/]*$/, '');
            resolvedPath = `${baseDir.replace(/[\\/]+$/, '')}${separator}${resolvedPath.replace(/^[\\/]+/, '')}`;
        }

        return resolvedPath ? convertFileSrc(resolvedPath) : null;
    };

    const fixWysiwygImages = () => {
        if (!milkdownRoot) return;
        const baseFilePath = currentFilePath();
        setTimeout(() => {
            const images = milkdownRoot?.querySelectorAll('img') || [];
            images.forEach((img) => {
                const originalSrc = img.getAttribute('data-original-src') || img.getAttribute('src') || '';
                const convertedSrc = resolveLocalImageSrc(originalSrc, baseFilePath);
                if (convertedSrc && img.src !== convertedSrc) {
                    img.setAttribute('data-original-src', originalSrc);
                    img.src = convertedSrc;
                }
            });
        }, 50);
    };

    const insertMarkdownAtCursor = (markdown: string) => {
        if (viewMode() === 'source') {
            const current = sourceContent();
            const start = sourceTextArea?.selectionStart ?? current.length;
            const end = sourceTextArea?.selectionEnd ?? current.length;
            const next = `${current.slice(0, start)}${markdown}${current.slice(end)}`;
            setSourceContent(next);
            updateMarkdownState(next, { preserveSource: true });
            triggerAutoSave();
            setTimeout(() => {
                if (!sourceTextArea) return;
                const cursor = start + markdown.length;
                sourceTextArea.selectionStart = cursor;
                sourceTextArea.selectionEnd = cursor;
                sourceTextArea.focus();
            }, 0);
            return;
        }

        editorHandle?.insertMarkdown(markdown);
        fixWysiwygImages();
    };

    const handleImageInsert = async (file: File) => {
        if (imagePasteMode() === 'base64') {
            const dataUrl = await readFileAsDataUrl(file);
            insertMarkdownAtCursor(`![${file.name || 'image'}](${dataUrl})`);
            return;
        }

        const mdPath = currentFilePath();
        if (!mdPath) {
            const dataUrl = await readFileAsDataUrl(file);
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
            console.error(t('image.pasteFailed') + ':', error);
            setErrorMessage(`${t('image.pasteFailed')}：${error instanceof Error ? error.message : String(error)}`);
        }
    };

    const handleDropEvent = async (event: DragEvent) => {
        const files = Array.from(event.dataTransfer?.files || []).filter(file => file.type.startsWith('image/'));
        if (files.length === 0) return;
        event.preventDefault();
        try {
            for (const file of files) {
                await handleImageInsert(file);
            }
        } catch (error) {
            console.error(t('image.dropFailed') + ':', error);
            setErrorMessage(`${t('image.dropFailed')}：${error instanceof Error ? error.message : String(error)}`);
        }
    };

    const handleDragOverEvent = (event: DragEvent) => {
        event.preventDefault();
    };

    const switchViewMode = (nextMode: ViewMode) => {
        if (viewMode() === nextMode) return;
        if (viewMode() === 'wysiwyg') {
            syncFromWysiwyg();
        } else {
            syncSourceToWysiwyg();
        }
        setViewMode(nextMode);
        setTimeout(() => {
            if (nextMode === 'source') {
                sourceTextArea?.focus();
            } else {
                editorHandle?.focus();
                fixWysiwygImages();
            }
        }, 0);
    };

    const toggleViewMode = () => {
        switchViewMode(viewMode() === 'wysiwyg' ? 'source' : 'wysiwyg');
    };

    const handleOpenFile = async () => {
        if (!confirmDiscardChanges()) return;
        try {
            const result = await openFile();
            if (!result) return;
            setLoadedDocument(result.content, result.path);
        } catch (error) {
            console.error(t('file.loadFailed') + ':', error);
            setErrorMessage(`${t('file.loadFailed')}：${error instanceof Error ? error.message : String(error)}`);
        }
    };

    const handleSaveFile = async () => {
        try {
            const content = viewMode() === 'source' ? syncSourceToWysiwyg() : syncFromWysiwyg();
            const filePath = currentFilePath();

            if (filePath) {
                await saveToFile(filePath, content);
                setLastSavedContent(content);
                setIsModified(false);
                setErrorMessage('');
                props.onFilePathChange?.(filePath);
                return;
            }

            const savedPath = await saveFile(content);
            if (savedPath) {
                setCurrentFilePath(savedPath);
                setLastSavedContent(content);
                setIsModified(false);
                setErrorMessage('');
                props.onFilePathChange?.(savedPath);
                fixWysiwygImages();
            }
        } catch (error) {
            console.error(t('file.saveFailed') + ':', error);
            setIsModified(true);
            setErrorMessage(`${t('file.saveFailed')}：${error instanceof Error ? error.message : String(error)}`);
        }
    };

    const handleSaveAsFile = async () => {
        try {
            const content = viewMode() === 'source' ? syncSourceToWysiwyg() : syncFromWysiwyg();
            const savedPath = await saveFile(content, currentFilePath() || undefined);
            if (savedPath) {
                setCurrentFilePath(savedPath);
                setLastSavedContent(content);
                setIsModified(false);
                setErrorMessage('');
                props.onFilePathChange?.(savedPath);
                fixWysiwygImages();
            }
        } catch (error) {
            console.error(t('file.saveAsFailed') + ':', error);
            setIsModified(true);
            setErrorMessage(`${t('file.saveAsFailed')}：${error instanceof Error ? error.message : String(error)}`);
        }
    };

    const handleExport = async (format: 'word' | 'pdf' | 'png' | 'html') => {
        try {
            setIsExporting(true);
            setExportProgress(0);
            setExportMessage(t('export.progressTitle'));
            setShowExportMenu(false);

            const content = viewMode() === 'source' ? syncSourceToWysiwyg() : syncFromWysiwyg();
            const fileName = getFileName().replace(/\.[^/.]+$/, '') || 'Document';

            await exportFile(
                format,
                content,
                fileName,
                ((progress: number, message: string) => {
                    setExportProgress(progress);
                    setExportMessage(message);
                }) as ExportProgressCallback
            );
            setErrorMessage('');
        } catch (error) {
            console.error(t('export.failed') + ':', error);
            setErrorMessage(`${t('export.failed')}：${error instanceof Error ? error.message : String(error)}`);
        } finally {
            setIsExporting(false);
            setExportProgress(0);
            setExportMessage('');
        }
    };

    const performSearch = (term: string) => {
        const content = viewMode() === 'source' ? sourceContent() : markdownContent();
        if (!term) {
            setSearchResults([]);
            setSearchIndex(0);
            return;
        }
        const indices: number[] = [];
        const lowerContent = content.toLowerCase();
        const lowerTerm = term.toLowerCase();
        let idx = 0;
        while ((idx = lowerContent.indexOf(lowerTerm, idx)) !== -1) {
            indices.push(idx);
            idx += term.length;
        }
        setSearchResults(indices);
        setSearchIndex(indices.length > 0 ? 1 : 0);
    };

    const scrollToSearchResult = (index: number) => {
        const results = searchResults();
        if (results.length === 0) return;
        const content = viewMode() === 'source' ? sourceContent() : markdownContent();
        const pos = results[index];

        if (viewMode() === 'source' && sourceTextArea) {
            sourceTextArea.focus();
            sourceTextArea.setSelectionRange(pos, pos + searchTerm().length);
            const lines = content.slice(0, pos).split('\n').length;
            sourceTextArea.scrollTop = Math.max(0, (lines - 5) * 24);
        } else if (viewMode() === 'wysiwyg') {
            const contentBefore = content.slice(0, pos);
            const headingCount = (contentBefore.match(/^#{1,6}\s/gm) || []).length;
            const heading = milkdownRoot?.querySelector(`h${Math.min(6, headingCount + 1)}, p, li, td, th`);
            if (heading instanceof HTMLElement) {
                heading.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    };

    const handleSearchNext = () => {
        const results = searchResults();
        if (results.length === 0) return;
        const next = searchIndex() >= results.length ? 1 : searchIndex() + 1;
        setSearchIndex(next);
        scrollToSearchResult(next - 1);
    };

    const handleSearchPrev = () => {
        const results = searchResults();
        if (results.length === 0) return;
        const prev = searchIndex() <= 1 ? results.length : searchIndex() - 1;
        setSearchIndex(prev);
        scrollToSearchResult(prev - 1);
    };

    const handleReplace = () => {
        const results = searchResults();
        if (results.length === 0) return;
        const idx = searchIndex() - 1;
        const content = viewMode() === 'source' ? sourceContent() : markdownContent();
        const pos = results[idx];
        const term = searchTerm();
        const replacement = replaceTerm();
        const newContent = content.slice(0, pos) + replacement + content.slice(pos + term.length);

        if (viewMode() === 'source') {
            setSourceContent(newContent);
            updateMarkdownState(newContent, { preserveSource: true });
        } else if (editorHandle) {
            isProgrammaticChange = true;
            editorHandle.setMarkdown(newContent);
            isProgrammaticChange = false;
            updateMarkdownState(newContent);
        }
        triggerAutoSave();
        setSearchTerm('');
        setReplaceTerm('');
        setSearchVisible(false);
    };

    const handleReplaceAll = () => {
        const term = searchTerm();
        const replacement = replaceTerm();
        if (!term) return;
        const content = viewMode() === 'source' ? sourceContent() : markdownContent();
        const newContent = term.startsWith('/') && term.endsWith('/')
            ? content.replace(new RegExp(term.slice(1, -1), 'g'), replacement)
            : content.split(term).join(replacement);

        if (viewMode() === 'source') {
            setSourceContent(newContent);
            updateMarkdownState(newContent, { preserveSource: true });
        } else if (editorHandle) {
            isProgrammaticChange = true;
            editorHandle.setMarkdown(newContent);
            isProgrammaticChange = false;
            updateMarkdownState(newContent);
        }
        triggerAutoSave();
        setSearchVisible(false);
    };

    const openSearch = () => {
        setSearchVisible(true);
    };

    const closeSearch = () => {
        setSearchVisible(false);
        setSearchTerm('');
        setReplaceTerm('');
        setSearchResults([]);
        setSearchIndex(0);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
        const activeEl = document.activeElement;
        const isSearchInput = activeEl?.closest('.search-row');

        if (e.key === 'Escape') {
            closeSearch();
            return;
        }

        if (isSearchInput) {
            if (e.key === 'Enter' && e.shiftKey) {
                e.preventDefault();
                handleSearchPrev();
                return;
            }
            if (e.key === 'Enter') {
                e.preventDefault();
                handleSearchNext();
                return;
            }
            return;
        }

        if (e.key === 'F5' || (e.ctrlKey && (e.key === 'r' || e.key === 'R'))) {
            e.preventDefault();
        } else if (e.ctrlKey && e.key === '/') {
            e.preventDefault();
            toggleViewMode();
        } else if (e.ctrlKey && (e.key === 'o' || e.key === 'O')) {
            e.preventDefault();
            handleOpenFile();
        } else if (e.ctrlKey && (e.key === 's' || e.key === 'S')) {
            e.preventDefault();
            handleSaveFile();
        } else if (e.ctrlKey && (e.key === 'f' || e.key === 'F')) {
            e.preventDefault();
            openSearch();
        }
    };

    const handleClickOutside = (event: MouseEvent) => {
        const target = event.target as HTMLElement;
        if (!target.closest('.export-menu-container')) {
            setShowExportMenu(false);
        }
    };

    const closeSettings = () => {
        setShowSettings(false);
    };

    const getFileName = () => {
        const path = currentFilePath();
        if (!path) return t('file.unnamed');
        const parts = path.split(/[/\\]/);
        return parts[parts.length - 1] || t('file.unnamed');
    };

    const jumpToLine = (lineNumber: number, headingText?: string) => {
        if (viewMode() === 'source') {
            const content = sourceContent();
            const offset = getLineStartOffset(content, lineNumber);
            setTimeout(() => {
                if (!sourceTextArea) return;
                sourceTextArea.focus();
                sourceTextArea.selectionStart = offset;
                sourceTextArea.selectionEnd = offset;
                const lines = content.slice(0, offset).split('\n').length;
                sourceTextArea.scrollTop = Math.max(0, (lines - 3) * 24);
            }, 0);
            return;
        }

        const headings = milkdownRoot?.querySelectorAll('h1, h2, h3, h4, h5, h6') || [];
        const markdownHeadings = markdownContent()
            .split('\n')
            .map((line, index) => ({ line, lineNumber: index + 1 }))
            .filter(({ line }) => /^(#{1,6})\s+/.test(line.trim()));
        const targetIndex = markdownHeadings.findIndex(item => item.lineNumber === lineNumber);
        const targetByIndex = targetIndex >= 0 ? headings[targetIndex] : null;
        const targetByText = headingText
            ? Array.from(headings).find(heading => heading.textContent?.trim() === headingText)
            : null;
        const target = targetByIndex || targetByText;

        if (target instanceof HTMLElement) {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            target.classList.add('heading-highlight');
            setTimeout(() => target.classList.remove('heading-highlight'), 1000);
        }
    };

    onMount(() => {
        window.addEventListener('keydown', handleKeyDown);
        document.addEventListener('click', handleClickOutside);

        if (milkdownRoot) {
            milkdownRoot.addEventListener('paste', handlePasteEvent);
            milkdownRoot.addEventListener('drop', handleDropEvent);
            milkdownRoot.addEventListener('dragover', handleDragOverEvent);

            createMilkdownHandle(milkdownRoot, markdownContent(), (markdown) => {
                if (isProgrammaticChange) return;
                updateMarkdownState(markdown);
                fixWysiwygImages();
                triggerAutoSave();
            })
                .then((handle) => {
                    editorHandle = handle;
                    const canonicalContent = handle.getMarkdown();
                    setLastSavedContent(canonicalContent);
                    setMarkdownContent(canonicalContent);
                    setSourceContent(canonicalContent);
                    setIsModified(false);
                    emitContentChange(canonicalContent);
                    setIsEditorReady(true);
                    fixWysiwygImages();
                    if (props.initialFilePath && props.initialFilePath !== currentFilePath()) {
                        loadedInitialPath = props.initialFilePath;
                        loadFileFromPath(props.initialFilePath);
                    }
                })
                .catch((error) => {
                    console.error(t('editor.initFailed') + ':', error);
                    setErrorMessage(`${t('editor.initFailed')}：${error instanceof Error ? error.message : String(error)}`);
                });
        }
    });

    onCleanup(() => {
        window.removeEventListener('keydown', handleKeyDown);
        document.removeEventListener('click', handleClickOutside);
        if (autoSaveTimer) clearTimeout(autoSaveTimer);
        if (milkdownRoot) {
            milkdownRoot.removeEventListener('paste', handlePasteEvent);
            milkdownRoot.removeEventListener('drop', handleDropEvent);
            milkdownRoot.removeEventListener('dragover', handleDragOverEvent);
        }
        editorHandle?.destroy();
        editorHandle = null;
    });

    createEffect(() => {
        const filePath = props.initialFilePath;
        if (!filePath || filePath === loadedInitialPath || filePath === lastRequestedPath) return;
        lastRequestedPath = filePath;
        if (isEditorReady()) {
            loadedInitialPath = filePath;
            loadFileFromPath(filePath);
        }
    });

    createEffect(() => {
        if (progressBarElement) {
            progressBarElement.style.width = `${exportProgress()}%`;
        }
    });

    createEffect(() => {
        (window as any).__editorJumpToLine = jumpToLine;
    });

    createEffect(() => {
        currentFilePath();
        markdownContent();
        if (viewMode() === 'wysiwyg') {
            fixWysiwygImages();
        }
    });

    return (
        <div class="editor-container" style={{ position: 'relative' }}>
            <div class="editor-header">
                <div class="header-left">
                    <h1>{t('app.title')}</h1>
                    <span class="file-name" title={currentFilePath() || ''}>
                        {getFileName()}
                        {isModified() && <span class="modified-indicator"> *</span>}
                    </span>
                    <Show when={errorMessage()}>
                        <span class="editor-error" title={errorMessage()}>{errorMessage()}</span>
                    </Show>
                </div>
                <div class="header-right">
                    <div class="file-actions">
                        <button class="file-btn" onClick={handleOpenFile} title={t('file.openTitle')}>{t('file.open')}</button>
                        <button class="file-btn" onClick={handleSaveFile} title={t('file.saveTitle')}>{t('file.save')}</button>
                        <button class="file-btn" onClick={handleSaveAsFile} title={t('file.saveAsTitle')}>{t('file.saveAs')}</button>
                        <div class="export-menu-container">
                            <button class="file-btn" onClick={() => setShowExportMenu(!showExportMenu())} title={t('file.exportTitle')}>
                                {t('file.export')}
                            </button>
                            {showExportMenu() && (
                                <div class="export-menu">
                                    <button class="export-menu-item" onClick={() => handleExport('word')}>{t('export.word')}</button>
                                    <button class="export-menu-item" onClick={() => handleExport('pdf')}>{t('export.pdf')}</button>
                                    <button class="export-menu-item" onClick={() => handleExport('png')}>{t('export.png')}</button>
                                    <button class="export-menu-item" onClick={() => handleExport('html')}>{t('export.html')}</button>
                                </div>
                            )}
                        </div>
                    </div>
                    <button class="file-btn" onClick={() => setShowSettings(true)} title={t('settings.title')}>{t('settings.title')}</button>
                </div>
            </div>

            <Show when={searchVisible()}>
                <div class="search-dialog">
                    <div class="search-row">
                        <input
                            type="text"
                            placeholder={t('search.find')}
                            value={searchTerm()}
                            onInput={(e) => {
                                setSearchTerm(e.currentTarget.value);
                                performSearch(e.currentTarget.value);
                            }}
                            autofocus
                        />
                        <div class="search-actions">
                            <button class="search-btn" onClick={handleSearchPrev} disabled={searchResults().length === 0} title={t('search.prev')}>&#9664;</button>
                            <button class="search-btn" onClick={handleSearchNext} disabled={searchResults().length === 0} title={t('search.next')}>&#9654;</button>
                            <button class="search-btn" onClick={closeSearch} title="">&#10005;</button>
                        </div>
                    </div>
                    <div class="search-row">
                        <input
                            type="text"
                            placeholder={t('search.replace')}
                            value={replaceTerm()}
                            onInput={(e) => setReplaceTerm(e.currentTarget.value)}
                        />
                        <div class="search-actions">
                            <button class="search-btn" onClick={handleReplace} disabled={searchResults().length === 0}>{t('search.replace')}</button>
                            <button class="search-btn" onClick={handleReplaceAll} disabled={!searchTerm()}>{t('search.replaceAll')}</button>
                        </div>
                    </div>
                    <Show when={searchTerm() && searchResults().length > 0}>
                        <div class="search-info">
                            {t('search.count', { count: searchResults().length })} &middot; {searchIndex()}/{searchResults().length}
                        </div>
                    </Show>
                    <Show when={searchTerm() && searchResults().length === 0}>
                        <div class="search-info">{t('search.noResults')}</div>
                    </Show>
                </div>
            </Show>

            <div class="editor-body">
                <div ref={milkdownRoot} class={`milkdown-host ${viewMode() === 'wysiwyg' ? 'active' : 'hidden'}`} />
                <textarea
                    ref={sourceTextArea}
                    class={`source-editor ${viewMode() === 'source' ? 'active' : 'hidden'}`}
                    value={sourceContent()}
                    spellcheck={false}
                    onInput={(event) => {
                        const content = event.currentTarget.value;
                        setSourceContent(content);
                        updateMarkdownState(content, { preserveSource: true });
                        triggerAutoSave();
                    }}
                />
            </div>

            {isExporting() && (
                <div class="export-progress-overlay">
                    <div class="export-progress-dialog">
                        <div class="export-progress-title">{t('export.progressTitle')}</div>
                        <div class="export-progress-bar-container">
                            <div ref={progressBarElement} class="export-progress-bar" />
                        </div>
                        <div class="export-progress-message">{exportMessage()}</div>
                        <div class="export-progress-percent">{exportProgress()}%</div>
                    </div>
                </div>
            )}

            {showSettings() && (
                <div class="settings-overlay" onClick={closeSettings}>
                    <div class="settings-dialog" onClick={(e) => e.stopPropagation()}>
                        <div class="settings-title">{t('settings.title')}</div>

                        <div class="settings-row">
                            <div class="settings-label">{t('settings.imagePaste')}</div>
                            <select
                                class="settings-select"
                                value={imagePasteMode()}
                                onChange={(e) => {
                                    const value = (e.currentTarget.value as ImagePasteMode) || 'base64';
                                    setImagePasteMode(value);
                                    localStorage.setItem('imagePasteMode', value);
                                }}
                            >
                                <option value="base64">{t('settings.imagePaste.base64')}</option>
                                <option value="relative">{t('settings.imagePaste.relative')}</option>
                            </select>
                        </div>

                        <div class="settings-row">
                            <div class="settings-label">{t('settings.autoSave')}</div>
                            <select
                                class="settings-select"
                                value={autoSaveEnabled() ? 'enabled' : 'disabled'}
                                onChange={(e) => {
                                    const enabled = e.currentTarget.value === 'enabled';
                                    setAutoSaveEnabled(enabled);
                                    localStorage.setItem('autoSave', String(enabled));
                                }}
                            >
                                <option value="enabled">{t('settings.autoSaveEnabled')}</option>
                                <option value="disabled">{t('settings.autoSaveDisabled')}</option>
                            </select>
                        </div>

                        <div class="settings-row">
                            <div class="settings-label">{t('settings.theme')}</div>
                            <select
                                class="settings-select"
                                value={currentTheme()}
                                onChange={(e) => {
                                    const theme = e.currentTarget.value;
                                    setCurrentTheme(theme);
                                    applyTheme(theme);
                                }}
                            >
                                <option value="light">{t('settings.theme.light')}</option>
                                <option value="dark">{t('settings.theme.dark')}</option>
                            </select>
                        </div>

                        <div class="settings-row">
                            <div class="settings-label">{t('settings.language')}</div>
                            <select
                                class="settings-select"
                                value={getLocale()}
                                onChange={(e) => {
                                    setLocale(e.currentTarget.value as 'zh-CN' | 'en-US');
                                }}
                            >
                                <option value="zh-CN">{t('settings.language.zh')}</option>
                                <option value="en-US">{t('settings.language.en')}</option>
                            </select>
                        </div>

                        <div class="settings-actions">
                            <button class="file-btn" onClick={closeSettings}>{t('settings.close')}</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Editor;
