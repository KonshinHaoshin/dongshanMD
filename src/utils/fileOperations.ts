import { open, save } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile, readDir, rename, exists } from '@tauri-apps/plugin-fs';

const SUPPORTED_EXTENSIONS = ['md', 'markdown', 'txt'];
const SKIP_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'dist-ssr', 'target', '.cache', '.vite']);

export interface SearchResult {
  filePath: string;
  lineNumber: number;
  lineText: string;
}

const getSeparator = (dirPath: string) => (dirPath.includes('\\') ? '\\' : '/');

const joinPath = (dirPath: string, name: string) => {
  const separator = getSeparator(dirPath);
  return `${dirPath.replace(/[/\\]+$/, '')}${separator}${name}`;
};

const getFileExt = (filePath: string) => filePath.split('.').pop()?.toLowerCase() || '';

const isSupportedFile = (filePath: string) => SUPPORTED_EXTENSIONS.includes(getFileExt(filePath));

const getFileDir = (filePath: string) => filePath.replace(/[\\/][^\\/]*$/, '');

const getFileName = (filePath: string) => {
  const parts = filePath.split(/[/\\]/);
  return parts[parts.length - 1] || filePath;
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 列出目录中受支持的文件
 */
export async function listDirectoryFiles(dirPath: string): Promise<string[]> {
  try {
    const entries = await readDir(dirPath);
    const files = entries
      .filter(entry => {
        if (!entry.name) return false;
        return isSupportedFile(entry.name);
      })
      .map(entry => joinPath(dirPath, entry.name))
      .sort((a, b) => a.localeCompare(b));
    return files;
  } catch {
    return [];
  }
}

export async function openDirectory(): Promise<string | null> {
  const dirPath = await open({
    directory: true,
    multiple: false,
  });

  return typeof dirPath === 'string' ? dirPath : null;
}

export async function listWorkspaceFiles(rootPath: string): Promise<string[]> {
  const files: string[] = [];

  const walk = async (dirPath: string) => {
    let entries;
    try {
      entries = await readDir(dirPath);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.name) continue;
      const fullPath = joinPath(dirPath, entry.name);
      if (entry.isDirectory) {
        if (!SKIP_DIRECTORIES.has(entry.name)) {
          await walk(fullPath);
        }
      } else if (isSupportedFile(entry.name)) {
        files.push(fullPath);
      }
    }
  };

  await walk(rootPath);
  return files.sort((a, b) => a.localeCompare(b));
}

export async function searchWorkspaceFiles(rootPath: string, query: string): Promise<SearchResult[]> {
  const term = query.trim();
  if (!term) return [];

  const matcher = new RegExp(escapeRegExp(term), 'i');
  const files = await listWorkspaceFiles(rootPath);
  const results: SearchResult[] = [];

  for (const filePath of files) {
    let content = '';
    try {
      content = await readTextFile(filePath);
    } catch {
      continue;
    }

    const lines = content.split(/\r?\n/);
    lines.forEach((lineText, index) => {
      if (matcher.test(lineText)) {
        results.push({
          filePath,
          lineNumber: index + 1,
          lineText: lineText.trim(),
        });
      }
    });
  }

  return results;
}

export async function renameFile(oldPath: string, newName: string): Promise<string> {
  const cleanName = newName.trim().replace(/^["']|["']$/g, '');
  if (!cleanName || /[/\\]/.test(cleanName)) {
    throw new Error('Invalid file name');
  }

  const oldName = getFileName(oldPath);
  const oldExt = getFileExt(oldName);
  const proposedExt = getFileExt(cleanName);
  const finalName = proposedExt ? cleanName : `${cleanName}.${oldExt || 'md'}`;

  if (!isSupportedFile(finalName)) {
    throw new Error('Unsupported file extension');
  }

  const newPath = joinPath(getFileDir(oldPath), finalName);
  if (newPath === oldPath) return oldPath;
  if (newPath.toLowerCase() !== oldPath.toLowerCase() && await exists(newPath)) {
    throw new Error('Target file already exists');
  }

  await rename(oldPath, newPath);
  return newPath;
}

/**
 * 打开文件对话框并读取文件内容
 * @returns 返回文件路径和内容，如果取消则返回 null
 */
export async function openFile(): Promise<{ path: string; content: string } | null> {
  try {
    // 打开文件选择对话框
    const filePath = await open({
      filters: [
        {
          name: 'Markdown & Text',
          extensions: ['md', 'txt', 'markdown'],
        },
        {
          name: 'Markdown',
          extensions: ['md', 'markdown'],
        },
        {
          name: 'Text',
          extensions: ['txt'],
        },
        {
          name: 'All Files',
          extensions: ['*'],
        },
      ],
      multiple: false,
    });

    if (!filePath || typeof filePath !== 'string') {
      return null;
    }

    // 读取文件内容
    const content = await readTextFile(filePath);
    return {
      path: filePath,
      content,
    };
  } catch (error) {
    console.error('打开文件失败:', error);
    throw error;
  }
}

/**
 * 保存文件对话框并写入文件内容
 * @param content 要保存的内容
 * @param defaultPath 默认文件路径（可选）
 * @returns 返回保存的文件路径，如果取消则返回 null
 */
export async function saveFile(
  content: string,
  defaultPath?: string
): Promise<string | null> {
  try {
    // 打开保存文件对话框
    const filePath = await save({
      filters: [
        {
          name: 'Markdown',
          extensions: ['md'],
        },
        {
          name: 'Text',
          extensions: ['txt'],
        },
        {
          name: 'All Files',
          extensions: ['*'],
        },
      ],
      defaultPath,
    });

    if (!filePath || typeof filePath !== 'string') {
      return null;
    }

    // 写入文件内容
    await writeTextFile(filePath, content);
    return filePath;
  } catch (error) {
    console.error('保存文件失败:', error);
    throw error;
  }
}

/**
 * 直接保存到已有文件路径
 * @param path 文件路径
 * @param content 要保存的内容
 */
export async function saveToFile(path: string, content: string): Promise<void> {
  try {
    await writeTextFile(path, content);
  } catch (error) {
    console.error('保存文件失败:', error);
    throw error;
  }
}

