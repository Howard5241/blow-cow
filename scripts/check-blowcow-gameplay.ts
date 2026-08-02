import assert from 'node:assert/strict'
import { BLOW_COW_IMPLEMENTED_CHARACTER_NAMES, type BlowCowCharacterName } from '../src/game/blowCowCharacters.ts'
import {
  type BlowCowAccuseDreamerArgs,
  type BlowCowAdvanceBSRevealArgs,
  type BlowCowAdvanceResetRevealArgs,
  type BlowCowBeginAccusationPunishmentArgs,
  type BlowCowBeginBSPunishmentArgs,
  BlowCowGame,
  type BlowCowCallBSArgs,
  type BlowCowFinalizeAccusationArgs,
  type BlowCowCatHideCardArgs,
  createDeck,
  createInitialBlowCowState,
  DEFAULT_BLOW_COW_SPEED_MULTIPLIER,
  type BlowCowFinalizeResetResolutionArgs,
  getDefaultStandardRankCount,
  isCardFaceUpOnTable,
  type BlowCowCard,
  type BlowCowFinalizeBSResolutionArgs,
  type BlowCowRevealBSCardArgs,
  type BlowCowRevealResetCardArgs,
  type BlowCowGameOver,
  type BlowCowPassArgs,
  type BlowCowPlayRandomArgs,
  type BlowCowSneakPlayArgs,
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
const callBSMove = BlowCowGame.moves.callBS.move as (context: TestContext, args?: BlowCowCallBSArgs) => unknown
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
const sneakPlayMove = BlowCowGame.moves.sneakPlay.move as (
  context: TestContext,
  args: BlowCowSneakPlayArgs,
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
const revealBSCardMove = BlowCowGame.moves.revealBSCard as (
  context: TestContext,
  args: BlowCowRevealBSCardArgs,
) => unknown
const advanceBSRevealMove = BlowCowGame.moves.advanceBSReveal as (
  context: TestContext,
  args: BlowCowAdvanceBSRevealArgs,
) => unknown
const beginBSPunishmentMove = BlowCowGame.moves.beginBSPunishment as (
  context: TestContext,
  args: BlowCowBeginBSPunishmentArgs,
) => unknown
const accuseDreamerMove = BlowCowGame.moves.accuseDreamer.move as (
  context: TestContext,
  args: BlowCowAccuseDreamerArgs,
) => unknown
const beginAccusationPunishmentMove = BlowCowGame.moves.beginAccusationPunishment as (
  context: TestContext,
  args: BlowCowBeginAccusationPunishmentArgs,
) => unknown
const finalizeAccusationMove = BlowCowGame.moves.finalizeAccusation as (
  context: TestContext,
  args: BlowCowFinalizeAccusationArgs,
) => unknown
const callResetMove = BlowCowGame.moves.callReset as (context: TestContext) => unknown
const revealResetCardMove = BlowCowGame.moves.revealResetCard as (
  context: TestContext,
  args: BlowCowRevealResetCardArgs,
) => unknown
const advanceResetRevealMove = BlowCowGame.moves.advanceResetReveal as (
  context: TestContext,
  args: BlowCowAdvanceResetRevealArgs,
) => unknown
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
      accusationCount: 0,
      accusationWinCount: 0,
    }
    state.players[playerID].pendingRevealPlayID = null
    state.players[playerID].hasUsedManualPlay = false
    state.players[playerID].hasUsedGrandmasterBSOverride = false
    state.players[playerID].hasUsedAccusationThisRound = false
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

/**
 * Drives the interactive part of a BS resolution the way the caller's UI does: flip every face-down
 * card of the focused player, confirm the step, repeat, then arm the punishment. Scenarios that only
 * care about the outcome call this immediately before `finalizeBSResolutionMove`.
 */
function completeBSReveal(state: BlowCowState, events: TestContext['events'], turn: number) {
  const resolution = state.bsResolution
  assert.ok(resolution, 'expected a live BS resolution to drive')

  const context: TestContext = {
    G: state,
    ctx: {
      currentPlayer: resolution.callerPlayerID,
      turn,
    },
    events,
    playerID: resolution.callerPlayerID,
  }

  while (state.bsResolution && state.bsResolution.revealStepIndex < state.bsResolution.revealOrder.length) {
    const resolutionID = state.bsResolution.id
    const focusedPlayerID = state.bsResolution.revealOrder[state.bsResolution.revealStepIndex]

    for (const play of state.table.plays.filter((entry) => entry.playerID === focusedPlayerID)) {
      for (const tableCard of play.cards) {
        if (!isCardFaceUpOnTable(play, tableCard.id)) {
          assert.equal(revealBSCardMove(context, { resolutionID, cardID: tableCard.id }), undefined)
        }
      }
    }

    assert.equal(advanceBSRevealMove(context, { resolutionID }), undefined)
  }

  assert.ok(state.bsResolution)
  assert.equal(beginBSPunishmentMove(context, { resolutionID: state.bsResolution.id }), undefined)
}

/**
 * The Reset counterpart of `completeBSReveal`: the caller flips every face-down card of each
 * focused player and confirms each step, which is what unlocks `finalizeResetResolution`.
 */
function completeResetReveal(state: BlowCowState, events: TestContext['events'], turn: number) {
  const resolution = state.resetResolution
  assert.ok(resolution, 'expected a live reset resolution to drive')

  const context: TestContext = {
    G: state,
    ctx: {
      currentPlayer: resolution.callerPlayerID,
      turn,
    },
    events,
    playerID: resolution.callerPlayerID,
  }

  while (state.resetResolution && state.resetResolution.revealStepIndex < state.resetResolution.revealOrder.length) {
    const resolutionID = state.resetResolution.id
    const focusedPlayerID = state.resetResolution.revealOrder[state.resetResolution.revealStepIndex]

    for (const play of state.table.plays.filter((entry) => entry.playerID === focusedPlayerID)) {
      for (const tableCard of play.cards) {
        if (!isCardFaceUpOnTable(play, tableCard.id)) {
          assert.equal(revealResetCardMove(context, { resolutionID, cardID: tableCard.id }), undefined)
        }
      }
    }

    assert.equal(advanceResetRevealMove(context, { resolutionID }), undefined)
  }
}

/**
 * Drives a landed accusation to its end: the accuser arms the travel, then finalizes it. A missed
 * accusation skips the arming step, so this asserts it landed first.
 */
function completeAccusationPunishment(state: BlowCowState, events: TestContext['events'], turn: number) {
  const accusation = state.accusation
  assert.ok(accusation, 'expected a live accusation to drive')
  assert.equal(accusation.wasSuccessful, true, 'expected the accusation to have landed')

  const context: TestContext = {
    G: state,
    ctx: {
      currentPlayer: state.seatOrder[0],
      turn,
    },
    events,
    playerID: accusation.accuserPlayerID,
  }

  assert.equal(beginAccusationPunishmentMove(context, { accusationID: accusation.id }), undefined)
  assert.equal(finalizeAccusationMove(context, { accusationID: accusation.id }), undefined)
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
  // The resolution carries no card faces; the accused's play stays on the table until finalize.
  assert.equal(state.table.plays.find((play) => play.id === 'play-1')?.cards.length, 1)
  assert.deepEqual(state.bsResolution?.revealOrder, ['1'])
  assert.equal(state.table.plays.length, 2)

  completeBSReveal(state, events, 5)

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

  completeBSReveal(state, events, 5)

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

  completeResetReveal(state, events, 4)

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

  completeResetReveal(state, events, 4)

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

    completeResetReveal(state, events, 4)

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
    // The log entry names nobody, so a Contrarian flip is indistinguishable from a Dreamer one.
    const toggleEvent = state.history.find((entry) => entry.title === 'The turn direction changed')
    assert.ok(toggleEvent)
    assert.equal(toggleEvent.playerID, null)
    assert.match(toggleEvent.detail, /counterclockwise/i)
    assert.doesNotMatch(toggleEvent.detail, /contrarian/i)

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
    /*
     * One step per player, so player 1 is listed once even though the Cat-rehidden card sits in a
     * different play from the challenged one. Both must be flipped before Continue unlocks: the
     * reveal walks what the table is showing face down, not what counts as an unresolved play.
     */
    assert.deepEqual(state.bsResolution?.revealOrder, ['1'])

    const resolutionID = state.bsResolution.id
    const revealContext = {
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 5,
      },
      events,
      playerID: '0',
    }

    assert.notEqual(advanceBSRevealMove(revealContext, { resolutionID }), undefined)
    assert.equal(revealBSCardMove(revealContext, { resolutionID, cardID: hiddenCard.id }), undefined)
    // Still blocked: the Cat-rehidden card in play-revealed is face down too.
    assert.notEqual(advanceBSRevealMove(revealContext, { resolutionID }), undefined)
    assert.equal(revealBSCardMove(revealContext, { resolutionID, cardID: revealedCard.id }), undefined)
    assert.equal(state.table.plays[0]?.rehiddenCardIDs?.length ?? 0, 0)
    assert.equal(advanceBSRevealMove(revealContext, { resolutionID }), undefined)
    assert.equal(state.bsResolution?.revealStepIndex, 1)
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
    const { events } = createEventRecorder()
    state.resetResolution = {
      id: 'reset-cat-visibility',
      callerPlayerID: '0',
      kind: 'reset',
      revealOrder: ['1'],
      revealStepIndex: 0,
    }

    const viewAsCaller = () => BlowCowGame.playerView({ G: state, playerID: '0' }) as BlowCowState

    /*
     * A live reset no longer flips the table face up on its own, so a Cat-rehidden card stays
     * masked for everyone but its owner until the caller actually turns it over.
     */
    assert.equal(viewAsCaller().table.plays[0]?.cards[0]?.rank, 'Joker')

    completeResetReveal(state, events, 2)

    assert.deepEqual(state.table.plays[0]?.rehiddenCardIDs, [])
    assert.equal(viewAsCaller().table.plays[0]?.cards[0]?.sprite, revealedCard.sprite)
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

    completeResetReveal(state, events, 2)

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
    assert.equal(state.bsResolution?.targetVerdict?.targetWasHonest, true)

    completeBSReveal(state, events, 2)

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
      targetDeclaredCardCount: 1,
      trumpRank: 'Q',
      punishmentCardCount: 4,
      revealOrder: ['0', '1'],
      revealStepIndex: 0,
      isPunishing: false,
      targetVerdict: {
        targetWasHonest: false,
      },
      punishment: {
        reverseRuleTriggered: false,
        punishedPlayerID: '0',
        unpunishedPlayerID: '1',
      },
    }

    completeBSReveal(state, events, 5)

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

    // Call BS no longer looks at Dreamer rules at all, so challenging a genuine Q here finds an
    // honest play and punishes the caller. Only Accuse can reach the repeated trump.
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
    assert.equal(state.bsResolution?.targetVerdict?.targetWasHonest, true)
    assert.equal(state.bsResolution?.punishment?.punishedPlayerID, '0')
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

    assert.equal(selectTrumpAndPlayMove({
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
    }), undefined)

    const accuseResult = accuseDreamerMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 2,
      },
      events,
      playerID: '0',
    }, {
      targetPlayerID: '1',
    })

    assert.equal(accuseResult, undefined)
    assert.equal(state.accusation?.wasSuccessful, true)
    assert.equal(state.accusation?.caughtCheat, 'repeatTrump')
    assert.equal(state.players['0'].matchStats.accusationWinCount, 1)

    completeAccusationPunishment(state, events, 2)

    assert.equal(state.accusation, null)
    assert.equal(record.endedGame, null)
    assert.equal(record.nextPlayerID, '0')
    assert.equal(state.round.roundNumber, 2)
    assert.equal(state.round.previousTrumpRank, 'Q')
    assert.equal(state.players['1'].matchStats.punishmentCount, 1)
    assertCardSet(state.players['1'].hand, ['hearts_queen.png'])
    assert.match(
      state.history.find((entry) => entry.kind === 'verdict')?.detail ?? '',
      /reused the previous round trump on the opening play/i,
    )
  }

  {
    // The window is the turn straight after the play, and only that turn.
    const state = createScenarioState()
    const repeatedTrumpCard = card('hearts_queen.png')
    const { events } = createEventRecorder()

    state.players['0'].hand = [card('clubs_ace.png')]
    state.players['1'].character = 'The Dreamer'
    state.players['1'].hand = [repeatedTrumpCard]
    state.round.status = 'awaitingTrumpSelection'
    state.round.startingPlayerID = '1'
    state.round.previousTrumpRank = 'Q'

    assert.equal(selectTrumpAndPlayMove({
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
    }), undefined)

    assert.equal(accuseDreamerMove({
      G: state,
      ctx: {
        currentPlayer: '1',
        turn: 3,
      },
      events,
      playerID: '0',
    }, {
      targetPlayerID: '1',
    }), undefined)

    assert.equal(state.accusation?.wasSuccessful, false)
    assert.equal(state.accusation?.caughtCheat, null)
  }
}

