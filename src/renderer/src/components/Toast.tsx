import { useEffect } from 'react'
import type { FriendlyError } from '../api'

export function Toast({ error, onClose }: { error: FriendlyError; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 8000)
    return () => clearTimeout(t)
  }, [error, onClose])
  return (
    <div className="toast" role="alert">
      <div>
        <strong>{error.message}</strong>
        {error.hint && <div className="muted">{error.hint}</div>}
      </div>
      <button className="toast-close" onClick={onClose} aria-label="Lukk">
        ×
      </button>
    </div>
  )
}
