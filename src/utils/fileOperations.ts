import { open, save } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile, readDir, rename, exists } from '@tauri-apps/plugin-fs';

const SKIP_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'dist-ssr', 'target', '.cache', '.vite', '__pycache__', '.vs', '.idea']);

export interface SearchResult {
  filePath: string;
  lineNumber: number;
  lineText: string;
}

export interface TreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: TreeNode[];
  expanded?: boolean;
}

const getSeparator = (dirPath: string) => (dirPath.includes('\\') ? '\\' : '/');

const joinPath = (dirPath: string, name: string) => {
  const separator = getSeparator(dirPath);
  return `${dirPath.replace(/[/\\]+$/, '')}${separator}${name}`;
};

const getFileExt = (filePath: string) => filePath.split('.').pop()?.toLowerCase() || '';

const getFileDir = (filePath: string) => filePath.replace(/[\\/][^\\/]*$/, '');

const getFileName = (filePath: string) => {
  const parts = filePath.split(/[/\\]/);
  return parts[parts.length - 1] || filePath;
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const FILE_ICONS: Record<string, string> = {
  md: '\u{1F4C4}', markdown: '\u{1F4C4}', txt: '\u{1F4C4}',
  js: '\u{1F4DC}', ts: '\u{1F4DC}', tsx: '\u{1F4DC}', jsx: '\u{1F4DC}',
  json: '\u{1F4C7}', yaml: '\u{1F4C2}', yml: '\u{1F4C2}',
  css: '\u{1F3A8}', scss: '\u{1F3A8}', less: '\u{1F3A8}',
  html: '\u{1F310}', htm: '\u{1F310}',
  py: '\u{1F40D}', rs: '\u{1F916}', go: '\u{1F408}',
  java: '\u2615', c: '\u2699', cpp: '\u2699', h: '\u2699',
  sh: '\u{1F4BB}', bat: '\u{1F4BB}', ps1: '\u{1F4BB}',
  sql: '\u{1F5C4}', xml: '\u{1F4C2}', toml: '\u{1F4C2}',
  png: '\u{1F5BC}', jpg: '\u{1F5BC}', jpeg: '\u{1F5BC}', gif: '\u{1F5BC}', svg: '\u{1F3A8}',
  pdf: '\u{1F4D1}',
  zip: '\u{1F4E6}', tar: '\u{1F4E6}', gz: '\u{1F4E6}',
};

export const getFileIcon = (filePath: string) => {
  const ext = getFileExt(filePath);
  return FILE_ICONS[ext] || '\u{1F4C4}';
};

const sortTreeNodes = (nodes: TreeNode[]): TreeNode[] => {
  return nodes.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
};

export async function listDirectoryFiles(dirPath: string): Promise<string[]> {
  try {
    const entries = await readDir(dirPath);
    const files = entries
      .filter(entry => !!entry.name)
      .map(entry => joinPath(dirPath, entry.name!))
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

export async function readDirectoryTree(dirPath: string, depth = 1): Promise<TreeNode[]> {
  let entries;
  try {
    entries = await readDir(dirPath);
  } catch {
    return [];
  }

  const nodes: TreeNode[] = [];
  for (const entry of entries) {
    if (!entry.name) continue;
    const fullPath = joinPath(dirPath, entry.name);
    if (entry.isDirectory) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      const node: TreeNode = { name: entry.name, path: fullPath, isDirectory: true, expanded: false };
      if (depth > 0) {
        node.children = await readDirectoryTree(fullPath, depth - 1);
      }
      nodes.push(node);
    } else {
      nodes.push({ name: entry.name, path: fullPath, isDirectory: false });
    }
  }

  return sortTreeNodes(nodes);
}

export async function expandTreeNode(dirPath: string): Promise<TreeNode[]> {
  return readDirectoryTree(dirPath, 0);
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
      } else {
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

  const newPath = joinPath(getFileDir(oldPath), finalName);
  if (newPath === oldPath) return oldPath;
  if (newPath.toLowerCase() !== oldPath.toLowerCase() && await exists(newPath)) {
    throw new Error('Target file already exists');
  }

  await rename(oldPath, newPath);
  return newPath;
}

export async function createNewFile(dirPath: string, fileName: string): Promise<string> {
  const cleanName = fileName.trim().replace(/^["']|["']$/g, '');
  if (!cleanName || /[/\\]/.test(cleanName)) {
    throw new Error('Invalid file name');
  }

  const fullPath = joinPath(dirPath, cleanName);
  if (await exists(fullPath)) {
    throw new Error('File already exists');
  }

  await writeTextFile(fullPath, '');
  return fullPath;
}

export async function openFile(): Promise<{ path: string; content: string } | null> {
  try {
    const filePath = await open({
      filters: [
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

export async function saveFile(
  content: string,
  defaultPath?: string
): Promise<string | null> {
  try {
    const filePath = await save({
      filters: [
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

    await writeTextFile(filePath, content);
    return filePath;
  } catch (error) {
    console.error('保存文件失败:', error);
    throw error;
  }
}

export async function saveToFile(path: string, content: string): Promise<void> {
  try {
    await writeTextFile(path, content);
  } catch (error) {
    console.error('保存文件失败:', error);
    throw error;
  }
}
