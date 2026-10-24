// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { renderDescription } from './sanitize'

describe('renderDescription', () => {
  it('renders markdown', () => {
    expect(renderDescription({ format: 'markdown', body: '# Hi\n\n**bold**' })).toContain(
      '<strong>bold</strong>'
    )
  })

  it('strips scripts, handlers, iframes, forms, styles and javascript links', () => {
    const out = renderDescription({
      format: 'html',
      body: '<p onclick="x()" style="color:red">a</p><script>alert(1)</script><iframe src="https://x"></iframe><form><input></form><a href="javascript:alert(1)">j</a><img src="x" onerror="y()">'
    })
    for (const bad of [
      'onclick',
      'style=',
      '<script',
      '<iframe',
      '<form',
      '<input',
      'javascript:',
      'onerror'
    ]) {
      expect(out).not.toContain(bad)
    }
  })

  it('opens links in a new window and upgrades protocol-relative images', () => {
    const out = renderDescription({
      format: 'html',
      body: '<a href="https://ex.com">x</a><img src="//proxy.spigotmc.org/a.png">'
    })
    expect(out).toContain('target="_blank"')
    expect(out).toContain('rel="noopener noreferrer"')
    expect(out).toContain('src="https://proxy.spigotmc.org/a.png"')
  })

  it('drops non-https images', () => {
    expect(renderDescription({ format: 'html', body: '<img src="http://x/a.png">' })).not.toContain(
      '<img'
    )
  })

  it('removes the href from protocol-relative links', () => {
    const out = renderDescription({ format: 'html', body: '<a href="//evil.com">x</a>' })
    expect(out).not.toContain('href')
    expect(out).not.toContain('evil.com')
  })

  it('removes data: images', () => {
    const out = renderDescription({
      format: 'html',
      body: '<img src="data:image/png;base64,AAAA">'
    })
    expect(out).not.toContain('<img')
    expect(out).not.toContain('data:')
  })
})
