import assert from 'node:assert/strict'
import { BLOW_COW_IMPLEMENTED_CHARACTER_NAMES, type BlowCowCharacterName } from '../src/game/blowCowCharacters.ts'
import {
  BlowCowGame,
  type BlowCowCallBSArgs,
  type BlowCowCatHideCardArgs,
  createDeck,
  createInitialBlowCowState,
  DEFAULT_BLOW_COW_SPEED_MULTIPLIER,
  type BlowCowFinalizeResetResolutionArgs,
  getDefaultStandardRankCount,
  type BlowCowCard,
  type BlowCowFinalizeBSResolutionArgs,
  type BlowCowGameOver,
  type BlowCowPassArgs,
  type BlowCowPlayRandomArgs,
  type BlowCowRank,
  scoreHand,
  type BlowCowSetupData,
  type BlowCowState,
} from '../src/game/blowCowGame.ts'

type TestContext = {
  G: BlowCowState
  ctx: {
    currentPlayer: string
    turn: number
  }
  events: {
    endGame: (gameover?: BlowCowGameOver) => void
    endTurn: (arg?: { next: string }) => void
  }
  playerID: string
  random?: {
    Shuffle?: <Value>(values: Value[]) => Value[]
  }
}

const deckBySprite = new Map(createDeck().map((card) => [card.sprite, card]))

const passMove = BlowCowGame.moves.pass as (context: TestContext, args?: BlowCowPassArgs) => unknown
const callBSMove = BlowCowGame.moves.callBS as (context: TestContext, args?: BlowCowCallBSArgs) => unknown
const selectTrumpAndPlayMove = BlowCowGame.moves.selectTrumpAndPlay.move as (
  context: TestContext,
  args: { trumpRank: BlowCowRank; cardIDs: string[] },
) => unknown
const startMatchMove = BlowCowGame.moves.startMatch as (context: TestContext) => unknown
const playMove = BlowCowGame.moves.play.move as (
  context: TestContext,
  args: { cardIDs: string[] },
) => unknown
const playRandomMove = BlowCowGame.moves.playRandom.move as (
  context: TestContext,
  args: BlowCowPlayRandomArgs,
) => unknown
const toggleDirectionMove = BlowCowGame.moves.toggleDirection as (context: TestContext) => unknown
const catHideCardMove = BlowCowGame.moves.catHideCard as (
  context: TestContext,
  args: BlowCowCatHideCardArgs,
) => unknown
const finalizeBSResolutionMove = BlowCowGame.moves.finalizeBSResolution as (
  context: TestContext,
  args: BlowCowFinalizeBSResolutionArgs,
) => unknown
const callResetMove = BlowCowGame.moves.callReset as (context: TestContext) => unknown
const finalizeResetResolutionMove = BlowCowGame.moves.finalizeResetResolution as (
  context: TestContext,
  args: BlowCowFinalizeResetResolutionArgs,
) => unknown
const beginTurn = BlowCowGame.turn.onBegin as (context: Omit<TestContext, 'playerID' | 'random'>) => unknown

function identityShuffle<Value>(values: Value[]) {
  return [...values]
}

function reverseShuffle<Value>(values: Value[]) {
  return [...values].reverse()
}

function card(sprite: string): BlowCowCard {
  const foundCard = deckBySprite.get(sprite)
  assert.ok(foundCard, `Expected to find card sprite ${sprite}.`)

  return { ...foundCard }
}

