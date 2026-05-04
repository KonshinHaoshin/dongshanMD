import { createRoot, createSignal } from 'solid-js';

export type Locale = 'zh-CN' | 'en-US';

type I18nDict = Record<string, Record<Locale, string>>;

const dict: I18nDict = {
  'app.title': { 'zh-CN': 'DongshanMD', 'en-US': 'DongshanMD' },
  'file.open': { 'zh-CN': '打开', 'en-US': 'Open' },
  'file.save': { 'zh-CN': '保存', 'en-US': 'Save' },
  'file.saveAs': { 'zh-CN': '另存为', 'en-US': 'Save As' },
  'file.export': { 'zh-CN': '导出', 'en-US': 'Export' },
  'file.unnamed': { 'zh-CN': '未命名文档', 'en-US': 'Untitled' },
  'file.confirmDiscard': { 'zh-CN': '当前文档有未保存的更改。继续操作将丢弃这些更改，是否继续？', 'en-US': 'Unsaved changes will be discarded. Continue?' },
  'file.onlyMdTxt': { 'zh-CN': '只能打开 .md、.markdown 或 .txt 文件。', 'en-US': 'Only .md, .markdown, or .txt files are supported.' },
  'file.loadFailed': { 'zh-CN': '加载文件失败', 'en-US': 'Failed to load file' },
  'file.saveFailed': { 'zh-CN': '保存文件失败', 'en-US': 'Failed to save file' },
  'file.saveAsFailed': { 'zh-CN': '另存为失败', 'en-US': 'Save As failed' },
  'file.openTitle': { 'zh-CN': '打开文件 (Ctrl+O)', 'en-US': 'Open File (Ctrl+O)' },
  'file.saveTitle': { 'zh-CN': '保存文件 (Ctrl+S)', 'en-US': 'Save File (Ctrl+S)' },
  'file.saveAsTitle': { 'zh-CN': '另存为', 'en-US': 'Save As' },
  'file.exportTitle': { 'zh-CN': '导出文档', 'en-US': 'Export Document' },
  'export.progressTitle': { 'zh-CN': '正在导出...', 'en-US': 'Exporting...' },
  'export.failed': { 'zh-CN': '导出失败', 'en-US': 'Export failed' },
  'settings.title': { 'zh-CN': '设置', 'en-US': 'Settings' },
  'settings.close': { 'zh-CN': '关闭', 'en-US': 'Close' },
  'settings.imagePaste': { 'zh-CN': '图片粘贴方式', 'en-US': 'Image paste mode' },
  'settings.imagePaste.base64': { 'zh-CN': 'Base64（嵌入）', 'en-US': 'Base64 (Embed)' },
  'settings.imagePaste.relative': { 'zh-CN': '相对路径（保存文件）', 'en-US': 'Relative path (Save)' },
  'settings.autoSave': { 'zh-CN': '自动保存', 'en-US': 'Auto Save' },
  'settings.autoSaveEnabled': { 'zh-CN': '启用', 'en-US': 'Enabled' },
  'settings.autoSaveDisabled': { 'zh-CN': '禁用', 'en-US': 'Disabled' },
  'settings.theme': { 'zh-CN': '主题', 'en-US': 'Theme' },
  'settings.theme.light': { 'zh-CN': '浅色', 'en-US': 'Light' },
  'settings.theme.dark': { 'zh-CN': '暗色', 'en-US': 'Dark' },
  'settings.language': { 'zh-CN': '语言', 'en-US': 'Language' },
  'settings.language.zh': { 'zh-CN': '中文', 'en-US': 'Chinese' },
  'settings.language.en': { 'zh-CN': '英文', 'en-US': 'English' },
  'search.find': { 'zh-CN': '查找', 'en-US': 'Find' },
  'search.replace': { 'zh-CN': '替换', 'en-US': 'Replace' },
  'search.replaceAll': { 'zh-CN': '全部替换', 'en-US': 'Replace All' },
  'search.next': { 'zh-CN': '下一个', 'en-US': 'Next' },
  'search.prev': { 'zh-CN': '上一个', 'en-US': 'Previous' },
  'search.noResults': { 'zh-CN': '未找到', 'en-US': 'Not found' },
  'search.count': { 'zh-CN': '{count} 个匹配', 'en-US': '{count} matches' },
  'sidebar.toggle': { 'zh-CN': '显示侧边栏', 'en-US': 'Show sidebar' },
  'sidebar.files': { 'zh-CN': '文件', 'en-US': 'Files' },
  'sidebar.outline': { 'zh-CN': '大纲', 'en-US': 'Outline' },
  'editor.initFailed': { 'zh-CN': '初始化 WYSIWYG 编辑器失败', 'en-US': 'Failed to initialize WYSIWYG editor' },
  'image.pasteFailed': { 'zh-CN': '粘贴图片失败', 'en-US': 'Failed to paste image' },
  'image.dropFailed': { 'zh-CN': '拖拽图片失败', 'en-US': 'Failed to drop image' },
  'welcome.title': { 'zh-CN': '欢迎使用 DongshanMD', 'en-US': 'Welcome to DongshanMD' },
  'welcome.desc': { 'zh-CN': '这是一个真正所见即所得的 Markdown 编辑器。', 'en-US': 'A true WYSIWYG Markdown editor.' },
  'welcome.features': { 'zh-CN': '功能特性', 'en-US': 'Features' },
  'welcome.f1': { 'zh-CN': '直接编辑渲染后的文档', 'en-US': 'Edit rendered documents directly' },
  'welcome.f2': { 'zh-CN': '保留 Markdown 源码模式', 'en-US': 'Keep Markdown source mode' },
  'welcome.f3': { 'zh-CN': '支持常规 GFM 文档结构', 'en-US': 'Supports common GFM document structures' },
  'welcome.f4': { 'zh-CN': '打开、保存和导出都以 Markdown 为真源', 'en-US': 'Open, save, and export all treat Markdown as source of truth' },
  'welcome.start': { 'zh-CN': '开始编写你的 Markdown 文档吧！', 'en-US': 'Start writing your Markdown document!' },
  'hotkey.wysiwyg': { 'zh-CN': '所见即所得模式 (Ctrl+/)', 'en-US': 'WYSIWYG mode (Ctrl+/)' },
  'hotkey.source': { 'zh-CN': 'Markdown 源码模式 (Ctrl+/)', 'en-US': 'Markdown source mode (Ctrl+/)' },
  'export.word': { 'zh-CN': 'Word (.docx)', 'en-US': 'Word (.docx)' },
  'export.pdf': { 'zh-CN': 'PDF (.pdf)', 'en-US': 'PDF (.pdf)' },
  'export.png': { 'zh-CN': 'PNG (.png)', 'en-US': 'PNG (.png)' },
  'export.html': { 'zh-CN': 'HTML (.html)', 'en-US': 'HTML (.html)' },
  'dir.open': { 'zh-CN': '打开文件夹', 'en-US': 'Open Folder' },
  'dir.noFolder': { 'zh-CN': '未打开文件夹', 'en-US': 'No folder opened' },
  'status.words': { 'zh-CN': '{n} 词', 'en-US': '{n} words' },
  'status.lines': { 'zh-CN': '{n} 行', 'en-US': '{n} lines' },
  'status.chars': { 'zh-CN': '{n} 字', 'en-US': '{n} chars' },
  'focus.enter': { 'zh-CN': '进入专注模式 (F11)', 'en-US': 'Enter Focus Mode (F11)' },
  'focus.exit': { 'zh-CN': '退出专注模式 (F11)', 'en-US': 'Exit Focus Mode (F11)' },
  'command.palette': { 'zh-CN': '命令面板', 'en-US': 'Command Palette' },
  'command.search': { 'zh-CN': '搜索命令...', 'en-US': 'Search commands...' },
  'help.title': { 'zh-CN': '快捷键', 'en-US': 'Shortcuts' },
  'help.close': { 'zh-CN': '关闭', 'en-US': 'Close' },
  'tab.close': { 'zh-CN': '关闭', 'en-US': 'Close' },
};

const storedLocale: Locale = (() => {
  try {
    return (localStorage.getItem('locale') as Locale) || 'zh-CN';
  } catch {
    return 'zh-CN';
  }
})();

const [localeSig, setLocaleSig] = createRoot(() => createSignal<Locale>(storedLocale));

export const getLocale = (): Locale => localeSig();

export const setLocale = (locale: Locale) => {
  setLocaleSig(locale);
  try {
    localStorage.setItem('locale', locale);
  } catch { /* ignore */ }
};

export const t = (key: string, params?: Record<string, string | number>): string => {
  const entry = dict[key];
  if (!entry) return key;
  let text = entry[localeSig()] || entry['zh-CN'] || key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(`{${k}}`, String(v));
    }
  }
  return text;
};
