import DOMPurify from 'dompurify';
import { marked } from 'marked';

// Every user/AI HTML rendering path must pass through this boundary.
export function renderMarkdown(content: unknown): string {
  const html = marked.parse(typeof content === 'string' ? content : '', { async: false });
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'ul', 'ol', 'li',
      'blockquote', 'pre', 'code', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'a', 'span', 'div', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'sup', 'sub',
    ],
    ALLOWED_ATTR: ['href', 'title', 'class', 'colspan', 'rowspan'],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  });
}

export function safeWebsiteUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

export function safeImageUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (/^data:image\/(?:png|jpeg|gif|webp);base64,[a-z\d+/=\s]+$/i.test(value)) return value;
  return safeWebsiteUrl(value);
}
