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
  name: string
  pointRanks: string[]
  points: number
}

export type MatchAnnouncementTone = 'warning' | 'info' | 'verdict'

export type MatchAnnouncement = {
  tone: MatchAnnouncementTone
  title: string
  detail: string
}

export type CharacterCardOverlay = {
  playerName: string
  seatLabel: string
  characterName: string
  sprite: string
}

export type HistoryEvent = {
  id: string
  kind: BlowCowState['history'][number]['kind']
  title: string
  detail: string
}

/** Which side of the ring a seat sits on, used to point its action bubble at the hub. */
export type SeatHalf = 'bottom' | 'right' | 'top' | 'left'
