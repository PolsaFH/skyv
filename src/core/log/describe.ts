import type { ReleaseStatus } from '../release/types'

const STATUS: Record<ReleaseStatus, string> = {
  'in-progress': 'pågår',
  success: 'vellykket',
  partial: 'delvis (noen filer feilet)',
  failed: 'feilet',
  undone: 'angret',
  'partly-undone': 'delvis angret'
}

export function formatStatus(s: ReleaseStatus): string {
  return STATUS[s]
}
