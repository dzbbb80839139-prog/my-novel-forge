/**
 * 书名全网搜索的解析契约。
 *
 * 夹具是**真实抓取**的公开搜索结果页（起点 UTF-8 / 晋江 GBK 字节），
 * 不是手写的理想 HTML——平台 class 带构建哈希、晋江关键词标红拆成多个 span，
 * 这些真实特征只有拿真页面才能钉住。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseQidianSearch, parseJinjiangSearch } from '../src/market-radar-search.ts'

const qidianHtml = readFileSync(new URL('./fixtures/qidian-search.html', import.meta.url), 'utf8')
const jinjiangBytes = readFileSync(new URL('./fixtures/jinjiang-search-gbk.html', import.meta.url))
const jinjiangHtml = new TextDecoder('gb18030').decode(jinjiangBytes)

describe('起点书名搜索解析', () => {
  const items = parseQidianSearch(qidianHtml, '凡人修仙')

  it('从真实页面解析出多条结果', () => {
    expect(items.length).toBeGreaterThan(5)
    expect(items.length).toBeLessThanOrEqual(20)
  })

  it('书名/作者/简介/标签/链接都取到', () => {
    const first = items.find(i => i.title.includes('凡人修仙'))
    expect(first).toBeDefined()
    expect(first!.author).toBeTruthy()
    expect(first!.synopsis).toBeTruthy()
    expect(first!.tags.length).toBeGreaterThan(0)
    expect(first!.sourceUrl).toMatch(/^https:\/\/m\.qidian\.com\/book\/\d+\/$/)
  })

  it('标红书名（<mark>凡人修仙</mark>！）拼回完整书名', () => {
    expect(items.some(i => i.title === '凡人修仙！')).toBe(true)
    expect(items.some(i => i.title === '凡人修仙传')).toBe(true)
  })

  it('连载状态从标签里提取', () => {
    expect(items.some(i => i.serialStatus === '连载' || i.serialStatus === '完结')).toBe(true)
  })

  it('没有 searchResult 容器时不误把整页当结果', () => {
    expect(parseQidianSearch('<html><body><div class="y-list__item">x</div></body></html>', 'x')).toEqual([])
  })
})

describe('晋江书名搜索解析', () => {
  const items = parseJinjiangSearch(jinjiangHtml, '凡人修仙')

  it('从 GBK 页面解析出多条结果', () => {
    expect(items.length).toBeGreaterThan(5)
    expect(items.length).toBeLessThanOrEqual(20)
  })

  it('标红关键词拆成多个 span 后书名仍完整', () => {
    expect(items.some(i => i.title === '凡人修仙传')).toBe(true)
  })

  it('作者与 sourceUrl 正确', () => {
    expect(items.some(i => i.author !== undefined)).toBe(true)
    for (const item of items) {
      expect(item.sourceUrl).toMatch(/^https:\/\/m\.jjwxc\.net\/book2\/\d+$/)
    }
  })
})
