import { Component, createEffect, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
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
import { highlightMarkdown } from '../utils/markdownHighlight';
import { convertFileSrc } from '@tauri-apps/api/core';
import { mkdir, writeFile } from '@tauri-apps/plugin-fs';
import { t, getLocale, setLocale } from '../utils/i18n';

type ViewMode = 'wysiwyg' | 'source';
type ImagePasteMode = 'base64' | 'relative';

interface MarkdownEditorHandle { getMarkdown(): string; setMarkdown(markdown: string): void; insertMarkdown(markdown: string): void; focus(): void; destroy(): void; }

interface EditorProps { onContentChange?: (content: string) => void; onHeadingClick?: (lineNumber: number, headingText?: string) => void; initialFilePath?: string | null; onFilePathChange?: (filePath: string | null) => void; }

interface TabDoc { path: string | null; content: string; savedContent: string; }

const DEFAULT_MARKDOWN = '';

const readFileAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); });
const getFileBaseName = (filePath: string) => { const parts = filePath.split(/[/\\]/); const name = parts[parts.length - 1] || 'document'; return name.replace(/\.[^/.]+$/, '') || 'document'; };
const getFileDir = (filePath: string) => filePath.replace(/[\\/][^\\/]*$/, '');
const getTabName = (doc: TabDoc) => { if (!doc.path) return t('file.unnamed'); const parts = doc.path.split(/[/\\]/); return parts[parts.length - 1] || t('file.unnamed'); };
const getLineStartOffset = (content: string, lineNumber: number) => { const tl = Math.max(1, lineNumber); if (tl === 1) return 0; let ln = 1; for (let i = 0; i < content.length; i++) { if (content[i] === '\n') { ln++; if (ln === tl) return i + 1; } } return content.length; };
const getWords = (t: string) => (t.trim() ? t.trim().split(/\s+/).length : 0);
const getLines = (t: string) => (t ? t.split('\n').length : 0);

const createMilkdownHandle = async (root: HTMLElement, initialMarkdown: string, onMarkdownChange: (md: string) => void): Promise<MarkdownEditorHandle> => {
    let latest = initialMarkdown;
    const editor = await MilkdownEditor.make().config((ctx) => { ctx.set(rootCtx, root); ctx.set(defaultValueCtx, initialMarkdown); ctx.get(listenerCtx).markdownUpdated((_ctx, md) => { latest = md; onMarkdownChange(md); }); }).use(commonmark).use(gfm).use(history).use(clipboard).use(listener).use(trailing).use(math).use(diagram).use(prism).create();
    return { getMarkdown() { try { latest = editor.action(getMarkdown()); } catch {} return latest; }, setMarkdown(md: string) { latest = md; editor.action(replaceAll(md, true)); }, insertMarkdown(md: string) { editor.action(insert(md)); latest = editor.action(getMarkdown()); onMarkdownChange(latest); }, focus() { root.querySelector<HTMLElement>('.ProseMirror')?.focus(); }, destroy() { editor.destroy(); } };
};

const applyTheme = (theme: string) => { document.documentElement.setAttribute('data-theme', theme); localStorage.setItem('theme', theme); };

