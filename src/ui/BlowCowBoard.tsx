import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import type { BoardProps } from 'boardgame.io/react'
import {
  BLOW_COW_RANKS,
  getActivePlayerIDs,
  getTableCardCount,
  sortCards,
  type BlowCowBSResolution,
  type BlowCowCallBSArgs,
  type BlowCowCatHideCardArgs,
  type BlowCowCard,
  type BlowCowFinalizeBSResolutionArgs,
  type BlowCowFinalizeResetResolutionArgs,
  type BlowCowPassArgs,
  type BlowCowPlayArgs,
  type BlowCowPlayRandomArgs,
  type BlowCowRank,
  type BlowCowResetResolution,
  type BlowCowSelectTrumpAndPlayArgs,
  type BlowCowState,
} from '../game/blowCowGame.ts'
import { getCharacterCardSprite } from './characterCardSprites.ts'
import { CARD_BACK_FILENAME, getCardLabel, getCardSprite, getFrontCardSprite } from './cardSprites.ts'
import { getAvatarSprite } from './avatarSprites.ts'
import { InlineInfoTooltip } from './InlineInfoTooltip.tsx'
import { PlayerRing } from './PlayerRing.tsx'
import { SeatBlock } from './SeatBlock.tsx'
import { PASS_ICON_SPRITE, PLAY_ICON_SPRITE, RESET_ICON_SPRITE } from './iconSprites.ts'
import { TableCenterHub } from './TableCenterHub.tsx'
import { CharacterStripOverlay, HistoryOverlay } from './BoardOverlays.tsx'
import { useTransientMessage } from './useTransientMessage.ts'
import {
  getCatHiddenCardIDSet,
  getCatHiddenOverlayCardIDs,
  getDisplayedPlayCardCount,
  getExplicitlyRevealedCardIDSet,
  getHiddenOverlayCardIDs,
  getLatestHiddenPlay,
  getRevealedOverlayCardIDs,
} from './tablePlays.ts'
import {
  canUseClientGrandmasterBSOverride,
  getClientDefaultBSTargetSeatID,
  getClientPendingPlay,
  getDreamerCheatForPlay,
  getDreamerCheatLabel,
  resolveClientBSTargetSelection,
} from './bsTargeting.ts'
import type {
  CharacterCardOverlay,
  HistoryEvent,
  MatchAnnouncement,
  MatchPlayer,
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
}

type EndGameChartPoint = {
  id: string
  title: string
  turnNumber: number
  handCountsByPlayer: Record<string, number>
}

type BSSequenceStage = 'called' | 'targetReveal' | 'tableReveal' | 'verdict'

type BSSequenceProgress = {
  resolutionID: string
  stage: BSSequenceStage
  revealedAdditionalPlayCount: number
  animatedPlayID: string | null
}

type ResetSequenceStage = 'called' | 'tableReveal' | 'gathering' | 'shuffling' | 'dealing' | 'returning'

