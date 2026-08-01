import {
  BLOW_COW_IMPLEMENTED_CHARACTER_NAMES,
  assignRandomImplementedCharacters,
  isImplementedCharacterName,
  type BlowCowCharacterName,
  type BlowCowImplementedCharacterName,
} from './blowCowCharacters.ts'

export const BLOW_COW_GAME_NAME = 'blow-cow'
export const BLOW_COW_MIN_PLAYERS = 2
export const BLOW_COW_MAX_PLAYERS = 8
export const INITIAL_TABLE_STATUS = 'Waiting for everyone to sit down before the bluffing starts.'
export const CARD_BACK_SPRITE = 'back01.png'
export const DEFAULT_BLOW_COW_SPEED_MULTIPLIER = 1 as const
export const BLOW_COW_SPEED_MULTIPLIERS = [0.5, DEFAULT_BLOW_COW_SPEED_MULTIPLIER, 2] as const
const INVALID_MOVE = 'INVALID_MOVE' as const

export const BLOW_COW_RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const
export const BLOW_COW_SUITS = ['clubs', 'diamonds', 'hearts', 'spades'] as const
export const BLOW_COW_DIRECTIONS = ['clockwise', 'counterclockwise'] as const

export type BlowCowRank = (typeof BLOW_COW_RANKS)[number]
export type BlowCowSpeedMultiplier = (typeof BLOW_COW_SPEED_MULTIPLIERS)[number]
export type BlowCowSuit = (typeof BLOW_COW_SUITS)[number]
export type BlowCowDirection = (typeof BLOW_COW_DIRECTIONS)[number]
export type BlowCowCardRank = BlowCowRank | 'Joker'
export type BlowCowCardSuit = BlowCowSuit | 'joker'
export type BlowCowGameStatus = 'staging' | 'active' | 'finished'
export type BlowCowRoundStatus = 'awaitingTrumpSelection' | 'inProgress' | 'betweenRounds'
export type BlowCowHistoryEventKind = 'system' | 'action' | 'verdict' | 'punishment' | 'point' | 'leave'
export type BlowCowTelemetryEventKind = BlowCowHistoryEventKind | 'turn' | 'game'
export type BlowCowCardGainSource = 'initialDeal' | 'punishment' | 'reset' | 'roundReturn' | 'other'
export type BlowCowRankSelectionMode = 'default' | 'manual'

export type BlowCowCard = {
  id: string
  rank: BlowCowCardRank
  suit: BlowCowCardSuit
  sprite: string
  deckOrder: number
}

export type BlowCowScoredSet = {
  id: string
  rank: BlowCowRank
  cards: BlowCowCard[]
  awardedAtRound: number
  awardedAtTurn: number
  source: BlowCowCardGainSource
}

export type BlowCowTablePlay = {
  id: string
  playerID: string
  cards: BlowCowCard[]
  declaredCardCount?: number
  usedDreamerDirectionChange?: boolean
  revealedCardIDs?: string[]
  rehiddenCardIDs?: string[]
  claimedRank: BlowCowRank
  playedAtRound: number
  playedAtTurn: number
  revealedAtTurn: number | null
  wasTrumpSelection: boolean
}

export type BlowCowPlayerState = {
  id: string
  seatIndex: number
  character: BlowCowCharacterName | null
  hand: BlowCowCard[]
  points: number
  scoredSets: BlowCowScoredSet[]
  matchStats: BlowCowPlayerMatchStats
  pendingRevealPlayID: string | null
  turnStartingDirection?: BlowCowDirection | null
  hasUsedManualPlay: boolean
  hasUsedGrandmasterBSOverride: boolean
  hasLeft: boolean
  leaveOrder: number | null
}

export type BlowCowPlayerMatchStats = {
  playCount: number
  callBSCount: number
  passCount: number
  resetCount: number
  turnsInGame: number
  lieCount: number
  cardsPlayed: number
  punishmentCount: number
  bsWinCount: number
}

export type BlowCowRoundState = {
  roundNumber: number
  status: BlowCowRoundStatus
  direction: BlowCowDirection
  startingPlayerID: string
  pendingStartingPlayerID: string | null
  trumpRank: BlowCowRank | null
  previousTrumpRank: BlowCowRank | null
  passStreak: number
  lastNonPassingPlayerID: string | null
  maxCardsOnTable: number
}

export type BlowCowTableState = {
  plays: BlowCowTablePlay[]
}

export type BlowCowBSRevealPlay = {
  playID: string
  playerID: string
  cards: BlowCowCard[]
}

export type BlowCowBSResolution = {
  id: string
  callerPlayerID: string
  targetPlayerID: string
  targetPlayID: string
  targetPlayCards: BlowCowCard[]
  targetDeclaredCardCount: number
  additionalRevealPlays: BlowCowBSRevealPlay[]
  trumpRank: BlowCowRank
  targetWasHonest: boolean
  caughtDreamerRepeatTrump: boolean
  caughtDreamerDirectionChange?: boolean
  caughtDreamerExtraCardCount: boolean
  caughtDreamerExceededTableLimit: boolean
  reverseRuleTriggered: boolean
  reverseRuleIgnoredForDreamerCheat?: boolean
  punishedPlayerID: string
  unpunishedPlayerID: string
  punishmentCardCount: number
}

export type BlowCowTableReturnResolutionKind = 'reset' | 'roundReturn'

export type BlowCowResetResolution = {
  id: string
  callerPlayerID: string
  kind: BlowCowTableReturnResolutionKind
}

export type BlowCowHistoryEvent = {
  id: string
  kind: BlowCowHistoryEventKind
  playerID: string | null
  title: string
  detail: string
  roundNumber: number
  turnNumber: number
}

export type BlowCowTelemetryEvent = {
  id: string
  kind: BlowCowTelemetryEventKind
  playerID: string | null
  title: string
  detail: string
  roundNumber: number
  turnNumber: number
  handCountsByPlayer: Record<string, number>
}

export type BlowCowTelemetryState = {
  events: BlowCowTelemetryEvent[]
}

export type BlowCowArchiveInitialPlayerState = {
  playerID: string
  seatIndex: number
  character: BlowCowCharacterName | null
  hand: BlowCowCard[]
  points: number
  scoredSets: BlowCowScoredSet[]
}

export type BlowCowArchiveInitialState = {
  playerOrder: string[]
  playerCount: number
  startingPlayerID: string
  direction: BlowCowDirection
  deckConfig: BlowCowDeckConfig
  speedMultiplier: BlowCowSpeedMultiplier
  useCharacters: boolean
  characterPool: BlowCowImplementedCharacterName[]
  players: Record<string, BlowCowArchiveInitialPlayerState>
}

export type BlowCowArchiveTurnActionKind =
  | 'revealPendingPlay'
  | 'toggleDirection'
  | 'hideTableCard'
  | 'gainOutsideCard'
  | 'play'
  | 'pass'
  | 'callBS'
  | 'resolveBS'
  | 'callReset'
  | 'resolveReset'
  | 'roundReturn'
  | 'leave'

export type BlowCowArchiveTurnAction = {
  kind: BlowCowArchiveTurnActionKind
  playerID: string | null
  detail: string
  characterUsed: BlowCowCharacterName | null
  targetPlayerID: string | null
  revealedPlayerID: string | null
  cards: BlowCowCard[]
  cardsByPlayer: Record<string, BlowCowCard[]> | null
  declaredCardCount: number | null
  claimedRank: BlowCowRank | null
  wasHonest: boolean | null
  punishedPlayerID: string | null
  unpunishedPlayerID: string | null
  resetKind: BlowCowTableReturnResolutionKind | null
  additionalRevealPlays: BlowCowBSRevealPlay[] | null
  passStreak: number | null
  endedRound: boolean | null
  usedGrandmasterBSOverride: boolean | null
  usedPawnEnPassant: boolean | null
  pawnTriggerPlayerID: string | null
  playMode: 'manual' | 'random' | null
  directionBefore: BlowCowDirection | null
  directionAfter: BlowCowDirection | null
  remainingHiddenCardCount: number | null
  leaveOrder: number | null
}

export type BlowCowArchiveTurn = {
  turnNumber: number
  roundNumber: number
  playerID: string
  tableCardCountAtStart: number
  handCountAtStart: number
  trumpRankAtStart: BlowCowRank | null
  directionAtStart: BlowCowDirection
  maxCardsOnTableAtStart: number
  actions: BlowCowArchiveTurnAction[]
}

export type BlowCowArchiveState = {
  initial: BlowCowArchiveInitialState | null
  turns: BlowCowArchiveTurn[]
}

export type BlowCowDeckConfig = {
  rankSelectionMode: BlowCowRankSelectionMode
  selectedRanks: BlowCowRank[]
  includesJokers: true
  defaultRankCount: number
}

export type BlowCowSetupData = {
  rankSelectionMode?: BlowCowRankSelectionMode
  selectedRanks?: BlowCowRank[]
  speedMultiplier?: BlowCowSpeedMultiplier
  useCharacters?: boolean
  characterPool?: BlowCowImplementedCharacterName[]
}

export type BlowCowState = {
  tableStatus: string
  gameStatus: BlowCowGameStatus
  hostPlayerID: string
  deckConfig: BlowCowDeckConfig
  speedMultiplier: BlowCowSpeedMultiplier
  useCharacters: boolean
  characterPool: BlowCowImplementedCharacterName[]
  seatOrder: string[]
  players: Record<string, BlowCowPlayerState>
  round: BlowCowRoundState
  table: BlowCowTableState
  bsResolution: BlowCowBSResolution | null
  resetResolution: BlowCowResetResolution | null
  history: BlowCowHistoryEvent[]
  telemetry: BlowCowTelemetryState
  archive: BlowCowArchiveState
  placements: string[]
}

export type BlowCowSelectTrumpAndPlayArgs = {
  trumpRank: BlowCowRank
  cardIDs: string[]
}

export type BlowCowPlayArgs = {
  cardIDs: string[]
}

export type BlowCowPlayRandomArgs = {
  cardCount: number
  trumpRank?: BlowCowRank | null
}

export type BlowCowPassArgs = {
  foreignerCardCode?: string | null
}

export type BlowCowCallBSArgs = {
  targetPlayerID?: string | null
}

export type BlowCowCatHideCardArgs = {
  cardID: string
}

export type BlowCowFinalizeBSResolutionArgs = {
  resolutionID: string
}

export type BlowCowFinalizeResetResolutionArgs = {
  resolutionID: string
}

export type BlowCowGameOver = {
  placements: string[]
  winnerID: string
  pointsByPlayer: Record<string, number>
}

type BlowCowShuffle = <Value>(values: Value[]) => Value[]

type BlowCowSetupContext = {
  ctx: {
    numPlayers: number
  }
  random?: {
    Shuffle?: BlowCowShuffle
  }
}

type BlowCowRuntimeCtx = {
  currentPlayer: string
  turn: number
}

type BlowCowEventsAPI = {
  endTurn: (arg?: { next: string }) => void
  endGame: (gameover?: BlowCowGameOver) => void
}

type BlowCowHookContext = {
  G: BlowCowState
  ctx: BlowCowRuntimeCtx
  events: BlowCowEventsAPI
  random?: {
    Shuffle?: BlowCowShuffle
  }
}

type BlowCowMoveContext = BlowCowHookContext & {
  playerID: string
}

type BlowCowScoreHandResult = {
  remainingHand: BlowCowCard[]
  scoredSets: BlowCowScoredSet[]
  pointsAwarded: number
}

const SUIT_SORT_INDEX: Record<BlowCowCardSuit, number> = {
  clubs: 0,
  diamonds: 1,
  hearts: 2,
  spades: 3,
  joker: 4,
}

const RANK_SORT_INDEX: Record<BlowCowCardRank, number> = {
  A: 0,
  '2': 1,
  '3': 2,
  '4': 3,
  '5': 4,
  '6': 5,
  '7': 6,
  '8': 7,
  '9': 8,
  '10': 9,
  J: 10,
  Q: 11,
  K: 12,
  Joker: 13,
}

const RANK_TO_SPRITE_SEGMENT: Record<BlowCowRank, string> = {
  A: 'ace',
  '2': '02',
  '3': '03',
  '4': '04',
  '5': '05',
  '6': '06',
  '7': '07',
  '8': '08',
  '9': '09',
  '10': '10',
  J: 'jack',
  Q: 'queen',
  K: 'king',
}

function getCardSpriteFilename(suit: BlowCowSuit, rank: BlowCowRank) {
  return `${suit}_${RANK_TO_SPRITE_SEGMENT[rank]}.png`
}

function isBlowCowRank(value: unknown): value is BlowCowRank {
  return typeof value === 'string' && (BLOW_COW_RANKS as readonly string[]).includes(value)
}

function isBlowCowSuit(value: unknown): value is BlowCowSuit {
  return typeof value === 'string' && (BLOW_COW_SUITS as readonly string[]).includes(value)
}

function isBlowCowSpeedMultiplier(value: unknown): value is BlowCowSpeedMultiplier {
  return typeof value === 'number'
    && (BLOW_COW_SPEED_MULTIPLIERS as readonly number[]).includes(value)
}

function sortRanks(ranks: BlowCowRank[]) {
  return [...ranks].sort((leftRank, rightRank) => RANK_SORT_INDEX[leftRank] - RANK_SORT_INDEX[rightRank])
}

