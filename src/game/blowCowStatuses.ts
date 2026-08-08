/*
 * Status effects, serialized as data the same way rule cards are.
 *
 * A status is a temporary, public, per-player modifier that removes or constrains one action. It
 * carries a counter that ticks down by 1 at the end of its owner's own turn and wears off at 0, and
 * a player holds at most `BLOW_COW_MAX_STATUSES_PER_PLAYER` of them.
 *
 * Every status here is enforced. Nothing in the game inflicts one yet — the only source is the
 * lobby's testing panel, which applies the same set to every player at match start — so this module
 * is deliberately free of any notion of who hands them out.
 *
 * The `broken` status and the character `The Broken` are unrelated and share nothing but a word.
 */

export const BLOW_COW_STATUS_IDS = ['tilted', 'worried', 'mad', 'nervous', 'blind', 'broken'] as const

export type BlowCowStatusID = (typeof BLOW_COW_STATUS_IDS)[number]

/** Two at a time, and the lobby, the sanitiser, and `addPlayerStatus` all read this one number. */
export const BLOW_COW_MAX_STATUSES_PER_PLAYER = 2

export const DEFAULT_BLOW_COW_STATUS_TURNS = 3
export const MAX_BLOW_COW_STATUS_TURNS = 20

export type BlowCowStatusDefinition = {
  id: BlowCowStatusID
  title: string
  /** Filename in `status_sprites/`. Always `${id}.png` today, named so the art can be renamed. */
  sprite: string
  /** The effect, read verbatim by the seat tooltip and the lobby chip. */
  description: string
}

export const BLOW_COW_STATUS_DEFINITIONS: readonly BlowCowStatusDefinition[] = [
  {
    id: 'tilted',
    title: 'Tilted',
    sprite: 'tilted.png',
    description: 'Cannot take the Pass action.',
  },
  {
    id: 'worried',
    title: 'Worried',
    sprite: 'worried.png',
    description: 'Cannot take the Play action.',
  },
  {
    id: 'mad',
    title: 'Mad',
    sprite: 'mad.png',
    description: 'Must lie. A play cannot be truthful, but you are never forced to play.',
  },
  {
    id: 'nervous',
    title: 'Nervous',
    sprite: 'nervous.png',
    description: 'Must be truthful. A play cannot be a lie, but you are never forced to play.',
  },
  {
    id: 'blind',
    title: 'Blind',
    sprite: 'blind.png',
    description: 'Cannot see any face-up card on the table.',
  },
  {
    id: 'broken',
    title: 'Broken',
    sprite: 'broken.png',
    description: 'Play sends one random card from your hand. You still choose the trump rank.',
  },
]

const statusDefinitionsByID = new Map(
  BLOW_COW_STATUS_DEFINITIONS.map((definition) => [definition.id, definition]),
)

/*
 * Statuses that refuse to sit on the same player. Holding one grants immunity to the other, so the
 * one already in place simply wins and the second is never applied.
 *
 * Undocumented on purpose. Neither card says a word about it, and the lobby lets a host pick both —
 * they will just find only one of them landed. Kept as a map rather than a pair so a second
 * opposition needs no new machinery, and declared in both directions so no caller has to know which
 * way round to ask.
 */
const OPPOSED_STATUS_IDS: Partial<Record<BlowCowStatusID, BlowCowStatusID>> = {
  tilted: 'worried',
  worried: 'tilted',
}

/** The status this one makes its holder immune to, or null. */
export function getOpposedStatusID(statusID: BlowCowStatusID) {
  return OPPOSED_STATUS_IDS[statusID] ?? null
}

export function isBlowCowStatusID(value: unknown): value is BlowCowStatusID {
  return typeof value === 'string' && BLOW_COW_STATUS_IDS.some((statusID) => statusID === value)
}

export function getStatusDefinition(statusID: BlowCowStatusID) {
  return statusDefinitionsByID.get(statusID) as BlowCowStatusDefinition
}

/**
 * The single sanitiser for status selections. Unknown ids are dropped, duplicates collapse, and the
 * list is truncated to the per-player cap, so no caller can put a third status or an invented one
 * into `G` no matter how it built its selection.
 */
export function normalizeStatusSelection(value: unknown): BlowCowStatusID[] {
  if (!Array.isArray(value)) {
    return []
  }

  const selected: BlowCowStatusID[] = []
  for (const statusID of value) {
    if (isBlowCowStatusID(statusID) && !selected.includes(statusID)) {
      selected.push(statusID)
    }
  }

  return selected.slice(0, BLOW_COW_MAX_STATUSES_PER_PLAYER)
}

/** The companion sanitiser for a status counter: whole turns only, and always at least one. */
export function normalizeStatusTurns(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return DEFAULT_BLOW_COW_STATUS_TURNS
  }

  return Math.min(MAX_BLOW_COW_STATUS_TURNS, Math.max(1, value))
}

/** `Mad, Blind`, for the staging log line and anywhere else a selection needs one string. */
export function formatStatusTitles(statusIDs: readonly BlowCowStatusID[]) {
  return statusIDs.map((statusID) => getStatusDefinition(statusID).title).join(', ')
}