function createScenarioState(numPlayers = 2): BlowCowState {
  const state = createInitialBlowCowState(numPlayers, identityShuffle)

  state.tableStatus = 'Scenario state'
  state.gameStatus = 'active'
  state.history = []
  state.telemetry = {
    events: [],
  }
  state.placements = []
  state.table.plays = []
  state.round.roundNumber = 1
  state.round.status = 'inProgress'
  state.round.direction = 'clockwise'
  state.round.startingPlayerID = '0'
  state.round.pendingStartingPlayerID = null
  state.round.trumpRank = null
  state.round.previousTrumpRank = null
  state.round.passStreak = 0
  state.round.lastNonPassingPlayerID = null
  state.round.maxCardsOnTable = 10

  for (const playerID of state.seatOrder) {
    state.players[playerID].character = 'The Believer'
    state.players[playerID].hand = []
    state.players[playerID].points = 0
    state.players[playerID].scoredSets = []
    state.players[playerID].matchStats = {
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
    state.players[playerID].pendingRevealPlayID = null
    state.players[playerID].hasUsedManualPlay = false
    state.players[playerID].hasUsedGrandmasterBSOverride = false
    state.players[playerID].hasLeft = false
    state.players[playerID].leaveOrder = null
  }

  return state
}

function createEventRecorder() {
  const record = {
    endedGame: null as BlowCowGameOver | null,
    nextPlayerID: null as string | null,
  }

  return {
    events: {
      endGame: (gameover?: BlowCowGameOver) => {
        record.endedGame = gameover ?? null
      },
      endTurn: (arg?: { next: string }) => {
        record.nextPlayerID = arg?.next ?? null
      },
    },
    record,
  }
}

function assertCardSet(actualCards: BlowCowCard[], expectedSprites: string[]) {
  assert.deepEqual(
    actualCards.map((entry) => entry.sprite).sort(),
    [...expectedSprites].sort(),
  )
}

function runBSResolutionCheck() {
  const state = createScenarioState()
  state.players['0'].hand = [card('clubs_ace.png')]
  state.players['1'].hand = [card('clubs_07.png'), card('diamonds_07.png'), card('hearts_07.png'), card('spades_king.png')]
  state.round.trumpRank = 'Q'
  state.round.lastNonPassingPlayerID = '1'
  state.table.plays = [
    {
      id: 'play-0',
      playerID: '0',
      cards: [card('clubs_03.png')],
      claimedRank: 'Q',
      playedAtRound: 1,
      playedAtTurn: 2,
      revealedAtTurn: 3,
      wasTrumpSelection: false,
    },
    {
      id: 'play-1',
      playerID: '1',
      cards: [card('spades_07.png')],
      claimedRank: 'Q',
      playedAtRound: 1,
      playedAtTurn: 4,
      revealedAtTurn: null,
      wasTrumpSelection: false,
    },
  ]
  state.players['1'].pendingRevealPlayID = 'play-1'

  const { events, record } = createEventRecorder()
  const callResult = callBSMove({
    G: state,
    ctx: {
      currentPlayer: '0',
      turn: 5,
    },
    events,
    playerID: '0',
  })

  assert.equal(callResult, undefined)
  assert.equal(record.endedGame, null)
  assert.equal(record.nextPlayerID, null)
  assert.equal(state.history.length, 0)
  assert.equal(state.round.roundNumber, 1)
  assert.ok(state.bsResolution)
  assert.equal(state.players['0'].matchStats.callBSCount, 1)
  assert.equal(state.bsResolution?.callerPlayerID, '0')
  assert.equal(state.bsResolution?.targetPlayerID, '1')
  assert.equal(state.bsResolution?.targetPlayID, 'play-1')
  assert.equal(state.bsResolution?.targetPlayCards.length, 1)
  assert.equal(state.bsResolution?.additionalRevealPlays.length, 0)
  assert.equal(state.table.plays.length, 2)

  const finalizeResult = finalizeBSResolutionMove({
    G: state,
    ctx: {
      currentPlayer: '0',
      turn: 5,
    },
    events,
    playerID: '0',
  }, {
    resolutionID: state.bsResolution.id,
  })

  assert.equal(finalizeResult, undefined)
  assert.equal(record.endedGame, null)
  assert.equal(record.nextPlayerID, '0')
  assert.equal(state.round.roundNumber, 2)
  assert.equal(state.round.direction, 'counterclockwise')
  assert.equal(state.round.trumpRank, null)
  assert.equal(state.round.previousTrumpRank, 'Q')
  assert.equal(state.round.startingPlayerID, '0')
  assert.equal(state.table.plays.length, 0)
  assert.equal(state.bsResolution, null)
  assert.equal(state.players['1'].pendingRevealPlayID, null)
  assert.equal(state.players['1'].points, 1)
  assert.equal(state.players['0'].matchStats.bsWinCount, 1)
  assert.equal(state.players['1'].matchStats.punishmentCount, 1)
  assert.equal(state.players['0'].hand.length, 1)
  assertCardSet(state.players['1'].hand, ['spades_king.png', 'clubs_03.png'])
  assert.equal(state.history.length, 4)
  assert.deepEqual(state.history.map((entry) => entry.kind), ['action', 'verdict', 'punishment', 'point'])
  assert.match(state.history[3]?.detail ?? '', /Removed four 7s from hand\./)
  assert.match(state.tableStatus, /starts the next round/i)
}

function runPunishmentScoredOutImmediateLeaveCheck() {
  const state = createScenarioState()
  state.players['0'].hand = [card('clubs_ace.png')]
  state.players['1'].hand = []
  state.round.trumpRank = 'Q'
  state.round.lastNonPassingPlayerID = '1'
  state.table.plays = [
    {
      id: 'play-0',
      playerID: '0',
      cards: [card('clubs_07.png')],
      claimedRank: 'Q',
      playedAtRound: 1,
      playedAtTurn: 1,
      revealedAtTurn: 1,
      wasTrumpSelection: false,
    },
    {
      id: 'play-1',
      playerID: '0',
      cards: [card('diamonds_07.png')],
      claimedRank: 'Q',
      playedAtRound: 1,
      playedAtTurn: 2,
      revealedAtTurn: 2,
      wasTrumpSelection: false,
    },
    {
      id: 'play-2',
      playerID: '0',
      cards: [card('hearts_07.png')],
      claimedRank: 'Q',
      playedAtRound: 1,
      playedAtTurn: 3,
      revealedAtTurn: 3,
      wasTrumpSelection: false,
    },
    {
      id: 'play-3',
      playerID: '1',
      cards: [card('spades_07.png')],
      claimedRank: 'Q',
      playedAtRound: 1,
      playedAtTurn: 4,
      revealedAtTurn: null,
      wasTrumpSelection: false,
    },
  ]
  state.players['1'].pendingRevealPlayID = 'play-3'

  const { events, record } = createEventRecorder()
  const callResult = callBSMove({
    G: state,
    ctx: {
      currentPlayer: '0',
      turn: 5,
    },
    events,
    playerID: '0',
  })

  assert.equal(callResult, undefined)
  assert.ok(state.bsResolution)

  const finalizeResult = finalizeBSResolutionMove({
    G: state,
    ctx: {
      currentPlayer: '0',
      turn: 5,
    },
    events,
    playerID: '0',
  }, {
    resolutionID: state.bsResolution.id,
  })

  assert.equal(finalizeResult, undefined)
  assert.equal(record.nextPlayerID, null)
  assert.equal(record.endedGame?.winnerID, '0')
  assert.equal(state.gameStatus, 'finished')
  assert.equal(state.bsResolution, null)
  assert.equal(state.table.plays.length, 0)
  assert.equal(state.players['1'].points, 1)
  assert.equal(state.players['1'].hand.length, 0)
  assert.equal(state.players['1'].hasLeft, true)
  assert.equal(state.players['1'].leaveOrder, 1)
  assert.equal(state.players['0'].hasLeft, true)
  assert.equal(state.players['0'].leaveOrder, 2)
  assert.match(
    state.history.find((entry) => entry.playerID === '1' && entry.kind === 'leave')?.detail ?? '',
    /started the round with no cards in hand and left immediately/i,
  )
  assert.match(state.tableStatus, /last player remaining/i)
}

function runLeaveRemovesTableCardsCheck() {
  const state = createScenarioState(3)
  state.players['0'].hand = [card('clubs_ace.png')]
  state.players['1'].hand = []
  state.players['2'].hand = [card('spades_king.png')]
  state.round.trumpRank = 'Q'
  state.round.lastNonPassingPlayerID = '1'
  state.table.plays = [
    {
      id: 'play-0',
      playerID: '0',
      cards: [card('clubs_07.png')],
      claimedRank: 'Q',
      playedAtRound: 1,
      playedAtTurn: 1,
      revealedAtTurn: 1,
      wasTrumpSelection: false,
    },
    {
      id: 'play-1',
      playerID: '1',
      cards: [card('diamonds_queen.png'), card('hearts_queen.png')],
      claimedRank: 'Q',
      playedAtRound: 1,
      playedAtTurn: 2,
      revealedAtTurn: null,
      wasTrumpSelection: false,
    },
    {
      id: 'play-2',
      playerID: '2',
      cards: [card('spades_07.png')],
      claimedRank: 'Q',
      playedAtRound: 1,
      playedAtTurn: 3,
      revealedAtTurn: 3,
      wasTrumpSelection: false,
    },
  ]
  state.players['1'].pendingRevealPlayID = 'play-1'

  const { events, record } = createEventRecorder()
  beginTurn({
    G: state,
    ctx: {
      currentPlayer: '1',
      turn: 4,
    },
    events,
  })

  assert.equal(state.players['1'].hasLeft, true)
  assert.equal(state.gameStatus, 'active')
  assert.equal(record.nextPlayerID, '2')
  assert.deepEqual(state.table.plays.map((play) => play.id), ['play-0', 'play-2'])
  assertCardSet(state.table.plays.flatMap((play) => play.cards), ['clubs_07.png', 'spades_07.png'])
  assert.equal(state.players['1'].hand.length, 0)
  assert.equal(state.players['1'].points, 0)
  assert.equal(state.players['0'].hand.length, 1)
  assert.equal(state.players['2'].hand.length, 1)
  assert.match(
    state.history.find((event) => event.playerID === '1' && event.kind === 'system')?.detail ?? '',
    /removed from the game entirely/i,
  )

  const leaveAction = state.archive.turns
    .filter((archivedTurn) => archivedTurn.turnNumber === 4 && archivedTurn.playerID === '1')
    .flatMap((archivedTurn) => archivedTurn.actions)
    .find((action) => action.kind === 'leave')
  assertCardSet(leaveAction?.cards ?? [], ['diamonds_queen.png', 'hearts_queen.png'])
}

function runAllPassResetCheck() {
  const state = createScenarioState()
  state.players['0'].hand = [card('clubs_ace.png')]
  state.players['1'].hand = [card('spades_king.png')]
  state.round.trumpRank = 'J'
  state.round.passStreak = 1
  state.round.lastNonPassingPlayerID = '1'
  state.table.plays = [
    {
      id: 'play-0',
      playerID: '0',
      cards: [card('hearts_05.png')],
      claimedRank: 'J',
      playedAtRound: 1,
      playedAtTurn: 2,
      revealedAtTurn: 2,
      wasTrumpSelection: false,
    },
    {
      id: 'play-1',
      playerID: '1',
      cards: [card('diamonds_09.png'), card('clubs_03.png')],
      claimedRank: 'J',
      playedAtRound: 1,
      playedAtTurn: 3,
      revealedAtTurn: null,
      wasTrumpSelection: false,
    },
  ]
  state.players['1'].pendingRevealPlayID = 'play-1'

  const { events, record } = createEventRecorder()
  const result = passMove({
    G: state,
    ctx: {
      currentPlayer: '0',
      turn: 4,
    },
    events,
    playerID: '0',
  })

  assert.equal(result, undefined)
  assert.equal(record.endedGame, null)
  assert.equal(record.nextPlayerID, null)
  assert.ok(state.resetResolution)
  assert.equal(state.resetResolution?.callerPlayerID, '0')
  assert.equal(state.resetResolution?.kind, 'roundReturn')
  assert.equal(state.round.roundNumber, 1)
  assert.equal(state.table.plays.length, 2)
  assert.equal(state.history.length, 0)
  assert.match(state.tableStatus, /table cards are returning/i)

  const finalizeResult = finalizeResetResolutionMove({
    G: state,
    ctx: {
      currentPlayer: '0',
      turn: 4,
    },
    events,
    playerID: '0',
  }, {
    resolutionID: state.resetResolution.id,
  })

  assert.equal(finalizeResult, undefined)
  assert.equal(record.nextPlayerID, '0')
  assert.equal(state.round.roundNumber, 2)
  assert.equal(state.round.direction, 'counterclockwise')
  assert.equal(state.round.trumpRank, null)
  assert.equal(state.round.previousTrumpRank, 'J')
  assert.equal(state.round.passStreak, 0)
  assert.equal(state.round.lastNonPassingPlayerID, null)
  assert.equal(state.round.startingPlayerID, '0')
  assert.equal(state.table.plays.length, 0)
  assert.equal(state.resetResolution, null)
  assert.equal(state.players['0'].matchStats.passCount, 1)
  assert.equal(state.players['1'].pendingRevealPlayID, null)
  assertCardSet(state.players['0'].hand, ['clubs_ace.png', 'hearts_05.png'])
  assertCardSet(state.players['1'].hand, ['spades_king.png', 'diamonds_09.png', 'clubs_03.png'])
  assert.equal(state.history.length, 1)
  assert.equal(state.history[0]?.kind, 'action')
  assert.match(state.tableStatus, /new round begins/i)
}

function runResetRedistributionCheck() {
  const state = createScenarioState()
  state.players['0'].hand = [card('clubs_ace.png')]
  state.players['1'].hand = [card('spades_king.png')]
  state.round.trumpRank = 'A'
  state.round.lastNonPassingPlayerID = '1'
  state.round.maxCardsOnTable = 5
  state.table.plays = [
    {
      id: 'play-0',
      playerID: '0',
      cards: [card('hearts_02.png'), card('diamonds_04.png')],
      claimedRank: 'A',
      playedAtRound: 1,
      playedAtTurn: 1,
      revealedAtTurn: 2,
      wasTrumpSelection: false,
    },
    {
      id: 'play-1',
      playerID: '1',
      cards: [card('clubs_06.png'), card('spades_08.png'), card('hearts_10.png')],
      claimedRank: 'A',
      playedAtRound: 1,
      playedAtTurn: 3,
      revealedAtTurn: null,
      wasTrumpSelection: false,
    },
  ]
  state.players['1'].pendingRevealPlayID = 'play-1'

  const { events, record } = createEventRecorder()
  const result = callResetMove({
    G: state,
    ctx: {
      currentPlayer: '0',
      turn: 4,
    },
    events,
    playerID: '0',
    random: {
      Shuffle: identityShuffle,
    },
  })

  assert.equal(result, undefined)
  assert.equal(record.endedGame, null)
  assert.equal(record.nextPlayerID, null)
  assert.ok(state.resetResolution)
  assert.equal(state.resetResolution?.callerPlayerID, '0')
  assert.equal(state.round.roundNumber, 1)
  assert.equal(state.table.plays.length, 2)
  assert.equal(state.history.length, 0)
  assert.match(state.tableStatus, /called Reset/i)

  const finalizeResult = finalizeResetResolutionMove({
    G: state,
    ctx: {
      currentPlayer: '0',
      turn: 4,
    },
    events,
    playerID: '0',
    random: {
      Shuffle: identityShuffle,
    },
  }, {
    resolutionID: state.resetResolution.id,
  })

  assert.equal(finalizeResult, undefined)
  assert.equal(record.endedGame, null)
  assert.equal(record.nextPlayerID, '0')
  assert.equal(state.round.roundNumber, 2)
  assert.equal(state.round.direction, 'counterclockwise')
  assert.equal(state.round.trumpRank, null)
  assert.equal(state.round.previousTrumpRank, 'A')
  assert.equal(state.round.startingPlayerID, '0')
  assert.equal(state.table.plays.length, 0)
  assert.equal(state.resetResolution, null)
  assert.equal(state.players['0'].matchStats.resetCount, 1)
  assert.equal(state.players['1'].pendingRevealPlayID, null)
  assertCardSet(state.players['0'].hand, ['clubs_ace.png', 'hearts_02.png', 'diamonds_04.png', 'hearts_10.png'])
  assertCardSet(state.players['1'].hand, ['spades_king.png', 'clubs_06.png', 'spades_08.png'])
  assert.equal(state.history.length, 1)
  assert.equal(state.history[0]?.kind, 'action')
  assert.match(state.tableStatus, /called Reset/i)
  assert.ok(
    state.telemetry.events.some((event) => event.title.includes('called Reset')
      && event.handCountsByPlayer['0'] === 4
      && event.handCountsByPlayer['1'] === 3),
  )
}

function runFinalTwoResolutionWindowCheck() {
  const blockedState = createScenarioState()
  blockedState.players['0'].hand = [card('clubs_ace.png')]
  blockedState.players['1'].hand = []
  blockedState.round.trumpRank = 'A'
  blockedState.round.lastNonPassingPlayerID = '1'
  blockedState.round.maxCardsOnTable = 5
  blockedState.table.plays = [
    {
      id: 'play-0',
      playerID: '0',
      cards: [card('hearts_02.png'), card('diamonds_04.png')],
      claimedRank: 'A',
      playedAtRound: 1,
      playedAtTurn: 1,
      revealedAtTurn: 2,
      wasTrumpSelection: false,
    },
    {
      id: 'play-1',
      playerID: '1',
      cards: [card('clubs_06.png'), card('spades_08.png')],
      claimedRank: 'A',
      playedAtRound: 1,
      playedAtTurn: 3,
      revealedAtTurn: null,
      wasTrumpSelection: false,
    },
  ]
  blockedState.players['1'].pendingRevealPlayID = 'play-1'

  const { events: blockedEvents } = createEventRecorder()
  const playResult = playMove({
    G: blockedState,
    ctx: {
      currentPlayer: '0',
      turn: 4,
    },
    events: blockedEvents,
    playerID: '0',
  }, {
    cardIDs: [blockedState.players['0'].hand[0].id],
  })
  const passResult = passMove({
    G: blockedState,
    ctx: {
      currentPlayer: '0',
      turn: 4,
    },
    events: blockedEvents,
    playerID: '0',
  })
  const callBSResult = callBSMove({
    G: blockedState,
    ctx: {
      currentPlayer: '0',
      turn: 4,
    },
    events: blockedEvents,
    playerID: '0',
  })

  assert.notEqual(playResult, undefined)
  assert.notEqual(passResult, undefined)
  assert.equal(callBSResult, undefined)
  assert.equal(blockedState.bsResolution?.callerPlayerID, '0')
  assert.equal(blockedState.bsResolution?.targetPlayerID, '1')

  const resetState = createScenarioState()
  resetState.players['0'].hand = [card('clubs_ace.png')]
  resetState.players['1'].hand = []
  resetState.round.trumpRank = 'A'
  resetState.round.lastNonPassingPlayerID = '1'
  resetState.round.maxCardsOnTable = 5
  resetState.table.plays = [
    {
      id: 'play-0',
      playerID: '0',
      cards: [card('hearts_02.png'), card('diamonds_04.png')],
      claimedRank: 'A',
      playedAtRound: 1,
      playedAtTurn: 1,
      revealedAtTurn: 2,
      wasTrumpSelection: false,
    },
    {
      id: 'play-1',
      playerID: '1',
      cards: [card('clubs_06.png'), card('spades_08.png'), card('hearts_10.png')],
      claimedRank: 'A',
      playedAtRound: 1,
      playedAtTurn: 3,
      revealedAtTurn: null,
      wasTrumpSelection: false,
    },
  ]
  resetState.players['1'].pendingRevealPlayID = 'play-1'

  const { events: resetEvents } = createEventRecorder()
  const lockedPassResult = passMove({
    G: resetState,
    ctx: {
      currentPlayer: '0',
      turn: 4,
    },
    events: resetEvents,
    playerID: '0',
  })
  const callResetResult = callResetMove({
    G: resetState,
    ctx: {
      currentPlayer: '0',
      turn: 4,
    },
    events: resetEvents,
    playerID: '0',
    random: {
      Shuffle: identityShuffle,
    },
  })

  assert.notEqual(lockedPassResult, undefined)
  assert.equal(callResetResult, undefined)
  assert.equal(resetState.resetResolution?.callerPlayerID, '0')
}

function runDefaultRankSelectionCheck() {
  const state = createInitialBlowCowState(2, reverseShuffle)
  const allCards = Object.values(state.players).flatMap((player) => player.hand)

  assert.equal(state.deckConfig.rankSelectionMode, 'default')
  assert.equal(state.speedMultiplier, DEFAULT_BLOW_COW_SPEED_MULTIPLIER)
  assert.equal(state.deckConfig.defaultRankCount, getDefaultStandardRankCount(2))
  assert.equal(state.deckConfig.includesJokers, true)
  assert.deepEqual(state.deckConfig.selectedRanks, ['10', 'J', 'Q', 'K'])
  assert.ok(allCards.every((entry) => entry.rank === 'Joker' || state.deckConfig.selectedRanks.includes(entry.rank as BlowCowRank)))
}

function runCharacterAssignmentCheck() {
  const state = createInitialBlowCowState(5, reverseShuffle)
  const implementedCharacterNames = new Set<string>(BLOW_COW_IMPLEMENTED_CHARACTER_NAMES)

  for (const playerID of state.seatOrder) {
    assert.ok(state.players[playerID].character)
    assert.ok(implementedCharacterNames.has(state.players[playerID].character as BlowCowCharacterName))
  }
}

function runManualCharacterPoolCheck() {
  const setupData: BlowCowSetupData = {
    rankSelectionMode: 'manual',
    selectedRanks: ['J', 'Q', 'K'],
    useCharacters: true,
    characterPool: ['The Spy', 'The Drunkard'],
  }
  const state = createInitialBlowCowState(5, reverseShuffle, setupData)
  const allowedCharacters = new Set<BlowCowCharacterName>(setupData.characterPool)

  for (const playerID of state.seatOrder) {
    assert.ok(allowedCharacters.has(state.players[playerID].character as BlowCowCharacterName))
  }
}

function runForeignerRulesCheck() {
  {
    const state = createScenarioState()
    const { events, record } = createEventRecorder()

    state.players['0'].character = 'The Foreigner'
    state.players['0'].hand = [card('clubs_ace.png')]
    state.players['1'].hand = [card('spades_king.png')]
    state.round.trumpRank = 'Q'

    const passResult = passMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 1,
      },
      events,
      playerID: '0',
    }, {
      foreignerCardCode: 'joker',
    })

    assert.equal(passResult, undefined)
    assert.equal(record.nextPlayerID, '1')
    assert.equal(state.players['0'].matchStats.passCount, 1)
    assert.ok(state.players['0'].hand.some((entry) => entry.sprite === 'Joker1.png'))
    assert.match(
      state.history.find((entry) => entry.title.includes('used The Foreigner'))?.detail ?? '',
      /added Joker from outside the game to hand/i,
    )
  }

  {
    const state = createScenarioState()
    const { events } = createEventRecorder()

    state.players['0'].hand = [card('clubs_ace.png')]
    state.players['1'].hand = [card('spades_king.png')]
    state.round.trumpRank = 'Q'

    const invalidPassResult = passMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 1,
      },
      events,
      playerID: '0',
    }, {
      foreignerCardCode: 'Q:spades',
    })

    assert.notEqual(invalidPassResult, undefined)
    assert.equal(state.players['0'].matchStats.passCount, 0)
    assertCardSet(state.players['0'].hand, ['clubs_ace.png'])
  }

  {
    const state = createScenarioState()
    const { events, record } = createEventRecorder()

    state.players['0'].character = 'The Foreigner'
    state.players['0'].hand = [card('clubs_ace.png')]
    state.players['1'].hand = [card('spades_king.png')]
    state.round.trumpRank = 'J'
    state.round.passStreak = 1
    state.round.lastNonPassingPlayerID = '1'
    state.table.plays = [
      {
        id: 'play-0',
        playerID: '0',
        cards: [card('hearts_05.png')],
        claimedRank: 'J',
        playedAtRound: 1,
        playedAtTurn: 2,
        revealedAtTurn: 2,
        wasTrumpSelection: false,
      },
      {
        id: 'play-1',
        playerID: '1',
        cards: [card('diamonds_09.png'), card('clubs_03.png')],
        claimedRank: 'J',
        playedAtRound: 1,
        playedAtTurn: 3,
        revealedAtTurn: null,
        wasTrumpSelection: false,
      },
    ]
    state.players['1'].pendingRevealPlayID = 'play-1'

    const passResult = passMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 4,
      },
      events,
      playerID: '0',
    }, {
      foreignerCardCode: 'Q:spades',
    })

    assert.equal(passResult, undefined)
    assert.equal(record.nextPlayerID, null)
    assert.equal(state.resetResolution?.kind, 'roundReturn')
    assert.equal(state.round.roundNumber, 1)

    const finalizeResult = finalizeResetResolutionMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 4,
      },
      events,
      playerID: '0',
    }, {
      resolutionID: state.resetResolution!.id,
    })

    assert.equal(finalizeResult, undefined)
    assert.equal(record.nextPlayerID, '0')
    assert.equal(state.round.roundNumber, 2)
    assertCardSet(state.players['0'].hand, ['clubs_ace.png', 'hearts_05.png', 'spades_queen.png'])
    assert.match(
      state.history.find((entry) => entry.title.includes('used The Foreigner'))?.detail ?? '',
      /added Q of Spades from outside the game to hand/i,
    )
  }
}

