import { describe, it, expect } from 'vitest';
import { t, setLocale, getLocale } from '../src/utils/i18n';

describe('i18n', () => {
  it('should return Chinese text by default', () => {
    expect(t('file.open')).toBe('打开');
  });

  it('should return English text after locale change', () => {
    setLocale('en-US');
    expect(t('file.open')).toBe('Open');
    setLocale('zh-CN');
  });

  it('should replace params', () => {
    expect(t('search.count', { count: 5 })).toBe('5 个匹配');
  });

  it('should get current locale', () => {
    expect(getLocale()).toBe('zh-CN');
  });
});

describe('exportUtils helpers', () => {
  it('should extract base file name', () => {
    const getFileBaseName = (filePath: string) => {
      const parts = filePath.split(/[/\\]/);
      const name = parts[parts.length - 1] || 'document';
      return name.replace(/\.[^/.]+$/, '') || 'document';
    };
    expect(getFileBaseName('C:\\docs\\test.md')).toBe('test');
    expect(getFileBaseName('/home/user/doc.markdown')).toBe('doc');
    expect(getFileBaseName('readme.txt')).toBe('readme');
    expect(getFileBaseName('noext')).toBe('noext');
  });

  it('should extract file directory', () => {
    const getFileDir = (filePath: string) => filePath.replace(/[\\/][^\\/]*$/, '');
    expect(getFileDir('C:\\docs\\test.md')).toBe('C:\\docs');
    expect(getFileDir('/home/user/doc.md')).toBe('/home/user');
  });

  it('should compute line start offset', () => {
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
    const text = 'line1\nline2\nline3\n';
    expect(getLineStartOffset(text, 1)).toBe(0);
    expect(getLineStartOffset(text, 2)).toBe(6);
    expect(getLineStartOffset(text, 3)).toBe(12);
    expect(getLineStartOffset(text, 4)).toBe(18);
    expect(getLineStartOffset(text, 99)).toBe(18);
  });
});