function normalizeSelectedRanks(selectedRanks: readonly BlowCowRank[] | undefined) {
  if (!selectedRanks) {
    return [] as BlowCowRank[]
  }

  return sortRanks(
    [...new Set(selectedRanks)].filter((rank): rank is BlowCowRank => isBlowCowRank(rank)),
  )
}

function createSeatOrder(numPlayers: number) {
  return Array.from({ length: numPlayers }, (_, seatIndex) => String(seatIndex))
}

function shuffleCards<Value>(values: Value[], shuffle?: BlowCowShuffle) {
  return shuffle ? shuffle(values) : [...values]
}

function toggleDirection(direction: BlowCowDirection): BlowCowDirection {
  return direction === 'counterclockwise' ? 'clockwise' : 'counterclockwise'
}

function formatSeatLabel(seatIndex: number | null | undefined, playerID?: string) {
  if (seatIndex !== undefined && seatIndex !== null && !Number.isNaN(seatIndex)) {
    return `Seat ${seatIndex + 1}`
  }

  return playerID ? `Player ${playerID}` : 'Unknown seat'
}

function formatPlayerLabel(stateOrPlayerID: Pick<BlowCowState, 'players'> | string, playerID?: string) {
  if (typeof stateOrPlayerID === 'string') {
    const seatIndex = Number.parseInt(stateOrPlayerID, 10)
    return formatSeatLabel(Number.isNaN(seatIndex) ? null : seatIndex, stateOrPlayerID)
  }

  const resolvedPlayerID = playerID ?? ''
  return formatSeatLabel(stateOrPlayerID.players[resolvedPlayerID]?.seatIndex, resolvedPlayerID)
}

function formatCardLabel(card: BlowCowCard) {
  if (card.rank === 'Joker') {
    return 'Joker'
  }

  return `${card.rank} of ${card.suit[0].toUpperCase()}${card.suit.slice(1)}`
}

type BlowCowGeneratedCardSpec = Pick<BlowCowCard, 'rank' | 'suit' | 'sprite'>

function parseForeignerCardCode(cardCode: string | null | undefined) {
  if (!cardCode || cardCode === 'none') {
    return {
      isValid: true,
      cardSpec: null,
    } as const
  }

  if (cardCode === 'joker') {
    return {
      isValid: true,
      cardSpec: {
        rank: 'Joker',
        suit: 'joker',
        sprite: 'Joker1.png',
      } satisfies BlowCowGeneratedCardSpec,
    } as const
  }

  const [rankValue, suitValue, ...rest] = cardCode.split(':')
  if (rest.length > 0 || !isBlowCowRank(rankValue) || !isBlowCowSuit(suitValue)) {
    return {
      isValid: false,
      cardSpec: null,
    } as const
  }

  return {
    isValid: true,
    cardSpec: {
      rank: rankValue,
      suit: suitValue,
      sprite: getCardSpriteFilename(suitValue, rankValue),
    } satisfies BlowCowGeneratedCardSpec,
  } as const
}

function createForeignerOutsideCard(playerID: string, turnNumber: number, cardSpec: BlowCowGeneratedCardSpec) {
  return {
    id: `outside-${playerID}-${turnNumber}-${cardSpec.rank}-${cardSpec.suit}`,
    rank: cardSpec.rank,
    suit: cardSpec.suit,
    sprite: cardSpec.sprite,
    deckOrder: -1,
  } satisfies BlowCowCard
}

function createHiddenCard(card: BlowCowCard): BlowCowCard {
  return {
    ...card,
    rank: 'Joker',
    suit: 'joker',
    sprite: CARD_BACK_SPRITE,
  }
}

function createHistoryEvent(
  state: BlowCowState,
  kind: BlowCowHistoryEventKind,
  title: string,
  detail: string,
  playerID: string | null,
  turnNumber: number,
) {
  return {
    id: `history-${state.round.roundNumber}-${turnNumber}-${state.history.length}`,
    kind,
    playerID,
    title,
    detail,
    roundNumber: state.round.roundNumber,
    turnNumber,
  } satisfies BlowCowHistoryEvent
}

function createTelemetryEvent(
  state: BlowCowState,
  kind: BlowCowTelemetryEventKind,
  title: string,
  detail: string,
  playerID: string | null,
  turnNumber: number,
) {
  return {
    id: `telemetry-${state.round.roundNumber}-${turnNumber}-${state.telemetry.events.length}`,
    kind,
    playerID,
    title,
    detail,
    roundNumber: state.round.roundNumber,
    turnNumber,
    handCountsByPlayer: Object.fromEntries(
      Object.entries(state.players).map(([targetPlayerID, player]) => [targetPlayerID, player.hand.length]),
    ),
  } satisfies BlowCowTelemetryEvent
}

function appendTelemetryEvent(
  state: BlowCowState,
  kind: BlowCowTelemetryEventKind,
  title: string,
  detail: string,
  playerID: string | null,
  turnNumber: number,
) {
  state.telemetry.events.push(createTelemetryEvent(state, kind, title, detail, playerID, turnNumber))
}

function appendHistoryEvent(
  state: BlowCowState,
  kind: BlowCowHistoryEventKind,
  title: string,
  detail: string,
  playerID: string | null,
  turnNumber: number,
) {
  state.history.push(createHistoryEvent(state, kind, title, detail, playerID, turnNumber))
  appendTelemetryEvent(state, kind, title, detail, playerID, turnNumber)
}

function appendPointHistoryEvents(
  state: BlowCowState,
  playerID: string,
  scoredSets: BlowCowScoredSet[],
  turnNumber: number,
) {
  for (const scoredSet of scoredSets) {
    appendHistoryEvent(
      state,
      'point',
      `${formatPlayerLabel(state, playerID)} gained 1 point`,
      `Removed four ${scoredSet.rank}s from hand.`,
      playerID,
      turnNumber,
    )
  }
}

function getPlayerState(state: BlowCowState, playerID: string) {
  return state.players[playerID]
}

function cloneCard(card: BlowCowCard): BlowCowCard {
  return { ...card }
}

function cloneCards(cards: BlowCowCard[]) {
  return cards.map((card) => cloneCard(card))
}

function cloneScoredSet(scoredSet: BlowCowScoredSet): BlowCowScoredSet {
  return {
    ...scoredSet,
    cards: cloneCards(scoredSet.cards),
  }
}

function cloneScoredSets(scoredSets: BlowCowScoredSet[]) {
  return scoredSets.map((scoredSet) => cloneScoredSet(scoredSet))
}

function cloneBSRevealPlays(revealPlays: BlowCowBSRevealPlay[]) {
  return revealPlays.map((revealPlay) => ({
    ...revealPlay,
    cards: cloneCards(revealPlay.cards),
  }))
}

function cloneCardsByPlayer(cardsByPlayer: Record<string, BlowCowCard[]>) {
  return Object.fromEntries(
    Object.entries(cardsByPlayer).map(([playerID, cards]) => [playerID, cloneCards(cards)]),
  ) as Record<string, BlowCowCard[]>
}

function createCardsByPlayerRecord(entries: Iterable<[string, BlowCowCard[]]>) {
  return Object.fromEntries(
    Array.from(entries, ([playerID, cards]) => [playerID, cloneCards(cards)]),
  ) as Record<string, BlowCowCard[]>
}

function createEmptyArchiveState(): BlowCowArchiveState {
  return {
    initial: null,
    turns: [],
  }
}

function createInitialArchiveState(state: BlowCowState): BlowCowArchiveInitialState {
  return {
    playerOrder: [...state.seatOrder],
    playerCount: state.seatOrder.length,
    startingPlayerID: state.round.startingPlayerID,
    direction: state.round.direction,
    deckConfig: {
      ...state.deckConfig,
      selectedRanks: [...state.deckConfig.selectedRanks],
    },
    speedMultiplier: state.speedMultiplier,
    useCharacters: state.useCharacters,
    characterPool: [...state.characterPool],
    players: Object.fromEntries(
      Object.entries(state.players).map(([playerID, player]) => [
        playerID,
        {
          playerID,
          seatIndex: player.seatIndex,
          character: player.character,
          hand: cloneCards(player.hand),
          points: player.points,
          scoredSets: cloneScoredSets(player.scoredSets),
        },
      ]),
    ) as Record<string, BlowCowArchiveInitialPlayerState>,
  }
}

function findArchiveTurn(state: BlowCowState, playerID: string, turnNumber: number) {
  for (let turnIndex = state.archive.turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const archivedTurn = state.archive.turns[turnIndex]
    if (archivedTurn.turnNumber === turnNumber && archivedTurn.playerID === playerID) {
      return archivedTurn
    }
  }

  return null
}

function ensureArchiveTurn(state: BlowCowState, playerID: string, turnNumber: number) {
  const existingTurn = findArchiveTurn(state, playerID, turnNumber)
  if (existingTurn) {
    return existingTurn
  }

  const archivedTurn = {
    turnNumber,
    roundNumber: state.round.roundNumber,
    playerID,
    tableCardCountAtStart: getTableCardCount(state.table),
    handCountAtStart: state.players[playerID]?.hand.length ?? 0,
    trumpRankAtStart: state.round.trumpRank,
    directionAtStart: state.round.direction,
    maxCardsOnTableAtStart: state.round.maxCardsOnTable,
    actions: [],
  } satisfies BlowCowArchiveTurn

  state.archive.turns.push(archivedTurn)
  return archivedTurn
}

type BlowCowArchiveTurnActionInput = Pick<BlowCowArchiveTurnAction, 'kind' | 'detail'>
  & Partial<Omit<BlowCowArchiveTurnAction, 'kind' | 'detail' | 'playerID'>>

function appendArchiveTurnAction(
  state: BlowCowState,
  playerID: string,
  turnNumber: number,
  action: BlowCowArchiveTurnActionInput,
) {
  const archivedTurn = ensureArchiveTurn(state, playerID, turnNumber)

  archivedTurn.actions.push({
    kind: action.kind,
    playerID,
    detail: action.detail,
    characterUsed: action.characterUsed ?? null,
    targetPlayerID: action.targetPlayerID ?? null,
    revealedPlayerID: action.revealedPlayerID ?? null,
    cards: action.cards ? cloneCards(action.cards) : [],
    cardsByPlayer: action.cardsByPlayer ? cloneCardsByPlayer(action.cardsByPlayer) : null,
    declaredCardCount: action.declaredCardCount ?? null,
    claimedRank: action.claimedRank ?? null,
    wasHonest: action.wasHonest ?? null,
    punishedPlayerID: action.punishedPlayerID ?? null,
    unpunishedPlayerID: action.unpunishedPlayerID ?? null,
    resetKind: action.resetKind ?? null,
    additionalRevealPlays: action.additionalRevealPlays ? cloneBSRevealPlays(action.additionalRevealPlays) : null,
    passStreak: action.passStreak ?? null,
    endedRound: action.endedRound ?? null,
    usedGrandmasterBSOverride: action.usedGrandmasterBSOverride ?? null,
    usedPawnEnPassant: action.usedPawnEnPassant ?? null,
    pawnTriggerPlayerID: action.pawnTriggerPlayerID ?? null,
    playMode: action.playMode ?? null,
    directionBefore: action.directionBefore ?? null,
    directionAfter: action.directionAfter ?? null,
    remainingHiddenCardCount: action.remainingHiddenCardCount ?? null,
    leaveOrder: action.leaveOrder ?? null,
  })
}

function createInitialPlayerMatchStats(): BlowCowPlayerMatchStats {
  return {
    playCount: 0,
    callBSCount: 0,
    passCount: 0,
    resetCount: 0,
    turnsInGame: 0,
    lieCount: 0,
    cardsPlayed: 0,
    punishmentCount: 0,
    bsWinCount: 0,
  }
}

function createEmptyPlayerState(playerID: string, seatIndex: number): BlowCowPlayerState {
  return {
    id: playerID,
    seatIndex,
    character: null,
    hand: [],
    points: 0,
    scoredSets: [],
    matchStats: createInitialPlayerMatchStats(),
    pendingRevealPlayID: null,
    turnStartingDirection: null,
    hasUsedManualPlay: false,
    hasUsedGrandmasterBSOverride: false,
    hasLeft: false,
    leaveOrder: null,
  }
}

function getRevealedCardIDSet(play: BlowCowTablePlay) {
  return new Set(play.revealedCardIDs ?? [])
}

function getRehiddenCardIDSet(play: BlowCowTablePlay) {
  return new Set(play.rehiddenCardIDs ?? [])
}

function isCardFaceUpOnTable(play: BlowCowTablePlay, cardID: string) {
  return (play.revealedAtTurn !== null || getRevealedCardIDSet(play).has(cardID))
    && !getRehiddenCardIDSet(play).has(cardID)
}

function getHiddenCardsForPlay(play: BlowCowTablePlay) {
  if (play.revealedAtTurn !== null) {
    return [] as BlowCowCard[]
  }

  const revealedCardIDSet = getRevealedCardIDSet(play)
  return play.cards.filter((card) => !revealedCardIDSet.has(card.id))
}

function playHasHiddenCards(play: BlowCowTablePlay) {
  return getHiddenCardsForPlay(play).length > 0
}

function getPendingRevealPlay(state: BlowCowState, playerID: string) {
  const pendingRevealPlayID = state.players[playerID]?.pendingRevealPlayID
  if (!pendingRevealPlayID) {
    return null
  }

  return state.table.plays.find((play) => play.id === pendingRevealPlayID) ?? null
}

