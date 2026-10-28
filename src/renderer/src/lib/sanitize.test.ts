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

  it('removes srcset, background, svg and picture/source vectors', () => {
    const out = renderDescription({
      format: 'html',
      body: '<img src="https://a/x.png" srcset="http://evil/a.png 2x"><table background="http://evil/b.png"><tr><td>t</td></tr></table><svg><image href="http://evil/c.png"></image><a href="https://evil">s</a></svg><picture><source srcset="http://evil/d.png"></picture>'
    })
    for (const bad of ['srcset', 'background', 'evil', '<svg', '<image', '<picture', '<source']) {
      expect(out).not.toContain(bad)
    }
  })

  it('strips class, id and name', () => {
    const out = renderDescription({
      format: 'html',
      body: '<div class="fixed inset-0 z-50" id="root" name="x">a</div><a name="y">b</a>'
    })
    for (const bad of ['class=', 'id=', 'name=']) expect(out).not.toContain(bad)
  })

  it('drops javascript: hrefs from markdown and obfuscated html, keeps mailto:', () => {
    expect(
      renderDescription({ format: 'markdown', body: '[x](javascript:alert(1))' })
    ).not.toContain('javascript:')
    expect(
      renderDescription({ format: 'html', body: '<a href=" JAVASCRIPT:alert(1)">x</a>' })
    ).not.toMatch(/href/i)
    expect(renderDescription({ format: 'html', body: '<a href="mailto:a@b.co">m</a>' })).toContain(
      'href="mailto:a@b.co"'
    )
  })
})
