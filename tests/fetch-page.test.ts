/**
 * 网页抓取器单测：编码嗅探、正文抽取、错误处理。
 *
 * 关键约束：中文榜单站常见 GBK，Node fetch 默认按 UTF-8 解会乱码——
 * 这里把 GBK 用例钉死，防止以后改动悄悄退化成乱码。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchPage } from '../src/fetch-page.ts'

/** GBK 编码的「中文」两字（D6 D0 CE C4）。 */
const GBK_ZHONGWEN = new Uint8Array([0xd6, 0xd0, 0xce, 0xc4])

function mockHtml(html: string, contentType = 'text/html; charset=utf-8', status = 200): void {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(html, { status, headers: { 'content-type': contentType } })))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchPage', () => {
  it('抽取正文：去掉 script/style/导航，块级标签转换行', async () => {
    mockHtml(`<html><head><title>番茄榜单</title></head><body>
      <nav>导航栏文字</nav>
      <script>var a = 1;</script>
      <div>第一本</div>
      <p>第二本</p>
      <style>.x{}</style>
    </body></html>`)
    const page = await fetchPage('https://example.com/list')
    expect(page.title).toBe('番茄榜单')
    expect(page.text).toContain('第一本')
    expect(page.text).toContain('第二本')
    // 导航、脚本、样式内容不应混进正文
    expect(page.text).not.toContain('导航栏文字')
    expect(page.text).not.toContain('var a = 1')
    expect(page.text).not.toContain('.x{}')
  })

  it('按 Content-Type 里的 charset 解 GBK 页面', async () => {
    const body = new Uint8Array([...GBK_ZHONGWEN])
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=gbk' } })))
    const page = await fetchPage('https://example.com/gbk')
    expect(page.text).toBe('中文')
    expect(page.charset).toBe('gbk')
  })

  it('没有 Content-Type charset 时，靠 meta charset 识别 GBK', async () => {
    // <meta charset="gbk"><p> + GBK「中文」
    const head = new TextEncoder().encode('<html><head><meta charset="gbk"></head><body><p>')
    const tail = new TextEncoder().encode('</p></body></html>')
    const body = new Uint8Array(head.length + GBK_ZHONGWEN.length + tail.length)
    body.set(head, 0)
    body.set(GBK_ZHONGWEN, head.length)
    body.set(tail, head.length + GBK_ZHONGWEN.length)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200, headers: { 'content-type': 'text/html' } })))
    const page = await fetchPage('https://example.com/gbk-meta')
    expect(page.text).toBe('中文')
  })

  it('HTML 实体被还原', async () => {
    mockHtml('<html><body><p>A&amp;B &lt;C&gt; &#20320;&#22909;</p></body></html>')
    const page = await fetchPage('https://example.com/entity')
    expect(page.text).toContain('A&B <C> 你好')
  })

  it('JSON 接口直接返回原文', async () => {
    mockHtml('{"list":[1,2]}', 'application/json')
    const page = await fetchPage('https://example.com/api')
    expect(page.text).toBe('{"list":[1,2]}')
  })

  it('拒绝非 http/https 协议', async () => {
    await expect(fetchPage('file:///C:/Windows/win.ini')).rejects.toThrow(/不支持的协议/)
  })

  it('HTTP 非 2xx 时报出状态码', async () => {
    mockHtml('not found', 'text/html', 404)
    await expect(fetchPage('https://example.com/missing')).rejects.toThrow(/HTTP 404/)
  })

  it('网址格式错误时给出可读提示', async () => {
    await expect(fetchPage('这不是网址')).rejects.toThrow(/网址格式不对/)
  })
})
