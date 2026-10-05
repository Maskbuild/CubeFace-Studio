import { useEffect, useState, type ReactNode } from 'react'
import { create } from 'zustand'
import { useTranslation } from 'react-i18next'

export function Modal({ title, children, footer, onClose }: { title: ReactNode; children: ReactNode; footer?: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal>
        <header>{title}</header>
        <div className="body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  )
}

// ---- promise-based confirm + toast -------------------------------------------------------
interface ConfirmReq {
  message: string
  buttons: { label: string; value: string; kind?: 'primary' | 'danger' }[]
  resolve: (v: string | null) => void
  input?: string // when set, show a text field; the OK button resolves with its value
}

const useDialogs = create<{ confirm: ConfirmReq | null; toast: string | null }>(() => ({ confirm: null, toast: null }))

export function ask(message: string, buttons: ConfirmReq['buttons']): Promise<string | null> {
  return new Promise((resolve) => useDialogs.setState({ confirm: { message, buttons, resolve } }))
}

/** Text prompt (window.prompt does not exist in Electron). */
export function promptBox(message: string, initial: string, okLabel: string, cancelLabel: string): Promise<string | null> {
  return new Promise((resolve) =>
    useDialogs.setState({ confirm: { message, input: initial, buttons: [{ label: cancelLabel, value: '\u0000cancel' }, { label: okLabel, value: '\u0000ok', kind: 'primary' }], resolve } })
  )
}

export async function confirmBox(message: string, okLabel: string, cancelLabel: string, danger = false) {
  return (await ask(message, [{ label: cancelLabel, value: 'cancel' }, { label: okLabel, value: 'ok', kind: danger ? 'danger' : 'primary' }])) === 'ok'
}

let toastTimer: ReturnType<typeof setTimeout> | undefined
export function toast(msg: string) {
  clearTimeout(toastTimer)
  useDialogs.setState({ toast: msg })
  toastTimer = setTimeout(() => useDialogs.setState({ toast: null }), 2400)
}

export function DialogHost() {
  const { confirm, toast: msg } = useDialogs()
  const { t } = useTranslation()
  const [text, setText] = useState('')
  useEffect(() => setText(confirm?.input ?? ''), [confirm])
  const done = (v: string | null) => {
    if (confirm?.input !== undefined) v = v === '\u0000ok' ? text : null
    confirm?.resolve(v)
    useDialogs.setState({ confirm: null })
  }
  return (
    <>
      {confirm && (
        <Modal
          title={t('app.title')}
          onClose={() => done(null)}
          footer={confirm.buttons.map((b) => (
            <button key={b.value} className={'btn ' + (b.kind === 'primary' ? 'primary' : b.kind === 'danger' ? 'danger' : '')} onClick={() => done(b.value)} autoFocus={b.kind === 'primary'}>
              {b.label}
            </button>
          ))}
        >
          <div style={{ whiteSpace: 'pre-wrap' }}>{confirm.message}</div>
          {confirm.input !== undefined && (
            <input className="input" autoFocus value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && done('\u0000ok')} />
          )}
        </Modal>
      )}
      {msg && <div className="toast">{msg}</div>}
    </>
  )
}