function runGrandmasterRulesCheck() {
  {
    const state = createScenarioState(3)
    const { events } = createEventRecorder()

    state.players['0'].character = 'The Grandmaster'
    state.players['0'].hand = [card('clubs_ace.png')]
    state.players['1'].hand = [card('diamonds_07.png')]
    state.players['2'].hand = [card('spades_king.png')]
    state.round.trumpRank = 'Q'
    state.round.lastNonPassingPlayerID = '2'
    state.table.plays = [
      {
        id: 'play-older-hidden',
        playerID: '1',
        cards: [card('clubs_03.png')],
        claimedRank: 'Q',
        playedAtRound: 1,
        playedAtTurn: 2,
        revealedAtTurn: null,
        wasTrumpSelection: false,
      },
      {
        id: 'play-latest-hidden',
        playerID: '2',
        cards: [card('hearts_04.png')],
        claimedRank: 'Q',
        playedAtRound: 1,
        playedAtTurn: 4,
        revealedAtTurn: null,
        wasTrumpSelection: false,
      },
    ]
    state.players['1'].pendingRevealPlayID = 'play-older-hidden'
    state.players['2'].pendingRevealPlayID = 'play-latest-hidden'

    const callResult = callBSMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 5,
      },
      events,
      playerID: '0',
    }, {
      targetPlayerID: '1',
    })

    assert.equal(callResult, undefined)
    assert.equal(state.bsResolution?.targetPlayerID, '1')
    assert.equal(state.players['0'].hasUsedGrandmasterBSOverride, true)
    assert.match(
      state.history.find((entry) => entry.title.includes('used The Grandmaster'))?.detail ?? '',
      /not the latest non-passing player/i,
    )
  }

  {
    const state = createScenarioState(3)
    const { events } = createEventRecorder()

    state.players['0'].character = 'The Grandmaster'
    state.players['0'].hand = [card('clubs_ace.png')]
    state.players['1'].hand = [card('diamonds_07.png')]
    state.players['2'].hand = [card('spades_king.png')]
    state.round.trumpRank = 'Q'
    state.round.lastNonPassingPlayerID = '2'
    state.table.plays = [
      {
        id: 'play-older-hidden',
        playerID: '1',
        cards: [card('clubs_03.png')],
        claimedRank: 'Q',
        playedAtRound: 1,
        playedAtTurn: 2,
        revealedAtTurn: null,
        wasTrumpSelection: false,
      },
      {
        id: 'play-latest-hidden',
        playerID: '2',
        cards: [card('hearts_04.png')],
        claimedRank: 'Q',
        playedAtRound: 1,
        playedAtTurn: 4,
        revealedAtTurn: null,
        wasTrumpSelection: false,
      },
    ]
    state.players['1'].pendingRevealPlayID = 'play-older-hidden'
    state.players['2'].pendingRevealPlayID = 'play-latest-hidden'

    const callResult = callBSMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 5,
      },
      events,
      playerID: '0',
    })

    assert.equal(callResult, undefined)
    assert.equal(state.bsResolution?.targetPlayerID, '2')
    assert.equal(state.players['0'].hasUsedGrandmasterBSOverride, false)
  }

  {
    const state = createScenarioState(3)
    const { events } = createEventRecorder()

    state.players['0'].character = 'The Grandmaster'
    state.players['0'].hasUsedGrandmasterBSOverride = true
    state.players['0'].hand = [card('clubs_ace.png')]
    state.players['1'].hand = [card('diamonds_07.png')]
    state.players['2'].hand = [card('spades_king.png')]
    state.round.trumpRank = 'Q'
    state.round.lastNonPassingPlayerID = '2'
    state.table.plays = [
      {
        id: 'play-older-hidden',
        playerID: '1',
        cards: [card('clubs_03.png')],
        claimedRank: 'Q',
        playedAtRound: 1,
        playedAtTurn: 2,
        revealedAtTurn: null,
        wasTrumpSelection: false,
      },
      {
        id: 'play-latest-hidden',
        playerID: '2',
        cards: [card('hearts_04.png')],
        claimedRank: 'Q',
        playedAtRound: 1,
        playedAtTurn: 4,
        revealedAtTurn: null,
        wasTrumpSelection: false,
      },
    ]
    state.players['1'].pendingRevealPlayID = 'play-older-hidden'
    state.players['2'].pendingRevealPlayID = 'play-latest-hidden'

    const invalidOverrideResult = callBSMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 5,
      },
      events,
      playerID: '0',
    }, {
      targetPlayerID: '1',
    })

    assert.notEqual(invalidOverrideResult, undefined)
    assert.equal(state.bsResolution, null)

    const defaultTargetResult = callBSMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 5,
      },
      events,
      playerID: '0',
    }, {
      targetPlayerID: '2',
    })

    assert.equal(defaultTargetResult, undefined)
    const defaultBSResolution: BlowCowState['bsResolution'] = state.bsResolution
    assert.ok(defaultBSResolution)
    assert.equal((defaultBSResolution as NonNullable<BlowCowState['bsResolution']>).targetPlayerID, '2')
  }
}

