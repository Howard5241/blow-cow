import type { BlowCowState } from '../game/blowCowGame.ts'

export type MatchPlayer = {
  id: string | number
  name?: string
  isConnected?: boolean
}

export type FrontCard = {
  id: string
  cardID: string
  sprite: string
  faceDown: boolean
  isDeparted: boolean
  isFlipping: boolean
  isTargeted: boolean
  isCatActionable: boolean
  /**
   * The viewer may palm this card back into their hand. Only ever their own face-up cards, and only
   * while they hold the licence to cheat. It outranks `isCatActionable` on the cards both could
   * claim, so a Cat who can also cheat takes their own cards back and still flips everyone else's.
   */
  isTakeBackActionable: boolean
  /** The BS caller may click this card to flip it, because its owner's block is at the centre. */
  isRevealable: boolean
  /** Face up and of the trump rank proper, so it counts toward the Reverse Rule. */
  isTrumpHighlighted: boolean
}

/** One status effect as a seat block draws it: a sprite, a counter, and the copy its tooltip reads. */
export type SeatStatus = {
  id: string
  title: string
  description: string
  sprite: string
  turnsRemaining: number
}

/**
 * What a seat block offers for putting a broken seat right, and nothing to do with the game itself.
 *
 * Bots are headless clients running in the browser that added them, and a human can leave the room
 * without leaving the *game*, so a seat has three ways to stop acting while the rules go on dealing
 * it turns. Each has one repair, and they are mutually exclusive.
 */
export type SeatRepair =
  /** A bot this browser runs. It can be restarted in place, or kicked and reseated. */
  | { action: 'local'; name: string }
  /** A bot whose browser has gone. Any player may take the seat over and run it from theirs. */
  | { action: 'resume'; name: string }
  /** Nobody is in this seat at all, so the table will stall the moment the turn reaches it. */
  | { action: 'seat' }

export type SeatRow = {
  id: string
  seatIndex: number
  avatarSprite: string
  characterName: BlowCowState['players'][string]['character']
  characterSprite: string
  frontCards: FrontCard[]
  handCount: number
  hasLeft: boolean
  isActingPlayer: boolean
  isConnected: boolean
  isTargetPlayer: boolean
  isViewingPlayer: boolean
  /** A revealed Skip is standing over this seat, so the turn will pass it by. Cleared when it does. */
  isSkipped: boolean
  /**
   * The leave-triggered ability that moved this player's points, already formatted. Null for players
   * who are still in, and for those whose ability never met its condition. It never clears.
   */
  leaveEffect: { label: string; isGain: boolean } | null
  name: string
  /**
   * The repair this seat needs, or null when it needs none — a human who is present, or a seat whose
   * player has left the game properly and whose turn will therefore never come round again.
   */
  repair: SeatRepair | null
  pointRanks: string[]
  points: number
  /** This seat's gold. A third readout beside the hand count and the points, and nothing more yet. */
  gold: number
  /**
   * The statuses this block is under. Under a Mimic disguise these are the copied seat's, like every
   * other number on the block, rather than the player really sitting there.
   */
  statuses: SeatStatus[]
  /** This seat started as The Seeker and traded that card in for the one it shows now. */
  wasSeekerPick: boolean
}

/** Which way a points pill last moved, so the flash can be read without reading the number. */
export type PointsFlashDirection = 'gain' | 'loss'

export type CharacterCardOverlay = {
  playerName: string
  seatLabel: string
  characterName: string
  /** Every frame of the enlarged card. More than one means the art animates while the panel is open. */
  spriteFrames: string[]
  wasSeekerPick: boolean
}

export type HistoryEvent = {
  id: string
  kind: BlowCowState['history'][number]['kind']
  title: string
  detail: string
  /** A closing line rendered in its own alarmed style. Absent on almost every event. */
  omen?: string
}

/** Which side of the ring a seat sits on, used to point its action bubble at the hub. */
export type SeatHalf = 'bottom' | 'right' | 'top' | 'left'
