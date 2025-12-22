import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell, WidthType } from 'docx';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import html2pdf from 'html2pdf.js';
import { marked } from 'marked';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile, writeTextFile } from '@tauri-apps/plugin-fs';

export type ExportProgressCallback = (progress: number, message: string) => void;

/**
 * 打开保存对话框并返回文件路径
 */
async function getSavePath(
  format: 'word' | 'pdf' | 'png' | 'html',
  defaultName: string
): Promise<string | null> {
  const filters = {
    word: [{ name: 'Word Document', extensions: ['docx'] }],
    pdf: [{ name: 'PDF Document', extensions: ['pdf'] }],
    png: [{ name: 'PNG Image', extensions: ['png'] }],
    html: [{ name: 'HTML Document', extensions: ['html'] }],
  };

  const extensions = {
    word: 'docx',
    pdf: 'pdf',
    png: 'png',
    html: 'html',
  };

  const filePath = await save({
    filters: filters[format],
    defaultPath: `${defaultName}.${extensions[format]}`,
  });

  return filePath || null;
}

/**
 * 将 Markdown 导出为 Word 文档
 */
export async function exportToWord(
  markdown: string,
  filePath: string,
  onProgress?: ExportProgressCallback
): Promise<void> {
  try {
    onProgress?.(10, '正在解析 Markdown...');
    
    // 解析 Markdown 为 HTML
    const html = await marked.parse(markdown);
    
    onProgress?.(30, '正在转换格式...');
    
    // 创建临时 DOM 元素来解析 HTML
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    
    const children: Paragraph[] = [];
    
    // 遍历 HTML 元素并转换为 docx 段落
    const processElement = (element: Element) => {
      const tagName = element.tagName.toLowerCase();
      const text = element.textContent || '';
      
      if (tagName === 'h1') {
        children.push(new Paragraph({
          text: text,
          heading: HeadingLevel.HEADING_1,
          spacing: { after: 200 },
        }));
      } else if (tagName === 'h2') {
        children.push(new Paragraph({
          text: text,
          heading: HeadingLevel.HEADING_2,
          spacing: { after: 200 },
        }));
      } else if (tagName === 'h3') {
        children.push(new Paragraph({
          text: text,
          heading: HeadingLevel.HEADING_3,
          spacing: { after: 200 },
        }));
      } else if (tagName === 'h4') {
        children.push(new Paragraph({
          text: text,
          heading: HeadingLevel.HEADING_4,
          spacing: { after: 200 },
        }));
      } else if (tagName === 'h5') {
        children.push(new Paragraph({
          text: text,
          heading: HeadingLevel.HEADING_5,
          spacing: { after: 200 },
        }));
      } else if (tagName === 'h6') {
        children.push(new Paragraph({
          text: text,
          heading: HeadingLevel.HEADING_6,
          spacing: { after: 200 },
        }));
      } else if (tagName === 'p') {
        // 处理段落中的格式（粗体、斜体等）
        const runs: TextRun[] = [];
        let currentText = '';
        let isBold = false;
        let isItalic = false;
        
        const processNode = (node: Node) => {
          if (node.nodeType === Node.TEXT_NODE) {
            currentText += node.textContent || '';
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node as Element;
            if (currentText) {
              runs.push(new TextRun({
                text: currentText,
                bold: isBold,
                italics: isItalic,
              }));
              currentText = '';
            }
            
            if (el.tagName.toLowerCase() === 'strong' || el.tagName.toLowerCase() === 'b') {
              isBold = true;
              Array.from(el.childNodes).forEach(processNode);
              isBold = false;
            } else if (el.tagName.toLowerCase() === 'em' || el.tagName.toLowerCase() === 'i') {
              isItalic = true;
              Array.from(el.childNodes).forEach(processNode);
              isItalic = false;
            } else {
              Array.from(el.childNodes).forEach(processNode);
            }
          }
        };
        
        Array.from(element.childNodes).forEach(processNode);
        if (currentText) {
          runs.push(new TextRun({
            text: currentText,
            bold: isBold,
            italics: isItalic,
          }));
        }
        
        children.push(new Paragraph({
          children: runs.length > 0 ? runs : [new TextRun(text)],
          spacing: { after: 100 },
        }));
      } else if (tagName === 'ul' || tagName === 'ol') {
        // 处理列表
        const listItems = element.querySelectorAll('li');
        listItems.forEach((li) => {
          children.push(new Paragraph({
            text: li.textContent || '',
            bullet: { level: 0 },
            spacing: { after: 50 },
          }));
        });
      } else if (tagName === 'blockquote') {
        children.push(new Paragraph({
          text: text,
          spacing: { before: 100, after: 100 },
          indent: { left: 400 },
        }));
      } else if (tagName === 'code') {
        children.push(new Paragraph({
          text: text,
          spacing: { after: 100 },
        }));
      } else if (tagName === 'pre') {
        children.push(new Paragraph({
          text: text,
          spacing: { after: 100 },
        }));
      } else if (tagName === 'table') {
        // 处理表格
        const rows: TableRow[] = [];
        const tableRows = element.querySelectorAll('tr');
        
        tableRows.forEach((tr) => {
          const cells: TableCell[] = [];
          const tableCells = tr.querySelectorAll('td, th');
          
          tableCells.forEach((td) => {
            const cellText = td.textContent?.trim() || '';
            const isHeader = td.tagName.toLowerCase() === 'th';
            
            cells.push(new TableCell({
              children: [new Paragraph({
                text: cellText,
                ...(isHeader ? { heading: HeadingLevel.HEADING_6 } : {}),
              })],
              width: {
                size: 100 / tableCells.length,
                type: WidthType.PERCENTAGE,
              },
            }));
          });
          
          if (cells.length > 0) {
            rows.push(new TableRow({
              children: cells,
            }));
          }
        });
        
        if (rows.length > 0) {
          children.push(new Table({
            rows: rows,
            width: {
              size: 100,
              type: WidthType.PERCENTAGE,
            },
          }));
        }
      } else {
        // 递归处理子元素
        Array.from(element.children).forEach(processElement);
      }
    };
    
    Array.from(tempDiv.children).forEach(processElement);
    
    // 如果没有内容，添加默认段落
    if (children.length === 0) {
      children.push(new Paragraph({
        text: markdown,
      }));
    }
    
    onProgress?.(60, '正在生成 Word 文档...');
    
    // 创建 Word 文档
    const doc = new Document({
      sections: [
        {
          children: children,
        },
      ],
    });
    
    onProgress?.(80, '正在保存文件...');
    
    // 生成文档并保存
    const blob = await Packer.toBlob(doc);
    const arrayBuffer = await blob.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    
    await writeFile(filePath, uint8Array);
    
    onProgress?.(100, '导出完成！');
    console.log('Word 文档已导出:', filePath);
  } catch (error) {
    console.error('导出 Word 失败:', error);
    throw error;
  }
}