function getPendingPlay(state: BlowCowState, playerID: string) {
  const pendingRevealPlay = getPendingRevealPlay(state, playerID)
  if (pendingRevealPlay && playHasHiddenCards(pendingRevealPlay)) {
    return pendingRevealPlay
  }

  for (let playIndex = state.table.plays.length - 1; playIndex >= 0; playIndex -= 1) {
    const play = state.table.plays[playIndex]
    if (play.playerID === playerID && playHasHiddenCards(play)) {
      return play
    }
  }

  return null
}

function clearPendingRevealIDs(state: BlowCowState) {
  for (const player of Object.values(state.players)) {
    player.pendingRevealPlayID = null
  }
}

function getAllTableCards(state: BlowCowState) {
  return state.table.plays.flatMap((play) => play.cards)
}

function collectTableCardsByOwner(state: BlowCowState) {
  const cardsByOwner = new Map<string, BlowCowCard[]>()

  for (const play of state.table.plays) {
    const existingCards = cardsByOwner.get(play.playerID) ?? []
    existingCards.push(...play.cards)
    cardsByOwner.set(play.playerID, existingCards)
  }

  return cardsByOwner
}

export function getMaxCardsOnTable(playerCount: number) {
  if (playerCount <= 2) {
    return 10
  }

  if (playerCount <= 4) {
    return 12
  }

  if (playerCount === 5) {
    return 15
  }

  if (playerCount === 6) {
    return 12
  }

  if (playerCount === 7) {
    return 14
  }

  return 16
}

export function getDefaultStandardRankCount(playerCount: number) {
  if (playerCount <= 2) {
    return 4
  }

  if (playerCount === 3) {
    return 6
  }

  if (playerCount === 4) {
    return 9
  }

  if (playerCount === 5) {
    return 11
  }

  return BLOW_COW_RANKS.length
}

function getDefaultSelectedRanks(
  numPlayers: number,
  shuffle?: BlowCowShuffle,
  requiredRanks: readonly BlowCowRank[] = [],
) {
  const defaultRankCount = getDefaultStandardRankCount(numPlayers)

  if (defaultRankCount >= BLOW_COW_RANKS.length) {
    return [...BLOW_COW_RANKS]
  }

  const requiredRankSet = new Set(requiredRanks)
  const lockedRanks = BLOW_COW_RANKS.filter((rank) => requiredRankSet.has(rank))
  const availableRanks = BLOW_COW_RANKS.filter((rank) => !requiredRankSet.has(rank))
  const shuffledRanks = shuffle ? shuffle([...availableRanks]) : [...availableRanks]

  return sortRanks([
    ...lockedRanks,
    ...shuffledRanks.slice(0, Math.max(0, defaultRankCount - lockedRanks.length)),
  ])
}

function normalizeCharacterPoolSelection(characterPool: BlowCowSetupData['characterPool']) {
  if (!Array.isArray(characterPool)) {
    return []
  }

  const requestedCharacterNames = new Set(characterPool.filter(isImplementedCharacterName))

  return BLOW_COW_IMPLEMENTED_CHARACTER_NAMES.filter((characterName) => requestedCharacterNames.has(characterName))
}

function resolveDeckConfig(
  numPlayers: number,
  setupData: BlowCowSetupData | undefined,
  shuffle?: BlowCowShuffle,
): BlowCowDeckConfig {
  const defaultRankCount = getDefaultStandardRankCount(numPlayers)
  const selectedCharacterPool = normalizeCharacterPoolSelection(setupData?.characterPool)

  if (setupData?.rankSelectionMode === 'manual') {
    const selectedRanks = normalizeSelectedRanks(setupData.selectedRanks)

    if (selectedRanks.length >= 2) {
      return {
        rankSelectionMode: 'manual',
        selectedRanks,
        includesJokers: true,
        defaultRankCount,
      }
    }
  }

  return {
    rankSelectionMode: 'default',
    selectedRanks: getDefaultSelectedRanks(
      numPlayers,
      shuffle,
      selectedCharacterPool.includes('The Confused') ? ['J'] : [],
    ),
    includesJokers: true,
    defaultRankCount,
  }
}

function resolveSpeedMultiplier(setupData: BlowCowSetupData | undefined) {
  return isBlowCowSpeedMultiplier(setupData?.speedMultiplier)
    ? setupData.speedMultiplier
    : DEFAULT_BLOW_COW_SPEED_MULTIPLIER
}

function resolveUseCharacters(setupData: BlowCowSetupData | undefined) {
  return setupData?.useCharacters ?? true
}

function resolveCharacterPool(setupData: BlowCowSetupData | undefined) {
  const selectedCharacterPool = normalizeCharacterPoolSelection(setupData?.characterPool)

  return selectedCharacterPool.length > 0
    ? selectedCharacterPool
    : [...BLOW_COW_IMPLEMENTED_CHARACTER_NAMES]
}

export function validateBlowCowSetupData(setupData: BlowCowSetupData | undefined) {
  if (setupData?.speedMultiplier !== undefined && !isBlowCowSpeedMultiplier(setupData.speedMultiplier)) {
    return 'Choose a valid game speed multiplier.'
  }

  if (setupData?.useCharacters !== undefined && typeof setupData.useCharacters !== 'boolean') {
    return 'Choose whether character cards are enabled.'
  }

  const useCharacters = resolveUseCharacters(setupData)
  if (useCharacters && setupData?.characterPool !== undefined) {
    if (!Array.isArray(setupData.characterPool)) {
      return 'Choose a valid character pool.'
    }

    if (setupData.characterPool.some((characterName) => !isImplementedCharacterName(characterName))) {
      return 'Character pool contains an unknown character.'
    }

    if (new Set(setupData.characterPool).size !== setupData.characterPool.length) {
      return 'Character pool cannot contain duplicate characters.'
    }

    if (setupData.characterPool.length < 1) {
      return 'Select at least 1 character for the character pool.'
    }
  }

  const rankSelectionMode = setupData?.rankSelectionMode ?? 'default'
  if (rankSelectionMode !== 'default' && rankSelectionMode !== 'manual') {
    return 'Choose a valid rank selection mode.'
  }

  if (rankSelectionMode !== 'manual') {
    return undefined
  }

  if (!Array.isArray(setupData?.selectedRanks)) {
    return 'Select at least 2 ranks for a manual deck.'
  }

  if (setupData.selectedRanks.some((rank) => !isBlowCowRank(rank))) {
    return 'Manual rank selection contains an unknown rank.'
  }

  if (new Set(setupData.selectedRanks).size !== setupData.selectedRanks.length) {
    return 'Manual rank selection cannot contain duplicate ranks.'
  }

  if (setupData.selectedRanks.length < 2) {
    return 'Select at least 2 ranks for a manual deck.'
  }

  if (useCharacters && setupData.characterPool?.includes('The Confused') && !setupData.selectedRanks.includes('J')) {
    return 'The Confused requires J to be included in a manual deck.'
  }

  return undefined
}

export function isJokerCard(card: BlowCowCard) {
  return card.rank === 'Joker'
}

function isConfusedWildJack(playerCharacter: BlowCowCharacterName | null | undefined, card: BlowCowCard) {
  return playerCharacter === 'The Confused' && card.rank === 'J'
}

export function isTrumpCard(
  card: BlowCowCard,
  trumpRank: BlowCowRank | null,
  playerCharacter: BlowCowCharacterName | null | undefined = null,
) {
  if (!trumpRank) {
    return false
  }

  return isJokerCard(card) || isConfusedWildJack(playerCharacter, card) || card.rank === trumpRank
}

export function countsTowardReverseRule(
  card: BlowCowCard,
  trumpRank: BlowCowRank | null,
  playerCharacter: BlowCowCharacterName | null | undefined = null,
) {
  return trumpRank !== null && card.rank === trumpRank && !isConfusedWildJack(playerCharacter, card)
}

export function sortCards(cards: BlowCowCard[]) {
  return [...cards].sort((leftCard, rightCard) => {
    return RANK_SORT_INDEX[leftCard.rank] - RANK_SORT_INDEX[rightCard.rank]
      || SUIT_SORT_INDEX[leftCard.suit] - SUIT_SORT_INDEX[rightCard.suit]
      || leftCard.sprite.localeCompare(rightCard.sprite)
      || leftCard.id.localeCompare(rightCard.id)
  })
}

export function createDeck(selectedRanks: readonly BlowCowRank[] = BLOW_COW_RANKS) {
  const deck: BlowCowCard[] = []
  let deckOrder = 0

  for (const suit of BLOW_COW_SUITS) {
    for (const rank of selectedRanks) {
      deck.push({
        id: `card-${deckOrder}`,
        rank,
        suit,
        sprite: getCardSpriteFilename(suit, rank),
        deckOrder,
      })
      deckOrder += 1
    }
  }

  for (let jokerIndex = 1; jokerIndex <= 2; jokerIndex += 1) {
    deck.push({
      id: `card-${deckOrder}`,
      rank: 'Joker',
      suit: 'joker',
      sprite: `Joker${jokerIndex}.png`,
      deckOrder,
    })
    deckOrder += 1
  }

  return deck
}

function dealCards(deck: BlowCowCard[], seatOrder: string[]) {
  const hands = Object.fromEntries(
    seatOrder.map((playerID) => [playerID, [] as BlowCowCard[]]),
  ) as Record<string, BlowCowCard[]>

  deck.forEach((card, cardIndex) => {
    const playerID = seatOrder[cardIndex % seatOrder.length]
    hands[playerID].push(card)
  })

  return hands
}

// Scoring removes each complete four-of-a-kind immediately and can award multiple
// points for the same rank when a player receives 8 or more matching cards.
export function scoreHand(
  hand: BlowCowCard[],
  playerID: string,
  source: BlowCowCardGainSource,
  awardedAtRound: number,
  awardedAtTurn: number,
) {
  const sortedHand = sortCards(hand)
  const cardsByRank = new Map<BlowCowRank, BlowCowCard[]>()

  for (const card of sortedHand) {
    if (card.rank === 'Joker') {
      continue
    }

    const matchingCards = cardsByRank.get(card.rank) ?? []
    matchingCards.push(card)
    cardsByRank.set(card.rank, matchingCards)
  }

  const scoredCardIDs = new Set<string>()
  const scoredSets: BlowCowScoredSet[] = []

  for (const rank of BLOW_COW_RANKS) {
    const matchingCards = cardsByRank.get(rank) ?? []
    const setCount = Math.floor(matchingCards.length / 4)

    for (let setIndex = 0; setIndex < setCount; setIndex += 1) {
      const setCards = matchingCards.slice(setIndex * 4, (setIndex + 1) * 4)
      for (const card of setCards) {
        scoredCardIDs.add(card.id)
      }

      scoredSets.push({
        id: `score-${playerID}-${awardedAtRound}-${awardedAtTurn}-${rank}-${setIndex}`,
        rank,
        cards: setCards,
        awardedAtRound,
        awardedAtTurn,
        source,
      })
    }
  }

  return {
    remainingHand: sortedHand.filter((card) => !scoredCardIDs.has(card.id)),
    scoredSets,
    pointsAwarded: scoredSets.length,
  } satisfies BlowCowScoreHandResult
}

export function getActivePlayerIDs(state: Pick<BlowCowState, 'seatOrder' | 'players'>) {
  return state.seatOrder.filter((playerID) => !state.players[playerID].hasLeft)
}

function getActivePlayerCount(state: Pick<BlowCowState, 'seatOrder' | 'players'>) {
  return getActivePlayerIDs(state).length
}

function getPrivilegedStartingPlayerID(state: Pick<BlowCowState, 'seatOrder' | 'players'>) {
  return getActivePlayerIDs(state).find((playerID) => state.players[playerID].character === 'The Privileged') ?? null
}

function getDefaultStartingPlayerID(
  state: Pick<BlowCowState, 'seatOrder' | 'players'>,
  fallbackPlayerID: string | null | undefined,
) {
  const activePlayerIDs = getActivePlayerIDs(state)

  if (activePlayerIDs.length === 0) {
    return null
  }

  return getPrivilegedStartingPlayerID(state)
    ?? (fallbackPlayerID && activePlayerIDs.includes(fallbackPlayerID) ? fallbackPlayerID : activePlayerIDs[0])
}

export function getNextActivePlayerID(
  currentPlayerID: string,
  seatOrder: string[],
  direction: BlowCowDirection,
  activePlayerIDs = seatOrder,
) {
  if (seatOrder.length === 0 || activePlayerIDs.length === 0) {
    return null
  }

  const currentIndex = seatOrder.indexOf(currentPlayerID)
  if (currentIndex === -1) {
    return null
  }

  const activeSet = new Set(activePlayerIDs)
  const step = direction === 'counterclockwise' ? -1 : 1

  for (let offset = 1; offset <= seatOrder.length; offset += 1) {
    const nextIndex = (currentIndex + step * offset + seatOrder.length) % seatOrder.length
    const nextPlayerID = seatOrder[nextIndex]

    if (activeSet.has(nextPlayerID)) {
      return nextPlayerID
    }
  }

  return null
}

export function getTableCardCount(table: BlowCowTableState) {
  return table.plays.reduce((totalCards, play) => totalCards + play.cards.length, 0)
}

export function getPlayerFrontCards(state: BlowCowState, playerID: string) {
  return state.table.plays
    .filter((play) => play.playerID === playerID)
    .flatMap((play) => play.cards)
}

function updateRoundCapacity(state: BlowCowState) {
  state.round.maxCardsOnTable = getMaxCardsOnTable(getActivePlayerCount(state))
}

