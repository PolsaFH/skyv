import { useState, type ReactNode } from 'react'
import { Modal } from './Modal'

interface Props {
  title: string
  confirmLabel: string
  danger?: boolean
  children: ReactNode
  onCancel: () => void
  onConfirm: () => Promise<void> | void
}

export function ConfirmDialog({ title, confirmLabel, danger, children, onCancel, onConfirm }: Props) {
  const [busy, setBusy] = useState(false)
  return (
    <Modal title={title} onClose={onCancel} width={460}>
      <div className="confirm-body">{children}</div>
      <div className="form-actions">
        <button className="btn" onClick={onCancel} autoFocus>
          Avbryt
        </button>
        <button
          className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              await onConfirm()
            } finally {
              setBusy(false)
            }
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
