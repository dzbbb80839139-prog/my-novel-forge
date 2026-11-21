/**
 * docx 生成：把书稿写成 .docx。
 *
 * 与 ./docx.ts（读 docx）对称。不依赖任何 Office 库或宿主插件——.docx 本质是
 * 一个 zip，内含 [Content_Types].xml / _rels/.rels / word/document.xml 等，
 * 用 fflate 打 zip 即可。样式在 word/styles.xml 里定义（书名用 Title、
 * 章标题用 Heading1、正文用 Normal 并设首行缩进两字符）。
 */

import { zipSync, strToU8 } from 'fflate'

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

/** XML 文本转义（正文里可能出现 & < > 引号）。 */
function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** 一个段落。<w:t xml:space="preserve"> 保住行首行尾空格。 */
function para(text: string, style?: string): string {
  const pPr = style !== undefined ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''
  const run = text === ''
    ? ''
    : `<w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`
  return `<w:p>${pPr}${run}</w:p>`
}

/** 章标题（Heading1，居中，段前分页）。 */
function chapterHead(text: string): string {
  return `<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:pageBreakBefore/></w:pPr><w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`
}

const CONTENT_TYPES = `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`

const ROOT_RELS = `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`

const DOCUMENT_RELS = `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`

/** 样式：Normal 为中文正文（宋体、小四、首行缩进 2 字符、1.5 倍行距）。 */
const STYLES = `${XML_HEAD}<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults>
<w:rPrDefault><w:rPr>
<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体" w:cs="Times New Roman"/>
<w:sz w:val="24"/><w:szCs w:val="24"/>
<w:lang w:val="en-US" w:eastAsia="zh-CN"/>
</w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:line="360" w:lineRule="auto"/><w:jc w:val="both"/></w:pPr></w:pPrDefault>
</w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal">
<w:name w:val="Normal"/><w:qFormat/>
<w:pPr><w:ind w:firstLineChars="200" w:firstLine="480"/></w:pPr>
</w:style>
<w:style w:type="paragraph" w:styleId="Title">
<w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/>
<w:pPr><w:jc w:val="center"/><w:spacing w:before="240" w:after="240"/><w:ind w:firstLineChars="0" w:firstLine="0"/></w:pPr>
<w:rPr><w:b/><w:sz w:val="44"/><w:szCs w:val="44"/></w:rPr>
</w:style>
<w:style w:type="paragraph" w:styleId="Heading1">
<w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:qFormat/>
<w:pPr><w:jc w:val="center"/><w:spacing w:before="240" w:after="240"/><w:ind w:firstLineChars="0" w:firstLine="0"/><w:outlineLvl w:val="0"/></w:pPr>
<w:rPr><w:b/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr>
</w:style>
</w:styles>`

/** 一本书的一章（已读出的正文）。 */
export interface DocxChapter {
  no: number
  title: string
  body: string
}

/**
 * 生成 .docx 字节。
 * @param bookName - 书名（作 Title 段落）。
 * @param chapters - 章节列表，正文按行拆段（空行忽略）。
 * @returns zip 字节，可直接写盘。
 */
export function buildDocx(bookName: string, chapters: readonly DocxChapter[]): Uint8Array {
  const parts: string[] = [para(bookName, 'Title')]
  for (const chapter of chapters) {
    parts.push(chapterHead(`第${chapter.no}章 ${chapter.title}`))
    for (const line of chapter.body.split(/\r?\n/)) {
      const text = line.trim()
      if (text !== '') parts.push(para(text))
    }
  }
  const documentXml = `${XML_HEAD}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${parts.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1800" w:bottom="1440" w:left="1800" w:header="851" w:footer="992" w:gutter="0"/></w:sectPr></w:body></w:document>`

  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  const core = `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(bookName)}</dc:title><dc:creator>my-novel-forge</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`
  const app = `${XML_HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>my-novel-forge</Application></Properties>`

  return zipSync(
    {
      '[Content_Types].xml': strToU8(CONTENT_TYPES),
      '_rels/.rels': strToU8(ROOT_RELS),
      'word/document.xml': strToU8(documentXml),
      'word/styles.xml': strToU8(STYLES),
      'word/_rels/document.xml.rels': strToU8(DOCUMENT_RELS),
      'docProps/core.xml': strToU8(core),
      'docProps/app.xml': strToU8(app),
    },
    { level: 6 },
  )
}