function addCardsToPlayerHand(
  state: BlowCowState,
  playerID: string,
  cards: BlowCowCard[],
  source: BlowCowCardGainSource,
  turnNumber: number,
  options: { deferPointHistory?: boolean } = {},
) {
  if (cards.length === 0) {
    return [] as BlowCowScoredSet[]
  }

  const player = getPlayerState(state, playerID)
  const scoredHand = scoreHand(
    [...player.hand, ...cards],
    playerID,
    source,
    state.round.roundNumber,
    turnNumber,
  )

  player.hand = scoredHand.remainingHand
  player.points += scoredHand.pointsAwarded
  player.scoredSets.push(...scoredHand.scoredSets)
  if (!options.deferPointHistory) {
    appendPointHistoryEvents(state, playerID, scoredHand.scoredSets, turnNumber)
  }

  return scoredHand.scoredSets
}

function removeCardsFromPlayerHand(state: BlowCowState, playerID: string, cardIDs: string[]) {
  const uniqueCardIDs = [...new Set(cardIDs)]
  if (uniqueCardIDs.length !== cardIDs.length || uniqueCardIDs.length === 0) {
    return null
  }

  const player = getPlayerState(state, playerID)
  const handByID = new Map(player.hand.map((card) => [card.id, card]))
  const selectedCards = uniqueCardIDs.map((cardID) => handByID.get(cardID))

  if (selectedCards.some((card) => card === undefined)) {
    return null
  }

  const selectedCardIDSet = new Set(uniqueCardIDs)
  player.hand = player.hand.filter((card) => !selectedCardIDSet.has(card.id))

  return selectedCards as BlowCowCard[]
}

function createPlay(
  state: BlowCowState,
  playerID: string,
  cards: BlowCowCard[],
  declaredCardCount: number,
  claimedRank: BlowCowRank,
  turnNumber: number,
  wasTrumpSelection: boolean,
) {
  const playID = `play-${state.round.roundNumber}-${turnNumber}-${playerID}`

  state.table.plays.push({
    id: playID,
    playerID,
    cards,
    declaredCardCount,
    revealedCardIDs: [],
    rehiddenCardIDs: [],
    claimedRank,
    playedAtRound: state.round.roundNumber,
    playedAtTurn: turnNumber,
    revealedAtTurn: null,
    wasTrumpSelection,
  })
  state.players[playerID].pendingRevealPlayID = playID
}

function isDreamer(state: BlowCowState, playerID: string) {
  return state.players[playerID]?.character === 'The Dreamer'
}

function isDrunkard(state: BlowCowState, playerID: string) {
  return state.players[playerID]?.character === 'The Drunkard'
}

function isGrandmaster(state: BlowCowState, playerID: string) {
  return state.players[playerID]?.character === 'The Grandmaster'
}

function isContrarian(state: BlowCowState, playerID: string) {
  return state.players[playerID]?.character === 'The Contrarian'
}

function isPawn(state: BlowCowState, playerID: string) {
  return state.players[playerID]?.character === 'The Pawn'
}

function canUseGrandmasterBSOverride(state: BlowCowState, playerID: string) {
  return isGrandmaster(state, playerID) && !state.players[playerID]?.hasUsedGrandmasterBSOverride
}

function getDreamerDeclaredCardCount(state: BlowCowState, playerID: string, actualCardCount: number) {
  return isDreamer(state, playerID) && actualCardCount > 2 ? 2 : actualCardCount
}

function canDreamerRepeatPreviousTrump(
  state: BlowCowState,
  playerID: string,
  nextTrumpRank: BlowCowRank | null,
) {
  return nextTrumpRank !== null
    && state.round.trumpRank === null
    && state.round.previousTrumpRank !== null
    && state.round.previousTrumpRank === nextTrumpRank
    && isDreamer(state, playerID)
}

function didDreamerRepeatPreviousTrump(state: BlowCowState, play: BlowCowTablePlay) {
  return play.wasTrumpSelection
    && state.round.previousTrumpRank !== null
    && play.claimedRank === state.round.previousTrumpRank
    && isDreamer(state, play.playerID)
}

function didDreamerChangeDirection(state: BlowCowState, play: BlowCowTablePlay) {
  return isDreamer(state, play.playerID) && Boolean(play.usedDreamerDirectionChange)
}

function didDreamerPlayExtraCards(state: BlowCowState, play: BlowCowTablePlay) {
  return isDreamer(state, play.playerID) && play.cards.length > (play.declaredCardCount ?? play.cards.length)
}

function didDreamerExceedTableLimit(state: BlowCowState, play: BlowCowTablePlay) {
  return isDreamer(state, play.playerID) && getTableCardCount(state.table) > state.round.maxCardsOnTable
}

function getDefaultBSTargetPlayerID(state: BlowCowState, currentPlayerID: string) {
  if (state.bsResolution) {
    return null
  }

  const targetPlayerID = state.round.lastNonPassingPlayerID
  if (!state.round.trumpRank || !targetPlayerID || targetPlayerID === currentPlayerID) {
    return null
  }

  const pendingPlay = getPendingPlay(state, targetPlayerID)
  return pendingPlay ? targetPlayerID : null
}

function getPawnEnPassantTargetSelection(
  state: BlowCowState,
  currentPlayerID: string,
) {
  if (!isPawn(state, currentPlayerID) || state.bsResolution || !state.round.trumpRank) {
    return null
  }

  const triggerPlayerID = getDefaultBSTargetPlayerID(state, currentPlayerID)
  if (!triggerPlayerID) {
    return null
  }

  const triggerPlay = getPendingPlay(state, triggerPlayerID)
  if (!triggerPlay || triggerPlay.cards.length !== 2) {
    return null
  }

  const triggerPlayIndex = state.table.plays.findIndex((play) => play.id === triggerPlay.id)
  if (triggerPlayIndex <= 0) {
    return null
  }

  const targetPlay = state.table.plays[triggerPlayIndex - 1]
  if (!playHasHiddenCards(targetPlay) || targetPlay.playerID === currentPlayerID) {
    return null
  }

  const pendingTargetPlay = getPendingPlay(state, targetPlay.playerID)
  if (!pendingTargetPlay || pendingTargetPlay.id !== targetPlay.id) {
    return null
  }

  return {
    triggerPlayerID,
    targetPlayerID: targetPlay.playerID,
    targetPlay: pendingTargetPlay,
  }
}

function resolveBSTargetSelection(
  state: BlowCowState,
  currentPlayerID: string,
  requestedTargetPlayerID?: string | null,
) {
  if (state.bsResolution || !state.round.trumpRank) {
    return null
  }

  const defaultTargetPlayerID = getDefaultBSTargetPlayerID(state, currentPlayerID)
  if (!requestedTargetPlayerID || requestedTargetPlayerID === defaultTargetPlayerID) {
    const defaultTargetPlay = defaultTargetPlayerID ? getPendingPlay(state, defaultTargetPlayerID) : null
    return defaultTargetPlayerID && defaultTargetPlay
      ? {
          targetPlayerID: defaultTargetPlayerID,
          targetPlay: defaultTargetPlay,
          usedGrandmasterBSOverride: false,
          usedPawnEnPassant: false,
          pawnTriggerPlayerID: null,
        }
      : null
  }

  const pawnEnPassantTarget = getPawnEnPassantTargetSelection(state, currentPlayerID)
  if (pawnEnPassantTarget && requestedTargetPlayerID === pawnEnPassantTarget.targetPlayerID) {
    return {
      targetPlayerID: pawnEnPassantTarget.targetPlayerID,
      targetPlay: pawnEnPassantTarget.targetPlay,
      usedGrandmasterBSOverride: false,
      usedPawnEnPassant: true,
      pawnTriggerPlayerID: pawnEnPassantTarget.triggerPlayerID,
    }
  }

  if (requestedTargetPlayerID === currentPlayerID || !canUseGrandmasterBSOverride(state, currentPlayerID)) {
    return null
  }

  const requestedTargetPlay = getPendingPlay(state, requestedTargetPlayerID)
  if (!requestedTargetPlay) {
    return null
  }

  return {
    targetPlayerID: requestedTargetPlayerID,
    targetPlay: requestedTargetPlay,
    usedGrandmasterBSOverride: true,
    usedPawnEnPassant: false,
    pawnTriggerPlayerID: null,
  }
}

function isFinalTwoResolutionTurn(state: BlowCowState, currentPlayerID: string) {
  const activePlayerIDs = getActivePlayerIDs(state)
  if (activePlayerIDs.length !== 2) {
    return false
  }

  const targetPlayerID = getDefaultBSTargetPlayerID(state, currentPlayerID)
  if (!targetPlayerID) {
    return false
  }

  return state.players[targetPlayerID].hand.length === 0
}

function createBSResolution(
  state: BlowCowState,
  callerPlayerID: string,
  targetPlayerID: string,
  targetPlay: BlowCowTablePlay,
  trumpRank: BlowCowRank,
) {
  const caughtDreamerRepeatTrump = didDreamerRepeatPreviousTrump(state, targetPlay)
  const targetCharacter = state.players[targetPlayerID]?.character ?? null
  const caughtDreamerDirectionChange = didDreamerChangeDirection(state, targetPlay)
  const caughtDreamerExtraCardCount = didDreamerPlayExtraCards(state, targetPlay)
  const caughtDreamerExceededTableLimit = didDreamerExceedTableLimit(state, targetPlay)
  const caughtDreamerCheat = caughtDreamerRepeatTrump
    || caughtDreamerDirectionChange
    || caughtDreamerExtraCardCount
    || caughtDreamerExceededTableLimit
  const targetWasHonest = !caughtDreamerRepeatTrump
    && !caughtDreamerDirectionChange
    && !caughtDreamerExtraCardCount
    && !caughtDreamerExceededTableLimit
    && targetPlay.cards.every((card) => isTrumpCard(card, trumpRank, targetCharacter))
  const reverseRuleTriggered = state.table.plays.flatMap((play) => {
    const playCharacter = state.players[play.playerID]?.character ?? null
    return play.cards.filter((card) => countsTowardReverseRule(card, trumpRank, playCharacter))
  }).length >= 4
  const defaultPunishedPlayerID = targetWasHonest ? callerPlayerID : targetPlayerID
  const reverseRuleIgnoredForDreamerCheat = reverseRuleTriggered && caughtDreamerCheat
  const punishedPlayerID = reverseRuleIgnoredForDreamerCheat
    ? targetPlayerID
    : reverseRuleTriggered
    ? (defaultPunishedPlayerID === callerPlayerID ? targetPlayerID : callerPlayerID)
    : defaultPunishedPlayerID
  const unpunishedPlayerID = punishedPlayerID === callerPlayerID ? targetPlayerID : callerPlayerID

  return {
    id: `bs-${state.round.roundNumber}-${targetPlay.playedAtTurn}-${callerPlayerID}`,
    callerPlayerID,
    targetPlayerID,
    targetPlayID: targetPlay.id,
    targetPlayCards: targetPlay.cards,
    targetDeclaredCardCount: targetPlay.declaredCardCount ?? targetPlay.cards.length,
    additionalRevealPlays: state.table.plays
      .filter((play) => playHasHiddenCards(play) && play.id !== targetPlay.id)
      .sort((leftPlay, rightPlay) => leftPlay.playedAtTurn - rightPlay.playedAtTurn || leftPlay.playerID.localeCompare(rightPlay.playerID))
      .map((play) => ({
        playID: play.id,
        playerID: play.playerID,
        cards: play.cards,
      })),
    trumpRank,
    targetWasHonest,
    caughtDreamerRepeatTrump,
    caughtDreamerDirectionChange,
    caughtDreamerExtraCardCount,
    caughtDreamerExceededTableLimit,
    reverseRuleTriggered,
    reverseRuleIgnoredForDreamerCheat,
    punishedPlayerID,
    unpunishedPlayerID,
    punishmentCardCount: getTableCardCount(state.table),
  } satisfies BlowCowBSResolution
}

function createResetResolution(
  state: BlowCowState,
  callerPlayerID: string,
  kind: BlowCowTableReturnResolutionKind,
) {
  return {
    id: `${kind}-${state.round.roundNumber}-${state.table.plays.length}-${callerPlayerID}`,
    callerPlayerID,
    kind,
  } satisfies BlowCowResetResolution
}

