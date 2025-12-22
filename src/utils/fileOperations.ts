import { open, save } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';

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

