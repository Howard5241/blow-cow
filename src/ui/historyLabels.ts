import type { BlowCowHistoryEventKind } from '../game/blowCowGame.ts'

export const HISTORY_EVENT_LABELS: Record<BlowCowHistoryEventKind, string> = {
  system: 'System',
  action: 'Action',
  verdict: 'Verdict',
  punishment: 'Punishment',
  point: 'Point',
  leave: 'Leave',
}