function runPawnRulesCheck() {
  {
    const state = createScenarioState(3)
    const { events } = createEventRecorder()

    state.players['0'].character = 'The Pawn'
    state.players['0'].hand = [card('clubs_ace.png')]
    state.players['1'].hand = [card('diamonds_07.png')]
    state.players['2'].hand = [card('spades_king.png')]
    state.round.trumpRank = 'Q'
    state.round.lastNonPassingPlayerID = '2'
    state.table.plays = [
      {
        id: 'play-older-hidden',
        playerID: '1',
        cards: [card('clubs_03.png')],
        claimedRank: 'Q',
        playedAtRound: 1,
        playedAtTurn: 2,
        revealedAtTurn: null,
        wasTrumpSelection: false,
      },
      {
        id: 'play-latest-hidden',
        playerID: '2',
        cards: [card('hearts_04.png'), card('spades_04.png')],
        claimedRank: 'Q',
        playedAtRound: 1,
        playedAtTurn: 4,
        revealedAtTurn: null,
        wasTrumpSelection: false,
      },
    ]
    state.players['1'].pendingRevealPlayID = 'play-older-hidden'
    state.players['2'].pendingRevealPlayID = 'play-latest-hidden'

    const callResult = callBSMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 5,
      },
      events,
      playerID: '0',
    }, {
      targetPlayerID: '1',
    })

    assert.equal(callResult, undefined)
    assert.equal(state.bsResolution?.targetPlayerID, '1')
    assert.equal(state.players['0'].matchStats.callBSCount, 1)
    assert.match(
      state.history.find((entry) => entry.title.includes('used The Pawn'))?.detail ?? '',
      /en passant/i,
    )
  }

  {
    const state = createScenarioState(3)
    const { events } = createEventRecorder()

    state.players['0'].character = 'The Pawn'
    state.players['0'].hand = [card('clubs_ace.png')]
    state.players['1'].hand = [card('diamonds_07.png')]
    state.players['2'].hand = [card('spades_king.png')]
    state.round.trumpRank = 'Q'
    state.round.lastNonPassingPlayerID = '2'
    state.table.plays = [
      {
        id: 'play-older-hidden',
        playerID: '1',
        cards: [card('clubs_03.png')],
        claimedRank: 'Q',
        playedAtRound: 1,
        playedAtTurn: 2,
        revealedAtTurn: null,
        wasTrumpSelection: false,
      },
      {
        id: 'play-latest-hidden',
        playerID: '2',
        cards: [card('hearts_04.png')],
        claimedRank: 'Q',
        playedAtRound: 1,
        playedAtTurn: 4,
        revealedAtTurn: null,
        wasTrumpSelection: false,
      },
    ]
    state.players['1'].pendingRevealPlayID = 'play-older-hidden'
    state.players['2'].pendingRevealPlayID = 'play-latest-hidden'

    const callResult = callBSMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 5,
      },
      events,
      playerID: '0',
    }, {
      targetPlayerID: '1',
    })

    assert.notEqual(callResult, undefined)
    assert.equal(state.bsResolution, null)
  }

  {
    const state = createScenarioState(3)
    const { events } = createEventRecorder()

    state.players['0'].character = 'The Believer'
    state.players['0'].hand = [card('clubs_ace.png')]
    state.players['1'].hand = [card('diamonds_07.png')]
    state.players['2'].hand = [card('spades_king.png')]
    state.round.trumpRank = 'Q'
    state.round.lastNonPassingPlayerID = '2'
    state.table.plays = [
      {
        id: 'play-older-hidden',
        playerID: '1',
        cards: [card('clubs_03.png')],
        claimedRank: 'Q',
        playedAtRound: 1,
        playedAtTurn: 2,
        revealedAtTurn: null,
        wasTrumpSelection: false,
      },
      {
        id: 'play-latest-hidden',
        playerID: '2',
        cards: [card('hearts_04.png'), card('spades_04.png')],
        claimedRank: 'Q',
        playedAtRound: 1,
        playedAtTurn: 4,
        revealedAtTurn: null,
        wasTrumpSelection: false,
      },
    ]
    state.players['1'].pendingRevealPlayID = 'play-older-hidden'
    state.players['2'].pendingRevealPlayID = 'play-latest-hidden'

    const callResult = callBSMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 5,
      },
      events,
      playerID: '0',
    }, {
      targetPlayerID: '1',
    })

    assert.notEqual(callResult, undefined)
    assert.equal(state.bsResolution, null)
  }
}

function runContrarianRulesCheck() {
  {
    const state = createScenarioState(3)
    const { events, record } = createEventRecorder()

    state.players['0'].character = 'The Contrarian'
    state.players['0'].hand = [card('clubs_ace.png')]
    state.players['1'].hand = [card('diamonds_07.png')]
    state.players['2'].hand = [card('spades_king.png')]
    state.round.trumpRank = 'Q'
    state.round.direction = 'clockwise'

    const toggleResult = toggleDirectionMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 4,
      },
      events,
      playerID: '0',
    })

    assert.equal(toggleResult, undefined)
    assert.equal(state.round.direction, 'counterclockwise')
    assert.match(
      state.history.find((entry) => entry.title.includes('used The Contrarian'))?.detail ?? '',
      /counterclockwise/i,
    )

    const passResult = passMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 4,
      },
      events,
      playerID: '0',
    })

    assert.equal(passResult, undefined)
    assert.equal(record.nextPlayerID, '2')
  }

  {
    const state = createScenarioState(3)
    const { events } = createEventRecorder()

    state.players['0'].character = 'The Contrarian'
    state.players['0'].hand = [card('clubs_ace.png')]
    state.players['1'].hand = [card('diamonds_07.png')]
    state.players['2'].hand = [card('spades_king.png')]
    state.round.trumpRank = 'Q'
    state.round.direction = 'clockwise'

    const firstToggleResult = toggleDirectionMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 4,
      },
      events,
      playerID: '0',
    })
    const secondToggleResult = toggleDirectionMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 4,
      },
      events,
      playerID: '0',
    })

    assert.equal(firstToggleResult, undefined)
    assert.equal(secondToggleResult, undefined)
    assert.equal(state.round.direction, 'clockwise')
  }

  {
    const state = createScenarioState(3)
    const { events } = createEventRecorder()

    state.players['0'].character = 'The Believer'
    state.players['0'].hand = [card('clubs_ace.png')]
    state.players['1'].hand = [card('diamonds_07.png')]
    state.players['2'].hand = [card('spades_king.png')]
    state.round.trumpRank = 'Q'

    const toggleResult = toggleDirectionMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 4,
      },
      events,
      playerID: '0',
    })

    assert.notEqual(toggleResult, undefined)
    assert.equal(state.round.direction, 'clockwise')
  }
}

