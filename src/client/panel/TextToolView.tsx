/**
 * 灵感策划 · 文本工具：蒸馏（从范文提炼风格/套路）/ 洗稿（改写去重）。
 * 两个子页共用本组件，靠 mode 区分标题、提示与调用的 API。
 */
import { useState } from 'react'
import type { NovelApi } from '../api.ts'
import css from './panel.module.css'
import { SubPage } from './SubPage.tsx'
import TextFilePicker from './TextFilePicker.tsx'

export default function TextToolView({ api, mode }: { api: NovelApi; mode: 'distill' | 'rewrite' }): JSX.Element {
  const isDistill = mode === 'distill'
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState('')

  const run = async (): Promise<void> => {
    if (text.trim().length < 50) { setError('文本太短（<50 字），请粘贴更完整的内容'); return }
    setBusy(true); setError('')
    try {
      const r = isDistill ? await api.distillText(text.trim()) : await api.rewriteText(text.trim())
      setResult(r.result)
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  const copy = async (): Promise<void> => {
    try { await navigator.clipboard.writeText(result); setError('') } catch (e) { setError('复制失败：' + (e as Error).message) }
  }

  return (
    <SubPage
      title={isDistill ? '蒸馏' : '洗稿'}
      meta={isDistill
        ? '粘贴一段范文 → 提炼可迁移的题材基调、结构套路、爽点钩子与语言风格 DNA。'
        : '粘贴一段正文 → 在不改变原意与设定的前提下改写去重、换种说法。'}
      actions={(
        <button type="button" className={`${css.button} ${css.buttonPrimary}`} disabled={busy} onClick={() => { void run() }}>
          {busy ? '处理中…' : (isDistill ? '开始蒸馏' : '开始洗稿')}
        </button>
      )}
    >
      <div className={`${css.card} ${css.settingsCard}`} style={{ gap: 'var(--nf-space-10)' }}>
        <TextFilePicker onText={(t) => { setText(t); setError('') }} onError={setError} />
        <span className={css.meta}>{isDistill ? '把想拆解的范文粘进来或拖入文件（docx / md / txt，50 字以上）。' : '把要改写的段落粘进来或拖入文件（docx / md / txt，50 字以上）。'}</span>
        <textarea className={css.input} style={{ minHeight: 180, resize: 'vertical' }} value={text} onChange={e => setText(e.target.value)} placeholder={isDistill ? '在此粘贴范文正文…' : '在此粘贴需要洗稿的正文…'} spellCheck={false} />
      </div>

      {error !== '' && <div style={{ color: 'var(--nf-error)', fontSize: 13 }}> {error}</div>}

      {result !== '' && (
        <div className={`${css.card} ${css.settingsCard}`} style={{ gap: 'var(--nf-space-8)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className={css.fieldLabel}>{isDistill ? '蒸馏报告' : '改写结果'}</span>
            <button type="button" className={`${css.button} ${css.buttonSmall}`} onClick={() => { void copy() }} title="复制结果">复制</button>
          </div>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, fontSize: 13, lineHeight: 1.7 }}>{result}</pre>
        </div>
      )}
    </SubPage>
  )
}