function createDreamerDirectionScenario() {
  const state = createScenarioState(3)
  const { events, record } = createEventRecorder()

  state.players['0'].hand = [card('clubs_ace.png')]
  state.players['1'].character = 'The Dreamer'
  state.players['1'].hand = [card('clubs_queen.png')]
  state.players['2'].hand = [card('spades_king.png')]
  state.round.trumpRank = 'Q'
  state.round.direction = 'clockwise'
  state.round.lastNonPassingPlayerID = '2'
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
  ]

  // Seat 0 is on turn, so the direction the tamper is measured against is theirs.
  beginTurn({
    G: state,
    ctx: {
      currentPlayer: '0',
      turn: 3,
    },
    events,
  })

  return { state, events, record }
}

function runDreamerDirectionCheatCheck() {
  {
    // The power itself: The Dreamer flips the direction on somebody else's turn.
    const { state, events, record } = createDreamerDirectionScenario()

    const toggleResult = toggleDirectionMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 3,
      },
      events,
      playerID: '1',
    })

    assert.equal(toggleResult, undefined)
    assert.equal(state.round.direction, 'counterclockwise')
    assert.deepEqual(state.directionTamper, { playerID: '1', turnNumber: 3 })

    // The announcement must not name anyone, or the accusation would be a formality.
    const toggleEvent = state.history.find((entry) => entry.title === 'The turn direction changed')
    assert.ok(toggleEvent)
    assert.equal(toggleEvent.playerID, null)
    assert.doesNotMatch(toggleEvent.detail, /dreamer|seat/i)

    // ...and it must not survive playerView either.
    const spectatorView = BlowCowGame.playerView({ G: state, playerID: '2' })
    assert.equal(spectatorView.directionTamper, null)

    // Any player may raise it, including one who is not on turn.
    const accuseResult = accuseDreamerMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 3,
      },
      events,
      playerID: '2',
    }, {
      targetPlayerID: '1',
    })

    assert.equal(accuseResult, undefined)
    assert.equal(state.accusation?.wasSuccessful, true)
    assert.equal(state.accusation?.caughtCheat, 'directionChange')
    assert.equal(state.accusation?.punishmentCardCount, 2)

    completeAccusationPunishment(state, events, 3)

    assert.equal(record.nextPlayerID, '2')
    assert.equal(state.round.roundNumber, 2)
    // The new round hands every player their accusation back.
    assert.equal(state.players['2'].hasUsedAccusationThisRound, false)
    assert.equal(state.players['1'].matchStats.punishmentCount, 1)
    assertCardSet(state.players['1'].hand, ['clubs_queen.png', 'hearts_queen.png', 'spades_queen.png'])
    assert.match(
      state.history.find((entry) => entry.kind === 'verdict')?.detail ?? '',
      /changed the turn direction/i,
    )
  }

  {
    // Flipping back inside the same turn erases the tamper along with the advantage.
    const { state, events } = createDreamerDirectionScenario()
    const context: TestContext = {
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 3,
      },
      events,
      playerID: '1',
    }

    assert.equal(toggleDirectionMove(context), undefined)
    assert.equal(toggleDirectionMove(context), undefined)
    assert.equal(state.round.direction, 'clockwise')
    assert.equal(state.directionTamper, null)

    assert.equal(accuseDreamerMove({ ...context, playerID: '2' }, { targetPlayerID: '1' }), undefined)
    assert.equal(state.accusation?.wasSuccessful, false)
  }

  {
    // The window closes with the turn it happened in.
    const { state, events } = createDreamerDirectionScenario()

    assert.equal(toggleDirectionMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 3,
      },
      events,
      playerID: '1',
    }), undefined)
    assert.ok(state.directionTamper)

    beginTurn({
      G: state,
      ctx: {
        currentPlayer: '2',
        turn: 4,
      },
      events,
    })

    assert.equal(state.directionTamper, null)
    assert.equal(accuseDreamerMove({
      G: state,
      ctx: {
        currentPlayer: '2',
        turn: 4,
      },
      events,
      playerID: '0',
    }, {
      targetPlayerID: '1',
    }), undefined)
    assert.equal(state.accusation?.wasSuccessful, false)
  }

  {
    // The Contrarian's flip is still bound to their own turn, unlike The Dreamer's.
    const { state, events } = createDreamerDirectionScenario()
    state.players['1'].character = 'The Contrarian'

    assert.notEqual(toggleDirectionMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 3,
      },
      events,
      playerID: '1',
    }), undefined)
    assert.equal(state.round.direction, 'clockwise')
    assert.equal(state.directionTamper, null)
  }
}

