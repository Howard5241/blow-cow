import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import type { BoardProps } from 'boardgame.io/react'
import {
  BLOW_COW_RANKS,
  countsTowardReverseRule,
  formatLeaveEffectLabel,
  getActivePlayerIDs,
  getSeekerCharacterChoices,
  getTableCardCount,
  sortCards,
  type BlowCowAccusation,
  type BlowCowAccuseDreamerArgs,
  type BlowCowAdvanceBSRevealArgs,
  type BlowCowBSResolution,
  type BlowCowBeginAccusationPunishmentArgs,
  type BlowCowBeginBSPunishmentArgs,
  type BlowCowCallBSArgs,
  type BlowCowFinalizeAccusationArgs,
  type BlowCowCatHideCardArgs,
  type BlowCowCard,
  type BlowCowFinalizeBSResolutionArgs,
  type BlowCowAdvanceResetRevealArgs,
  type BlowCowRevealBSCardArgs,
  type BlowCowRevealResetCardArgs,
  type BlowCowFinalizeResetResolutionArgs,
  type BlowCowPassArgs,
  type BlowCowPlayArgs,
  type BlowCowPlayRandomArgs,
  type BlowCowSneakPlayArgs,
  type BlowCowRank,
  type BlowCowResetResolution,
  type BlowCowSeekCharacterArgs,
  type BlowCowSelectTrumpAndPlayArgs,
  type BlowCowState,
} from '../game/blowCowGame.ts'
import type { BlowCowImplementedCharacterName } from '../game/blowCowCharacters.ts'
import { getCharacterCardSprite } from './characterCardSprites.ts'
import { CARD_BACK_FILENAME, getCardLabel, getCardSprite, getFrontCardSprite } from './cardSprites.ts'
import { getAvatarSprite } from './avatarSprites.ts'
import { InlineInfoTooltip } from './InlineInfoTooltip.tsx'
import { PlayerRing } from './PlayerRing.tsx'
import {
  PASS_ICON_SPRITE,
  PLAY_ICON_SPRITE,
  PLAY_RANDOM_ICON_SPRITE,
  RESET_ICON_SPRITE,
  SNEAK_PLAY_ICON_SPRITE,
  X_ICON_SPRITE,
} from './iconSprites.ts'
import { TableCenterHub } from './TableCenterHub.tsx'
import { HistoryOverlay } from './BoardOverlays.tsx'
import { useTransientMessage } from './useTransientMessage.ts'
import {
  getCatHiddenCardIDSet,
  getCatHiddenOverlayCardIDs,
  getDisplayedPlayCardCount,
  getExplicitlyRevealedCardIDSet,
  getFaceDownOverlayCardIDs,
  getFaceUpOverlayCardIDs,
  getLatestHiddenPlay,
} from './tablePlays.ts'
import {
  canUseClientGrandmasterBSOverride,
  getClientDefaultBSTargetSeatID,
  getClientPendingPlay,
  resolveClientBSTargetSelection,
} from './bsTargeting.ts'
import type {
  CharacterCardOverlay,
  HistoryEvent,
  MatchPlayer,
  PointsFlashDirection,
  SeatRow,
} from './boardTypes.ts'

/** Shared by all four action-button render branches so the icon markup is written once. */
function ActionButtonContent({ icon, label }: { icon: string; label: string }) {
  return (
    <>
      {icon ? <img alt="" aria-hidden="true" className="action-button-icon" src={icon} /> : null}
      <span className="action-button-label">{label}</span>
    </>
  )
}

type HandCard = {
  id: string
  sprite: string
}

type HandCardMetric = {
  left: number
  top: number
  width: number
}

type HandMotionCard = {
  id: string
  sprite: string
  left: number
  top: number
  width: number
  delayMs: number
}

type FrontCardEntryCard = {
  id: string
  sprite: string
  width: number
  height: number
  startX: number
  startY: number
  moveX: number
  moveY: number
  delayMs: number
}

type EndGameRow = {
  id: string
  seatIndex: number
  place: number
  name: string
  points: number
  leaveOrder: number
  playCount: number
  callBSCount: number
  passCount: number
  resetCount: number
  turnsInGame: number
  lieRate: number | null
  cardsPlayed: number
  punishmentCount: number
  bsWinRate: number | null
  isWinner: boolean
  /** Formatted leave-triggered point change, or null when no ability fired for this player. */
  leaveEffectLabel: string | null
}

type EndGameChartPoint = {
  id: string
  title: string
  turnNumber: number
  handCountsByPlayer: Record<string, number>
}

/** One x sprite on the line drawn from the caller's block to the accused's block. */
type BSCallTrailMark = {
  id: string
  left: number
  top: number
  delayMs: number
}

/**
 * The pause before a reveal procedure starts, for whichever resolution is live. Everything after it
 * is driven by the resolution in `G`, which the caller advances by hand, so this state covers the
 * lead-in alone. BS spends the pause drawing its call trail; Reset simply waits.
 */
type RevealLeadInProgress = {
  resolutionID: string
  isActive: boolean
  /**
   * Measured once when the resolution arrives and carried on this state rather than in its own
   * `useState`, so the lead-in animation adds no second set-state-in-effect call site. Always empty
   * for a Reset, which draws no trail.
   */
  callTrail: BSCallTrailMark[]
}

/**
 * Only the phases that follow the reveal. The reveal itself is caller-driven and derived from
 * `G.resetResolution`, so it has no stage here.
 */
type ResetSequenceStage = 'gathering' | 'shuffling' | 'dealing' | 'returning'

type ResetSequenceProgress = {
  resolutionID: string
  stage: ResetSequenceStage
  dealtCardCount: number
}

type PunishmentMoveCard = {
  id: string
  sprite: string
  width: number
  height: number
  startX: number
  startY: number
  moveX: number
  moveY: number
  delayMs: number
  rotateDeg?: number
}

type PunishmentMoveSequence = {
  resolutionID: string
  cards: PunishmentMoveCard[]
  durationMs: number
}

type ResetPileCard = {
  id: string
  sprite: string
  width: number
  height: number
  left: number
  top: number
  rotationDeg: number
  shuffleDelayMs: number
}

type ResetPileState = {
  resolutionID: string
  cards: ResetPileCard[]
  isFaceDown: boolean
  isShuffling: boolean
}

type FrontCardEntrySequence = {
  cards: FrontCardEntryCard[]
  durationMs: number
}

type BoardServerState = 'checking' | 'online' | 'offline'

/*
 * The lead-in that plays before the reveal procedure starts: x marks travel from the caller's
 * block to the accused's block while the accused block is stamped with the BS target frame.
 * Every later BS stage is pushed back by BS_CALL_TRAIL_LEAD_IN_MS so the procedure itself is
 * unchanged, only delayed.
 */
const BS_CALL_TRAIL_MARK_COUNT = 8
const BS_CALL_TRAIL_MARK_INTERVAL_MS = 185
/** Must match the `bs-call-trail-mark-in` duration in App.css. */
const BS_CALL_TRAIL_MARK_DURATION_MS = 340
/** When the last mark has finished landing on the accused, and the target mark may stamp. */
const BS_CALL_TRAIL_ARRIVAL_AT_MS
  = (BS_CALL_TRAIL_MARK_COUNT - 1) * BS_CALL_TRAIL_MARK_INTERVAL_MS + BS_CALL_TRAIL_MARK_DURATION_MS
/*
 * How long the bullseye sits on the accused's avatar before their block is pulled to the centre.
 * This is the beat the table spends realising who has been challenged, so it is worth more than the
 * animation strictly needs.
 */
const BS_TARGET_MARK_HOLD_MS = 1500
/*
 * Derived from the trail rather than fixed, so changing the mark count or stagger cannot let the
 * reveal procedure start on top of a lead-in that is still playing. The tail is the beat the
 * target mark lands in, plus the hold above.
 */
const BS_CALL_TRAIL_LEAD_IN_MS = BS_CALL_TRAIL_ARRIVAL_AT_MS + BS_TARGET_MARK_HOLD_MS
/** Must match the `.seat-block` transform/translate transition duration in App.css. */
const SEAT_FOCUS_TRANSITION_MS = 460
const BS_PUNISHMENT_MOVE_DURATION_MS = 420
const BS_PUNISHMENT_MOVE_STAGGER_MS = 110
const BS_PUNISHMENT_IMPACT_DURATION_MS = 720
/*
 * The beat between a Reset or all-pass return being called and the first block being pulled to the
 * centre, so the call registers before the procedure starts. The BS equivalent is spent drawing the
 * call trail; Reset has nothing to draw, so it is simply a pause.
 */
const RESET_REVEAL_LEAD_IN_MS = 1200
const RESET_MOVE_DURATION_MS = 2000
const RESET_POST_REVEAL_PAUSE_MS = 2000
const RESET_GATHER_DURATION_MS = 900
const RESET_POST_GATHER_PAUSE_MS = 1000
const RESET_PILE_SHUFFLE_DURATION_MS = 1000
const RESET_DEAL_INTERVAL_MS = 220
const RESET_DEAL_DURATION_MS = 420
const RESET_POST_DEAL_PAUSE_MS = 1000
const HAND_CARD_ADD_DURATION_MS = 420
const HAND_CARD_REMOVE_DURATION_MS = 360
const HAND_CARD_ANIMATION_STAGGER_MS = 90
const FRONT_CARD_ENTRY_DURATION_MS = 520
const FRONT_CARD_ENTRY_STAGGER_MS = 120
const FRONT_CARD_FLIP_DURATION_MS = 380
/*
 * How long the table sits still between the last card being revealed and the Punish button
 * appearing. Derived from the focus transition rather than fixed: pressing Punish arms
 * startPunishmentMoveSequence, which measures front-card rects, so the gate has to outlast both the
 * focused block travelling back to its ring seat and the last card finishing its flip. Retuning the
 * focus animation must not be able to let a measurement land on something still moving.
 */
const BS_PUNISH_PROMPT_DELAY_MS = SEAT_FOCUS_TRANSITION_MS + FRONT_CARD_FLIP_DURATION_MS + 400
/*
 * An accusation freezes the table for a beat before it says anything, so the shout registers on its
 * own before the answer lands. A hit then holds until the accuser presses Punish; a miss spends the
 * beat below on the denial and hands the turn straight back.
 */
const ACCUSATION_VERDICT_DELAY_MS = 1100
/** How long the accused's "Nope" holds before a missed accusation releases the table. */
const ACCUSATION_DENIAL_DURATION_MS = 1600
const PLAYER_POINTS_FLASH_DURATION_MS = 1600
// Deliberately not scaled by G.speedMultiplier: this reports a UI mistake, not a game sequence.
const BOARD_FAIL_MESSAGE_DURATION_MS = 2400
const DEFAULT_HAND_CARD_WIDTH = 88
const ENDGAME_CHART_WIDTH = 960
const ENDGAME_CHART_HEIGHT = 280
const ENDGAME_CHART_PADDING = {
  top: 16,
  right: 24,
  bottom: 36,
  left: 40,
} as const
const ENDGAME_CHART_COLORS = ['#ffcf67', '#4fd2a3', '#7ebdff', '#ff8d7b', '#d9b8ff', '#7fe4ff', '#ffb36b', '#c7eb6c'] as const
const BS_PLAYER_CALLOUT_OPTIONS = ['BS!', "That's a lie!", "That's BS!", 'I call BS!', "You're lying!", 'BS!!!!!'] as const
const PASS_PLAYER_CALLOUT_OPTIONS = ['Pass', 'Skip', 'I pass', "I'll pass"] as const
/** `{name}` is filled with the accused seat's display name. */
const ACCUSE_PLAYER_CALLOUT_OPTIONS = [
  '{name} is cheating!',
  'Are you sure about that, {name}?',
  'Nice try, {name}',
  'I saw that, {name}!',
] as const
const ACCUSATION_DENIAL_CALLOUT = 'Nope'
const FOREIGNER_SUIT_ORDER = ['spades', 'hearts', 'diamonds', 'clubs'] as const

function getForeignerRankLabel(rank: BlowCowRank) {
  if (rank === 'A') {
    return 'Ace'
  }

  if (rank === 'J') {
    return 'Jack'
  }

  if (rank === 'Q') {
    return 'Queen'
  }

  if (rank === 'K') {
    return 'King'
  }

  return rank
}

function getForeignerSuitLabel(suit: typeof FOREIGNER_SUIT_ORDER[number]) {
  return `${suit[0].toUpperCase()}${suit.slice(1)}`
}

const FOREIGNER_CARD_OPTIONS = [
  {
    value: 'none',
    label: 'None',
  },
  ...BLOW_COW_RANKS.flatMap((rank) => FOREIGNER_SUIT_ORDER.map((suit) => ({
    value: `${rank}:${suit}`,
    label: `${getForeignerRankLabel(rank)} of ${getForeignerSuitLabel(suit)}`,
  }))),
  {
    value: 'joker',
    label: 'Joker',
  },
] as const

type BlowCowBoardProps = BoardProps<BlowCowState> & {
  isLeaving: boolean
  onLeaveRoom: () => void
  playerName: string
  roomPlayers: MatchPlayer[]
  roomError: string
  serverState: BoardServerState
  serverStatusLabel: string
  moves: {
    accuseDreamer: (args: BlowCowAccuseDreamerArgs) => void
    advanceBSReveal: (args: BlowCowAdvanceBSRevealArgs) => void
    beginAccusationPunishment: (args: BlowCowBeginAccusationPunishmentArgs) => void
    beginBSPunishment: (args: BlowCowBeginBSPunishmentArgs) => void
    catHideCard: (args: BlowCowCatHideCardArgs) => void
    callBS: (args?: BlowCowCallBSArgs) => void
    callReset: () => void
    finalizeAccusation: (args: BlowCowFinalizeAccusationArgs) => void
    revealBSCard: (args: BlowCowRevealBSCardArgs) => void
    revealResetCard: (args: BlowCowRevealResetCardArgs) => void
    advanceResetReveal: (args: BlowCowAdvanceResetRevealArgs) => void
    finalizeBSResolution: (args: BlowCowFinalizeBSResolutionArgs) => void
    finalizeResetResolution: (args: BlowCowFinalizeResetResolutionArgs) => void
    pass: (args?: BlowCowPassArgs) => void
    play: (args: BlowCowPlayArgs) => void
    playRandom: (args: BlowCowPlayRandomArgs) => void
    seekCharacter: (args: BlowCowSeekCharacterArgs) => void
    sneakPlay: (args: BlowCowSneakPlayArgs) => void
    startMatch: () => void
    selectTrumpAndPlay: (args: BlowCowSelectTrumpAndPlayArgs) => void
    toggleDirection: () => void
  }
}

function getSeatLabel(seatIndex: number | null | undefined) {
  return seatIndex === undefined || seatIndex === null ? 'Unknown seat' : `Seat ${seatIndex + 1}`
}

function getFallbackSeatLabel(seatID: string) {
  const seatIndex = Number.parseInt(seatID, 10)
  return getSeatLabel(Number.isNaN(seatIndex) ? null : seatIndex)
}

function getStagingSlotLabel(slotIndex: number) {
  return `Slot ${slotIndex + 1}`
}

function getSeatDisplayName(seatID: string, currentSeatID: string | null, currentPlayerName: string, roomPlayers: MatchPlayer[]) {
  if (seatID === currentSeatID && currentPlayerName.trim()) {
    return currentPlayerName
  }

  const matchPlayer = roomPlayers.find((entry) => String(entry.id) === seatID)
  return matchPlayer?.name ?? getFallbackSeatLabel(seatID)
}

function formatOrdinal(value: number) {
  const lastTwoDigits = value % 100
  if (lastTwoDigits >= 11 && lastTwoDigits <= 13) {
    return `${value}th`
  }

  switch (value % 10) {
    case 1:
      return `${value}st`
    case 2:
      return `${value}nd`
    case 3:
      return `${value}rd`
    default:
      return `${value}th`
  }
}

function formatPercent(numerator: number, denominator: number) {
  if (denominator === 0) {
    return null
  }

  return Math.round((numerator / denominator) * 100)
}

function formatTurnLabel(turnNumber: number) {
  return turnNumber === 0 ? 'Deal' : `T${turnNumber}`
}

function buildEndGameChartPoints(events: BlowCowState['telemetry']['events']) {
  const latestEventByTurn = new Map<number, BlowCowState['telemetry']['events'][number]>()

  for (const event of events) {
    latestEventByTurn.set(event.turnNumber, event)
  }

  return [...latestEventByTurn.values()]
    .sort((leftEvent, rightEvent) => leftEvent.turnNumber - rightEvent.turnNumber)
    .map((event) => ({
      id: event.id,
      title: event.title,
      turnNumber: event.turnNumber,
      handCountsByPlayer: event.handCountsByPlayer,
    } satisfies EndGameChartPoint))
}

function getEndGameChartTickIndices(pointCount: number) {
  if (pointCount <= 0) {
    return [] as number[]
  }

  const lastIndex = pointCount - 1
  const tickStep = Math.max(1, Math.ceil(lastIndex / 5))
  const tickIndexSet = new Set<number>([0, lastIndex])

  for (let tickIndex = tickStep; tickIndex < lastIndex; tickIndex += tickStep) {
    tickIndexSet.add(tickIndex)
  }

  return [...tickIndexSet].sort((leftIndex, rightIndex) => leftIndex - rightIndex)
}

function getEndGameChartYTicks(maxValue: number) {
  if (maxValue <= 0) {
    return [0]
  }

  const tickStep = Math.max(1, Math.ceil(maxValue / 4))
  const tickValues: number[] = []

  for (let value = 0; value <= maxValue; value += tickStep) {
    tickValues.push(value)
  }

  if (tickValues[tickValues.length - 1] !== maxValue) {
    tickValues.push(maxValue)
  }

  return tickValues
}

function toHandCard(card: BlowCowCard): HandCard {
  return {
    id: card.id,
    sprite: card.sprite,
  }
}

function getPlayCalloutRankLabel(rank: BlowCowRank, cardCount: number) {
  if (rank === 'A') {
    return cardCount === 1 ? 'Ace' : 'Aces'
  }

  if (rank === 'J') {
    return cardCount === 1 ? 'Jack' : 'Jacks'
  }

  if (rank === 'Q') {
    return cardCount === 1 ? 'Queen' : 'Queens'
  }

  if (rank === 'K') {
    return cardCount === 1 ? 'King' : 'Kings'
  }

  return cardCount === 1 ? rank : `${rank}s`
}

function buildPlayCalloutText(claimedRank: BlowCowRank, cardCount: number) {
  const countLabel = cardCount === 1 ? 'One' : cardCount === 2 ? 'Two' : String(cardCount)
  return `${countLabel} ${getPlayCalloutRankLabel(claimedRank, cardCount)}`
}

/**
 * Picks a callout line from an id instead of `Math.random`, so every client shows the same one.
 * Callouts hold until the player who made them acts again rather than expiring after a few seconds,
 * and clients disagreeing about what somebody shouted is very visible over that long.
 */
function pickCalloutTextForID(options: readonly string[], id: string) {
  let hash = 0

  for (let index = 0; index < id.length; index += 1) {
    hash = (hash + id.charCodeAt(index)) % options.length
  }

  return options[hash] ?? ''
}