function buildTurnStatus(state: BlowCowState, currentPlayerID: string) {
  if (state.gameStatus !== 'active') {
    return state.tableStatus
  }

  if (state.bsResolution) {
    return `${formatPlayerLabel(state, state.bsResolution.callerPlayerID)} called BS on ${formatPlayerLabel(state, state.bsResolution.targetPlayerID)}. Resolving the table.`
  }

  if (state.resetResolution) {
    return state.resetResolution.kind === 'roundReturn'
      ? `${formatPlayerLabel(state, state.resetResolution.callerPlayerID)} passed. Everyone passed, so the table cards are returning to their owners.`
      : `${formatPlayerLabel(state, state.resetResolution.callerPlayerID)} called Reset. Returning the table cards before redistributing them.`
  }

  const playerLabel = formatPlayerLabel(state, currentPlayerID)
  const trumpRank = state.round.trumpRank
  const tableCardCount = getTableCardCount(state.table)
  const hasBSTarget = Boolean(getDefaultBSTargetPlayerID(state, currentPlayerID))
  const hasPawnEnPassantTarget = Boolean(getPawnEnPassantTargetSelection(state, currentPlayerID))
  const canReset = tableCardCount >= state.round.maxCardsOnTable
  const directionActionDetail = isContrarian(state, currentPlayerID)
    ? ' Change Direction is also available.'
    : isDreamer(state, currentPlayerID)
    ? ' Change Direction is also available, but BS can catch it if the direction stays changed.'
    : ''

  if (!trumpRank) {
    return `Round ${state.round.roundNumber}. ${playerLabel} to act. Choose a trump rank and play, or pass.${directionActionDetail}`
  }

  if (isFinalTwoResolutionTurn(state, currentPlayerID)) {
    const targetPlayerID = getDefaultBSTargetPlayerID(state, currentPlayerID)
    if (canReset) {
      return `Trump is ${trumpRank}. Table ${tableCardCount}/${state.round.maxCardsOnTable}. ${playerLabel} may Call Reset or Call BS while ${formatPlayerLabel(state, targetPlayerID ?? currentPlayerID)} waits on their final hidden play.${directionActionDetail}`
    }

    return `Trump is ${trumpRank}. Table ${tableCardCount}/${state.round.maxCardsOnTable}. ${playerLabel} may Call BS while ${formatPlayerLabel(state, targetPlayerID ?? currentPlayerID)} waits on their final hidden play.${directionActionDetail}`
  }

  if (canReset && hasBSTarget) {
    return hasPawnEnPassantTarget
      ? `Trump is ${trumpRank}. Table ${tableCardCount}/${state.round.maxCardsOnTable}. ${playerLabel} may Call Reset, Call BS, En Passant, or Pass.${directionActionDetail}`
      : `Trump is ${trumpRank}. Table ${tableCardCount}/${state.round.maxCardsOnTable}. ${playerLabel} may Call Reset, Call BS, or Pass.${directionActionDetail}`
  }

  if (canReset) {
    return `Trump is ${trumpRank}. Table ${tableCardCount}/${state.round.maxCardsOnTable}. ${playerLabel} may Call Reset or Pass.${directionActionDetail}`
  }

  if (hasBSTarget) {
    return hasPawnEnPassantTarget
      ? `Trump is ${trumpRank}. Table ${tableCardCount}/${state.round.maxCardsOnTable}. ${playerLabel} may Play, Call BS, En Passant, or Pass.${directionActionDetail}`
      : `Trump is ${trumpRank}. Table ${tableCardCount}/${state.round.maxCardsOnTable}. ${playerLabel} may Play, Call BS, or Pass.${directionActionDetail}`
  }

  return `Trump is ${trumpRank}. Table ${tableCardCount}/${state.round.maxCardsOnTable}. ${playerLabel} may Play or Pass.${directionActionDetail}`
}

function buildGameOverSummary(state: BlowCowState): BlowCowGameOver {
  const placements = [...state.seatOrder].sort((leftPlayerID, rightPlayerID) => {
    const leftPlayer = state.players[leftPlayerID]
    const rightPlayer = state.players[rightPlayerID]

    return leftPlayer.points - rightPlayer.points
      || (leftPlayer.leaveOrder ?? Number.MAX_SAFE_INTEGER) - (rightPlayer.leaveOrder ?? Number.MAX_SAFE_INTEGER)
      || leftPlayer.seatIndex - rightPlayer.seatIndex
  })

  return {
    placements,
    winnerID: placements[0],
    pointsByPlayer: Object.fromEntries(
      Object.entries(state.players).map(([playerID, player]) => [playerID, player.points]),
    ),
  }
}

function finalizeGame(state: BlowCowState, events: BlowCowEventsAPI, statusMessage: string, turnNumber: number) {
  const gameOver = buildGameOverSummary(state)
  state.gameStatus = 'finished'
  state.placements = gameOver.placements
  state.tableStatus = statusMessage
  appendTelemetryEvent(state, 'game', 'Match finished', statusMessage, gameOver.winnerID, turnNumber)
  events.endGame(gameOver)
}

function getRoundStartPlayerOrder(state: BlowCowState) {
  const activePlayerIDs = getActivePlayerIDs(state)
  const fallbackStartingPlayerID = activePlayerIDs.includes(state.round.startingPlayerID)
    ? state.round.startingPlayerID
    : activePlayerIDs[0]
  const startingPlayerID = getDefaultStartingPlayerID(state, fallbackStartingPlayerID)

  if (!startingPlayerID) {
    return [] as string[]
  }

  const roundStartPlayerOrder = [startingPlayerID]

  while (roundStartPlayerOrder.length < activePlayerIDs.length) {
    const nextPlayerID = getNextActivePlayerID(
      roundStartPlayerOrder[roundStartPlayerOrder.length - 1] ?? startingPlayerID,
      state.seatOrder,
      state.round.direction,
      activePlayerIDs,
    )

    if (!nextPlayerID || roundStartPlayerOrder.includes(nextPlayerID)) {
      break
    }

    roundStartPlayerOrder.push(nextPlayerID)
  }

  return roundStartPlayerOrder
}

function beginNextRound(state: BlowCowState, nextStartingPlayerID: string, statusMessage: string) {
  state.round.roundNumber += 1
  state.round.direction = toggleDirection(state.round.direction)
  state.round.startingPlayerID = getDefaultStartingPlayerID(state, nextStartingPlayerID) ?? nextStartingPlayerID
  state.round.pendingStartingPlayerID = null
  state.round.previousTrumpRank = state.round.trumpRank ?? state.round.previousTrumpRank
  state.round.trumpRank = null
  state.round.passStreak = 0
  state.round.lastNonPassingPlayerID = null
  state.round.status = 'awaitingTrumpSelection'
  state.table.plays = []
  state.bsResolution = null
  state.resetResolution = null
  clearPendingRevealIDs(state)
  updateRoundCapacity(state)
  state.tableStatus = statusMessage
}

function resolveRoundStartLeaves(state: BlowCowState, turnNumber: number) {
  const roundStartPlayerOrder = getRoundStartPlayerOrder(state)
  let nextStartingPlayerID: string | null = null

  for (const playerID of roundStartPlayerOrder) {
    if (state.players[playerID].hand.length === 0) {
      markPlayerLeft(
        state,
        playerID,
        turnNumber,
        'Started the round with no cards in hand and left immediately.',
      )
      continue
    }

    if (!nextStartingPlayerID) {
      nextStartingPlayerID = playerID
    }
  }

  nextStartingPlayerID = getDefaultStartingPlayerID(state, nextStartingPlayerID)

  if (nextStartingPlayerID) {
    state.round.startingPlayerID = nextStartingPlayerID
  }

  return nextStartingPlayerID
}

function revealPendingPlayAtTurnStart(
  state: BlowCowState,
  currentPlayerID: string,
  turnNumber: number,
  shuffle?: BlowCowShuffle,
) {
  const pendingPlay = getPendingRevealPlay(state, currentPlayerID)
  if (!pendingPlay) {
    return
  }

  const hiddenCards = getHiddenCardsForPlay(pendingPlay)
  if (state.players[currentPlayerID].character === 'The Spy' && hiddenCards.length >= 2) {
    const revealedCard = shuffleCards(hiddenCards, shuffle)[0] ?? hiddenCards[0]
    pendingPlay.revealedCardIDs = [...new Set([...(pendingPlay.revealedCardIDs ?? []), revealedCard.id])]
    state.players[currentPlayerID].pendingRevealPlayID = null
    const remainingHiddenCardCount = getHiddenCardsForPlay(pendingPlay).length
    appendHistoryEvent(
      state,
      'action',
      `${formatPlayerLabel(state, currentPlayerID)} revealed 1 card(s)`,
      `The Spy revealed ${formatCardLabel(revealedCard)} after claiming ${pendingPlay.claimedRank}. ${remainingHiddenCardCount} card(s) remained hidden.`,
      currentPlayerID,
      turnNumber,
    )
    appendArchiveTurnAction(state, currentPlayerID, turnNumber, {
      kind: 'revealPendingPlay',
      detail: `The Spy revealed ${formatCardLabel(revealedCard)} after claiming ${pendingPlay.claimedRank}.`,
      characterUsed: 'The Spy',
      revealedPlayerID: currentPlayerID,
      cards: [revealedCard],
      claimedRank: pendingPlay.claimedRank,
      remainingHiddenCardCount,
    })
    return
  }

  pendingPlay.revealedAtTurn = turnNumber
  pendingPlay.rehiddenCardIDs = []
  state.players[currentPlayerID].pendingRevealPlayID = null
  appendHistoryEvent(
    state,
    'action',
    `${formatPlayerLabel(state, currentPlayerID)} revealed ${pendingPlay.cards.length} card(s)`,
    `Revealed ${pendingPlay.cards.map((card) => formatCardLabel(card)).join(', ')} after claiming ${pendingPlay.claimedRank}.`,
    currentPlayerID,
    turnNumber,
  )
  appendArchiveTurnAction(state, currentPlayerID, turnNumber, {
    kind: 'revealPendingPlay',
    detail: `Revealed ${pendingPlay.cards.length} card(s) after claiming ${pendingPlay.claimedRank}.`,
    revealedPlayerID: currentPlayerID,
    cards: pendingPlay.cards,
    claimedRank: pendingPlay.claimedRank,
    remainingHiddenCardCount: 0,
  })
}

function applyLeaveCharacterEffect(state: BlowCowState, playerID: string, turnNumber: number) {
  const player = getPlayerState(state, playerID)

  if (player.character === 'The Speedrunner' && player.leaveOrder === 1 && player.points === 2) {
    player.points = 0
    appendHistoryEvent(
      state,
      'system',
      `${formatPlayerLabel(state, playerID)} triggered The Speedrunner`,
      'Left first with exactly 2 points, so the total became 0 instead.',
      playerID,
      turnNumber,
    )
    return
  }

  if (player.character === 'The Privileged') {
    player.points += 1
    appendHistoryEvent(
      state,
      'system',
      `${formatPlayerLabel(state, playerID)} triggered The Privileged`,
      'Left the game, so 1 point was added.',
      playerID,
      turnNumber,
    )
    return
  }

  if (player.character === 'The Streamer' && player.matchStats.passCount === 0) {
    player.points -= 2
    appendHistoryEvent(
      state,
      'system',
      `${formatPlayerLabel(state, playerID)} triggered The Streamer`,
      'Left the game without ever passing, so 2 points were lost.',
      playerID,
      turnNumber,
    )
    return
  }

  if (player.character === 'The Pacifist' && player.matchStats.callBSCount === 0) {
    player.points -= 1
    appendHistoryEvent(
      state,
      'system',
      `${formatPlayerLabel(state, playerID)} triggered The Pacifist`,
      'Left the game without ever calling BS, so 1 point was lost.',
      playerID,
      turnNumber,
    )
    return
  }

  if (player.character === 'The Drunkard' && player.matchStats.playCount > 0 && !player.hasUsedManualPlay) {
    player.points -= 3
    appendHistoryEvent(
      state,
      'system',
      `${formatPlayerLabel(state, playerID)} triggered The Drunkard`,
      'Left the game after only ever using Play Random, so 3 points were lost.',
      playerID,
      turnNumber,
    )
  }
}

function removeLeftPlayerTableCards(state: BlowCowState, playerID: string) {
  const removedCards = getPlayerFrontCards(state, playerID)
  if (removedCards.length === 0) {
    return removedCards
  }

  state.table.plays = state.table.plays.filter((play) => play.playerID !== playerID)

  return removedCards
}

function markPlayerLeft(
  state: BlowCowState,
  playerID: string,
  turnNumber: number,
  detail = 'Started the turn with no cards in hand and left immediately.',
) {
  const player = getPlayerState(state, playerID)
  if (player.hasLeft) {
    return
  }

  player.hasLeft = true
  player.leaveOrder = Object.values(state.players).filter((entry) => entry.hasLeft).length
  player.pendingRevealPlayID = null
  const removedTableCards = removeLeftPlayerTableCards(state, playerID)
  appendHistoryEvent(
    state,
    'leave',
    `${formatPlayerLabel(state, playerID)} left the game`,
    detail,
    playerID,
    turnNumber,
  )
  appendArchiveTurnAction(state, playerID, turnNumber, {
    kind: 'leave',
    detail,
    leaveOrder: player.leaveOrder,
    cards: removedTableCards,
  })

  if (removedTableCards.length > 0) {
    appendHistoryEvent(
      state,
      'system',
      `${removedTableCards.length} card(s) left the game with ${formatPlayerLabel(state, playerID)}`,
      `${removedTableCards.map((card) => formatCardLabel(card)).join(', ')} sat in front of them on the table and were removed from the game entirely.`,
      playerID,
      turnNumber,
    )
  }

  applyLeaveCharacterEffect(state, playerID, turnNumber)
  updateRoundCapacity(state)
}

function finalizeGameForLastRemainingPlayer(
  state: BlowCowState,
  events: BlowCowEventsAPI,
  currentPlayerID: string,
  turnNumber: number,
) {
  const activePlayerIDs = getActivePlayerIDs(state)
  const lastRemainingPlayerID = activePlayerIDs[0] ?? currentPlayerID

  if (activePlayerIDs.length === 1) {
    markPlayerLeft(
      state,
      lastRemainingPlayerID,
      turnNumber,
      'Was the last player remaining, so left the game last.',
    )
  }

  finalizeGame(
    state,
    events,
    `${formatPlayerLabel(state, lastRemainingPlayerID)} is the last player remaining.`,
    turnNumber,
  )
}

