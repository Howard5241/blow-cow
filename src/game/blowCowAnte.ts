/*
 * Ante Mode: the second game mode, and everything about it that is a number or a table rather than a
 * branch. `RULES-ANTE.md` is the source of truth for what it does; the enforcement lives in
 * `blowCowGame.ts`, reached through `isAnteMode`.
 *
 * Kept out of the game module for the same reason `blowCowRules.ts` and `blowCowStatuses.ts` are:
 * these are data plus their sanitisers, and the sanitisers are the single door every caller goes
 * through, so a value a mode does not define can never reach `G`.
 */

export const BLOW_COW_GAME_MODES = ['classic', 'ante'] as const

export type BlowCowGameMode = (typeof BLOW_COW_GAME_MODES)[number]

export const DEFAULT_BLOW_COW_GAME_MODE: BlowCowGameMode = 'classic'

/** How many rounds an Ante match lasts before gold is counted. */
export const DEFAULT_BLOW_COW_ROUND_LIMIT = 20
export const MIN_BLOW_COW_ROUND_LIMIT = 1
export const MAX_BLOW_COW_ROUND_LIMIT = 100

/**
 * What every seat starts an Ante match with. Deliberately separate from `BLOW_COW_STARTING_GOLD`,
 * which is the classic game's untouched purse and doubles as the fallback for a seat restored from
 * before gold existed. Here the number is a dial the host turns, and it decides how many lost BS
 * calls a player can survive.
 */
export const DEFAULT_BLOW_COW_ANTE_STARTING_GOLD = 5
export const MIN_BLOW_COW_ANTE_STARTING_GOLD = 1
export const MAX_BLOW_COW_ANTE_STARTING_GOLD = 50

/** What winning a round is worth, and what losing a BS call costs. The only gold that ever moves. */
export const BLOW_COW_ANTE_ROUND_GOLD = 1

export const BLOW_COW_GAME_MODE_LABELS: Record<BlowCowGameMode, string> = {
  classic: 'Classic',
  ante: 'Ante',
}

/**
 * The one-line description each mode carries in the lobby. Deliberately short: `RULES.md` and
 * `RULES-ANTE.md` are where either mode is actually written down, and a paragraph in a radio label
 * is a second copy waiting to drift.
 */
export const BLOW_COW_GAME_MODE_DESCRIPTIONS: Record<BlowCowGameMode, string> = {
  classic: 'The full game: characters, rule cards, statuses, and points. Fewest points wins.',
  ante: 'Fixed rounds played for gold. The deck is redealt every round and emptying your hand wins one. Most gold wins.',
}

export function isBlowCowGameMode(value: unknown): value is BlowCowGameMode {
  return typeof value === 'string' && BLOW_COW_GAME_MODES.some((gameMode) => gameMode === value)
}

/**
 * How many standard ranks an Ante deck uses, by the number of players **currently** in the game.
 *
 * Unlike the classic table this is re-read whenever a player is eliminated, which is why it is keyed
 * on `n` rather than on `N`. Every count below 9 is covered because the game seats at most 8; the
 * final return is the 8-player row rather than a catch-all.
 */
export function getAnteStandardRankCount(playerCount: number) {
  if (playerCount <= 2) {
    return 3
  }

  if (playerCount === 3) {
    return 4
  }

  if (playerCount === 4) {
    return 6
  }

  if (playerCount === 5 || playerCount === 6) {
    return 7
  }

  if (playerCount === 7) {
    return 10
  }

  return 12
}

/** The single sanitiser for a round limit, the way `normalizeRulesSelection` is for rule cards. */
export function normalizeRoundLimit(value: unknown) {
  if (!Number.isInteger(value)) {
    return DEFAULT_BLOW_COW_ROUND_LIMIT
  }

  return Math.min(MAX_BLOW_COW_ROUND_LIMIT, Math.max(MIN_BLOW_COW_ROUND_LIMIT, value as number))
}

/** The single sanitiser for a starting purse. */
export function normalizeAnteStartingGold(value: unknown) {
  if (!Number.isInteger(value)) {
    return DEFAULT_BLOW_COW_ANTE_STARTING_GOLD
  }

  return Math.min(
    MAX_BLOW_COW_ANTE_STARTING_GOLD,
    Math.max(MIN_BLOW_COW_ANTE_STARTING_GOLD, value as number),
  )
}

/**
 * What the whole table has watched one seat do, accumulated over **completed rounds** and never
 * reset inside a match.
 *
 * Every field is public information by construction — a reveal the table saw, a challenge it watched
 * resolve, a round it watched end — so this needs no `hideSecretState` branch and is drawn from the
 * same evidence a human player at the table has. It exists because the multi-round bot's observation
 * needs it and nothing in `G` carried it: the archive is emptied for every client, `history` is
 * prose, and a client reconstructing it from state deltas would be unverifiable and would break for a
 * seat that joined mid-match.
 *
 * The field list is exactly what `rl/ante/match_observation.py` reads, which is why `plays` and
 * `passes` are absent — `rl/ante/match.py::SeatRecord` carries them and the 98 match features do not
 * use them, so tracking them here would be state nothing reads.
 */
export interface BlowCowAnteSeatRecord {
  /** Plays of theirs the table saw face up and that were **not** what they claimed. */
  lies: number
  /** Plays of theirs the table saw face up and that were exactly what they claimed. */
  honest: number
  /** `Call BS` challenges they made. */
  callsMade: number
  /** Challenges they made and won. */
  callsWon: number
  /** Rounds they won, by any of the three endings. */
  roundsWon: number
  /** Challenges made against them that they lost, which is the only thing that takes gold. */
  bsLosses: number
}

export function createEmptyAnteSeatRecord(): BlowCowAnteSeatRecord {
  return { lies: 0, honest: 0, callsMade: 0, callsWon: 0, roundsWon: 0, bsLosses: 0 }
}

/**
 * The one reader of the optional `anteRecord` field, the way `getPlayerGold` is for `gold` — so what
 * a seat staged before this existed has watched is decided in a single place.
 */
export function getAnteSeatRecord(
  player: { anteRecord?: BlowCowAnteSeatRecord } | undefined,
): BlowCowAnteSeatRecord {
  return player?.anteRecord ?? createEmptyAnteSeatRecord()
}

/** Reveals of this seat the table has seen. The denominator of every honesty rate. */
export function getAnteRecordObservations(record: BlowCowAnteSeatRecord) {
  return record.lies + record.honest
}