function scaleSequenceDelay(delayMs: number, speedMultiplier: number) {
  return Math.max(0, Math.round(delayMs / speedMultiplier))
}

/** The seat's avatar, falling back to the whole block if it has not rendered one. */
function getSeatAvatarElement(boardElement: HTMLElement, seatID: string) {
  const blockElement = boardElement.querySelector<HTMLElement>(`[data-seat-id="${seatID}"]`)

  return blockElement?.querySelector<HTMLElement>('.seat-avatar-image, .seat-avatar-fallback')
    ?? blockElement
    ?? null
}

/**
 * Positions the x marks evenly along the segment between the two players' avatars, in board
 * coordinates. Both endpoints are left clear, so the marks read as a line pointing from one face
 * to the other rather than covering either. Returns an empty list when either seat is missing,
 * which is the case for a seat that has not mounted yet.
 */
function buildBSCallTrailMarks(
  boardElement: HTMLElement | null,
  callerSeatID: string,
  targetSeatID: string,
  markIntervalMs: number,
): BSCallTrailMark[] {
  const callerElement = boardElement ? getSeatAvatarElement(boardElement, callerSeatID) : null
  const targetElement = boardElement ? getSeatAvatarElement(boardElement, targetSeatID) : null

  if (!boardElement || !callerElement || !targetElement) {
    return []
  }

  const boardRect = boardElement.getBoundingClientRect()
  const callerRect = callerElement.getBoundingClientRect()
  const targetRect = targetElement.getBoundingClientRect()
  const startX = callerRect.left + callerRect.width / 2 - boardRect.left
  const startY = callerRect.top + callerRect.height / 2 - boardRect.top
  const endX = targetRect.left + targetRect.width / 2 - boardRect.left
  const endY = targetRect.top + targetRect.height / 2 - boardRect.top

  return Array.from({ length: BS_CALL_TRAIL_MARK_COUNT }, (_, markIndex) => {
    const progress = (markIndex + 1) / (BS_CALL_TRAIL_MARK_COUNT + 1)

    return {
      id: `bs-call-trail-${markIndex}`,
      left: startX + (endX - startX) * progress,
      top: startY + (endY - startY) * progress,
      delayMs: markIndex * markIntervalMs,
    } satisfies BSCallTrailMark
  })
}

function getPunishmentMoveTargetPosition(
  destinationRect: DOMRect,
  boardRect: DOMRect,
  width: number,
  height: number,
  index: number,
) {
  const stackOffsetX = (index % 4) * 4 - 6
  const stackOffsetY = Math.floor(index / 4) * 2 - 4

  return {
    left: destinationRect.left - boardRect.left + destinationRect.width / 2 - width / 2 + stackOffsetX,
    top: destinationRect.top - boardRect.top + destinationRect.height / 2 - height / 2 + stackOffsetY,
  }
}

function getResetPileAnchorPosition(boardElement: HTMLElement, boardRect: DOMRect) {
  const pileAnchorElement = boardElement.querySelector<HTMLElement>('.table-center-hub')
    ?? boardElement.querySelector<HTMLElement>('.player-ring')
    ?? boardElement
  const pileAnchorRect = pileAnchorElement.getBoundingClientRect()

  return {
    left: pileAnchorRect.left - boardRect.left + pileAnchorRect.width / 2,
    top: pileAnchorRect.top - boardRect.top + pileAnchorRect.height / 2,
  }
}

function getResetPileCardPlacement(
  pileAnchor: { left: number; top: number },
  width: number,
  height: number,
  index: number,
) {
  const stackOffsetX = (index % 4) * 3 - 6
  const stackOffsetY = Math.floor(index / 4) * 2 - 4

  return {
    left: pileAnchor.left - width / 2 + stackOffsetX,
    top: pileAnchor.top - height / 2 + stackOffsetY,
    rotationDeg: (index % 6 - 2.5) * 2.4,
    shuffleDelayMs: (index % 5) * 40,
  }
}

function getResetDealPlayerOrder(
  state: BlowCowState,
  resetResolution: BlowCowResetResolution,
) {
  if (resetResolution.kind !== 'reset') {
    return [] as string[]
  }

  const activeSeatIDs = state.seatOrder.filter((seatID) => !state.players[seatID].hasLeft)
  if (activeSeatIDs.length === 0) {
    return [] as string[]
  }

  const totalCardCount = getTableCardCount(state.table)
  const cardsPerPlayer = Math.floor(totalCardCount / activeSeatIDs.length)
  const extraCardCount = totalCardCount % activeSeatIDs.length
  const dealPlayerOrder: string[] = []

  for (let dealRound = 0; dealRound < cardsPerPlayer; dealRound += 1) {
    dealPlayerOrder.push(...activeSeatIDs)
  }

  for (let extraIndex = 0; extraIndex < extraCardCount; extraIndex += 1) {
    dealPlayerOrder.push(resetResolution.callerPlayerID)
  }

  return dealPlayerOrder
}

function getFallbackHandCardMetric(
  handScrollRowElement: HTMLDivElement,
  storedMetrics: Map<string, HandCardMetric>,
  index: number,
) {
  const metricValues = [...storedMetrics.values()]
  const defaultWidth = metricValues[0]?.width
    ?? handScrollRowElement.querySelector<HTMLButtonElement>('.hand-card-button')?.offsetWidth
    ?? DEFAULT_HAND_CARD_WIDTH
  const defaultTop = metricValues[0]?.top ?? 14
  const baseLeft = metricValues.length > 0
    ? metricValues[metricValues.length - 1].left
    : 4
  const maxLeft = Math.max(0, handScrollRowElement.clientWidth - defaultWidth)

  return {
    left: Math.min(baseLeft + index * 16, maxLeft),
    top: defaultTop,
    width: defaultWidth,
  } satisfies HandCardMetric
}