function runDreamerSneakPlayCheck() {
  {
    // The power itself: cards go onto the table during somebody else's turn, in silence.
    const { state, events, record } = createDreamerDirectionScenario()
    const sneakedCardID = state.players['1'].hand[0].id
    const tableStatusBefore = state.tableStatus

    assert.equal(sneakPlayMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 3,
      },
      events,
      playerID: '1',
    }, {
      cardIDs: [sneakedCardID],
    }), undefined)

    const sneakedPlay = state.table.plays[state.table.plays.length - 1]
    assert.equal(state.table.plays.length, 3)
    assert.equal(sneakedPlay.playerID, '1')
    assert.equal(sneakedPlay.playedAtTurn, 3)
    assert.equal(sneakedPlay.claimedRank, 'Q')
    assert.equal(sneakedPlay.declaredCardCount, 1)
    assert.equal(sneakedPlay.wasTrumpSelection, false)
    assert.equal(sneakedPlay.revealedAtTurn, null)
    assert.equal(state.players['1'].hand.length, 0)

    // Nothing about the turn moves, and nothing announces it: no history entry, no telemetry, no
    // table status rewrite, and the turn stays with seat 0.
    assert.equal(state.players['1'].pendingRevealPlayID, null)
    assert.equal(state.round.lastNonPassingPlayerID, '2')
    assert.equal(state.round.passStreak, 0)
    assert.equal(state.tableStatus, tableStatusBefore)
    assert.equal(state.history.length, 0)
    assert.equal(state.telemetry.events.some((entry) => entry.playerID === '1'), false)
    assert.equal(record.nextPlayerID, null)

    // The archive is stripped by `hideSecretState`, so it is the one place that may name them.
    const archivedTurn = state.archive.turns.find((entry) => entry.turnNumber === 3 && entry.playerID === '1')
    assert.ok(archivedTurn)
    assert.equal(archivedTurn.actions[0].kind, 'play')
    assert.equal(archivedTurn.actions[0].characterUsed, 'The Dreamer')

    // Caught inside the turn it happened in.
    assert.equal(accuseDreamerMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 3,
      },
      events,
      playerID: '2',
    }, {
      targetPlayerID: '1',
    }), undefined)

    assert.equal(state.accusation?.wasSuccessful, true)
    assert.equal(state.accusation?.caughtCheat, 'sneakPlay')
    assert.equal(state.accusation?.punishmentCardCount, 3)

    completeAccusationPunishment(state, events, 3)

    assert.equal(state.players['1'].matchStats.punishmentCount, 1)
    assertCardSet(state.players['1'].hand, ['clubs_queen.png', 'hearts_queen.png', 'spades_queen.png'])
    assert.match(
      state.history.find((entry) => entry.kind === 'verdict')?.detail ?? '',
      /slipped cards onto the table out of turn/i,
    )
  }

  {
    // The window closes with the turn, exactly like a direction tamper.
    const { state, events } = createDreamerDirectionScenario()

    assert.equal(sneakPlayMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 3,
      },
      events,
      playerID: '1',
    }, {
      cardIDs: [state.players['1'].hand[0].id],
    }), undefined)

    beginTurn({
      G: state,
      ctx: {
        currentPlayer: '2',
        turn: 4,
      },
      events,
    })

    assert.equal(accuseDreamerMove({
      G: state,
      ctx: {
        currentPlayer: '2',
        turn: 4,
      },
      events,
      playerID: '0',
    }, {
      targetPlayerID: '1',
    }), undefined)
    assert.equal(state.accusation?.wasSuccessful, false)
  }

  {
    // Exactly one card, and one per turn so the generated play id cannot collide with itself.
    const { state, events } = createDreamerDirectionScenario()
    state.players['1'].hand = [card('clubs_queen.png'), card('diamonds_queen.png')]

    const context: TestContext = {
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 3,
      },
      events,
      playerID: '1',
    }

    assert.notEqual(sneakPlayMove(context, {
      cardIDs: state.players['1'].hand.map((handCard) => handCard.id),
    }), undefined)
    assert.equal(state.table.plays.length, 2)
    assert.equal(state.players['1'].hand.length, 2)

    assert.equal(sneakPlayMove(context, { cardIDs: [state.players['1'].hand[0].id] }), undefined)
    assert.notEqual(sneakPlayMove(context, { cardIDs: [state.players['1'].hand[0].id] }), undefined)
    assert.equal(state.table.plays.length, 3)
  }

  {
    // Refused on the mover's own turn, refused for anyone who is not The Dreamer, and refused
    // before the round has a rank to claim.
    const { state, events } = createDreamerDirectionScenario()

    assert.notEqual(sneakPlayMove({
      G: state,
      ctx: {
        currentPlayer: '1',
        turn: 3,
      },
      events,
      playerID: '1',
    }, {
      cardIDs: [state.players['1'].hand[0].id],
    }), undefined)

    assert.notEqual(sneakPlayMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 3,
      },
      events,
      playerID: '2',
    }, {
      cardIDs: [state.players['2'].hand[0].id],
    }), undefined)

    state.round.trumpRank = null
    assert.notEqual(sneakPlayMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 3,
      },
      events,
      playerID: '1',
    }, {
      cardIDs: [state.players['1'].hand[0].id],
    }), undefined)

    assert.equal(state.table.plays.length, 2)
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

    // Three genuine Queens against a Q trump: the cards themselves are honest, so BS finds nothing
    // and the count is only reachable through Accuse.
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
    assert.equal(state.bsResolution?.targetVerdict?.targetWasHonest, true)
    assert.equal(state.bsResolution?.punishment?.punishedPlayerID, '0')
  }

  {
    const state = createScenarioState()
    const dreamerCards = [card('clubs_queen.png'), card('diamonds_queen.png'), card('hearts_queen.png')]
    const { events, record } = createEventRecorder()

    state.players['0'].hand = [card('clubs_ace.png')]
    state.players['1'].character = 'The Dreamer'
    state.players['1'].hand = [...dreamerCards]
    state.round.trumpRank = 'Q'

    assert.equal(playMove({
      G: state,
      ctx: {
        currentPlayer: '1',
        turn: 1,
      },
      events,
      playerID: '1',
    }, {
      cardIDs: dreamerCards.map((entry) => entry.id),
    }), undefined)

    const accuseResult = accuseDreamerMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 2,
      },
      events,
      playerID: '0',
    }, {
      targetPlayerID: '1',
    })

    assert.equal(accuseResult, undefined)
    assert.equal(state.accusation?.caughtCheat, 'extraCardCount')

    completeAccusationPunishment(state, events, 2)

    assert.equal(record.nextPlayerID, '0')
    assert.equal(state.players['1'].matchStats.punishmentCount, 1)
    assert.equal(state.players['0'].matchStats.accusationWinCount, 1)
    assert.match(
      state.history.find((entry) => entry.kind === 'verdict')?.detail ?? '',
      /played more cards than they declared/i,
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

    const accuseResult = accuseDreamerMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 11,
      },
      events,
      playerID: '0',
    }, {
      targetPlayerID: '1',
    })

    assert.equal(accuseResult, undefined)
    assert.equal(state.accusation?.caughtCheat, 'exceededTableLimit')
    assert.equal(state.accusation?.punishmentCardCount, 11)

    completeAccusationPunishment(state, events, 11)

    // All eleven table cards land in the Dreamer's hand; the 3s and 4s immediately score out as
    // four-of-a-kind sets, leaving the rest.
    assert.equal(state.players['1'].points, 2)
    assertCardSet(state.players['1'].hand, ['clubs_05.png', 'clubs_queen.png', 'diamonds_queen.png'])
    assert.match(
      state.history.find((entry) => entry.kind === 'verdict')?.detail ?? '',
      /pushed the table past its card limit/i,
    )
  }
}

