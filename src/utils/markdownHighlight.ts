export function highlightMarkdown(text: string): string {
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  html = html.replace(/(```[\s\S]*?```)/g, '<span class="sh-code">$1</span>');
  html = html.replace(/(`[^`\n]+`)/g, '<span class="sh-inline">$1</span>');
  html = html.replace(/(__[^_]+__)/g, '<span class="sh-bold">$1</span>');
  html = html.replace(/(\*\*[^*]+\*\*)/g, '<span class="sh-bold">$1</span>');
  html = html.replace(/(_[^_]+_)/g, '<span class="sh-italic">$1</span>');
  html = html.replace(/(\*[^*]+\*)/g, '<span class="sh-italic">$1</span>');
  html = html.replace(/(!\[.*?\]\(.*?\))/g, '<span class="sh-image">$1</span>');
  html = html.replace(/(\[.*?\]\(.*?\))/g, '<span class="sh-link">$1</span>');
  html = html.replace(/^(#{1,6}\s+.+)$/gm, '<span class="sh-heading">$1</span>');
  html = html.replace(/^(>\s?.+)$/gm, '<span class="sh-blockquote">$1</span>');
  html = html.replace(/^(\s*[-*+]\s+.+)$/gm, '<span class="sh-list">$1</span>');
  html = html.replace(/^(\s*\d+\.\s+.+)$/gm, '<span class="sh-list">$1</span>');
  html = html.replace(/^(---+|___+|\*\*\*+)$/gm, '<span class="sh-hr">$1</span>');

  return html;
}
