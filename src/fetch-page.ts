/**
 * 轻量网页抓取（自研，不依赖任何宿主插件）。
 *
 * 为什么要自己写：原先「从网址抓榜单」借道 dsh-read-url 注册的 read_url 工具，
 * 那个插件没装/没起来就整个功能失效。工坊要能独立使用，抓取必须自带。
 *
 * 取舍：只做「够用」——取正文文本，不做浏览器渲染、不跟分页、不抽结构化元数据。
 * 中文站点的编码是这里唯一的硬骨头：Node fetch 默认按 UTF-8 解，GBK 站点会乱码，
 * 所以按 Content-Type → <meta charset> → 试解法的顺序嗅探。
 */

/** 抓取结果。 */
export interface FetchedPage {
  url: string
  title: string
  text: string
  charset: string
  truncated: boolean
}

/** 单页文本上限：榜单页通常几 KB，给 60 万字符足够，也防超大页面撑爆内存。 */
const MAX_CHARS = 600_000
/** 只接受 http/https，避免 file:// 之类的本地读取。 */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])

/** 从 Content-Type 或 HTML 头部的 meta 里嗅探 charset。 */
function sniffCharset(buffer: Uint8Array, contentType: string): string {
  const headerMatch = /charset=["']?([\w-]+)/i.exec(contentType)
  if (headerMatch !== null) return headerMatch[1]!.toLowerCase()
  // meta 只在前 4KB 内找（标准要求声明在头部）。
  const head = new TextDecoder('utf-8', { fatal: false }).decode(buffer.subarray(0, 4096))
  const metaMatch =
    /<meta[^>]+charset=["']?\s*([\w-]+)/i.exec(head) ??
    /<meta[^>]+content=["'][^"']*charset=([\w-]+)/i.exec(head)
  if (metaMatch !== null) return metaMatch[1]!.toLowerCase()
  return ''
}

/** 按 charset 解码；未知/无效编码回退 UTF-8。 */
function decodeBuffer(buffer: Uint8Array, charset: string): string {
  if (charset !== '') {
    try {
      return new TextDecoder(charset, { fatal: false }).decode(buffer)
    } catch {
      // 不支持的编码标签，落到下面的回退。
    }
  }
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buffer)
  // UTF-8 解出替换字符说明不是 UTF-8，中文站点大概率是 GBK。
  return utf8.includes('\uFFFD') ? new TextDecoder('gbk', { fatal: false }).decode(buffer) : utf8
}

/** 常见 HTML 实体反转义（够用即可，不做全表）。 */
function decodeEntities(text: string): string {
  const named: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', hellip: '…', mdash: '—', ndash: '–',
  }
  return text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (whole, name: string) => named[name.toLowerCase()] ?? whole)
}

/**
 * HTML → 纯文本。
 * 丢 script/style/noscript/注释与导航类容器，块级标签转换行，最终压掉多余空行。
 */
function htmlToText(html: string): string {
  let out = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|iframe)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(nav|header|footer|aside|form)\b[\s\S]*?<\/\1>/gi, ' ')
  // 块级标签与 <br> 断行，其余标签直接去掉。
  out = out
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|table|ul|ol|blockquote|dd|dt)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
  out = decodeEntities(out)
  // 按行清理：去首尾空白、压连续空格、丢掉空行。
  const lines = out
    .split('\n')
    .map(line => line.replace(/[ \t\u00a0]+/g, ' ').trim())
    .filter(line => line !== '')
  return lines.join('\n')
}

/** 取 <title>。 */
function extractTitle(html: string): string {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  return match === null ? '' : decodeEntities(match[1]!).replace(/\s+/g, ' ').trim()
}

/**
 * 抓取一个网页并抽出正文。
 * @param rawUrl - 目标地址（仅 http/https）。
 * @param timeoutMs - 超时，默认 20 秒。
 * @throws 协议不允许、网络失败、HTTP 非 2xx 时抛错，错误文案可直接展示给作者。
 */
export async function fetchPage(rawUrl: string, timeoutMs = 20_000): Promise<FetchedPage> {
  let parsed: URL
  try {
    parsed = new URL(rawUrl.trim())
  } catch {
    throw new Error('网址格式不对，需要以 http:// 或 https:// 开头')
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(`不支持的协议 ${parsed.protocol}，只能用 http 或 https`)
  }

  let response: Response
  try {
    response = await fetch(parsed, {
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        // 不少榜单页对无 UA 的请求直接拒绝。
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
        'accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'accept-language': 'zh-CN,zh;q=0.9',
      },
    })
  } catch (error) {
    const message = (error as Error).message
    throw new Error(
      /timeout|abort/i.test(message)
        ? `抓取超时（${Math.round(timeoutMs / 1000)} 秒），该站可能较慢或不可达`
        : `抓取失败：${message}`,
    )
  }
  if (!response.ok) throw new Error(`目标站点返回 HTTP ${response.status}`)

  const buffer = new Uint8Array(await response.arrayBuffer())
  const contentType = response.headers.get('content-type') ?? ''
  const charset = sniffCharset(buffer, contentType)
  const raw = decodeBuffer(buffer, charset)

  // JSON 接口直接格式化，不做 HTML 处理。
  if (/json/i.test(contentType)) {
    const text = raw.trim()
    return { url: parsed.toString(), title: '', text: text.slice(0, MAX_CHARS), charset: charset || 'utf-8', truncated: text.length > MAX_CHARS }
  }

  const text = htmlToText(raw)
  const truncated = text.length > MAX_CHARS
  return {
    url: parsed.toString(),
    title: extractTitle(raw),
    text: truncated ? text.slice(0, MAX_CHARS) : text,
    charset: charset || 'utf-8(推断)',
    truncated,
  }
}
