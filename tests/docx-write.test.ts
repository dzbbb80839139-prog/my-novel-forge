/**
 * docx 生成单测：结构合法性 + 往返可读性。
 *
 * 关键约束：生成的包必须能被自家 extractDocxText 读回同样的正文。
 * docx 是个 zip，结构错了 Word 打不开；这条往返断言是最省事的守门人。
 */
import { describe, it, expect } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { buildDocx } from '../src/docx-write.ts'
import { extractDocxText } from '../src/docx.ts'

const chapters = [
  { no: 1, title: '雨夜', body: '第一段正文。\n\n第二段正文，含 & < > 等符号。' },
  { no: 2, title: '出城', body: '第二章正文。' },
]

describe('buildDocx', () => {
  it('包含 docx 必需部件', () => {
    const files = unzipSync(buildDocx('测试书', chapters))
    for (const name of [
      '[Content_Types].xml',
      '_rels/.rels',
      'word/document.xml',
      'word/styles.xml',
      'word/_rels/document.xml.rels',
      'docProps/core.xml',
      'docProps/app.xml',
    ]) {
      expect(files[name], name).toBeInstanceOf(Uint8Array)
    }
  })

  it('往返可读：正文与章节标题都能被 extractDocxText 提回', () => {
    const text = extractDocxText(buildDocx('测试书', chapters))
    expect(text).toContain('测试书')
    expect(text).toContain('第1章 雨夜')
    expect(text).toContain('第一段正文。')
    expect(text).toContain('第二段正文，含 & < > 等符号。')
    expect(text).toContain('第2章 出城')
    expect(text).toContain('第二章正文。')
  })

  it('特殊字符被正确转义，不破坏 XML', () => {
    const files = unzipSync(buildDocx('书<&>', [{ no: 1, title: 'A&B', body: 'x < y & z > w' }]))
    const xml = strFromU8(files['word/document.xml']!)
    expect(xml).toContain('&amp;')
    expect(xml).toContain('&lt;')
    expect(xml).not.toContain('x < y')
  })

  it('空行不产出空段落', () => {
    const files = unzipSync(buildDocx('书', [{ no: 1, title: 'T', body: '甲\n\n\n乙' }]))
    const xml = strFromU8(files['word/document.xml']!)
    // 甲、乙各一个段落；标题 1 个；书名 1 个 = 4 个 <w:p>
    expect((xml.match(/<w:p>/g) ?? []).length).toBe(4)
  })
})