function runDrunkardRulesCheck() {
  {
    const state = createScenarioState()
    const firstCard = card('clubs_ace.png')
    const secondCard = card('hearts_queen.png')
    const thirdCard = card('spades_king.png')
    const { events, record } = createEventRecorder()

    state.players['0'].character = 'The Drunkard'
    state.players['0'].hand = [firstCard, secondCard, thirdCard]
    state.players['1'].hand = [card('clubs_03.png')]
    state.round.status = 'awaitingTrumpSelection'

    const playResult = playRandomMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 1,
      },
      events,
      playerID: '0',
      random: {
        Shuffle: reverseShuffle,
      },
    }, {
      cardCount: 2,
      trumpRank: 'Q',
    })

    assert.equal(playResult, undefined)
    assert.equal(record.nextPlayerID, '1')
    assert.equal(state.players['0'].hasUsedManualPlay, false)
    assert.equal(state.players['0'].matchStats.playCount, 1)
    assert.equal(state.players['0'].matchStats.cardsPlayed, 2)
    assertCardSet(state.table.plays[0]?.cards ?? [], ['spades_king.png', 'hearts_queen.png'])
    assert.match(
      state.history.find((entry) => entry.title.includes('used The Drunkard'))?.detail ?? '',
      /randomly selected 2 card\(s\) from hand/i,
    )
  }

  {
    const state = createScenarioState()
    const { events } = createEventRecorder()

    state.players['0'].hand = [card('clubs_ace.png'), card('hearts_queen.png')]
    state.players['1'].hand = [card('spades_king.png')]
    state.round.status = 'awaitingTrumpSelection'

    const invalidResult = playRandomMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 1,
      },
      events,
      playerID: '0',
      random: {
        Shuffle: reverseShuffle,
      },
    }, {
      cardCount: 2,
      trumpRank: 'Q',
    })

    assert.notEqual(invalidResult, undefined)
    assert.equal(state.table.plays.length, 0)
  }

  {
    const state = createScenarioState()
    const { events, record } = createEventRecorder()

    state.players['0'].character = 'The Drunkard'
    state.players['0'].hand = []
    state.players['0'].points = 1
    state.players['0'].matchStats.playCount = 2
    state.players['0'].hasUsedManualPlay = false
    state.players['1'].hand = [card('clubs_ace.png')]

    beginTurn({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 1,
      },
      events,
    })

    assert.equal(record.endedGame?.pointsByPlayer['0'], -2)
    assert.equal(state.players['0'].points, -2)
    assert.match(
      state.history.find((event) => event.playerID === '0' && event.kind === 'system')?.detail ?? '',
      /only ever using Play Random, so 3 points were lost/i,
    )
  }

  {
    const state = createScenarioState()
    const { events, record } = createEventRecorder()

    state.players['0'].character = 'The Drunkard'
    state.players['0'].hand = []
    state.players['0'].points = 1
    state.players['0'].matchStats.playCount = 2
    state.players['0'].hasUsedManualPlay = true
    state.players['1'].hand = [card('clubs_ace.png')]

    beginTurn({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 1,
      },
      events,
    })

    assert.equal(record.endedGame?.pointsByPlayer['0'], 1)
    assert.equal(state.players['0'].points, 1)
    assert.ok(
      !state.history.some((event) => event.playerID === '0' && event.title.includes('triggered The Drunkard')),
    )
  }
}

function runCatRulesCheck() {
  {
    const state = createScenarioState()
    const revealedCard = card('hearts_queen.png')
    const hiddenCard = card('clubs_king.png')
    const { events } = createEventRecorder()

    state.players['0'].character = 'The Cat'
    state.players['0'].hand = [card('clubs_ace.png')]
    state.players['1'].hand = [card('spades_ace.png')]
    state.round.trumpRank = 'Q'
    state.round.lastNonPassingPlayerID = '1'
    state.table.plays = [
      {
        id: 'play-revealed',
        playerID: '1',
        cards: [revealedCard],
        claimedRank: 'Q',
        playedAtRound: 1,
        playedAtTurn: 1,
        revealedAtTurn: 2,
        wasTrumpSelection: false,
      },
      {
        id: 'play-hidden',
        playerID: '1',
        cards: [hiddenCard],
        claimedRank: 'Q',
        playedAtRound: 1,
        playedAtTurn: 3,
        revealedAtTurn: null,
        wasTrumpSelection: false,
      },
    ]
    state.players['1'].pendingRevealPlayID = 'play-hidden'

    const invalidHideResult = catHideCardMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 4,
      },
      events,
      playerID: '0',
    }, {
      cardID: hiddenCard.id,
    })

    assert.notEqual(invalidHideResult, undefined)
    assert.equal(state.table.plays[1]?.rehiddenCardIDs?.length ?? 0, 0)

    const hideResult = catHideCardMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 4,
      },
      events,
      playerID: '0',
    }, {
      cardID: revealedCard.id,
    })

    assert.equal(hideResult, undefined)
    assert.deepEqual(state.table.plays[0]?.rehiddenCardIDs, [revealedCard.id])
    assert.match(
      state.history.find((entry) => entry.title.includes('used The Cat'))?.detail ?? '',
      /flipped Q of Hearts face down on the table/i,
    )

    const callResult = callBSMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 5,
      },
      events,
      playerID: '0',
    })

    assert.equal(callResult, undefined)
    assert.equal(state.bsResolution?.targetPlayID, 'play-hidden')
    assert.equal(state.bsResolution?.additionalRevealPlays.length, 0)
  }

  {
    const state = createScenarioState()
    const revealedCard = card('hearts_queen.png')
    const hiddenCard = card('clubs_king.png')
    const { events } = createEventRecorder()

    state.players['1'].character = 'The Spy'
    state.players['1'].hand = [card('spades_ace.png')]
    state.round.trumpRank = 'Q'
    state.table.plays = [
      {
        id: 'play-spy-cat',
        playerID: '1',
        cards: [revealedCard, hiddenCard],
        revealedCardIDs: [revealedCard.id],
        rehiddenCardIDs: [revealedCard.id],
        claimedRank: 'Q',
        playedAtRound: 1,
        playedAtTurn: 1,
        revealedAtTurn: null,
        wasTrumpSelection: false,
      },
    ]
    state.players['1'].pendingRevealPlayID = 'play-spy-cat'

    beginTurn({
      G: state,
      ctx: {
        currentPlayer: '1',
        turn: 2,
      },
      events,
    })

    assert.equal(state.table.plays[0]?.revealedAtTurn, 2)
    assert.deepEqual(state.table.plays[0]?.rehiddenCardIDs, [])
  }

  {
    const state = createScenarioState()
    const revealedCard = card('hearts_queen.png')
    state.table.plays = [
      {
        id: 'play-reset-cat',
        playerID: '1',
        cards: [revealedCard],
        rehiddenCardIDs: [revealedCard.id],
        claimedRank: 'Q',
        playedAtRound: 1,
        playedAtTurn: 1,
        revealedAtTurn: 1,
        wasTrumpSelection: false,
      },
    ]
    state.resetResolution = {
      id: 'reset-cat-visibility',
      callerPlayerID: '0',
      kind: 'reset',
    }

    const playerView = BlowCowGame.playerView({
      G: state,
      playerID: '0',
    }) as BlowCowState

    assert.equal(playerView.table.plays[0]?.cards[0]?.sprite, revealedCard.sprite)
  }
}

function runPrivilegedRulesCheck() {
  {
    const state = createScenarioState()
    const { events, record } = createEventRecorder()

    state.players['0'].hand = [card('clubs_ace.png')]
    state.players['1'].character = 'The Privileged'
    state.players['1'].hand = []
    state.round.trumpRank = 'Q'
    state.round.passStreak = 1
    state.table.plays = [
      {
        id: 'play-return',
        playerID: '1',
        cards: [card('hearts_queen.png')],
        claimedRank: 'Q',
        playedAtRound: 1,
        playedAtTurn: 1,
        revealedAtTurn: 1,
        wasTrumpSelection: false,
      },
    ]

    const passResult = passMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 2,
      },
      events,
      playerID: '0',
    })

    assert.equal(passResult, undefined)
    assert.equal(record.nextPlayerID, null)
    assert.equal(state.resetResolution?.kind, 'roundReturn')

    const finalizeResult = finalizeResetResolutionMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 2,
      },
      events,
      playerID: '0',
    }, {
      resolutionID: state.resetResolution!.id,
    })

    assert.equal(finalizeResult, undefined)
    assert.equal(state.round.startingPlayerID, '1')
    assert.equal(record.nextPlayerID, '1')
  }

  {
    const state = createScenarioState()
    const { events, record } = createEventRecorder()

    state.players['0'].character = 'The Privileged'
    state.players['0'].hand = []
    state.players['0'].points = 2
    state.players['1'].hand = [card('clubs_ace.png')]
    state.round.trumpRank = 'Q'

    beginTurn({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 1,
      },
      events,
    })

    assert.equal(state.players['0'].hasLeft, true)
    assert.equal(state.players['0'].points, 3)
    assert.ok(record.endedGame)
    assert.match(
      state.history.find((entry) => entry.title.includes('triggered The Privileged'))?.detail ?? '',
      /1 point was added/i,
    )
  }
}