/**
 * 将 Markdown 导出为 PDF（使用 HTML 渲染，支持中文）
 */
export async function exportToPDF(
  markdown: string,
  filePath: string,
  onProgress?: ExportProgressCallback
): Promise<void> {
  try {
    onProgress?.(10, '正在解析 Markdown...');
    
    // 解析 Markdown 为 HTML
    const html = await marked.parse(markdown);
    
    onProgress?.(30, '正在生成 PDF...');
    
    // 创建完整的 HTML 文档结构
    const fullHTML = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif;
              font-size: 14px;
              line-height: 1.6;
              color: #333;
              padding: 20mm;
              margin: 0;
              background: #fff;
              width: 210mm;
            }
            h1, h2, h3, h4, h5, h6 {
              margin-top: 24px;
              margin-bottom: 16px;
              font-weight: 600;
            }
            h1 { font-size: 2em; }
            h2 { font-size: 1.5em; }
            h3 { font-size: 1.25em; }
            p { margin: 16px 0; }
            code {
              background-color: #f5f5f5;
              padding: 2px 4px;
              border-radius: 3px;
              font-family: 'Courier New', monospace;
            }
            pre {
              background-color: #f5f5f5;
              padding: 16px;
              border-radius: 4px;
              overflow-x: auto;
            }
            blockquote {
              border-left: 4px solid #ddd;
              padding-left: 16px;
              color: #666;
              margin: 16px 0;
            }
            ul, ol {
              padding-left: 30px;
            }
            img {
              max-width: 100%;
              height: auto;
            }
          </style>
        </head>
        <body>
          ${html}
        </body>
      </html>
    `;
    
    // 查找预览区域，如果存在则使用预览区域的内容
    const previewElement = document.querySelector('.cherry-editor__preview') 
      || document.querySelector('.cherry-previewer')
      || document.querySelector('[class*="preview"]');
    
    let targetElement: HTMLElement;
    let isTempElement = false;
    
    if (previewElement && previewElement instanceof HTMLElement && previewElement.innerHTML.trim()) {
      // 使用预览区域的内容
      targetElement = previewElement;
      onProgress?.(50, '正在从预览区域转换为 PDF...');
    } else {
      // 创建临时 div 来渲染 HTML
      const tempDiv = document.createElement('div');
      tempDiv.style.position = 'fixed';
      tempDiv.style.left = '0';
      tempDiv.style.top = '0';
      tempDiv.style.width = '794px'; // A4 宽度（像素，96 DPI）
      tempDiv.style.minHeight = '1123px'; // A4 高度
      tempDiv.style.padding = '40px';
      tempDiv.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif';
      tempDiv.style.fontSize = '14px';
      tempDiv.style.lineHeight = '1.6';
      tempDiv.style.color = '#333';
      tempDiv.style.backgroundColor = '#ffffff';
      tempDiv.style.zIndex = '9999';
      tempDiv.innerHTML = html;
      document.body.appendChild(tempDiv);
      targetElement = tempDiv;
      isTempElement = true;
      onProgress?.(50, '正在转换为 PDF...');
      
      // 等待内容渲染
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // 确保元素可见且有内容
    if (!targetElement.innerHTML.trim()) {
      throw new Error('预览内容为空，请先切换到预览模式');
    }
    
    // 使用 html2pdf.js 将 HTML 转换为 PDF
    const opt = {
      margin: [20, 20, 20, 20],
      filename: 'document.pdf',
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { 
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        width: targetElement.scrollWidth || 794,
        height: targetElement.scrollHeight || 1123,
        windowWidth: targetElement.scrollWidth || 794,
        windowHeight: targetElement.scrollHeight || 1123,
        scrollX: 0,
        scrollY: 0,
      },
      jsPDF: { 
        unit: 'mm', 
        format: 'a4', 
        orientation: 'portrait' 
      },
      pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
    };
    
    // 生成 PDF
    const pdfBlob = await html2pdf().set(opt).from(targetElement).outputPdf('blob');
    
    // 如果是临时元素，移除它
    if (isTempElement && targetElement.parentNode) {
      document.body.removeChild(targetElement);
    }
    
    onProgress?.(90, '正在保存文件...');
    
    // 将 PDF 保存为文件
    const arrayBuffer = await pdfBlob.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    
    await writeFile(filePath, uint8Array);
    
    onProgress?.(100, '导出完成！');
    console.log('PDF 文档已导出:', filePath);
  } catch (error) {
    console.error('导出 PDF 失败:', error);
    // 清理临时元素
    const tempDiv = document.querySelector('div[style*="-9999px"]');
    if (tempDiv && tempDiv.parentNode) {
      tempDiv.parentNode.removeChild(tempDiv);
    }
    throw error;
  }
}

/**
 * 将 Markdown 预览内容导出为 PNG 图片（确保从开头截图）
 */
export async function exportToPNG(
  markdown: string,
  filePath: string,
  onProgress?: ExportProgressCallback
): Promise<void> {
  try {
    onProgress?.(10, '正在查找预览区域...');
    
    // 查找预览区域
    const previewElement = document.querySelector('.cherry-editor__preview') 
      || document.querySelector('.cherry-previewer')
      || document.querySelector('[class*="preview"]');
    
    if (!previewElement) {
      throw new Error('未找到预览区域，请先切换到预览模式');
    }
    
    // 确保滚动到顶部
    if (previewElement instanceof HTMLElement) {
      previewElement.scrollTop = 0;
      // 等待滚动完成
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    onProgress?.(30, '正在生成图片...');
    
    // 使用 html2canvas 将预览内容转换为 canvas
    // 确保从顶部开始截图
    const canvas = await html2canvas(previewElement as HTMLElement, {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
      width: previewElement.scrollWidth,
      height: previewElement.scrollHeight,
      x: 0,
      y: 0,
      scrollX: 0,
      scrollY: 0,
      windowWidth: previewElement.scrollWidth,
      windowHeight: previewElement.scrollHeight,
    });
    
    onProgress?.(80, '正在保存文件...');
    
    // 将 canvas 转换为 blob 并保存
    return new Promise<void>((resolve, reject) => {
      canvas.toBlob(async (blob) => {
        try {
          if (!blob) {
            throw new Error('无法生成图片');
          }
          
          const arrayBuffer = await blob.arrayBuffer();
          const uint8Array = new Uint8Array(arrayBuffer);
          
          await writeFile(filePath, uint8Array);
          
          onProgress?.(100, '导出完成！');
          console.log('PNG 图片已导出:', filePath);
          resolve();
        } catch (error) {
          reject(error);
        }
      }, 'image/png');
    });
  } catch (error) {
    console.error('导出 PNG 失败:', error);
    throw error;
  }
}

/**
 * 导出为 HTML
 */
export async function exportToHTML(
  markdown: string,
  filePath: string,
  onProgress?: ExportProgressCallback
): Promise<void> {
  try {
    onProgress?.(30, '正在解析 Markdown...');
    
    // 解析 Markdown 为 HTML
    const html = await marked.parse(markdown);
    
    onProgress?.(60, '正在生成 HTML...');
    
    // 创建完整的 HTML 文档
    const fullHTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Document</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial, sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 40px 20px;
            line-height: 1.6;
            color: #333;
        }
        h1, h2, h3, h4, h5, h6 {
            margin-top: 24px;
            margin-bottom: 16px;
            font-weight: 600;
        }
        h1 { font-size: 2em; }
        h2 { font-size: 1.5em; }
        h3 { font-size: 1.25em; }
        p { margin: 16px 0; }
        code {
            background-color: #f5f5f5;
            padding: 2px 4px;
            border-radius: 3px;
            font-family: 'Courier New', monospace;
        }
        pre {
            background-color: #f5f5f5;
            padding: 16px;
            border-radius: 4px;
            overflow-x: auto;
        }
        blockquote {
            border-left: 4px solid #ddd;
            padding-left: 16px;
            color: #666;
        }
        ul, ol {
            padding-left: 30px;
        }
        img {
            max-width: 100%;
            height: auto;
        }
    </style>
</head>
<body>
    ${html}
</body>
</html>`;
    
    onProgress?.(90, '正在保存文件...');
    
    await writeTextFile(filePath, fullHTML);
    
    onProgress?.(100, '导出完成！');
    console.log('HTML 文档已导出:', filePath);
  } catch (error) {
    console.error('导出 HTML 失败:', error);
    throw error;
  }
}

/**
 * 导出文件的统一入口
 */
export async function exportFile(
  format: 'word' | 'pdf' | 'png' | 'html',
  markdown: string,
  defaultName: string,
  onProgress?: ExportProgressCallback
): Promise<void> {
  // 先打开保存对话框选择路径
  const filePath = await getSavePath(format, defaultName);
  
  if (!filePath) {
    // 用户取消了选择
    return;
  }
  
  // 根据格式调用相应的导出函数
  switch (format) {
    case 'word':
      await exportToWord(markdown, filePath, onProgress);
      break;
    case 'pdf':
      await exportToPDF(markdown, filePath, onProgress);
      break;
    case 'png':
      await exportToPNG(markdown, filePath, onProgress);
      break;
    case 'html':
      await exportToHTML(markdown, filePath, onProgress);
      break;
  }
}