const Editor: Component<EditorProps> = (props) => {
    let milkdownRoot: HTMLDivElement | undefined;
    let sourceTextArea: HTMLTextAreaElement | undefined;
    let sourceHighlight: HTMLPreElement | undefined;
    let progressBarElement: HTMLDivElement | undefined;
    let commandInput: HTMLInputElement | undefined;
    let editorHandle: MarkdownEditorHandle | null = null;
    let loadedInitialPath: string | null = null;
    let isProgrammaticChange = false;
    let lastRequestedPath: string | null = null;
    let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;

    const [viewMode, setViewMode] = createSignal<ViewMode>('wysiwyg');
    const [tabs, setTabs] = createSignal<TabDoc[]>([{ path: null, content: DEFAULT_MARKDOWN, savedContent: DEFAULT_MARKDOWN }]);
    const [activeTab, setActiveTab] = createSignal(0);
    const [showExportMenu, setShowExportMenu] = createSignal(false);
    const [isExporting, setIsExporting] = createSignal(false);
    const [exportProgress, setExportProgress] = createSignal(0);
    const [exportMessage, setExportMessage] = createSignal('');
    const [showSettings, setShowSettings] = createSignal(false);
    const [errorMessage, setErrorMessage] = createSignal('');
    const [isEditorReady, setIsEditorReady] = createSignal(false);
    const [imagePasteMode, setImagePasteMode] = createSignal<ImagePasteMode>((localStorage.getItem('imagePasteMode') as ImagePasteMode) || 'base64');
    const [autoSaveEnabled, setAutoSaveEnabled] = createSignal(localStorage.getItem('autoSave') !== 'false');
    const [currentTheme, setCurrentTheme] = createSignal(localStorage.getItem('theme') || 'light');
    const [searchVisible, setSearchVisible] = createSignal(false);
    const [searchTerm, setSearchTerm] = createSignal('');
    const [replaceTerm, setReplaceTerm] = createSignal('');
    const [searchIndex, setSearchIndex] = createSignal(0);
    const [searchResults, setSearchResults] = createSignal<number[]>([]);
    const [isFocusMode, setIsFocusMode] = createSignal(false);
    const [showPalette, setShowPalette] = createSignal(false);
    const [paletteSearch, setPaletteSearch] = createSignal('');
    const [showHelp, setShowHelp] = createSignal(false);

    const doc = () => tabs()[activeTab()] || tabs()[0];
    const mk = () => doc().content;
    const src = () => doc().content;
    const fp = () => doc().path;
    const svd = () => doc().savedContent;
    const upd = (partial: Partial<TabDoc>) => setTabs(prev => { const n = [...prev]; const i = activeTab(); if (n[i]) n[i] = { ...n[i], ...partial }; return n; });

    const createTab = (d: TabDoc) => { const idx = tabs().length; setTabs(prev => [...prev, d]); setActiveTab(idx); return idx; };
    const closeTab = (i: number) => { if (tabs().length <= 1) return; setTabs(prev => prev.filter((_, j) => j !== i)); if (i <= activeTab()) setActiveTab(prev => Math.max(0, prev - 1)); };

    createEffect(() => { props.onContentChange?.(mk()); });

    const doSave = async () => { const c = mk(); const p = fp(); if (p) { await saveToFile(p, c); upd({ savedContent: c }); setErrorMessage(''); } };
    const triggerAutoSave = () => { if (!autoSaveEnabled() || !fp()) return; if (mk() === svd()) return; if (autoSaveTimer) clearTimeout(autoSaveTimer); autoSaveTimer = setTimeout(() => { autoSaveTimer = null; doSave(); }, 2000); };

    const syncFromWysiwyg = () => { if (!editorHandle) return mk(); const c = editorHandle.getMarkdown(); upd({ content: c }); triggerAutoSave(); return c; };
    const syncSourceToWysiwyg = () => { const c = src(); if (editorHandle) { isProgrammaticChange = true; editorHandle.setMarkdown(c); isProgrammaticChange = false; } upd({ content: c }); return c; };

    const setLoadedDocument = (content: string, path: string | null) => {
        isProgrammaticChange = true; if (editorHandle) editorHandle.setMarkdown(content); isProgrammaticChange = false;
        const cc = editorHandle?.getMarkdown() ?? content;
        upd({ path, content: cc, savedContent: cc }); setErrorMessage(''); props.onFilePathChange?.(path);
        if (viewMode() === 'source') setTimeout(() => sourceTextArea?.focus(), 0);
        else setTimeout(() => { editorHandle?.focus(); fixWysiwygImages(); }, 0);
    };

    const loadFileFromPath = async (filePath: string) => {
        const p = filePath.trim().replace(/^["']|["']$/g, '');
        if (!p) return;
        const lp = p.toLowerCase();
        if (!lp.endsWith('.md') && !lp.endsWith('.markdown') && !lp.endsWith('.txt')) { setErrorMessage(t('file.onlyMdTxt')); return; }
        const ei = tabs().findIndex(t => t.path === p);
        if (ei >= 0) { setActiveTab(ei); return; }
        if (fp() || mk() !== svd()) createTab({ path: null, content: DEFAULT_MARKDOWN, savedContent: DEFAULT_MARKDOWN });
        try {
            const { readTextFile } = await import('@tauri-apps/plugin-fs');
            const c = await readTextFile(p);
            upd({ path: p, content: c, savedContent: c });
            setLoadedDocument(c, p);
        } catch { setErrorMessage(t('file.loadFailed')); }
    };

    const resolveLocalImageSrc = (s: string, base: string | null) => {
        const t = s.trim(); if (!t) return null;
        const d = (() => { try { return decodeURIComponent(t); } catch { return t; } })();
        if (t.startsWith('http://') || t.startsWith('https://') || t.startsWith('data:') || t.startsWith('blob:') || t.startsWith('asset:')) return null;
        const win = /^[a-zA-Z]:[\\/]/.test(t) || /^[a-zA-Z]:[\\/]/.test(d);
        const unx = t.startsWith('/') || d.startsWith('/');
        const fur = t.startsWith('file://');
        let r = d;
        if (fur) r = decodeURIComponent(t.replace(/^file:\/+/, ''));
        else if (!win && !unx) { if (!base) return null; const sep = /^[a-zA-Z]:[\\/]/.test(base) ? '\\' : '/'; r = `${base.replace(/[\\/][^\\/]*$/, '').replace(/[\\/]+$/, '')}${sep}${r.replace(/^[\\/]+/, '')}`; }
        return r ? convertFileSrc(r) : null;
    };

    const fixWysiwygImages = () => { if (!milkdownRoot) return; const b = fp(); setTimeout(() => { milkdownRoot?.querySelectorAll('img').forEach(img => { const o = img.getAttribute('data-original-src') || img.getAttribute('src') || ''; const cnv = resolveLocalImageSrc(o, b); if (cnv && img.src !== cnv) { img.setAttribute('data-original-src', o); img.src = cnv; } }); }, 50); };

    const syncSourceScroll = () => { if (!sourceTextArea || !sourceHighlight) return; sourceHighlight.scrollTop = sourceTextArea.scrollTop; sourceHighlight.scrollLeft = sourceTextArea.scrollLeft; };

    const insertMarkdownAtCursor = (md: string) => {
        if (viewMode() === 'source') {
            const c = src(); const s = sourceTextArea?.selectionStart ?? c.length; const e = sourceTextArea?.selectionEnd ?? c.length;
            const n = `${c.slice(0, s)}${md}${c.slice(e)}`; upd({ content: n }); triggerAutoSave();
            setTimeout(() => { if (!sourceTextArea) return; const pos = s + md.length; sourceTextArea.selectionStart = pos; sourceTextArea.selectionEnd = pos; sourceTextArea.focus(); }, 0);
            return;
        } editorHandle?.insertMarkdown(md); fixWysiwygImages();
    };

    const handleImageInsert = async (file: File) => {
        if (imagePasteMode() === 'base64') { insertMarkdownAtCursor(`![${file.name || 'image'}](${await readFileAsDataUrl(file)})`); return; }
        const p = fp(); if (!p) { insertMarkdownAtCursor(`![${file.name || 'image'}](${await readFileAsDataUrl(file)})`); return; }
        const dir = getFileDir(p); const bn = getFileBaseName(p); const fld = `${dir}\\${bn}`; await mkdir(fld, { recursive: true });
        const fn = file.name && file.name !== 'image.png' ? file.name : `image-${Date.now()}.${(file.type.split('/')[1] || 'png').replace(/[^a-z0-9]+/gi, '')}`;
        await writeFile(`${fld}\\${fn}`, new Uint8Array(await file.arrayBuffer()));
        insertMarkdownAtCursor(`![${file.name || fn}](${(bn + '/' + fn).replace(/\\/g, '/')})`);
    };

    const handlePasteEvent = async (e: ClipboardEvent) => { const items = e.clipboardData?.items; if (!items) return; const img = Array.from(items).find(it => it.type.startsWith('image/')); if (!img) return; const f = img.getAsFile(); if (!f) return; e.preventDefault(); try { await handleImageInsert(f); } catch (err) { setErrorMessage(`${t('image.pasteFailed')}：${err instanceof Error ? err.message : String(err)}`); } };
    const handleDropEvent = async (e: DragEvent) => { const imgs = Array.from(e.dataTransfer?.files || []).filter(f => f.type.startsWith('image/')); if (!imgs.length) return; e.preventDefault(); try { for (const f of imgs) await handleImageInsert(f); } catch (err) { setErrorMessage(`${t('image.dropFailed')}：${err instanceof Error ? err.message : String(err)}`); } };
    const handleDragOver = (e: DragEvent) => { e.preventDefault(); };

    const switchViewMode = (m: ViewMode) => { if (viewMode() === m) return; if (viewMode() === 'wysiwyg') syncFromWysiwyg(); else syncSourceToWysiwyg(); setViewMode(m); setTimeout(() => { if (m === 'source') sourceTextArea?.focus(); else { editorHandle?.focus(); fixWysiwygImages(); } }, 0); };

    const handleOpenFile = async () => { try { const r = await openFile(); if (r) loadFileFromPath(r.path); } catch { setErrorMessage(t('file.loadFailed')); } };
    const handleSaveFile = async () => { try { const c = viewMode() === 'source' ? syncSourceToWysiwyg() : syncFromWysiwyg(); const p = fp(); if (p) { await saveToFile(p, c); upd({ savedContent: c }); setErrorMessage(''); return; } const sp = await saveFile(c); if (sp) { upd({ path: sp, savedContent: c }); setErrorMessage(''); props.onFilePathChange?.(sp); fixWysiwygImages(); } } catch { setErrorMessage(t('file.saveFailed')); } };
    const handleSaveAs = async () => { try { const c = viewMode() === 'source' ? syncSourceToWysiwyg() : syncFromWysiwyg(); const sp = await saveFile(c, fp() || undefined); if (sp) { upd({ path: sp, savedContent: c }); setErrorMessage(''); props.onFilePathChange?.(sp); fixWysiwygImages(); } } catch { setErrorMessage(t('file.saveAsFailed')); } };

    const handleExport = async (fmt: 'word' | 'pdf' | 'png' | 'html') => {
        try { setIsExporting(true); setExportProgress(0); setExportMessage(t('export.progressTitle')); setShowExportMenu(false); const c = viewMode() === 'source' ? syncSourceToWysiwyg() : syncFromWysiwyg(); const fn = getTabName(doc()).replace(/\.[^/.]+$/, '') || 'Document'; const cb: ExportProgressCallback = (p, m) => { setExportProgress(p); setExportMessage(m); }; await exportFile(fmt, c, fn, cb); setErrorMessage(''); } catch { setErrorMessage(t('export.failed')); } finally { setIsExporting(false); setExportProgress(0); setExportMessage(''); }
    };

    const performSearch = (term: string) => { const c = mk(); if (!term) { setSearchResults([]); setSearchIndex(0); return; } const ind: number[] = []; let i = 0; const lc = c.toLowerCase(), lt = term.toLowerCase(); while ((i = lc.indexOf(lt, i)) !== -1) { ind.push(i); i += term.length; } setSearchResults(ind); setSearchIndex(ind.length ? 1 : 0); };
    const scrollToSearchResult = (i: number) => { const r = searchResults(); if (!r.length) return; const pos = r[i]; if (viewMode() === 'source' && sourceTextArea) { sourceTextArea.focus(); sourceTextArea.setSelectionRange(pos, pos + searchTerm().length); sourceTextArea.scrollTop = Math.max(0, (mk().slice(0, pos).split('\n').length - 5) * 24); } };
    const searchNext = () => { const r = searchResults(); if (!r.length) return; const n = searchIndex() >= r.length ? 1 : searchIndex() + 1; setSearchIndex(n); scrollToSearchResult(n - 1); };
    const searchPrev = () => { const r = searchResults(); if (!r.length) return; const p = searchIndex() <= 1 ? r.length : searchIndex() - 1; setSearchIndex(p); scrollToSearchResult(p - 1); };
    const handleReplace = () => { const r = searchResults(); if (!r.length) return; const i = searchIndex() - 1; const nc = mk().slice(0, r[i]) + replaceTerm() + mk().slice(r[i] + searchTerm().length); if (viewMode() === 'source') upd({ content: nc }); else if (editorHandle) { isProgrammaticChange = true; editorHandle.setMarkdown(nc); isProgrammaticChange = false; upd({ content: nc }); } triggerAutoSave(); setSearchVisible(false); };
    const handleReplaceAll = () => { const tm = searchTerm(); if (!tm) return; const nc = mk().split(tm).join(replaceTerm()); if (viewMode() === 'source') upd({ content: nc }); else if (editorHandle) { isProgrammaticChange = true; editorHandle.setMarkdown(nc); isProgrammaticChange = false; upd({ content: nc }); } triggerAutoSave(); setSearchVisible(false); };

    const cmdList = () => { const q = paletteSearch().toLowerCase(); const all = [{ id: 'open', label: t('file.open'), act: handleOpenFile }, { id: 'save', label: t('file.save'), act: handleSaveFile }, { id: 'saveAs', label: t('file.saveAs'), act: handleSaveAs }, { id: 'mode', label: viewMode() === 'wysiwyg' ? '切换到源码模式' : '切换到所见即所得', act: () => switchViewMode(viewMode() === 'wysiwyg' ? 'source' : 'wysiwyg') }, { id: 'focus', label: isFocusMode() ? t('focus.exit') : t('focus.enter'), act: () => setIsFocusMode(!isFocusMode()) }, { id: 'search', label: t('search.find'), act: () => setSearchVisible(true) }, { id: 'settings', label: t('settings.title'), act: () => setShowSettings(true) }]; return q ? all.filter(c => c.label.toLowerCase().includes(q) || c.id.includes(q)) : all; };

    const handleKeyDown = (e: KeyboardEvent) => {
        const el = document.activeElement;
        if (el?.closest('.search-row, .command-palette-input') || el?.tagName === 'INPUT' || el?.tagName === 'SELECT') return;
        if (e.key === 'Escape') { setSearchVisible(false); setShowPalette(false); setIsFocusMode(false); setShowHelp(false); return; }
        if (e.key === 'F5' || (e.ctrlKey && (e.key === 'r' || e.key === 'R'))) { e.preventDefault(); return; }
        if (e.key === 'F11') { e.preventDefault(); setIsFocusMode(!isFocusMode()); return; }
        if (e.key === 'F1') { e.preventDefault(); setShowHelp(true); return; }
        if (e.ctrlKey && e.shiftKey && (e.key === 'P' || e.key === 'p')) { e.preventDefault(); setShowPalette(true); setTimeout(() => commandInput?.focus(), 50); return; }
        if (e.ctrlKey && e.key === '/') { e.preventDefault(); switchViewMode(viewMode() === 'wysiwyg' ? 'source' : 'wysiwyg'); return; }
        if (e.ctrlKey && (e.key === 'o' || e.key === 'O')) { e.preventDefault(); handleOpenFile(); return; }
        if (e.ctrlKey && (e.key === 's' || e.key === 'S')) { e.preventDefault(); handleSaveFile(); return; }
        if (e.ctrlKey && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); setSearchVisible(true); return; }
    };

    const closeSettings = () => setShowSettings(false);

    const jumpToLine = (ln: number, ht?: string) => {
        if (viewMode() === 'source') { const c = src(); const o = getLineStartOffset(c, ln); setTimeout(() => { if (!sourceTextArea) return; sourceTextArea.focus(); sourceTextArea.selectionStart = o; sourceTextArea.selectionEnd = o; sourceTextArea.scrollTop = Math.max(0, (c.slice(0, o).split('\n').length - 3) * 24); }, 0); return; }
        const hds = milkdownRoot?.querySelectorAll('h1,h2,h3,h4,h5,h6') || [];
        const mds = mk().split('\n').map((l, i) => ({ l, ln: i + 1 })).filter(({ l }) => /^(#{1,6})\s+/.test(l.trim()));
        const ti = mds.findIndex(it => it.ln === ln);
        const tgt = hds[ti] || (ht ? Array.from(hds).find(h => h.textContent?.trim() === ht) : null);
        if (tgt instanceof HTMLElement) { tgt.scrollIntoView({ behavior: 'smooth', block: 'start' }); tgt.classList.add('heading-highlight'); setTimeout(() => tgt.classList.remove('heading-highlight'), 1000); }
    };

    onMount(() => {
        window.addEventListener('keydown', handleKeyDown);
        if (milkdownRoot) {
            milkdownRoot.addEventListener('paste', handlePasteEvent); milkdownRoot.addEventListener('drop', handleDropEvent); milkdownRoot.addEventListener('dragover', handleDragOver);
            createMilkdownHandle(milkdownRoot, mk(), (md) => { if (isProgrammaticChange) return; upd({ content: md }); fixWysiwygImages(); triggerAutoSave(); })
                .then((h) => { editorHandle = h; const cc = h.getMarkdown(); upd({ savedContent: cc, content: cc }); setIsEditorReady(true); fixWysiwygImages(); if (props.initialFilePath && props.initialFilePath !== fp()) { loadedInitialPath = props.initialFilePath; loadFileFromPath(props.initialFilePath); } })
                .catch(() => setErrorMessage(t('editor.initFailed')));
        }
    });
    onCleanup(() => { window.removeEventListener('keydown', handleKeyDown); if (autoSaveTimer) clearTimeout(autoSaveTimer); if (milkdownRoot) { milkdownRoot.removeEventListener('paste', handlePasteEvent); milkdownRoot.removeEventListener('drop', handleDropEvent); milkdownRoot.removeEventListener('dragover', handleDragOver); } editorHandle?.destroy(); });
    createEffect(() => { const p = props.initialFilePath; if (!p || p === loadedInitialPath || p === lastRequestedPath) return; lastRequestedPath = p; if (isEditorReady()) { loadedInitialPath = p; loadFileFromPath(p); } });
    createEffect(() => { if (progressBarElement) progressBarElement.style.width = `${exportProgress()}%`; });
    createEffect(() => { (window as any).__editorJumpToLine = jumpToLine; });
    createEffect(() => { mk(); if (viewMode() === 'wysiwyg') fixWysiwygImages(); });

    const sc = [['Ctrl+O', t('file.open')], ['Ctrl+S', t('file.save')], ['Ctrl+F', t('search.find')], ['Ctrl+/', t('hotkey.wysiwyg')], ['Ctrl+Shift+P', t('command.palette')], ['F11', t('focus.enter')], ['F1', t('help.title')], ['Esc', '关闭弹窗']];

    return (
        <div class="editor-container" classList={{ 'focus-mode': isFocusMode() }} style={{ position: 'relative' }}>
            <Show when={!isFocusMode()}>
                <div class="editor-header">
                    <div class="header-left"><h1>{t('app.title')}</h1><Show when={errorMessage()}><span class="editor-error">{errorMessage()}</span></Show></div>
                    <div class="header-right">
                        <div class="file-actions">
                            <button class="file-btn" onClick={handleOpenFile} title={t('file.openTitle')}>{t('file.open')}</button>
                            <button class="file-btn" onClick={handleSaveFile} title={t('file.saveTitle')}>{t('file.save')}</button>
                            <button class="file-btn" onClick={handleSaveAs} title={t('file.saveAsTitle')}>{t('file.saveAs')}</button>
                            <div class="export-menu-container">
                                <button class="file-btn" onClick={() => setShowExportMenu(!showExportMenu())}>{t('file.export')}</button>
                                {showExportMenu() && <div class="export-menu"><button class="export-menu-item" onClick={() => handleExport('word')}>{t('export.word')}</button><button class="export-menu-item" onClick={() => handleExport('pdf')}>{t('export.pdf')}</button><button class="export-menu-item" onClick={() => handleExport('png')}>{t('export.png')}</button><button class="export-menu-item" onClick={() => handleExport('html')}>{t('export.html')}</button></div>}
                            </div>
                        </div>
                        <button class="file-btn" onClick={() => setShowSettings(true)}>{t('settings.title')}</button>
                    </div>
                </div>
                <div class="editor-tabs">
                    <For each={tabs()}>{(tab, i) => (
                        <div class="editor-tab" classList={{ active: i() === activeTab() }} onClick={() => setActiveTab(i())} title={tab.path || t('file.unnamed')}>
                            <span class="tab-name">{getTabName(tab)}{tab.content !== tab.savedContent ? ' \u25CF' : ''}</span>
                            {tabs().length > 1 && <button class="tab-close" onClick={(e) => { e.stopPropagation(); closeTab(i()); }}>&times;</button>}
                        </div>
                    )}</For>
                </div>
            </Show>

            <Show when={searchVisible()}>
                <div class="search-dialog">
                    <div class="search-row"><input type="text" placeholder={t('search.find')} value={searchTerm()} onInput={(e) => { setSearchTerm(e.currentTarget.value); performSearch(e.currentTarget.value); }} autofocus /><div class="search-actions"><button class="search-btn" onClick={searchPrev} disabled={!searchResults().length}>&#9664;</button><button class="search-btn" onClick={searchNext} disabled={!searchResults().length}>&#9654;</button><button class="search-btn" onClick={() => setSearchVisible(false)}>&#10005;</button></div></div>
                    <div class="search-row"><input type="text" placeholder={t('search.replace')} value={replaceTerm()} onInput={(e) => setReplaceTerm(e.currentTarget.value)} /><div class="search-actions"><button class="search-btn" onClick={handleReplace} disabled={!searchResults().length}>{t('search.replace')}</button><button class="search-btn" onClick={handleReplaceAll} disabled={!searchTerm()}>{t('search.replaceAll')}</button></div></div>
                    {searchTerm() && searchResults().length > 0 && <div class="search-info">{t('search.count', { count: searchResults().length })} &middot; {searchIndex()}/{searchResults().length}</div>}
                    {searchTerm() && !searchResults().length && <div class="search-info">{t('search.noResults')}</div>}
                </div>
            </Show>

            <div class="editor-body">
                <div ref={milkdownRoot} class={`milkdown-host ${viewMode() === 'wysiwyg' ? 'active' : 'hidden'}`} />
                <Show when={viewMode() === 'source'}>
                    <div class="source-wrapper active">
                        <pre ref={sourceHighlight} class="source-highlight" aria-hidden="true"><code innerHTML={highlightMarkdown(src() || ' ')} /></pre>
                        <textarea ref={sourceTextArea} class="source-editor" value={src()} spellcheck={false} onInput={(e) => { const c = e.currentTarget.value; upd({ content: c }); triggerAutoSave(); }} onScroll={syncSourceScroll} />
                    </div>
                </Show>
            </div>

            <div class="editor-statusbar">
                <span class="status-item">{t('status.words', { n: getWords(mk()) })}</span><span class="status-sep">|</span>
                <span class="status-item">{t('status.lines', { n: getLines(mk()) })}</span><span class="status-sep">|</span>
                <span class="status-item">{t('status.chars', { n: mk().length })}</span><span class="status-sep">|</span>
                <span class="status-item">{viewMode() === 'wysiwyg' ? 'WYSIWYG' : 'Source'}</span>
                {autoSaveEnabled() && fp() && <><span class="status-sep">|</span><span class="status-item">Auto</span></>}
            </div>

            <Show when={showPalette()}>
                <div class="command-overlay" onClick={() => setShowPalette(false)}>
                    <div class="command-palette" onClick={(e) => e.stopPropagation()}>
                        <div class="command-palette-input"><input ref={commandInput} type="text" placeholder={t('command.search')} value={paletteSearch()} onInput={(e) => setPaletteSearch(e.currentTarget.value)} onKeyDown={(e) => { if (e.key === 'Enter') { const c = cmdList(); if (c.length) { c[0].act(); setShowPalette(false); } } if (e.key === 'Escape') setShowPalette(false); }} /></div>
                        <div class="command-palette-list"><For each={cmdList()}>{(c) => <div class="command-item" onClick={() => { c.act(); setShowPalette(false); }}>{c.label}</div>}</For></div>
                    </div>
                </div>
            </Show>

            <Show when={showHelp()}>
                <div class="command-overlay" onClick={() => setShowHelp(false)}>
                    <div class="settings-dialog" onClick={(e) => e.stopPropagation()} style={{ 'max-width': '380px' }}>
                        <div class="settings-title">{t('help.title')}</div>
                        <For each={sc}>{(s) => <div class="help-row"><kbd>{s[0]}</kbd><span>{s[1]}</span></div>}</For>
                        <div class="settings-actions" style={{ 'margin-top': '12px' }}><button class="file-btn" onClick={() => setShowHelp(false)}>{t('help.close')}</button></div>
                    </div>
                </div>
            </Show>

            {isExporting() && <div class="export-progress-overlay"><div class="export-progress-dialog"><div class="export-progress-title">{t('export.progressTitle')}</div><div class="export-progress-bar-container"><div ref={progressBarElement} class="export-progress-bar" /></div><div class="export-progress-message">{exportMessage()}</div><div class="export-progress-percent">{exportProgress()}%</div></div></div>}

            {showSettings() && (
                <div class="settings-overlay" onClick={closeSettings}>
                    <div class="settings-dialog" onClick={(e) => e.stopPropagation()}>
                        <div class="settings-title">{t('settings.title')}</div>
                        <div class="settings-row"><div class="settings-label">{t('settings.imagePaste')}</div><select class="settings-select" value={imagePasteMode()} onChange={(e) => { const v = e.currentTarget.value as ImagePasteMode; setImagePasteMode(v); localStorage.setItem('imagePasteMode', v); }}><option value="base64">{t('settings.imagePaste.base64')}</option><option value="relative">{t('settings.imagePaste.relative')}</option></select></div>
                        <div class="settings-row"><div class="settings-label">{t('settings.autoSave')}</div><select class="settings-select" value={autoSaveEnabled() ? 'enabled' : 'disabled'} onChange={(e) => { const en = e.currentTarget.value === 'enabled'; setAutoSaveEnabled(en); localStorage.setItem('autoSave', String(en)); }}><option value="enabled">{t('settings.autoSaveEnabled')}</option><option value="disabled">{t('settings.autoSaveDisabled')}</option></select></div>
                        <div class="settings-row"><div class="settings-label">{t('settings.theme')}</div><select class="settings-select" value={currentTheme()} onChange={(e) => { const th = e.currentTarget.value; setCurrentTheme(th); applyTheme(th); }}><option value="light">{t('settings.theme.light')}</option><option value="dark">{t('settings.theme.dark')}</option></select></div>
                        <div class="settings-row"><div class="settings-label">{t('settings.language')}</div><select class="settings-select" value={getLocale()} onChange={(e) => setLocale(e.currentTarget.value as 'zh-CN' | 'en-US')}><option value="zh-CN">{t('settings.language.zh')}</option><option value="en-US">{t('settings.language.en')}</option></select></div>
                        <div class="settings-actions"><button class="file-btn" onClick={closeSettings}>{t('settings.close')}</button></div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Editor;
