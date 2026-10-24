import DOMPurify from 'dompurify'
import { marked } from 'marked'

let hooked = false

function installHooks(): void {
  if (hooked) return
  hooked = true
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      const href = node.getAttribute('href') ?? ''
      if (!/^(https?:|mailto:)/i.test(href)) node.removeAttribute('href')
      node.setAttribute('target', '_blank')
      node.setAttribute('rel', 'noopener noreferrer')
    }
    if (node.tagName === 'IMG') {
      let src = node.getAttribute('src') ?? ''
      if (src.startsWith('//')) src = `https:${src}`
      if (!src.startsWith('https://')) node.remove()
      else node.setAttribute('src', src)
    }
  })
}

/** Project descriptions come from third parties: render to HTML and strip anything active. */
export function renderDescription(d: { format: 'markdown' | 'html'; body: string }): string {
  installHooks()
  const html = d.format === 'markdown' ? (marked.parse(d.body, { async: false }) as string) : d.body
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: [
      'style',
      'iframe',
      'form',
      'input',
      'button',
      'textarea',
      'select',
      'object',
      'embed',
      'video',
      'audio'
    ],
    FORBID_ATTR: ['style']
  })
}
