import { useState } from 'react'
import type { Conflict, DiffResult } from '../../../core/api'
import { api, friendlyError, type FriendlyError } from '../api'
import { Modal } from './Modal'
import { DiffBody } from './DiffBody'
import { formatBytes, formatWhen, plural } from '../format'

export type ConflictChoice = 'keep-mine' | 'skip'

interface Props {
  siteId: string
  conflicts: Conflict[]
  /** Number of selected changes that have no conflict. */
  otherCount: number
  onCancel: () => void
  /** Paths the user chose to skip. */
  onContinue: (skip: string[]) => void
}

function describe(c: Conflict): string {
  if (c.reason === 'exists-on-server') return 'Det ligger allerede en fil med dette navnet på serveren, som Skyv ikke har lagt dit.'
  const when = c.remoteModifiedAt ? ` (sist endret ${formatWhen(new Date(c.remoteModifiedAt).toISOString())})` : ''
  const size = c.expectedSize !== undefined && c.expectedSize !== c.remoteSize ? ` Størrelsen er ${formatBytes(c.remoteSize)}, men var ${formatBytes(c.expectedSize)}.` : ''
  return `Filen er endret på serveren siden forrige utgivelse${when}.${size} Noen kan ha redigert den direkte hos webhotellet.`
}

function keepLabel(c: Conflict): string {
  if (c.changeKind === 'deleted') return 'Slett likevel'
  if (c.reason === 'exists-on-server') return 'Erstatt med min'
  return 'Behold min versjon'
}

/** Asks per file what to do when the server has changed since Skyv last gave it out. */
export function ConflictDialog({ siteId, conflicts, otherCount, onCancel, onContinue }: Props) {
  const [choices, setChoices] = useState<Record<string, ConflictChoice>>(() => Object.fromEntries(conflicts.map((c) => [c.path, 'skip'])))
  const [open, setOpen] = useState<string | null>(null)
  const [diffs, setDiffs] = useState<Record<string, DiffResult | FriendlyError | 'loading'>>({})

  const showDiff = async (path: string) => {
    setOpen(open === path ? null : path)
    if (diffs[path]) return
    setDiffs((d) => ({ ...d, [path]: 'loading' }))
    try {
      const r = await api.releases.conflictDiff(siteId, path)
      setDiffs((d) => ({ ...d, [path]: r }))
    } catch (e) {
      setDiffs((d) => ({ ...d, [path]: friendlyError(e) }))
    }
  }

  const skip = Object.entries(choices)
    .filter(([, v]) => v === 'skip')
    .map(([p]) => p)

  return (
    <Modal title={`${plural(conflicts.length, 'fil', 'filer')} er endret på serveren`} onClose={onCancel} width={680}>
      <p className="lead">
        Skyv fant endringer på serveren som ikke kom fra Skyv. Velg for hver fil om din versjon skal erstatte den, eller om den skal hoppes over denne
        gangen. Uansett tar Skyv sikkerhetskopi før noe erstattes.
      </p>
      <ul className="conflict-list">
        {conflicts.map((c) => {
          const d = diffs[c.path]
          return (
            <li key={c.path} className="conflict">
              <div className="conflict-head">
                <span className="mono conflict-path">{c.path}</span>
                <div className="segmented" role="radiogroup" aria-label={`Valg for ${c.path}`}>
                  <button role="radio" aria-checked={choices[c.path] === 'keep-mine'} className={choices[c.path] === 'keep-mine' ? 'on' : ''} onClick={() => setChoices({ ...choices, [c.path]: 'keep-mine' })}>
                    {keepLabel(c)}
                  </button>
                  <button role="radio" aria-checked={choices[c.path] === 'skip'} className={choices[c.path] === 'skip' ? 'on' : ''} onClick={() => setChoices({ ...choices, [c.path]: 'skip' })}>
                    Hopp over
                  </button>
                </div>
              </div>
              <div className="muted small-text">{describe(c)}</div>
              {c.changeKind !== 'deleted' && (
                <button className="btn btn-small conflict-diff-btn" onClick={() => showDiff(c.path)}>
                  {open === c.path ? 'Skjul forskjell' : 'Vis forskjell'}
                </button>
              )}
              {open === c.path && (
                <div className="conflict-diff">
                  {d === 'loading' && <div className="muted diff-pad">Henter versjonen fra serveren …</div>}
                  {d && d !== 'loading' && 'message' in d && <div className="notice notice-error">{d.message}</div>}
                  {d && d !== 'loading' && 'kind' in d && (
                    <DiffBody result={d} beforeLabel="På serveren nå" afterLabel="Din versjon" missingOldText="Fant ikke filen på serveren." />
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
      <div className="form-actions">
        <button className="btn" onClick={onCancel}>
          Avbryt
        </button>
        <span className="grow" />
        <button className="btn btn-primary" onClick={() => onContinue(skip)}>
          {skip.length === 0
            ? 'Fortsett'
            : otherCount === 0 && skip.length === conflicts.length
              ? 'Hopp over og avslutt'
              : `Fortsett uten ${skip.length === 1 ? 'denne filen' : `disse ${skip.length} filene`}`}
        </button>
      </div>
    </Modal>
  )
}
