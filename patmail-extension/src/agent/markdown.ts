import DOMPurify from 'dompurify'
import { marked, type Tokens } from 'marked'

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** 模型常把加粗写成 `** 文字 **`。围栏和行内代码不动。 */
function normalizeModelMarkdown(source: string): string {
  return source.split(/(```[\s\S]*?```|`[^`\n]+`)/g).map((chunk, index) => {
    if (index % 2 === 1) return chunk
    return chunk
      .replace(/\*\*[ \t]+([^*\n]+?)[ \t]+\*\*/g, '**$1**')
      .replace(/__[ \t]+([^_\n]+?)[ \t]+__/g, '__$1__')
  }).join('')
}

marked.use({
  gfm: true,
  breaks: true,
  renderer: {
    html({ text }: Tokens.HTML | Tokens.Tag) {
      return escapeHtml(text)
    },
    link(this: { parser: { parseInline: (tokens: Token[]) => string } }, token: Tokens.Link) {
      const inner = this.parser.parseInline(token.tokens)
      if (!/^(?:https?:|mailto:)/i.test(token.href)) return inner
      return `<a href="${escapeHtml(token.href)}" target="_blank" rel="noopener noreferrer nofollow">${inner}</a>`
    },
    image({ text }: Tokens.Image) {
      return escapeHtml(text)
    }
  }
})

type Token = Tokens.Link['tokens'][number]

const ALLOWED_TAGS = ['a', 'blockquote', 'br', 'code', 'del', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'input', 'li', 'ol', 'p', 'pre', 'strong', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'ul']

/** 助手回复按 GFM 排版。原文里的标签先转义，输出再消毒，不执行。 */
export function renderAgentMarkdown(source: string): string {
  if (!source.trim()) return ''
  const parsed = marked.parse(normalizeModelMarkdown(source), { async: false })
  return DOMPurify.sanitize(parsed, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ['href', 'target', 'rel', 'colspan', 'rowspan', 'align', 'type', 'checked', 'disabled']
  })
}