function resolveRoundStart(state: BlowCowState, events: BlowCowEventsAPI, turnNumber: number) {
  const nextStartingPlayerID = resolveRoundStartLeaves(state, turnNumber)
  const activePlayerIDs = getActivePlayerIDs(state)

  if (activePlayerIDs.length === 0) {
    finalizeGame(
      state,
      events,
      'All remaining players had no cards in hand at the start of the round and left immediately.',
      turnNumber,
    )
    return null
  }

  if (activePlayerIDs.length <= 1) {
    finalizeGameForLastRemainingPlayer(state, events, nextStartingPlayerID ?? state.round.startingPlayerID, turnNumber)
    return null
  }

  return nextStartingPlayerID ?? activePlayerIDs[0] ?? null
}

function handleTurnStart({ G, ctx, events, random }: BlowCowHookContext) {
  if (G.gameStatus !== 'active') {
    return
  }

  const currentPlayerID = ctx.currentPlayer
  G.players[currentPlayerID].turnStartingDirection = G.round.direction
  G.players[currentPlayerID].matchStats.turnsInGame += 1
  ensureArchiveTurn(G, currentPlayerID, ctx.turn)
  revealPendingPlayAtTurnStart(G, currentPlayerID, ctx.turn, random?.Shuffle)
  appendTelemetryEvent(
    G,
    'turn',
    `${formatPlayerLabel(G, currentPlayerID)} turn started`,
    `Started the turn with ${G.players[currentPlayerID].hand.length} card(s) in hand.`,
    currentPlayerID,
    ctx.turn,
  )

  if (getPlayerState(G, currentPlayerID).hand.length === 0) {
    markPlayerLeft(G, currentPlayerID, ctx.turn)

    const activePlayerIDs = getActivePlayerIDs(G)
    if (activePlayerIDs.length <= 1) {
      finalizeGameForLastRemainingPlayer(G, events, currentPlayerID, ctx.turn)
      return
    }

    const nextActivePlayerID = getNextActivePlayerID(currentPlayerID, G.seatOrder, G.round.direction, activePlayerIDs)
    const nextPlayerID = G.round.trumpRank === null
      ? getDefaultStartingPlayerID(G, nextActivePlayerID)
      : nextActivePlayerID

    if (nextPlayerID) {
      if (G.round.trumpRank === null && G.round.startingPlayerID === currentPlayerID) {
        G.round.startingPlayerID = nextPlayerID
      }

      G.tableStatus = `${formatPlayerLabel(G, currentPlayerID)} left the game. ${formatPlayerLabel(G, nextPlayerID)} is next to act.`
      events.endTurn({ next: nextPlayerID })
    }
    return
  }

  updateRoundCapacity(G)
  G.tableStatus = buildTurnStatus(G, currentPlayerID)
}

function advanceTurn(state: BlowCowState, events: BlowCowEventsAPI, currentPlayerID: string, turnNumber: number) {
  const activePlayerIDs = getActivePlayerIDs(state)
  if (activePlayerIDs.length <= 1) {
    finalizeGameForLastRemainingPlayer(state, events, currentPlayerID, turnNumber)
    return
  }

  const nextPlayerID = getNextActivePlayerID(currentPlayerID, state.seatOrder, state.round.direction, activePlayerIDs)
  if (nextPlayerID) {
    events.endTurn({ next: nextPlayerID })
  }
}

function validateCommonPlay(
  state: BlowCowState,
  playerID: string,
  cardIDs: string[],
  nextTrumpRank: BlowCowRank | null,
) {
  if (state.gameStatus !== 'active' || state.bsResolution !== null || state.resetResolution !== null || isFinalTwoResolutionTurn(state, playerID)) {
    return false
  }

  if (state.round.trumpRank === null && nextTrumpRank === null) {
    return false
  }

  if (state.round.trumpRank !== null && nextTrumpRank !== null) {
    return false
  }

  if (nextTrumpRank !== null && state.round.previousTrumpRank === nextTrumpRank && !canDreamerRepeatPreviousTrump(state, playerID, nextTrumpRank)) {
    return false
  }

  if (cardIDs.length === 0) {
    return false
  }

  if (!isDreamer(state, playerID) && cardIDs.length > 2) {
    return false
  }

  return isDreamer(state, playerID) || getTableCardCount(state.table) + cardIDs.length <= state.round.maxCardsOnTable
}

type BlowCowPlayMode = 'manual' | 'random'

function performPlay(
  context: BlowCowMoveContext,
  cardIDs: string[],
  nextTrumpRank: BlowCowRank | null,
  playMode: BlowCowPlayMode = 'manual',
) {
  const { G, ctx, events, playerID } = context
  if (!validateCommonPlay(G, playerID, cardIDs, nextTrumpRank)) {
    return INVALID_MOVE
  }

  const selectedCards = removeCardsFromPlayerHand(G, playerID, cardIDs)
  if (!selectedCards) {
    return INVALID_MOVE
  }

  const claimedRank = nextTrumpRank ?? G.round.trumpRank
  if (!claimedRank) {
    addCardsToPlayerHand(G, playerID, selectedCards, 'other', ctx.turn)
    return INVALID_MOVE
  }

  const declaredCardCount = getDreamerDeclaredCardCount(G, playerID, selectedCards.length)
  const usedDreamerRepeatTrump = canDreamerRepeatPreviousTrump(G, playerID, nextTrumpRank)
  const usedDreamerDirectionChange = isDreamer(G, playerID)
    && G.players[playerID].turnStartingDirection !== null
    && G.round.direction !== G.players[playerID].turnStartingDirection
  const usedDreamerExtraCardCount = isDreamer(G, playerID) && selectedCards.length > declaredCardCount
  const usedDreamerExceededTableLimit = isDreamer(G, playerID) && getTableCardCount(G.table) + selectedCards.length > G.round.maxCardsOnTable
  const playerCharacter = G.players[playerID].character
  const playerMatchStats = G.players[playerID].matchStats
  const wasHonest = selectedCards.every((card) => isTrumpCard(card, claimedRank, playerCharacter))
    && !usedDreamerRepeatTrump
    && !usedDreamerExtraCardCount
    && !usedDreamerExceededTableLimit
  playerMatchStats.playCount += 1
  playerMatchStats.cardsPlayed += selectedCards.length
  if (playMode === 'manual') {
    G.players[playerID].hasUsedManualPlay = true
  }
  if (!wasHonest) {
    playerMatchStats.lieCount += 1
  }

  if (playMode === 'random') {
    appendHistoryEvent(
      G,
      'action',
      `${formatPlayerLabel(G, playerID)} used The Drunkard`,
      `Randomly selected ${selectedCards.length} card(s) from hand before playing.`,
      playerID,
      ctx.turn,
    )
  }

  createPlay(G, playerID, selectedCards, declaredCardCount, claimedRank, ctx.turn, nextTrumpRank !== null)
  const createdPlay = getPendingRevealPlay(G, playerID)
  if (createdPlay) {
    createdPlay.usedDreamerDirectionChange = usedDreamerDirectionChange
  }
  G.round.trumpRank = nextTrumpRank ?? G.round.trumpRank
  G.round.status = 'inProgress'
  G.round.passStreak = 0
  G.round.lastNonPassingPlayerID = playerID
  appendHistoryEvent(
    G,
    'action',
    `${formatPlayerLabel(G, playerID)} played ${declaredCardCount} card(s)`,
    nextTrumpRank !== null
      ? `Selected ${nextTrumpRank} as trump and placed ${declaredCardCount} card(s) face down.`
      : `Claimed ${claimedRank} and placed ${declaredCardCount} card(s) face down.`,
    playerID,
    ctx.turn,
  )
  appendArchiveTurnAction(G, playerID, ctx.turn, {
    kind: 'play',
    detail: nextTrumpRank !== null
      ? `Selected ${nextTrumpRank} as trump and placed ${declaredCardCount} card(s) face down.`
      : `Claimed ${claimedRank} and placed ${declaredCardCount} card(s) face down.`,
    characterUsed: playMode === 'random'
      ? 'The Drunkard'
      : usedDreamerRepeatTrump || usedDreamerDirectionChange || usedDreamerExtraCardCount || usedDreamerExceededTableLimit
      ? 'The Dreamer'
      : null,
    cards: selectedCards,
    declaredCardCount,
    claimedRank,
    wasHonest,
    playMode,
    directionBefore: G.players[playerID].turnStartingDirection ?? G.round.direction,
    directionAfter: G.round.direction,
  })

  advanceTurn(G, events, playerID, ctx.turn)
}

function resolveDrunkardRandomPlay(
  context: BlowCowMoveContext,
  args?: BlowCowPlayRandomArgs,
) {
  const { G, playerID, random } = context

  if (!isDrunkard(G, playerID)) {
    return INVALID_MOVE
  }

  const cardCount = args?.cardCount ?? 0
  if (!Number.isInteger(cardCount) || cardCount <= 0) {
    return INVALID_MOVE
  }

  const randomCards = shuffleCards(G.players[playerID].hand, random?.Shuffle).slice(0, cardCount)
  if (randomCards.length !== cardCount) {
    return INVALID_MOVE
  }

  return performPlay(
    context,
    randomCards.map((card) => card.id),
    args?.trumpRank ?? null,
    'random',
  )
}

function resolveCatHideCard(
  context: BlowCowMoveContext,
  args?: BlowCowCatHideCardArgs,
) {
  const { G, ctx, playerID } = context
  if (G.gameStatus !== 'active' || G.bsResolution !== null || G.resetResolution !== null || ctx.currentPlayer !== playerID) {
    return INVALID_MOVE
  }

  if (G.players[playerID].character !== 'The Cat') {
    return INVALID_MOVE
  }

  const targetCardID = args?.cardID ?? null
  if (!targetCardID) {
    return INVALID_MOVE
  }

  const targetPlay = G.table.plays.find((play) => play.cards.some((card) => card.id === targetCardID))
  const targetCard = targetPlay?.cards.find((card) => card.id === targetCardID)

  if (!targetPlay || !targetCard || !isCardFaceUpOnTable(targetPlay, targetCardID)) {
    return INVALID_MOVE
  }

  targetPlay.rehiddenCardIDs = [...new Set([...(targetPlay.rehiddenCardIDs ?? []), targetCardID])]
  appendHistoryEvent(
    G,
    'action',
    `${formatPlayerLabel(G, playerID)} used The Cat`,
    `Flipped ${formatCardLabel(targetCard)} face down on the table.`,
    playerID,
    ctx.turn,
  )
  appendArchiveTurnAction(G, playerID, ctx.turn, {
    kind: 'hideTableCard',
    detail: `Flipped ${formatCardLabel(targetCard)} face down on the table.`,
    characterUsed: 'The Cat',
    cards: [targetCard],
  })
  G.tableStatus = buildTurnStatus(G, playerID)
}

function resolveContrarianToggleDirection(
  context: BlowCowMoveContext,
) {
  const { G, ctx, playerID } = context
  if (G.gameStatus !== 'active' || G.bsResolution !== null || G.resetResolution !== null || ctx.currentPlayer !== playerID) {
    return INVALID_MOVE
  }

  const usedContrarian = isContrarian(G, playerID)
  const usedDreamer = isDreamer(G, playerID)
  if (!usedContrarian && !usedDreamer) {
    return INVALID_MOVE
  }

  const directionBefore = G.round.direction
  G.round.direction = toggleDirection(G.round.direction)
  const pendingPlay = getPendingRevealPlay(G, playerID)
  if (pendingPlay && usedDreamer) {
    pendingPlay.usedDreamerDirectionChange = G.players[playerID].turnStartingDirection !== null
      && G.round.direction !== G.players[playerID].turnStartingDirection
  }
  appendHistoryEvent(
    G,
    'action',
    `${formatPlayerLabel(G, playerID)} used ${usedContrarian ? 'The Contrarian' : 'The Dreamer'}`,
    usedContrarian
      ? `Changed the direction to ${G.round.direction}.`
      : `Changed the direction to ${G.round.direction}. BS can catch this if the direction stays changed by the end of the turn.`,
    playerID,
    ctx.turn,
  )
  appendArchiveTurnAction(G, playerID, ctx.turn, {
    kind: 'toggleDirection',
    detail: usedContrarian
      ? `Changed the direction to ${G.round.direction}.`
      : `Changed the direction to ${G.round.direction}. BS can catch this if the direction stays changed by the end of the turn.`,
    characterUsed: usedContrarian ? 'The Contrarian' : 'The Dreamer',
    directionBefore,
    directionAfter: G.round.direction,
  })
  G.tableStatus = buildTurnStatus(G, playerID)
}

function resolveForeignerPassCard(
  context: BlowCowMoveContext,
  foreignerCardCode: string | null | undefined,
) {
  const { G, ctx, playerID } = context
  const parsedCard = parseForeignerCardCode(foreignerCardCode)

  if (!parsedCard.isValid) {
    return INVALID_MOVE
  }

  if (!parsedCard.cardSpec) {
    return null
  }

  if (G.players[playerID].character !== 'The Foreigner') {
    return INVALID_MOVE
  }

  const outsideCard = createForeignerOutsideCard(playerID, ctx.turn, parsedCard.cardSpec)
  const scoredSets = addCardsToPlayerHand(G, playerID, [outsideCard], 'other', ctx.turn, { deferPointHistory: true })
  appendHistoryEvent(
    G,
    'action',
    `${formatPlayerLabel(G, playerID)} used The Foreigner`,
    `Added ${formatCardLabel(outsideCard)} from outside the game to hand.`,
    playerID,
    ctx.turn,
  )
  appendArchiveTurnAction(G, playerID, ctx.turn, {
    kind: 'gainOutsideCard',
    detail: `Added ${formatCardLabel(outsideCard)} from outside the game to hand.`,
    characterUsed: 'The Foreigner',
    cards: [outsideCard],
  })
  appendPointHistoryEvents(G, playerID, scoredSets, ctx.turn)

  return outsideCard
}

