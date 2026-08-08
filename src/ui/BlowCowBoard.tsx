import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { BoardProps } from 'boardgame.io/react'
import {
  BLOW_COW_DIRECTIONS,
  BLOW_COW_RANKS,
  canBreakRule,
  canConspire,
  canManipulate,
  canMimic,
  canUseDefy,
  countsTowardReverseRule,
  formatLeaveEffectLabel,
  getActivePlayerIDs,
  getBreakableRuleIDs,
  getConspiracyTargetPlayerIDs,
  getManipulableTrumpRanks,
  getManipulationTargetPlayerIDs,
  getMimicryTargetPlayerID,
  getSeekerCharacterChoices,
  getPlayerStatuses,
  getTableCardCount,
  hasStatus,
  isDefyDestroyableCard,
  isRuleRemoved,
  isTrumpCardInMatch,
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
  type BlowCowBeginResetPunishmentArgs,
  type BlowCowFinalizeResetResolutionArgs,
  type BlowCowPassArgs,
  type BlowCowPlayArgs,
  type BlowCowPlayRandomArgs,
  type BlowCowSneakPlayArgs,
  type BlowCowRank,
  type BlowCowResetResolution,
  type BlowCowBreakRuleArgs,
  type BlowCowConspireArgs,
  type BlowCowDefyArgs,
  type BlowCowEmoteArgs,
  type BlowCowDirection,
  type BlowCowManipulateArgs,
  type BlowCowSeekCharacterArgs,
  type BlowCowSelectTrumpAndPlayArgs,
  type BlowCowState,
} from '../game/blowCowGame.ts'
import type { BlowCowRuleID } from '../game/blowCowRules.ts'
import { getStatusDefinition, type BlowCowStatusID } from '../game/blowCowStatuses.ts'
import type { BlowCowImplementedCharacterName } from '../game/blowCowCharacters.ts'
import { getStatusSprite } from './statusSprites.ts'
import { getCharacterCardSprite, getCharacterCardSpriteFrames } from './characterCardSprites.ts'
import {
  CARD_BACK_FILENAME,
  UNKNOWN_CARD_FILENAME,
  getCardLabel,
  getCardSprite,
  getFrontCardSprite,
} from './cardSprites.ts'
import { getAvatarSprite } from './avatarSprites.ts'
import { EMOTE_SPRITES, getEmoteSprite } from './emoteSprites.ts'
import { CharacterCardSpriteImage } from './CharacterCardSpriteImage.tsx'
import { InlineInfoTooltip } from './InlineInfoTooltip.tsx'
import { PlayerRing } from './PlayerRing.tsx'
import {
  CONSPIRE_ICON_SPRITE,
  DEFY_ICON_SPRITE,
  HISTORY_ICON_SPRITE,
  LEAVE_ROOM_ICON_SPRITE,
  MANIPULATE_ICON_SPRITE,
  MIMIC_ICON_SPRITE,
  PASS_ICON_SPRITE,
  PLAY_ICON_SPRITE,
  PLAY_RANDOM_ICON_SPRITE,
  RESET_ICON_SPRITE,
  RULES_ICON_SPRITE,
  SNEAK_PLAY_ICON_SPRITE,
  X_ICON_SPRITE,
} from './iconSprites.ts'
import { TableCenterHub } from './TableCenterHub.tsx'
import { BreakRuleOverlay, HistoryOverlay, RulesOverlay } from './BoardOverlays.tsx'
import { useTransientMessage } from './useTransientMessage.ts'
import {
  getDisplayedFrontCards,
  getDisplayedPlayCardCount,
  getFaceDownOverlayCardIDs,
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
  SeatStatus,
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

/**
 * Statuses as `G` stores them, turned into what a seat block draws. The copy comes from the status
 * definitions rather than from `G`, so the wording is written down once and the wire carries an id
 * and a counter and nothing else.
 */
function toSeatStatuses(statuses: readonly { id: BlowCowStatusID; turnsRemaining: number }[]): SeatStatus[] {
  return statuses.map((status) => {
    const definition = getStatusDefinition(status.id)

    return {
      id: status.id,
      title: definition.title,
      description: definition.description,
      sprite: getStatusSprite(status.id),
      turnsRemaining: status.turnsRemaining,
    }
  })
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

type ActiveEmote = {
  id: string
  playerID: string
  sprite: string
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
/** Must match the `seat-direction-flip-nudge` animation duration in App.css. */
const DIRECTION_FLIP_TELL_DURATION_MS = 460
/*
 * How long a player who has just palmed a card off the table is kept off their own action buttons.
 * The point of the pause is that the gap in their pile has to sit there long enough for somebody to
 * notice it: without one, the same hand could take a card back and end the turn on top of it, closing
 * the accusation window in the same breath as opening it.
 *
 * Client-side by construction rather than by omission. A deadline the server could enforce would have
 * to be a wall clock stored in `G`, and a wall clock in `G` is not replayable — it would break the
 * archive replays and the check harness both. Every honest client runs this identically, and the one
 * thing a doctored client could buy itself by skipping it is two seconds of a cheat nobody can prove.
 */
const TAKE_BACK_ACTION_LOCK_MS = 2000
/*
 * Only its owner ever reads this, on the buttons the lock is holding down. It says what happened
 * without saying the word cheat, because the same player may be looking at a shared screen and the
 * gap in their own pile is meant to be the only thing that gives them away.
 */
const TAKE_BACK_LOCK_DESCRIPTION = 'You just took a card back. Your hands are off the table for a moment.'
/**
 * Comfortably past the `seat-emote-travel` animation in App.css and the stagger a batch of emotes is
 * dealt out under, so this only ever fires for an emote whose `onAnimationEnd` never came.
 */
const EMOTE_EXPIRY_MS = 5000
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
const TABLE_BOARD_PALETTES = [
  {
    top: 'rgb(22 74 67)',
    middle: 'rgb(11 42 39)',
    bottom: 'rgb(4 20 19)',
  },
  {
    top: 'rgb(57 66 80)',
    middle: 'rgb(31 39 51)',
    bottom: 'rgb(12 17 24)',
  },
  {
    top: 'rgb(76 58 22)',
    middle: 'rgb(42 29 10)',
    bottom: 'rgb(20 13 5)',
  },
  {
    top: 'rgb(31 48 79)',
    middle: 'rgb(16 27 50)',
    bottom: 'rgb(7 13 29)',
  },
] as const
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
    beginResetPunishment: (args: BlowCowBeginResetPunishmentArgs) => void
    pass: (args?: BlowCowPassArgs) => void
    play: (args: BlowCowPlayArgs) => void
    playRandom: (args: BlowCowPlayRandomArgs) => void
    seekCharacter: (args: BlowCowSeekCharacterArgs) => void
    breakRule: (args: BlowCowBreakRuleArgs) => void
    defy: (args: BlowCowDefyArgs) => void
    emote: (args: BlowCowEmoteArgs) => void
    conspire: (args: BlowCowConspireArgs) => void
    manipulate: (args: BlowCowManipulateArgs) => void
    mimic: () => void
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

/** A repeatable palette shuffle keeps every client on the same round colour without game-state noise. */
function getTableBoardPalette(matchID: string, roundNumber: number) {
  const hashPaletteIndex = (paletteIndex: number) => {
    let hash = 2166136261
    const seed = `${matchID}:${paletteIndex}`

    for (let index = 0; index < seed.length; index += 1) {
      hash = Math.imul(hash ^ seed.charCodeAt(index), 16777619)
    }

    return hash >>> 0
  }
  const paletteOrder = TABLE_BOARD_PALETTES.map((_, paletteIndex) => paletteIndex)
    .sort((leftIndex, rightIndex) => hashPaletteIndex(leftIndex) - hashPaletteIndex(rightIndex) || leftIndex - rightIndex)
  const cycleIndex = Math.max(0, roundNumber - 1) % paletteOrder.length

  return TABLE_BOARD_PALETTES[paletteOrder[cycleIndex]]
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
  /*
   * The conspiracy this viewer owes a play on, or null. Only ever non-null on The Mastermind's own
   * client while they are on the clock, and it is the one thing that lets the hand strip show cards
   * that are not the viewer's: the server has already unmasked that one hand for this seat alone.
   * Read this early — the hand effects below key off the seat the strip is currently showing.
   */
  const openConspiracy = currentSeatID && G.conspiracy?.playerID === currentSeatID ? G.conspiracy : null
  /** The Clown has already played this turn and still holds it. Everything but a second play is open. */
  const openEncore = currentSeatID && G.encore?.playerID === currentSeatID ? G.encore : null
  const handSourceSeatID = openConspiracy?.targetPlayerID ?? currentSeatID
  const tableBoardRef = useRef<HTMLElement | null>(null)
  const frontCardRefs = useRef(new Map<string, HTMLDivElement>())
  const handCountPillRefs = useRef(new Map<string, HTMLSpanElement>())
  const handScrollRowRef = useRef<HTMLDivElement | null>(null)
  /** The enlarged character card, written to directly on every pointer move. */
  const characterCardRef = useRef<HTMLDivElement | null>(null)
  const handCardButtonRefs = useRef(new Map<string, HTMLButtonElement>())
  const handCardMetricsRef = useRef(new Map<string, HandCardMetric>())
  const previousHandCardsRef = useRef<HandCard[]>([])
  const previousFrontCardIDsBySeatRef = useRef(new Map<string, string[]>())
  const previousScoredSetIDsRef = useRef(new Set<string>())
  /** What each drawn front card looked like last render, so a flip can be told from an arrival. */
  const previousDisplayedFaceDownRef = useRef(new Map<string, boolean>())
  /**
   * The seat whose hand the strip was showing last frame. Normally the viewer's own, but a
   * conspiracy points it at somebody else, and that swap has to read as a seat change rather than as
   * every card being dealt and discarded at once.
   */
  const previousHandSourceSeatIDRef = useRef<string | null>(handSourceSeatID)
  const lastFrontCardIDsKeyRef = useRef('')
  /** The disguise the front-card watcher last drew, so it can tell a swapped pile from a dealt one. */
  const lastWornMimicryKeyRef = useRef('')
  const handAnimationTimeoutIDsRef = useRef<number[]>([])
  const frontCardEntryTimeoutIDsRef = useRef<number[]>([])
  const revealFlipTimeoutIDsRef = useRef<number[]>([])
  const previousPointsBySeatRef = useRef<Map<string, number> | null>(null)
  const pointFlashTimeoutIDsRef = useRef(new Map<string, number>())
  const hasMountedPlayWatcherRef = useRef(false)
  const hasMountedFrontCardWatcherRef = useRef(false)
  const hasMountedRevealWatcherRef = useRef(false)
  const lastSeenPlayIDRef = useRef<string | null>(null)
  const hasMountedBSCalloutWatcherRef = useRef(false)
  const lastSeenBSResolutionIDRef = useRef<string | null>(null)
  const hasMountedResetCalloutWatcherRef = useRef(false)
  const lastSeenResetResolutionIDRef = useRef<string | null>(null)
  const hasMountedPassCalloutWatcherRef = useRef(false)
  const lastSeenPassEventIDRef = useRef<string | null>(null)
  const hasMountedEmoteWatcherRef = useRef(false)
  const seenEmoteIDsRef = useRef(new Set<string>())
  const emoteExpiryTimeoutIDsRef = useRef(new Set<number>())
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
  /*
   * The Mime's disguise, seen from outside it. Never worn on The Mime's own client — they know what
   * they did, and the block they have to read is their real one. Everything it copies is public
   * state, so putting it on reaches past nothing this client had not already been sent.
   */
  const wornMimicry = G.mimicry && G.mimicry.playerID !== currentSeatID ? G.mimicry : null
  const wornMimicryKey = wornMimicry
    ? `${wornMimicry.playerID}:${wornMimicry.sourcePlayerID}:${wornMimicry.turnNumber}`
    : ''
  /** The disguise whose borrowed callout has already been seeded, so it is seeded exactly once. */
  const lastSeededMimicryKeyRef = useRef('')
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
  /**
   * The two halves of a Manipulate that are not a player. Its third — who the round is handed to —
   * is the block that gets clicked, so it needs no state. Both are null-or-defaulted rather than
   * corrected by an effect: each is resolved against the live options below, so a rank that becomes
   * forbidden simply falls back instead of arming the button with something the server will refuse.
   */
  const [selectedManipulateRank, setSelectedManipulateRank] = useState<BlowCowRank | null>(null)
  const [selectedManipulateDirection, setSelectedManipulateDirection] = useState<BlowCowDirection | null>(null)
  const [selectedTargetSeatID, setSelectedTargetSeatID] = useState<string | null>(null)
  const [selectedForeignerCardCode, setSelectedForeignerCardCode] = useState<string>('none')
  const [isEmotePickerOpen, setIsEmotePickerOpen] = useState(false)
  const [activeEmotes, setActiveEmotes] = useState<ActiveEmote[]>([])
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  // Kept mutually exclusive with the history overlay so the two panels never stack on the board.
  const [isRulesOpen, setIsRulesOpen] = useState(false)
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
  const [isResetPunishPromptReady, setIsResetPunishPromptReady] = useState(false)
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
  /** The seat currently playing the direction-flip nudge, or null when nobody is. */
  const [directionFlipTellSeatID, setDirectionFlipTellSeatID] = useState<string | null>(null)
  /** Set for `TAKE_BACK_ACTION_LOCK_MS` after this client palms a card back on its own turn. */
  const [isTakeBackLocked, setIsTakeBackLocked] = useState(false)
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
  /**
   * The Broken's picker, on the same terms as The Seeker's. Breaking a rule leaves `character`
   * alone, so what closes this for good is `brokenRemovedRuleID` landing on the seat rather than the
   * character badge changing.
   */
  const [hasDismissedBreakRulePicker, setHasDismissedBreakRulePicker] = useState(false)
  const [copyRoomCodeStatus, setCopyRoomCodeStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const {
    message: failMessage,
    showMessage: showFailMessage,
    clearMessage: clearFailMessage,
  } = useTransientMessage(BOARD_FAIL_MESSAGE_DURATION_MS)
  const hasMountedPunishmentWatcherRef = useRef(false)
  const lastSeenPunishmentEventIDRef = useRef<string | null>(null)
  const hasMountedDirectionFlipWatcherRef = useRef(false)
  const lastSeenDirectionFlipIDRef = useRef<string | null>(null)
  const hasMountedTakeBackLockWatcherRef = useRef(false)
  const lastSeenTakeBackTamperIDRef = useRef<string | null>(null)
  const finalizeBSResolutionRef = useRef(moves.finalizeBSResolution)
  const finalizeResetResolutionRef = useRef(moves.finalizeResetResolution)
  const finalizeAccusationRef = useRef(moves.finalizeAccusation)
  const latestBSResolutionRef = useRef<BlowCowBSResolution | null>(G.bsResolution)
  const latestAccusationRef = useRef<BlowCowAccusation | null>(G.accusation)
  const latestResetResolutionRef = useRef<BlowCowResetResolution | null>(G.resetResolution)
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
    /*
     * A Gambler showdown ends the same way a lost BS call does — one seat takes the whole table — so
     * it reuses this travel rather than the gather-shuffle-deal chain, which is the animation for the
     * redistribution the showdown replaces. The cards are all face up by now, so they fly face up.
     */
    : G.resetResolution?.showdown?.isPunishing && G.resetResolution.showdown.punishedPlayerID
    ? {
        id: G.resetResolution.id,
        kind: 'resetShowdown' as const,
        punishedSeatID: G.resetResolution.showdown.punishedPlayerID,
        cardCount: G.resetResolution.showdown.punishmentCardCount,
        driverSeatID: G.resetResolution.callerPlayerID,
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
    latestResetResolutionRef.current = G.resetResolution
  }, [G.resetResolution])

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
  // Same shape as The Seeker above, and up here for the same reason.
  const isBroken = Boolean(
    currentSeatID
      && G.gameStatus === 'active'
      && canBreakRule(G, currentSeatID)
      && !G.players[currentSeatID].hasLeft,
  )
  const isBreakRulePickerOpen = isBroken && !hasDismissedBreakRulePicker

  const hasEscapableLayer = Boolean(
    selectedCharacterCard
      || isSeekerPickerOpen
      || isBreakRulePickerOpen
    || isEmotePickerOpen
      || isHistoryOpen
      || isRulesOpen
      || selectedTargetSeatID,
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

      if (isBreakRulePickerOpen) {
        setHasDismissedBreakRulePicker(true)
        return
      }

      if (isEmotePickerOpen) {
        setIsEmotePickerOpen(false)
        return
      }

      if (isHistoryOpen) {
        setIsHistoryOpen(false)
        return
      }

      if (isRulesOpen) {
        setIsRulesOpen(false)
        return
      }

      setSelectedTargetSeatID(null)
      clearFailMessage()
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [
    hasEscapableLayer,
    selectedCharacterCard,
    isSeekerPickerOpen,
    isBreakRulePickerOpen,
    isEmotePickerOpen,
    isHistoryOpen,
    isRulesOpen,
    clearFailMessage,
  ])

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

  // Keyed on the hand the strip is showing, not on the viewer's own: opening a conspiracy swaps the
  // strip to somebody else's cards, and a selection made against the old hand has to go with it.
  useEffect(() => {
    if (!handSourceSeatID) {
      setSelectedCardIDs([])
      return
    }

    const availableCardIDs = new Set(G.players[handSourceSeatID]?.hand.map((card) => card.id) ?? [])
    setSelectedCardIDs((previousIDs) => {
      const nextIDs = previousIDs.filter((cardID) => availableCardIDs.has(cardID))
      return nextIDs.length === previousIDs.length ? previousIDs : nextIDs
    })
  }, [G.players, handSourceSeatID])

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
   * The same beat before a Gambler showdown's Punish buttons appear. Separate state from the BS one
   * rather than shared, because the two procedures are mutually exclusive but their gates are not:
   * this one waits on the standings arriving, which is a different unmasking.
   *
   * Read out as booleans first so the effect depends on primitives. `showdown` is a fresh object on
   * every sync, so depending on it directly would restart the timer each time the server spoke and
   * the prompt would never arrive.
   */
  const hasResetShowdown = Boolean(G.resetResolution?.showdown)
  const isResetShowdownPunishing = Boolean(G.resetResolution?.showdown?.isPunishing)
  useEffect(() => {
    if (!hasResetShowdown || !isResetRevealComplete || isResetShowdownPunishing) {
      setIsResetPunishPromptReady(false)
      return
    }

    const timeoutID = window.setTimeout(() => {
      setIsResetPunishPromptReady(true)
    }, scaleSequenceDelay(BS_PUNISH_PROMPT_DELAY_MS, G.speedMultiplier))

    return () => {
      window.clearTimeout(timeoutID)
    }
  }, [G.resetResolution?.id, hasResetShowdown, isResetRevealComplete, isResetShowdownPunishing, G.speedMultiplier])

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
      const liveProcedure = kind === 'bs'
        ? latestBSResolutionRef.current
        : kind === 'accusation'
        ? latestAccusationRef.current
        : latestResetResolutionRef.current
      const punishedPlayerID = liveProcedure?.id !== id
        ? null
        : kind === 'bs'
        ? latestBSResolutionRef.current?.punishment?.punishedPlayerID ?? null
        : kind === 'accusation'
        ? latestAccusationRef.current?.punishedPlayerID ?? null
        : latestResetResolutionRef.current?.showdown?.punishedPlayerID ?? null
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

        if (kind === 'resetShowdown') {
          finalizeResetResolutionRef.current({ resolutionID: id })
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
    /*
     * A Gambler showdown bails out here and never enters this chain. The gather, shuffle and deal are
     * the animation for a redistribution that is not going to happen; the table instead waits for the
     * caller to press Punish, and from there the BS punishment travel above takes over.
     */
    if (!G.resetResolution || !isResetRevealComplete || G.resetResolution.showdown) {
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
  const tableBoardPalette = getTableBoardPalette(matchID, G.round.roundNumber)
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
  const handSourcePlayerState = handSourceSeatID ? (G.players[handSourceSeatID] ?? null) : null
  const handCards = handSourcePlayerState ? sortCards(handSourcePlayerState.hand).map(toHandCard) : []
  const handCardIDsKey = handCards.map((card) => card.id).join('|')
  const scoredSetIDsKey = currentPlayerState?.scoredSets.map((scoredSet) => scoredSet.id).join('|') ?? ''
  const seatPointsKey = G.seatOrder.map((seatID) => `${seatID}:${G.players[seatID].points}`).join('|')
  const selectedCards = handCards.filter((card) => selectedCardIDs.includes(card.id))
  const isSpectator = currentSeatID === null
  const canEmote = Boolean(
    currentSeatID
      && G.gameStatus === 'active'
      && !currentPlayerState?.hasLeft,
  )
  const isCurrentPlayersTurn = Boolean(
    currentSeatID
      && ctx.currentPlayer === currentSeatID
      && isActive
      && G.gameStatus === 'active',
  )
  const isInteractiveTurn = isCurrentPlayersTurn && !isResolutionSequenceActive
  const isGrandmaster = currentPlayerState?.character === 'The Grandmaster'
  const isCat = currentPlayerState?.character === 'The Cat'
  const isContrarian = currentPlayerState?.character === 'The Contrarian'
  // The Contrarian never presses anything, so the Call BS tooltip is the one place the ability is
  // worth naming: the call is where the reversal is decided. It stacks with the Reverse Rule instead
  // of overriding it, which the wording leaves to the verdict line rather than spelling out here.
  const contrarianCallBSDetail = isContrarian
    ? ' As The Contrarian, the opposite player is punished.'
    : ''
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
  /*
   * The viewer's own statuses, mirroring the server guards so a button greys with a reason instead of
   * being pressed into an `INVALID_MOVE`. The server is still the authority for every one of them.
   */
  const viewerStatusIDs = new Set<BlowCowStatusID>(
    currentSeatID ? getPlayerStatuses(G, currentSeatID).map((status) => status.id) : [],
  )
  const isTilted = viewerStatusIDs.has('tilted')
  const isWorried = viewerStatusIDs.has('worried')
  const isMad = viewerStatusIDs.has('mad')
  const isNervous = viewerStatusIDs.has('nervous')
  const isBrokenStatus = viewerStatusIDs.has('broken')
  const isDreamer = currentPlayerState?.character === 'The Dreamer'
  /*
   * Mirrors the server's `canCheat`. With the No Cheating Rule gone the licence stops belonging to a
   * character at all, so every gate below reads this and every label that would have said "The
   * Dreamer" says "Cheat" instead — there is no character to credit any more.
   */
  const isCheatingUniversal = isRuleRemoved(G, 'noCheating')
  const canCheat = isDreamer || isCheatingUniversal
  /** What the action labels call the licence: a character while it is one, a plain verb once it is not. */
  const cheatVerbPrefix = isCheatingUniversal ? 'Cheat and' : 'Use The Dreamer to'
  const isDrunkard = currentPlayerState?.character === 'The Drunkard'
  const isForeigner = currentPlayerState?.character === 'The Foreigner'
  const seekerCharacterChoices = isSeeker && currentSeatID ? getSeekerCharacterChoices(G, currentSeatID) : []
  const canSeekCharacter = isSeeker && !isResolutionSequenceActive && seekerCharacterChoices.length > 0
  // Every rule still standing that defines a removed variant. The Broken picks one of these and The
  // Prototype destroys a random one, so both read the same list.
  const destroyableRuleIDs = getBreakableRuleIDs(G)
  const breakableRuleIDs = isBroken ? destroyableRuleIDs : []
  const canBreakAnyRule = isBroken && !isResolutionSequenceActive && breakableRuleIDs.length > 0
  const isPrototype = currentPlayerState?.character === 'The Prototype'
  const hasUsedDefyThisRound = Boolean(currentPlayerState?.hasUsedDefyThisRound)
  const isMastermind = currentPlayerState?.character === 'The Mastermind'
  const hasUsedConspireThisRound = Boolean(currentPlayerState?.hasUsedConspireThisRound)
  // Whose block will accept a Conspire. A seat that empties its hand or leaves simply drops out of
  // the list, which is the whole of the check: the target is whichever block was clicked.
  const conspiracyTargetSeatIDs = isMastermind && currentSeatID
    ? getConspiracyTargetPlayerIDs(G, currentSeatID)
    : []
  // Only the once-a-round guard and the surviving rule pool; the card to destroy is checked below,
  // so the tooltip can tell the two refusals apart.
  const hasDefyAvailable = Boolean(isPrototype && currentSeatID && canUseDefy(G, currentSeatID))
  // Read off the player's own hand rather than the hand strip, which a conspiracy can point
  // elsewhere. Defy burns a heart, so the suit decides which cards the button will accept.
  const defyableCardIDSet = new Set(
    isPrototype && currentPlayerState
      ? currentPlayerState.hand.filter(isDefyDestroyableCard).map((card) => card.id)
      : [],
  )
  const isSelectedCardDefyable = selectedCards.length === 1
    && defyableCardIDSet.has(selectedCards[0].id)
  const canDefy = isInteractiveTurn && hasDefyAvailable && isSelectedCardDefyable
  /*
   * Mirrors of the server's rule checks. The server is still the authority — these only decide
   * whether a button is offered and what its tooltip says.
   */
  const isInvisibleHand = currentPlayerState?.character === 'The Invisible Hand'
  const manipulationTargetSeatIDs = isInvisibleHand && currentSeatID
    ? getManipulationTargetPlayerIDs(G, currentSeatID)
    : []
  const manipulableTrumpRanks = getManipulableTrumpRanks(G)
  const resolvedManipulateRank = selectedManipulateRank && manipulableTrumpRanks.includes(selectedManipulateRank)
    ? selectedManipulateRank
    : (manipulableTrumpRanks[0] ?? null)
  // Defaults to flipping, which is what a round change would have done on its own. Choosing the
  // direction it already has is a legal and often deliberate use of the ability, not a no-op.
  const resolvedManipulateDirection = selectedManipulateDirection
    ?? (G.round.direction === 'clockwise' ? 'counterclockwise' : 'clockwise')
  const canManipulateNow = isInteractiveTurn && Boolean(currentSeatID && canManipulate(G, currentSeatID))
  const isMime = currentPlayerState?.character === 'The Mime'
  const hasUsedMimicThisRound = Boolean(currentPlayerState?.hasUsedMimicThisRound)
  // Mimic names its own target, so unlike Conspire and Manipulate it stays in the action row. The
  // seat is only read here to name it in the tooltip.
  const mimicrySourceSeatID = isMime && currentSeatID ? getMimicryTargetPlayerID(G, currentSeatID) : null
  const canMimicNow = isInteractiveTurn
    && !isFinalTwoResolutionTurn
    && Boolean(currentSeatID && canMimic(G, currentSeatID))
  /** This seat owes the table a play because The Invisible Hand opened the round for them. */
  const isForcedToPlay = Boolean(currentSeatID && G.round.forcedPlayPlayerID === currentSeatID)
  const isTableLimitRemoved = isRuleRemoved(G, 'maxCardsOnTable')
  const isPassRemoved = isRuleRemoved(G, 'pass')
  const hasTableRoomForSelection = isTableLimitRemoved
    || totalCardsOnTable + selectedCards.length <= maxCardsOnTable
  const isRepeatingPreviousTrump = !isRuleRemoved(G, 'rankChange')
    && selectedTrumpRank === G.round.previousTrumpRank
  const canRepeatPreviousTrump = canCheat && isRepeatingPreviousTrump
  /*
   * The Mad and Nervous mirror. It judges the selection by its cards alone, where the server also
   * folds in the cheat modifiers, so a cheat that turns a truthful-looking play into a lie is caught
   * server-side rather than here. That is the safe direction to be wrong in: a play this lets through
   * is refused, never a play this refuses that would have been legal.
   */
  const claimedRankForSelection = currentTrump ?? selectedTrumpRank
  // Off the raw hand rather than the hand strip, which carries sprites only. The character is the
  // mover's even under a conspiracy, exactly as it is on the server.
  const selectedHandCards = handSourcePlayerState?.hand.filter((card) => selectedCardIDs.includes(card.id)) ?? []
  const isSelectionTruthful = selectedHandCards.length > 0
    && selectedHandCards.every((card) => isTrumpCardInMatch(G, card, claimedRankForSelection, currentPlayerState?.character))
  // Broken chooses the card itself, so nothing the player selected is being judged.
  const violatesTruthStatus = !isBrokenStatus
    && ((isMad && isSelectionTruthful) || (isNervous && !isSelectionTruthful))
  // Broken keeps the button, because it still sends a play — just not the selected one. Every other
  // gate below is about the selection, so Broken skips them too.
  const canSelectTrumpAndPlay = isInteractiveTurn
    && !isFinalTwoResolutionTurn
    && !isWorried
    && currentTrump === null
    && (!isRepeatingPreviousTrump || canRepeatPreviousTrump)
    && (isBrokenStatus
      ? handCards.length > 0
      : selectedCards.length > 0
        && !violatesTruthStatus
        && (canCheat || selectedCards.length <= 2)
        && (canCheat || hasTableRoomForSelection))
  // `openEncore` gates the two play buttons and nothing else in the row: an encore takes away the
  // play it followed, not the turn. Select Trump needs no gate — any play that earns an encore has
  // already left the round with a trump rank.
  const canPlayCards = isInteractiveTurn
    && !isFinalTwoResolutionTurn
    && !isWorried
    && !openEncore
    && currentTrump !== null
    && (isBrokenStatus
      ? handCards.length > 0 && (isTableLimitRemoved || totalCardsOnTable < maxCardsOnTable)
      : selectedCards.length > 0
        && !violatesTruthStatus
        && (canCheat || selectedCards.length <= 2)
        && (canCheat || hasTableRoomForSelection))
  const maxRandomPlayCardCount = Math.min(
    2,
    handCards.length,
    isTableLimitRemoved ? 2 : Math.max(0, maxCardsOnTable - totalCardsOnTable),
  )
  const drunkardRandomPlayCardCountOptions = Array.from(
    { length: maxRandomPlayCardCount },
    (_, optionIndex) => optionIndex + 1,
  )
  const canPlayRandomCards = isInteractiveTurn
    && isDrunkard
    && !isFinalTwoResolutionTurn
    && !isWorried
    && !openEncore
    && maxRandomPlayCardCount > 0
    && (currentTrump !== null || !isRepeatingPreviousTrump)
  // The Cat is bound to their own turn. A cheat is not: reaching into someone else's turn is
  // the whole of it, and the only thing that can undo it is an accusation before that turn ends.
  const canToggleDirection = G.gameStatus === 'active'
    && isActive
    && !isResolutionSequenceActive
    && !currentPlayerState?.hasLeft
    && (canCheat || (isCat && isCurrentPlayersTurn))
  // Mirrors the server's one-per-turn guard. Any play of yours stamped with the live turn number
  // while somebody else is on the clock can only be one you sneaked, so this needs no extra state.
  const hasSneakedThisTurn = Boolean(currentSeatID) && G.table.plays.some(
    (play) => play.playerID === currentSeatID && play.playedAtTurn === ctx.turn,
  )
  // No trump-rank condition: a sneaked card claims nothing of its own, so it can be slipped in
  // before the round has a rank and simply inherits whichever one gets chosen.
  const isSneakWindowOpen = G.gameStatus === 'active'
    && isActive
    && canCheat
    && !isCurrentPlayersTurn
    && !isResolutionSequenceActive
    && !currentPlayerState?.hasLeft
    && !hasSneakedThisTurn
  const canSneakPlay = isSneakWindowOpen && selectedCards.length === 1
  /*
   * The take-back window, and it is the widest of any cheat: your own face-up cards, on anybody's
   * turn, as many as you dare. Nothing here is once-per-anything, so there is no spent flag to
   * mirror — what limits it is that every one of them re-arms the lock below and leaves a fresh gap
   * in your pile for the table to notice.
   */
  const isTakeBackWindowOpen = G.gameStatus === 'active'
    && isActive
    && canCheat
    && !isResolutionSequenceActive
    && !currentPlayerState?.hasLeft
  // An open conspiracy owes the table a play, so every other way out of the turn is closed. The
  // borrowed hand still feeds the two play buttons, which is why only these three are gated.
  const canPass = isInteractiveTurn && !isFinalTwoResolutionTurn && !isPassRemoved && !isTilted && !openConspiracy && !isForcedToPlay
  const selectedPlayCallout = currentTrump && selectedCards.length > 0
    ? buildPlayCalloutText(currentTrump, selectedCards.length)
    : null
  const selectedTrumpPlayCallout = selectedCards.length > 0
    ? buildPlayCalloutText(selectedTrumpRank, selectedCards.length)
    : null
  const canCallReset = isInteractiveTurn && totalCardsOnTable >= maxCardsOnTable && !openConspiracy
  const canUseCat = isInteractiveTurn && isCat && !isResolutionSequenceActive
  const selectedForeignerCardLabel = FOREIGNER_CARD_OPTIONS.find((option) => option.value === selectedForeignerCardCode)?.label ?? 'the selected card'
  const displayedTrumpRank = currentTrump ?? selectedTrumpRank
  const displayedTrumpLabel = currentTrump ? 'Live trump' : 'Selected rank'
  const actingSeatLabel = getSeatDisplayName(actingPlayerID, currentSeatID, playerName, playersFromRoom)
  // Only ever the hand that is actually open. Every line built from it sits behind an
  // `openConspiracy` check, so the fallback is a label nothing has occasion to print.
  const conspireTargetSeatID = openConspiracy?.targetPlayerID ?? null
  const conspireTargetLabel = conspireTargetSeatID
    ? getSeatDisplayName(conspireTargetSeatID, currentSeatID, playerName, playersFromRoom)
    : 'nobody'
  const manipulateRank = resolvedManipulateRank ?? selectedTrumpRank
  // With the cap removed the number still gates Call Reset, so it is labelled as the reset threshold
  // rather than a maximum it no longer is.
  const tableCapacityLabel = isTableLimitRemoved
    ? `current cards: ${totalCardsOnTable}, no maximum (reset unlocks at ${maxCardsOnTable})`
    : `current cards: ${totalCardsOnTable}, max cards: ${maxCardsOnTable}`
  /*
   * Read by its viewer alone, so it can name a cheat they hold the licence for. The take-back is
   * listed first when both apply, because that is also the order the click resolves in — your own
   * face-up cards go back to your hand, everyone else's flip.
   */
  const frontCardsColumnTooltip = canUseCat && isTakeBackWindowOpen
    ? `${tableCapacityLabel}. Click a face-up card of your own to take it back into your hand; because you are The Cat, clicking anyone else's flips it face down.`
    : isTakeBackWindowOpen
    ? `${tableCapacityLabel}. You may click a face-up card of your own to take it back into your hand. Accuse catches that until the turn it happened on ends.`
    : canUseCat
    ? `${tableCapacityLabel}. Because you are The Cat, you may click any face-up front card to flip it face down.`
    : tableCapacityLabel
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
  // A Cat off their own turn is cheating like anybody else, so the legal-flip copy is bound to
  // the same condition the move is. Both halves warn about the tell: the log names nobody, but the
  // board nudges your block toward the hub for anyone who happens to be watching it.
  const directionIndicatorLabel = canToggleDirection
    ? isCat && isCurrentPlayersTurn
      ? `Turn direction is ${directionArrowOrientation}. Click to use The Cat and flip the direction. Your block gives a nod as you do.`
      : `Turn direction is ${directionArrowOrientation}. Click to change the direction, on anyone's turn. Your block gives a nod as you do, and Accuse can catch it until that turn ends.`
    : `Turn direction is ${directionArrowOrientation}.`
  const latestTablePlay = G.table.plays[G.table.plays.length - 1] ?? null
  /*
   * Every card the ring draws in front of a seat, worked out once. The seat rows and the flip
   * watcher both read it, which is what stops a card being animated as flipping while it is drawn
   * the other way up — a disguise deliberately turns its borrowed pile over on a different turn than
   * the cards themselves are revealed on.
   */
  const displayedFrontCardsBySeatID = useMemo(() => new Map(
    G.seatOrder.map((seatID) => [seatID, getDisplayedFrontCards(G.table.plays, seatID, wornMimicry)] as const),
  ), [G.seatOrder, G.table.plays, wornMimicry])
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
  /*
   * A Gambler showdown's standings, which arrive only once the caller has turned the whole table
   * over. Every seat gets its reading; the weakest gets a Punish button, and a tie gets several, so
   * the caller is the one who decides between hands the cards could not separate.
   */
  const resetShowdown = resetResolution?.showdown ?? null
  const showdownHandLabelBySeatID = Object.fromEntries(
    (resetShowdown?.standings ?? []).map((standing) => [standing.playerID, standing.handLabel]),
  )
  const showdownLoserSeatIDSet = new Set(resetShowdown?.weakestPlayerIDs ?? [])
  const isResetCaller = Boolean(resetResolution && currentSeatID === resetResolution.callerPlayerID)
  const resetPunishSeatIDSet = isResetCaller
    && isResetRevealComplete
    && isResetPunishPromptReady
    && resetShowdown
    && !resetShowdown.isPunishing
    ? showdownLoserSeatIDSet
    : new Set<string>()
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

  /*
   * One watcher for both directions of a flip, because both play the same animation and both are now
   * questions about what is drawn rather than about what the table holds. A card turning face up at a
   * reveal and one being turned face down by The Cat are the same event seen from either side.
   *
   * Only cards present in both renders count. One that has just arrived is entering, which the
   * front-card entry watcher owns, and one that has just left is on its way into somebody's hand.
   */
  useEffect(() => {
    const nextFaceDownByOverlayCardID = new Map<string, boolean>()
    for (const displayedFrontCards of displayedFrontCardsBySeatID.values()) {
      for (const displayedFrontCard of displayedFrontCards) {
        nextFaceDownByOverlayCardID.set(displayedFrontCard.overlayCardID, displayedFrontCard.faceDown)
      }
    }

    const previousFaceDownByOverlayCardID = previousDisplayedFaceDownRef.current
    previousDisplayedFaceDownRef.current = nextFaceDownByOverlayCardID

    if (!hasMountedRevealWatcherRef.current) {
      hasMountedRevealWatcherRef.current = true
      return
    }

    const flippedOverlayCardIDs = [...nextFaceDownByOverlayCardID.entries()]
      .filter(([overlayCardID, faceDown]) => {
        const previousFaceDown = previousFaceDownByOverlayCardID.get(overlayCardID)

        return previousFaceDown !== undefined && previousFaceDown !== faceDown
      })
      .map(([overlayCardID]) => overlayCardID)

    if (flippedOverlayCardIDs.length === 0) {
      return
    }

    const flippedOverlayCardIDSet = new Set(flippedOverlayCardIDs)
    setRevealFlippingCardIDs((previousIDs) => [...new Set([...previousIDs, ...flippedOverlayCardIDs])])

    const timeoutID = window.setTimeout(() => {
      setRevealFlippingCardIDs((previousIDs) => previousIDs.filter((cardID) => !flippedOverlayCardIDSet.has(cardID)))
      revealFlipTimeoutIDsRef.current = revealFlipTimeoutIDsRef.current.filter((currentTimeoutID) => currentTimeoutID !== timeoutID)
    }, FRONT_CARD_FLIP_DURATION_MS)

    revealFlipTimeoutIDsRef.current.push(timeoutID)
  }, [displayedFrontCardsBySeatID])

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

    // A play with no claim yet was sneaked in before the round had a trump rank, so the guard above
    // has already returned. Belt and braces: there is no sentence to say about a claim of nothing.
    if (latestTablePlay.claimedRank === null) {
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
   * A disguise arriving hands The Mime's block whatever line its source was saying, so the two do
   * not differ over one of them being mid-sentence. Seeded into `playerCallouts` rather than drawn
   * on top of it, so from here on it behaves like any other line on that block: overwritten when The
   * Mime says something, and dropped when their turn starts. Both of those are exactly what would
   * have happened to the source's line on that chair had the seats moved instead.
   *
   * Skipped when The Mime is the one on the clock, which is the no-swap case — a block whose turn
   * has begun has already had its line cleared, and the source's block still shows theirs. Seeding
   * then would put a line on the acting block that the other case does not have.
   *
   * Mimic itself says nothing. A line at the moment of use would land on the wearer, and the wearer
   * is on a different side of the swap in each of the two cases this hides between.
   */
  useEffect(() => {
    if (!wornMimicryKey) {
      lastSeededMimicryKeyRef.current = ''
      return
    }

    if (lastSeededMimicryKeyRef.current === wornMimicryKey || !wornMimicry) {
      return
    }

    lastSeededMimicryKeyRef.current = wornMimicryKey

    const borrowedCalloutText = ctx.currentPlayer === wornMimicry.playerID
      ? null
      : playerCallouts[wornMimicry.sourcePlayerID]?.text ?? null

    if (borrowedCalloutText) {
      showPlayerCallout(wornMimicry.playerID, `mimic-${wornMimicryKey}`, borrowedCalloutText)
    }
  }, [wornMimicryKey, wornMimicry, ctx.currentPlayer, playerCallouts])

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
      previousHandSourceSeatIDRef.current = handSourceSeatID
      setEnteringHandCardIDs([])
      setRemovingHandCards([])
      return
    }

    const seatChanged = previousHandSourceSeatIDRef.current !== handSourceSeatID
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
    previousHandSourceSeatIDRef.current = handSourceSeatID
  }, [handSourceSeatID, handCardIDsKey, scoredSetIDsKey])

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

  /*
   * Emote events stay in G long enough for every client to receive them, but only newly received
   * ids animate. A reconnect therefore sees the current table without replaying old reactions.
   */
  useEffect(() => {
    const emotes = G.emotes ?? []

    if (!hasMountedEmoteWatcherRef.current) {
      hasMountedEmoteWatcherRef.current = true
      seenEmoteIDsRef.current = new Set(emotes.map((emote) => emote.id))
      return
    }

    const nextActiveEmotes: ActiveEmote[] = []
    for (const emote of emotes) {
      if (seenEmoteIDsRef.current.has(emote.id)) {
        continue
      }

      seenEmoteIDsRef.current.add(emote.id)
      const sprite = getEmoteSprite(emote.emoteID)
      if (sprite) {
        nextActiveEmotes.push({
          id: emote.id,
          playerID: emote.playerID,
          sprite,
        })
      }
    }

    if (nextActiveEmotes.length > 0) {
      setActiveEmotes((previousEmotes) => [...previousEmotes, ...nextActiveEmotes].slice(-12))

      /*
       * `onAnimationEnd` is how one of these normally leaves the list. This is the backstop for the
       * cases where that event never arrives: an emote whose owner is not on the ring has no element
       * to fire it, and a backgrounded tab can drop it outright. Without this such an emote would sit
       * in state until the cap evicted it, and reappear the moment its owner joined the ring.
       */
      const expiringEmoteIDs = new Set(nextActiveEmotes.map((emote) => emote.id))
      const timeoutID = window.setTimeout(() => {
        emoteExpiryTimeoutIDsRef.current.delete(timeoutID)
        setActiveEmotes((previousEmotes) => previousEmotes.filter((emote) => !expiringEmoteIDs.has(emote.id)))
      }, EMOTE_EXPIRY_MS)

      emoteExpiryTimeoutIDsRef.current.add(timeoutID)
    }
  }, [G.emotes])

  useEffect(() => {
    const timeoutIDs = emoteExpiryTimeoutIDsRef.current

    return () => {
      for (const timeoutID of timeoutIDs) {
        window.clearTimeout(timeoutID)
      }

      timeoutIDs.clear()
    }
  }, [])

  /*
   * Blind, and the one status that changes nothing but what this client draws. The cards are already
   * public to every other seat, so nothing secret is being trusted to the browser — the sprite is
   * simply swapped for `unknown.png` on the way to the board.
   *
   * Lifted while a BS or Reset reveal is running. Those procedures are the caller turning the table
   * over one card at a time, and a blind caller who could not read what they revealed would have no
   * way to resolve a challenge they started.
   */
  const isViewerBlind = Boolean(currentSeatID && hasStatus(G, currentSeatID, 'blind'))
    && !isBSSequenceActive
    && !isResetSequenceActive

  const seatRows: SeatRow[] = G.seatOrder.map((seatID) => {
    const player = G.players[seatID]
    const disguise = wornMimicry?.playerID === seatID ? wornMimicry : null
    /** Whose face and numbers this block shows, which is its own unless it is wearing somebody's. */
    const identitySeatID = disguise?.sourcePlayerID ?? seatID
    const matchPlayer = playersFromRoom.find((entry) => String(entry.id) === identitySeatID)
    const displayedFrontCards = displayedFrontCardsBySeatID.get(seatID) ?? []
    /** What The Mime has spent out of the copied hand since copying it. See `resolveMimic`. */
    const cardsPlayedUnderDisguise = disguise
      ? displayedFrontCards.filter((displayedFrontCard) => !displayedFrontCard.isBorrowed).length
      : 0

    const frontCards = displayedFrontCards.map(({ overlayCardID, play, card, faceDown }) => {
      /*
       * Your own face-up card is the one place these two compete, and the take-back takes it. A Cat
       * who may also cheat therefore palms their own pile and still flips everybody else's, which is
       * also why the two flags are made exclusive here rather than left to the click handler: a card
       * carrying both would wear both affordances.
       *
       * `play.playerID` rather than `seatID`, so a borrowed pile drawn under a Mimic disguise stays
       * with whoever really played it. You may only ever palm back a card that is genuinely yours.
       */
      const isTakeBackActionable = isTakeBackWindowOpen && !faceDown && play.playerID === currentSeatID

      return {
        id: overlayCardID,
        cardID: card.id,
        // Only the face-up half is rewritten, so `faceDown` is untouched and the flip watcher built
        // on `getDisplayedFrontCards` never sees a card change sides because somebody went blind.
        sprite: isViewerBlind && !faceDown ? UNKNOWN_CARD_FILENAME : card.sprite,
        faceDown,
        isDeparted: departedPunishmentCardIDSet.has(overlayCardID) || departedResetCardIDSet.has(overlayCardID),
        isFlipping: revealFlippingCardIDSet.has(overlayCardID),
        isTargeted: !isResetSequenceActive && play.id === targetPlayID,
        isCatActionable: canUseCat && !faceDown && !isTakeBackActionable,
        isTakeBackActionable,
        // Only the caller can flip, and only in the block currently pulled to the centre.
        isRevealable: isRevealCaller && seatID === focusedSeatID && faceDown,
        // A masked card is rewritten to rank Joker before it reaches the client, so an
        // unflipped card can never light up here. Blind puts it out too — a highlight would read the
        // trump straight through the blindfold.
        isTrumpHighlighted: !isViewerBlind && Boolean(bsResolution) && !faceDown && G.round.trumpRank !== null
          && countsTowardReverseRule(card, G.round.trumpRank, G.players[play.playerID].character),
      }
    })

    return {
      id: seatID,
      // The one thing a disguise never copies: the seat number belongs to the chair, not to whoever
      // is sitting in it, so it survives a swap untouched and gives nothing away.
      seatIndex: player.seatIndex,
      avatarSprite: getAvatarSprite(matchID, identitySeatID),
      characterName: disguise ? disguise.character : player.character,
      characterSprite: G.useCharacters
        ? getCharacterCardSprite(disguise ? disguise.character : player.character)
        : '',
      frontCards,
      handCount: disguise
        ? Math.max(0, disguise.handCount - cardsPlayedUnderDisguise)
        : player.hand.length,
      hasLeft: player.hasLeft,
      isActingPlayer: seatID === actingPlayerID,
      isConnected: identitySeatID === currentSeatID ? isConnected : Boolean(matchPlayer?.isConnected),
      isTargetPlayer: seatID === visibleTargetSeatID,
      isViewingPlayer: seatID === currentSeatID,
      leaveEffect: player.leaveEffect
        ? {
            label: formatLeaveEffectLabel(player.leaveEffect),
            isGain: player.leaveEffect.pointDelta > 0,
          }
        : null,
      name: getSeatDisplayName(identitySeatID, currentSeatID, playerName, playersFromRoom),
      pointRanks: disguise ? disguise.pointRanks : player.scoredSets.map((scoredSet) => scoredSet.rank),
      points: disguise ? disguise.points : player.points,
      // Copied like every other number on a disguised block, so the two never differ here.
      statuses: toSeatStatuses(disguise ? disguise.statuses ?? [] : getPlayerStatuses(G, seatID)),
      wasSeekerPick: disguise ? disguise.wasSeekerPick : player.seekerPickedCharacter !== null,
    }
  })

  const frontCardIDsKey = seatRows.map((seat) => `${seat.id}:${seat.frontCards.map((card) => card.id).join(',')}`).join('|')
  const enteringFrontCardIDSet = new Set(enteringFrontCardIDs)
  const activeEmotesBySeatID = activeEmotes.reduce<Record<string, ActiveEmote[]>>((emotesBySeatID, emote) => {
    const seatEmotes = emotesBySeatID[emote.playerID] ?? []

    emotesBySeatID[emote.playerID] = [...seatEmotes, emote]
    return emotesBySeatID
  }, {})

  useLayoutEffect(() => {
    if (frontCardIDsKey === lastFrontCardIDsKeyRef.current) {
      return
    }

    lastFrontCardIDsKeyRef.current = frontCardIDsKey

    /*
     * A disguise going on or coming off rewrites one block's whole pile in a single render, and none
     * of those cards are arriving from anybody's hand. Left alone the watcher below would deal them
     * in, on that block only — which would point straight at the seat the disguise exists to hide.
     * Re-baseline instead and animate nothing: no card is ever played in the same render.
     */
    const hasMimicryChanged = wornMimicryKey !== lastWornMimicryKeyRef.current
    lastWornMimicryKeyRef.current = wornMimicryKey

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

    if (hasMimicryChanged) {
      previousFrontCardIDsBySeatRef.current = nextFrontCardIDsBySeat
      // The timeouts that would have retired an in-flight entry were cleared above, so the clears
      // have to happen here rather than being left to fire on their own.
      setEnteringFrontCardIDs([])
      setFrontCardEntrySequence(null)
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
  }, [frontCardIDsKey, seatRows, wornMimicryKey])

  const historyEvents: HistoryEvent[] = G.history.map((event) => ({
    id: event.id,
    kind: event.kind,
    title: event.title,
    detail: event.detail,
    omen: event.omen,
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

  /*
   * The direction-flip tell. `G.directionFlip` names the hand behind every flip, legal or not, and
   * this turns it into a nudge of that player's block toward the hub. It is the only thing the board
   * ever says about who touched the sign — the log entry names nobody, and the server's verdict on
   * whether they were entitled to never leaves the server at all.
   *
   * Not replayed on mount, for the same reason the punishment flash is not: a player who joins or
   * reloads after the fact was not there to catch it, and handing it to them would turn a thing you
   * had to be watching for into a thing you cannot miss.
   */
  const directionFlipID = G.directionFlip?.id ?? null
  const directionFlipPlayerID = G.directionFlip?.playerID ?? null

  useEffect(() => {
    if (!hasMountedDirectionFlipWatcherRef.current) {
      hasMountedDirectionFlipWatcherRef.current = true
      lastSeenDirectionFlipIDRef.current = directionFlipID
      return
    }

    if (!directionFlipID || directionFlipID === lastSeenDirectionFlipIDRef.current) {
      return
    }

    lastSeenDirectionFlipIDRef.current = directionFlipID

    /*
     * Cleared and re-set across two frames rather than in one go. Flipping back and forth inside a
     * turn is a legitimate thing to do, and a second flip by the same player would otherwise leave
     * the class untouched, so the browser would have no change to restart the keyframes from.
     */
    setDirectionFlipTellSeatID(null)
    const frameID = window.requestAnimationFrame(() => {
      setDirectionFlipTellSeatID(directionFlipPlayerID)
    })
    const timeoutID = window.setTimeout(() => {
      setDirectionFlipTellSeatID(null)
    }, DIRECTION_FLIP_TELL_DURATION_MS)

    return () => {
      window.cancelAnimationFrame(frameID)
      window.clearTimeout(timeoutID)
    }
  }, [directionFlipID, directionFlipPlayerID])

  /*
   * The take-back lock, and the deliberate opposite of the direction tell above: that one is played
   * on everybody's screen and says who touched the sign, this one is played on one screen and says
   * nothing to anybody. `hideSecretState` hands `takeBackTamper` back to its owner alone, so a record
   * arriving here can only ever be this client's own.
   *
   * Armed only when the palm happened on this player's own turn, which is the only case the pause is
   * for — off your turn there is no turn of yours to end early. The id changes on every take-back, so
   * an unlimited run of them serves the full two seconds each time rather than the first one covering
   * the rest.
   */
  const takeBackTamperID = G.takeBackTamper?.id ?? null

  useEffect(() => {
    if (!hasMountedTakeBackLockWatcherRef.current) {
      hasMountedTakeBackLockWatcherRef.current = true
      lastSeenTakeBackTamperIDRef.current = takeBackTamperID
      return
    }

    if (!takeBackTamperID || takeBackTamperID === lastSeenTakeBackTamperIDRef.current) {
      return
    }

    lastSeenTakeBackTamperIDRef.current = takeBackTamperID

    if (ctx.currentPlayer !== currentSeatID) {
      return
    }

    setIsTakeBackLocked(true)
    const timeoutID = window.setTimeout(() => {
      setIsTakeBackLocked(false)
    }, TAKE_BACK_ACTION_LOCK_MS)

    return () => {
      window.clearTimeout(timeoutID)
      setIsTakeBackLocked(false)
    }
  }, [ctx.currentPlayer, currentSeatID, takeBackTamperID])

  const toggleCardSelection = (cardID: string) => {
    // Not turn-bound any more: a player has to be able to pick the cards they mean to sneak while
    // somebody else is on the clock.
    if (!isInteractiveTurn && !isSneakWindowOpen) {
      return
    }

    setSelectedCardIDs((previousIDs) => previousIDs.includes(cardID)
      ? previousIDs.filter((id) => id !== cardID)
      : [...previousIDs, cardID])
  }

  const sendSelectionToTable = (nextTrump: BlowCowRank | null) => {
    /*
     * Broken takes the choice of card away but not the action, so Play still sends a play — one
     * random card, through the same move The Drunkard uses. The rank is still the player's, which is
     * why this branches on the selection rather than replacing the button.
     */
    if (isBrokenStatus) {
      moves.playRandom({ cardCount: 1, trumpRank: nextTrump } satisfies BlowCowPlayRandomArgs)
      setSelectedCardIDs([])
      return
    }

    if (selectedCards.length === 0 || (!canCheat && selectedCards.length > 2)) {
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
  // simply appear in front of the player and it is on everyone else to notice.
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

  const handleBreakRule = (ruleID: BlowCowRuleID) => {
    if (!canBreakAnyRule || !breakableRuleIDs.includes(ruleID)) {
      return
    }

    moves.breakRule({ ruleID })
  }

  const handleDefy = () => {
    if (!canDefy) {
      return
    }

    moves.defy({ cardID: selectedCards[0].id })
    setSelectedCardIDs([])
  }

  const handleMimic = () => {
    if (!canMimicNow) {
      return
    }

    moves.mimic()
  }

  /*
   * How far the card leans, in degrees, at the very edge of its own box. Large enough that the
   * parallax is unmistakable, small enough that the printed ability text never skews out of reading.
   */
  const CHARACTER_CARD_MAX_TILT_DEG = 15

  const handleCharacterCardPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const element = characterCardRef.current
    if (!element) {
      return
    }

    const bounds = element.getBoundingClientRect()
    if (bounds.width === 0 || bounds.height === 0) {
      return
    }

    // 0..1 across the card, then recentred to -0.5..0.5 so the middle is the resting position.
    const pointerX = (event.clientX - bounds.left) / bounds.width
    const pointerY = (event.clientY - bounds.top) / bounds.height

    element.style.setProperty('--card-pointer-x', `${(pointerX * 100).toFixed(2)}%`)
    element.style.setProperty('--card-pointer-y', `${(pointerY * 100).toFixed(2)}%`)
    // Y drives rotateX and X drives rotateY: leaning toward the pointer means tipping about the
    // other axis, and the X sign is flipped so the top edge falls away as the pointer rises.
    element.style.setProperty('--card-tilt-x', `${((0.5 - pointerY) * CHARACTER_CARD_MAX_TILT_DEG * 2).toFixed(2)}deg`)
    element.style.setProperty('--card-tilt-y', `${((pointerX - 0.5) * CHARACTER_CARD_MAX_TILT_DEG * 2).toFixed(2)}deg`)
    element.style.setProperty('--card-glare-opacity', '1')
    element.style.setProperty('--card-lift', '1')
  }

  const handleCharacterCardPointerLeave = () => {
    const element = characterCardRef.current
    if (!element) {
      return
    }

    // Back to flat. The transition on the card is what makes this a settle rather than a snap.
    element.style.setProperty('--card-tilt-x', '0deg')
    element.style.setProperty('--card-tilt-y', '0deg')
    element.style.setProperty('--card-glare-opacity', '0')
    element.style.setProperty('--card-lift', '0')
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

    // The two-second pause after a take-back covers the block buttons as well as the action row.
    if (isTakeBackLocked) {
      return TAKE_BACK_LOCK_DESCRIPTION
    }

    if (G.gameStatus !== 'active') {
      return 'The match is not running.'
    }

    if (isResolutionSequenceActive) {
      return 'Wait for the current resolution to finish.'
    }

    if (!isCurrentPlayersTurn) {
      return 'You can only call BS on your own turn.'
    }

    if (openConspiracy) {
      return `You opened ${conspireTargetLabel}'s hand, so the only thing left this turn is a play out of it.`
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
   * Accuse shares nothing with Call BS any more. It is legal off your turn, against anyone licensed
   * to cheat, and it never checks whether the cheat is really there — the board cannot know, because
   * `G.directionTamper` never leaves the server. Everything below is a precondition, not a hint.
   *
   * Including the licence check: characters are public, so refusing to name anyone else gives away
   * nothing that the target's own character badge is not already showing. Once the No Cheating Rule
   * is gone that check refuses nobody, and every block at the table is worth pointing at.
   */
  const getAccuseFailure = (seatID: string) => {
    const seatName = getSeatDisplayName(seatID, currentSeatID, playerName, playersFromRoom)

    // The two-second pause after a take-back covers the block buttons as well as the action row.
    if (isTakeBackLocked) {
      return TAKE_BACK_LOCK_DESCRIPTION
    }

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

    // An accusation ends the round, which would clear the conspiracy along with it. Closing that
    // route is what keeps Conspire a commitment rather than a free look at a hand.
    if (openConspiracy) {
      return `You opened ${conspireTargetLabel}'s hand, so the only thing left this turn is a play out of it.`
    }

    if (G.players[seatID]?.hasLeft) {
      return `${seatName} has already left the game.`
    }

    // The one thing about an accusation the board *can* check, because characters are public.
    if (!isCheatingUniversal && G.players[seatID]?.character !== 'The Dreamer') {
      return 'Only Dreamer can be accused'
    }

    if (currentPlayerState.hasUsedAccusationThisRound) {
      return 'You already used your accusation this round. You get another one next round.'
    }

    return null
  }

  /**
   * Mirrors every server precondition for `conspire`. Unlike the action row this once lived in, the
   * button is on somebody's block, so a hover off your own turn is an ordinary thing to do and the
   * turn check has to be one of the answers.
   */
  const getConspireFailure = (seatID: string) => {
    const seatName = getSeatDisplayName(seatID, currentSeatID, playerName, playersFromRoom)

    // The two-second pause after a take-back covers the block buttons as well as the action row.
    if (isTakeBackLocked) {
      return TAKE_BACK_LOCK_DESCRIPTION
    }

    if (G.gameStatus !== 'active') {
      return 'The match is not running.'
    }

    if (isResolutionSequenceActive) {
      return `Wait for the ${resolutionSequenceLabel} resolution sequence to finish.`
    }

    if (openConspiracy) {
      return `You are already inside ${conspireTargetLabel}'s hand. Play out of it to end the turn.`
    }

    if (!isCurrentPlayersTurn) {
      return 'Conspire only works on your own turn.'
    }

    if (hasUsedConspireThisRound) {
      return 'You already used Conspire this round. It comes back at the start of the next one.'
    }

    if (isFinalTwoResolutionTurn) {
      return 'With two players left, you cannot conspire after the other player emptied their hand with a hidden play.'
    }

    // Mirrors `resolveConspire`. The table-room half is checked here rather than left to the play
    // that follows, because Conspire commits the turn: opening a hand with no room to play it out
    // would leave the turn with nothing legal left at all.
    if (totalCardsOnTable >= maxCardsOnTable && !isTableLimitRemoved) {
      return 'The table is full, so there would be no room to play the cards you opened.'
    }

    if (!conspiracyTargetSeatIDs.includes(seatID)) {
      return `${seatName} is not holding a card to conspire with.`
    }

    // Backstop, so the button can never offer something the server would refuse for a reason the
    // branches above do not have wording for.
    if (!currentSeatID || !canConspire(G, currentSeatID)) {
      return 'Conspire is not available right now.'
    }

    return null
  }

  /** Mirrors every server precondition for `manipulate`, with the same turn caveat as Conspire. */
  const getManipulateFailure = (seatID: string) => {
    const seatName = getSeatDisplayName(seatID, currentSeatID, playerName, playersFromRoom)

    // The two-second pause after a take-back covers the block buttons as well as the action row.
    if (isTakeBackLocked) {
      return TAKE_BACK_LOCK_DESCRIPTION
    }

    if (G.gameStatus !== 'active') {
      return 'The match is not running.'
    }

    if (isResolutionSequenceActive) {
      return `Wait for the ${resolutionSequenceLabel} resolution sequence to finish.`
    }

    if (!isCurrentPlayersTurn) {
      return 'Manipulate only works on your own turn.'
    }

    if (G.round.startingPlayerID !== currentSeatID) {
      return 'Manipulate belongs to the player who starts the round. You are not it this round.'
    }

    if (currentTrump !== null) {
      return 'The round already has a trump rank, so there is nothing left to decide.'
    }

    if (G.round.passStreak > 0 || G.round.lastNonPassingPlayerID !== null) {
      return 'The round is already under way. Manipulate only works on its very first turn.'
    }

    if (!manipulationTargetSeatIDs.includes(seatID)) {
      return `${seatName} cannot be handed the round.`
    }

    if (!currentSeatID || !canManipulate(G, currentSeatID)) {
      return 'Manipulate is not available right now.'
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

  // Clears the hand selection on the way in as well as on the way out: whatever was picked belonged
  // to the hand this is about to replace.
  const handleSeatConspire = (seatID: string) => {
    const failure = getConspireFailure(seatID)
    if (failure) {
      showFailMessage(failure)
      return
    }

    moves.conspire({ targetPlayerID: seatID })
    setSelectedTargetSeatID(null)
    setSelectedCardIDs([])
  }

  // The rank and direction come from the two selectors left in the action row; the block that was
  // clicked is the third decision, and the only one that needed a target at all.
  const handleSeatManipulate = (seatID: string) => {
    const failure = getManipulateFailure(seatID)
    if (failure) {
      showFailMessage(failure)
      return
    }

    moves.manipulate({
      targetPlayerID: seatID,
      trumpRank: manipulateRank,
      direction: resolvedManipulateDirection,
    })
    setSelectedTargetSeatID(null)
    setSelectedCardIDs([])
  }

  const handleToggleDirection = () => {
    if (!canToggleDirection) {
      return
    }

    moves.toggleDirection()
  }

  const handleEmote = (emoteID: number) => {
    if (!canEmote) {
      return
    }

    moves.emote({ emoteID })
    setIsEmotePickerOpen(false)
  }

  const handleEmoteAnimationEnd = (emoteID: string) => {
    setActiveEmotes((previousEmotes) => previousEmotes.filter((emote) => emote.id !== emoteID))
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

  // Silent on the way out, exactly as `handleSneakPlay` is: no target to pick, no callout, no
  // announcement. The card simply stops being in front of them and it is on everyone else to notice.
  const handleTakeBackCard = (cardID: string) => {
    if (!isTakeBackWindowOpen) {
      return
    }

    moves.takeBackCard({ cardID })
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

  /*
   * Same split again, plus the choice. The seat pressed is the seat punished, which is how a tie is
   * broken; the server still checks it against `weakestPlayerIDs`, so a stale button cannot hand the
   * table to somebody who was never in the running.
   */
  const handleBeginResetPunishment = (seatID: string) => {
    if (!resetResolution || !resetPunishSeatIDSet.has(seatID)) {
      return
    }

    moves.beginResetPunishment({ resolutionID: resetResolution.id, punishedPlayerID: seatID })
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
      spriteFrames: getCharacterCardSpriteFrames(seat.characterName),
      wasSeekerPick: seat.wasSeekerPick,
    })
  }

  /*
   * Every action that needs somebody to point at lives here rather than in the action row: Call BS
   * and Accuse for everyone, plus Conspire and Manipulate for the one seat holding the character
   * that has them. Both of those used to carry a player dropdown, which the block itself replaces.
   */
  const renderSeatTargetActions = (seat: SeatRow) => {
    const targetSelection = resolveClientBSTargetSelection(G, currentSeatID, seat.id)
    const callBSFailure = getCallBSFailure(seat.id)
    const accuseFailure = getAccuseFailure(seat.id)
    const conspireFailure = isMastermind ? getConspireFailure(seat.id) : null
    const manipulateFailure = isInvisibleHand ? getManipulateFailure(seat.id) : null

    return (
      <div className="seat-target-actions">
        <button
          className="seat-target-button"
          onClick={(event) => {
            event.stopPropagation()
            handleSeatCallBS(seat.id)
          }}
          title={callBSFailure
            ?? `${targetSelection?.kind === 'pawnEnPassant'
              ? `Use The Pawn to challenge ${seat.name}'s earlier hidden play.`
              : targetSelection?.kind === 'grandmasterOverride'
              ? `Challenge ${seat.name}. This spends The Grandmaster override.`
              // Your own play is the latest one by now, so the default wording would be wrong. The
              // encore is holding the target it displaced open — see `BlowCowEncore`.
              : openEncore
              ? `Challenge ${seat.name}, who was the latest non-passing player before your play. Your own cards flip with the rest of the table.`
              : `Challenge ${seat.name}, the latest non-passing player.`}${contrarianCallBSDetail}`}
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
            ?? `Accuse ${seat.name} of cheating. Costs your one accusation for this round whether or not it lands.`}
          type="button"
        >
          Accuse
        </button>

        {isMastermind ? (
          <button
            className="seat-target-button conspire"
            onClick={(event) => {
              event.stopPropagation()
              handleSeatConspire(seat.id)
            }}
            title={conspireFailure
              ?? `Use The Mastermind to open ${seat.name}'s hand. You must then play out of it, and no other action is left this turn.`}
            type="button"
          >
            <img alt="" aria-hidden="true" className="seat-target-button-icon" src={CONSPIRE_ICON_SPRITE} />
            Conspire
          </button>
        ) : null}

        {/*
          * All three decisions in one place, on the block that answers the third of them. The two
          * selectors read and write the same state on every block, because a Manipulate has one rank
          * and one direction however many blocks are offering it — whichever bubble is open is the
          * one that gets used. Both events are stopped at the wrapper: the block underneath is a
          * click-and-Enter target itself, and a dropdown opened on it must not also select the seat.
          */}
        {isInvisibleHand ? (
          <div
            className="seat-target-manipulate"
            onClick={(event) => {
              event.stopPropagation()
            }}
            onKeyDown={(event) => {
              event.stopPropagation()
            }}
          >
            {/* The previous round's trump is absent rather than disabled: Manipulate obeys the Rank
              * Change Rule, so it is not a choice this control can offer at all. */}
            <select
              aria-label="Round trump rank"
              className="trump-select seat-target-select seat-target-rank-select"
              disabled={!canManipulateNow}
              onChange={(event) => {
                setSelectedManipulateRank(event.target.value as BlowCowRank)
              }}
              value={resolvedManipulateRank ?? ''}
            >
              {manipulableTrumpRanks.map((rank) => (
                <option key={rank} value={rank}>
                  {rank}
                </option>
              ))}
            </select>

            <select
              aria-label="Round direction"
              className="trump-select seat-target-select seat-target-direction-select"
              disabled={!canManipulateNow}
              onChange={(event) => {
                setSelectedManipulateDirection(event.target.value as BlowCowDirection)
              }}
              value={resolvedManipulateDirection}
            >
              {BLOW_COW_DIRECTIONS.map((direction) => (
                <option key={direction} value={direction}>
                  {direction === 'clockwise' ? 'Clockwise' : 'Counterclockwise'}
                </option>
              ))}
            </select>

            <button
              className="seat-target-button manipulate"
              onClick={(event) => {
                event.stopPropagation()
                handleSeatManipulate(seat.id)
              }}
              title={manipulateFailure
                ?? `Use The Invisible Hand to make ${manipulateRank} trump, set the direction to ${resolvedManipulateDirection}, and hand the round to ${seat.name}, who must play and may not pass.`}
              type="button"
            >
              <img alt="" aria-hidden="true" className="seat-target-button-icon" src={MANIPULATE_ICON_SPRITE} />
              Manipulate
            </button>
          </div>
        ) : null}
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

    /*
     * Last, so it never competes with the Continue button: the showdown's buttons only exist once
     * the reveal is complete, which is exactly when Continue has stopped being offered.
     */
    if (resetPunishSeatIDSet.has(seat.id)) {
      const isTiedChoice = resetPunishSeatIDSet.size > 1

      return (
        <button
          className="seat-reveal-action-button punish"
          onClick={(event) => {
            event.stopPropagation()
            handleBeginResetPunishment(seat.id)
          }}
          title={isTiedChoice
            ? `${seat.name} is tied for the weakest hand with ${showdownHandLabelBySeatID[seat.id] ?? 'no cards'}. Punish them to settle the tie, or press another tied seat instead.`
            : `${seat.name} had the weakest hand with ${showdownHandLabelBySeatID[seat.id] ?? 'no cards'} and takes every card on the table.`}
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

  /*
   * The status half of both play tooltips, written once because Worried, Mad, Nervous and Broken say
   * the same thing whether a trump is being chosen or already exists. Null when no status has
   * anything to say, so the existing chains below stay in charge of everything else.
   */
  const playStatusDescription = isWorried
    ? 'Worried: you cannot take the Play action while this status lasts.'
    : isBrokenStatus
    ? 'Broken: one random card from your hand goes down. Your selection is ignored, but the trump rank is still yours.'
    : isMad && isSelectionTruthful
    ? 'Mad: you must lie. Select at least one card that is not the claimed rank, or take a different action.'
    : isNervous && !isSelectionTruthful && selectedCards.length > 0
    ? 'Nervous: you must be truthful. Every selected card has to be the claimed rank, or take a different action.'
    : null

  const selectTrumpAction = {
    description: isResolutionSequenceActive
      ? `Wait for the ${resolutionSequenceLabel} resolution sequence to finish.`
      : playStatusDescription
      ? playStatusDescription
      : openConspiracy
      ? `Choose ${selectedTrumpRank} as trump and play up to 2 cards out of ${conspireTargetLabel}'s hand. They lose the cards; the play is yours, and so is any BS call it draws.`
      : currentTrump === null
      ? isRepeatingPreviousTrump && canCheat
        ? `${cheatVerbPrefix} pick ${selectedTrumpRank} again. You may also send more than 2 cards or overfill the table. Accuse catches any of those, but only during the next player's turn.`
        : isRepeatingPreviousTrump
        ? `${selectedTrumpRank} was the previous round trump and cannot be selected again.`
        : canCheat
        ? `Choose ${selectedTrumpRank} as trump. You may also send more than 2 selected cards and can even overfill the table, but Accuse catches an illegal count during the next player's turn.`
        : `Choose ${selectedTrumpRank} as trump and play up to 2 selected cards.`
      : `Trump is already ${currentTrump}. Use Play to make the claim.`,
    disabled: !canSelectTrumpAndPlay,
    icon: PLAY_ICON_SPRITE,
    key: 'select-trump',
    // Just `Play`, like its counterpart. The rank selector sitting beside it is what says a trump is
    // being chosen, so naming that in the label too only made the widest button in the row wider.
    // A Broken player is not playing what they picked, and a button that quietly discards a selection
    // reads as a bug, so it says so.
    label: isBrokenStatus
      ? 'Play 1 Random'
      : selectedTrumpPlayCallout
      ? `Play "${selectedTrumpPlayCallout}"`
      : 'Play',
    onClick: () => {
      sendSelectionToTable(selectedTrumpRank)
    },
  }

  const playAction = {
    description: isResolutionSequenceActive
      ? `Wait for the ${resolutionSequenceLabel} resolution sequence to finish.`
      : openEncore
      ? 'The Clown kept the turn after that play, and the action it bought cannot be another play. Take a different one.'
      : playStatusDescription
      ? playStatusDescription
      : openConspiracy
      ? `Play the selected cards out of ${conspireTargetLabel}'s hand and claim they are ${currentTrump}. They lose the cards; the play is yours, and so is any BS call it draws.`
      : currentTrump
      ? canCheat
        ? `Play the selected cards and claim they are ${currentTrump}. You may send more than 2 cards or overfill the table, but Accuse catches an illegal count during the next player's turn.`
        : `Play the selected cards and claim they are ${currentTrump}.`
      : 'Pick a trump rank first.',
    disabled: !canPlayCards,
    icon: PLAY_ICON_SPRITE,
    key: 'play',
    label: isBrokenStatus
      ? 'Play 1 Random'
      : selectedPlayCallout ? `Play \"${selectedPlayCallout}\"` : 'Play',
    onClick: () => {
      sendSelectionToTable(null)
    },
  }

  const playRandomAction = {
    description: isResolutionSequenceActive
      ? `Wait for the ${resolutionSequenceLabel} resolution sequence to finish.`
      : openEncore
      ? 'The Clown kept the turn after that play, and the action it bought cannot be another play. Take a different one.'
      : isWorried
      ? 'Worried: you cannot take the Play action while this status lasts.'
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
   * Dreamer alone — or, once the No Cheating Rule is gone, for everyone — which gives nothing away:
   * characters are public, rule statuses are public, and both are on screen already.
   */
  const sneakPlayAction = {
    description: isResolutionSequenceActive
      ? `Wait for the ${resolutionSequenceLabel} resolution sequence to finish.`
      : hasSneakedThisTurn
      ? 'You already slipped cards onto the table this turn. Wait for the next one.'
      : selectedCards.length === 0
      ? `Select the one card to slip onto the table while ${actingSeatLabel} is acting.`
      : selectedCards.length > 1
      ? 'Only one card can be slipped onto the table at a time. Deselect the rest.'
      // The no-trump case is a real one, and the tooltip has to say what the card will be held to,
      // because at that moment nobody knows: whoever picks the rank picks it for this card too.
      : currentTrump === null
      ? `${cheatVerbPrefix} place 1 card face down in front of you, without saying a word. It claims whatever trump rank the round ends up with. Accuse catches this until ${actingSeatLabel}'s turn ends.`
      : `${cheatVerbPrefix} place 1 card face down in front of you, claiming ${currentTrump}, without saying a word. Accuse catches this until ${actingSeatLabel}'s turn ends.`,
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

  /* The third off-clock action, and like Seek Character it opens a panel rather than sending a move. */
  const breakRuleAction = {
    description: isResolutionSequenceActive
      ? `Wait for the ${resolutionSequenceLabel} resolution sequence to finish.`
      : breakableRuleIDs.length === 0
      ? 'Every rule that could be removed is already gone, so there is nothing left to break.'
      : 'Use The Broken to remove one rule card from this match for everyone. The choice is permanent.',
    disabled: !canBreakAnyRule,
    icon: '',
    key: 'break-rule',
    label: 'Break Rule',
    onClick: () => {
      setHasDismissedBreakRulePicker(false)
    },
  }

  /*
   * The only action in this row that always leaves the turn running, so its description says so
   * outright — everything else here is a way to end the turn and a player has no other reason to
   * expect this one is not. Mimic below is the coin-flip version of the same surprise.
   */
  const defyAction = {
    description: isResolutionSequenceActive
      ? `Wait for the ${resolutionSequenceLabel} resolution sequence to finish.`
      : hasUsedDefyThisRound
      ? 'You already used Defy this round. It comes back at the start of the next one.'
      : destroyableRuleIDs.length === 0
      ? 'Every rule that could be removed is already gone, so there is nothing left to destroy.'
      : defyableCardIDSet.size === 0
      ? 'Defy destroys a heart from your hand, and you are holding none.'
      : selectedCards.length === 0
      ? 'Select the one heart to destroy.'
      : selectedCards.length > 1
      ? 'Defy destroys exactly one card. Deselect the rest.'
      : !isSelectedCardDefyable
      ? 'Defy only destroys hearts. Select a heart instead.'
      : `Use The Prototype to destroy ${getCardLabel(selectedCards[0].sprite)} and one random rule card. Your turn keeps going.`,
    disabled: !canDefy,
    icon: DEFY_ICON_SPRITE,
    key: 'defy',
    label: 'Defy',
    onClick: handleDefy,
  }

  /*
   * The one action whose outcome the button cannot promise, so the description says both halves and
   * commits to neither. It names the seat it will copy, which is safe: everyone can already see who
   * sits next to whom, and the secret is not who was copied but whether the chairs moved after.
   */
  const mimicAction = {
    description: isResolutionSequenceActive
      ? `Wait for the ${resolutionSequenceLabel} resolution sequence to finish.`
      : hasUsedMimicThisRound
      ? 'You already used Mimic this round. It comes back at the start of the next one.'
      : isFinalTwoResolutionTurn
      ? 'With two players left, you cannot mimic after the other player emptied their hand with a hidden play.'
      : !mimicrySourceSeatID
      ? 'There is nobody sitting after you to copy.'
      : `Use The Mime to take on ${getSeatDisplayName(mimicrySourceSeatID, currentSeatID, playerName, playersFromRoom)}'s block. Half the time you also swap seats with them, which hands them this turn and puts you after them.`,
    disabled: !canMimicNow,
    icon: MIMIC_ICON_SPRITE,
    key: 'mimic',
    label: 'Mimic',
    onClick: handleMimic,
  }

  // Call BS, Accuse, Conspire, and Manipulate are not here: they live on the player blocks, because
  // all four need a clicked target. Manipulate takes its rank and direction selectors with it, so
  // all three of its decisions are made in one place. See `renderSeatTargetActions`.
  // Labels the action row for whoever is on the clock. Spectators and waiting players see the
  // acting player's name, so the row never claims a turn that is not the viewer's.
  const handActionHeading = isCurrentPlayersTurn
    ? 'Your Turn'
    : `${getSeatDisplayName(actingPlayerID, currentSeatID, playerName, playersFromRoom)}'s Turn`

  const actionButtons = [
    currentTrump === null ? selectTrumpAction : playAction,
    ...(canCheat && !isCurrentPlayersTurn && !isSpectator ? [sneakPlayAction] : []),
    ...(isSeeker ? [seekCharacterAction] : []),
    ...(isBroken ? [breakRuleAction] : []),
    ...(isPrototype && !isSpectator ? [defyAction] : []),
    ...(isMime && !isSpectator ? [mimicAction] : []),
    ...(isDrunkard ? [playRandomAction] : []),
    {
      description: isResolutionSequenceActive
        ? `Wait for the ${resolutionSequenceLabel} resolution sequence to finish.`
        : isPassRemoved
        ? 'The Pass Rule was removed from this match, so Pass is not an available action.'
        : isTilted
        ? 'Tilted: you cannot take the Pass action while this status lasts.'
        : isForcedToPlay
        ? 'The Invisible Hand opened this round for you, so you must play this turn and may not pass.'
        : isFinalTwoResolutionTurn
        ? 'With two players left, you cannot pass after the other player emptied their hand with a hidden play.'
        // The encore has no decline button: Pass is how The Clown hands back a turn they have
        // nothing else to spend it on, and it counts as a pass like any other.
        : openEncore
        ? 'End the turn The Clown kept. It still counts as a pass, so it adds to the pass streak even though you played.'
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
  ].map((action) => (isTakeBackLocked
    /*
     * Applied over the finished row rather than folded into each button's own gate, so the lock
     * covers every action here including any added later, and so the reason it gives is the same
     * sentence on all of them. `Sneak Play` and `Seek Character` go down with the rest: the lock is
     * two seconds of this player's hands being off the board, not a turn-shaped rule.
     */
    ? {
        ...action,
        description: TAKE_BACK_LOCK_DESCRIPTION,
        disabled: true,
      }
    : action))

  return (
    <section
      className="table-board game-board-layout"
      ref={tableBoardRef}
      style={{
        '--table-board-gradient-top': tableBoardPalette.top,
        '--table-board-gradient-middle': tableBoardPalette.middle,
        '--table-board-gradient-bottom': tableBoardPalette.bottom,
      } as CSSProperties}
    >
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
                className="secondary-button toolbar-button leave-room-button"
                disabled={isLeaving}
                onClick={onLeaveRoom}
                type="button"
              >
                <span
                  aria-hidden="true"
                  className="toolbar-button-icon"
                  style={{ '--toolbar-icon-sprite': `url(${LEAVE_ROOM_ICON_SPRITE})` } as CSSProperties}
                />
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
            {/*
              * No kicker here. The card below is unmistakably a character card, so the line only
              * cost the panel height it does not have — the sprite is tall, and anything above it
              * comes straight out of the space the art gets to occupy.
              */}
            <div className="character-card-overlay-header">
              <div className="character-card-overlay-copy">
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
              {/*
                * The card tilts toward the pointer and carries a glare that tracks it, the way a
                * foiled card catches the light when you turn it over in your hand. Written straight
                * onto the node as custom properties rather than through state: this fires on every
                * pointer move, and re-rendering a board this size at that rate would stutter.
                */}
              <div
                className="character-card-overlay-card"
                onPointerLeave={handleCharacterCardPointerLeave}
                onPointerMove={handleCharacterCardPointerMove}
                ref={characterCardRef}
              >
                <CharacterCardSpriteImage
                  alt={`${selectedCharacterCard.playerName}: ${selectedCharacterCard.characterName}`}
                  className="character-card-overlay-image"
                  frames={selectedCharacterCard.spriteFrames}
                />
              </div>
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
                  <CharacterCardSpriteImage
                    alt={characterName}
                    frames={getCharacterCardSpriteFrames(characterName)}
                  />
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

      {/*
        * Mounted only on The Broken's own client, like The Seeker's picker above. The choice hits
        * everyone at the table the moment it lands, which is why the panel says so rather than
        * treating it as a private decision.
        */}
      {isBreakRulePickerOpen ? (
        <BreakRuleOverlay
          blockedReason={isResolutionSequenceActive
            ? `Wait for the ${resolutionSequenceLabel} resolution sequence to finish.`
            : 'There is no removable rule left to break.'}
          choices={breakableRuleIDs}
          isBlocked={!canBreakAnyRule}
          onBreakRule={handleBreakRule}
          onClose={() => {
            setHasDismissedBreakRulePicker(true)
          }}
          rules={G.rules}
        />
      ) : null}

      {!isStaging && isHistoryOpen ? (
        <HistoryOverlay
          historyEvents={historyEvents}
          onClose={() => {
            setIsHistoryOpen(false)
          }}
        />
      ) : null}

      {!isStaging && isRulesOpen ? (
        <RulesOverlay
          onClose={() => {
            setIsRulesOpen(false)
          }}
          rules={G.rules}
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

      {/*
        * Staging keeps its header. The live match does not: everything below moved into the two
        * pockets of dead space the hand stage already reserved -- under the hand cards, and beside
        * the turn heading -- because a full-width header of its own was what pushed the table past
        * the viewport and put a scrollbar on the page.
        */}
      {isStaging ? (
        <div className="board-hero">
          <div className="board-hero-copy-wrap">
            <div className="header-title-with-info">
              <h2>Room staging</h2>
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
            <span className={`status-pill ${isConnected ? 'online' : 'offline'}`}>
              {isConnected ? 'Socket Connected' : 'Socket Reconnecting'}
            </span>
            <span className={`status-pill ${serverState}`}>{serverStatusLabel}</span>
            <button
              className="secondary-button toolbar-button leave-room-button"
              disabled={isLeaving}
              onClick={onLeaveRoom}
              type="button"
            >
              <span
                  aria-hidden="true"
                  className="toolbar-button-icon"
                  style={{ '--toolbar-icon-sprite': `url(${LEAVE_ROOM_ICON_SPRITE})` } as CSSProperties}
                />
              {isLeaving ? 'Leaving Room...' : 'Leave Room'}
            </button>
          </div>
        </div>
      ) : null}

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
        emotesBySeatID={activeEmotesBySeatID}
        accusedCheatSeatID={accusedCheatSeatID}
        focusedSeatID={focusedSeatID}
        bsTargetMarkDelayMs={bsTargetMarkDelayMs}
        bsTargetSeatID={bsTargetMarkSeatID}
        bsVerdictIsHonest={bsVerdictIsHonest}
        bsVerdictSeatID={bsVerdictSeatID}
        calloutTextBySeatID={calloutTextBySeatID}
        showdownHandLabelBySeatID={showdownHandLabelBySeatID}
        showdownLoserSeatIDSet={showdownLoserSeatIDSet}
        directionFlipTellSeatID={directionFlipTellSeatID}
        enteringCardIDSet={enteringFrontCardIDSet}
        pointsFlashDirectionBySeatID={pointsFlashDirectionBySeatID}
        getSeatLabel={getSeatLabel}
        onCatHideCard={handleCatHideCard}
        onEmoteAnimationEnd={handleEmoteAnimationEnd}
        onOpenCharacterCard={handleOpenCharacterCard}
        onRevealCard={handleRevealCard}
        onSelectSeat={handleSeatSelect}
        onTakeBackCard={handleTakeBackCard}
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
            ? isCat && isCurrentPlayersTurn
              ? 'Use The Cat to flip the turn direction. Your block gives a nod as you do.'
              : "Change the direction, on anyone's turn. Your block gives a nod as you do, and Accuse can catch it until that turn ends."
            : undefined}
          frontCardsTooltip={frontCardsColumnTooltip}
          maxCardsOnTable={maxCardsOnTable}
          onToggleDirection={handleToggleDirection}
          totalCardsOnTable={totalCardsOnTable}
          trumpLabel={displayedTrumpLabel}
          trumpRank={displayedTrumpRank}
        />
      </PlayerRing>

      <section className={`bottom-play-strip${isEmotePickerOpen ? ' emote-picker-open' : ''}`}>
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

            {/*
              * The one time the strip is not the viewer's own hand, so it says whose it is. Sitting
              * inside the viewport rather than over the cards, because it has to stay readable while
              * the row scrolls and nothing about a borrowed hand should be hidden by its own label.
              */}
            {openConspiracy ? (
              <p className="conspiracy-banner">
                <span className="conspiracy-banner-mark">Conspiring</span>
                {`${conspireTargetLabel}'s hand. Play out of it to end your turn.`}
              </p>
            ) : null}

            <div className={`hand-scroll-row${openConspiracy ? ' conspired' : ''}`} ref={handScrollRowRef}>
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

            {/*
              * The old board hero's identity half, in the strip the hand cards leave empty beneath
              * them. Room title, room code, and the two connection pills are all glanceable state
              * that nobody acts on mid-turn, so they belong under the cards rather than beside the
              * buttons.
              */}
            <div className="hand-meta-row">
              <div className="header-title-with-info hand-meta-title">
                <h2>Live match</h2>
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

              <span className={`status-pill ${isConnected ? 'online' : 'offline'}`}>
                {isConnected ? 'Socket Connected' : 'Socket Reconnecting'}
              </span>
              <span className={`status-pill ${serverState}`}>{serverStatusLabel}</span>
            </div>
          </div>

          <div className="hand-action-row">
            {/*
              * The heading shares its line with the panel toggles and Leave Room, which is what
              * the line was already tall enough for. Rules comes first: reference material a player
              * reaches for at any time, unlike the match-specific log beside it.
              */}
            <div className="hand-action-top">
              <div className="hand-action-toolbar">
                <div className="emote-picker-anchor">
                  <button
                    aria-expanded={isEmotePickerOpen}
                    aria-haspopup="dialog"
                    className={`subtle-button toolbar-button emote-toggle ${isEmotePickerOpen ? 'active' : ''}`}
                    disabled={!canEmote}
                    onClick={() => {
                      setIsEmotePickerOpen((previousValue) => !previousValue)
                    }}
                    title={canEmote ? 'Choose an emote' : 'Only active players can emote.'}
                    type="button"
                  >
                    {EMOTE_SPRITES[0] ? <img alt="" aria-hidden="true" className="emote-toggle-icon" src={EMOTE_SPRITES[0].url} /> : null}
                    Emote
                  </button>

                  {isEmotePickerOpen ? (
                    <div aria-label="Choose an emote" className="emote-picker" role="dialog">
                      {EMOTE_SPRITES.map((emote) => (
                        <button
                          aria-label={`Send emote ${emote.id}`}
                          className="emote-picker-option"
                          key={emote.id}
                          onClick={() => {
                            handleEmote(emote.id)
                          }}
                          type="button"
                        >
                          <img alt="" src={emote.url} />
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>

                <button
                  aria-expanded={isRulesOpen}
                  aria-haspopup="dialog"
                  className={`subtle-button toolbar-button rules-toggle ${isRulesOpen ? 'active' : ''}`}
                  onClick={() => {
                    setIsRulesOpen((previousValue) => !previousValue)
                    setIsHistoryOpen(false)
                  }}
                  type="button"
                >
                  <span
                    aria-hidden="true"
                    className="toolbar-button-icon"
                    style={{ '--toolbar-icon-sprite': `url(${RULES_ICON_SPRITE})` } as CSSProperties}
                  />
                  Rules
                </button>

                <button
                  aria-expanded={isHistoryOpen}
                  aria-haspopup="dialog"
                  className={`subtle-button toolbar-button history-toggle ${isHistoryOpen ? 'active' : ''}`}
                  onClick={() => {
                    setIsHistoryOpen((previousValue) => !previousValue)
                    setIsRulesOpen(false)
                  }}
                  type="button"
                >
                  <span
                    aria-hidden="true"
                    className="toolbar-button-icon"
                    style={{ '--toolbar-icon-sprite': `url(${HISTORY_ICON_SPRITE})` } as CSSProperties}
                  />
                  History
                  <span className="history-count-pill">{historyEvents.length}</span>
                </button>

                <button
                  className="secondary-button toolbar-button leave-room-button"
                  disabled={isLeaving}
                  onClick={onLeaveRoom}
                  type="button"
                >
                  <span
                  aria-hidden="true"
                  className="toolbar-button-icon"
                  style={{ '--toolbar-icon-sprite': `url(${LEAVE_ROOM_ICON_SPRITE})` } as CSSProperties}
                />
                  {isLeaving ? 'Leaving Room...' : 'Leave Room'}
                </button>
              </div>

              <p className="hand-action-heading">{handActionHeading}</p>
            </div>

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