export function BlowCowBoard({
  G,
  ctx,
  isActive,
  isConnected,
  isLeaving,
  matchData,
  matchID,
  moves,
  onLeaveRoom,
  playerID,
  playerName,
  roomPlayers,
  roomError,
  serverState,
  serverStatusLabel,
}: BlowCowBoardProps) {
  const currentSeatID = playerID
  const tableBoardRef = useRef<HTMLElement | null>(null)
  const frontCardRefs = useRef(new Map<string, HTMLDivElement>())
  const handCountPillRefs = useRef(new Map<string, HTMLSpanElement>())
  const handScrollRowRef = useRef<HTMLDivElement | null>(null)
  const handCardButtonRefs = useRef(new Map<string, HTMLButtonElement>())
  const handCardMetricsRef = useRef(new Map<string, HandCardMetric>())
  const previousHandCardsRef = useRef<HandCard[]>([])
  const previousFrontCardIDsBySeatRef = useRef(new Map<string, string[]>())
  const previousScoredSetIDsRef = useRef(new Set<string>())
  const previousRevealedOverlayCardIDSetRef = useRef(new Set<string>())
  const previousCatHiddenOverlayCardIDSetRef = useRef(new Set<string>())
  const previousSeatIDRef = useRef<string | null>(currentSeatID)
  const lastFrontCardIDsKeyRef = useRef('')
  const handAnimationTimeoutIDsRef = useRef<number[]>([])
  const frontCardEntryTimeoutIDsRef = useRef<number[]>([])
  const revealFlipTimeoutIDsRef = useRef<number[]>([])
  const previousPointsBySeatRef = useRef<Map<string, number> | null>(null)
  const pointFlashTimeoutIDsRef = useRef(new Map<string, number>())
  const hasMountedPlayWatcherRef = useRef(false)
  const hasMountedFrontCardWatcherRef = useRef(false)
  const hasMountedRevealWatcherRef = useRef(false)
  const hasMountedCatHideWatcherRef = useRef(false)
  const lastSeenPlayIDRef = useRef<string | null>(null)
  const hasMountedBSCalloutWatcherRef = useRef(false)
  const lastSeenBSResolutionIDRef = useRef<string | null>(null)
  const hasMountedResetCalloutWatcherRef = useRef(false)
  const lastSeenResetResolutionIDRef = useRef<string | null>(null)
  const hasMountedPassCalloutWatcherRef = useRef(false)
  const lastSeenPassEventIDRef = useRef<string | null>(null)
  const playersFromRoom = roomPlayers.length > 0
    ? roomPlayers
    : ((matchData as MatchPlayer[] | undefined) ?? [])
  const [selectedCardIDs, setSelectedCardIDs] = useState<string[]>([])
  const [enteringHandCardIDs, setEnteringHandCardIDs] = useState<string[]>([])
  const [removingHandCards, setRemovingHandCards] = useState<HandMotionCard[]>([])
  const [enteringFrontCardIDs, setEnteringFrontCardIDs] = useState<string[]>([])
  const [frontCardEntrySequence, setFrontCardEntrySequence] = useState<FrontCardEntrySequence | null>(null)
  const [revealFlippingCardIDs, setRevealFlippingCardIDs] = useState<string[]>([])
  /**
   * Keyed by seat rather than a flat list because the flash has to say which way the total moved:
   * scoring is green, and a leave-triggered penalty is red.
   */
  const [pointsFlashDirectionBySeatID, setPointsFlashDirectionBySeatID] = useState<Record<string, PointsFlashDirection>>({})
  /**
   * One callout per seat rather than one for the whole table, because they no longer expire. A
   * player's line stays over their block until they start a turn, say something else, or the round
   * ends — so two players can be mid-sentence at once, which a single slot could not express.
   */
  const [playerCallouts, setPlayerCallouts] = useState<Record<string, { calloutID: string; text: string }>>({})
  /**
   * Every callout watcher writes through here: a seat's line replaces whatever that seat was saying
   * and leaves every other seat alone. There is no timer to cancel, because nothing expires.
   */
  const showPlayerCallout = (seatID: string, calloutID: string, text: string) => {
    setPlayerCallouts((previousCallouts) => ({
      ...previousCallouts,
      [seatID]: { calloutID, text },
    }))
  }
  const [selectedTrumpRank, setSelectedTrumpRank] = useState<BlowCowRank>('Q')
  const [selectedDrunkardRandomPlayCardCount, setSelectedDrunkardRandomPlayCardCount] = useState(1)
  const [selectedTargetSeatID, setSelectedTargetSeatID] = useState<string | null>(null)
  const [selectedForeignerCardCode, setSelectedForeignerCardCode] = useState<string>('none')
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  /**
   * Local, and deliberately not in `G`: the win screen exists so each player can look at the final
   * table — the last leave-effect labels land on it — before the results panel covers everything.
   * How long anyone wants for that is their own business, and nobody should be waiting on a player
   * who has already closed the tab. It never resets because a finished match never restarts; the
   * only route back to staging is a new match.
   */
  const [hasDismissedWinScreen, setHasDismissedWinScreen] = useState(false)
  const [leadInProgress, setLeadInProgress] = useState<RevealLeadInProgress | null>(null)
  const [isBSPunishPromptReady, setIsBSPunishPromptReady] = useState(false)
  /**
   * Paces an accusation's answer. The server decided the outcome the moment the move landed; this is
   * only about letting the shout land before the reply does, and on a miss letting the denial land
   * before the accuser is asked to punish themselves.
   */
  const [accusationVerdictStage, setAccusationVerdictStage] = useState<{
    accusationID: string
    stage: 'pending' | 'denied' | 'punishable'
  } | null>(null)
  const [resetSequenceProgress, setResetSequenceProgress] = useState<ResetSequenceProgress | null>(null)
  const [isPunishmentFlashActive, setIsPunishmentFlashActive] = useState(false)
  const [punishmentMoveSequence, setPunishmentMoveSequence] = useState<PunishmentMoveSequence | null>(null)
  const [punishmentImpactSeatID, setPunishmentImpactSeatID] = useState<string | null>(null)
  const [departedPunishmentCardIDs, setDepartedPunishmentCardIDs] = useState<string[]>([])
  const [resetMoveSequence, setResetMoveSequence] = useState<PunishmentMoveSequence | null>(null)
  const [resetGatherSequence, setResetGatherSequence] = useState<PunishmentMoveSequence | null>(null)
  const [resetPileState, setResetPileState] = useState<ResetPileState | null>(null)
  const [resetDealSequence, setResetDealSequence] = useState<PunishmentMoveSequence | null>(null)
  const [departedResetCardIDs, setDepartedResetCardIDs] = useState<string[]>([])
  const [selectedCharacterCard, setSelectedCharacterCard] = useState<CharacterCardOverlay | null>(null)
  /**
   * The Seeker's picker. Both pieces are local and neither belongs in `G`: nobody else is waiting on
   * this choice, and the picker is only ever mounted on the one client that has it to make. It opens
   * by default and closes for good once the move lands, because taking a character is precisely what
   * stops that player being The Seeker — so there is no dismissal flag to reset either.
   */
  const [hasDismissedSeekerPicker, setHasDismissedSeekerPicker] = useState(false)
  const [selectedSeekerCharacter, setSelectedSeekerCharacter] = useState<BlowCowImplementedCharacterName | null>(null)
  const [copyRoomCodeStatus, setCopyRoomCodeStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const {
    message: failMessage,
    showMessage: showFailMessage,
    clearMessage: clearFailMessage,
  } = useTransientMessage(BOARD_FAIL_MESSAGE_DURATION_MS)
  const hasMountedPunishmentWatcherRef = useRef(false)
  const lastSeenPunishmentEventIDRef = useRef<string | null>(null)
  const finalizeBSResolutionRef = useRef(moves.finalizeBSResolution)
  const finalizeResetResolutionRef = useRef(moves.finalizeResetResolution)
  const finalizeAccusationRef = useRef(moves.finalizeAccusation)
  const latestBSResolutionRef = useRef<BlowCowBSResolution | null>(G.bsResolution)
  const latestAccusationRef = useRef<BlowCowAccusation | null>(G.accusation)
  const latestTablePlaysRef = useRef(G.table.plays)

  /*
   * Both procedures past their lead-in are derived from G, not from a local clock: every flip and
   * every step is a move, so each client renders the same moment without needing to agree on
   * timings. Declared up here because the effects below depend on them.
   *
   * BS and Reset are mutually exclusive — each blocks the other's move — so a single set of focus
   * and Continue selectors covers whichever one is live.
   */
  const isBSLeadInActive = Boolean(G.bsResolution
    && leadInProgress?.resolutionID === G.bsResolution.id
    && leadInProgress.isActive)
  const isResetLeadInActive = Boolean(G.resetResolution
    && leadInProgress?.resolutionID === G.resetResolution.id
    && leadInProgress.isActive)
  const isBSCaller = Boolean(G.bsResolution && currentSeatID === G.bsResolution.callerPlayerID)
  const isBSRevealComplete = Boolean(G.bsResolution
    && G.bsResolution.revealStepIndex >= G.bsResolution.revealOrder.length)
  const isResetRevealComplete = Boolean(G.resetResolution
    && G.resetResolution.revealStepIndex >= G.resetResolution.revealOrder.length)
  const isRevealCaller = isBSCaller
    || Boolean(G.resetResolution && currentSeatID === G.resetResolution.callerPlayerID)
  /*
   * The seat pulled to the centre of the table. Suppressed during either lead-in so the BS call
   * trail still measures blocks at their ring positions, and during the BS punishment travel for
   * the same reason. The Reset gather/deal sequences measure too, but they only start once the
   * reveal is complete, which is exactly when this goes null.
   */
  const focusedSeatID = G.bsResolution && !isBSLeadInActive && !G.bsResolution.isPunishing
    ? G.bsResolution.revealOrder[G.bsResolution.revealStepIndex] ?? null
    : G.resetResolution && !isResetLeadInActive
    ? G.resetResolution.revealOrder[G.resetResolution.revealStepIndex] ?? null
    : null
  // Continue unlocks only once the focused player has nothing left face down. The server enforces
  // the same rule; this just decides whether to render the button.
  const canAdvanceReveal = isRevealCaller && focusedSeatID !== null && G.table.plays
    .filter((play) => play.playerID === focusedSeatID)
    .every((play) => getFaceDownOverlayCardIDs(play).length === 0)
  /*
   * The table cards flying to whoever is taking them. A BS resolution and a caught accusation both
   * end this way, and the travel is identical, so one descriptor drives one animation. `driverSeatID`
   * is the client that also schedules the finalize once the cards have landed.
   *
   * The accusation branch moves cards that were never revealed, so they travel face down. That is
   * correct: an accusation asks nothing about what the cards were.
   */
  const activePunishment = G.bsResolution?.isPunishing && G.bsResolution.punishment
    ? {
        id: G.bsResolution.id,
        kind: 'bs' as const,
        punishedSeatID: G.bsResolution.punishment.punishedPlayerID,
        cardCount: G.bsResolution.punishmentCardCount,
        driverSeatID: G.bsResolution.callerPlayerID,
      }
    : G.accusation?.isPunishing
    ? {
        id: G.accusation.id,
        kind: 'accusation' as const,
        punishedSeatID: G.accusation.punishedPlayerID,
        cardCount: G.accusation.punishmentCardCount,
        driverSeatID: G.accusation.accuserPlayerID,
      }
    : null

  useEffect(() => {
    finalizeBSResolutionRef.current = moves.finalizeBSResolution
  }, [moves.finalizeBSResolution])

  useEffect(() => {
    finalizeAccusationRef.current = moves.finalizeAccusation
  }, [moves.finalizeAccusation])

  useEffect(() => {
    latestAccusationRef.current = G.accusation
  }, [G.accusation])

  useEffect(() => {
    finalizeResetResolutionRef.current = moves.finalizeResetResolution
  }, [moves.finalizeResetResolution])

  useEffect(() => {
    latestBSResolutionRef.current = G.bsResolution
  }, [G.bsResolution])

  useEffect(() => {
    latestTablePlaysRef.current = G.table.plays
  }, [G.table.plays])

  useEffect(() => {
    return () => {
      handAnimationTimeoutIDsRef.current.forEach((timeoutID) => {
        window.clearTimeout(timeoutID)
      })
      handAnimationTimeoutIDsRef.current = []

      frontCardEntryTimeoutIDsRef.current.forEach((timeoutID) => {
        window.clearTimeout(timeoutID)
      })
      frontCardEntryTimeoutIDsRef.current = []

      revealFlipTimeoutIDsRef.current.forEach((timeoutID) => {
        window.clearTimeout(timeoutID)
      })
      revealFlipTimeoutIDsRef.current = []

      pointFlashTimeoutIDsRef.current.forEach((timeoutID) => {
        window.clearTimeout(timeoutID)
      })
      pointFlashTimeoutIDsRef.current.clear()
    }
  }, [])

  useEffect(() => {
    if (copyRoomCodeStatus === 'idle') {
      return
    }

    const timeoutID = window.setTimeout(() => {
      setCopyRoomCodeStatus('idle')
    }, 1600)

    return () => {
      window.clearTimeout(timeoutID)
    }
  }, [copyRoomCodeStatus])

  /*
   * Declared up here rather than beside the other character derivations because the Escape handler
   * below has to know whether the picker is up. Still holding the card is the whole condition, on or
   * off this player's turn: the server treats the swap as spending it, so `character` stops reading
   * `The Seeker` the moment the choice lands and both of these close with it.
   *
   * The picker opens itself — choosing is this player's first job of the match and there is nothing
   * to gain by making them find the button — and dismissing it is sticky, so it can never pop back
   * over a live turn.
   */
  const isSeeker = Boolean(
    currentSeatID
      && G.gameStatus === 'active'
      && G.players[currentSeatID]?.character === 'The Seeker'
      && !G.players[currentSeatID].hasLeft,
  )
  const isSeekerPickerOpen = isSeeker && !hasDismissedSeekerPicker

  const hasEscapableLayer = Boolean(
    selectedCharacterCard || isSeekerPickerOpen || isHistoryOpen || selectedTargetSeatID,
  )

  // Escape closes one layer at a time, innermost first.
  useEffect(() => {
    if (!hasEscapableLayer) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }

      if (selectedCharacterCard) {
        setSelectedCharacterCard(null)
        return
      }

      if (isSeekerPickerOpen) {
        setHasDismissedSeekerPicker(true)
        return
      }

      if (isHistoryOpen) {
        setIsHistoryOpen(false)
        return
      }

      setSelectedTargetSeatID(null)
      clearFailMessage()
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [hasEscapableLayer, selectedCharacterCard, isSeekerPickerOpen, isHistoryOpen, clearFailMessage])

  useEffect(() => {
    if (G.gameStatus === 'staging' || !G.useCharacters || G.gameStatus === 'finished') {
      setSelectedCharacterCard(null)
    }
  }, [G.gameStatus, G.useCharacters])

  useEffect(() => {
    if (G.gameStatus === 'active' && currentSeatID && G.players[currentSeatID]?.character === 'The Foreigner') {
      return
    }

    setSelectedForeignerCardCode('none')
  }, [G.gameStatus, G.players, currentSeatID])

  useEffect(() => {
    if (!currentSeatID) {
      setSelectedCardIDs([])
      return
    }

    const availableCardIDs = new Set(G.players[currentSeatID]?.hand.map((card) => card.id) ?? [])
    setSelectedCardIDs((previousIDs) => {
      const nextIDs = previousIDs.filter((cardID) => availableCardIDs.has(cardID))
      return nextIDs.length === previousIDs.length ? previousIDs : nextIDs
    })
  }, [G.players, currentSeatID])

  useEffect(() => {
    if (G.bsResolution || G.resetResolution || G.accusation) {
      setSelectedCardIDs([])
    }
  }, [G.bsResolution?.id, G.resetResolution?.id, G.accusation?.id])

  /*
   * The lead-in is the only timed part of either reveal procedure. Everything after it waits on the
   * caller, who flips each card and confirms each step by hand, so the rest is derived from the
   * live resolution rather than run off a clock. BS spends the pause drawing its call trail from
   * the caller's block to the accused's; Reset has nothing to draw and simply waits.
   */
  useEffect(() => {
    const resolution = G.bsResolution ?? G.resetResolution

    if (!resolution) {
      setLeadInProgress(null)
      return
    }

    const { id } = resolution

    setLeadInProgress({
      resolutionID: id,
      isActive: true,
      callTrail: G.bsResolution
        ? buildBSCallTrailMarks(
            tableBoardRef.current,
            G.bsResolution.callerPlayerID,
            G.bsResolution.targetPlayerID,
            scaleSequenceDelay(BS_CALL_TRAIL_MARK_INTERVAL_MS, G.speedMultiplier),
          )
        : [],
    })

    const timeoutID = window.setTimeout(() => {
      setLeadInProgress((previousProgress) => previousProgress?.resolutionID === id
        ? { ...previousProgress, isActive: false }
        : previousProgress)
    }, scaleSequenceDelay(G.bsResolution ? BS_CALL_TRAIL_LEAD_IN_MS : RESET_REVEAL_LEAD_IN_MS, G.speedMultiplier))

    return () => {
      window.clearTimeout(timeoutID)
    }
  }, [G.bsResolution?.id, G.resetResolution?.id, G.speedMultiplier])

  // Holds the table still for a beat after the last card is revealed, so the Punish prompt reads as
  // a separate moment rather than arriving on top of the final flip.
  useEffect(() => {
    if (!G.bsResolution || !isBSRevealComplete || G.bsResolution.isPunishing) {
      setIsBSPunishPromptReady(false)
      return
    }

    const timeoutID = window.setTimeout(() => {
      setIsBSPunishPromptReady(true)
    }, scaleSequenceDelay(BS_PUNISH_PROMPT_DELAY_MS, G.speedMultiplier))

    return () => {
      window.clearTimeout(timeoutID)
    }
  }, [G.bsResolution?.id, isBSRevealComplete, G.bsResolution?.isPunishing, G.speedMultiplier])

  /*
   * Runs on every client off the synced isPunishing flag rather than a local timer, so the travel
   * stays in step and replays intact for anyone who reconnects mid-animation. Only the caller arms
   * the finalize that follows it.
   */
  useEffect(() => {
    if (!activePunishment) {
      setPunishmentMoveSequence(null)
      setDepartedPunishmentCardIDs([])
      return
    }

    const { id, kind, cardCount: punishmentCardCount, driverSeatID } = activePunishment
    const timeoutIDs: number[] = []
    const punishmentMoveDuration = scaleSequenceDelay(BS_PUNISHMENT_MOVE_DURATION_MS, G.speedMultiplier)
    const punishmentMoveStagger = scaleSequenceDelay(BS_PUNISHMENT_MOVE_STAGGER_MS, G.speedMultiplier)
    const punishmentImpactDuration = scaleSequenceDelay(BS_PUNISHMENT_IMPACT_DURATION_MS, G.speedMultiplier)
    const punishmentMoveTotalDuration = punishmentCardCount > 0
      ? punishmentMoveDuration + Math.max(0, punishmentCardCount - 1) * punishmentMoveStagger
      : 0

    const startPunishmentMoveSequence = () => {
      const boardElement = tableBoardRef.current
      // Re-read at animation-frame time rather than trusting the render that armed this, so the
      // measurement cannot run against a resolution that has already been finalized.
      const liveProcedure = kind === 'bs' ? latestBSResolutionRef.current : latestAccusationRef.current
      const punishedPlayerID = liveProcedure?.id !== id
        ? null
        : kind === 'bs'
        ? latestBSResolutionRef.current?.punishment?.punishedPlayerID ?? null
        : latestAccusationRef.current?.punishedPlayerID ?? null
      const destinationElement = punishedPlayerID
        ? boardElement?.querySelector<HTMLElement>(`[data-punishment-target-name="${punishedPlayerID}"]`) ?? null
        : null

      if (!boardElement || !destinationElement) {
        setPunishmentMoveSequence(null)
        setDepartedPunishmentCardIDs([])
        return
      }

      const boardRect = boardElement.getBoundingClientRect()
      const destinationRect = destinationElement.getBoundingClientRect()
      // A BS resolution has already turned every card face up for every viewer, so `play.cards`
      // carries real sprites. An accusation reveals nothing, so the same read yields card backs and
      // the cards travel face down, which is what actually happened at the table.
      const cards = latestTablePlaysRef.current.flatMap((play) => {
        return play.cards.flatMap((card) => {
          const overlayCardID = `${play.id}-${card.id}`
          const sourceElement = frontCardRefs.current.get(overlayCardID)
          if (!sourceElement) {
            return [] as PunishmentMoveCard[]
          }

          const sourceRect = sourceElement.getBoundingClientRect()

          return [{
            id: overlayCardID,
            sprite: card.sprite,
            width: sourceRect.width,
            height: sourceRect.height,
            startX: sourceRect.left - boardRect.left,
            startY: sourceRect.top - boardRect.top,
            moveX: 0,
            moveY: 0,
            delayMs: 0,
          } satisfies PunishmentMoveCard]
        })
      }).map((card, index) => ({
        ...card,
        moveX: getPunishmentMoveTargetPosition(destinationRect, boardRect, card.width, card.height, index).left - card.startX,
        moveY: getPunishmentMoveTargetPosition(destinationRect, boardRect, card.width, card.height, index).top - card.startY,
        delayMs: index * punishmentMoveStagger,
      }))

      setPunishmentMoveSequence(cards.length > 0
        ? {
            resolutionID: id,
            cards,
            durationMs: punishmentMoveDuration,
          }
        : null)
      setDepartedPunishmentCardIDs([])

      const impactDelayMs = cards.length > 0
        ? punishmentMoveDuration + cards[cards.length - 1].delayMs
        : 0

      if (cards.length > 0) {
        timeoutIDs.push(window.setTimeout(() => {
          setPunishmentImpactSeatID(punishedPlayerID)
        }, impactDelayMs))

        timeoutIDs.push(window.setTimeout(() => {
          setPunishmentImpactSeatID((previousSeatID) => previousSeatID === punishedPlayerID ? null : previousSeatID)
        }, impactDelayMs + punishmentImpactDuration))
      }

      cards.forEach((card) => {
        timeoutIDs.push(window.setTimeout(() => {
          setDepartedPunishmentCardIDs((previousIDs) => previousIDs.includes(card.id)
            ? previousIDs
            : [...previousIDs, card.id])
        }, card.delayMs))
      })
    }

    const animationFrameID = window.requestAnimationFrame(() => {
      startPunishmentMoveSequence()
    })

    if (currentSeatID && currentSeatID === driverSeatID && isActive) {
      timeoutIDs.push(window.setTimeout(() => {
        if (kind === 'bs') {
          finalizeBSResolutionRef.current({ resolutionID: id })
          return
        }

        finalizeAccusationRef.current({ accusationID: id })
      }, punishmentMoveTotalDuration + punishmentImpactDuration))
    }

    return () => {
      window.cancelAnimationFrame(animationFrameID)
      timeoutIDs.forEach((timeoutID) => {
        window.clearTimeout(timeoutID)
      })
    }
  }, [activePunishment?.id, activePunishment?.kind, G.speedMultiplier, currentSeatID, isActive])

  /*
   * The animation chain that follows a Reset or all-pass reveal. It waits for the caller to finish
   * revealing the table by hand, so it starts from `isResetRevealComplete` rather than from the
   * resolution arriving. Everything before that point is derived from `G.resetResolution`.
   */
  useEffect(() => {
    if (!G.resetResolution || !isResetRevealComplete) {
      setResetSequenceProgress(null)
      setResetMoveSequence(null)
      setResetGatherSequence(null)
      setResetPileState(null)
      setResetDealSequence(null)
      setDepartedResetCardIDs([])
      return
    }

    const { id, kind } = G.resetResolution
    const timeoutIDs: number[] = []
    const animationFrameIDs: number[] = []
    const shouldAutoFinalize = Boolean(currentSeatID && currentSeatID === G.resetResolution.callerPlayerID && isActive)
    if (kind === 'roundReturn') {
      // A beat to let the last flip land, then the cards go straight home.
      const returnStartAt = scaleSequenceDelay(RESET_POST_REVEAL_PAUSE_MS, G.speedMultiplier)
      const returnMoveDuration = scaleSequenceDelay(RESET_MOVE_DURATION_MS, G.speedMultiplier)
      const resolveAt = returnStartAt + returnMoveDuration

      const startResetMoveSequence = () => {
        const boardElement = tableBoardRef.current

        if (!boardElement) {
          setResetMoveSequence(null)
          setDepartedResetCardIDs([])
          return
        }

        const boardRect = boardElement.getBoundingClientRect()
        const cards: PunishmentMoveCard[] = []
        const destinationCounts = new Map<string, number>()

        for (const play of G.table.plays) {
          const destinationElement = boardElement.querySelector<HTMLElement>(`[data-punishment-target-name="${play.playerID}"]`) ?? null
          if (!destinationElement) {
            continue
          }

          const destinationRect = destinationElement.getBoundingClientRect()

          for (const card of play.cards) {
            const overlayCardID = `${play.id}-${card.id}`
            const sourceElement = frontCardRefs.current.get(overlayCardID)
            if (!sourceElement) {
              continue
            }

            const sourceRect = sourceElement.getBoundingClientRect()
            const destinationIndex = destinationCounts.get(play.playerID) ?? 0
            const targetPosition = getPunishmentMoveTargetPosition(
              destinationRect,
              boardRect,
              sourceRect.width,
              sourceRect.height,
              destinationIndex,
            )

            destinationCounts.set(play.playerID, destinationIndex + 1)
            cards.push({
              id: overlayCardID,
              sprite: card.sprite,
              width: sourceRect.width,
              height: sourceRect.height,
              startX: sourceRect.left - boardRect.left,
              startY: sourceRect.top - boardRect.top,
              moveX: targetPosition.left - (sourceRect.left - boardRect.left),
              moveY: targetPosition.top - (sourceRect.top - boardRect.top),
              delayMs: 0,
            })
          }
        }

        setResetMoveSequence(cards.length > 0
          ? {
              resolutionID: id,
              cards,
              durationMs: returnMoveDuration,
            }
          : null)
        setResetGatherSequence(null)
        setResetPileState(null)
        setResetDealSequence(null)
        setDepartedResetCardIDs(cards.map((card) => card.id))
      }

      setResetSequenceProgress({
        resolutionID: id,
        stage: 'returning',
        dealtCardCount: 0,
      })
      setResetMoveSequence(null)
      setResetGatherSequence(null)
      setResetPileState(null)
      setResetDealSequence(null)
      setDepartedResetCardIDs([])

      timeoutIDs.push(window.setTimeout(() => {
        animationFrameIDs.push(window.requestAnimationFrame(() => {
          startResetMoveSequence()
        }))
      }, returnStartAt))

      if (shouldAutoFinalize) {
        timeoutIDs.push(window.setTimeout(() => {
          finalizeResetResolutionRef.current({ resolutionID: id })
        }, resolveAt))
      }

      return () => {
        animationFrameIDs.forEach((animationFrameID) => {
          window.cancelAnimationFrame(animationFrameID)
        })
        timeoutIDs.forEach((timeoutID) => {
          window.clearTimeout(timeoutID)
        })
      }
    }

    const gatherDuration = scaleSequenceDelay(RESET_GATHER_DURATION_MS, G.speedMultiplier)
    const postGatherPause = scaleSequenceDelay(RESET_POST_GATHER_PAUSE_MS, G.speedMultiplier)
    const shuffleDuration = scaleSequenceDelay(RESET_PILE_SHUFFLE_DURATION_MS, G.speedMultiplier)
    const dealInterval = scaleSequenceDelay(RESET_DEAL_INTERVAL_MS, G.speedMultiplier)
    const dealDuration = scaleSequenceDelay(RESET_DEAL_DURATION_MS, G.speedMultiplier)
    const postDealPause = scaleSequenceDelay(RESET_POST_DEAL_PAUSE_MS, G.speedMultiplier)
    // A beat to let the last flip land before the table is swept up.
    const gatherStartAt = scaleSequenceDelay(RESET_POST_REVEAL_PAUSE_MS, G.speedMultiplier)
    const gatherEndAt = gatherStartAt + gatherDuration
    const shuffleStartAt = gatherEndAt + postGatherPause
    const dealStartAt = shuffleStartAt + shuffleDuration
    const resetDealPlayerOrder = getResetDealPlayerOrder(G, G.resetResolution)
    const dealPhaseDuration = resetDealPlayerOrder.length > 0
      ? dealDuration + Math.max(0, (resetDealPlayerOrder.length - 1) * dealInterval)
      : 0
    const resolveAt = dealStartAt + dealPhaseDuration + postDealPause
    let measuredPileCards: ResetPileCard[] = []

    const measureResetPileCards = () => {
      const boardElement = tableBoardRef.current
      if (!boardElement) {
        return [] as ResetPileCard[]
      }

      const boardRect = boardElement.getBoundingClientRect()
      const pileAnchor = getResetPileAnchorPosition(boardElement, boardRect)
      const pileCards: ResetPileCard[] = []

      for (const play of G.table.plays) {
        for (const card of play.cards) {
          const overlayCardID = `${play.id}-${card.id}`
          const sourceElement = frontCardRefs.current.get(overlayCardID)
          if (!sourceElement) {
            continue
          }

          const sourceRect = sourceElement.getBoundingClientRect()
          const pilePlacement = getResetPileCardPlacement(pileAnchor, sourceRect.width, sourceRect.height, pileCards.length)

          pileCards.push({
            id: overlayCardID,
            sprite: card.sprite,
            width: sourceRect.width,
            height: sourceRect.height,
            left: pilePlacement.left,
            top: pilePlacement.top,
            rotationDeg: pilePlacement.rotationDeg,
            shuffleDelayMs: pilePlacement.shuffleDelayMs,
          })
        }
      }

      return pileCards
    }

    const startResetGatherSequence = () => {
      const boardElement = tableBoardRef.current

      if (!boardElement) {
        setResetGatherSequence(null)
        setResetPileState(null)
        setResetDealSequence(null)
        setDepartedResetCardIDs([])
        return
      }

      const boardRect = boardElement.getBoundingClientRect()
      const pileCards = measureResetPileCards()
      const cards: PunishmentMoveCard[] = []

      for (const pileCard of pileCards) {
        const sourceElement = frontCardRefs.current.get(pileCard.id)
        if (!sourceElement) {
          continue
        }

        const sourceRect = sourceElement.getBoundingClientRect()
        cards.push({
          id: pileCard.id,
          sprite: pileCard.sprite,
          width: pileCard.width,
          height: pileCard.height,
          startX: sourceRect.left - boardRect.left,
          startY: sourceRect.top - boardRect.top,
          moveX: pileCard.left - (sourceRect.left - boardRect.left),
          moveY: pileCard.top - (sourceRect.top - boardRect.top),
          delayMs: 0,
          rotateDeg: pileCard.rotationDeg,
        })
      }

      measuredPileCards = pileCards
      setResetMoveSequence(null)
      setResetGatherSequence(cards.length > 0
        ? {
            resolutionID: id,
            cards,
            durationMs: gatherDuration,
          }
        : null)
      setResetPileState(null)
      setResetDealSequence(null)
      setDepartedResetCardIDs(cards.map((card) => card.id))
    }

    const startResetDealSequence = () => {
      const boardElement = tableBoardRef.current
      if (!boardElement || measuredPileCards.length === 0) {
        setResetDealSequence(null)
        return
      }

      const boardRect = boardElement.getBoundingClientRect()
      const destinationCounts = new Map<string, number>()
      const cards: PunishmentMoveCard[] = []

      resetDealPlayerOrder.forEach((targetSeatID, dealIndex) => {
        const destinationElement = boardElement.querySelector<HTMLElement>(`[data-punishment-target-name="${targetSeatID}"]`) ?? null
        const sourceCard = measuredPileCards[dealIndex] ?? measuredPileCards[measuredPileCards.length - 1] ?? null

        if (!destinationElement || !sourceCard) {
          return
        }

        const destinationRect = destinationElement.getBoundingClientRect()
        const destinationIndex = destinationCounts.get(targetSeatID) ?? 0
        const targetPosition = getPunishmentMoveTargetPosition(
          destinationRect,
          boardRect,
          sourceCard.width,
          sourceCard.height,
          destinationIndex,
        )

        destinationCounts.set(targetSeatID, destinationIndex + 1)
        cards.push({
          id: `${id}-deal-${dealIndex}`,
          sprite: CARD_BACK_FILENAME,
          width: sourceCard.width,
          height: sourceCard.height,
          startX: sourceCard.left,
          startY: sourceCard.top,
          moveX: targetPosition.left - sourceCard.left,
          moveY: targetPosition.top - sourceCard.top,
          delayMs: dealIndex * dealInterval,
        })
      })

      setResetDealSequence(cards.length > 0
        ? {
            resolutionID: id,
            cards,
            durationMs: dealDuration,
          }
        : null)
    }

    setResetSequenceProgress({
      resolutionID: id,
      stage: 'gathering',
      dealtCardCount: 0,
    })
    setResetMoveSequence(null)
    setResetGatherSequence(null)
    setResetPileState(null)
    setResetDealSequence(null)
    setDepartedResetCardIDs([])

    timeoutIDs.push(window.setTimeout(() => {
      animationFrameIDs.push(window.requestAnimationFrame(() => {
        startResetGatherSequence()
      }))
    }, gatherStartAt))

    timeoutIDs.push(window.setTimeout(() => {
      setResetGatherSequence((previousSequence) => previousSequence?.resolutionID === id ? null : previousSequence)
      setResetPileState(measuredPileCards.length > 0
        ? {
            resolutionID: id,
            cards: measuredPileCards,
            isFaceDown: false,
            isShuffling: false,
          }
        : null)
    }, gatherEndAt))

    timeoutIDs.push(window.setTimeout(() => {
      setResetSequenceProgress((previousProgress) => previousProgress?.resolutionID === id
        ? {
            ...previousProgress,
            stage: 'shuffling',
          }
        : previousProgress)

      setResetPileState((previousState) => previousState?.resolutionID === id
        ? {
            ...previousState,
            isFaceDown: true,
            isShuffling: true,
          }
        : previousState)

      setResetDealSequence(null)
    }, shuffleStartAt))

    timeoutIDs.push(window.setTimeout(() => {
      setResetSequenceProgress((previousProgress) => previousProgress?.resolutionID === id
        ? {
            ...previousProgress,
            stage: 'dealing',
            dealtCardCount: 0,
          }
        : previousProgress)

      setResetPileState((previousState) => previousState?.resolutionID === id
        ? {
            ...previousState,
            isFaceDown: true,
            isShuffling: false,
          }
        : previousState)

      animationFrameIDs.push(window.requestAnimationFrame(() => {
        startResetDealSequence()
      }))
    }, dealStartAt))

    resetDealPlayerOrder.forEach((_, dealIndex) => {
      timeoutIDs.push(window.setTimeout(() => {
        setResetSequenceProgress((previousProgress) => previousProgress?.resolutionID === id
          ? {
              ...previousProgress,
              dealtCardCount: Math.max(previousProgress.dealtCardCount, dealIndex + 1),
            }
          : previousProgress)
      }, dealStartAt + dealIndex * dealInterval))
    })

    if (shouldAutoFinalize) {
      timeoutIDs.push(window.setTimeout(() => {
        finalizeResetResolutionRef.current({ resolutionID: id })
      }, resolveAt))
    }

    return () => {
      animationFrameIDs.forEach((animationFrameID) => {
        window.cancelAnimationFrame(animationFrameID)
      })
      timeoutIDs.forEach((timeoutID) => {
        window.clearTimeout(timeoutID)
      })
    }
  }, [G.resetResolution?.id, G.speedMultiplier, G.table.plays, ctx.currentPlayer, currentSeatID, isActive])

  const activePlayerIDs = getActivePlayerIDs(G)
  const activePlayerCount = activePlayerIDs.length || ctx.numPlayers
  const totalCardsOnTable = getTableCardCount(G.table)
  const maxCardsOnTable = G.round.maxCardsOnTable
  const currentTrump = G.round.trumpRank
  const bsResolution = G.bsResolution
  const resetResolution = G.resetResolution
  const accusation = G.accusation
  const isBSSequenceActive = bsResolution !== null
  const isResetSequenceActive = resetResolution !== null
  const isAccusationActive = accusation !== null
  const isResolutionSequenceActive = isBSSequenceActive || isResetSequenceActive || isAccusationActive
  const resolutionSequenceLabel = isBSSequenceActive ? 'BS' : isAccusationActive ? 'accusation' : 'Reset'
  const actingPlayerID = ctx.currentPlayer
  const currentPlayerState = currentSeatID ? (G.players[currentSeatID] ?? null) : null
  const handCards = currentPlayerState ? sortCards(currentPlayerState.hand).map(toHandCard) : []
  const handCardIDsKey = handCards.map((card) => card.id).join('|')
  const scoredSetIDsKey = currentPlayerState?.scoredSets.map((scoredSet) => scoredSet.id).join('|') ?? ''
  const seatPointsKey = G.seatOrder.map((seatID) => `${seatID}:${G.players[seatID].points}`).join('|')
  const selectedCards = handCards.filter((card) => selectedCardIDs.includes(card.id))
  const isSpectator = currentSeatID === null
  const isCurrentPlayersTurn = Boolean(
    currentSeatID
      && ctx.currentPlayer === currentSeatID
      && isActive
      && G.gameStatus === 'active',
  )
  const isInteractiveTurn = isCurrentPlayersTurn && !isResolutionSequenceActive
  const isGrandmaster = currentPlayerState?.character === 'The Grandmaster'
  const isContrarian = currentPlayerState?.character === 'The Contrarian'
  const hasGrandmasterBSOverrideAvailable = canUseClientGrandmasterBSOverride(G, currentSeatID)
  const defaultBSTargetSeatID = getClientDefaultBSTargetSeatID(G, currentSeatID)
  // The Pawn's en-passant target needs no separate control: it is one of the seats
  // `resolveClientBSTargetSelection` accepts, so clicking that block and pressing Call BS
  // exercises the power.
  // Any live opponent can be pointed at, on or off your turn: hovering a block reveals its Call BS
  // and Accuse buttons, and those explain why an attempt is illegal rather than the block refusing
  // to respond. Suspended while a resolution plays, so the sequence is not competing with hover
  // frames and action bubbles, and withheld from spectators, who have nothing to challenge with.
  const canTargetSeats = !isSpectator && G.gameStatus === 'active' && !isResolutionSequenceActive
  const selectableTargetSeatIDSet = new Set(
    canTargetSeats
      ? G.seatOrder.filter((seatID) => seatID !== currentSeatID && !G.players[seatID].hasLeft)
      : [],
  )
  const resolvedTargetSeatID = selectedTargetSeatID && selectableTargetSeatIDSet.has(selectedTargetSeatID)
    ? selectedTargetSeatID
    : null
  // Only a selection made on your own turn re-points the BS target highlight, so browsing
  // blocks out of turn never makes another player look like the live target.
  const visibleTargetSeatID = bsResolution?.targetPlayerID
    ?? (isInteractiveTurn ? resolvedTargetSeatID : null)
    ?? defaultBSTargetSeatID
  const actionableBSTargetSeatID = visibleTargetSeatID && visibleTargetSeatID !== currentSeatID
    ? visibleTargetSeatID
    : null
  const hasBSTarget = Boolean(!isBSSequenceActive && actionableBSTargetSeatID)
  const isFinalTwoResolutionTurn = Boolean(
    !isBSSequenceActive
      && currentSeatID
      && activePlayerCount === 2
      && hasBSTarget
      && actionableBSTargetSeatID
      && G.players[actionableBSTargetSeatID].hand.length === 0,
  )
  const isDreamer = currentPlayerState?.character === 'The Dreamer'
  const isDrunkard = currentPlayerState?.character === 'The Drunkard'
  const isForeigner = currentPlayerState?.character === 'The Foreigner'
  const seekerCharacterChoices = isSeeker && currentSeatID ? getSeekerCharacterChoices(G, currentSeatID) : []
  const canSeekCharacter = isSeeker && !isResolutionSequenceActive && seekerCharacterChoices.length > 0
  const isRepeatingPreviousTrump = selectedTrumpRank === G.round.previousTrumpRank
  const canDreamerRepeatPreviousTrump = isDreamer && isRepeatingPreviousTrump
  const canSelectTrumpAndPlay = isInteractiveTurn
    && !isFinalTwoResolutionTurn
    && currentTrump === null
    && selectedCards.length > 0
    && (isDreamer || selectedCards.length <= 2)
    && (!isRepeatingPreviousTrump || canDreamerRepeatPreviousTrump)
    && (isDreamer || totalCardsOnTable + selectedCards.length <= maxCardsOnTable)
  const canPlayCards = isInteractiveTurn
    && !isFinalTwoResolutionTurn
    && currentTrump !== null
    && selectedCards.length > 0
    && (isDreamer || selectedCards.length <= 2)
    && (isDreamer || totalCardsOnTable + selectedCards.length <= maxCardsOnTable)
  const maxRandomPlayCardCount = Math.min(
    2,
    handCards.length,
    Math.max(0, maxCardsOnTable - totalCardsOnTable),
  )
  const drunkardRandomPlayCardCountOptions = Array.from(
    { length: maxRandomPlayCardCount },
    (_, optionIndex) => optionIndex + 1,
  )
  const canPlayRandomCards = isInteractiveTurn
    && isDrunkard
    && !isFinalTwoResolutionTurn
    && maxRandomPlayCardCount > 0
    && (currentTrump !== null || !isRepeatingPreviousTrump)
  // The Contrarian is bound to their own turn. The Dreamer is not: reaching into someone else's turn
  // is the whole cheat, and the only thing that can undo it is an accusation before that turn ends.
  const canToggleDirection = G.gameStatus === 'active'
    && isActive
    && !isResolutionSequenceActive
    && !currentPlayerState?.hasLeft
    && (isDreamer || (isContrarian && isCurrentPlayersTurn))
  // Mirrors the server's one-per-turn guard. Any play of yours stamped with the live turn number
  // while somebody else is on the clock can only be one you sneaked, so this needs no extra state.
  const hasSneakedThisTurn = Boolean(currentSeatID) && G.table.plays.some(
    (play) => play.playerID === currentSeatID && play.playedAtTurn === ctx.turn,
  )
  const isSneakWindowOpen = G.gameStatus === 'active'
    && isActive
    && isDreamer
    && !isCurrentPlayersTurn
    && !isResolutionSequenceActive
    && !currentPlayerState?.hasLeft
    && currentTrump !== null
    && !hasSneakedThisTurn
  const canSneakPlay = isSneakWindowOpen && selectedCards.length === 1
  const canPass = isInteractiveTurn && !isFinalTwoResolutionTurn
  const selectedPlayCallout = currentTrump && selectedCards.length > 0
    ? buildPlayCalloutText(currentTrump, selectedCards.length)
    : null
  const selectedTrumpPlayCallout = selectedCards.length > 0
    ? buildPlayCalloutText(selectedTrumpRank, selectedCards.length)
    : null
  const canCallReset = isInteractiveTurn && totalCardsOnTable >= maxCardsOnTable
  const canUseCat = isInteractiveTurn && currentPlayerState?.character === 'The Cat' && !isResolutionSequenceActive
  const selectedForeignerCardLabel = FOREIGNER_CARD_OPTIONS.find((option) => option.value === selectedForeignerCardCode)?.label ?? 'the selected card'
  const displayedTrumpRank = currentTrump ?? selectedTrumpRank
  const displayedTrumpLabel = currentTrump ? 'Live trump' : 'Selected rank'
  const currentPlayerLabel = playerName.trim() || (isSpectator ? 'Spectator' : getSeatLabel(currentPlayerState?.seatIndex))
  const actingSeatLabel = getSeatDisplayName(actingPlayerID, currentSeatID, playerName, playersFromRoom)
  const tableStatusTooltip = `${G.tableStatus}\n\nYou are ${currentPlayerLabel}. The current player is ${actingSeatLabel}.`
  const frontCardsColumnTooltip = canUseCat
    ? `current cards: ${totalCardsOnTable}, max cards: ${maxCardsOnTable}. Because you are The Cat, you may click any face-up front card to flip it face down.`
    : `current cards: ${totalCardsOnTable}, max cards: ${maxCardsOnTable}`
  const roomCodeTooltip = `Room Code:\n${matchID}`
  const copyRoomCodeLabel = copyRoomCodeStatus === 'copied'
    ? 'Room code copied'
    : copyRoomCodeStatus === 'failed'
    ? 'Could not copy room code'
    : 'Copy room code'
  const drunkardRandomPlayCountOptionsKey = drunkardRandomPlayCardCountOptions.join('|')

  useEffect(() => {
    if (!isDrunkard) {
      setSelectedDrunkardRandomPlayCardCount(1)
      return
    }

    setSelectedDrunkardRandomPlayCardCount((previousCount) => drunkardRandomPlayCardCountOptions.includes(previousCount)
      ? previousCount
      : (drunkardRandomPlayCardCountOptions[0] ?? 1))
  }, [drunkardRandomPlayCountOptionsKey, isDrunkard])
  const isStaging = G.gameStatus === 'staging'
  const roomSlots = Array.from({ length: ctx.numPlayers }, (_, slotIndex) => {
    const roomPlayer = playersFromRoom.find((entry) => String(entry.id) === String(slotIndex))
    const displayName = roomPlayer?.name?.trim() ?? ''

    return {
      id: String(slotIndex),
      slotIndex,
      displayName,
      isFilled: displayName.length > 0,
      isConnected: Boolean(roomPlayer?.isConnected),
      isHost: String(slotIndex) === G.hostPlayerID,
    }
  })
  const filledSeatCount = roomSlots.filter((slot) => slot.isFilled).length
  const allSeatsFilled = filledSeatCount === ctx.numPlayers
  const isHostPlayer = currentSeatID === G.hostPlayerID
  const hostSlot = roomSlots.find((slot) => slot.isHost) ?? null
  const stagingStatusText = isHostPlayer
    ? (allSeatsFilled
      ? 'Everyone is here. Start when ready.'
      : `Waiting for ${ctx.numPlayers - filledSeatCount} more player(s) to join the room.`)
    : `${hostSlot?.displayName || 'The host'} will start the game once the room is ready.`
  const stagingDeckSummary = G.deckConfig.rankSelectionMode === 'manual'
    ? `Manual deck with ranks ${G.deckConfig.selectedRanks.join(', ')} plus 2 Jokers.`
    : `Default deck with ${G.deckConfig.selectedRanks.length} selected standard ranks (${G.deckConfig.selectedRanks.join(', ')}) plus 2 Jokers.`
  const stagingCharactersSummary = G.useCharacters ? 'Enabled' : 'Disabled'
  const canStartMatch = isStaging && isHostPlayer && allSeatsFilled && !isLeaving
  const departedPunishmentCardIDSet = new Set(departedPunishmentCardIDs)
  const departedResetCardIDSet = new Set(departedResetCardIDs)
  const dealtResetCardCount = resetSequenceProgress && resetResolution && resetSequenceProgress.resolutionID === resetResolution.id
    ? resetSequenceProgress.dealtCardCount
    : 0
  const visibleResetPileCards = resetPileState && resetResolution && resetPileState.resolutionID === resetResolution.id
    ? resetPileState.cards.slice(dealtResetCardCount)
    : []
  const targetPlayID = bsResolution?.targetPlayID ?? getLatestHiddenPlay(G.table.plays, visibleTargetSeatID)?.id ?? null
  // Seats advance bottom -> left -> top -> right around the ring, so the game's clockwise
  // direction is also clockwise on screen and the arrow sprite can be read literally.
  const directionArrowOrientation = G.round.direction
  const directionIndicatorLabel = canToggleDirection
    ? isContrarian
      ? `Turn direction is ${directionArrowOrientation}. Click to use The Contrarian and flip the direction.`
      : `Turn direction is ${directionArrowOrientation}. Click to use The Dreamer and change the direction, on anyone's turn. Accuse can catch it until that turn ends.`
    : `Turn direction is ${directionArrowOrientation}.`
  const latestTablePlay = G.table.plays[G.table.plays.length - 1] ?? null
  const tableRevealKey = G.table.plays.map((play) => `${play.id}:${play.revealedAtTurn ?? 'hidden'}:${(play.revealedCardIDs ?? []).join(',')}`).join('|')
  const catHiddenKey = G.table.plays.map((play) => `${play.id}:${(play.rehiddenCardIDs ?? []).join(',')}`).join('|')
  // The x marks belong to the lead-in only; they unmount as soon as the reveal procedure starts.
  const bsCallTrailMarks = bsResolution && leadInProgress?.resolutionID === bsResolution.id
    && leadInProgress.isActive
    ? leadInProgress.callTrail
    : []
  // The target frame stays stamped on the accused for the whole resolution, not just the lead-in.
  const bsTargetMarkSeatID = bsResolution?.targetPlayerID ?? null
  // The bullseye holds off until the last x mark has landed, so it reads as the trail arriving
  // rather than as a second thing happening at the same time. Its keyframe starts at opacity 0
  // and fills backwards, so the delay alone hides it; no timer and no extra state. When the trail
  // could not be measured there is nothing to wait for and it stamps immediately.
  const bsTargetMarkDelayMs = leadInProgress?.resolutionID === bsResolution?.id
    && (leadInProgress?.callTrail.length ?? 0) > 0
    ? scaleSequenceDelay(BS_CALL_TRAIL_ARRIVAL_AT_MS, G.speedMultiplier)
    : 0
  // Unmasked only once the caller has confirmed the accused's step, so the label cannot be read
  // ahead of the reveal.
  const bsVerdictSeatID = bsResolution?.targetVerdict ? bsResolution.targetPlayerID : null
  const bsVerdictIsHonest = bsResolution?.targetVerdict?.targetWasHonest ?? null
  const bsPunishSeatID = isBSCaller && isBSRevealComplete && isBSPunishPromptReady && !bsResolution?.isPunishing
    ? bsResolution?.punishment?.punishedPlayerID ?? null
    : null
  // Everything an accusation shows waits on the freeze beat, so the shout is not immediately talked
  // over by its own answer.
  const isAccusationPunishable = Boolean(accusation
    && accusationVerdictStage?.accusationID === accusation.id
    && accusationVerdictStage.stage === 'punishable')
  // Whoever is about to take the table goes red and stays red for the rest of the accusation,
  // travel included. That is the accused on a hit and the accuser on a miss.
  const accusedCheatSeatID = accusation && isAccusationPunishable
    ? accusation.punishedPlayerID
    : null
  const accusationPunishSeatID = accusedCheatSeatID
    && accusation
    && currentSeatID === accusation.accuserPlayerID
    && !accusation.isPunishing
    ? accusedCheatSeatID
    : null
  // Filtered rather than cleared on the way in: a player who has left is not saying anything any
  // more, and their block now carries a permanent leave-effect label in the same place.
  const calloutTextBySeatID = Object.fromEntries(
    Object.entries(playerCallouts)
      .filter(([seatID]) => !G.players[seatID]?.hasLeft)
      .map(([seatID, callout]) => [seatID, callout.text]),
  )
  const revealFlippingCardIDSet = new Set(revealFlippingCardIDs)
  const activeMoveSequence = punishmentMoveSequence ?? resetMoveSequence
  const resetPileShuffleDurationMs = scaleSequenceDelay(RESET_PILE_SHUFFLE_DURATION_MS, G.speedMultiplier)
  const enteringHandCardIndexByID = new Map(enteringHandCardIDs.map((cardID, index) => [cardID, index]))
  const reversedHistory = [...G.history].reverse()
  const latestPassEvent = reversedHistory.find((event) => event.kind === 'action' && event.playerID !== null && event.title.endsWith(' passed')) ?? null

  useEffect(() => {
    const nextRevealedOverlayCardIDSet = new Set(
      G.table.plays.flatMap((play) => getFaceUpOverlayCardIDs(play)),
    )

    if (!hasMountedRevealWatcherRef.current) {
      hasMountedRevealWatcherRef.current = true
      previousRevealedOverlayCardIDSetRef.current = nextRevealedOverlayCardIDSet
      return
    }

    const newlyRevealedCardIDs = [...nextRevealedOverlayCardIDSet].filter(
      (overlayCardID) => !previousRevealedOverlayCardIDSetRef.current.has(overlayCardID),
    )

    previousRevealedOverlayCardIDSetRef.current = nextRevealedOverlayCardIDSet

    if (newlyRevealedCardIDs.length === 0) {
      return
    }

    const revealedCardIDSet = new Set(newlyRevealedCardIDs)
    setRevealFlippingCardIDs((previousIDs) => [...new Set([...previousIDs, ...newlyRevealedCardIDs])])

    const timeoutID = window.setTimeout(() => {
      setRevealFlippingCardIDs((previousIDs) => previousIDs.filter((cardID) => !revealedCardIDSet.has(cardID)))
      revealFlipTimeoutIDsRef.current = revealFlipTimeoutIDsRef.current.filter((currentTimeoutID) => currentTimeoutID !== timeoutID)
    }, FRONT_CARD_FLIP_DURATION_MS)

    revealFlipTimeoutIDsRef.current.push(timeoutID)
    // catHiddenKey matters here too: a Cat-rehidden card comes face up by leaving that set, not by
    // entering revealedCardIDs.
  }, [G.table.plays, tableRevealKey, catHiddenKey])

  useEffect(() => {
    const nextCatHiddenOverlayCardIDSet = new Set(
      G.table.plays.flatMap((play) => getCatHiddenOverlayCardIDs(play)),
    )

    if (!hasMountedCatHideWatcherRef.current) {
      hasMountedCatHideWatcherRef.current = true
      previousCatHiddenOverlayCardIDSetRef.current = nextCatHiddenOverlayCardIDSet
      return
    }

    const newlyCatHiddenCardIDs = [...nextCatHiddenOverlayCardIDSet].filter(
      (overlayCardID) => !previousCatHiddenOverlayCardIDSetRef.current.has(overlayCardID),
    )

    previousCatHiddenOverlayCardIDSetRef.current = nextCatHiddenOverlayCardIDSet

    if (newlyCatHiddenCardIDs.length === 0) {
      return
    }

    const hiddenCardIDSet = new Set(newlyCatHiddenCardIDs)
    setRevealFlippingCardIDs((previousIDs) => [...new Set([...previousIDs, ...newlyCatHiddenCardIDs])])

    const timeoutID = window.setTimeout(() => {
      setRevealFlippingCardIDs((previousIDs) => previousIDs.filter((cardID) => !hiddenCardIDSet.has(cardID)))
      revealFlipTimeoutIDsRef.current = revealFlipTimeoutIDsRef.current.filter((currentTimeoutID) => currentTimeoutID !== timeoutID)
    }, FRONT_CARD_FLIP_DURATION_MS)

    revealFlipTimeoutIDsRef.current.push(timeoutID)
  }, [G.table.plays, catHiddenKey])

  useEffect(() => {
    const nextPointsBySeat = new Map(G.seatOrder.map((seatID) => [seatID, G.players[seatID].points]))
    const previousPointsBySeat = previousPointsBySeatRef.current

    previousPointsBySeatRef.current = nextPointsBySeat

    if (!previousPointsBySeat) {
      return
    }

    // Both directions, not just gains: a leave-triggered penalty is the only way a total ever goes
    // down, and it lands at the same moment as the label explaining it. Flashing the pill is what
    // ties the two together.
    const changedPointSeatIDs = G.seatOrder.filter((seatID) => {
      return (nextPointsBySeat.get(seatID) ?? 0) !== (previousPointsBySeat.get(seatID) ?? 0)
    })

    if (changedPointSeatIDs.length === 0) {
      return
    }

    setPointsFlashDirectionBySeatID((previousDirections) => ({
      ...previousDirections,
      ...Object.fromEntries(changedPointSeatIDs.map((seatID) => [
        seatID,
        (nextPointsBySeat.get(seatID) ?? 0) > (previousPointsBySeat.get(seatID) ?? 0) ? 'gain' : 'loss',
      ])),
    }))

    for (const seatID of changedPointSeatIDs) {
      const existingTimeoutID = pointFlashTimeoutIDsRef.current.get(seatID)
      if (existingTimeoutID !== undefined) {
        window.clearTimeout(existingTimeoutID)
      }

      pointFlashTimeoutIDsRef.current.set(seatID, window.setTimeout(() => {
        setPointsFlashDirectionBySeatID((previousDirections) => Object.fromEntries(
          Object.entries(previousDirections).filter(([flashingSeatID]) => flashingSeatID !== seatID),
        ))
        pointFlashTimeoutIDsRef.current.delete(seatID)
      }, PLAYER_POINTS_FLASH_DURATION_MS))
    }
  }, [seatPointsKey])

  useEffect(() => {
    const latestPlayID = latestTablePlay?.id ?? null

    if (!hasMountedPlayWatcherRef.current) {
      hasMountedPlayWatcherRef.current = true
      lastSeenPlayIDRef.current = latestPlayID
      return
    }

    if (!latestPlayID || !latestTablePlay || latestPlayID === lastSeenPlayIDRef.current) {
      return
    }

    lastSeenPlayIDRef.current = latestPlayID

    /*
     * A play only speaks for itself when the player who made it was the one on the clock. A normal
     * play ends its own turn, so by the time this runs the turn number has already moved past it;
     * a play still stamped with the live turn while somebody else is acting is The Dreamer's, and
     * lands without a word. Whatever they were already saying stays up, uncancelled.
     */
    if (latestTablePlay.playedAtTurn === ctx.turn && latestTablePlay.playerID !== ctx.currentPlayer) {
      return
    }

    showPlayerCallout(
      latestTablePlay.playerID,
      latestPlayID,
      buildPlayCalloutText(latestTablePlay.claimedRank, getDisplayedPlayCardCount(latestTablePlay)),
    )
  }, [latestTablePlay?.id])

  useEffect(() => {
    const latestBSResolutionID = bsResolution?.id ?? null

    if (!hasMountedBSCalloutWatcherRef.current) {
      hasMountedBSCalloutWatcherRef.current = true
      lastSeenBSResolutionIDRef.current = latestBSResolutionID
      return
    }

    if (!latestBSResolutionID || !bsResolution || latestBSResolutionID === lastSeenBSResolutionIDRef.current) {
      return
    }

    lastSeenBSResolutionIDRef.current = latestBSResolutionID

    showPlayerCallout(
      bsResolution.callerPlayerID,
      latestBSResolutionID,
      pickCalloutTextForID(BS_PLAYER_CALLOUT_OPTIONS, latestBSResolutionID),
    )
  }, [bsResolution?.id])

  /*
   * The whole client-side life of an accusation, in one effect because it is one sequence: the
   * accuser shouts, the table holds still, and then either the accused goes red straight away or
   * they deny it first and the accuser goes red instead. Nothing here decides the outcome — the
   * server settled that when the move landed, and every client is replaying the same
   * `punishedPlayerID` off the same clock.
   *
   * `wasSuccessful` is in the deps, not just the id, so a corrected value re-runs the sequence
   * rather than leaving a stale verdict on screen. `accuseDreamer` is declared `client: false` so
   * that should never happen, but the outcome is exactly the thing this effect captures into state,
   * and a wrong capture here is invisible until someone is punished for it.
   */
  useEffect(() => {
    if (!accusation) {
      setAccusationVerdictStage(null)
      return
    }

    const { id, accuserPlayerID, targetPlayerID, wasSuccessful } = accusation

    setAccusationVerdictStage({ accusationID: id, stage: 'pending' })
    showPlayerCallout(
      accuserPlayerID,
      id,
      pickCalloutTextForID(ACCUSE_PLAYER_CALLOUT_OPTIONS, id).replace(
        '{name}',
        getSeatDisplayName(targetPlayerID, currentSeatID, playerName, playersFromRoom),
      ),
    )

    const timeoutIDs: number[] = []
    const verdictDelayMs = scaleSequenceDelay(ACCUSATION_VERDICT_DELAY_MS, G.speedMultiplier)

    timeoutIDs.push(window.setTimeout(() => {
      if (wasSuccessful) {
        setAccusationVerdictStage({ accusationID: id, stage: 'punishable' })
        return
      }

      // Only a wrong accusation is denied. Callouts are per seat now, so this sits alongside the
      // accuser's shout rather than replacing it, and the exchange reads as an exchange.
      setAccusationVerdictStage({ accusationID: id, stage: 'denied' })
      showPlayerCallout(targetPlayerID, `${id}-denial`, ACCUSATION_DENIAL_CALLOUT)
    }, verdictDelayMs))

    if (!wasSuccessful) {
      // Only a miss gets this second beat: the denial has to land before the accuser is asked to
      // punish themselves, or the two would arrive together and read as one event.
      timeoutIDs.push(window.setTimeout(() => {
        setAccusationVerdictStage({ accusationID: id, stage: 'punishable' })
      }, verdictDelayMs + scaleSequenceDelay(ACCUSATION_DENIAL_DURATION_MS, G.speedMultiplier)))
    }

    return () => {
      timeoutIDs.forEach((timeoutID) => {
        window.clearTimeout(timeoutID)
      })
    }
  }, [accusation?.id, accusation?.wasSuccessful, G.speedMultiplier])

  useEffect(() => {
    const latestResetResolutionID = resetResolution?.id ?? null

    if (!hasMountedResetCalloutWatcherRef.current) {
      hasMountedResetCalloutWatcherRef.current = true
      lastSeenResetResolutionIDRef.current = latestResetResolutionID
      return
    }

    if (!latestResetResolutionID || !resetResolution || latestResetResolutionID === lastSeenResetResolutionIDRef.current) {
      return
    }

    lastSeenResetResolutionIDRef.current = latestResetResolutionID

    showPlayerCallout(
      resetResolution.callerPlayerID,
      latestResetResolutionID,
      resetResolution.kind === 'roundReturn' ? 'All passed' : 'Reset!',
    )
  }, [resetResolution?.id])

  useEffect(() => {
    const latestPassEventID = latestPassEvent?.id ?? null

    if (!hasMountedPassCalloutWatcherRef.current) {
      hasMountedPassCalloutWatcherRef.current = true
      lastSeenPassEventIDRef.current = latestPassEventID
      return
    }

    if (!latestPassEventID || !latestPassEvent || !latestPassEvent.playerID || latestPassEventID === lastSeenPassEventIDRef.current) {
      return
    }

    if (latestPassEvent.detail.includes('Everyone passed')) {
      lastSeenPassEventIDRef.current = latestPassEventID
      return
    }

    lastSeenPassEventIDRef.current = latestPassEventID

    // Seeded from the event id rather than picked at random: a pass line now stays up until that
    // player acts again, and every client disagreeing about the wording would be obvious over that.
    showPlayerCallout(
      latestPassEvent.playerID,
      latestPassEventID,
      pickCalloutTextForID(PASS_PLAYER_CALLOUT_OPTIONS, latestPassEventID),
    )
  }, [latestPassEvent?.id])

  /*
   * The two ways a callout ends, now that none of them expire on their own. A player starting a
   * turn drops only their own line, so everyone else's stays up; a new round wipes the table clean.
   * Saying something new simply overwrites, which `showPlayerCallout` handles by itself.
   */
  useEffect(() => {
    setPlayerCallouts((previousCallouts) => {
      if (!(ctx.currentPlayer in previousCallouts)) {
        return previousCallouts
      }

      const { [ctx.currentPlayer]: clearedCallout, ...remainingCallouts } = previousCallouts
      void clearedCallout

      return remainingCallouts
    })
  }, [ctx.currentPlayer, ctx.turn])

  useEffect(() => {
    setPlayerCallouts((previousCallouts) => Object.keys(previousCallouts).length === 0 ? previousCallouts : {})
  }, [G.round.roundNumber])

  useLayoutEffect(() => {
    const handScrollRowElement = handScrollRowRef.current

    handAnimationTimeoutIDsRef.current.forEach((timeoutID) => {
      window.clearTimeout(timeoutID)
    })
    handAnimationTimeoutIDsRef.current = []

    if (!currentSeatID || !currentPlayerState || !handScrollRowElement) {
      previousHandCardsRef.current = []
      previousScoredSetIDsRef.current = new Set<string>()
      previousSeatIDRef.current = currentSeatID
      setEnteringHandCardIDs([])
      setRemovingHandCards([])
      return
    }

    const seatChanged = previousSeatIDRef.current !== currentSeatID
    const previousHandCards = seatChanged ? [] : previousHandCardsRef.current
    const previousHandIDSet = new Set(previousHandCards.map((card) => card.id))
    const currentHandIDSet = new Set(handCards.map((card) => card.id))
    const addedHandCards = handCards.filter((card) => !previousHandIDSet.has(card.id))
    const removedHandCardMap = new Map<string, HandCard>()

    for (const previousHandCard of previousHandCards) {
      if (!currentHandIDSet.has(previousHandCard.id)) {
        removedHandCardMap.set(previousHandCard.id, previousHandCard)
      }
    }

    const previousScoredSetIDs = seatChanged ? new Set<string>() : previousScoredSetIDsRef.current
    for (const scoredSet of currentPlayerState.scoredSets) {
      if (previousScoredSetIDs.has(scoredSet.id) || scoredSet.source === 'initialDeal') {
        continue
      }

      for (const card of scoredSet.cards) {
        if (!removedHandCardMap.has(card.id) && !currentHandIDSet.has(card.id)) {
          removedHandCardMap.set(card.id, {
            id: card.id,
            sprite: card.sprite,
          })
        }
      }
    }

    if (addedHandCards.length > 0) {
      setEnteringHandCardIDs(addedHandCards.map((card) => card.id))

      handAnimationTimeoutIDsRef.current.push(window.setTimeout(() => {
        setEnteringHandCardIDs([])
      }, HAND_CARD_ADD_DURATION_MS + Math.max(0, addedHandCards.length - 1) * HAND_CARD_ANIMATION_STAGGER_MS + 40))
    } else {
      setEnteringHandCardIDs([])
    }

    if (removedHandCardMap.size > 0) {
      const removedAnimationCards = [...removedHandCardMap.values()].map((card, index) => {
        const storedMetric = handCardMetricsRef.current.get(card.id)
          ?? getFallbackHandCardMetric(handScrollRowElement, handCardMetricsRef.current, index)

        return {
          id: card.id,
          sprite: card.sprite,
          left: storedMetric.left,
          top: storedMetric.top,
          width: storedMetric.width,
          delayMs: index * HAND_CARD_ANIMATION_STAGGER_MS,
        } satisfies HandMotionCard
      })

      setRemovingHandCards(removedAnimationCards)

      const maxDelay = removedAnimationCards[removedAnimationCards.length - 1]?.delayMs ?? 0
      handAnimationTimeoutIDsRef.current.push(window.setTimeout(() => {
        setRemovingHandCards([])
      }, HAND_CARD_REMOVE_DURATION_MS + maxDelay + 40))
    } else {
      setRemovingHandCards([])
    }

    previousHandCardsRef.current = handCards
    previousScoredSetIDsRef.current = new Set(currentPlayerState.scoredSets.map((scoredSet) => scoredSet.id))
    previousSeatIDRef.current = currentSeatID
  }, [currentSeatID, handCardIDsKey, scoredSetIDsKey])

  useLayoutEffect(() => {
    if (!currentSeatID) {
      handCardMetricsRef.current.clear()
      return
    }

    const nextMetrics = new Map<string, HandCardMetric>()
    const scrollLeft = handScrollRowRef.current?.scrollLeft ?? 0
    for (const [cardID, element] of handCardButtonRefs.current.entries()) {
      nextMetrics.set(cardID, {
        left: element.offsetLeft - scrollLeft,
        top: element.offsetTop,
        width: element.offsetWidth,
      })
    }

    handCardMetricsRef.current = nextMetrics
  }, [currentSeatID, handCardIDsKey])

  const seatRows: SeatRow[] = G.seatOrder.map((seatID) => {
    const player = G.players[seatID]
    const matchPlayer = playersFromRoom.find((entry) => String(entry.id) === seatID)
    const frontCards = G.table.plays
      .filter((play) => play.playerID === seatID)
      .flatMap((play) => {
        const revealedCardIDSet = getExplicitlyRevealedCardIDSet(play)
        const catHiddenCardIDSet = getCatHiddenCardIDSet(play)

        return play.cards.map((card) => {
          const overlayCardID = `${play.id}-${card.id}`
          const faceDown = catHiddenCardIDSet.has(card.id)
            || (play.revealedAtTurn === null && !revealedCardIDSet.has(card.id))

          return {
            id: overlayCardID,
            cardID: card.id,
            sprite: card.sprite,
            faceDown,
            isDeparted: departedPunishmentCardIDSet.has(overlayCardID) || departedResetCardIDSet.has(overlayCardID),
            isFlipping: revealFlippingCardIDSet.has(overlayCardID),
            isTargeted: !isResetSequenceActive && play.id === targetPlayID,
            isCatActionable: canUseCat && !faceDown,
            // Only the caller can flip, and only in the block currently pulled to the centre.
            isRevealable: isRevealCaller && seatID === focusedSeatID && faceDown,
            // A masked card is rewritten to rank Joker before it reaches the client, so an
            // unflipped card can never light up here.
            isTrumpHighlighted: Boolean(bsResolution) && !faceDown && G.round.trumpRank !== null
              && countsTowardReverseRule(card, G.round.trumpRank, player.character),
          }
        })
      })

    return {
      id: seatID,
      seatIndex: player.seatIndex,
      avatarSprite: getAvatarSprite(matchID, seatID),
      characterName: player.character,
      characterSprite: G.useCharacters ? getCharacterCardSprite(player.character) : '',
      frontCards,
      handCount: player.hand.length,
      hasLeft: player.hasLeft,
      isActingPlayer: seatID === actingPlayerID,
      isConnected: seatID === currentSeatID ? isConnected : Boolean(matchPlayer?.isConnected),
      isTargetPlayer: seatID === visibleTargetSeatID,
      isViewingPlayer: seatID === currentSeatID,
      leaveEffect: player.leaveEffect
        ? {
            label: formatLeaveEffectLabel(player.leaveEffect),
            isGain: player.leaveEffect.pointDelta > 0,
          }
        : null,
      name: getSeatDisplayName(seatID, currentSeatID, playerName, playersFromRoom),
      pointRanks: player.scoredSets.map((scoredSet) => scoredSet.rank),
      points: player.points,
      wasSeekerPick: player.seekerPickedCharacter !== null,
    }
  })

  const frontCardIDsKey = seatRows.map((seat) => `${seat.id}:${seat.frontCards.map((card) => card.id).join(',')}`).join('|')
  const enteringFrontCardIDSet = new Set(enteringFrontCardIDs)

  useLayoutEffect(() => {
    if (frontCardIDsKey === lastFrontCardIDsKeyRef.current) {
      return
    }

    lastFrontCardIDsKeyRef.current = frontCardIDsKey

    frontCardEntryTimeoutIDsRef.current.forEach((timeoutID) => {
      window.clearTimeout(timeoutID)
    })
    frontCardEntryTimeoutIDsRef.current = []

    const nextFrontCardIDsBySeat = new Map(
      seatRows.map((seat) => [seat.id, seat.frontCards.map((card) => card.id)]),
    )
    const boardElement = tableBoardRef.current

    if (!boardElement) {
      previousFrontCardIDsBySeatRef.current = nextFrontCardIDsBySeat
      setEnteringFrontCardIDs([])
      setFrontCardEntrySequence(null)
      return
    }

    if (!hasMountedFrontCardWatcherRef.current) {
      hasMountedFrontCardWatcherRef.current = true
      previousFrontCardIDsBySeatRef.current = nextFrontCardIDsBySeat
      return
    }

    const boardRect = boardElement.getBoundingClientRect()
    const animatedCards: FrontCardEntryCard[] = []
    let animationIndex = 0

    for (const seat of seatRows) {
      const sourceElement = handCountPillRefs.current.get(seat.id)
      if (!sourceElement) {
        continue
      }

      const previousFrontCardIDSet = new Set(previousFrontCardIDsBySeatRef.current.get(seat.id) ?? [])

      for (const card of seat.frontCards) {
        if (previousFrontCardIDSet.has(card.id)) {
          continue
        }

        const destinationElement = frontCardRefs.current.get(card.id)
        if (!destinationElement) {
          continue
        }

        const sourceRect = sourceElement.getBoundingClientRect()
        const destinationRect = destinationElement.getBoundingClientRect()
        const startX = sourceRect.left - boardRect.left + sourceRect.width / 2 - destinationRect.width / 2
        const startY = sourceRect.top - boardRect.top + sourceRect.height / 2 - destinationRect.height / 2
        const endX = destinationRect.left - boardRect.left
        const endY = destinationRect.top - boardRect.top

        animatedCards.push({
          id: card.id,
          sprite: card.faceDown ? CARD_BACK_FILENAME : card.sprite,
          width: destinationRect.width,
          height: destinationRect.height,
          startX,
          startY,
          moveX: endX - startX,
          moveY: endY - startY,
          delayMs: animationIndex * FRONT_CARD_ENTRY_STAGGER_MS,
        })
        animationIndex += 1
      }
    }

    previousFrontCardIDsBySeatRef.current = nextFrontCardIDsBySeat

    if (animatedCards.length === 0) {
      setEnteringFrontCardIDs([])
      setFrontCardEntrySequence(null)
      return
    }

    setEnteringFrontCardIDs(animatedCards.map((card) => card.id))
    setFrontCardEntrySequence({
      cards: animatedCards,
      durationMs: FRONT_CARD_ENTRY_DURATION_MS,
    })

    const maxDelay = animatedCards[animatedCards.length - 1]?.delayMs ?? 0
    frontCardEntryTimeoutIDsRef.current.push(window.setTimeout(() => {
      setEnteringFrontCardIDs([])
      setFrontCardEntrySequence(null)
    }, FRONT_CARD_ENTRY_DURATION_MS + maxDelay + 40))
  }, [frontCardIDsKey, seatRows])

  const historyEvents: HistoryEvent[] = G.history.map((event) => ({
    id: event.id,
    kind: event.kind,
    title: event.title,
    detail: event.detail,
  }))
  const winnerID = G.placements[0] ?? null
  const winnerLabel = winnerID
    ? getSeatDisplayName(winnerID, currentSeatID, playerName, playersFromRoom)
    : 'Unknown player'
  const isGameFinished = G.gameStatus === 'finished' && Boolean(winnerID)
  const isWinScreenOpen = isGameFinished && !hasDismissedWinScreen
  const endGameRows: EndGameRow[] = G.placements.map((seatID, placeIndex) => {
    const player = G.players[seatID]
    const lieRate = formatPercent(player.matchStats.lieCount, player.matchStats.playCount)
    const bsWinRate = formatPercent(player.matchStats.bsWinCount, player.matchStats.callBSCount)

    return {
      id: seatID,
      seatIndex: player.seatIndex,
      place: placeIndex + 1,
      name: getSeatDisplayName(seatID, currentSeatID, playerName, playersFromRoom),
      points: player.points,
      leaveOrder: player.leaveOrder ?? G.placements.length,
      playCount: player.matchStats.playCount,
      callBSCount: player.matchStats.callBSCount,
      passCount: player.matchStats.passCount,
      resetCount: player.matchStats.resetCount,
      turnsInGame: player.matchStats.turnsInGame,
      lieRate,
      cardsPlayed: player.matchStats.cardsPlayed,
      punishmentCount: player.matchStats.punishmentCount,
      bsWinRate,
      isWinner: seatID === winnerID,
      // Why the Points column can disagree with the ranks this player scored.
      leaveEffectLabel: player.leaveEffect ? formatLeaveEffectLabel(player.leaveEffect) : null,
    }
  })
  const endGameChartPoints = buildEndGameChartPoints(G.telemetry.events)
  const chartMaxHandCount = endGameChartPoints.reduce(
    (highestValue, point) => Math.max(highestValue, ...Object.values(point.handCountsByPlayer)),
    0,
  )
  const chartInnerWidth = ENDGAME_CHART_WIDTH - ENDGAME_CHART_PADDING.left - ENDGAME_CHART_PADDING.right
  const chartInnerHeight = ENDGAME_CHART_HEIGHT - ENDGAME_CHART_PADDING.top - ENDGAME_CHART_PADDING.bottom
  const chartXTickIndices = getEndGameChartTickIndices(endGameChartPoints.length)
  const chartYTicks = getEndGameChartYTicks(chartMaxHandCount)
  const endGameChartSeries = endGameRows.map((row, seriesIndex) => {
    const color = ENDGAME_CHART_COLORS[seriesIndex % ENDGAME_CHART_COLORS.length]
    const values = endGameChartPoints.map((point, pointIndex) => {
      const handCount = point.handCountsByPlayer[row.id] ?? 0
      const x = ENDGAME_CHART_PADDING.left + (endGameChartPoints.length <= 1
        ? chartInnerWidth / 2
        : (pointIndex / (endGameChartPoints.length - 1)) * chartInnerWidth)
      const y = ENDGAME_CHART_PADDING.top + (chartMaxHandCount === 0
        ? chartInnerHeight
        : ((chartMaxHandCount - handCount) / chartMaxHandCount) * chartInnerHeight)

      return {
        x,
        y,
        handCount,
        label: formatTurnLabel(point.turnNumber),
        title: point.title,
      }
    })

    return {
      id: row.id,
      name: row.name,
      color,
      finalHandCount: values[values.length - 1]?.handCount ?? 0,
      isWinner: row.isWinner,
      polylinePoints: values.map((point) => `${point.x},${point.y}`).join(' '),
      values,
    }
  })
  const latestPersonalPunishmentEvent = currentSeatID
    ? reversedHistory.find((event) => event.kind === 'punishment' && event.playerID === currentSeatID) ?? null
    : null

  useEffect(() => {
    const latestPunishmentEventID = latestPersonalPunishmentEvent?.id ?? null

    if (!hasMountedPunishmentWatcherRef.current) {
      hasMountedPunishmentWatcherRef.current = true
      lastSeenPunishmentEventIDRef.current = latestPunishmentEventID
      return
    }

    if (!latestPunishmentEventID || latestPunishmentEventID === lastSeenPunishmentEventIDRef.current) {
      return
    }

    lastSeenPunishmentEventIDRef.current = latestPunishmentEventID
    setIsPunishmentFlashActive(true)

    const timeoutID = window.setTimeout(() => {
      setIsPunishmentFlashActive(false)
    }, 2200)

    return () => {
      window.clearTimeout(timeoutID)
    }
  }, [latestPersonalPunishmentEvent?.id])

  const toggleCardSelection = (cardID: string) => {
    // Not turn-bound any more: The Dreamer has to be able to pick the cards they mean to sneak
    // while somebody else is on the clock.
    if (!isInteractiveTurn && !isSneakWindowOpen) {
      return
    }

    setSelectedCardIDs((previousIDs) => previousIDs.includes(cardID)
      ? previousIDs.filter((id) => id !== cardID)
      : [...previousIDs, cardID])
  }

  const sendSelectionToTable = (nextTrump: BlowCowRank | null) => {
    if (selectedCards.length === 0 || (!isDreamer && selectedCards.length > 2)) {
      return
    }

    const cardIDs = selectedCards.map((card) => card.id)
    if (nextTrump) {
      moves.selectTrumpAndPlay({
        trumpRank: nextTrump,
        cardIDs,
      })
    } else {
      moves.play({ cardIDs })
    }
    setSelectedCardIDs([])
  }

  // Deliberately silent on the way out: no target to pick, no callout, no announcement. The cards
  // simply appear in front of the Dreamer and it is on everyone else to notice.
  const handleSneakPlay = () => {
    if (!canSneakPlay) {
      return
    }

    moves.sneakPlay({ cardIDs: selectedCards.map((card) => card.id) })
    setSelectedCardIDs([])
  }

  const handlePass = () => {
    if (!canPass) {
      return
    }

    moves.pass(isForeigner ? { foreignerCardCode: selectedForeignerCardCode } : undefined)
    setSelectedForeignerCardCode('none')
    setSelectedCardIDs([])
  }

  const handlePlayRandom = () => {
    if (!canPlayRandomCards) {
      return
    }

    moves.playRandom({
      cardCount: selectedDrunkardRandomPlayCardCount,
      trumpRank: currentTrump === null ? selectedTrumpRank : null,
    })
    setSelectedCardIDs([])
  }

  const handleSeekCharacter = () => {
    if (!canSeekCharacter || !selectedSeekerCharacter || !seekerCharacterChoices.includes(selectedSeekerCharacter)) {
      return
    }

    moves.seekCharacter({ characterName: selectedSeekerCharacter })
    setSelectedSeekerCharacter(null)
  }

  const handleSeatSelect = (seatID: string) => {
    if (!selectableTargetSeatIDSet.has(seatID)) {
      return
    }

    clearFailMessage()
    setSelectedTargetSeatID((previousSeatID) => previousSeatID === seatID ? null : seatID)
  }

  /**
   * Mirrors every server precondition for `callBS` so an illegal attempt can explain itself.
   * Returns null when the move should be dispatched. See `src/ui/bsTargeting.ts`.
   */
  const getCallBSFailure = (seatID: string) => {
    const seatName = getSeatDisplayName(seatID, currentSeatID, playerName, playersFromRoom)

    if (G.gameStatus !== 'active') {
      return 'The match is not running.'
    }

    if (isResolutionSequenceActive) {
      return 'Wait for the current resolution to finish.'
    }

    if (!isCurrentPlayersTurn) {
      return 'You can only call BS on your own turn.'
    }

    if (!currentTrump) {
      return 'No trump rank yet, so there is nothing to challenge.'
    }

    if (seatID === currentSeatID) {
      return 'You cannot call BS on yourself.'
    }

    if (!getClientPendingPlay(G, seatID)) {
      return `${seatName} has no hidden cards to challenge.`
    }

    if (resolveClientBSTargetSelection(G, currentSeatID, seatID)) {
      return null
    }

    if (isGrandmaster && !hasGrandmasterBSOverrideAvailable) {
      return 'You already used The Grandmaster override this match.'
    }

    return defaultBSTargetSeatID
      ? `Only ${getSeatDisplayName(defaultBSTargetSeatID, currentSeatID, playerName, playersFromRoom)} can be challenged right now.`
      : 'Only the latest non-passing player can be challenged right now.'
  }

  /**
   * Accuse shares nothing with Call BS any more. It is legal off your turn, against The Dreamer,
   * and it never checks whether the cheat is really there — the board cannot know, because
   * `G.directionTamper` never leaves the server. Everything below is a precondition, not a hint.
   *
   * Including the character check: characters are public, so refusing to name anyone else gives
   * away nothing that the target's own character badge is not already showing.
   */
  const getAccuseFailure = (seatID: string) => {
    const seatName = getSeatDisplayName(seatID, currentSeatID, playerName, playersFromRoom)

    if (G.gameStatus !== 'active') {
      return 'The match is not running.'
    }

    if (isResolutionSequenceActive) {
      return 'Wait for the current resolution to finish.'
    }

    if (!currentSeatID || !currentPlayerState) {
      return 'Spectators cannot accuse.'
    }

    if (currentPlayerState.hasLeft) {
      return 'You have already left the game.'
    }

    if (seatID === currentSeatID) {
      return 'You cannot accuse yourself.'
    }

    if (G.players[seatID]?.hasLeft) {
      return `${seatName} has already left the game.`
    }

    // The one thing about an accusation the board *can* check, because characters are public.
    if (G.players[seatID]?.character !== 'The Dreamer') {
      return 'Only Dreamer can be accused'
    }

    if (currentPlayerState.hasUsedAccusationThisRound) {
      return 'You already used your accusation this round. You get another one next round.'
    }

    return null
  }

  const handleSeatCallBS = (seatID: string) => {
    const failure = getCallBSFailure(seatID)
    if (failure) {
      showFailMessage(failure)
      return
    }

    moves.callBS({ targetPlayerID: seatID })
    setSelectedTargetSeatID(null)
    setSelectedCardIDs([])
  }

  const handleSeatAccuse = (seatID: string) => {
    const failure = getAccuseFailure(seatID)
    if (failure) {
      showFailMessage(failure)
      return
    }

    moves.accuseDreamer({ targetPlayerID: seatID })
    setSelectedTargetSeatID(null)
  }

  const handleToggleDirection = () => {
    if (!canToggleDirection) {
      return
    }

    moves.toggleDirection()
  }

  const handleCallReset = () => {
    if (!canCallReset) {
      return
    }

    moves.callReset()
    setSelectedCardIDs([])
  }

  const handleCatHideCard = (cardID: string) => {
    if (!canUseCat) {
      return
    }

    moves.catHideCard({ cardID })
  }

  // Both procedures share the click target and the Continue button, so these route to whichever
  // resolution is live. The two can never overlap: each one blocks the other's move.
  const handleRevealCard = (cardID: string) => {
    if (!isRevealCaller || !focusedSeatID) {
      return
    }

    if (bsResolution) {
      moves.revealBSCard({ resolutionID: bsResolution.id, cardID })
      return
    }

    if (resetResolution) {
      moves.revealResetCard({ resolutionID: resetResolution.id, cardID })
    }
  }

  const handleAdvanceReveal = () => {
    if (!canAdvanceReveal) {
      return
    }

    if (bsResolution) {
      moves.advanceBSReveal({ resolutionID: bsResolution.id })
      return
    }

    if (resetResolution) {
      moves.advanceResetReveal({ resolutionID: resetResolution.id })
    }
  }

  // Only arms the punishment travel. The finalize that empties the table is scheduled by the
  // effect that watches the synced isPunishing flag, so every client sees the cards fly first.
  const handleBeginBSPunishment = () => {
    if (!bsResolution || !bsPunishSeatID) {
      return
    }

    moves.beginBSPunishment({ resolutionID: bsResolution.id })
  }

  // Same split as the BS Punish: this only arms the travel, and the effect watching the synced
  // isPunishing flag schedules the finalize that empties the table.
  const handleBeginAccusationPunishment = () => {
    if (!accusation || !accusationPunishSeatID) {
      return
    }

    moves.beginAccusationPunishment({ accusationID: accusation.id })
  }

  // These two nodes are measured by the card-travel animations, so every seat must keep a
  // real, visible element registered for as long as it is on the board.
  const registerFrontCard = (overlayCardID: string, element: HTMLDivElement | null) => {
    if (element) {
      frontCardRefs.current.set(overlayCardID, element)
      return
    }

    frontCardRefs.current.delete(overlayCardID)
  }

  const registerHandCountPill = (seatID: string, element: HTMLSpanElement | null) => {
    if (element) {
      handCountPillRefs.current.set(seatID, element)
      return
    }

    handCountPillRefs.current.delete(seatID)
  }

  const handleOpenCharacterCard = (seat: SeatRow) => {
    if (!seat.characterSprite) {
      return
    }

    setSelectedCharacterCard({
      playerName: seat.name,
      seatLabel: getSeatLabel(seat.seatIndex),
      characterName: seat.characterName ?? 'Unknown character',
      sprite: seat.characterSprite,
      wasSeekerPick: seat.wasSeekerPick,
    })
  }

  const renderSeatTargetActions = (seat: SeatRow) => {
    const targetSelection = resolveClientBSTargetSelection(G, currentSeatID, seat.id)
    const callBSFailure = getCallBSFailure(seat.id)
    const accuseFailure = getAccuseFailure(seat.id)

    return (
      <div className="seat-target-actions">
        <button
          className="seat-target-button"
          onClick={(event) => {
            event.stopPropagation()
            handleSeatCallBS(seat.id)
          }}
          title={callBSFailure
            ?? (targetSelection?.kind === 'pawnEnPassant'
              ? `Use The Pawn to challenge ${seat.name}'s earlier hidden play.`
              : targetSelection?.kind === 'grandmasterOverride'
              ? `Challenge ${seat.name}. This spends The Grandmaster override.`
              : `Challenge ${seat.name}, the latest non-passing player.`)}
          type="button"
        >
          Call BS
        </button>

        <button
          className="seat-target-button accuse"
          onClick={(event) => {
            event.stopPropagation()
            handleSeatAccuse(seat.id)
          }}
          title={accuseFailure
            ?? `Accuse ${seat.name} of cheating as The Dreamer. Costs your one accusation for this round whether or not it lands.`}
          type="button"
        >
          Accuse
        </button>
      </div>
    )
  }

  /*
   * The controls that drive a resolution forward: Continue and Punish for a BS reveal, Punish for a
   * caught accusation. All return null for every seat not currently offering them, and all are gated
   * on the viewer being the player who raised the procedure, so on any other client these buttons
   * never enter the DOM at all.
   */
  const renderSeatRevealActions = (seat: SeatRow) => {
    if (seat.id === accusationPunishSeatID) {
      return (
        <button
          className="seat-reveal-action-button punish"
          onClick={(event) => {
            event.stopPropagation()
            handleBeginAccusationPunishment()
          }}
          title={accusation?.wasSuccessful
            ? `${seat.name} was caught cheating and takes every card on the table.`
            : `The accusation was wrong, so you take every card on the table.`}
          type="button"
        >
          Punish
        </button>
      )
    }

    if (canAdvanceReveal && seat.id === focusedSeatID) {
      return (
        <button
          className="seat-reveal-action-button"
          onClick={(event) => {
            event.stopPropagation()
            handleAdvanceReveal()
          }}
          title={`Finish looking at ${seat.name}'s cards and move on.`}
          type="button"
        >
          Continue
        </button>
      )
    }

    if (seat.id === bsPunishSeatID) {
      return (
        <button
          className="seat-reveal-action-button punish"
          onClick={(event) => {
            event.stopPropagation()
            handleBeginBSPunishment()
          }}
          title={`${seat.name} takes every card on the table.`}
          type="button"
        >
          Punish
        </button>
      )
    }

    return null
  }

  const handleCopyRoomCode = () => {
    if (!navigator.clipboard?.writeText) {
      setCopyRoomCodeStatus('failed')
      return
    }

    void navigator.clipboard.writeText(matchID).then(() => {
      setCopyRoomCodeStatus('copied')
    }).catch(() => {
      setCopyRoomCodeStatus('failed')
    })
  }

  const getTableMoveStyle = (card: PunishmentMoveCard, durationMs: number): CSSProperties => ({
    left: `${card.startX}px`,
    top: `${card.startY}px`,
    width: `${card.width}px`,
    height: `${card.height}px`,
    '--punishment-move-delay': `${card.delayMs}ms`,
    '--punishment-move-duration': `${durationMs}ms`,
    '--punishment-move-x': `${card.moveX}px`,
    '--punishment-move-y': `${card.moveY}px`,
    '--reset-card-rotate': `${card.rotateDeg ?? 0}deg`,
  } as CSSProperties)

  const getPunishmentMoveStyle = (card: PunishmentMoveCard) => getTableMoveStyle(card, activeMoveSequence?.durationMs ?? 0)
  const getResetGatherStyle = (card: PunishmentMoveCard) => getTableMoveStyle(card, resetGatherSequence?.durationMs ?? 0)
  const getResetDealStyle = (card: PunishmentMoveCard) => getTableMoveStyle(card, resetDealSequence?.durationMs ?? 0)

  const getResetPileCardStyle = (card: ResetPileCard): CSSProperties => ({
    left: `${card.left}px`,
    top: `${card.top}px`,
    width: `${card.width}px`,
    height: `${card.height}px`,
    '--reset-pile-rotation': `${card.rotationDeg}deg`,
    '--reset-pile-shuffle-delay': `${card.shuffleDelayMs}ms`,
    '--reset-pile-shuffle-duration': `${resetPileShuffleDurationMs}ms`,
  } as CSSProperties)

  const getHandMotionCardStyle = (card: HandMotionCard): CSSProperties => ({
    left: `${card.left}px`,
    top: `${card.top}px`,
    width: `${card.width}px`,
    '--hand-change-delay': `${card.delayMs}ms`,
  } as CSSProperties)

  const getFrontCardEntryStyle = (card: FrontCardEntryCard): CSSProperties => ({
    left: `${card.startX}px`,
    top: `${card.startY}px`,
    width: `${card.width}px`,
    height: `${card.height}px`,
    '--front-card-entry-delay': `${card.delayMs}ms`,
    '--front-card-entry-duration': `${frontCardEntrySequence?.durationMs ?? 0}ms`,
    '--front-card-entry-x': `${card.moveX}px`,
    '--front-card-entry-y': `${card.moveY}px`,
  } as CSSProperties)

  const selectTrumpAction = {
    description: isResolutionSequenceActive
      ? `Wait for the ${resolutionSequenceLabel} resolution sequence to finish.`
      : currentTrump === null
      ? isRepeatingPreviousTrump && isDreamer
        ? `Use The Dreamer to pick ${selectedTrumpRank} again. The Dreamer may also send more than 2 cards or overfill the table. Accuse catches any of those, but only during the next player's turn.`
        : isRepeatingPreviousTrump
        ? `${selectedTrumpRank} was the previous round trump and cannot be selected again.`
        : isDreamer
        ? `Choose ${selectedTrumpRank} as trump. The Dreamer may also send more than 2 selected cards and can even overfill the table, but Accuse catches an illegal count during the next player's turn.`
        : `Choose ${selectedTrumpRank} as trump and play up to 2 selected cards.`
      : `Trump is already ${currentTrump}. Use Play to make the claim.`,
    disabled: !canSelectTrumpAndPlay,
    icon: PLAY_ICON_SPRITE,
    key: 'select-trump',
    label: selectedTrumpPlayCallout
      ? `Select Trump + Play "${selectedTrumpPlayCallout}"`
      : 'Select Trump + Play',
    onClick: () => {
      sendSelectionToTable(selectedTrumpRank)
    },
  }

  const playAction = {
    description: isResolutionSequenceActive
      ? `Wait for the ${resolutionSequenceLabel} resolution sequence to finish.`
      : currentTrump
      ? isDreamer
        ? `Play the selected cards and claim they are ${currentTrump}. The Dreamer may send more than 2 cards or overfill the table, but Accuse catches an illegal count during the next player's turn.`
        : `Play the selected cards and claim they are ${currentTrump}.`
      : 'Pick a trump rank first.',
    disabled: !canPlayCards,
    icon: PLAY_ICON_SPRITE,
    key: 'play',
    label: selectedPlayCallout ? `Play \"${selectedPlayCallout}\"` : 'Play',
    onClick: () => {
      sendSelectionToTable(null)
    },
  }

  const playRandomAction = {
    description: isResolutionSequenceActive
      ? `Wait for the ${resolutionSequenceLabel} resolution sequence to finish.`
      : currentTrump === null
      ? isRepeatingPreviousTrump
        ? `${selectedTrumpRank} was the previous round trump and cannot be selected again. Play Random still has to choose a new trump first.`
        : `Use The Drunkard to randomly select ${selectedDrunkardRandomPlayCardCount} card(s) from your hand, choose ${selectedTrumpRank} as trump, and place them face down. If you only ever use Play Random before leaving, you lose 3 points.`
      : maxRandomPlayCardCount === 0
      ? 'Need cards in hand and room on the table to use Play Random.'
      : `Use The Drunkard to randomly select ${selectedDrunkardRandomPlayCardCount} card(s) from your hand and claim they are ${currentTrump}. If you only ever use Play Random before leaving, you lose 3 points.`,
    disabled: !canPlayRandomCards,
    icon: PLAY_RANDOM_ICON_SPRITE,
    key: 'play-random',
    label: 'Play Random',
    onClick: handlePlayRandom,
  }

  /*
   * One of two actions in this row that belong to a player who is not on the clock — `Seek
   * Character` is the other — and the only one of the two that sends a move. It appears for The
   * Dreamer alone, which gives nothing away: characters are public, and their own badge says so.
   */
  const sneakPlayAction = {
    description: isResolutionSequenceActive
      ? `Wait for the ${resolutionSequenceLabel} resolution sequence to finish.`
      : currentTrump === null
      ? 'Nothing to claim until the round has a trump rank.'
      : hasSneakedThisTurn
      ? 'You already slipped cards onto the table this turn. Wait for the next one.'
      : selectedCards.length === 0
      ? `Select the one card to slip onto the table while ${actingSeatLabel} is acting.`
      : selectedCards.length > 1
      ? 'Only one card can be slipped onto the table at a time. Deselect the rest.'
      : `Use The Dreamer to place 1 card face down in front of you, claiming ${currentTrump}, without saying a word. Accuse catches this until ${actingSeatLabel}'s turn ends.`,
    disabled: !canSneakPlay,
    icon: SNEAK_PLAY_ICON_SPRITE,
    key: 'sneak-play',
    label: 'Sneak Play',
    onClick: handleSneakPlay,
  }

  /*
   * The second action in this row that does not belong to the player on the clock, and it opens a
   * panel rather than sending a move. It is only ever there while this player still holds The
   * Seeker, which is nothing to hide: characters are public, and their own badge already says so.
   */
  const seekCharacterAction = {
    description: isResolutionSequenceActive
      ? `Wait for the ${resolutionSequenceLabel} resolution sequence to finish.`
      : seekerCharacterChoices.length === 0
      ? 'Every other character in this room is already sitting at the table, so there is nothing left to take.'
      : 'Use The Seeker to take any character card nobody else holds. It replaces The Seeker for the rest of the match.',
    disabled: !canSeekCharacter,
    icon: '',
    key: 'seek-character',
    label: 'Seek Character',
    onClick: () => {
      setHasDismissedSeekerPicker(false)
    },
  }

  // Call BS and Accuse are not here: they live on the player blocks, because both need a
  // clicked target. See `renderSeatTargetActions`.
  // Labels the action row for whoever is on the clock. Spectators and waiting players see the
  // acting player's name, so the row never claims a turn that is not the viewer's.
  const handActionHeading = isCurrentPlayersTurn
    ? 'Your Turn'
    : `${getSeatDisplayName(actingPlayerID, currentSeatID, playerName, playersFromRoom)}'s Turn`

  const actionButtons = [
    currentTrump === null ? selectTrumpAction : playAction,
    ...(isDreamer && !isCurrentPlayersTurn && !isSpectator ? [sneakPlayAction] : []),
    ...(isSeeker ? [seekCharacterAction] : []),
    ...(isDrunkard ? [playRandomAction] : []),
    {
      description: isResolutionSequenceActive
        ? `Wait for the ${resolutionSequenceLabel} resolution sequence to finish.`
        : isFinalTwoResolutionTurn
        ? 'With two players left, you cannot pass after the other player emptied their hand with a hidden play.'
        : isForeigner && selectedForeignerCardCode !== 'none'
        ? `Pass and use The Foreigner to add ${selectedForeignerCardLabel} from outside the game to your hand before the turn ends.`
        : isForeigner
        ? 'Pass. As The Foreigner, you may also choose one outside card to add to your hand, or leave the selector on None.'
        : 'End your turn without playing cards. If everyone passes, the table cards return to their owners and the round restarts.',
      disabled: !canPass,
      icon: PASS_ICON_SPRITE,
      key: 'pass',
      label: 'Pass',
      onClick: handlePass,
    },
    {
      description: isResolutionSequenceActive
        ? `Wait for the ${resolutionSequenceLabel} resolution sequence to finish.`
        : isFinalTwoResolutionTurn && totalCardsOnTable >= maxCardsOnTable
        ? 'With two players left and the table full, Reset is allowed instead of forcing BS.'
        : totalCardsOnTable >= maxCardsOnTable
        ? 'Reset is legal because the table is at capacity.'
        : `Need ${maxCardsOnTable - totalCardsOnTable} more card(s) on the table before reset is legal.`,
      disabled: !canCallReset,
      icon: RESET_ICON_SPRITE,
      key: 'call-reset',
      label: 'Call Reset',
      onClick: handleCallReset,
    },
  ]

  return (
    <section className="table-board game-board-layout" ref={tableBoardRef}>
      {/*
        * Deliberately not a full-cover overlay: the ring stays visible behind it, because the last
        * player's leave-triggered ability lands at the same moment the game ends and its label is
        * on their block. Jumping straight to the results table would bury it.
        */}
      {isWinScreenOpen ? (
        <div aria-labelledby="win-screen-title" aria-modal="true" className="win-screen-overlay" role="dialog">
          <section className="win-screen-panel">
            <p className="panel-kicker">Game Over</p>
            <h2 id="win-screen-title">{winnerLabel} Wins</h2>

            <button
              autoFocus
              className="primary-button win-screen-continue"
              onClick={() => {
                setHasDismissedWinScreen(true)
              }}
              type="button"
            >
              Continue
            </button>
          </section>
        </div>
      ) : null}

      {isGameFinished && hasDismissedWinScreen ? (
        <div aria-labelledby="endgame-title" aria-modal="true" className="endgame-overlay" role="dialog">
          <section className="endgame-panel">
            <div className="endgame-header">
              <div className="endgame-copy">
                <p className="panel-kicker">Final Results</p>
                <h2 id="endgame-title">{winnerLabel} Is The Winner</h2>
                <p className="room-note endgame-summary">{G.tableStatus}</p>
              </div>

              <button
                className="secondary-button"
                disabled={isLeaving}
                onClick={onLeaveRoom}
                type="button"
              >
                {isLeaving ? 'Leaving Room...' : 'Leave Room'}
              </button>
            </div>

            <div className="endgame-table-wrap">
              <table className="endgame-table">
                <thead>
                  <tr>
                    <th>Place</th>
                    <th>Player</th>
                    <th>Points</th>
                    <th>Leave Order</th>
                    <th># of Plays</th>
                    <th># of Call BSs</th>
                    <th># of Passes</th>
                    <th># of Resets</th>
                    <th># of Turns</th>
                    <th>% of Lies</th>
                    <th># of Cards Played</th>
                    <th># Punished</th>
                    <th>BS Winrate</th>
                  </tr>
                </thead>
                <tbody>
                  {endGameRows.map((row) => (
                    <tr className={row.isWinner ? 'winner-row' : ''} key={row.id}>
                      <td>
                        <span className="endgame-place-pill">{formatOrdinal(row.place)}</span>
                      </td>
                      <td>
                        <div className="endgame-player-cell">
                          <div className="endgame-player-name">
                            <strong>{row.name}</strong>

                            {/*
                              * Focusable rather than hover-only, and carrying the label on the
                              * badge itself, so the point change is reachable without a pointer.
                              */}
                            {row.leaveEffectLabel ? (
                              <span
                                aria-label={`Leave ability point change: ${row.leaveEffectLabel}`}
                                className="endgame-info-badge"
                                role="note"
                                tabIndex={0}
                              >
                                i
                                <span className="endgame-info-tooltip">{row.leaveEffectLabel}</span>
                              </span>
                            ) : null}
                          </div>
                          <span className="room-note">{getSeatLabel(row.seatIndex)}</span>
                        </div>
                      </td>
                      <td>{row.points}</td>
                      <td>{formatOrdinal(row.leaveOrder)}</td>
                      <td>{row.playCount}</td>
                      <td>{row.callBSCount}</td>
                      <td>{row.passCount}</td>
                      <td>{row.resetCount}</td>
                      <td>{row.turnsInGame}</td>
                      <td>{row.lieRate === null ? 'N/A' : `${row.lieRate}%`}</td>
                      <td>{row.cardsPlayed}</td>
                      <td>{row.punishmentCount}</td>
                      <td>{row.bsWinRate === null ? 'N/A' : `${row.bsWinRate}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {endGameChartPoints.length > 0 ? (
              <section aria-labelledby="endgame-chart-title" className="endgame-chart-panel">
                <div className="endgame-chart-header">
                  <div>
                    <p className="panel-kicker">Telemetry</p>
                    <h3 id="endgame-chart-title">Cards In Hand Over Time</h3>
                  </div>
                  <p className="room-note endgame-chart-summary">
                    One point per turn, using the latest authoritative hand count snapshot recorded during that turn.
                  </p>
                </div>

                <div className="endgame-chart-wrap">
                  <svg
                    aria-label="Line chart of each player's cards in hand over the course of the match."
                    className="endgame-chart"
                    role="img"
                    viewBox={`0 0 ${ENDGAME_CHART_WIDTH} ${ENDGAME_CHART_HEIGHT}`}
                  >
                    <title>Cards in hand over time</title>

                    {chartYTicks.map((tickValue) => {
                      const y = ENDGAME_CHART_PADDING.top + (chartMaxHandCount === 0
                        ? chartInnerHeight
                        : ((chartMaxHandCount - tickValue) / chartMaxHandCount) * chartInnerHeight)

                      return (
                        <g key={`y-tick-${tickValue}`}>
                          <line
                            className="endgame-chart-grid-line"
                            x1={ENDGAME_CHART_PADDING.left}
                            x2={ENDGAME_CHART_WIDTH - ENDGAME_CHART_PADDING.right}
                            y1={y}
                            y2={y}
                          />
                          <text className="endgame-chart-axis-label" textAnchor="end" x={ENDGAME_CHART_PADDING.left - 10} y={y + 4}>
                            {tickValue}
                          </text>
                        </g>
                      )
                    })}

                    {chartXTickIndices.map((tickIndex) => {
                      const point = endGameChartPoints[tickIndex]
                      const x = ENDGAME_CHART_PADDING.left + (endGameChartPoints.length <= 1
                        ? chartInnerWidth / 2
                        : (tickIndex / (endGameChartPoints.length - 1)) * chartInnerWidth)

                      return (
                        <g key={`x-tick-${point.id}`}>
                          <line
                            className="endgame-chart-grid-line vertical"
                            x1={x}
                            x2={x}
                            y1={ENDGAME_CHART_PADDING.top}
                            y2={ENDGAME_CHART_HEIGHT - ENDGAME_CHART_PADDING.bottom}
                          />
                          <text className="endgame-chart-axis-label" textAnchor="middle" x={x} y={ENDGAME_CHART_HEIGHT - 10}>
                            {formatTurnLabel(point.turnNumber)}
                          </text>
                        </g>
                      )
                    })}

                    {endGameChartSeries.map((series) => {
                      const lastPoint = series.values[series.values.length - 1]

                      return (
                        <g key={series.id}>
                          <polyline
                            className={`endgame-chart-series-line${series.isWinner ? ' winner' : ''}`}
                            points={series.polylinePoints}
                            style={{ '--series-color': series.color } as CSSProperties}
                          />
                          {lastPoint ? (
                            <circle
                              className="endgame-chart-series-dot"
                              cx={lastPoint.x}
                              cy={lastPoint.y}
                              r={series.isWinner ? 5 : 4}
                              style={{ '--series-color': series.color } as CSSProperties}
                            >
                              <title>{`${series.name}: ${lastPoint.handCount} card(s) at ${lastPoint.label}. ${lastPoint.title}`}</title>
                            </circle>
                          ) : null}
                        </g>
                      )
                    })}
                  </svg>
                </div>

                <div className="endgame-chart-legend">
                  {endGameChartSeries.map((series) => (
                    <div className={`endgame-chart-legend-item${series.isWinner ? ' winner' : ''}`} key={series.id}>
                      <span className="endgame-chart-legend-swatch" style={{ '--series-color': series.color } as CSSProperties} />
                      <div className="endgame-chart-legend-copy">
                        <strong>{series.name}</strong>
                        <span className="room-note">{series.finalHandCount} card(s) at finish</span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
          </section>
        </div>
      ) : null}

      {selectedCharacterCard ? (
        <div
          aria-labelledby="character-card-overlay-title"
          aria-modal="true"
          className="character-card-overlay"
          onClick={() => {
            setSelectedCharacterCard(null)
          }}
          role="dialog"
        >
          <section
            className="character-card-overlay-panel"
            onClick={(event) => {
              event.stopPropagation()
            }}
          >
            <div className="character-card-overlay-header">
              <div className="character-card-overlay-copy">
                <p className="panel-kicker">Character Card</p>
                <h2 id="character-card-overlay-title">{selectedCharacterCard.characterName}</h2>
                <p className="room-note">
                  {selectedCharacterCard.playerName} · {selectedCharacterCard.seatLabel}
                  {selectedCharacterCard.wasSeekerPick ? ' · Taken with The Seeker' : ''}
                </p>
              </div>

              <button
                className="secondary-button"
                onClick={() => {
                  setSelectedCharacterCard(null)
                }}
                type="button"
              >
                Close
              </button>
            </div>

            <div className="character-card-overlay-body">
              <img
                alt={`${selectedCharacterCard.playerName}: ${selectedCharacterCard.characterName}`}
                className="character-card-overlay-image"
                src={selectedCharacterCard.sprite}
              />
            </div>
          </section>
        </div>
      ) : null}

      {/*
        * Mounted only on The Seeker's own client, so dimming the board here costs nobody else
        * anything — the match carries on behind it and every other player can act normally. The
        * cards are shown at a readable size rather than as a list of names, because the sprite is
        * the character sheet: it already carries the ability text this panel must not repeat.
        */}
      {isSeekerPickerOpen ? (
        <div
          aria-labelledby="seeker-picker-title"
          aria-modal="true"
          className="character-card-overlay seeker-picker-overlay"
          role="dialog"
        >
          <section className="character-card-overlay-panel seeker-picker-panel">
            <div className="character-card-overlay-header">
              <div className="character-card-overlay-copy">
                <p className="panel-kicker">The Seeker</p>
                <h2 id="seeker-picker-title">Take a Character Card</h2>
                <p className="room-note">
                  {seekerCharacterChoices.length === 0
                    ? 'Every other character in this room is already sitting at the table, so there is nothing left to take.'
                    : 'Anything nobody else holds is yours for the taking. It replaces The Seeker for the rest of the match.'}
                </p>
              </div>

              <button
                className="secondary-button"
                onClick={() => {
                  setHasDismissedSeekerPicker(true)
                }}
                type="button"
              >
                Close
              </button>
            </div>

            <div className="seeker-picker-grid">
              {seekerCharacterChoices.map((characterName) => (
                <button
                  aria-pressed={selectedSeekerCharacter === characterName}
                  className={`seeker-picker-option${selectedSeekerCharacter === characterName ? ' selected' : ''}`}
                  key={characterName}
                  onClick={() => {
                    setSelectedSeekerCharacter(characterName)
                  }}
                  type="button"
                >
                  <img alt={characterName} src={getCharacterCardSprite(characterName)} />
                </button>
              ))}
            </div>

            <div className="seeker-picker-footer">
              <p className="room-note">
                {isResolutionSequenceActive
                  ? `Wait for the ${resolutionSequenceLabel} resolution sequence to finish.`
                  : selectedSeekerCharacter
                  ? 'Taking a card spends The Seeker, so this is the only choice you get.'
                  : 'Nothing is decided until you confirm, and you can close this and come back to it at any point.'}
              </p>

              <button
                className="primary-button"
                disabled={!canSeekCharacter || !selectedSeekerCharacter}
                onClick={handleSeekCharacter}
                type="button"
              >
                {selectedSeekerCharacter ? `Take ${selectedSeekerCharacter}` : 'Take Character'}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {!isStaging && isHistoryOpen ? (
        <HistoryOverlay
          historyEvents={historyEvents}
          onClose={() => {
            setIsHistoryOpen(false)
          }}
        />
      ) : null}

      {/*
        * Washes the mono felt red while a BS call is being resolved. Keyed on the resolution id
        * so a fresh call restarts the animation, which means no state and no timeout to manage.
        */}
      {bsResolution ? (
        <div aria-hidden="true" className="board-bs-flash" key={bsResolution.id} />
      ) : null}

      {/*
        * The lead-in: x marks pop in one by one along the line from the caller's block to the
        * accused's, in board coordinates measured when the resolution arrived.
        */}
      {bsCallTrailMarks.length > 0 ? (
        <div aria-hidden="true" className="bs-call-trail">
          {bsCallTrailMarks.map((mark) => (
            <img
              alt=""
              className="bs-call-trail-mark"
              key={mark.id}
              src={X_ICON_SPRITE}
              style={{
                left: `${mark.left}px`,
                top: `${mark.top}px`,
                animationDelay: `${mark.delayMs}ms`,
              }}
            />
          ))}
        </div>
      ) : null}

      {/*
        * Board level rather than in the hub, so it floats over the felt instead of pushing the
        * trump badge and direction control around.
        */}
      {failMessage ? (
        <div className="board-fail-message" key={failMessage.id} role="alert">
          {failMessage.text}
        </div>
      ) : null}

      {roomError ? (
        <div className="board-error-toast error-banner" role="alert">
          {roomError}
        </div>
      ) : null}

      {!isStaging && frontCardEntrySequence ? (
        <div className="front-card-entry-layer" aria-hidden="true">
          {frontCardEntrySequence.cards.map((card) => (
            <div className="front-card-entry-card active" key={card.id} style={getFrontCardEntryStyle(card)}>
              <img alt="" src={getFrontCardSprite(card.sprite)} />
            </div>
          ))}
        </div>
      ) : null}

      {!isStaging && visibleResetPileCards.length > 0 ? (
        <div className="punishment-move-layer reset-pile-layer" aria-hidden="true">
          {visibleResetPileCards.map((card) => (
            <div
              className={`reset-pile-card${resetPileState?.isFaceDown ? ' face-down' : ''}${resetPileState?.isShuffling ? ' shuffling' : ''}`}
              key={card.id}
              style={getResetPileCardStyle(card)}
            >
              <div className="reset-pile-card-inner">
                <img alt="" className="reset-pile-card-face reset-pile-card-front" src={getFrontCardSprite(card.sprite)} />
                <img alt="" className="reset-pile-card-face reset-pile-card-back" src={getFrontCardSprite(CARD_BACK_FILENAME)} />
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {!isStaging && resetGatherSequence ? (
        <div className="punishment-move-layer" aria-hidden="true">
          {resetGatherSequence.cards.map((card) => (
            <div className="reset-gather-card active" key={card.id} style={getResetGatherStyle(card)}>
              <img alt="" src={getFrontCardSprite(card.sprite)} />
            </div>
          ))}
        </div>
      ) : null}

      {!isStaging && activeMoveSequence ? (
        <div className="punishment-move-layer" aria-hidden="true">
          {activeMoveSequence.cards.map((card) => (
            <div className="punishment-move-card active" key={card.id} style={getPunishmentMoveStyle(card)}>
              <img alt="" src={getFrontCardSprite(card.sprite)} />
            </div>
          ))}
        </div>
      ) : null}

      {!isStaging && resetDealSequence ? (
        <div className="punishment-move-layer" aria-hidden="true">
          {resetDealSequence.cards.map((card) => (
            <div className="reset-deal-card active" key={card.id} style={getResetDealStyle(card)}>
              <img alt="" src={getFrontCardSprite(CARD_BACK_FILENAME)} />
            </div>
          ))}
        </div>
      ) : null}

      <div className="board-hero">
        <div className="board-hero-copy-wrap">
          <div className="header-title-with-info">
            <h2>{isStaging ? 'Room staging' : 'Live match'}</h2>
            <InlineInfoTooltip tooltip={roomCodeTooltip} />
            <button
              aria-label={copyRoomCodeLabel}
              className={`inline-icon-button copy-room-button ${copyRoomCodeStatus}`}
              onClick={handleCopyRoomCode}
              title={copyRoomCodeLabel}
              type="button"
            >
              <span aria-hidden="true" className="copy-icon">
                <span className="copy-icon-sheet copy-icon-sheet-back" />
                <span className="copy-icon-sheet copy-icon-sheet-front" />
              </span>
            </button>
          </div>
        </div>
        <div className="board-hero-actions">
          {!isStaging ? (
            <>
              <button
                aria-expanded={isHistoryOpen}
                aria-haspopup="dialog"
                className={`subtle-button history-toggle ${isHistoryOpen ? 'active' : ''}`}
                onClick={() => {
                  setIsHistoryOpen((previousValue) => !previousValue)
                }}
                type="button"
              >
                History
                <span className="history-count-pill">{historyEvents.length}</span>
              </button>

            </>
          ) : null}

          <span className={`status-pill ${isConnected ? 'online' : 'offline'}`}>
            {isConnected ? 'Socket Connected' : 'Socket Reconnecting'}
          </span>
          <span className={`status-pill ${serverState}`}>{serverStatusLabel}</span>
          <button
            className="secondary-button"
            disabled={isLeaving}
            onClick={onLeaveRoom}
            type="button"
          >
            {isLeaving ? 'Leaving Room...' : 'Leave Room'}
          </button>
        </div>
      </div>

      {isStaging ? (
        <section className="room-staging-shell">
          <div className="room-staging-hero">
            <div>
              <p className="panel-kicker">Room Staging</p>
              <h2>Gather Players Before The Deal</h2>
              <p className="room-note room-staging-copy">
                No cards are dealt until the host starts the game. When the game starts, all players are shuffled into random seats and the first shuffled seat acts first.
              </p>
            </div>
            <div className="room-staging-status-block">
              <span className="room-count">{filledSeatCount}/{ctx.numPlayers} joined</span>
              <span className={`status-pill ${allSeatsFilled ? 'online' : 'checking'}`}>{allSeatsFilled ? 'Room Full' : 'Waiting For Players'}</span>
            </div>
          </div>

          <div className="room-staging-grid">
            <article className="room-staging-panel">
              <div className="room-staging-panel-header">
                <div>
                  <p className="panel-kicker">Roster</p>
                  <h3>Who Is In The Room</h3>
                </div>
                <span className="seat-pill">Host starts the match</span>
              </div>

              <div className="room-staging-seat-list">
                {roomSlots.map((slot) => (
                  <div className={`room-staging-seat ${slot.isFilled ? 'filled' : 'open'}`} key={slot.id}>
                    <div className="room-staging-seat-copy">
                      <strong>{slot.isFilled ? slot.displayName : 'Open seat'}</strong>
                      <span className="room-note">{getStagingSlotLabel(slot.slotIndex)}</span>
                    </div>
                    <div className="room-staging-seat-badges">
                      {slot.isHost ? <span className="seat-tag target">Host</span> : null}
                      <span className={`seat-tag ${slot.isFilled && slot.isConnected ? 'online' : 'offline'}`}>
                        {slot.isFilled ? (slot.isConnected ? 'Connected' : 'Offline') : 'Waiting'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </article>

            <article className="room-staging-panel">
              <div className="room-staging-panel-header">
                <div>
                  <p className="panel-kicker">Match Settings</p>
                  <h3>Ready Check</h3>
                </div>
              </div>

              <div className="room-staging-settings-list">
                <div className="room-staging-setting-row">
                  <span>Speed</span>
                  <strong>{G.speedMultiplier}x</strong>
                </div>
                <div className="room-staging-setting-row">
                  <span>Characters</span>
                  <strong>{stagingCharactersSummary}</strong>
                </div>
                <div className="room-staging-setting-row">
                  <span>Deck</span>
                  <strong>{G.deckConfig.rankSelectionMode === 'manual' ? 'Manual' : 'Default'}</strong>
                </div>
                <p className="room-note room-staging-setting-note">{stagingDeckSummary}</p>
              </div>

              <div className="room-staging-actions">
                <p className="room-note room-staging-status-copy">{stagingStatusText}</p>
                {isHostPlayer ? (
                  <button
                    className="primary-button"
                    disabled={!canStartMatch}
                    onClick={() => {
                      moves.startMatch()
                    }}
                    type="button"
                  >
                    Start Game
                  </button>
                ) : (
                  <span className="panel-badge">Waiting for host</span>
                )}
              </div>
            </article>
          </div>
        </section>
      ) : (
      <>
      <PlayerRing
        anchorSeatID={currentSeatID}
        accusedCheatSeatID={accusedCheatSeatID}
        focusedSeatID={focusedSeatID}
        bsTargetMarkDelayMs={bsTargetMarkDelayMs}
        bsTargetSeatID={bsTargetMarkSeatID}
        bsVerdictIsHonest={bsVerdictIsHonest}
        bsVerdictSeatID={bsVerdictSeatID}
        calloutTextBySeatID={calloutTextBySeatID}
        enteringCardIDSet={enteringFrontCardIDSet}
        pointsFlashDirectionBySeatID={pointsFlashDirectionBySeatID}
        getSeatLabel={getSeatLabel}
        onCatHideCard={handleCatHideCard}
        onOpenCharacterCard={handleOpenCharacterCard}
        onRevealCard={handleRevealCard}
        onSelectSeat={handleSeatSelect}
        punishmentImpactSeatID={punishmentImpactSeatID}
        registerFrontCard={registerFrontCard}
        registerHandCountPill={registerHandCountPill}
        renderRevealActions={renderSeatRevealActions}
        renderTargetActions={renderSeatTargetActions}
        seats={seatRows}
        selectableSeatIDSet={selectableTargetSeatIDSet}
        selectedSeatID={resolvedTargetSeatID}
      >
        <TableCenterHub
          canToggleDirection={canToggleDirection}
          directionArrowOrientation={directionArrowOrientation}
          directionIndicatorLabel={directionIndicatorLabel}
          directionToggleTitle={canToggleDirection
            ? isContrarian
              ? 'Use The Contrarian to flip the turn direction.'
              : "Use The Dreamer to change the direction, on anyone's turn. Accuse can catch it until that turn ends."
            : undefined}
          frontCardsTooltip={frontCardsColumnTooltip}
          maxCardsOnTable={maxCardsOnTable}
          onToggleDirection={handleToggleDirection}
          tableStatus={tableStatusTooltip}
          totalCardsOnTable={totalCardsOnTable}
          trumpLabel={displayedTrumpLabel}
          trumpRank={displayedTrumpRank}
        />
      </PlayerRing>

      <section className="bottom-play-strip">
        <div className={`hand-stage${isInteractiveTurn ? ' active-turn' : ''}${isPunishmentFlashActive ? ' punishment-flash' : ''}`}>
          <div className="hand-play-row">
          <div className="hand-scroll-viewport">
            {removingHandCards.length > 0 ? (
              <div aria-hidden="true" className="hand-scroll-animation-layer">
                {removingHandCards.map((card) => (
                  <div className="hand-motion-card removing" key={card.id} style={getHandMotionCardStyle(card)}>
                    <img alt="" src={getCardSprite(card.sprite)} />
                  </div>
                ))}
              </div>
            ) : null}

            <div className="hand-scroll-row" ref={handScrollRowRef}>
              {handCards.length === 0 && isSpectator ? (
                <p className="room-note">Spectators do not have a hand. Join a seat to make moves.</p>
              ) : null}

              {handCards.map((card) => {
                const isSelected = selectedCardIDs.includes(card.id)
                const enteringIndex = enteringHandCardIndexByID.get(card.id)
                const handCardDelayStyle = enteringIndex === undefined
                  ? undefined
                  : ({ '--hand-change-delay': `${enteringIndex * HAND_CARD_ANIMATION_STAGGER_MS}ms` } as CSSProperties)

                return (
                  <button
                    aria-pressed={isSelected}
                    className={`hand-card-button ${isSelected ? 'selected' : ''}${enteringIndex === undefined ? '' : ' entering'}`}
                    disabled={!isInteractiveTurn && !isSneakWindowOpen}
                    key={card.id}
                    onClick={() => {
                      toggleCardSelection(card.id)
                    }}
                    ref={(element) => {
                      if (element) {
                        handCardButtonRefs.current.set(card.id, element)
                        return
                      }

                      handCardButtonRefs.current.delete(card.id)
                    }}
                    style={handCardDelayStyle}
                    type="button"
                  >
                    <img alt={getCardLabel(card.sprite)} src={getCardSprite(card.sprite)} />
                  </button>
                )
              })}
            </div>
          </div>

          <div className="hand-action-row">
            {/*
              * Sits in the action row itself rather than in a header of its own, filling the space
              * the bottom-aligned buttons leave above them.
              */}
            <p className="hand-action-heading">{handActionHeading}</p>

            {actionButtons.map((action) => (
              <div className={`action-button-item ${action.key === 'select-trump' ? 'trump-action-item' : ''}${action.key === 'play-random' ? ' drunkard-random-item' : ''}${action.key === 'pass' && isForeigner ? ' foreigner-pass-item' : ''}`} key={action.key}>
                {action.key === 'select-trump' ? (
                  <div className="trump-action-combo">
                    <select
                      aria-label="Trump rank"
                      className="trump-select trump-action-select"
                      disabled={!isInteractiveTurn || currentTrump !== null}
                      onChange={(event) => {
                        setSelectedTrumpRank(event.target.value as BlowCowRank)
                      }}
                      value={selectedTrumpRank}
                    >
                      {BLOW_COW_RANKS.map((rank) => (
                        <option key={rank} value={rank}>
                          {rank}
                        </option>
                      ))}
                    </select>
                    <button
                      className={`action-button ${action.disabled ? 'disabled' : ''}`}
                      disabled={action.disabled}
                      onClick={action.onClick}
                      title={action.description}
                      type="button"
                    >
                      <ActionButtonContent icon={action.icon} label={action.label} />
                    </button>
                  </div>
                ) : action.key === 'play-random' && isDrunkard ? (
                  <div className="trump-action-combo drunkard-random-combo">
                    {currentTrump === null ? (
                      <select
                        aria-label="Trump rank"
                        className="trump-select trump-action-select"
                        disabled={!canPlayRandomCards && isResolutionSequenceActive}
                        onChange={(event) => {
                          setSelectedTrumpRank(event.target.value as BlowCowRank)
                        }}
                        value={selectedTrumpRank}
                      >
                        {BLOW_COW_RANKS.map((rank) => (
                          <option key={rank} value={rank}>
                            {rank}
                          </option>
                        ))}
                      </select>
                    ) : null}
                    <select
                      aria-label="Random card count"
                      className="trump-select drunkard-random-select"
                      disabled={maxRandomPlayCardCount === 0 || isResolutionSequenceActive}
                      onChange={(event) => {
                        setSelectedDrunkardRandomPlayCardCount(Number(event.target.value))
                      }}
                      value={selectedDrunkardRandomPlayCardCount}
                    >
                      {drunkardRandomPlayCardCountOptions.map((countOption) => (
                        <option key={countOption} value={countOption}>
                          {countOption} card{countOption === 1 ? '' : 's'}
                        </option>
                      ))}
                    </select>
                    <button
                      className={`action-button ${action.disabled ? 'disabled' : ''}`}
                      disabled={action.disabled}
                      onClick={action.onClick}
                      title={action.description}
                      type="button"
                    >
                      <ActionButtonContent icon={action.icon} label={action.label} />
                    </button>
                  </div>
                ) : action.key === 'pass' && isForeigner ? (
                  <div className="trump-action-combo foreigner-pass-combo">
                    <select
                      aria-label="Foreigner outside card"
                      className="trump-select foreigner-pass-select"
                      disabled={!canPass}
                      onChange={(event) => {
                        setSelectedForeignerCardCode(event.target.value)
                      }}
                      value={selectedForeignerCardCode}
                    >
                      {FOREIGNER_CARD_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <button
                      className={`action-button ${action.disabled ? 'disabled' : ''}`}
                      disabled={action.disabled}
                      onClick={action.onClick}
                      title={action.description}
                      type="button"
                    >
                      <ActionButtonContent icon={action.icon} label={action.label} />
                    </button>
                  </div>
                ) : (
                  <button
                    className={`action-button ${action.disabled ? 'disabled' : ''}`}
                    disabled={action.disabled}
                    onClick={action.onClick}
                    title={action.description}
                    type="button"
                  >
                    <ActionButtonContent icon={action.icon} label={action.label} />
                  </button>
                )}
                <div className="action-button-tooltip" role="tooltip">
                  {action.description}
                </div>
              </div>
            ))}
          </div>
          </div>
        </div>
      </section>

      </>
      )}

    </section>
  )
}
