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
  /** The BS caller may click this card to flip it, because its owner's block is at the centre. */
  isRevealable: boolean
  /** Face up and of the trump rank proper, so it counts toward the Reverse Rule. */
  isTrumpHighlighted: boolean
}

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
  /**
   * The leave-triggered ability that moved this player's points, already formatted. Null for players
   * who are still in, and for those whose ability never met its condition. It never clears.
   */
  leaveEffect: { label: string; isGain: boolean } | null
  name: string
  pointRanks: string[]
  points: number
  /** This seat started as The Seeker and traded that card in for the one it shows now. */
  wasSeekerPick: boolean
}

/** Which way a points pill last moved, so the flash can be read without reading the number. */
export type PointsFlashDirection = 'gain' | 'loss'

export type CharacterCardOverlay = {
  playerName: string
  seatLabel: string
  characterName: string
  sprite: string
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
