/**
 * 热门题材雷达：按书名全网搜索（起点 / 晋江）。
 *
 * 与「榜单扫榜」的区别：扫榜抓固定榜单页；这里按作者输入的书名去平台的**搜索页**
 * 抓取匹配的书，让榜单外的作品也能进分析。
 *
 * 番茄为何没接入（2026-11-22 实测取证，别再试）：
 *  - 榜单页 fanqienovel.com/rank 公开可抓（扫榜用它），但它不接受书名参数；
 *  - 用户搜索页 /search* 全返回 404；
 *  - 前端 JS 里唯一的搜索端点是 /api/author/search/search_book/v1，属**作者后台**，
 *    未登录时服务端返回 404（响应头 X-Tt-Agw-Login: 0），需要登录态，不能匿名调用。
 * 结论：番茄只能扫榜，不能按书名全网搜；等它有公开搜索端点再接。
 *
 * 结果结构与榜单条目对齐（CollectedRankingItem），这样前端勾候选、送分析的代码
 * 可以完全复用，只是 rank 用搜索序号代替。
 */
import {
  hasPrivateUseCharacters,
  plainText,
  type CollectedRankingItem,
  type MarketRadarPlatform,
} from './market-radar-sources.ts'

export interface BookSearchHit extends CollectedRankingItem {
  platform: MarketRadarPlatform
  platformLabel: string
}

export interface BookSearchResult {
  keyword: string
  searchedAt: string
  hits: BookSearchHit[]
  errors: Array<{ platform: MarketRadarPlatform; message: string }>
}

const MAX_HITS = 20

