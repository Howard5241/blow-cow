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
/**
 * boardgame.io's `Stage.NULL`, which is the literal `null`: a player who is active but in no stage.
 *
 * Spelled out rather than imported from `boardgame.io/core`, because that specifier resolves only
 * through a bundler and this module is also loaded directly by node for `npm run check:gameplay`.
 * Keeping the game module free of runtime dependencies is deliberate. The cast exists only because
 * `StageArg` is typed as a stage name; upstream types its own constant as `any` for the same reason.
 */
const NULL_STAGE = null as unknown as string

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
  /** One accusation per player per round, spent whether or not it lands. Cleared by `beginNextRound`. */
  hasUsedAccusationThisRound: boolean
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
  accusationCount: number
  accusationWinCount: number
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

/**
 * Withheld from clients by `hideSecretState` until the accused's reveal step is confirmed.
 *
 * A BS call asks one question only — were the hidden cards really the claimed rank. The Dreamer's
 * rule-breaking is not part of it; that is what `accuseDreamer` is for.
 */
export type BlowCowBSTargetVerdict = {
  targetWasHonest: boolean
}

/** Withheld from clients by `hideSecretState` until every reveal step is confirmed. */
export type BlowCowBSPunishment = {
  reverseRuleTriggered: boolean
  punishedPlayerID: string
  unpunishedPlayerID: string
}

export const BLOW_COW_DREAMER_CHEAT_KINDS = [
  'directionChange',
  'sneakPlay',
  'extraCardCount',
  'exceededTableLimit',
  'repeatTrump',
] as const

export type BlowCowDreamerCheatKind = (typeof BLOW_COW_DREAMER_CHEAT_KINDS)[number]

/**
 * A Dreamer direction change waiting to be caught. Secret state: `hideSecretState` strips it, so no
 * client can tell whether the flip everyone just watched was The Contrarian acting legally on their
 * own turn or The Dreamer reaching into someone else's.
 */
export type BlowCowDirectionTamper = {
  playerID: string
  /** The accusation window. A tamper is only catchable while `ctx.turn` still matches. */
  turnNumber: number
}

/**
 * A live accusation. It freezes every other move until the accuser resolves it, so unlike a BS call
 * it can be raised out of turn without letting two procedures overlap. The outcome is public from
 * the moment it is raised — there is nothing to reveal, so nothing to withhold.
 *
 * Either way round it ends in a punishment: a caught Dreamer takes the table, and so does an accuser
 * who was wrong. Only `punishedPlayerID` differs between the two.
 */
export type BlowCowAccusation = {
  id: string
  accuserPlayerID: string
  targetPlayerID: string
  wasSuccessful: boolean
  /** The rule that was broken, or null when the accusation missed. */
  caughtCheat: BlowCowDreamerCheatKind | null
  punishmentCardCount: number
  /** The accused on a hit, the accuser on a miss. */
  punishedPlayerID: string
  /** Starts the next round, mirroring how a BS resolution hands the round on. */
  unpunishedPlayerID: string
  /** Set by `beginAccusationPunishment`; drives the punishment travel animation on every client. */
  isPunishing: boolean
}

/**
 * A live BS challenge. The caller drives the reveal by hand: one step per player holding face-down
 * table cards, each card flipped with `revealBSCard`, each step confirmed with `advanceBSReveal`.
 * The resolution deliberately carries no card faces — clients read them from `G.table.plays`, which
 * `hideSecretState` masks until the caller has actually flipped them.
 */
export type BlowCowBSResolution = BlowCowRevealWalk & {
  id: string
  callerPlayerID: string
  targetPlayerID: string
  targetPlayID: string
  targetDeclaredCardCount: number
  trumpRank: BlowCowRank
  punishmentCardCount: number
  /** Set by `beginBSPunishment`; drives the punishment travel animation on every client. */
  isPunishing: boolean
  targetVerdict: BlowCowBSTargetVerdict | null
  punishment: BlowCowBSPunishment | null
}

export type BlowCowTableReturnResolutionKind = 'reset' | 'roundReturn'

/**
 * The caller-driven walk shared by both table-reveal procedures. One step per player holding
 * face-down cards, in `revealOrder`; `revealStepIndex` is how many steps the caller has confirmed.
 */
export type BlowCowRevealWalk = {
  revealOrder: string[]
  revealStepIndex: number
}