function returnCardsAfterAllPass(context: BlowCowMoveContext) {
  const { G, ctx, events, playerID } = context
  const cardsByOwner = collectTableCardsByOwner(G)
  const returnedCardsByPlayer = createCardsByPlayerRecord(cardsByOwner.entries())
  const scoredSetsByOwner = new Map<string, BlowCowScoredSet[]>()

  for (const [ownerPlayerID, cards] of cardsByOwner.entries()) {
    if (!G.players[ownerPlayerID].hasLeft) {
      scoredSetsByOwner.set(
        ownerPlayerID,
        addCardsToPlayerHand(G, ownerPlayerID, cards, 'roundReturn', ctx.turn, { deferPointHistory: true }),
      )
    }
  }

  appendHistoryEvent(
    G,
    'action',
    `${formatPlayerLabel(G, playerID)} passed`,
    'Everyone passed, so the round ended and each active player took back their own cards.',
    playerID,
    ctx.turn,
  )
  appendArchiveTurnAction(G, playerID, ctx.turn, {
    kind: 'roundReturn',
    detail: 'Everyone passed, so each active player took back their own cards.',
    resetKind: 'roundReturn',
    cardsByPlayer: returnedCardsByPlayer,
  })
  for (const [ownerPlayerID, scoredSets] of scoredSetsByOwner.entries()) {
    appendPointHistoryEvents(G, ownerPlayerID, scoredSets, ctx.turn)
  }
  beginNextRound(
    G,
    playerID,
    `${formatPlayerLabel(G, playerID)} passed last. A new round begins with the direction reversed.`,
  )

  const nextStartingPlayerID = resolveRoundStart(G, events, ctx.turn)
  if (nextStartingPlayerID) {
    events.endTurn({ next: nextStartingPlayerID })
  }
}

function resolveBS(context: BlowCowMoveContext, args?: BlowCowCallBSArgs) {
  const { G, playerID } = context
  if (G.gameStatus !== 'active' || G.bsResolution || G.resetResolution) {
    return INVALID_MOVE
  }

  const resolvedTarget = resolveBSTargetSelection(G, playerID, args?.targetPlayerID)
  const trumpRank = G.round.trumpRank

  if (!resolvedTarget || !trumpRank) {
    return INVALID_MOVE
  }

  const { targetPlayerID, targetPlay, usedGrandmasterBSOverride, usedPawnEnPassant, pawnTriggerPlayerID } = resolvedTarget

  if (usedGrandmasterBSOverride) {
    G.players[playerID].hasUsedGrandmasterBSOverride = true
    appendHistoryEvent(
      G,
      'action',
      `${formatPlayerLabel(G, playerID)} used The Grandmaster`,
      `Called BS on ${formatPlayerLabel(G, targetPlayerID)} even though they were not the latest non-passing player.`,
      playerID,
      context.ctx.turn,
    )
  }

  if (usedPawnEnPassant && pawnTriggerPlayerID) {
    appendHistoryEvent(
      G,
      'action',
      `${formatPlayerLabel(G, playerID)} used The Pawn`,
      `Used En Passant to call BS on ${formatPlayerLabel(G, targetPlayerID)} because ${formatPlayerLabel(G, pawnTriggerPlayerID)} just played 2 cards.`,
      playerID,
      context.ctx.turn,
    )
  }

  G.players[playerID].matchStats.callBSCount += 1
  G.bsResolution = createBSResolution(G, playerID, targetPlayerID, targetPlay, trumpRank)
  G.tableStatus = `${formatPlayerLabel(G, playerID)} called BS on ${formatPlayerLabel(G, targetPlayerID)}. Resolving the table.`
  appendArchiveTurnAction(G, playerID, context.ctx.turn, {
    kind: 'callBS',
    detail: `Called BS on ${formatPlayerLabel(G, targetPlayerID)}.`,
    characterUsed: usedGrandmasterBSOverride
      ? 'The Grandmaster'
      : usedPawnEnPassant
      ? 'The Pawn'
      : null,
    targetPlayerID,
    usedGrandmasterBSOverride,
    usedPawnEnPassant,
    pawnTriggerPlayerID,
  })
  appendTelemetryEvent(
    G,
    'action',
    `${formatPlayerLabel(G, playerID)} called BS`,
    `Challenged ${formatPlayerLabel(G, targetPlayerID)} before the hidden play was resolved.`,
    playerID,
    context.ctx.turn,
  )
}

function finalizeBSResolution(
  context: BlowCowMoveContext,
  args?: BlowCowFinalizeBSResolutionArgs,
) {
  const { G, ctx, events } = context
  const resolution = G.bsResolution

  if (!resolution || (args?.resolutionID && resolution.id !== args.resolutionID)) {
    return INVALID_MOVE
  }

  const punishmentCards = getAllTableCards(G)
  const punishmentLabels = punishmentCards.map((card) => formatCardLabel(card))
  const revealedTargetLabels = resolution.targetPlayCards.map((card) => formatCardLabel(card))
  const targetCharacter = G.players[resolution.targetPlayerID]?.character ?? null
  const targetLiedAboutCards = resolution.targetPlayCards.some((card) => !isTrumpCard(card, resolution.trumpRank, targetCharacter))
  const dreamerInfractions: string[] = []

  if (resolution.caughtDreamerRepeatTrump) {
    dreamerInfractions.push(`The Dreamer repeated ${resolution.trumpRank} as the previous round trump on the opening play`)
  }

  if (resolution.caughtDreamerDirectionChange) {
    dreamerInfractions.push('The Dreamer changed the turn direction during the hidden play')
  }

  if (resolution.caughtDreamerExtraCardCount) {
    dreamerInfractions.push(`The Dreamer declared ${resolution.targetDeclaredCardCount} card(s) but actually played ${resolution.targetPlayCards.length}`)
  }

  if (resolution.caughtDreamerExceededTableLimit) {
    dreamerInfractions.push(`The Dreamer pushed the table to ${resolution.punishmentCardCount} card(s), above the ${G.round.maxCardsOnTable}-card limit`)
  }

  const outcomeDetail = resolution.reverseRuleIgnoredForDreamerCheat
    ? `Four or more ${resolution.trumpRank}s were on the table, but catching The Dreamer cheating still punished The Dreamer.`
    : resolution.reverseRuleTriggered
    ? `Four or more ${resolution.trumpRank}s were on the table, so the punishment was reversed.`
    : `Fewer than four ${resolution.trumpRank}s were on the table, so the default punishment stood.`
  const dreamerDetail = dreamerInfractions.length > 0
    ? ` ${dreamerInfractions.join('. ')}.`
    : ''
  const cardLieDetail = targetLiedAboutCards
    ? ' The hidden play was not all trump.'
    : ''
  const verdictDetail = resolution.targetWasHonest
    ? `${formatPlayerLabel(G, resolution.targetPlayerID)} was honest. ${outcomeDetail}`
    : `${formatPlayerLabel(G, resolution.targetPlayerID)} was dishonest.${dreamerDetail}${cardLieDetail} ${outcomeDetail}`
  const punishmentScoredSets = addCardsToPlayerHand(
    G,
    resolution.punishedPlayerID,
    punishmentCards,
    'punishment',
    ctx.turn,
    { deferPointHistory: true },
  )

  G.players[resolution.punishedPlayerID].matchStats.punishmentCount += 1
  if (resolution.unpunishedPlayerID === resolution.callerPlayerID) {
    G.players[resolution.callerPlayerID].matchStats.bsWinCount += 1
  }

  appendHistoryEvent(
    G,
    'action',
    `${formatPlayerLabel(G, resolution.callerPlayerID)} called BS on ${formatPlayerLabel(G, resolution.targetPlayerID)}`,
    'Ended the round immediately and forced the hidden plays to be revealed.',
    resolution.callerPlayerID,
    ctx.turn,
  )
  appendHistoryEvent(
    G,
    'verdict',
    `BS verdict on ${formatPlayerLabel(G, resolution.targetPlayerID)}`,
    verdictDetail,
    resolution.targetPlayerID,
    ctx.turn,
  )
  appendHistoryEvent(
    G,
    'punishment',
    `${formatPlayerLabel(G, resolution.punishedPlayerID)} took ${punishmentCards.length} card(s)`,
    `Took ${punishmentLabels.join(', ')}. Revealed play: ${revealedTargetLabels.join(', ')}.`,
    resolution.punishedPlayerID,
    ctx.turn,
  )
  appendArchiveTurnAction(G, resolution.callerPlayerID, ctx.turn, {
    kind: 'resolveBS',
    detail: verdictDetail,
    targetPlayerID: resolution.targetPlayerID,
    cards: resolution.targetPlayCards,
    cardsByPlayer: createCardsByPlayerRecord([
      [resolution.punishedPlayerID, punishmentCards],
    ]),
    declaredCardCount: resolution.targetDeclaredCardCount,
    claimedRank: resolution.trumpRank,
    wasHonest: resolution.targetWasHonest,
    punishedPlayerID: resolution.punishedPlayerID,
    unpunishedPlayerID: resolution.unpunishedPlayerID,
    additionalRevealPlays: resolution.additionalRevealPlays,
  })
  appendPointHistoryEvents(G, resolution.punishedPlayerID, punishmentScoredSets, ctx.turn)

  beginNextRound(
    G,
    resolution.unpunishedPlayerID,
    `BS resolved. ${formatPlayerLabel(G, resolution.unpunishedPlayerID)} starts the next round.`,
  )

  const nextStartingPlayerID = resolveRoundStart(G, events, ctx.turn)
  if (nextStartingPlayerID) {
    events.endTurn({ next: nextStartingPlayerID })
  }
}

function resolveReset(context: BlowCowMoveContext) {
  const { G, playerID } = context
  if (G.gameStatus !== 'active' || G.bsResolution !== null || G.resetResolution !== null || getTableCardCount(G.table) < G.round.maxCardsOnTable) {
    return INVALID_MOVE
  }

  G.players[playerID].matchStats.resetCount += 1

  G.resetResolution = createResetResolution(G, playerID, 'reset')
  G.tableStatus = `${formatPlayerLabel(G, playerID)} called Reset. Returning the table cards before redistributing them.`
  appendArchiveTurnAction(G, playerID, context.ctx.turn, {
    kind: 'callReset',
    detail: 'Marked the table for redistribution at the current turn.',
    resetKind: 'reset',
    cards: getAllTableCards(G),
  })
  appendTelemetryEvent(
    G,
    'action',
    `${formatPlayerLabel(G, playerID)} called Reset`,
    'Marked the table for redistribution at the current turn.',
    playerID,
    context.ctx.turn,
  )
}

function finalizeResetResolution(
  context: BlowCowMoveContext,
  args?: BlowCowFinalizeResetResolutionArgs,
) {
  const { G, ctx, events, playerID, random } = context
  const resolution = G.resetResolution

  if (!resolution || (args?.resolutionID && resolution.id !== args.resolutionID) || resolution.callerPlayerID !== playerID) {
    return INVALID_MOVE
  }

   if (resolution.kind === 'roundReturn') {
    return returnCardsAfterAllPass(context)
  }

  const tableCards = shuffleCards(getAllTableCards(G), random?.Shuffle)
  const activePlayerIDs = getActivePlayerIDs(G)
  const callerFirstPlayerIDs = [
    resolution.callerPlayerID,
    ...activePlayerIDs.filter((activePlayerID) => activePlayerID !== resolution.callerPlayerID),
  ]
  const cardsPerPlayer = Math.floor(tableCards.length / activePlayerIDs.length)
  const extraCardCount = tableCards.length % activePlayerIDs.length
  const scoredSetsByPlayer = new Map<string, BlowCowScoredSet[]>()
  const redistributedCardsByPlayer: Record<string, BlowCowCard[]> = {}
  let cardIndex = 0

  for (const activePlayerID of callerFirstPlayerIDs) {
    const nextCards = tableCards.slice(cardIndex, cardIndex + cardsPerPlayer)
    cardIndex += cardsPerPlayer
    redistributedCardsByPlayer[activePlayerID] = cloneCards(nextCards)
    scoredSetsByPlayer.set(
      activePlayerID,
      addCardsToPlayerHand(G, activePlayerID, nextCards, 'reset', ctx.turn, { deferPointHistory: true }),
    )
  }

  if (extraCardCount > 0) {
    const extraCards = tableCards.slice(cardIndex, cardIndex + extraCardCount)
    const extraScoredSets = addCardsToPlayerHand(
      G,
      resolution.callerPlayerID,
      extraCards,
      'reset',
      ctx.turn,
      { deferPointHistory: true },
    )
    redistributedCardsByPlayer[resolution.callerPlayerID] = [
      ...(redistributedCardsByPlayer[resolution.callerPlayerID] ?? []),
      ...cloneCards(extraCards),
    ]
    scoredSetsByPlayer.set(resolution.callerPlayerID, [
      ...(scoredSetsByPlayer.get(resolution.callerPlayerID) ?? []),
      ...extraScoredSets,
    ])
  }

  appendHistoryEvent(
    G,
    'action',
    `${formatPlayerLabel(G, resolution.callerPlayerID)} called Reset`,
    'The table was shuffled and redistributed across the active players.',
    resolution.callerPlayerID,
    ctx.turn,
  )
  appendArchiveTurnAction(G, resolution.callerPlayerID, ctx.turn, {
    kind: 'resolveReset',
    detail: 'The table was shuffled and redistributed across the active players.',
    resetKind: 'reset',
    cardsByPlayer: redistributedCardsByPlayer,
  })
  for (const activePlayerID of callerFirstPlayerIDs) {
    appendPointHistoryEvents(G, activePlayerID, scoredSetsByPlayer.get(activePlayerID) ?? [], ctx.turn)
  }
  beginNextRound(
    G,
    resolution.callerPlayerID,
    `${formatPlayerLabel(G, resolution.callerPlayerID)} called Reset and starts the next round.`,
  )

  const nextStartingPlayerID = resolveRoundStart(G, events, ctx.turn)
  if (nextStartingPlayerID) {
    events.endTurn({ next: nextStartingPlayerID })
  }
}

