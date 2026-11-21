/**
 * 通用文本文件选择器：支持 docx / md / txt 的选择与拖放，读取纯文本后回传。
 * 供书分析、蒸馏、洗稿等"粘贴文本"页复用，避免各页重复解析逻辑。
 */
import { useRef, useState } from 'react'
import { extractDocxTextFromBuffer } from '../docx.ts'
import css from './panel.module.css'

const ACCEPT = '.docx,.md,.txt,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/markdown,text/plain'

export default function TextFilePicker({ onText, onError }: { onText: (text: string, name: string) => void; onError?: (msg: string) => void }): JSX.Element {
  const [dragActive, setDragActive] = useState(false)
  const [name, setName] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  const pick = async (file: File | undefined): Promise<void> => {
    if (file === undefined) return
    try {
      const ext = file.name.toLowerCase().split('.').pop() ?? ''
      let text: string
      if (ext === 'docx') {
        text = extractDocxTextFromBuffer(await file.arrayBuffer())
      } else if (ext === 'md' || ext === 'txt') {
        text = new TextDecoder('utf-8').decode(await file.arrayBuffer()).replace(/^\uFEFF/, '')
      } else {
        const msg = '仅支持 docx / md / txt 文件'
        onError?.(msg); return
      }
      if (text.trim().length < 50) {
        onError?.('文件内容过短（<50 字符），请检查文件'); return
      }
      setName(file.name)
      onText(text, file.name)
      onError?.('')
    } catch (err) {
      onError?.(`读取文件失败：${(err as Error).message}`)
    }
  }

  return (
    <div
      className={`${css.dropzone} ${dragActive ? css.dropzoneActive : ''}`}
      role="button"
      tabIndex={0}
      aria-label="选择或拖入 docx / md / txt 文件"
      onClick={() => { inputRef.current?.click() }}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click() } }}
      onDragOver={e => { e.preventDefault(); setDragActive(true) }}
      onDragLeave={() => { setDragActive(false) }}
      onDrop={e => {
        e.preventDefault()
        setDragActive(false)
        void pick(e.dataTransfer.files?.[0])
      }}
    >
      <span className={css.dropzoneIcon}>⇪</span>
      <span>{name !== '' ? `已载入：${name}` : '点击选择 docx / md / txt 文件，或将文件拖到这里'}</span>
      <span className={css.meta}>读取后填入下方文本框，可继续编辑</span>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        style={{ display: 'none' }}
        onChange={e => {
          void pick(e.target.files?.[0])
          e.target.value = ''
        }}
      />
    </div>
  )
}
