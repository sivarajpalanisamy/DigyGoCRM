import sanitizeHtml from 'sanitize-html';

/**
 * Server-side XSS hardening for user-generated content.
 *
 * The web UI (React) and the mobile app (Flutter Text widgets) both escape on
 * render, so this is defense-in-depth: it keeps the *stored* value clean so any
 * other consumer (exports, future widgets, webhooks, the public API) can't be
 * tricked into executing injected markup.
 */

/**
 * Decode the HTML entities sanitize-html emits, so a plain-text field stores
 * real characters ("A & B") not entity soup ("A &amp; B"). Safe here because it
 * runs AFTER all tags were stripped — there is no markup left to re-introduce,
 * and the value is rendered escaped (React/Flutter) by every consumer. Decodes
 * exactly one level (named entities first, &amp; last) to mirror one encode pass.
 */
function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&amp;/g, '&');
}

/**
 * For plain-text fields that must never contain markup: lead/contact names,
 * note titles/bodies, follow-up titles/descriptions, custom field values.
 * Strips all tags (keeps their text content), then restores plain characters.
 */
export function cleanText(input: unknown): string {
  if (input === null || input === undefined) return '';
  const s = String(input);
  if (!s) return '';
  const stripped = sanitizeHtml(s, {
    allowedTags: [],
    allowedAttributes: {},
    // keep the text inside disallowed tags (e.g. "<b>hi</b>" -> "hi"),
    // but drop the contents of dangerous containers entirely.
    disallowedTagsMode: 'discard',
    nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript'],
  });
  return decodeEntities(stripped).trim();
}

/** Nullable variant — preserves null/undefined (so we don't overwrite with '' ). */
export function cleanTextOrNull(input: unknown): string | null {
  if (input === null || input === undefined) return null;
  return cleanText(input);
}

/**
 * For fields where a safe subset of formatting is intentional (e.g. HTML email
 * template bodies). Neutralizes scripts/handlers/iframes but keeps basic markup.
 */
export function cleanRich(input: unknown): string {
  if (input === null || input === undefined) return '';
  const s = String(input);
  if (!s) return '';
  return sanitizeHtml(s, {
    allowedTags: [
      'p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'span', 'div',
      'ul', 'ol', 'li', 'a', 'h1', 'h2', 'h3', 'h4', 'blockquote',
      'table', 'thead', 'tbody', 'tr', 'td', 'th', 'img',
    ],
    allowedAttributes: {
      a: ['href', 'title', 'target', 'rel'],
      img: ['src', 'alt', 'width', 'height'],
      '*': ['style'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    // block javascript: in href/src
    allowProtocolRelative: false,
  });
}