function runConfusedRulesCheck() {
  {
    const state = createInitialBlowCowState(6, reverseShuffle, {
      rankSelectionMode: 'manual',
      selectedRanks: ['Q', 'K'],
    })

    assert.ok(Object.values(state.players).every((player) => player.character !== 'The Confused'))
  }

  {
    const scoredHand = scoreHand([
      card('clubs_jack.png'),
      card('diamonds_jack.png'),
      card('hearts_jack.png'),
      card('spades_jack.png'),
    ], '1', 'other', 1, 1)

    assert.equal(scoredHand.pointsAwarded, 1)
    assert.equal(scoredHand.remainingHand.length, 0)
    assert.equal(scoredHand.scoredSets.length, 1)
    assert.equal(scoredHand.scoredSets[0]?.rank, 'J')
  }

  {
    const state = createScenarioState()
    const confusedJack = card('clubs_jack.png')
    const { events, record } = createEventRecorder()

    state.players['0'].hand = [card('clubs_ace.png')]
    state.players['1'].character = 'The Confused'
    state.players['1'].hand = [confusedJack]
    state.round.trumpRank = 'Q'

    const playResult = playMove({
      G: state,
      ctx: {
        currentPlayer: '1',
        turn: 1,
      },
      events,
      playerID: '1',
    }, {
      cardIDs: [confusedJack.id],
    })

    assert.equal(playResult, undefined)
    assert.equal(record.nextPlayerID, '0')
    assert.equal(state.players['1'].matchStats.lieCount, 0)

    const callResult = callBSMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 2,
      },
      events,
      playerID: '0',
    })

    assert.equal(callResult, undefined)
    assert.equal(state.bsResolution?.targetWasHonest, true)

    const finalizeResult = finalizeBSResolutionMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 2,
      },
      events,
      playerID: '0',
    }, {
      resolutionID: state.bsResolution.id,
    })

    assert.equal(finalizeResult, undefined)
    assert.equal(state.players['0'].matchStats.punishmentCount, 1)
    assert.equal(state.players['1'].matchStats.bsWinCount, 0)
  }

  {
    const state = createScenarioState()
    const { events } = createEventRecorder()

    state.players['0'].character = 'The Confused'
    state.players['0'].hand = [card('clubs_ace.png')]
    state.players['1'].hand = [card('spades_king.png')]
    state.table.plays = [
      {
        id: 'play-0',
        playerID: '0',
        cards: [card('clubs_jack.png')],
        claimedRank: 'Q',
        playedAtRound: 1,
        playedAtTurn: 1,
        revealedAtTurn: null,
        wasTrumpSelection: false,
      },
      {
        id: 'play-1',
        playerID: '0',
        cards: [card('diamonds_jack.png')],
        claimedRank: 'Q',
        playedAtRound: 1,
        playedAtTurn: 2,
        revealedAtTurn: null,
        wasTrumpSelection: false,
      },
      {
        id: 'play-2',
        playerID: '0',
        cards: [card('hearts_jack.png')],
        claimedRank: 'Q',
        playedAtRound: 1,
        playedAtTurn: 3,
        revealedAtTurn: null,
        wasTrumpSelection: false,
      },
      {
        id: 'play-3',
        playerID: '1',
        cards: [card('spades_jack.png')],
        claimedRank: 'Q',
        playedAtRound: 1,
        playedAtTurn: 4,
        revealedAtTurn: null,
        wasTrumpSelection: false,
      },
    ]
    state.bsResolution = {
      id: 'bs-confused-jacks',
      callerPlayerID: '1',
      targetPlayerID: '0',
      targetPlayID: 'play-2',
      targetPlayCards: [card('hearts_jack.png')],
      targetDeclaredCardCount: 1,
      additionalRevealPlays: [
        {
          playID: 'play-0',
          playerID: '0',
          cards: [card('clubs_jack.png')],
        },
        {
          playID: 'play-1',
          playerID: '0',
          cards: [card('diamonds_jack.png')],
        },
        {
          playID: 'play-3',
          playerID: '1',
          cards: [card('spades_jack.png')],
        },
      ],
      trumpRank: 'Q',
      targetWasHonest: false,
      caughtDreamerRepeatTrump: false,
      caughtDreamerExtraCardCount: false,
      caughtDreamerExceededTableLimit: false,
      reverseRuleTriggered: false,
      punishedPlayerID: '0',
      unpunishedPlayerID: '1',
      punishmentCardCount: 4,
    }

    const finalizeResult = finalizeBSResolutionMove({
      G: state,
      ctx: {
        currentPlayer: '1',
        turn: 5,
      },
      events,
      playerID: '1',
    }, {
      resolutionID: 'bs-confused-jacks',
    })

    assert.equal(finalizeResult, undefined)
    assert.equal(state.players['0'].points, 1)
    assert.equal(state.players['0'].scoredSets.at(-1)?.rank, 'J')
    assertCardSet(state.players['0'].hand, ['clubs_ace.png'])
  }
}

function runDreamerRepeatTrumpCheck() {
  {
    const state = createScenarioState()
    const repeatedTrumpCard = card('hearts_queen.png')
    const { events } = createEventRecorder()

    state.players['0'].character = 'The Believer'
    state.players['0'].hand = [repeatedTrumpCard]
    state.round.status = 'awaitingTrumpSelection'
    state.round.previousTrumpRank = 'Q'

    const blockedResult = selectTrumpAndPlayMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 1,
      },
      events,
      playerID: '0',
    }, {
      trumpRank: 'Q',
      cardIDs: [repeatedTrumpCard.id],
    })

    assert.notEqual(blockedResult, undefined)
    assert.equal(state.round.trumpRank, null)
    assert.equal(state.table.plays.length, 0)
  }

  {
    const state = createScenarioState()
    const repeatedTrumpCard = card('hearts_queen.png')
    const { events, record } = createEventRecorder()

    state.players['0'].hand = [card('clubs_ace.png')]
    state.players['1'].character = 'The Dreamer'
    state.players['1'].hand = [repeatedTrumpCard]
    state.round.status = 'awaitingTrumpSelection'
    state.round.startingPlayerID = '1'
    state.round.previousTrumpRank = 'Q'

    beginTurn({
      G: state,
      ctx: {
        currentPlayer: '1',
        turn: 1,
      },
      events,
    })

    const playResult = selectTrumpAndPlayMove({
      G: state,
      ctx: {
        currentPlayer: '1',
        turn: 1,
      },
      events,
      playerID: '1',
    }, {
      trumpRank: 'Q',
      cardIDs: [repeatedTrumpCard.id],
    })

    assert.equal(playResult, undefined)
    assert.equal(record.nextPlayerID, '0')
    assert.equal(state.round.trumpRank, 'Q')
    assert.equal(state.round.lastNonPassingPlayerID, '1')
    assert.equal(state.table.plays[0]?.wasTrumpSelection, true)

    const callResult = callBSMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 2,
      },
      events,
      playerID: '0',
    })

    assert.equal(callResult, undefined)
    assert.equal(state.players['0'].matchStats.callBSCount, 1)
    assert.equal(state.bsResolution?.targetWasHonest, false)
    assert.equal(state.bsResolution?.caughtDreamerRepeatTrump, true)

    const finalizeResult = finalizeBSResolutionMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 2,
      },
      events,
      playerID: '0',
    }, {
      resolutionID: state.bsResolution.id,
    })

    assert.equal(finalizeResult, undefined)
    assert.equal(record.endedGame, null)
    assert.equal(record.nextPlayerID, '0')
    assert.equal(state.round.roundNumber, 2)
    assert.equal(state.round.previousTrumpRank, 'Q')
    assert.equal(state.players['0'].matchStats.bsWinCount, 1)
    assert.equal(state.players['1'].matchStats.punishmentCount, 1)
    assertCardSet(state.players['1'].hand, ['hearts_queen.png'])
    assert.match(
      state.history.find((entry) => entry.kind === 'verdict')?.detail ?? '',
      /repeated Q as the previous round trump on the opening play/i,
    )
  }
}

function runDreamerDirectionCheatCheck() {
  {
    const state = createScenarioState(3)
    const { events, record } = createEventRecorder()

    state.players['0'].hand = [card('clubs_ace.png')]
    state.players['1'].character = 'The Dreamer'
    state.players['1'].hand = [card('clubs_queen.png')]
    state.players['2'].hand = [card('spades_king.png')]
    state.round.trumpRank = 'Q'
    state.round.direction = 'clockwise'
    state.round.lastNonPassingPlayerID = '1'
    state.players['1'].turnStartingDirection = 'clockwise'
    state.table.plays = [
      {
        id: 'play-support-a',
        playerID: '2',
        cards: [card('hearts_queen.png')],
        claimedRank: 'Q',
        playedAtRound: 1,
        playedAtTurn: 1,
        revealedAtTurn: 1,
        wasTrumpSelection: false,
      },
      {
        id: 'play-support-b',
        playerID: '0',
        cards: [card('spades_queen.png')],
        claimedRank: 'Q',
        playedAtRound: 1,
        playedAtTurn: 2,
        revealedAtTurn: 2,
        wasTrumpSelection: false,
      },
      {
        id: 'play-support-c',
        playerID: '2',
        cards: [card('diamonds_queen.png')],
        claimedRank: 'Q',
        playedAtRound: 1,
        playedAtTurn: 2,
        revealedAtTurn: 2,
        wasTrumpSelection: false,
      },
      {
        id: 'play-dreamer-hidden',
        playerID: '1',
        cards: [card('clubs_queen.png')],
        usedDreamerDirectionChange: false,
        claimedRank: 'Q',
        playedAtRound: 1,
        playedAtTurn: 3,
        revealedAtTurn: null,
        wasTrumpSelection: false,
      },
    ]
    state.players['1'].pendingRevealPlayID = 'play-dreamer-hidden'

    const toggleResult = toggleDirectionMove({
      G: state,
      ctx: {
        currentPlayer: '1',
        turn: 3,
      },
      events,
      playerID: '1',
    })

    assert.equal(toggleResult, undefined)
    assert.equal(state.round.direction, 'counterclockwise')
    assert.equal(state.table.plays[3]?.usedDreamerDirectionChange, true)

    const callResult = callBSMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 4,
      },
      events,
      playerID: '0',
    })

    assert.equal(callResult, undefined)
    assert.equal(state.bsResolution?.caughtDreamerDirectionChange, true)
    assert.equal(state.bsResolution?.reverseRuleTriggered, true)
    assert.equal(state.bsResolution?.reverseRuleIgnoredForDreamerCheat, true)
    assert.equal(state.bsResolution?.punishedPlayerID, '1')

    const finalizeResult = finalizeBSResolutionMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 4,
      },
      events,
      playerID: '0',
    }, {
      resolutionID: state.bsResolution!.id,
    })

    assert.equal(finalizeResult, undefined)
    assert.equal(record.nextPlayerID, '0')
    assert.equal(state.players['1'].matchStats.punishmentCount, 1)
    assert.match(
      state.history.find((entry) => entry.kind === 'verdict')?.detail ?? '',
      /catching The Dreamer cheating still punished The Dreamer/i,
    )
  }

  {
    const state = createScenarioState(3)
    const { events } = createEventRecorder()

    state.players['0'].hand = [card('clubs_ace.png')]
    state.players['1'].character = 'The Dreamer'
    state.players['1'].hand = [card('clubs_queen.png')]
    state.players['2'].hand = [card('diamonds_queen.png')]
    state.round.trumpRank = 'Q'
    state.round.direction = 'clockwise'
    state.round.lastNonPassingPlayerID = '1'
    state.players['1'].turnStartingDirection = 'clockwise'
    state.table.plays = [
      {
        id: 'play-dreamer-hidden',
        playerID: '1',
        cards: [card('clubs_queen.png')],
        usedDreamerDirectionChange: false,
        claimedRank: 'Q',
        playedAtRound: 1,
        playedAtTurn: 3,
        revealedAtTurn: null,
        wasTrumpSelection: false,
      },
    ]
    state.players['1'].pendingRevealPlayID = 'play-dreamer-hidden'

    const firstToggleResult = toggleDirectionMove({
      G: state,
      ctx: {
        currentPlayer: '1',
        turn: 3,
      },
      events,
      playerID: '1',
    })
    const secondToggleResult = toggleDirectionMove({
      G: state,
      ctx: {
        currentPlayer: '1',
        turn: 3,
      },
      events,
      playerID: '1',
    })

    assert.equal(firstToggleResult, undefined)
    assert.equal(secondToggleResult, undefined)
    assert.equal(state.round.direction, 'clockwise')
    assert.equal(state.table.plays[0]?.usedDreamerDirectionChange, false)

    const callResult = callBSMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 4,
      },
      events,
      playerID: '0',
    })

    assert.equal(callResult, undefined)
    assert.equal(state.bsResolution?.caughtDreamerDirectionChange, false)
  }
}