/** 起点移动版搜索：结果条目是 .y-list__item，书名/作者/简介/标签各有独立 class。 */
export function parseQidianSearch(html: string, _keyword: string): CollectedRankingItem[] {
  const SEARCH_ROOT = 'id="searchResult"'
  const root = html.indexOf(SEARCH_ROOT)
  const body = root === -1 ? html : html.slice(root)
  const blocks = body.match(/<div class="y-list__item"[\s\S]*?(?=<div class="y-list__item"|<\/body>|$)/g) ?? []
  return blocks.slice(0, MAX_HITS).flatMap((block, index) => {
    const bid = block.match(/data-bid="(\d+)"/)?.[1]
    // class 名带构建哈希（如 _searchBookName_lrbl7_250），用前缀匹配而不是写死。
    const nameMatch = block.match(/class="_searchBookName_[^"]*"[^>]*>([\s\S]*?)<\/h2>/)
    // <mark>关键词</mark>后缀 会被拆成带空格的片段；中文书名不该含空格，统一去掉。
    const title = plainText(nameMatch?.[1]).replace(/\s+/g, '')
    if (bid === undefined || title === '' || hasPrivateUseCharacters(title)) return []
    const synopsis = plainText(block.match(/class="_searchBookDesc_[^"]*"[^>]*>([\s\S]*?)<\/p>/)?.[1])
    const tagsBlock = block.match(/class="_tags_[^"]*"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? ''
    const tags = Array.from(tagsBlock.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g))
      .map(m => plainText(m[1])).filter(Boolean).slice(0, 8)
    return [{
      rank: index + 1,
      title,
      author: plainText(block.match(/class="_searchBookAuthor_[^"]*"[^>]*>([\s\S]*?)<\/p>/)?.[1]) || undefined,
      category: tags[0],
      tags,
      synopsis: synopsis && !hasPrivateUseCharacters(synopsis) ? synopsis.slice(0, 800) : undefined,
      serialStatus: tags.find(t => t === '连载' || t === '完结'),
      sourceUrl: `https://m.qidian.com/book/${bid}/`,
    }]
  })
}

/** 晋江搜索：<li> 里书链 + 作者链；页面 GBK 编码由调用方解码后传入。 */
export function parseJinjiangSearch(html: string, _keyword: string): CollectedRankingItem[] {
  const blocks = html.match(/<li>\s*<a[^>]*href="\/book2\/\d+"[\s\S]*?<\/a>[\s\S]*?<\/li>/g) ?? []
  return blocks.slice(0, MAX_HITS).flatMap((block, index) => {
    const book = block.match(/href="(\/book2\/\d+)"/)
    if (book === null) return []
    // 书名用多个 <span style="color:red"> 逐字标红关键词，标签之间夹着空白；
    // 中文书名里不该有空格，所以去标签后把空白全去掉（"凡 人 修 仙 传" → "凡人修仙传"）。
    const rawTitle = plainText(block.match(/<a[^>]*href="\/book2\/\d+"[^>]*>([\s\S]*?)<\/a>/)?.[1])
    const title = rawTitle.replace(/\s+/g, '')
    if (title === '' || hasPrivateUseCharacters(title)) return []
    const author = plainText(block.match(/href="\/wapauthor\/\d+"[^>]*>([\s\S]*?)<\/a>/)?.[1])
    return [{
      rank: index + 1,
      title,
      author: author || undefined,
      tags: [],
      sourceUrl: new URL(book[1]!, 'https://m.jjwxc.net').toString(),
    }]
  })
}

/** 搜索源配置：URL 编码方式不同（晋江表单用 GBK），所以各自带 encode。 */
const SEARCH_SOURCES: Array<{
  platform: MarketRadarPlatform
  platformLabel: string
  buildUrl: (keyword: string) => string
  parse: (html: string, keyword: string) => CollectedRankingItem[]
  charset: string
}> = [
  {
    platform: 'qidian',
    platformLabel: '起点中文网',
    charset: 'utf-8',
    buildUrl: kw => `https://m.qidian.com/search?kw=${encodeURIComponent(kw)}`,
    parse: parseQidianSearch,
  },
  {
    platform: 'jinjiang',
    platformLabel: '晋江文学城',
    charset: 'gb18030',
    // 晋江表单把关键词按 GBK 百分号编码，t=1 表示按书名搜。
    buildUrl: kw => `https://m.jjwxc.net/search?version=1&kw=${gbkPercentEncode(kw)}&t=1`,
    parse: parseJinjiangSearch,
  },
]

/**
 * 把字符串按 GBK 百分号编码（晋江搜索表单要 GBK 关键词，UTF-8 会乱码）。
 *
 * Node 自带 TextDecoder 能解码 GBK，却没有对应的 encoder，且 Buffer 不支持 gbk。
 * 这里用解码器**反查**出「字符 → GBK 字节」表：遍历双字节区一次（约 56ms、2.4 万字），
 * 之后查表即可零依赖完成编码。表只在首次用到时建，进程内复用。
 * 单个汉字对应多个编码时取首见者（GBK 是 ASCII/GB2312 兼容的超集，首见即规范码）。
 */
let gbkCharToBytes: Map<string, Uint8Array> | undefined

function getGbkTable(): Map<string, Uint8Array> {
  if (gbkCharToBytes !== undefined) return gbkCharToBytes
  const decoder = new TextDecoder('gbk', { fatal: false })
  const table = new Map<string, Uint8Array>()
  for (let hi = 0x81; hi <= 0xfe; hi += 1) {
    for (let lo = 0x40; lo <= 0xfe; lo += 1) {
      if (lo === 0x7f) continue
      const bytes = new Uint8Array([hi, lo])
      const char = decoder.decode(bytes)
      if (char.length === 1 && char !== '\uFFFD' && !table.has(char)) table.set(char, bytes)
    }
  }
  gbkCharToBytes = table
  return table
}

function gbkPercentEncode(text: string): string {
  const table = getGbkTable()
  let out = ''
  for (const char of text) {
    const code = char.codePointAt(0)!
    if (code < 0x80) {
      out += encodeURIComponent(char)
      continue
    }
    const bytes = table.get(char)
    out += bytes === undefined
      ? encodeURIComponent(char) // 生僻字不在 GBK 表内，只能原样 UTF-8（搜索可能落空，但不崩）
      : Array.from(bytes).map(b => `%${b.toString(16).toUpperCase().padStart(2, '0')}`).join('')
  }
  return out
}

async function fetchSearchPage(url: string, charset: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
      'accept-language': 'zh-CN,zh;q=0.9',
    },
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const bytes = await response.arrayBuffer()
  return new TextDecoder(charset, { fatal: false }).decode(bytes)
}

/** 按书名并发搜索各平台；单平台失败只记 error，不影响其它平台结果。 */
export async function searchBooksByTitle(keyword: string, platforms?: MarketRadarPlatform[]): Promise<BookSearchResult> {
  const clean = keyword.trim().slice(0, 60)
  if (clean === '') throw new Error('书名不能为空')
  const wanted = new Set<string>(platforms?.length ? platforms : SEARCH_SOURCES.map(s => s.platform))
  const sources = SEARCH_SOURCES.filter(s => wanted.has(s.platform))
  const hits: BookSearchHit[] = []
  const errors: BookSearchResult['errors'] = []

  await Promise.all(sources.map(async (source) => {
    try {
      const html = await fetchSearchPage(source.buildUrl(clean), source.charset)
      const items = source.parse(html, clean)
      for (const item of items) hits.push({ ...item, platform: source.platform, platformLabel: source.platformLabel })
    } catch (error) {
      errors.push({ platform: source.platform, message: (error as Error).message })
    }
  }))

  hits.sort((a, b) => a.rank - b.rank)
  return { keyword: clean, searchedAt: new Date().toISOString(), hits, errors }
}