type ResetSequenceProgress = {
  resolutionID: string
  stage: ResetSequenceStage
  revealedHiddenCardCount: number
  animatedCardID: string | null
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

const BS_TARGET_REVEAL_AT_MS = 2000
const BS_TABLE_REVEAL_START_AT_MS = 5000
const BS_ADDITIONAL_REVEAL_INTERVAL_MS = 600
const BS_VERDICT_BASE_AT_MS = 8000
const BS_PUNISHMENT_MOVE_DURATION_MS = 420
const BS_PUNISHMENT_MOVE_STAGGER_MS = 110
const RESET_REVEAL_START_AT_MS = 2000
const RESET_REVEAL_INTERVAL_MS = 600
const RESET_RETURN_BASE_AT_MS = 3000
const RESET_MOVE_DURATION_MS = 2000
const RESET_PILE_REVEAL_INTERVAL_MS = 280
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
const PLAYER_POINTS_FLASH_DURATION_MS = 1600
const PLAYER_PLAY_CALLOUT_DURATION_MS = 2400
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
    catHideCard: (args: BlowCowCatHideCardArgs) => void
    callBS: (args?: BlowCowCallBSArgs) => void
    callReset: () => void
    finalizeBSResolution: (args: BlowCowFinalizeBSResolutionArgs) => void
    finalizeResetResolution: (args: BlowCowFinalizeResetResolutionArgs) => void
    pass: (args?: BlowCowPassArgs) => void
    play: (args: BlowCowPlayArgs) => void
    playRandom: (args: BlowCowPlayRandomArgs) => void
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

function formatCardList(cards: BlowCowCard[]) {
  return cards.map((card) => getCardLabel(card.sprite)).join(', ')
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

function pickRandomCalloutText(options: readonly string[]) {
  return options[Math.floor(Math.random() * options.length)] ?? ''
}

function getBSSequenceRevealedPlayIDs(
  bsResolution: BlowCowBSResolution | null,
  bsSequenceProgress: BSSequenceProgress | null,
) {
  if (!bsResolution) {
    return new Set<string>()
  }

  const revealedPlayIDs = new Set<string>()
  const stage = bsSequenceProgress?.resolutionID === bsResolution.id ? bsSequenceProgress.stage : 'called'
  const revealedAdditionalPlayCount = bsSequenceProgress?.resolutionID === bsResolution.id
    ? bsSequenceProgress.revealedAdditionalPlayCount
    : 0

  if (stage !== 'called') {
    revealedPlayIDs.add(bsResolution.targetPlayID)
  }

  for (const revealPlay of bsResolution.additionalRevealPlays.slice(0, revealedAdditionalPlayCount)) {
    revealedPlayIDs.add(revealPlay.playID)
  }

  return revealedPlayIDs
}

function buildBSAnnouncement(
  bsResolution: BlowCowBSResolution,
  bsSequenceProgress: BSSequenceProgress | null,
  currentSeatID: string | null,
  currentPlayerName: string,
  roomPlayers: MatchPlayer[],
) {
  const callerLabel = getSeatDisplayName(bsResolution.callerPlayerID, currentSeatID, currentPlayerName, roomPlayers)
  const targetLabel = getSeatDisplayName(bsResolution.targetPlayerID, currentSeatID, currentPlayerName, roomPlayers)
  const punishedLabel = getSeatDisplayName(bsResolution.punishedPlayerID, currentSeatID, currentPlayerName, roomPlayers)
  const stage = bsSequenceProgress?.resolutionID === bsResolution.id ? bsSequenceProgress.stage : 'called'

  if (stage === 'called') {
    return {
      tone: 'warning',
      title: `${callerLabel} called BS`,
      detail: `Checking ${targetLabel}'s last play of ${bsResolution.targetPlayCards.length} card(s).`,
    } satisfies MatchAnnouncement
  }

  if (stage === 'targetReveal') {
    return {
      tone: 'info',
      title: `Revealing ${targetLabel}'s last play`,
      detail: formatCardList(bsResolution.targetPlayCards),
    } satisfies MatchAnnouncement
  }

  if (stage === 'tableReveal') {
    return {
      tone: 'info',
      title: 'Revealing the rest of the table',
      detail: bsResolution.additionalRevealPlays.length > 0
        ? 'Flipping each remaining hidden play face up in order.'
        : 'No other hidden plays remain on the table.',
    } satisfies MatchAnnouncement
  }

  return {
    tone: 'verdict',
    title: `${targetLabel} was ${bsResolution.targetWasHonest ? 'honest' : 'dishonest'}`,
    detail: `${targetLabel} revealed ${formatCardList(bsResolution.targetPlayCards)}. ${bsResolution.reverseRuleTriggered
      ? `Four or more ${bsResolution.trumpRank}s are on the table, so ${punishedLabel} gets punished.`
      : `${punishedLabel} gets punished.`}`,
  } satisfies MatchAnnouncement
}

function buildResetAnnouncement(
  resetResolution: BlowCowResetResolution,
  resetSequenceProgress: ResetSequenceProgress | null,
  currentSeatID: string | null,
  currentPlayerName: string,
  roomPlayers: MatchPlayer[],
  tableCardCount: number,
) {
  const callerLabel = getSeatDisplayName(resetResolution.callerPlayerID, currentSeatID, currentPlayerName, roomPlayers)
  const stage = resetSequenceProgress?.resolutionID === resetResolution.id ? resetSequenceProgress.stage : 'called'
  const isRoundReturn = resetResolution.kind === 'roundReturn'

  if (stage === 'called') {
    return {
      tone: 'warning',
      title: isRoundReturn ? 'Everyone passed' : `${callerLabel} called Reset`,
      detail: isRoundReturn
        ? `${callerLabel} passed last. Preparing to reveal and return ${tableCardCount} card(s) before the next round begins.`
        : `The table is full. Preparing to reveal ${tableCardCount} card(s), gather them into a pile, shuffle them, and deal them back out.`,
    } satisfies MatchAnnouncement
  }

  if (stage === 'tableReveal') {
    return {
      tone: 'info',
      title: 'Revealing the table',
      detail: isRoundReturn
        ? 'Flipping the hidden table cards face up one by one before each card returns to the player who put it down.'
        : 'Flipping the hidden table cards face up one by one before the cards return to their owners.',
    } satisfies MatchAnnouncement
  }

  if (isRoundReturn) {
    return {
      tone: 'info',
      title: 'Returning table cards',
      detail: 'Each table card is moving back to the player who played it before the next round begins.',
    } satisfies MatchAnnouncement
  }

  if (stage === 'gathering') {
    return {
      tone: 'info',
      title: 'Gathering the table into one pile',
      detail: 'Every revealed table card is sliding into the middle before Reset shuffles the pile.',
    } satisfies MatchAnnouncement
  }

  if (stage === 'shuffling') {
    return {
      tone: 'info',
      title: 'Shuffling the pile',
      detail: 'The gathered pile flips face down and shuffles itself before the redeal.',
    } satisfies MatchAnnouncement
  }

  return {
    tone: 'info',
    title: 'Dealing the shuffled pile',
    detail: 'The face-down pile is dealing back out across the active seats before the next round begins.',
  } satisfies MatchAnnouncement
}

function getResetSequenceRevealedCardIDs(
  tablePlays: BlowCowState['table']['plays'],
  resetResolution: BlowCowResetResolution | null,
  resetSequenceProgress: ResetSequenceProgress | null,
) {
  if (!resetResolution) {
    return new Set<string>()
  }

  const hiddenOverlayCardIDs = tablePlays.flatMap((play) => getHiddenOverlayCardIDs(play))
  const revealedCardIDs = new Set<string>()
  const stage = resetSequenceProgress?.resolutionID === resetResolution.id ? resetSequenceProgress.stage : 'called'
  const revealedHiddenCardCount = resetSequenceProgress?.resolutionID === resetResolution.id
    ? resetSequenceProgress.revealedHiddenCardCount
    : 0
  const revealCount = stage === 'called'
    ? 0
    : stage === 'tableReveal'
    ? revealedHiddenCardCount
    : hiddenOverlayCardIDs.length

  for (const overlayCardID of hiddenOverlayCardIDs.slice(0, revealCount)) {
    revealedCardIDs.add(overlayCardID)
  }

  return revealedCardIDs
}

function scaleSequenceDelay(delayMs: number, speedMultiplier: number) {
  return Math.max(0, Math.round(delayMs / speedMultiplier))
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
  const playCalloutTimeoutIDRef = useRef<number | null>(null)
  const playersFromRoom = roomPlayers.length > 0
    ? roomPlayers
    : ((matchData as MatchPlayer[] | undefined) ?? [])
  const [selectedCardIDs, setSelectedCardIDs] = useState<string[]>([])
  const [enteringHandCardIDs, setEnteringHandCardIDs] = useState<string[]>([])
  const [removingHandCards, setRemovingHandCards] = useState<HandMotionCard[]>([])
  const [enteringFrontCardIDs, setEnteringFrontCardIDs] = useState<string[]>([])
  const [frontCardEntrySequence, setFrontCardEntrySequence] = useState<FrontCardEntrySequence | null>(null)
  const [revealFlippingCardIDs, setRevealFlippingCardIDs] = useState<string[]>([])
  const [flashingPointSeatIDs, setFlashingPointSeatIDs] = useState<string[]>([])
  const [activePlayerCallout, setActivePlayerCallout] = useState<{
    seatID: string
    calloutID: string
    text: string
  } | null>(null)
  const [selectedTrumpRank, setSelectedTrumpRank] = useState<BlowCowRank>('Q')
  const [selectedDrunkardRandomPlayCardCount, setSelectedDrunkardRandomPlayCardCount] = useState(1)
  const [selectedTargetSeatID, setSelectedTargetSeatID] = useState<string | null>(null)
  const [selectedForeignerCardCode, setSelectedForeignerCardCode] = useState<string>('none')
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const [bsSequenceProgress, setBSSequenceProgress] = useState<BSSequenceProgress | null>(null)
  const [resetSequenceProgress, setResetSequenceProgress] = useState<ResetSequenceProgress | null>(null)
  const [isPunishmentFlashActive, setIsPunishmentFlashActive] = useState(false)
  const [punishmentMoveSequence, setPunishmentMoveSequence] = useState<PunishmentMoveSequence | null>(null)
  const [departedPunishmentCardIDs, setDepartedPunishmentCardIDs] = useState<string[]>([])
  const [resetMoveSequence, setResetMoveSequence] = useState<PunishmentMoveSequence | null>(null)
  const [resetGatherSequence, setResetGatherSequence] = useState<PunishmentMoveSequence | null>(null)
  const [resetPileState, setResetPileState] = useState<ResetPileState | null>(null)
  const [resetDealSequence, setResetDealSequence] = useState<PunishmentMoveSequence | null>(null)
  const [departedResetCardIDs, setDepartedResetCardIDs] = useState<string[]>([])
  const [selectedCharacterCard, setSelectedCharacterCard] = useState<CharacterCardOverlay | null>(null)
  const [isCharacterStripOpen, setIsCharacterStripOpen] = useState(false)
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
  const latestBSResolutionRef = useRef<BlowCowBSResolution | null>(G.bsResolution)
  const latestTablePlaysRef = useRef(G.table.plays)

  useEffect(() => {
    finalizeBSResolutionRef.current = moves.finalizeBSResolution
  }, [moves.finalizeBSResolution])

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

      if (playCalloutTimeoutIDRef.current !== null) {
        window.clearTimeout(playCalloutTimeoutIDRef.current)
        playCalloutTimeoutIDRef.current = null
      }
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

  const hasEscapableLayer = Boolean(
    selectedCharacterCard || isHistoryOpen || isCharacterStripOpen || selectedTargetSeatID,
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

      if (isCharacterStripOpen) {
        setIsCharacterStripOpen(false)
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
  }, [hasEscapableLayer, selectedCharacterCard, isCharacterStripOpen, isHistoryOpen, clearFailMessage])

  useEffect(() => {
    if (G.gameStatus === 'staging' || !G.useCharacters || G.gameStatus === 'finished') {
      setSelectedCharacterCard(null)
    }
  }, [G.gameStatus, G.useCharacters])

  useEffect(() => {
    if (G.gameStatus !== 'active' || !G.useCharacters) {
      setIsCharacterStripOpen(false)
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
    if (G.bsResolution || G.resetResolution) {
      setSelectedCardIDs([])
    }
  }, [G.bsResolution?.id, G.resetResolution?.id])

  useEffect(() => {
    if (!G.bsResolution) {
      setBSSequenceProgress(null)
      setPunishmentMoveSequence(null)
      setDepartedPunishmentCardIDs([])
      return
    }

    const { id, punishmentCardCount, targetPlayID, additionalRevealPlays } = G.bsResolution
    const timeoutIDs: number[] = []
    const animationFrameIDs: number[] = []
    const shouldAutoFinalize = Boolean(currentSeatID && ctx.currentPlayer === currentSeatID && isActive)
    const targetRevealAt = scaleSequenceDelay(BS_TARGET_REVEAL_AT_MS, G.speedMultiplier)
    const tableRevealStartAt = scaleSequenceDelay(BS_TABLE_REVEAL_START_AT_MS, G.speedMultiplier)
    const additionalRevealInterval = scaleSequenceDelay(BS_ADDITIONAL_REVEAL_INTERVAL_MS, G.speedMultiplier)
    const verdictAt = scaleSequenceDelay(
      BS_VERDICT_BASE_AT_MS + additionalRevealPlays.length * BS_ADDITIONAL_REVEAL_INTERVAL_MS,
      G.speedMultiplier,
    )
    const punishmentMoveDuration = scaleSequenceDelay(BS_PUNISHMENT_MOVE_DURATION_MS, G.speedMultiplier)
    const punishmentMoveStagger = scaleSequenceDelay(BS_PUNISHMENT_MOVE_STAGGER_MS, G.speedMultiplier)
    const punishmentMoveTotalDuration = punishmentCardCount > 0
      ? punishmentMoveDuration + Math.max(0, punishmentCardCount - 1) * punishmentMoveStagger
      : 0

    const startPunishmentMoveSequence = () => {
      const boardElement = tableBoardRef.current
      const currentBSResolution = latestBSResolutionRef.current
      const punishedPlayerID = currentBSResolution?.punishedPlayerID ?? null
      const destinationElement = punishedPlayerID
        ? boardElement?.querySelector<HTMLElement>(`[data-punishment-target-name="${punishedPlayerID}"]`) ?? null
        : null

      if (!boardElement || !destinationElement || !currentBSResolution || currentBSResolution.id !== id) {
        setPunishmentMoveSequence(null)
        setDepartedPunishmentCardIDs([])
        return
      }

      const boardRect = boardElement.getBoundingClientRect()
      const destinationRect = destinationElement.getBoundingClientRect()
      const cards = latestTablePlaysRef.current.flatMap((play) => {
        const displayCards = currentBSResolution.additionalRevealPlays.find((revealPlay) => revealPlay.playID === play.id)?.cards
          ?? (play.id === currentBSResolution.targetPlayID ? currentBSResolution.targetPlayCards : undefined)
          ?? play.cards

        return displayCards.flatMap((card) => {
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

      cards.forEach((card) => {
        timeoutIDs.push(window.setTimeout(() => {
          setDepartedPunishmentCardIDs((previousIDs) => previousIDs.includes(card.id)
            ? previousIDs
            : [...previousIDs, card.id])
        }, card.delayMs))
      })
    }

    setBSSequenceProgress({
      resolutionID: id,
      stage: 'called',
      revealedAdditionalPlayCount: 0,
      animatedPlayID: null,
    })
    setPunishmentMoveSequence(null)
    setDepartedPunishmentCardIDs([])

    timeoutIDs.push(window.setTimeout(() => {
      setBSSequenceProgress((previousProgress) => previousProgress?.resolutionID === id
        ? {
            ...previousProgress,
            stage: 'targetReveal',
            animatedPlayID: targetPlayID,
          }
        : previousProgress)
    }, targetRevealAt))

    if (additionalRevealPlays.length === 0) {
      timeoutIDs.push(window.setTimeout(() => {
        setBSSequenceProgress((previousProgress) => previousProgress?.resolutionID === id
          ? {
              ...previousProgress,
              stage: 'tableReveal',
              animatedPlayID: null,
            }
          : previousProgress)
      }, tableRevealStartAt))
    }

    additionalRevealPlays.forEach((revealPlay, revealIndex) => {
      timeoutIDs.push(window.setTimeout(() => {
        setBSSequenceProgress((previousProgress) => previousProgress?.resolutionID === id
          ? {
              ...previousProgress,
              stage: 'tableReveal',
              revealedAdditionalPlayCount: revealIndex + 1,
              animatedPlayID: revealPlay.playID,
            }
          : previousProgress)
      }, tableRevealStartAt + revealIndex * additionalRevealInterval))
    })

    timeoutIDs.push(window.setTimeout(() => {
      setBSSequenceProgress((previousProgress) => previousProgress?.resolutionID === id
        ? {
            ...previousProgress,
            stage: 'verdict',
            animatedPlayID: null,
          }
        : previousProgress)

      animationFrameIDs.push(window.requestAnimationFrame(() => {
        startPunishmentMoveSequence()
      }))
    }, verdictAt))

    if (shouldAutoFinalize) {
      timeoutIDs.push(window.setTimeout(() => {
        finalizeBSResolutionRef.current({ resolutionID: id })
      }, verdictAt + punishmentMoveTotalDuration))
    }

    return () => {
      animationFrameIDs.forEach((animationFrameID) => {
        window.cancelAnimationFrame(animationFrameID)
      })
      timeoutIDs.forEach((timeoutID) => {
        window.clearTimeout(timeoutID)
      })
    }
  }, [G.bsResolution?.id, G.speedMultiplier, ctx.currentPlayer, isActive])

  useEffect(() => {
    if (!G.resetResolution) {
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
    const shouldAutoFinalize = Boolean(currentSeatID && ctx.currentPlayer === currentSeatID && isActive)
    const hiddenOverlayCardIDs = G.table.plays.flatMap((play) => getHiddenOverlayCardIDs(play))
    if (kind === 'roundReturn') {
      const revealStartAt = scaleSequenceDelay(RESET_REVEAL_START_AT_MS, G.speedMultiplier)
      const revealInterval = scaleSequenceDelay(RESET_REVEAL_INTERVAL_MS, G.speedMultiplier)
      const returnStartAt = scaleSequenceDelay(
        RESET_RETURN_BASE_AT_MS + RESET_REVEAL_INTERVAL_MS * hiddenOverlayCardIDs.length,
        G.speedMultiplier,
      )
      const returnMoveDuration = scaleSequenceDelay(RESET_MOVE_DURATION_MS, G.speedMultiplier)
      const resolveAt = scaleSequenceDelay(
        RESET_RETURN_BASE_AT_MS + RESET_REVEAL_INTERVAL_MS * hiddenOverlayCardIDs.length + RESET_MOVE_DURATION_MS,
        G.speedMultiplier,
      )

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
        stage: 'called',
        revealedHiddenCardCount: 0,
        animatedCardID: null,
        dealtCardCount: 0,
      })
      setResetMoveSequence(null)
      setResetGatherSequence(null)
      setResetPileState(null)
      setResetDealSequence(null)
      setDepartedResetCardIDs([])

      hiddenOverlayCardIDs.forEach((overlayCardID, revealIndex) => {
        timeoutIDs.push(window.setTimeout(() => {
          setResetSequenceProgress((previousProgress) => previousProgress?.resolutionID === id
            ? {
                ...previousProgress,
                stage: 'tableReveal',
                revealedHiddenCardCount: revealIndex + 1,
                animatedCardID: overlayCardID,
              }
            : previousProgress)
        }, revealStartAt + revealIndex * revealInterval))
      })

      timeoutIDs.push(window.setTimeout(() => {
        setResetSequenceProgress((previousProgress) => previousProgress?.resolutionID === id
          ? {
              ...previousProgress,
              stage: 'returning',
              revealedHiddenCardCount: hiddenOverlayCardIDs.length,
              animatedCardID: null,
            }
          : previousProgress)

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

    const revealStartAt = scaleSequenceDelay(RESET_REVEAL_START_AT_MS, G.speedMultiplier)
    const revealInterval = scaleSequenceDelay(RESET_PILE_REVEAL_INTERVAL_MS, G.speedMultiplier)
    const revealPhaseDuration = hiddenOverlayCardIDs.length > 0
      ? (hiddenOverlayCardIDs.length - 1) * revealInterval
      : 0
    const postRevealPause = scaleSequenceDelay(RESET_POST_REVEAL_PAUSE_MS, G.speedMultiplier)
    const gatherDuration = scaleSequenceDelay(RESET_GATHER_DURATION_MS, G.speedMultiplier)
    const postGatherPause = scaleSequenceDelay(RESET_POST_GATHER_PAUSE_MS, G.speedMultiplier)
    const shuffleDuration = scaleSequenceDelay(RESET_PILE_SHUFFLE_DURATION_MS, G.speedMultiplier)
    const dealInterval = scaleSequenceDelay(RESET_DEAL_INTERVAL_MS, G.speedMultiplier)
    const dealDuration = scaleSequenceDelay(RESET_DEAL_DURATION_MS, G.speedMultiplier)
    const postDealPause = scaleSequenceDelay(RESET_POST_DEAL_PAUSE_MS, G.speedMultiplier)
    const gatherStartAt = revealStartAt + revealPhaseDuration + postRevealPause
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
      stage: 'called',
      revealedHiddenCardCount: 0,
      animatedCardID: null,
      dealtCardCount: 0,
    })
    setResetMoveSequence(null)
    setResetGatherSequence(null)
    setResetPileState(null)
    setResetDealSequence(null)
    setDepartedResetCardIDs([])

    hiddenOverlayCardIDs.forEach((overlayCardID, revealIndex) => {
      timeoutIDs.push(window.setTimeout(() => {
        setResetSequenceProgress((previousProgress) => previousProgress?.resolutionID === id
          ? {
              ...previousProgress,
              stage: 'tableReveal',
              revealedHiddenCardCount: revealIndex + 1,
              animatedCardID: overlayCardID,
            }
          : previousProgress)
      }, revealStartAt + revealIndex * revealInterval))
    })

    timeoutIDs.push(window.setTimeout(() => {
      setResetSequenceProgress((previousProgress) => previousProgress?.resolutionID === id
        ? {
            ...previousProgress,
            stage: 'gathering',
            revealedHiddenCardCount: hiddenOverlayCardIDs.length,
            animatedCardID: null,
          }
        : previousProgress)

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
            revealedHiddenCardCount: hiddenOverlayCardIDs.length,
            animatedCardID: null,
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
            revealedHiddenCardCount: hiddenOverlayCardIDs.length,
            animatedCardID: null,
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
  const isBSSequenceActive = bsResolution !== null
  const isResetSequenceActive = resetResolution !== null
  const isResolutionSequenceActive = isBSSequenceActive || isResetSequenceActive
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
  // Any other seat can be clicked. Whether the challenge is legal is decided on the attempt,
  // so a wrong pick explains itself instead of leaving a dead button.
  // Any live opponent can be clicked at any time, on or off your turn. The Call BS and Accuse
  // buttons explain why an attempt is illegal rather than the block refusing to be selected.
  const selectableTargetSeatIDSet = new Set(
    G.seatOrder.filter((seatID) => seatID !== currentSeatID && !G.players[seatID].hasLeft),
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
  const canToggleDirection = isInteractiveTurn && (isContrarian || isDreamer)
  const canPass = isInteractiveTurn && !isFinalTwoResolutionTurn
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
      : `Turn direction is ${directionArrowOrientation}. Click to use The Dreamer and change the direction. BS can catch it if the direction stays changed by the end of your turn.`
    : `Turn direction is ${directionArrowOrientation}.`
  const latestTablePlay = G.table.plays[G.table.plays.length - 1] ?? null
  const tableRevealKey = G.table.plays.map((play) => `${play.id}:${play.revealedAtTurn ?? 'hidden'}:${(play.revealedCardIDs ?? []).join(',')}`).join('|')
  const catHiddenKey = G.table.plays.map((play) => `${play.id}:${(play.rehiddenCardIDs ?? []).join(',')}`).join('|')
  const bsSequenceRevealedPlayIDs = getBSSequenceRevealedPlayIDs(bsResolution, bsSequenceProgress)
  const bsSequenceAnimatedPlayID = bsSequenceProgress?.resolutionID === bsResolution?.id
    ? (bsSequenceProgress?.animatedPlayID ?? null)
    : null
  const resetSequenceRevealedCardIDs = getResetSequenceRevealedCardIDs(G.table.plays, resetResolution, resetSequenceProgress)
  const resetSequenceAnimatedCardID = resetSequenceProgress?.resolutionID === resetResolution?.id
    ? (resetSequenceProgress?.animatedCardID ?? null)
    : null
  const revealFlippingCardIDSet = new Set(revealFlippingCardIDs)
  const bsResolutionPlayCardsByID = new Map<string, BlowCowCard[]>()

  if (bsResolution) {
    bsResolutionPlayCardsByID.set(bsResolution.targetPlayID, bsResolution.targetPlayCards)
    for (const revealPlay of bsResolution.additionalRevealPlays) {
      bsResolutionPlayCardsByID.set(revealPlay.playID, revealPlay.cards)
    }
  }

  const activeAnnouncement = bsResolution
    ? buildBSAnnouncement(bsResolution, bsSequenceProgress, currentSeatID, playerName, playersFromRoom)
    : resetResolution
    ? buildResetAnnouncement(resetResolution, resetSequenceProgress, currentSeatID, playerName, playersFromRoom, totalCardsOnTable)
    : null
  const activeMoveSequence = punishmentMoveSequence ?? resetMoveSequence
  const resetPileShuffleDurationMs = scaleSequenceDelay(RESET_PILE_SHUFFLE_DURATION_MS, G.speedMultiplier)
  const enteringHandCardIndexByID = new Map(enteringHandCardIDs.map((cardID, index) => [cardID, index]))
  const flashingPointSeatIDSet = new Set(flashingPointSeatIDs)
  const reversedHistory = [...G.history].reverse()
  const latestPassEvent = reversedHistory.find((event) => event.kind === 'action' && event.playerID !== null && event.title.endsWith(' passed')) ?? null

  useEffect(() => {
    const nextRevealedOverlayCardIDSet = new Set(
      G.table.plays.flatMap((play) => getRevealedOverlayCardIDs(play)),
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
  }, [G.table.plays, tableRevealKey])

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

    const awardedPointSeatIDs = G.seatOrder.filter((seatID) => {
      const previousPoints = previousPointsBySeat.get(seatID) ?? 0
      const nextPoints = nextPointsBySeat.get(seatID) ?? 0
      return nextPoints > previousPoints
    })

    if (awardedPointSeatIDs.length === 0) {
      return
    }

    setFlashingPointSeatIDs((previousSeatIDs) => [...new Set([...previousSeatIDs, ...awardedPointSeatIDs])])

    for (const seatID of awardedPointSeatIDs) {
      const existingTimeoutID = pointFlashTimeoutIDsRef.current.get(seatID)
      if (existingTimeoutID !== undefined) {
        window.clearTimeout(existingTimeoutID)
      }

      pointFlashTimeoutIDsRef.current.set(seatID, window.setTimeout(() => {
        setFlashingPointSeatIDs((previousSeatIDs) => previousSeatIDs.filter((previousSeatID) => previousSeatID !== seatID))
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

    if (playCalloutTimeoutIDRef.current !== null) {
      window.clearTimeout(playCalloutTimeoutIDRef.current)
    }

    setActivePlayerCallout({
      seatID: latestTablePlay.playerID,
      calloutID: latestPlayID,
      text: buildPlayCalloutText(latestTablePlay.claimedRank, getDisplayedPlayCardCount(latestTablePlay)),
    })

    playCalloutTimeoutIDRef.current = window.setTimeout(() => {
      setActivePlayerCallout((previousCallout) => previousCallout?.calloutID === latestPlayID ? null : previousCallout)
      playCalloutTimeoutIDRef.current = null
    }, PLAYER_PLAY_CALLOUT_DURATION_MS)
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

    if (playCalloutTimeoutIDRef.current !== null) {
      window.clearTimeout(playCalloutTimeoutIDRef.current)
    }

    setActivePlayerCallout({
      seatID: bsResolution.callerPlayerID,
      calloutID: latestBSResolutionID,
      text: pickRandomCalloutText(BS_PLAYER_CALLOUT_OPTIONS),
    })

    playCalloutTimeoutIDRef.current = window.setTimeout(() => {
      setActivePlayerCallout((previousCallout) => previousCallout?.calloutID === latestBSResolutionID ? null : previousCallout)
      playCalloutTimeoutIDRef.current = null
    }, PLAYER_PLAY_CALLOUT_DURATION_MS)
  }, [bsResolution?.id])

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

    if (playCalloutTimeoutIDRef.current !== null) {
      window.clearTimeout(playCalloutTimeoutIDRef.current)
    }

    setActivePlayerCallout({
      seatID: resetResolution.callerPlayerID,
      calloutID: latestResetResolutionID,
      text: resetResolution.kind === 'roundReturn' ? 'All passed' : 'Reset!',
    })

    playCalloutTimeoutIDRef.current = window.setTimeout(() => {
      setActivePlayerCallout((previousCallout) => previousCallout?.calloutID === latestResetResolutionID ? null : previousCallout)
      playCalloutTimeoutIDRef.current = null
    }, PLAYER_PLAY_CALLOUT_DURATION_MS)
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

    if (playCalloutTimeoutIDRef.current !== null) {
      window.clearTimeout(playCalloutTimeoutIDRef.current)
    }

    setActivePlayerCallout({
      seatID: latestPassEvent.playerID,
      calloutID: latestPassEventID,
      text: pickRandomCalloutText(PASS_PLAYER_CALLOUT_OPTIONS),
    })

    playCalloutTimeoutIDRef.current = window.setTimeout(() => {
      setActivePlayerCallout((previousCallout) => previousCallout?.calloutID === latestPassEventID ? null : previousCallout)
      playCalloutTimeoutIDRef.current = null
    }, PLAYER_PLAY_CALLOUT_DURATION_MS)
  }, [latestPassEvent?.id])

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
        const revealedBySequence = bsSequenceRevealedPlayIDs.has(play.id)
        const displayCards = revealedBySequence
          ? (bsResolutionPlayCardsByID.get(play.id) ?? play.cards)
          : play.cards
        const revealedCardIDSet = getExplicitlyRevealedCardIDSet(play)
        const catHiddenCardIDSet = getCatHiddenCardIDSet(play)

        return displayCards.map((card) => {
          const overlayCardID = `${play.id}-${card.id}`
          const faceDown = !revealedBySequence && (
            (!isResetSequenceActive && catHiddenCardIDSet.has(card.id))
            || (
              play.revealedAtTurn === null
              && !resetSequenceRevealedCardIDs.has(overlayCardID)
              && !revealedCardIDSet.has(card.id)
            )
          )

          return {
            id: overlayCardID,
            cardID: card.id,
            sprite: card.sprite,
            faceDown,
            isDeparted: departedPunishmentCardIDSet.has(overlayCardID) || departedResetCardIDSet.has(overlayCardID),
            isFlipping: revealFlippingCardIDSet.has(overlayCardID)
              || bsSequenceAnimatedPlayID === play.id
              || resetSequenceAnimatedCardID === overlayCardID,
            isTargeted: !isResetSequenceActive && play.id === targetPlayID,
            isCatActionable: canUseCat && !faceDown,
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
      name: getSeatDisplayName(seatID, currentSeatID, playerName, playersFromRoom),
      pointRanks: player.scoredSets.map((scoredSet) => scoredSet.rank),
      points: player.points,
    }
  })

  // The viewing player's block sits in the hand row rather than on the ring, which frees the
  // ring's bottom arc and keeps the whole board shorter. Spectators have no block to dock.
  const dockedSeatRow = seatRows.find((seat) => seat.id === currentSeatID) ?? null

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
    if (!isInteractiveTurn) {
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

  /** Accuse is the same move, so it inherits every Call BS precondition plus a real cheat. */
  const getAccuseFailure = (seatID: string) => {
    const callBSFailure = getCallBSFailure(seatID)
    if (callBSFailure) {
      return callBSFailure
    }

    const targetSelection = resolveClientBSTargetSelection(G, currentSeatID, seatID)
    if (getDreamerCheatForPlay(G, targetSelection?.targetPlay ?? null)) {
      return null
    }

    const seatName = getSeatDisplayName(seatID, currentSeatID, playerName, playersFromRoom)
    return `Nothing to accuse. ${seatName} did not break a Dreamer rule on that play.`
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

    moves.callBS({ targetPlayerID: seatID })
    setSelectedTargetSeatID(null)
    setSelectedCardIDs([])
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
    })
  }

  const renderSeatTargetActions = (seat: SeatRow) => {
    const targetSelection = resolveClientBSTargetSelection(G, currentSeatID, seat.id)
    const dreamerCheat = getDreamerCheatForPlay(G, targetSelection?.targetPlay ?? null)
    const callBSFailure = getCallBSFailure(seat.id)

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
          title={dreamerCheat
            ? `Accuse ${seat.name}: as The Dreamer they ${getDreamerCheatLabel(dreamerCheat)}.`
            : `Accuse ${seat.name} of cheating as The Dreamer.`}
          type="button"
        >
          Accuse
        </button>
      </div>
    )
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
      ? `Wait for the ${isBSSequenceActive ? 'BS' : 'Reset'} resolution sequence to finish.`
      : currentTrump === null
      ? isRepeatingPreviousTrump && isDreamer
        ? `Use The Dreamer to pick ${selectedTrumpRank} again. The Dreamer may also send more than 2 cards or overfill the table, and BS can catch any of those cheats before the opening play is revealed.`
        : isRepeatingPreviousTrump
        ? `${selectedTrumpRank} was the previous round trump and cannot be selected again.`
        : isDreamer
        ? `Choose ${selectedTrumpRank} as trump. The Dreamer may also send more than 2 selected cards and can even overfill the table, but BS can catch the illegal count.`
        : `Choose ${selectedTrumpRank} as trump and play up to 2 selected cards.`
      : `Trump is already ${currentTrump}. Use Play to make the claim.`,
    disabled: !canSelectTrumpAndPlay,
    icon: PLAY_ICON_SPRITE,
    key: 'select-trump',
    label: 'Select Trump + Play',
    onClick: () => {
      sendSelectionToTable(selectedTrumpRank)
    },
  }

  const playAction = {
    description: isResolutionSequenceActive
      ? `Wait for the ${isBSSequenceActive ? 'BS' : 'Reset'} resolution sequence to finish.`
      : currentTrump
      ? isDreamer
        ? `Play the selected cards and claim they are ${currentTrump}. The Dreamer may send more than 2 cards or overfill the table, but BS can catch the illegal count.`
        : `Play the selected cards and claim they are ${currentTrump}.`
      : 'Pick a trump rank first.',
    disabled: !canPlayCards,
    icon: PLAY_ICON_SPRITE,
    key: 'play',
    label: 'Play',
    onClick: () => {
      sendSelectionToTable(null)
    },
  }

  const playRandomAction = {
    description: isResolutionSequenceActive
      ? `Wait for the ${isBSSequenceActive ? 'BS' : 'Reset'} resolution sequence to finish.`
      : currentTrump === null
      ? isRepeatingPreviousTrump
        ? `${selectedTrumpRank} was the previous round trump and cannot be selected again. Play Random still has to choose a new trump first.`
        : `Use The Drunkard to randomly select ${selectedDrunkardRandomPlayCardCount} card(s) from your hand, choose ${selectedTrumpRank} as trump, and place them face down. If you only ever use Play Random before leaving, you lose 3 points.`
      : maxRandomPlayCardCount === 0
      ? 'Need cards in hand and room on the table to use Play Random.'
      : `Use The Drunkard to randomly select ${selectedDrunkardRandomPlayCardCount} card(s) from your hand and claim they are ${currentTrump}. If you only ever use Play Random before leaving, you lose 3 points.`,
    disabled: !canPlayRandomCards,
    icon: PLAY_ICON_SPRITE,
    key: 'play-random',
    label: 'Play Random',
    onClick: handlePlayRandom,
  }

  // Call BS and Accuse are not here: they live on the player blocks, because both need a
  // clicked target. See `renderSeatTargetActions`.
  const actionButtons = [
    currentTrump === null ? selectTrumpAction : playAction,
    ...(isDrunkard ? [playRandomAction] : []),
    {
      description: isResolutionSequenceActive
        ? `Wait for the ${isBSSequenceActive ? 'BS' : 'Reset'} resolution sequence to finish.`
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
        ? `Wait for the ${isBSSequenceActive ? 'BS' : 'Reset'} resolution sequence to finish.`
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
      {G.gameStatus === 'finished' && winnerID ? (
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
                          <strong>{row.name}</strong>
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

      {!isStaging && isHistoryOpen ? (
        <HistoryOverlay
          historyEvents={historyEvents}
          onClose={() => {
            setIsHistoryOpen(false)
          }}
        />
      ) : null}

      {!isStaging && isCharacterStripOpen && G.useCharacters ? (
        <CharacterStripOverlay
          getSeatLabel={getSeatLabel}
          onClose={() => {
            setIsCharacterStripOpen(false)
          }}
          onOpenCharacterCard={handleOpenCharacterCard}
          seats={seatRows}
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
        * Board level rather than inside the hub, so appearing and clearing never reflows the
        * trump badge or the direction control underneath it.
        */}
      {activeAnnouncement ? (
        <div
          aria-live="polite"
          className={`match-announcement board-announcement ${activeAnnouncement.tone}`}
          role="status"
        >
          <strong>{activeAnnouncement.title}</strong>
          <span>{activeAnnouncement.detail}</span>
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

              {G.useCharacters ? (
                <button
                  aria-expanded={isCharacterStripOpen}
                  aria-haspopup="dialog"
                  className={`subtle-button character-strip-toggle ${isCharacterStripOpen ? 'active' : ''}`}
                  onClick={() => {
                    setIsCharacterStripOpen((previousValue) => !previousValue)
                  }}
                  type="button"
                >
                  Characters
                </button>
              ) : null}
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
        calloutSeatID={activePlayerCallout?.seatID ?? null}
        calloutText={activePlayerCallout?.text ?? ''}
        dockedSeatID={dockedSeatRow?.id ?? null}
        enteringCardIDSet={enteringFrontCardIDSet}
        flashingPointSeatIDSet={flashingPointSeatIDSet}
        getSeatLabel={getSeatLabel}
        onCatHideCard={handleCatHideCard}
        onOpenCharacterCard={handleOpenCharacterCard}
        onSelectSeat={handleSeatSelect}
        registerFrontCard={registerFrontCard}
        registerHandCountPill={registerHandCountPill}
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
              : 'Use The Dreamer to change the direction. BS can catch this if the direction stays changed.'
            : undefined}
          failMessage={failMessage}
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
                    disabled={!isInteractiveTurn}
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

          {dockedSeatRow ? (
            <SeatBlock
              calloutText={activePlayerCallout?.seatID === dockedSeatRow.id ? activePlayerCallout.text : null}
              enteringCardIDSet={enteringFrontCardIDSet}
              isDocked
              isPointsFlashing={flashingPointSeatIDSet.has(dockedSeatRow.id)}
              isSelectable={false}
              isSelected={false}
              onCatHideCard={handleCatHideCard}
              onOpenCharacterCard={handleOpenCharacterCard}
              onSelect={handleSeatSelect}
              registerFrontCard={registerFrontCard}
              registerHandCountPill={registerHandCountPill}
              seat={dockedSeatRow}
              seatLabel={getSeatLabel(dockedSeatRow.seatIndex)}
            />
          ) : null}

          <div className="hand-action-row">
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