export type BlowCowResetResolution = BlowCowRevealWalk & {
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
  | 'accuse'
  | 'resolveAccusation'
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
  accusation: BlowCowAccusation | null
  directionTamper: BlowCowDirectionTamper | null
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

export type BlowCowSneakPlayArgs = {
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

export type BlowCowAccuseDreamerArgs = {
  targetPlayerID: string
}

export type BlowCowBeginAccusationPunishmentArgs = {
  accusationID: string
}

export type BlowCowFinalizeAccusationArgs = {
  accusationID: string
}

export type BlowCowRevealBSCardArgs = {
  resolutionID: string
  cardID: string
}

export type BlowCowAdvanceBSRevealArgs = {
  resolutionID: string
}

export type BlowCowBeginBSPunishmentArgs = {
  resolutionID: string
}

export type BlowCowFinalizeBSResolutionArgs = {
  resolutionID: string
}

export type BlowCowRevealResetCardArgs = {
  resolutionID: string
  cardID: string
}

export type BlowCowAdvanceResetRevealArgs = {
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
    accusationCount: 0,
    accusationWinCount: 0,
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
    hasUsedAccusationThisRound: false,
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

export function isCardFaceUpOnTable(play: BlowCowTablePlay, cardID: string) {
  return (play.revealedAtTurn !== null || getRevealedCardIDSet(play).has(cardID))
    && !getRehiddenCardIDSet(play).has(cardID)
}

/**
 * Every card the table is actually showing face down, including Cat-rehidden ones. This is what the
 * BS reveal procedure walks. It deliberately differs from `getHiddenCardsForPlay`, which ignores
 * `rehiddenCardIDs` so that The Cat cannot manufacture new BS targets — see that helper.
 */
function getFaceDownCardsForPlay(play: BlowCowTablePlay) {
  return play.cards.filter((card) => !isCardFaceUpOnTable(play, card.id))
}

function getFaceDownTableCardsForPlayer(state: BlowCowState, playerID: string) {
  return state.table.plays
    .filter((play) => play.playerID === playerID)
    .flatMap((play) => getFaceDownCardsForPlay(play))
}

/**
 * Cards that still count as an unresolved play for BS targeting. Cat-rehidden cards are excluded on
 * purpose: re-hiding an already-revealed card must not make its owner challengeable again. Use
 * `getFaceDownCardsForPlay` when the question is "what is the table showing".
 */
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
  options: { skipPendingReveal?: boolean } = {},
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

  // The Dreamer's out-of-turn play skips this. Pending reveal means "the play you owe the table at
  // the start of your next turn", and overwriting the pointer would quietly retire the real play
  // they still owe — handing them a second, unasked-for power on top of the cheat.
  if (!options.skipPendingReveal) {
    state.players[playerID].pendingRevealPlayID = playID
  }
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

function didDreamerPlayExtraCards(state: BlowCowState, play: BlowCowTablePlay) {
  return isDreamer(state, play.playerID) && play.cards.length > (play.declaredCardCount ?? play.cards.length)
}

function didDreamerExceedTableLimit(state: BlowCowState, play: BlowCowTablePlay) {
  return isDreamer(state, play.playerID) && getTableCardCount(state.table) > state.round.maxCardsOnTable
}

/**
 * The play `playerID` put on the table during `turnNumber`, if any.
 *
 * Every legal route to the table is gated on `ctx.currentPlayer`, so a play here that belongs to
 * anyone but the player on the clock can only have been sneaked. That is deliberately derived
 * rather than recorded: a `wasSneakPlay` flag on the play would have to survive `hideSecretState`
 * to be useful to the server and would give the cheat away the moment it did not.
 */
function getPlayForPlayerAtTurn(state: BlowCowState, playerID: string, turnNumber: number) {
  return state.table.plays.find(
    (play) => play.playerID === playerID && play.playedAtTurn === turnNumber,
  ) ?? null
}

function getLatestPlayForPlayer(state: BlowCowState, playerID: string) {
  for (let playIndex = state.table.plays.length - 1; playIndex >= 0; playIndex -= 1) {
    if (state.table.plays[playIndex].playerID === playerID) {
      return state.table.plays[playIndex]
    }
  }

  return null
}

/**
 * The one Dreamer rule `targetPlayerID` is currently answerable for, or null when the accusation
 * would miss. Only `accuseDreamer` calls this — a BS call no longer looks at any of it.
 *
 * The windows differ because the cheats do. Tampering with the direction and reaching into someone
 * else's turn to play are properties of the turn they happened in, so they close when that turn
 * ends. The other three are properties of a play, and follow the play's own hidden lifetime:
 * catchable during the turn immediately after it was made, and gone once that turn is over.
 */
function getAccusableDreamerCheat(
  state: BlowCowState,
  targetPlayerID: string,
  currentPlayerID: string,
  turnNumber: number,
): BlowCowDreamerCheatKind | null {
  if (!isDreamer(state, targetPlayerID)) {
    return null
  }

  if (state.directionTamper?.playerID === targetPlayerID && state.directionTamper.turnNumber === turnNumber) {
    return 'directionChange'
  }

  if (targetPlayerID !== currentPlayerID && getPlayForPlayerAtTurn(state, targetPlayerID, turnNumber)) {
    return 'sneakPlay'
  }

  const latestPlay = getLatestPlayForPlayer(state, targetPlayerID)
  if (!latestPlay || latestPlay.playedAtTurn + 1 !== turnNumber) {
    return null
  }

  if (didDreamerPlayExtraCards(state, latestPlay)) {
    return 'extraCardCount'
  }

  if (didDreamerExceedTableLimit(state, latestPlay)) {
    return 'exceededTableLimit'
  }

  if (didDreamerRepeatPreviousTrump(state, latestPlay)) {
    return 'repeatTrump'
  }

  return null
}

/**
 * Whether a procedure currently owns the table. The three are mutually exclusive by construction:
 * each one's opening move refuses while either of the others is live, so nothing can start on top
 * of a resolution someone is still walking through by hand.
 */
export function isProcedureRunning(state: BlowCowState) {
  return state.bsResolution !== null || state.resetResolution !== null || state.accusation !== null
}

export function getDreamerCheatDescription(cheatKind: BlowCowDreamerCheatKind) {
  if (cheatKind === 'directionChange') {
    return 'changed the turn direction'
  }

  if (cheatKind === 'sneakPlay') {
    return 'slipped cards onto the table out of turn'
  }

  if (cheatKind === 'extraCardCount') {
    return 'played more cards than they declared'
  }

  if (cheatKind === 'exceededTableLimit') {
    return 'pushed the table past its card limit'
  }

  return 'reused the previous round trump on the opening play'
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

/**
 * The order a caller walks the table in: `startPlayerID` first, then around the ring against the
 * current turn direction, skipping anyone with nothing face down. Shared by both procedures — BS
 * starts at the accused, Reset at whoever called it. Frozen at call time so the direction flip in
 * `beginNextRound` cannot reorder a resolution that is already running.
 */
function getTableRevealOrder(state: BlowCowState, startPlayerID: string) {
  const revealDirection = toggleDirection(state.round.direction)
  const activePlayerIDs = getActivePlayerIDs(state)
  const visitOrder = [startPlayerID]

  for (let step = 1; step < state.seatOrder.length; step += 1) {
    const nextPlayerID = getNextActivePlayerID(
      visitOrder[visitOrder.length - 1],
      state.seatOrder,
      revealDirection,
      activePlayerIDs,
    )

    if (!nextPlayerID || nextPlayerID === startPlayerID) {
      break
    }

    visitOrder.push(nextPlayerID)
  }

  return visitOrder.filter((playerID) => getFaceDownTableCardsForPlayer(state, playerID).length > 0)
}

export function getRevealFocusedPlayerID(walk: BlowCowRevealWalk) {
  return walk.revealOrder[walk.revealStepIndex] ?? null
}

export function isRevealComplete(walk: BlowCowRevealWalk) {
  return walk.revealStepIndex >= walk.revealOrder.length
}

function createBSResolution(
  state: BlowCowState,
  callerPlayerID: string,
  targetPlayerID: string,
  targetPlay: BlowCowTablePlay,
  trumpRank: BlowCowRank,
) {
  // Honesty is now the whole question: were the hidden cards the rank they were claimed to be. The
  // Dreamer's rule-breaking is out of scope here and belongs to `accuseDreamer`, which is why the
  // Reverse Rule no longer has a Dreamer exception to make room for.
  const targetCharacter = state.players[targetPlayerID]?.character ?? null
  const targetWasHonest = targetPlay.cards.every((card) => isTrumpCard(card, trumpRank, targetCharacter))
  const reverseRuleTriggered = state.table.plays.flatMap((play) => {
    const playCharacter = state.players[play.playerID]?.character ?? null
    return play.cards.filter((card) => countsTowardReverseRule(card, trumpRank, playCharacter))
  }).length >= 4
  const defaultPunishedPlayerID = targetWasHonest ? callerPlayerID : targetPlayerID
  const punishedPlayerID = reverseRuleTriggered
    ? (defaultPunishedPlayerID === callerPlayerID ? targetPlayerID : callerPlayerID)
    : defaultPunishedPlayerID
  const unpunishedPlayerID = punishedPlayerID === callerPlayerID ? targetPlayerID : callerPlayerID

  return {
    id: `bs-${state.round.roundNumber}-${targetPlay.playedAtTurn}-${callerPlayerID}`,
    callerPlayerID,
    targetPlayerID,
    targetPlayID: targetPlay.id,
    targetDeclaredCardCount: targetPlay.declaredCardCount ?? targetPlay.cards.length,
    trumpRank,
    punishmentCardCount: getTableCardCount(state.table),
    revealOrder: getTableRevealOrder(state, targetPlayerID),
    revealStepIndex: 0,
    isPunishing: false,
    targetVerdict: {
      targetWasHonest,
    },
    punishment: {
      reverseRuleTriggered,
      punishedPlayerID,
      unpunishedPlayerID,
    },
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
    // Starts at the caller, unlike BS, which starts at the accused. The caller is filtered out if
    // they have nothing face down, so an all-pass return can begin at someone else entirely.
    revealOrder: getTableRevealOrder(state, callerPlayerID),
    revealStepIndex: 0,
  } satisfies BlowCowResetResolution
}

function buildTurnStatus(state: BlowCowState, currentPlayerID: string) {
  if (state.gameStatus !== 'active') {
    return state.tableStatus
  }

  if (state.accusation) {
    const { accuserPlayerID, targetPlayerID, wasSuccessful, caughtCheat, punishedPlayerID } = state.accusation
    const callLabel = `${formatPlayerLabel(state, accuserPlayerID)} accused ${formatPlayerLabel(state, targetPlayerID)} of cheating as The Dreamer.`
    const outcomeLabel = wasSuccessful && caughtCheat
      ? `They ${getDreamerCheatDescription(caughtCheat)}.`
      : 'The accusation missed.'

    return `${callLabel} ${outcomeLabel} ${formatPlayerLabel(state, punishedPlayerID)} must take the table.`
  }

  if (state.bsResolution) {
    // Broadcast prose, so it must never name the verdict before the caller has revealed it.
    const focusedPlayerID = getRevealFocusedPlayerID(state.bsResolution)
    const challengeLabel = `${formatPlayerLabel(state, state.bsResolution.callerPlayerID)} called BS on ${formatPlayerLabel(state, state.bsResolution.targetPlayerID)}.`

    return focusedPlayerID
      ? `${challengeLabel} Revealing ${formatPlayerLabel(state, focusedPlayerID)}'s cards.`
      : `${challengeLabel} Every card on the table is face up.`
  }

  if (state.resetResolution) {
    const focusedPlayerID = getRevealFocusedPlayerID(state.resetResolution)
    const callLabel = state.resetResolution.kind === 'roundReturn'
      ? `${formatPlayerLabel(state, state.resetResolution.callerPlayerID)} passed. Everyone passed, so the table cards are returning to their owners.`
      : `${formatPlayerLabel(state, state.resetResolution.callerPlayerID)} called Reset. Returning the table cards before redistributing them.`

    return focusedPlayerID
      ? `${callLabel} Revealing ${formatPlayerLabel(state, focusedPlayerID)}'s cards.`
      : `${callLabel} Every card on the table is face up.`
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
    ? ' Change Direction is also available, but Accuse can catch it before the turn ends.'
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
  state.accusation = null
  // Both are round-scoped: nothing from the old round stays accusable, and everyone gets their one
  // accusation back.
  state.directionTamper = null
  for (const player of Object.values(state.players)) {
    player.hasUsedAccusationThisRound = false
  }
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
  // The window on a direction tamper is the turn it happened in, so a new turn closes it.
  G.directionTamper = null
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
  currentPlayerID: string,
  cardIDs: string[],
  nextTrumpRank: BlowCowRank | null,
) {
  // Explicit because `turn.activePlayers` makes every seat framework-active; see the note there.
  if (currentPlayerID !== playerID) {
    return false
  }

  if (state.gameStatus !== 'active' || isProcedureRunning(state) || isFinalTwoResolutionTurn(state, playerID)) {
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
  if (!validateCommonPlay(G, playerID, ctx.currentPlayer, cardIDs, nextTrumpRank)) {
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
  // Only for labelling the archive action. The direction cheat itself is tracked on `directionTamper`
  // now that it is scoped to a turn rather than to a play, and can happen on a turn with no play.
  const usedDreamerDirectionChange = isDreamer(G, playerID) && G.directionTamper?.playerID === playerID
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
  const { G, ctx, playerID, random } = context

  // Guarded before the shuffle, not only inside `performPlay`, so an out-of-turn attempt cannot
  // burn a draw from the randomness plugin and shift every later shuffle in the match.
  if (ctx.currentPlayer !== playerID || !isDrunkard(G, playerID)) {
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

/**
 * The Dreamer reaching into someone else's turn to put cards on the table.
 *
 * Deliberately not routed through `performPlay`: almost everything that move does is wrong here.
 * A sneaked play ends nobody's turn, claims no new trump, breaks no pass streak, does not become
 * the latest non-passing play, and — the point of it — is never announced. It writes no history
 * event and no telemetry, so no callout fires and whatever the Dreamer was already saying stays up.
 *
 * What it does not do is hide. The cards land face down in front of the Dreamer for everyone to
 * see, and their hand count drops to match; the cheat lives or dies on whether anyone was watching
 * a player who was not supposed to be acting. That is why nothing here is secret state.
 */
function resolveDreamerSneakPlay(
  context: BlowCowMoveContext,
  args?: BlowCowSneakPlayArgs,
) {
  const { G, ctx, playerID } = context
  const cardIDs = args?.cardIDs ?? []

  if (G.gameStatus !== 'active' || isProcedureRunning(G)) {
    return INVALID_MOVE
  }

  if (!isDreamer(G, playerID) || G.players[playerID].hasLeft) {
    return INVALID_MOVE
  }

  // Reaching into another turn is the whole cheat. On their own turn the Dreamer just plays.
  if (ctx.currentPlayer === playerID) {
    return INVALID_MOVE
  }

  // A sneaked play never selects trump, so before the round has one there is nothing to claim.
  // Exactly one card: a handful appearing at once is the opposite of sleight of hand, and the
  // whole cheat rests on the table not noticing.
  if (G.round.trumpRank === null || cardIDs.length !== 1) {
    return INVALID_MOVE
  }

  // One per turn. `createPlay` derives the play id from the round, turn and player, so a second
  // one would collide with the first, and the accusation window stays a single yes or no.
  if (getPlayForPlayerAtTurn(G, playerID, ctx.turn)) {
    return INVALID_MOVE
  }

  const selectedCards = removeCardsFromPlayerHand(G, playerID, cardIDs)
  if (!selectedCards) {
    return INVALID_MOVE
  }

  const claimedRank = G.round.trumpRank
  const playerMatchStats = G.players[playerID].matchStats
  const wasHonest = selectedCards.every((card) => isTrumpCard(card, claimedRank, G.players[playerID].character))

  playerMatchStats.playCount += 1
  playerMatchStats.cardsPlayed += selectedCards.length
  if (!wasHonest) {
    playerMatchStats.lieCount += 1
  }

  createPlay(G, playerID, selectedCards, selectedCards.length, claimedRank, ctx.turn, false, {
    skipPendingReveal: true,
  })

  // Archive only. `hideSecretState` empties the archive before it reaches a client, so this is the
  // one record that can name the Dreamer without handing the accusation to everyone at the table.
  appendArchiveTurnAction(G, playerID, ctx.turn, {
    kind: 'play',
    detail: `Slipped ${formatCardLabel(selectedCards[0])} onto the table during ${formatPlayerLabel(G, ctx.currentPlayer)}'s turn, claiming ${claimedRank}. Accuse can catch this until that turn ends.`,
    characterUsed: 'The Dreamer',
    cards: selectedCards,
    declaredCardCount: selectedCards.length,
    claimedRank,
    wasHonest,
    playMode: 'manual',
    directionBefore: G.round.direction,
    directionAfter: G.round.direction,
  })
}

function resolveCatHideCard(
  context: BlowCowMoveContext,
  args?: BlowCowCatHideCardArgs,
) {
  const { G, ctx, playerID } = context
  if (G.gameStatus !== 'active' || isProcedureRunning(G) || ctx.currentPlayer !== playerID) {
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

/**
 * The Contrarian's legal flip and the Dreamer's illegal one share this move, and deliberately share
 * an announcement that names nobody. The Dreamer may reach into any player's turn, so the flip on
 * its own has to stay ambiguous: if the log named the player, everyone would know exactly who to
 * accuse and the cheat would be worth nothing. Anonymising only the Dreamer would be the same
 * giveaway in reverse, since an unattributed flip could then only be theirs. The archive, which
 * `hideSecretState` strips before any client sees it, still records who really did it.
 */
function resolveContrarianToggleDirection(
  context: BlowCowMoveContext,
) {
  const { G, ctx, playerID } = context
  if (G.gameStatus !== 'active' || isProcedureRunning(G)) {
    return INVALID_MOVE
  }

  const usedContrarian = isContrarian(G, playerID)
  const usedDreamer = isDreamer(G, playerID)
  if (!usedContrarian && !usedDreamer) {
    return INVALID_MOVE
  }

  // The Contrarian is still bound to their own turn. The Dreamer is not, which is the whole power.
  if (!usedDreamer && ctx.currentPlayer !== playerID) {
    return INVALID_MOVE
  }

  if (G.players[playerID].hasLeft) {
    return INVALID_MOVE
  }

  const directionBefore = G.round.direction
  G.round.direction = toggleDirection(G.round.direction)

  if (usedDreamer) {
    // Measured against the direction the *current* turn opened on, not the Dreamer's own last turn,
    // because the accusation window is that turn. Flipping back within the same turn erases the
    // tamper along with the advantage, exactly as it did when this was scoped to a play.
    const turnStartingDirection = G.players[ctx.currentPlayer]?.turnStartingDirection ?? null
    G.directionTamper = turnStartingDirection !== null && G.round.direction !== turnStartingDirection
      ? { playerID, turnNumber: ctx.turn }
      : null
  }

  const anonymousDetail = `The turn direction is now ${G.round.direction}.`
  appendHistoryEvent(G, 'action', 'The turn direction changed', anonymousDetail, null, ctx.turn)
  appendArchiveTurnAction(G, playerID, ctx.turn, {
    kind: 'toggleDirection',
    detail: usedContrarian
      ? `Changed the direction to ${G.round.direction}.`
      : `Changed the direction to ${G.round.direction} during ${formatPlayerLabel(G, ctx.currentPlayer)}'s turn. Accuse can catch this until that turn ends.`,
    characterUsed: usedContrarian ? 'The Contrarian' : 'The Dreamer',
    directionBefore,
    directionAfter: G.round.direction,
  })
  G.tableStatus = buildTurnStatus(G, ctx.currentPlayer)
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
  const { G, ctx, playerID } = context
  // Call BS is still strictly a turn action, unlike Accuse.
  if (G.gameStatus !== 'active' || isProcedureRunning(G) || ctx.currentPlayer !== playerID) {
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

/**
 * Accusing The Dreamer of breaking one of their own rules. Unlike `callBS` this is not bound to the
 * accuser's turn — anyone may raise it at any time, which is the point: the cheats it catches happen
 * on other people's turns. What bounds it instead is the per-round budget and the narrow window each
 * cheat stays catchable for, both checked here.
 *
 * The accusation resolves immediately and publicly. A hit freezes the table until the accuser presses
 * Punish; a miss freezes it only for as long as the client takes to play the denial, then hands the
 * turn back untouched.
 */
function resolveAccuseDreamer(context: BlowCowMoveContext, args?: BlowCowAccuseDreamerArgs) {
  const { G, ctx, playerID } = context
  const targetPlayerID = args?.targetPlayerID ?? null

  if (G.gameStatus !== 'active' || isProcedureRunning(G)) {
    return INVALID_MOVE
  }

  if (!targetPlayerID || targetPlayerID === playerID || !G.players[targetPlayerID] || G.players[targetPlayerID].hasLeft) {
    return INVALID_MOVE
  }

  // Characters are public — every seat shows its own character card, and `hideSecretState` does not
  // mask `character` — so naming somebody who is not The Dreamer was never a gamble, only a wasted
  // accusation. Refused outright rather than resolved as a miss, so it costs nothing. What stays a
  // gamble is the part that is genuinely hidden: whether The Dreamer has actually cheated yet.
  if (!isDreamer(G, targetPlayerID)) {
    return INVALID_MOVE
  }

  if (G.players[playerID].hasLeft || G.players[playerID].hasUsedAccusationThisRound) {
    return INVALID_MOVE
  }

  const caughtCheat = getAccusableDreamerCheat(G, targetPlayerID, ctx.currentPlayer, ctx.turn)
  const wasSuccessful = caughtCheat !== null

  G.players[playerID].hasUsedAccusationThisRound = true
  G.players[playerID].matchStats.accusationCount += 1
  if (wasSuccessful) {
    G.players[playerID].matchStats.accusationWinCount += 1
  }

  G.accusation = {
    id: `accuse-${G.round.roundNumber}-${ctx.turn}-${playerID}-${targetPlayerID}`,
    accuserPlayerID: playerID,
    targetPlayerID,
    wasSuccessful,
    caughtCheat,
    punishmentCardCount: getTableCardCount(G.table),
    // Naming someone falsely costs the same as being caught, so an accusation is a real gamble
    // rather than a free question.
    punishedPlayerID: wasSuccessful ? targetPlayerID : playerID,
    unpunishedPlayerID: wasSuccessful ? playerID : targetPlayerID,
    isPunishing: false,
  }
  G.tableStatus = buildTurnStatus(G, ctx.currentPlayer)
  appendArchiveTurnAction(G, playerID, ctx.turn, {
    kind: 'accuse',
    detail: wasSuccessful
      ? `Accused ${formatPlayerLabel(G, targetPlayerID)} of cheating as The Dreamer and caught them: they ${getDreamerCheatDescription(caughtCheat)}.`
      : `Accused ${formatPlayerLabel(G, targetPlayerID)} of cheating as The Dreamer and missed.`,
    targetPlayerID,
    wasHonest: !wasSuccessful,
  })
  appendTelemetryEvent(
    G,
    'action',
    `${formatPlayerLabel(G, playerID)} accused ${formatPlayerLabel(G, targetPlayerID)}`,
    wasSuccessful ? 'The accusation landed.' : 'The accusation missed.',
    playerID,
    ctx.turn,
  )
}

function getDrivableAccusation(context: BlowCowMoveContext, accusationID: string) {
  const { G, playerID } = context

  if (G.gameStatus !== 'active' || !G.accusation || G.accusation.id !== accusationID) {
    return null
  }

  return playerID === G.accusation.accuserPlayerID ? G.accusation : null
}

/**
 * Arms the punishment travel on every client, for the same reason `beginBSPunishment` does: the
 * animation measures the front-card elements of cards that `finalizeAccusation` is about to clear
 * off the table.
 */
function beginAccusationPunishment(
  context: BlowCowMoveContext,
  args?: BlowCowBeginAccusationPunishmentArgs,
) {
  const accusation = args ? getDrivableAccusation(context, args.accusationID) : null

  // Armed on a miss too: the accuser presses Punish on their own block and takes the cards.
  if (!accusation || accusation.isPunishing) {
    return INVALID_MOVE
  }

  accusation.isPunishing = true
  context.G.tableStatus = buildTurnStatus(context.G, context.ctx.currentPlayer)
}

function finalizeAccusation(context: BlowCowMoveContext, args?: BlowCowFinalizeAccusationArgs) {
  const { G, ctx, events } = context
  const accusation = args ? getDrivableAccusation(context, args.accusationID) : null

  if (!accusation || !accusation.isPunishing) {
    return INVALID_MOVE
  }

  const { accuserPlayerID, targetPlayerID, caughtCheat, punishedPlayerID, unpunishedPlayerID } = accusation
  // Both endings take the whole table and end the round; only who takes it differs. A caught Dreamer
  // keeps the direction they forced — being punished is the whole consequence.
  const punishmentCards = getAllTableCards(G)
  const punishmentLabels = punishmentCards.map((card) => formatCardLabel(card))
  const verdictDetail = caughtCheat
    ? `${formatPlayerLabel(G, targetPlayerID)} ${getDreamerCheatDescription(caughtCheat)} as The Dreamer.`
    : `${formatPlayerLabel(G, targetPlayerID)} broke no Dreamer rule, so the false accusation cost ${formatPlayerLabel(G, accuserPlayerID)} the table.`
  const punishmentScoredSets = addCardsToPlayerHand(
    G,
    punishedPlayerID,
    punishmentCards,
    'punishment',
    ctx.turn,
    { deferPointHistory: true },
  )

  G.players[punishedPlayerID].matchStats.punishmentCount += 1
  G.accusation = null

  appendHistoryEvent(
    G,
    'verdict',
    accusation.wasSuccessful
      ? `${formatPlayerLabel(G, accuserPlayerID)} caught ${formatPlayerLabel(G, targetPlayerID)} cheating`
      : `${formatPlayerLabel(G, accuserPlayerID)} wrongly accused ${formatPlayerLabel(G, targetPlayerID)}`,
    verdictDetail,
    accusation.wasSuccessful ? targetPlayerID : accuserPlayerID,
    ctx.turn,
  )
  appendHistoryEvent(
    G,
    'punishment',
    `${formatPlayerLabel(G, punishedPlayerID)} took ${punishmentCards.length} card(s)`,
    punishmentCards.length > 0
      ? `Took ${punishmentLabels.join(', ')}.`
      : 'The table was empty, so there was nothing to take.',
    punishedPlayerID,
    ctx.turn,
  )
  appendArchiveTurnAction(G, accuserPlayerID, ctx.turn, {
    kind: 'resolveAccusation',
    detail: verdictDetail,
    targetPlayerID,
    cards: punishmentCards,
    cardsByPlayer: createCardsByPlayerRecord([[punishedPlayerID, punishmentCards]]),
    wasHonest: !accusation.wasSuccessful,
    punishedPlayerID,
    unpunishedPlayerID,
  })
  appendPointHistoryEvents(G, punishedPlayerID, punishmentScoredSets, ctx.turn)

  beginNextRound(
    G,
    unpunishedPlayerID,
    `${verdictDetail} ${formatPlayerLabel(G, unpunishedPlayerID)} starts the next round.`,
  )

  const nextStartingPlayerID = resolveRoundStart(G, events, ctx.turn)
  if (nextStartingPlayerID) {
    events.endTurn({ next: nextStartingPlayerID })
  }
}

/**
 * Shared entry guard for every interactive reveal move. Only the caller drives a procedure, and by
 * design there is no timeout fallback — a caller who drops recovers through the same-name rejoin
 * route rather than the table auto-advancing without them.
 */
function getDrivableResolution<Resolution extends { id: string; callerPlayerID: string }>(
  context: BlowCowMoveContext,
  resolution: Resolution | null,
  resolutionID: string,
) {
  if (context.G.gameStatus !== 'active' || !resolution || resolution.id !== resolutionID) {
    return null
  }

  return context.playerID === resolution.callerPlayerID ? resolution : null
}

/**
 * Flips one face-down card in the focused player's area. Shared by both procedures: the caller
 * clicks a card, the server writes the table play's own reveal state, and every client picks the
 * flip up through `playerView` and the existing reveal watcher.
 */
function resolveRevealTableCard(
  context: BlowCowMoveContext,
  walk: BlowCowRevealWalk & { callerPlayerID: string },
  cardID: string,
) {
  const { G } = context
  const play = G.table.plays.find((tablePlay) => tablePlay.cards.some((card) => card.id === cardID))

  if (!play || play.playerID !== getRevealFocusedPlayerID(walk) || isCardFaceUpOnTable(play, cardID)) {
    return INVALID_MOVE
  }

  play.revealedCardIDs = [...new Set([...(play.revealedCardIDs ?? []), cardID])]
  // A Cat-rehidden card stays face down until it leaves that set too, so flipping must clear both.
  play.rehiddenCardIDs = (play.rehiddenCardIDs ?? []).filter((rehiddenCardID) => rehiddenCardID !== cardID)
  G.tableStatus = buildTurnStatus(G, walk.callerPlayerID)
}

/**
 * Confirms the focused player's step. Only legal once they have nothing left face down, so the
 * Continue button is server-authoritative rather than trusted from the caller's client.
 */
function resolveAdvanceReveal(
  context: BlowCowMoveContext,
  walk: BlowCowRevealWalk & { callerPlayerID: string },
) {
  const { G } = context
  const focusedPlayerID = getRevealFocusedPlayerID(walk)

  if (!focusedPlayerID || getFaceDownTableCardsForPlayer(G, focusedPlayerID).length > 0) {
    return INVALID_MOVE
  }

  walk.revealStepIndex += 1
  G.tableStatus = buildTurnStatus(G, walk.callerPlayerID)
}

function revealBSCard(context: BlowCowMoveContext, args?: BlowCowRevealBSCardArgs) {
  const resolution = args ? getDrivableResolution(context, context.G.bsResolution, args.resolutionID) : null

  if (!args || !resolution || resolution.isPunishing || isRevealComplete(resolution)) {
    return INVALID_MOVE
  }

  return resolveRevealTableCard(context, resolution, args.cardID)
}

function advanceBSReveal(context: BlowCowMoveContext, args?: BlowCowAdvanceBSRevealArgs) {
  const resolution = args ? getDrivableResolution(context, context.G.bsResolution, args.resolutionID) : null

  if (!resolution || resolution.isPunishing || isRevealComplete(resolution)) {
    return INVALID_MOVE
  }

  return resolveAdvanceReveal(context, resolution)
}

function revealResetCard(context: BlowCowMoveContext, args?: BlowCowRevealResetCardArgs) {
  const resolution = args ? getDrivableResolution(context, context.G.resetResolution, args.resolutionID) : null

  if (!args || !resolution || isRevealComplete(resolution)) {
    return INVALID_MOVE
  }

  return resolveRevealTableCard(context, resolution, args.cardID)
}

function advanceResetReveal(context: BlowCowMoveContext, args?: BlowCowAdvanceResetRevealArgs) {
  const resolution = args ? getDrivableResolution(context, context.G.resetResolution, args.resolutionID) : null

  if (!resolution || isRevealComplete(resolution)) {
    return INVALID_MOVE
  }

  return resolveAdvanceReveal(context, resolution)
}

/**
 * Arms the punishment travel animation on every client. It is separate from `finalizeBSResolution`
 * because that move empties `G.table.plays`, and the animation measures the front-card elements
 * those cards render. It also makes the travel survive a reconnect: a client that remounts with
 * `isPunishing` set replays it and re-arms the finalize.
 */
function beginBSPunishment(context: BlowCowMoveContext, args?: BlowCowBeginBSPunishmentArgs) {
  const { G } = context
  const resolution = args ? getDrivableResolution(context, G.bsResolution, args.resolutionID) : null

  if (!resolution || resolution.isPunishing || !isRevealComplete(resolution)) {
    return INVALID_MOVE
  }

  if (G.table.plays.some((play) => getFaceDownCardsForPlay(play).length > 0)) {
    return INVALID_MOVE
  }

  resolution.isPunishing = true
  G.tableStatus = buildTurnStatus(G, resolution.callerPlayerID)
}

function finalizeBSResolution(
  context: BlowCowMoveContext,
  args?: BlowCowFinalizeBSResolutionArgs,
) {
  const { G, ctx, events, playerID } = context
  const resolution = G.bsResolution

  if (!resolution || (args?.resolutionID && resolution.id !== args.resolutionID)) {
    return INVALID_MOVE
  }

  const { targetVerdict, punishment } = resolution

  if (
    playerID !== resolution.callerPlayerID
    || !isRevealComplete(resolution)
    || !targetVerdict
    || !punishment
  ) {
    return INVALID_MOVE
  }

  // Rebuilt from the table rather than carried on the resolution, which holds no card faces so that
  // `hideSecretState` has nothing to leak. This runs before `beginNextRound` clears the table.
  const targetPlayCards = G.table.plays.find((play) => play.id === resolution.targetPlayID)?.cards ?? []
  const additionalRevealPlays: BlowCowBSRevealPlay[] = G.table.plays
    .filter((play) => play.id !== resolution.targetPlayID && resolution.revealOrder.includes(play.playerID))
    .map((play) => ({
      playID: play.id,
      playerID: play.playerID,
      cards: play.cards,
    }))
  const punishmentCards = getAllTableCards(G)
  const punishmentLabels = punishmentCards.map((card) => formatCardLabel(card))
  const revealedTargetLabels = targetPlayCards.map((card) => formatCardLabel(card))
  const targetCharacter = G.players[resolution.targetPlayerID]?.character ?? null
  const targetLiedAboutCards = targetPlayCards.some((card) => !isTrumpCard(card, resolution.trumpRank, targetCharacter))
  const outcomeDetail = punishment.reverseRuleTriggered
    ? `Four or more ${resolution.trumpRank}s were on the table, so the punishment was reversed.`
    : `Fewer than four ${resolution.trumpRank}s were on the table, so the default punishment stood.`
  const cardLieDetail = targetLiedAboutCards
    ? ' The hidden play was not all trump.'
    : ''
  const verdictDetail = targetVerdict.targetWasHonest
    ? `${formatPlayerLabel(G, resolution.targetPlayerID)} was honest. ${outcomeDetail}`
    : `${formatPlayerLabel(G, resolution.targetPlayerID)} was dishonest.${cardLieDetail} ${outcomeDetail}`
  const punishmentScoredSets = addCardsToPlayerHand(
    G,
    punishment.punishedPlayerID,
    punishmentCards,
    'punishment',
    ctx.turn,
    { deferPointHistory: true },
  )

  G.players[punishment.punishedPlayerID].matchStats.punishmentCount += 1
  if (punishment.unpunishedPlayerID === resolution.callerPlayerID) {
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
    `${formatPlayerLabel(G, punishment.punishedPlayerID)} took ${punishmentCards.length} card(s)`,
    `Took ${punishmentLabels.join(', ')}. Revealed play: ${revealedTargetLabels.join(', ')}.`,
    punishment.punishedPlayerID,
    ctx.turn,
  )
  appendArchiveTurnAction(G, resolution.callerPlayerID, ctx.turn, {
    kind: 'resolveBS',
    detail: `${verdictDetail} Revealed in order: ${resolution.revealOrder.map((revealPlayerID) => formatPlayerLabel(G, revealPlayerID)).join(', ')}.`,
    targetPlayerID: resolution.targetPlayerID,
    cards: targetPlayCards,
    cardsByPlayer: createCardsByPlayerRecord([
      [punishment.punishedPlayerID, punishmentCards],
    ]),
    declaredCardCount: resolution.targetDeclaredCardCount,
    claimedRank: resolution.trumpRank,
    wasHonest: targetVerdict.targetWasHonest,
    punishedPlayerID: punishment.punishedPlayerID,
    unpunishedPlayerID: punishment.unpunishedPlayerID,
    additionalRevealPlays,
  })
  appendPointHistoryEvents(G, punishment.punishedPlayerID, punishmentScoredSets, ctx.turn)

  beginNextRound(
    G,
    punishment.unpunishedPlayerID,
    `BS resolved. ${formatPlayerLabel(G, punishment.unpunishedPlayerID)} starts the next round.`,
  )

  const nextStartingPlayerID = resolveRoundStart(G, events, ctx.turn)
  if (nextStartingPlayerID) {
    events.endTurn({ next: nextStartingPlayerID })
  }
}

function resolveReset(context: BlowCowMoveContext) {
  const { G, ctx, playerID } = context
  if (G.gameStatus !== 'active' || isProcedureRunning(G) || ctx.currentPlayer !== playerID || getTableCardCount(G.table) < G.round.maxCardsOnTable) {
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

  if (
    !resolution
    || (args?.resolutionID && resolution.id !== args.resolutionID)
    || resolution.callerPlayerID !== playerID
    || !isRevealComplete(resolution)
  ) {
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

  // The verdict is the outcome, so masking the card faces alone would not hide anything. Each half
  // unlocks only once the caller has actually revealed enough of the table to have earned it, and
  // `revealOrder[0]` is always the accused, so index >= 1 means their step is confirmed.
  const nextBSResolution = state.bsResolution === null
    ? null
    : {
        ...state.bsResolution,
        targetVerdict: state.bsResolution.revealStepIndex >= 1 ? state.bsResolution.targetVerdict : null,
        punishment: isRevealComplete(state.bsResolution) ? state.bsResolution.punishment : null,
      }

  return {
    ...state,
    archive: createEmptyArchiveState(),
    bsResolution: nextBSResolution,
    // Never leaves the server. Everyone watches the direction indicator flip, but knowing who did it
    // is the whole gamble an accusation takes, and the tamper record is the answer written down.
    directionTamper: null,
    players: nextPlayers,
    table: {
      plays: state.table.plays.map((play) => ({
        ...play,
        // No resolution-wide exemption: both BS and Reset now open the table one card at a time,
        // through the caller writing `revealedCardIDs`. Flipping everything face up the moment a
        // resolution started would give the answer away before anyone had turned a card.
        cards: play.cards.map((card) => {
          const isVisible = !getRehiddenCardIDSet(play).has(card.id)
            && (
              play.playerID === playerID
              || play.revealedAtTurn !== null
              || getRevealedCardIDSet(play).has(card.id)
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
    accusation: null,
    directionTamper: null,
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
  state.accusation = null
  state.directionTamper = null
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
    player.hasUsedAccusationThisRound = false
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
    /*
     * Every seat is permanently "active" as far as boardgame.io is concerned, which makes this game
     * the sole authority on turn order.
     *
     * Without this, `IsPlayerActive` falls back to `ctx.currentPlayer === playerID` and the
     * framework silently drops every move from anyone else — and `BoardProps.isActive` goes false
     * on their client too. That is fatal for the powers that are defined by acting out of turn: The
     * Dreamer flipping the direction or slipping cards onto the table during somebody else's turn,
     * and anyone raising an accusation.
     *
     * The cost is that each move must now enforce the turn itself. `performPlay`,
     * `resolveDrunkardRandomPlay`, `pass`, `callBS` and `callReset` all check `ctx.currentPlayer`
     * explicitly for that reason; the procedure moves are stricter still, being caller-only. Any new
     * move that belongs to the current player has to carry its own guard. `sneakPlay` carries the
     * inverse one, refusing when the mover *is* on the clock.
     */
    activePlayers: { all: NULL_STAGE },
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
    sneakPlay: {
      redact: true,
      move: (context: BlowCowMoveContext, args: BlowCowSneakPlayArgs) => {
        return resolveDreamerSneakPlay(context, args)
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
      if (G.gameStatus !== 'active' || isProcedureRunning(G) || ctx.currentPlayer !== playerID || isFinalTwoResolutionTurn(G, playerID)) {
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
    callBS: {
      /*
       * Never predicted locally. In multiplayer boardgame.io deliberately skips `playerView` when
       * replaying a move on the client, so an optimistic run would judge the hidden play against
       * masked cards and briefly publish a made-up `targetWasHonest` to the caller.
       */
      client: false,
      move: (context: BlowCowMoveContext, args?: BlowCowCallBSArgs) => {
        return resolveBS(context, args)
      },
    },
    accuseDreamer: {
      /*
       * Same reason, and here it is not merely cosmetic: the verdict turns on `G.directionTamper`,
       * which `hideSecretState` strips entirely. A locally predicted accusation therefore *always*
       * decides "missed", and the client cannot tell that apart from a real miss.
       */
      client: false,
      move: (context: BlowCowMoveContext, args: BlowCowAccuseDreamerArgs) => {
        return resolveAccuseDreamer(context, args)
      },
    },
    beginAccusationPunishment: (context: BlowCowMoveContext, args: BlowCowBeginAccusationPunishmentArgs) => {
      return beginAccusationPunishment(context, args)
    },
    finalizeAccusation: (context: BlowCowMoveContext, args: BlowCowFinalizeAccusationArgs) => {
      return finalizeAccusation(context, args)
    },
    revealBSCard: (context: BlowCowMoveContext, args: BlowCowRevealBSCardArgs) => {
      return revealBSCard(context, args)
    },
    advanceBSReveal: (context: BlowCowMoveContext, args: BlowCowAdvanceBSRevealArgs) => {
      return advanceBSReveal(context, args)
    },
    beginBSPunishment: (context: BlowCowMoveContext, args: BlowCowBeginBSPunishmentArgs) => {
      return beginBSPunishment(context, args)
    },
    finalizeBSResolution: (context: BlowCowMoveContext, args: BlowCowFinalizeBSResolutionArgs) => {
      return finalizeBSResolution(context, args)
    },
    callReset: (context: BlowCowMoveContext) => {
      return resolveReset(context)
    },
    revealResetCard: (context: BlowCowMoveContext, args: BlowCowRevealResetCardArgs) => {
      return revealResetCard(context, args)
    },
    advanceResetReveal: (context: BlowCowMoveContext, args: BlowCowAdvanceResetRevealArgs) => {
      return advanceResetReveal(context, args)
    },
    finalizeResetResolution: (context: BlowCowMoveContext, args: BlowCowFinalizeResetResolutionArgs) => {
      return finalizeResetResolution(context, args)
    },
  },
  playerView: ({ G, playerID }: { G: BlowCowState; playerID: string | null }) => {
    return hideSecretState(G, playerID)
  },
}