function runDreamerIllegalCountCheck() {
  {
    const state = createScenarioState()
    const { events } = createEventRecorder()

    state.players['0'].character = 'The Believer'
    state.players['0'].hand = [card('clubs_queen.png'), card('diamonds_queen.png'), card('hearts_queen.png')]
    state.round.trumpRank = 'Q'

    const blockedResult = playMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 1,
      },
      events,
      playerID: '0',
    }, {
      cardIDs: state.players['0'].hand.map((entry) => entry.id),
    })

    assert.notEqual(blockedResult, undefined)
    assert.equal(state.table.plays.length, 0)
  }

  {
    const state = createScenarioState()
    const dreamerCards = [card('clubs_queen.png'), card('diamonds_queen.png'), card('hearts_queen.png')]
    const { events, record } = createEventRecorder()

    state.players['0'].hand = [card('clubs_ace.png')]
    state.players['1'].character = 'The Dreamer'
    state.players['1'].hand = [...dreamerCards]
    state.round.trumpRank = 'Q'

    const playResult = playMove({
      G: state,
      ctx: {
        currentPlayer: '1',
        turn: 1,
      },
      events,
      playerID: '1',
    }, {
      cardIDs: dreamerCards.map((entry) => entry.id),
    })

    assert.equal(playResult, undefined)
    assert.equal(record.nextPlayerID, '0')
    assert.equal(state.table.plays[0]?.cards.length, 3)
    assert.equal(state.table.plays[0]?.declaredCardCount, 2)
    assert.equal(state.history[0]?.title, 'Seat 2 played 2 card(s)')

    const callResult = callBSMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 2,
      },
      events,
      playerID: '0',
    })

    assert.equal(callResult, undefined)
    assert.equal(state.bsResolution?.caughtDreamerExtraCardCount, true)
    assert.equal(state.bsResolution?.caughtDreamerExceededTableLimit, false)
    assert.equal(state.bsResolution?.targetWasHonest, false)

    const finalizeResult = finalizeBSResolutionMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 2,
      },
      events,
      playerID: '0',
    }, {
      resolutionID: state.bsResolution.id,
    })

    assert.equal(finalizeResult, undefined)
    assert.equal(state.players['1'].matchStats.punishmentCount, 1)
    assert.equal(state.players['0'].matchStats.bsWinCount, 1)
    assert.match(
      state.history.find((entry) => entry.kind === 'verdict')?.detail ?? '',
      /declared 2 card\(s\) but actually played 3/i,
    )
  }

  {
    const state = createScenarioState()
    const dreamerCards = [card('clubs_queen.png'), card('diamonds_queen.png')]
    const existingTableCards = [
      card('clubs_03.png'),
      card('diamonds_03.png'),
      card('hearts_03.png'),
      card('spades_03.png'),
      card('clubs_04.png'),
      card('diamonds_04.png'),
      card('hearts_04.png'),
      card('spades_04.png'),
      card('clubs_05.png'),
    ]
    const { events } = createEventRecorder()

    state.players['0'].hand = [card('clubs_ace.png')]
    state.players['1'].character = 'The Dreamer'
    state.players['1'].hand = [...dreamerCards]
    state.round.trumpRank = 'Q'
    state.round.lastNonPassingPlayerID = '0'
    state.table.plays = existingTableCards.map((existingCard, index) => ({
      id: `play-existing-${index}`,
      playerID: '0',
      cards: [existingCard],
      claimedRank: 'Q',
      playedAtRound: 1,
      playedAtTurn: index + 1,
      revealedAtTurn: index + 1,
      wasTrumpSelection: false,
    }))

    const playResult = playMove({
      G: state,
      ctx: {
        currentPlayer: '1',
        turn: 10,
      },
      events,
      playerID: '1',
    }, {
      cardIDs: dreamerCards.map((entry) => entry.id),
    })

    assert.equal(playResult, undefined)
    assert.equal(state.table.plays.flatMap((play) => play.cards).length, 11)
    assert.equal(state.table.plays.at(-1)?.declaredCardCount, 2)

    const callResult = callBSMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 11,
      },
      events,
      playerID: '0',
    })

    assert.equal(callResult, undefined)
    assert.equal(state.bsResolution?.caughtDreamerExtraCardCount, false)
    assert.equal(state.bsResolution?.caughtDreamerExceededTableLimit, true)
    assert.equal(state.bsResolution?.targetWasHonest, false)

    const finalizeResult = finalizeBSResolutionMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 11,
      },
      events,
      playerID: '0',
    }, {
      resolutionID: state.bsResolution.id,
    })

    assert.equal(finalizeResult, undefined)
    assert.match(
      state.history.find((entry) => entry.kind === 'verdict')?.detail ?? '',
      /above the 10-card limit/i,
    )
  }
}

function runSpyRulesCheck() {
  const state = createScenarioState()
  const revealedTrumpCard = card('hearts_queen.png')
  const hiddenLieCard = card('clubs_king.png')
  const extraHandCard = card('spades_ace.png')
  const { events, record } = createEventRecorder()

  state.players['0'].hand = [card('clubs_ace.png')]
  state.players['1'].character = 'The Spy'
  state.players['1'].hand = [revealedTrumpCard, hiddenLieCard, extraHandCard]
  state.round.trumpRank = 'Q'

  const playResult = playMove({
    G: state,
    ctx: {
      currentPlayer: '1',
      turn: 1,
    },
    events,
    playerID: '1',
  }, {
    cardIDs: [revealedTrumpCard.id, hiddenLieCard.id],
  })

  assert.equal(playResult, undefined)
  assert.equal(record.nextPlayerID, '0')
  assert.equal(state.players['1'].pendingRevealPlayID, state.table.plays[0]?.id ?? null)

  beginTurn({
    G: state,
    ctx: {
      currentPlayer: '1',
      turn: 3,
    },
    events,
  })

  assert.equal(state.table.plays[0]?.revealedAtTurn, null)
  assert.deepEqual(state.table.plays[0]?.revealedCardIDs, [revealedTrumpCard.id])
  assert.equal(state.players['1'].pendingRevealPlayID, null)
  assert.match(
    state.history.find((entry) => entry.playerID === '1' && entry.title.includes('revealed 1 card'))?.detail ?? '',
    /The Spy revealed Q of Hearts/i,
  )

  const callResult = callBSMove({
    G: state,
    ctx: {
      currentPlayer: '0',
      turn: 4,
    },
    events,
    playerID: '0',
  })

  assert.equal(callResult, undefined)
  assert.equal(state.bsResolution?.targetPlayID, state.table.plays[0]?.id)
  assert.equal(state.bsResolution?.targetWasHonest, false)

  const finalizeResult = finalizeBSResolutionMove({
    G: state,
    ctx: {
      currentPlayer: '0',
      turn: 4,
    },
    events,
    playerID: '0',
  }, {
    resolutionID: state.bsResolution.id,
  })

  assert.equal(finalizeResult, undefined)
  assert.equal(state.players['1'].matchStats.punishmentCount, 1)
  assert.equal(state.players['0'].matchStats.bsWinCount, 1)
}

function runCharactersDisabledCheck() {
  const state = createInitialBlowCowState(4, reverseShuffle, {
    useCharacters: false,
  })

  assert.equal(state.useCharacters, false)
  assert.ok(Object.values(state.players).every((player) => player.character === null))
  assert.match(state.history[0]?.detail ?? '', /left character cards disabled/i)
}

function runStagedStartCheck() {
  const state = BlowCowGame.setup({
    ctx: {
      numPlayers: 4,
    },
    random: {
      Shuffle: reverseShuffle,
    },
  })

  assert.equal(state.gameStatus, 'staging')
  assert.equal(state.hostPlayerID, '0')
  assert.equal(state.history[0]?.title, 'Room staged')
  assert.ok(Object.values(state.players).every((player) => player.hand.length === 0))

  const { events, record } = createEventRecorder()
  const startResult = startMatchMove({
    G: state,
    ctx: {
      currentPlayer: '0',
      turn: 1,
    },
    events,
    playerID: '0',
    random: {
      Shuffle: reverseShuffle,
    },
  })

  assert.equal(startResult, undefined)
  assert.equal(state.gameStatus, 'active')
  assert.deepEqual(state.seatOrder, ['3', '2', '1', '0'])
  assert.equal(state.round.startingPlayerID, '3')
  assert.equal(record.nextPlayerID, '3')
  assert.equal(state.players['3'].seatIndex, 0)
  assert.equal(state.players['0'].seatIndex, 3)
  assert.ok(Object.values(state.players).some((player) => player.hand.length > 0))
}