/**
 * The rules around raising an accusation, as opposed to what any one cheat does: who may raise one,
 * how often, when it is refused outright, and what a miss costs.
 */
function runAccusationRulesCheck() {
  {
    // A wrong accusation turns the punishment around onto the accuser.
    const { state, events, record } = createDreamerDirectionScenario()
    const context: TestContext = {
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 3,
      },
      events,
      playerID: '2',
    }

    assert.equal(accuseDreamerMove(context, { targetPlayerID: '1' }), undefined)
    assert.equal(state.accusation?.wasSuccessful, false)
    assert.equal(state.accusation?.punishedPlayerID, '2')
    assert.equal(state.accusation?.unpunishedPlayerID, '1')
    assert.equal(state.players['2'].hasUsedAccusationThisRound, true)
    assert.equal(state.players['2'].matchStats.accusationCount, 1)
    assert.equal(state.players['2'].matchStats.accusationWinCount, 0)

    // A miss still has to be armed and pressed, exactly like a hit.
    const accusationID = state.accusation!.id
    assert.notEqual(finalizeAccusationMove(context, { accusationID }), undefined)
    assert.equal(beginAccusationPunishmentMove(context, { accusationID }), undefined)
    assert.equal(finalizeAccusationMove(context, { accusationID }), undefined)

    assert.equal(state.accusation === null, true)
    assert.equal(state.round.roundNumber, 2)
    // The accuser took the table; the Dreamer they named walks away and opens the next round.
    assert.equal(state.players['2'].matchStats.punishmentCount, 1)
    assert.equal(state.players['1'].matchStats.punishmentCount, 0)
    assert.equal(record.nextPlayerID, '1')
    assertCardSet(state.players['2'].hand, ['spades_king.png', 'hearts_queen.png', 'spades_queen.png'])
    assert.match(
      state.history.find((entry) => entry.kind === 'verdict')?.detail ?? '',
      /broke no Dreamer rule/i,
    )
    // The new round hands every player their accusation back.
    assert.equal(state.players['2'].hasUsedAccusationThisRound, false)
  }

  {
    // One accusation per player per round, spent on a miss as surely as on a hit.
    const { state, events } = createDreamerDirectionScenario()
    const context: TestContext = {
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 3,
      },
      events,
      playerID: '2',
    }

    assert.equal(accuseDreamerMove(context, { targetPlayerID: '1' }), undefined)
    const accusationID = state.accusation!.id
    assert.equal(beginAccusationPunishmentMove(context, { accusationID }), undefined)
    assert.equal(finalizeAccusationMove(context, { accusationID }), undefined)

    // Seat 2 spent theirs before the round rolled over, so only the fresh budget is in play now.
    state.players['2'].hasUsedAccusationThisRound = true
    assert.notEqual(accuseDreamerMove(context, { targetPlayerID: '1' }), undefined)
    assert.equal(state.accusation === null, true)
    assert.equal(accuseDreamerMove({ ...context, playerID: '0' }, { targetPlayerID: '1' }), undefined)
    assert.equal(state.accusation?.accuserPlayerID, '0')
  }

  {
    // Refused outright: on yourself, on a player who has left, and while another procedure owns the
    // table.
    const { state, events } = createDreamerDirectionScenario()
    const context: TestContext = {
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 3,
      },
      events,
      playerID: '0',
    }

    assert.notEqual(accuseDreamerMove(context, { targetPlayerID: '0' }), undefined)
    assert.notEqual(accuseDreamerMove(context, { targetPlayerID: '9' }), undefined)

    state.players['1'].hasLeft = true
    assert.notEqual(accuseDreamerMove(context, { targetPlayerID: '1' }), undefined)
    state.players['1'].hasLeft = false
    assert.equal(state.players['0'].hasUsedAccusationThisRound, false)

    state.resetResolution = {
      id: 'reset-block',
      callerPlayerID: '0',
      kind: 'reset',
      revealOrder: [],
      revealStepIndex: 0,
    }
    assert.notEqual(accuseDreamerMove(context, { targetPlayerID: '1' }), undefined)
    state.resetResolution = null

    // ...and a live accusation blocks every ordinary move, including a BS call and a toggle.
    assert.equal(accuseDreamerMove(context, { targetPlayerID: '1' }), undefined)
    assert.ok(state.accusation)
    assert.notEqual(callBSMove({ ...context, playerID: '2' }), undefined)
    assert.notEqual(passMove({ ...context, playerID: '0' }), undefined)
    assert.notEqual(toggleDirectionMove({ ...context, playerID: '1' }), undefined)
  }

  {
    // Only the accuser drives their own accusation to its end.
    const { state, events } = createDreamerDirectionScenario()
    const context: TestContext = {
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 3,
      },
      events,
      playerID: '2',
    }

    assert.equal(toggleDirectionMove({ ...context, playerID: '1' }), undefined)
    assert.equal(accuseDreamerMove(context, { targetPlayerID: '1' }), undefined)

    const accusationID = state.accusation!.id
    assert.equal(state.accusation?.wasSuccessful, true)

    // Not the accused, not a bystander, and not with a stale id.
    assert.notEqual(beginAccusationPunishmentMove({ ...context, playerID: '1' }, { accusationID }), undefined)
    assert.notEqual(beginAccusationPunishmentMove({ ...context, playerID: '0' }, { accusationID }), undefined)
    assert.notEqual(beginAccusationPunishmentMove(context, { accusationID: 'accuse-nope' }), undefined)
    assert.equal(state.accusation?.isPunishing, false)

    // The finalize is refused until the travel has actually been armed.
    assert.notEqual(finalizeAccusationMove(context, { accusationID }), undefined)
    assert.ok(state.accusation)

    assert.equal(beginAccusationPunishmentMove(context, { accusationID }), undefined)
    assert.equal(state.accusation?.isPunishing, true)
    assert.notEqual(beginAccusationPunishmentMove(context, { accusationID }), undefined)
    assert.notEqual(finalizeAccusationMove({ ...context, playerID: '0' }, { accusationID }), undefined)
    assert.equal(finalizeAccusationMove(context, { accusationID }), undefined)
    assert.equal(state.accusation, null)
  }

  {
    // Only The Dreamer can be accused. Characters are public, so naming anybody else is refused
    // outright rather than resolved as a miss, and costs the accuser nothing.
    const { state, events } = createDreamerDirectionScenario()
    state.players['1'].character = 'The Believer'

    const context: TestContext = {
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 3,
      },
      events,
      playerID: '0',
    }

    assert.notEqual(accuseDreamerMove(context, { targetPlayerID: '1' }), undefined)
    assert.equal(state.accusation === null, true)
    assert.equal(state.players['0'].hasUsedAccusationThisRound, false)
    assert.equal(state.players['0'].matchStats.accusationCount, 0)

    // ...and the accusation is still there to spend once there is a Dreamer to spend it on.
    state.players['1'].character = 'The Dreamer'
    assert.equal(accuseDreamerMove(context, { targetPlayerID: '1' }), undefined)
    assert.equal(state.accusation?.accuserPlayerID, '0')
  }
}