function hideSecretState(state: BlowCowState, playerID: string | null) {
  const revealAllTableCards = state.resetResolution !== null

  const nextPlayers = Object.fromEntries(
    Object.entries(state.players).map(([targetPlayerID, player]) => [
      targetPlayerID,
      {
        ...player,
        hand: playerID === targetPlayerID
          ? player.hand
          : player.hand.map((card) => createHiddenCard(card)),
      },
    ]),
  ) as Record<string, BlowCowPlayerState>

  return {
    ...state,
    archive: createEmptyArchiveState(),
    players: nextPlayers,
    table: {
      plays: state.table.plays.map((play) => ({
        ...play,
        cards: play.cards.map((card) => {
          const isVisible = revealAllTableCards || (
            !getRehiddenCardIDSet(play).has(card.id)
              && (
                play.playerID === playerID
                || play.revealedAtTurn !== null
                || getRevealedCardIDSet(play).has(card.id)
              )
          )

          return isVisible ? card : createHiddenCard(card)
        }),
      })),
    },
  }
}

function createStagedBlowCowState(
  numPlayers: number,
  shuffle?: BlowCowShuffle,
  setupData?: BlowCowSetupData,
): BlowCowState {
  const normalizedPlayerCount = Math.min(
    BLOW_COW_MAX_PLAYERS,
    Math.max(BLOW_COW_MIN_PLAYERS, numPlayers),
  )
  const deckConfig = resolveDeckConfig(normalizedPlayerCount, setupData, shuffle)
  const speedMultiplier = resolveSpeedMultiplier(setupData)
  const useCharacters = resolveUseCharacters(setupData)
  const characterPool = useCharacters ? resolveCharacterPool(setupData) : []
  const seatOrder = createSeatOrder(normalizedPlayerCount)
  const hostPlayerID = seatOrder[0] ?? '0'
  const history: BlowCowHistoryEvent[] = []
  const state = {
    tableStatus: `Waiting for the host to start the game once all ${normalizedPlayerCount} seat(s) are filled.`,
    gameStatus: 'staging',
    hostPlayerID,
    deckConfig,
    speedMultiplier,
    useCharacters,
    characterPool,
    seatOrder,
    players: Object.fromEntries(
      seatOrder.map((playerID, seatIndex) => [playerID, createEmptyPlayerState(playerID, seatIndex)]),
    ) as Record<string, BlowCowPlayerState>,
    round: {
      roundNumber: 1,
      status: 'awaitingTrumpSelection',
      direction: 'counterclockwise',
      startingPlayerID: hostPlayerID,
      pendingStartingPlayerID: null,
      trumpRank: null,
      previousTrumpRank: null,
      passStreak: 0,
      lastNonPassingPlayerID: null,
      maxCardsOnTable: getMaxCardsOnTable(normalizedPlayerCount),
    },
    table: {
      plays: [],
    },
    bsResolution: null,
    resetResolution: null,
    history,
    telemetry: {
      events: [],
    },
    archive: createEmptyArchiveState(),
    placements: [],
  } satisfies BlowCowState

  appendHistoryEvent(
    state,
    'system',
    'Room staged',
    `Prepared ${normalizedPlayerCount} seat(s), selected ${deckConfig.selectedRanks.length} standard rank(s) (${deckConfig.selectedRanks.join(', ')}), included 2 Jokers, set game speed to ${speedMultiplier}x, ${useCharacters ? 'enabled character cards' : 'disabled character cards'}, and is waiting for the host to start the match.`,
    null,
    0,
  )

  return state
}

function startMatchState(state: BlowCowState, turnNumber: number, shuffle?: BlowCowShuffle) {
  const shuffledSeatOrder = shuffleCards([...state.seatOrder], shuffle)
  const shuffledDeck = shuffleCards(createDeck(state.deckConfig.selectedRanks), shuffle)
  const assignedCharacters = state.useCharacters
    ? assignRandomImplementedCharacters(shuffledSeatOrder.length, state.deckConfig.selectedRanks, state.characterPool, shuffle)
    : []
  const dealtHands = dealCards(shuffledDeck, shuffledSeatOrder)
  const seatIndexByPlayerID = new Map(shuffledSeatOrder.map((playerID, seatIndex) => [playerID, seatIndex]))
  const characterByPlayerID = new Map(shuffledSeatOrder.map((playerID, index) => [playerID, assignedCharacters[index] ?? null]))

  state.gameStatus = 'active'
  state.seatOrder = shuffledSeatOrder
  state.history = []
  state.placements = []
  state.table.plays = []
  state.bsResolution = null
  state.resetResolution = null
  state.round.roundNumber = 1
  state.round.status = 'awaitingTrumpSelection'
  state.round.direction = 'counterclockwise'
  state.round.startingPlayerID = shuffledSeatOrder[0] ?? state.hostPlayerID
  state.round.pendingStartingPlayerID = null
  state.round.trumpRank = null
  state.round.previousTrumpRank = null
  state.round.passStreak = 0
  state.round.lastNonPassingPlayerID = null
  state.round.maxCardsOnTable = getMaxCardsOnTable(shuffledSeatOrder.length)
  state.tableStatus = INITIAL_TABLE_STATUS
  state.telemetry = {
    events: [],
  }
  state.archive = createEmptyArchiveState()
  clearPendingRevealIDs(state)

  for (const [playerID, player] of Object.entries(state.players)) {
    player.character = characterByPlayerID.get(playerID) ?? null
    const scoredHand = scoreHand(dealtHands[playerID] ?? [], playerID, 'initialDeal', 1, turnNumber)

    player.seatIndex = seatIndexByPlayerID.get(playerID) ?? player.seatIndex
    player.hand = scoredHand.remainingHand
    player.points = scoredHand.pointsAwarded
    player.scoredSets = scoredHand.scoredSets
    player.matchStats = createInitialPlayerMatchStats()
    player.pendingRevealPlayID = null
    player.hasUsedManualPlay = false
    player.hasUsedGrandmasterBSOverride = false
    player.hasLeft = false
    player.leaveOrder = null
  }

  state.round.startingPlayerID = getDefaultStartingPlayerID(state, shuffledSeatOrder[0] ?? state.hostPlayerID) ?? state.hostPlayerID
  state.archive.initial = createInitialArchiveState(state)

  appendHistoryEvent(
    state,
    'system',
    'Match initialized',
    `Shuffled ${shuffledSeatOrder.length} seat(s), selected ${state.deckConfig.selectedRanks.length} standard rank(s) (${state.deckConfig.selectedRanks.join(', ')}), included 2 Jokers, set game speed to ${state.speedMultiplier}x, dealt opening hands, ${state.useCharacters ? 'assigned character cards' : 'left character cards disabled'}, and ${formatPlayerLabel(state, state.round.startingPlayerID)} will act first.`,
    null,
    turnNumber,
  )

  for (const playerID of shuffledSeatOrder) {
    appendPointHistoryEvents(state, playerID, state.players[playerID].scoredSets, turnNumber)
  }

  updateRoundCapacity(state)
}

export function createInitialBlowCowState(
  numPlayers: number,
  shuffle?: BlowCowShuffle,
  setupData?: BlowCowSetupData,
): BlowCowState {
  const state = createStagedBlowCowState(numPlayers, shuffle, setupData)
  startMatchState(state, 0, shuffle)
  resolveRoundStart(state, {
    endGame: () => {},
    endTurn: () => {},
  }, 0)
  return state
}

export const BlowCowGame = {
  name: BLOW_COW_GAME_NAME,
  minPlayers: BLOW_COW_MIN_PLAYERS,
  maxPlayers: BLOW_COW_MAX_PLAYERS,
  setup: ({ ctx, random }: BlowCowSetupContext, setupData?: BlowCowSetupData): BlowCowState => createStagedBlowCowState(
    ctx.numPlayers,
    random?.Shuffle,
    setupData,
  ),
  validateSetupData: (setupData: BlowCowSetupData | undefined) => validateBlowCowSetupData(setupData),
  events: {
    endGame: true,
    endTurn: true,
  },
  turn: {
    onBegin: (context: BlowCowHookContext) => {
      handleTurnStart(context)
    },
  },
  moves: {
    startMatch: (context: BlowCowMoveContext) => {
      const { G, ctx, events, playerID, random } = context
      if (G.gameStatus !== 'staging' || playerID !== G.hostPlayerID) {
        return INVALID_MOVE
      }

      startMatchState(G, ctx.turn, random?.Shuffle)
      const nextStartingPlayerID = resolveRoundStart(G, events, ctx.turn)

      if (!nextStartingPlayerID) {
        return
      }

      if (ctx.currentPlayer === nextStartingPlayerID) {
        handleTurnStart({ G, ctx, events })
        return
      }

      events.endTurn({ next: nextStartingPlayerID })
    },
    selectTrumpAndPlay: {
      redact: true,
      move: (context: BlowCowMoveContext, args: BlowCowSelectTrumpAndPlayArgs) => {
        return performPlay(context, args?.cardIDs ?? [], args?.trumpRank ?? null)
      },
    },
    play: {
      redact: true,
      move: (context: BlowCowMoveContext, args: BlowCowPlayArgs) => {
        return performPlay(context, args?.cardIDs ?? [], null)
      },
    },
    playRandom: {
      redact: true,
      move: (context: BlowCowMoveContext, args?: BlowCowPlayRandomArgs) => {
        return resolveDrunkardRandomPlay(context, args)
      },
    },
    toggleDirection: (context: BlowCowMoveContext) => {
      return resolveContrarianToggleDirection(context)
    },
    catHideCard: (context: BlowCowMoveContext, args: BlowCowCatHideCardArgs) => {
      return resolveCatHideCard(context, args)
    },
    pass: (context: BlowCowMoveContext, args?: BlowCowPassArgs) => {
      const { G, ctx, playerID, events } = context
      if (G.gameStatus !== 'active' || G.bsResolution !== null || G.resetResolution !== null || isFinalTwoResolutionTurn(G, playerID)) {
        return INVALID_MOVE
      }

      const foreignerCard = resolveForeignerPassCard(context, args?.foreignerCardCode)
      if (foreignerCard === INVALID_MOVE) {
        return INVALID_MOVE
      }

      G.players[playerID].matchStats.passCount += 1
      G.round.passStreak += 1
      if (G.round.passStreak >= getActivePlayerCount(G)) {
        G.resetResolution = createResetResolution(G, playerID, 'roundReturn')
        G.tableStatus = `${formatPlayerLabel(G, playerID)} passed. Everyone passed, so the table cards are returning to their owners.`
        appendArchiveTurnAction(G, playerID, ctx.turn, {
          kind: 'pass',
          detail: 'Everyone passed, so the round will end after each active player takes back their own cards.',
          passStreak: G.round.passStreak,
          endedRound: true,
        })
        appendTelemetryEvent(
          G,
          'action',
          `${formatPlayerLabel(G, playerID)} ended the round with a pass`,
          'Everyone passed, so the round will end after each active player takes back their own cards.',
          playerID,
          ctx.turn,
        )
        return
      }

      appendHistoryEvent(
        G,
        'action',
        `${formatPlayerLabel(G, playerID)} passed`,
        `Pass streak is now ${G.round.passStreak} of ${getActivePlayerCount(G)}.`,
        playerID,
        ctx.turn,
      )
      appendArchiveTurnAction(G, playerID, ctx.turn, {
        kind: 'pass',
        detail: `Pass streak is now ${G.round.passStreak} of ${getActivePlayerCount(G)}.`,
        passStreak: G.round.passStreak,
        endedRound: false,
      })
      advanceTurn(G, events, playerID, ctx.turn)
    },
    callBS: (context: BlowCowMoveContext, args?: BlowCowCallBSArgs) => {
      return resolveBS(context, args)
    },
    finalizeBSResolution: (context: BlowCowMoveContext, args: BlowCowFinalizeBSResolutionArgs) => {
      return finalizeBSResolution(context, args)
    },
    callReset: (context: BlowCowMoveContext) => {
      return resolveReset(context)
    },
    finalizeResetResolution: (context: BlowCowMoveContext, args: BlowCowFinalizeResetResolutionArgs) => {
      return finalizeResetResolution(context, args)
    },
  },
  playerView: ({ G, playerID }: { G: BlowCowState; playerID: string | null }) => {
    return hideSecretState(G, playerID)
  },
}