function runManualRankSelectionCheck() {
  const setupData: BlowCowSetupData = {
    rankSelectionMode: 'manual',
    selectedRanks: ['K', '3', 'A'],
    speedMultiplier: 0.5,
  }
  const state = createInitialBlowCowState(4, identityShuffle, setupData)
  const allCards = Object.values(state.players).flatMap((player) => player.hand)

  assert.equal(state.deckConfig.rankSelectionMode, 'manual')
  assert.equal(state.speedMultiplier, 0.5)
  assert.equal(state.deckConfig.defaultRankCount, getDefaultStandardRankCount(4))
  assert.equal(state.deckConfig.includesJokers, true)
  assert.deepEqual(state.deckConfig.selectedRanks, ['A', '3', 'K'])
  assert.ok(allCards.every((entry) => entry.rank === 'Joker' || state.deckConfig.selectedRanks.includes(entry.rank as BlowCowRank)))
}

function runSetupValidationCheck() {
  assert.equal(BlowCowGame.validateSetupData?.({ rankSelectionMode: 'default' }), undefined)
  assert.equal(
    BlowCowGame.validateSetupData?.({ rankSelectionMode: 'default', speedMultiplier: 2 }),
    undefined,
  )
  assert.equal(
    BlowCowGame.validateSetupData?.({ rankSelectionMode: 'manual', selectedRanks: ['A'] }),
    'Select at least 2 ranks for a manual deck.',
  )
  assert.equal(
    BlowCowGame.validateSetupData?.({ rankSelectionMode: 'manual', selectedRanks: ['A', 'A'] as BlowCowRank[] }),
    'Manual rank selection cannot contain duplicate ranks.',
  )
  assert.equal(
    BlowCowGame.validateSetupData?.({ rankSelectionMode: 'default', speedMultiplier: 0.75 } as unknown as BlowCowSetupData),
    'Choose a valid game speed multiplier.',
  )
  assert.equal(
    BlowCowGame.validateSetupData?.({ useCharacters: true, characterPool: [] }),
    'Select at least 1 character for the character pool.',
  )
  assert.equal(
    BlowCowGame.validateSetupData?.({
      useCharacters: true,
      characterPool: ['The Spy', 'The Spy'],
    }),
    'Character pool cannot contain duplicate characters.',
  )
  assert.equal(
    BlowCowGame.validateSetupData?.({
      rankSelectionMode: 'manual',
      selectedRanks: ['A', 'Q'],
      useCharacters: true,
      characterPool: ['The Confused'],
    }),
    'The Confused requires J to be included in a manual deck.',
  )
}

function runMatchStatsTrackingCheck() {
  const state = createScenarioState()
  const lyingCard = card('clubs_ace.png')
  const honestCard = card('hearts_queen.png')
  const otherPlayerCard = card('spades_king.png')

  state.round.status = 'awaitingTrumpSelection'
  state.players['0'].hand = [lyingCard, honestCard]
  state.players['1'].hand = [otherPlayerCard]

  const { events, record } = createEventRecorder()

  beginTurn({
    G: state,
    ctx: {
      currentPlayer: '0',
      turn: 1,
    },
    events,
  })

  assert.equal(state.players['0'].matchStats.turnsInGame, 1)

  const selectTrumpResult = selectTrumpAndPlayMove({
    G: state,
    ctx: {
      currentPlayer: '0',
      turn: 1,
    },
    events,
    playerID: '0',
  }, {
    trumpRank: 'Q',
    cardIDs: [lyingCard.id],
  })

  assert.equal(selectTrumpResult, undefined)
  assert.equal(record.nextPlayerID, '1')
  assert.equal(state.players['0'].matchStats.playCount, 1)
  assert.equal(state.players['0'].matchStats.cardsPlayed, 1)
  assert.equal(state.players['0'].matchStats.lieCount, 1)
  assert.ok(
    state.telemetry.events.some((event) => event.title.includes('played 1 card(s)')
      && event.handCountsByPlayer['0'] === 1
      && event.handCountsByPlayer['1'] === 1),
  )

  beginTurn({
    G: state,
    ctx: {
      currentPlayer: '1',
      turn: 2,
    },
    events,
  })

  assert.equal(state.players['1'].matchStats.turnsInGame, 1)

  const passResult = passMove({
    G: state,
    ctx: {
      currentPlayer: '1',
      turn: 2,
    },
    events,
    playerID: '1',
  })

  assert.equal(passResult, undefined)
  assert.equal(state.players['1'].matchStats.passCount, 1)
  assert.equal(record.nextPlayerID, '0')

  beginTurn({
    G: state,
    ctx: {
      currentPlayer: '0',
      turn: 3,
    },
    events,
  })

  assert.equal(state.players['0'].matchStats.turnsInGame, 2)

  const playResult = playMove({
    G: state,
    ctx: {
      currentPlayer: '0',
      turn: 3,
    },
    events,
    playerID: '0',
  }, {
    cardIDs: [honestCard.id],
  })

  assert.equal(playResult, undefined)
  assert.equal(state.players['0'].matchStats.playCount, 2)
  assert.equal(state.players['0'].matchStats.cardsPlayed, 2)
  assert.equal(state.players['0'].matchStats.lieCount, 1)
}

function runLeaveCharacterEffectsCheck() {
  {
    const state = createScenarioState()
    const { events, record } = createEventRecorder()

    state.players['0'].character = 'The Speedrunner'
    state.players['0'].hand = []
    state.players['0'].points = 2
    state.players['1'].hand = [card('clubs_ace.png')]

    beginTurn({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 1,
      },
      events,
    })

    assert.equal(record.endedGame?.pointsByPlayer['0'], 0)
    assert.equal(state.players['0'].points, 0)
    assert.match(
      state.history.find((event) => event.playerID === '0' && event.kind === 'system')?.detail ?? '',
      /exactly 2 points, so the total became 0 instead/i,
    )
  }

  {
    const state = createScenarioState()
    const { events, record } = createEventRecorder()

    state.players['0'].character = 'The Streamer'
    state.players['0'].hand = []
    state.players['0'].points = 1
    state.players['1'].hand = [card('clubs_ace.png')]

    beginTurn({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 1,
      },
      events,
    })

    assert.equal(record.endedGame?.pointsByPlayer['0'], -1)
    assert.equal(state.players['0'].points, -1)
    assert.match(
      state.history.find((event) => event.playerID === '0' && event.kind === 'system')?.detail ?? '',
      /without ever passing, so 2 points were lost/i,
    )
  }

  {
    const state = createScenarioState()
    const { events, record } = createEventRecorder()

    state.players['0'].character = 'The Pacifist'
    state.players['0'].hand = []
    state.players['0'].points = 0
    state.players['1'].hand = [card('clubs_ace.png')]

    beginTurn({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 1,
      },
      events,
    })

    assert.equal(record.endedGame?.pointsByPlayer['0'], -1)
    assert.equal(state.players['0'].points, -1)
    assert.match(
      state.history.find((event) => event.playerID === '0' && event.kind === 'system')?.detail ?? '',
      /without ever calling BS, so 1 point was lost/i,
    )
  }

  {
    const state = createScenarioState()
    const { events, record } = createEventRecorder()

    state.players['0'].character = 'The Believer'
    state.players['0'].hand = []
    state.players['0'].points = 3
    state.players['1'].hand = [card('clubs_ace.png')]

    beginTurn({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 1,
      },
      events,
    })

    assert.equal(record.endedGame?.pointsByPlayer['0'], 3)
    assert.equal(state.players['0'].points, 3)
    assert.equal(state.history.length, 2)
    assert.equal(state.history[0]?.kind, 'leave')
  }

  {
    const state = createScenarioState()
    const { events, record } = createEventRecorder()

    state.players['0'].character = 'The Believer'
    state.players['0'].hand = []
    state.players['0'].points = 0
    state.players['1'].character = 'The Streamer'
    state.players['1'].hand = [card('clubs_ace.png')]
    state.players['1'].points = 4

    beginTurn({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 1,
      },
      events,
    })

    assert.equal(state.players['0'].hasLeft, true)
    assert.equal(state.players['0'].leaveOrder, 1)
    assert.equal(state.players['1'].hasLeft, true)
    assert.equal(state.players['1'].leaveOrder, 2)
    assert.equal(record.endedGame?.pointsByPlayer['1'], 2)
    assert.equal(state.players['1'].points, 2)
    assert.match(
      state.history.find((event) => event.playerID === '1' && event.kind === 'leave')?.detail ?? '',
      /left the game last/i,
    )
    assert.match(state.history.at(-1)?.detail ?? '', /without ever passing, so 2 points were lost/i)
  }
}

const checks = [
  ['BS resolution', runBSResolutionCheck],
  ['punishment scored-out immediate leave', runPunishmentScoredOutImmediateLeaveCheck],
  ['leave removes table cards', runLeaveRemovesTableCardsCheck],
  ['all-pass reset', runAllPassResetCheck],
  ['reset redistribution', runResetRedistributionCheck],
  ['final-two resolution window', runFinalTwoResolutionWindowCheck],
  ['match stats tracking', runMatchStatsTrackingCheck],
  ['default rank selection', runDefaultRankSelectionCheck],
  ['character assignment', runCharacterAssignmentCheck],
  ['manual character pool', runManualCharacterPoolCheck],
  ['foreigner rules', runForeignerRulesCheck],
  ['grandmaster rules', runGrandmasterRulesCheck],
  ['pawn rules', runPawnRulesCheck],
  ['contrarian rules', runContrarianRulesCheck],
  ['drunkard rules', runDrunkardRulesCheck],
  ['cat rules', runCatRulesCheck],
  ['privileged rules', runPrivilegedRulesCheck],
  ['confused rules', runConfusedRulesCheck],
  ['dreamer repeat trump', runDreamerRepeatTrumpCheck],
  ['dreamer direction cheat', runDreamerDirectionCheatCheck],
  ['dreamer illegal count', runDreamerIllegalCountCheck],
  ['spy rules', runSpyRulesCheck],
  ['characters disabled', runCharactersDisabledCheck],
  ['leave character effects', runLeaveCharacterEffectsCheck],
  ['staged start', runStagedStartCheck],
  ['manual rank selection', runManualRankSelectionCheck],
  ['setup validation', runSetupValidationCheck],
] as const

for (const [label, runCheck] of checks) {
  runCheck()
  console.log(`PASS ${label}`)
}

console.log('All targeted Blow Cow gameplay checks passed.')