/**
 * `turn.activePlayers` makes every seat permanently active in boardgame.io's eyes, so the framework
 * no longer drops out-of-turn moves and each move has to enforce the turn itself. This is the
 * regression test for those guards.
 *
 * It can only cover the guards, not the config: this harness calls the move functions directly
 * rather than through the reducer, so `IsPlayerActive` never runs here either way.
 */
function runTurnOwnershipCheck() {
  const state = createScenarioState(4)
  const { events } = createEventRecorder()
  const revealedTableCard = card('clubs_03.png')

  state.players['0'].hand = [card('clubs_ace.png'), card('clubs_queen.png')]
  state.players['1'].character = 'The Dreamer'
  state.players['1'].hand = [card('diamonds_queen.png')]
  state.players['2'].character = 'The Drunkard'
  state.players['2'].hand = [card('hearts_queen.png')]
  state.players['3'].character = 'The Cat'
  state.players['3'].hand = [card('spades_ace.png')]
  state.round.trumpRank = 'Q'
  state.round.direction = 'clockwise'
  state.round.lastNonPassingPlayerID = '1'
  state.round.maxCardsOnTable = 6
  state.table.plays = [
    {
      id: 'play-revealed',
      playerID: '3',
      cards: [revealedTableCard],
      claimedRank: 'Q',
      playedAtRound: 1,
      playedAtTurn: 1,
      revealedAtTurn: 1,
      wasTrumpSelection: false,
    },
    {
      id: 'play-hidden',
      playerID: '1',
      cards: [card('spades_king.png')],
      claimedRank: 'Q',
      playedAtRound: 1,
      playedAtTurn: 1,
      revealedAtTurn: null,
      wasTrumpSelection: false,
    },
  ]
  state.players['1'].pendingRevealPlayID = 'play-hidden'

  beginTurn({
    G: state,
    ctx: {
      currentPlayer: '0',
      turn: 2,
    },
    events,
  })

  const outOfTurn = (playerID: string): TestContext => ({
    G: state,
    ctx: {
      currentPlayer: '0',
      turn: 2,
    },
    events,
    playerID,
    random: {
      Shuffle: identityShuffle,
    },
  })

  // Every turn-bound move, from a seat that is not the current player.
  assert.notEqual(playMove(outOfTurn('2'), { cardIDs: [state.players['2'].hand[0].id] }), undefined)
  assert.notEqual(playRandomMove(outOfTurn('2'), { cardCount: 1 }), undefined)
  assert.notEqual(passMove(outOfTurn('2')), undefined)
  assert.notEqual(callBSMove(outOfTurn('2'), { targetPlayerID: '1' }), undefined)
  assert.notEqual(callResetMove(outOfTurn('2')), undefined)
  assert.notEqual(catHideCardMove(outOfTurn('3'), { cardID: revealedTableCard.id }), undefined)

  // Nothing moved: no card left a hand, the table is untouched, and no procedure opened.
  assert.equal(state.table.plays.length, 2)
  assert.equal(state.players['2'].hand.length, 1)
  assert.equal(state.players['3'].hand.length, 1)
  assert.equal(isCardFaceUpOnTable(state.table.plays[0], revealedTableCard.id), true)
  assert.equal(state.bsResolution, null)
  assert.equal(state.resetResolution, null)
  assert.equal(state.round.passStreak, 0)

  // The two powers that are defined by acting out of turn still work.
  assert.equal(toggleDirectionMove(outOfTurn('1')), undefined)
  assert.equal(state.round.direction, 'counterclockwise')
  assert.equal(accuseDreamerMove(outOfTurn('2'), { targetPlayerID: '1' }), undefined)
  assert.equal(state.accusation?.accuserPlayerID, '2')

  // ...and the same moves are legal for the seat whose turn it actually is, which is what proves
  // the refusals above were about the turn and not about the scenario being unplayable.
  const freshState = createScenarioState(4)
  freshState.players['0'].hand = [card('clubs_queen.png')]
  freshState.players['1'].hand = [card('diamonds_queen.png')]
  freshState.players['2'].hand = [card('hearts_queen.png')]
  freshState.players['3'].hand = [card('spades_ace.png')]
  freshState.round.trumpRank = 'Q'

  assert.equal(playMove({
    G: freshState,
    ctx: {
      currentPlayer: '0',
      turn: 2,
    },
    events,
    playerID: '0',
  }, {
    cardIDs: [freshState.players['0'].hand[0].id],
  }), undefined)
  assert.equal(freshState.table.plays.length, 1)
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
  assert.equal(state.bsResolution?.targetVerdict?.targetWasHonest, false)

  completeBSReveal(state, events, 4)

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

/**
 * Builds a 4-seat table with hidden plays in front of seats 0, 1 and 3, seat 2 holding nothing, and
 * seat 0 as the caller challenging seat 1. Direction is clockwise, so the reveal must walk
 * counterclockwise from the accused: 1, then 0, then 3 (2 is skipped).
 */
function createBSRevealScenario() {
  const state = createScenarioState(4)

  state.round.trumpRank = 'Q'
  state.round.direction = 'clockwise'
  state.round.lastNonPassingPlayerID = '1'

  for (const playerID of state.seatOrder) {
    state.players[playerID].hand = [card('clubs_ace.png')]
  }

  state.table.plays = [
    {
      id: 'play-0',
      playerID: '3',
      cards: [card('spades_queen.png')],
      claimedRank: 'Q',
      playedAtRound: 1,
      playedAtTurn: 1,
      revealedAtTurn: null,
      wasTrumpSelection: true,
    },
    {
      id: 'play-1',
      playerID: '0',
      cards: [card('hearts_queen.png')],
      claimedRank: 'Q',
      playedAtRound: 1,
      playedAtTurn: 2,
      revealedAtTurn: null,
      wasTrumpSelection: false,
    },
    {
      id: 'play-2',
      playerID: '1',
      cards: [card('clubs_king.png'), card('diamonds_king.png')],
      claimedRank: 'Q',
      playedAtRound: 1,
      playedAtTurn: 3,
      revealedAtTurn: null,
      wasTrumpSelection: false,
    },
  ]
  state.players['1'].pendingRevealPlayID = 'play-2'

  return state
}

function runBSRevealProcedureCheck() {
  const state = createBSRevealScenario()
  const { events, record } = createEventRecorder()
  const callerContext: TestContext = {
    G: state,
    ctx: {
      currentPlayer: '0',
      turn: 5,
    },
    events,
    playerID: '0',
  }

  assert.equal(callBSMove(callerContext), undefined)
  assert.ok(state.bsResolution)

  const resolutionID = state.bsResolution.id
  // Accused first, then counterclockwise against the clockwise turn direction. Seat 2 has nothing
  // face down, so it never comes to the centre.
  assert.deepEqual(state.bsResolution.revealOrder, ['1', '0', '3'])
  assert.equal(state.bsResolution.revealStepIndex, 0)
  assert.equal(state.bsResolution.isPunishing, false)

  // A card belonging to a player who is not the focused one is out of turn.
  assert.notEqual(
    revealBSCardMove(callerContext, { resolutionID, cardID: state.table.plays[1].cards[0].id }),
    undefined,
  )
  // Continue is refused while the focused player still has anything face down.
  assert.notEqual(advanceBSRevealMove(callerContext, { resolutionID }), undefined)
  // And so is the finalize, so the procedure cannot be skipped.
  assert.notEqual(finalizeBSResolutionMove(callerContext, { resolutionID }), undefined)

  const [firstTargetCard, secondTargetCard] = state.table.plays[2].cards
  assert.equal(revealBSCardMove(callerContext, { resolutionID, cardID: firstTargetCard.id }), undefined)
  assert.deepEqual(state.table.plays[2].revealedCardIDs, [firstTargetCard.id])
  // Still one card short.
  assert.notEqual(advanceBSRevealMove(callerContext, { resolutionID }), undefined)
  // Flipping an already face-up card is a no-op, not a way to satisfy the step.
  assert.notEqual(revealBSCardMove(callerContext, { resolutionID, cardID: firstTargetCard.id }), undefined)

  assert.equal(revealBSCardMove(callerContext, { resolutionID, cardID: secondTargetCard.id }), undefined)
  assert.equal(advanceBSRevealMove(callerContext, { resolutionID }), undefined)
  assert.equal(state.bsResolution?.revealStepIndex, 1)

  assert.equal(revealBSCardMove(callerContext, { resolutionID, cardID: state.table.plays[1].cards[0].id }), undefined)
  assert.equal(advanceBSRevealMove(callerContext, { resolutionID }), undefined)
  assert.equal(revealBSCardMove(callerContext, { resolutionID, cardID: state.table.plays[0].cards[0].id }), undefined)
  assert.equal(advanceBSRevealMove(callerContext, { resolutionID }), undefined)

  assert.equal(state.bsResolution?.revealStepIndex, 3)
  // Nothing left to advance through.
  assert.notEqual(advanceBSRevealMove(callerContext, { resolutionID }), undefined)

  assert.equal(beginBSPunishmentMove(callerContext, { resolutionID }), undefined)
  assert.equal(state.bsResolution?.isPunishing, true)
  // Punish is not idempotent; a second press must not re-arm the travel.
  assert.notEqual(beginBSPunishmentMove(callerContext, { resolutionID }), undefined)
  // The table is still intact, so every client can measure the cards for the travel animation.
  assert.equal(state.table.plays.length, 3)

  assert.equal(finalizeBSResolutionMove(callerContext, { resolutionID }), undefined)
  assert.equal(state.bsResolution, null)
  // Seat 1 played Kings against a Q trump, so the accused lied and takes all four table cards.
  assert.equal(state.players['1'].hand.length, 5)
  assert.equal(state.players['1'].matchStats.punishmentCount, 1)
  assert.equal(state.players['0'].matchStats.bsWinCount, 1)
  assert.equal(record.nextPlayerID, '0')
  assert.match(
    state.history.find((event) => event.kind === 'verdict')?.detail ?? '',
    /was dishonest/i,
  )
}

function runBSResolutionCallerOnlyCheck() {
  const state = createBSRevealScenario()
  const { events } = createEventRecorder()
  const callerContext: TestContext = {
    G: state,
    ctx: {
      currentPlayer: '0',
      turn: 5,
    },
    events,
    playerID: '0',
  }

  assert.equal(callBSMove(callerContext), undefined)
  assert.ok(state.bsResolution)

  const resolutionID = state.bsResolution.id
  // The accused, who has the strongest motive to drive the reveal themselves.
  const otherContext: TestContext = { ...callerContext, playerID: '1' }
  const targetCardID = state.table.plays[2].cards[0].id

  assert.notEqual(revealBSCardMove(otherContext, { resolutionID, cardID: targetCardID }), undefined)
  assert.notEqual(advanceBSRevealMove(otherContext, { resolutionID }), undefined)
  assert.notEqual(beginBSPunishmentMove(otherContext, { resolutionID }), undefined)
  assert.notEqual(finalizeBSResolutionMove(otherContext, { resolutionID }), undefined)
  assert.equal(state.table.plays[2].revealedCardIDs ?? undefined, undefined)

  // A stale resolution id is refused even from the caller, so a queued click cannot land on the
  // next resolution.
  assert.notEqual(revealBSCardMove(callerContext, { resolutionID: 'bs-stale', cardID: targetCardID }), undefined)
  assert.notEqual(advanceBSRevealMove(callerContext, { resolutionID: 'bs-stale' }), undefined)
}

function runBSResolutionHiddenStateCheck() {
  const state = createBSRevealScenario()
  const { events } = createEventRecorder()
  const callerContext: TestContext = {
    G: state,
    ctx: {
      currentPlayer: '0',
      turn: 5,
    },
    events,
    playerID: '0',
  }
  const playerView = BlowCowGame.playerView as (args: { G: BlowCowState; playerID: string | null }) => BlowCowState
  // Seat 2 is a bystander: no table cards of their own, so nothing is exempt from masking for them.
  const viewAsBystander = () => playerView({ G: state, playerID: '2' })
  const getViewedPlay = (playID: string) => viewAsBystander().table.plays.find((play) => play.id === playID)

  assert.equal(callBSMove(callerContext), undefined)
  assert.ok(state.bsResolution)

  const resolutionID = state.bsResolution.id
  const [firstTargetCard, secondTargetCard] = state.table.plays[2].cards

  // Nothing about the outcome may reach a client before the caller has revealed it.
  assert.equal(viewAsBystander().bsResolution?.targetVerdict, null)
  assert.equal(viewAsBystander().bsResolution?.punishment, null)
  assert.equal(getViewedPlay('play-2')?.cards.every((viewedCard) => viewedCard.rank === 'Joker'), true)
  assert.doesNotMatch(state.tableStatus, /honest|lie|dishonest|punish/i)

  assert.equal(revealBSCardMove(callerContext, { resolutionID, cardID: firstTargetCard.id }), undefined)
  // A flipped card is visible to everyone; its partner still is not.
  assert.equal(getViewedPlay('play-2')?.cards[0].sprite, 'clubs_king.png')
  assert.equal(getViewedPlay('play-2')?.cards[1].rank, 'Joker')
  // The verdict is still withheld: the accused's step is not confirmed yet.
  assert.equal(viewAsBystander().bsResolution?.targetVerdict, null)

  assert.equal(revealBSCardMove(callerContext, { resolutionID, cardID: secondTargetCard.id }), undefined)
  assert.equal(advanceBSRevealMove(callerContext, { resolutionID }), undefined)

  assert.equal(viewAsBystander().bsResolution?.targetVerdict?.targetWasHonest, false)
  // The punishment, which the Reverse Rule can still swap, waits for the whole table.
  assert.equal(viewAsBystander().bsResolution?.punishment, null)
  assert.doesNotMatch(state.tableStatus, /honest|lie|dishonest|punish/i)

  assert.equal(revealBSCardMove(callerContext, { resolutionID, cardID: state.table.plays[1].cards[0].id }), undefined)
  assert.equal(advanceBSRevealMove(callerContext, { resolutionID }), undefined)
  assert.equal(revealBSCardMove(callerContext, { resolutionID, cardID: state.table.plays[0].cards[0].id }), undefined)
  assert.equal(advanceBSRevealMove(callerContext, { resolutionID }), undefined)

  assert.equal(viewAsBystander().bsResolution?.punishment?.punishedPlayerID, '1')
  // Every table card is face up for every viewer once the reveal is done.
  assert.equal(
    viewAsBystander().table.plays.every((play) => play.cards.every((viewedCard) => viewedCard.rank !== 'Joker')),
    true,
  )
}

function runResetRevealProcedureCheck() {
  const state = createBSRevealScenario()
  const { events } = createEventRecorder()
  // Seat 3 opened the round, so a Reset called by seat 3 starts its walk on itself.
  const callerContext: TestContext = {
    G: state,
    ctx: {
      currentPlayer: '3',
      turn: 5,
    },
    events,
    playerID: '3',
    random: {
      Shuffle: identityShuffle,
    },
  }

  state.round.maxCardsOnTable = 4

  assert.equal(callResetMove(callerContext), undefined)
  assert.ok(state.resetResolution)

  const resolutionID = state.resetResolution.id
  // Caller first, then counterclockwise against the clockwise turn direction. Seat 2 has nothing
  // face down, so it never comes to the centre.
  assert.deepEqual(state.resetResolution.revealOrder, ['3', '1', '0'])
  assert.equal(state.resetResolution.revealStepIndex, 0)

  // The table no longer flips itself face up, so a bystander still sees card backs.
  const viewAsBystander = () => BlowCowGame.playerView({ G: state, playerID: '2' }) as BlowCowState
  assert.equal(
    viewAsBystander().table.plays.every((play) => play.cards.every((viewedCard) => viewedCard.rank === 'Joker')),
    true,
  )
  assert.doesNotMatch(state.tableStatus, /honest|lie|dishonest/i)

  // Nothing may be skipped: neither out-of-turn cards, nor Continue, nor the finalize itself.
  assert.notEqual(
    revealResetCardMove(callerContext, { resolutionID, cardID: state.table.plays[1].cards[0].id }),
    undefined,
  )
  assert.notEqual(advanceResetRevealMove(callerContext, { resolutionID }), undefined)
  assert.notEqual(finalizeResetResolutionMove(callerContext, { resolutionID }), undefined)

  // A non-caller cannot drive the procedure either.
  const otherContext: TestContext = { ...callerContext, playerID: '1' }
  assert.notEqual(
    revealResetCardMove(otherContext, { resolutionID, cardID: state.table.plays[0].cards[0].id }),
    undefined,
  )
  assert.notEqual(advanceResetRevealMove(otherContext, { resolutionID }), undefined)

  completeResetReveal(state, events, 5)

  assert.equal(state.resetResolution?.revealStepIndex, 3)
  assert.equal(
    viewAsBystander().table.plays.every((play) => play.cards.every((viewedCard) => viewedCard.rank !== 'Joker')),
    true,
  )

  assert.equal(finalizeResetResolutionMove(callerContext, { resolutionID }), undefined)
  assert.equal(state.resetResolution, null)
  assert.equal(state.table.plays.length, 0)
  // Four table cards redistributed across four seats, on top of the one card each already held.
  assert.deepEqual(state.seatOrder.map((seatID) => state.players[seatID].hand.length), [2, 2, 2, 2])
}

const checks = [
  ['BS resolution', runBSResolutionCheck],
  ['BS reveal procedure', runBSRevealProcedureCheck],
  ['BS resolution caller only', runBSResolutionCallerOnlyCheck],
  ['BS resolution hidden state', runBSResolutionHiddenStateCheck],
  ['punishment scored-out immediate leave', runPunishmentScoredOutImmediateLeaveCheck],
  ['leave removes table cards', runLeaveRemovesTableCardsCheck],
  ['all-pass reset', runAllPassResetCheck],
  ['reset redistribution', runResetRedistributionCheck],
  ['reset reveal procedure', runResetRevealProcedureCheck],
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
  ['dreamer sneak play', runDreamerSneakPlayCheck],
  ['dreamer illegal count', runDreamerIllegalCountCheck],
  ['accusation rules', runAccusationRulesCheck],
  ['turn ownership guards', runTurnOwnershipCheck],
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
