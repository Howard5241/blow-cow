import assert from 'node:assert/strict'
import { BLOW_COW_IMPLEMENTED_CHARACTER_NAMES, type BlowCowCharacterName } from '../src/game/blowCowCharacters.ts'
import {
  BLOW_COW_RULE_DEFINITIONS,
  BLOW_COW_RULE_IDS,
  canRuleTakeStatus,
  createDefaultRulesState,
  formatRuleTitle,
  getRuleDescription,
  getRuleStatusOptions,
  isDefaultRulesSelection,
  normalizeRulesSelection,
  type BlowCowRuleID,
  type BlowCowRulesState,
} from '../src/game/blowCowRules.ts'
import {
  type BlowCowAccuseDreamerArgs,
  type BlowCowAdvanceBSRevealArgs,
  type BlowCowAdvanceResetRevealArgs,
  type BlowCowBeginAccusationPunishmentArgs,
  type BlowCowBeginBSPunishmentArgs,
  type BlowCowBeginResetPunishmentArgs,
  BLOW_COW_RANKS,
  BlowCowGame,
  CARD_BACK_SPRITE,
  type BlowCowCallBSArgs,
  type BlowCowFinalizeAccusationArgs,
  type BlowCowCatHideCardArgs,
  type BlowCowBreakRuleArgs,
  type BlowCowConspireArgs,
  type BlowCowDefyArgs,
  type BlowCowEmoteArgs,
  type BlowCowManipulateArgs,
  canBreakRule,
  canConspire,
  canEarnEncore,
  canManipulate,
  canMimic,
  canUseDefy,
  getEncoreBSTargetPlayerID,
  getConspiracyTargetPlayerIDs,
  getManipulableTrumpRanks,
  getManipulationTargetPlayerIDs,
  getMimicryTargetPlayerID,
  createDeck,
  createInitialBlowCowState,
  DEFAULT_BLOW_COW_SPEED_MULTIPLIER,
  DEFY_HISTORY_OMEN,
  formatLeaveEffectLabel,
  type BlowCowFinalizeResetResolutionArgs,
  getBreakableRuleIDs,
  getDefaultStandardRankCount,
  getSeekerCharacterChoices,
  getTableCardCount,
  isCardFaceUpOnTable,
  isSeeker,
  type BlowCowSeekCharacterArgs,
  type BlowCowCard,
  type BlowCowFinalizeBSResolutionArgs,
  type BlowCowRevealBSCardArgs,
  type BlowCowRevealResetCardArgs,
  type BlowCowGameOver,
  type BlowCowPassArgs,
  type BlowCowPlayRandomArgs,
  type BlowCowSneakPlayArgs,
  type BlowCowTakeBackCardArgs,
  type BlowCowRank,
  scoreHand,
  type BlowCowSetupData,
  type BlowCowState,
} from '../src/game/blowCowGame.ts'
import { comparePokerHands, evaluatePokerHand } from '../src/game/blowCowPoker.ts'
// The one UI module this harness reaches into. It is pure play-and-card logic with no React or DOM,
// and what The Mime promises is a claim about what the ring draws, so it cannot be checked anywhere
// else: the whole ability is the two branches of its coin flip being drawn identically.
import { getDisplayedFrontCards } from '../src/ui/tablePlays.ts'

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
const takeBackCardMove = BlowCowGame.moves.takeBackCard.move as (
  context: TestContext,
  args: BlowCowTakeBackCardArgs,
) => unknown
const toggleDirectionMove = BlowCowGame.moves.toggleDirection as (context: TestContext) => unknown
const catHideCardMove = BlowCowGame.moves.catHideCard as (
  context: TestContext,
  args: BlowCowCatHideCardArgs,
) => unknown
const seekCharacterMove = BlowCowGame.moves.seekCharacter as (
  context: TestContext,
  args: BlowCowSeekCharacterArgs,
) => unknown
const breakRuleMove = BlowCowGame.moves.breakRule as (
  context: TestContext,
  args: BlowCowBreakRuleArgs,
) => unknown
const defyMove = BlowCowGame.moves.defy as (
  context: TestContext,
  args: BlowCowDefyArgs,
) => unknown
const emoteMove = BlowCowGame.moves.emote.move as (
  context: TestContext,
  args: BlowCowEmoteArgs,
) => unknown
const conspireMove = BlowCowGame.moves.conspire.move as (
  context: TestContext,
  args: BlowCowConspireArgs,
) => unknown
const manipulateMove = BlowCowGame.moves.manipulate as (
  context: TestContext,
  args: BlowCowManipulateArgs,
) => unknown
const mimicMove = BlowCowGame.moves.mimic.move as (context: TestContext) => unknown
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
const callResetMove = BlowCowGame.moves.callReset.move as (context: TestContext) => unknown
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
const beginResetPunishmentMove = BlowCowGame.moves.beginResetPunishment as (
  context: TestContext,
  args: BlowCowBeginResetPunishmentArgs,
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
  state.round.forcedPlayPlayerID = null
  state.round.maxCardsOnTable = 10
  state.directionTamper = null
  state.directionFlip = null

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
    state.players[playerID].hasUsedDefyThisRound = false
    state.players[playerID].hasUsedConspireThisRound = false
    state.players[playerID].hasUsedMimicThisRound = false
    state.players[playerID].hasUsedClownEncoreThisRound = false
    state.players[playerID].wasPunishedThisRound = false
    state.players[playerID].wasPunishedLastRound = false
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

/**
 * The Contrarian is a second layer of the Reverse Rule, and it applies only to the calls they make.
 * Every case here drives a whole resolution, because the flip is decided at call time and only shows
 * itself when the punishment lands.
 */
function runContrarianRulesCheck() {
  /**
   * Player 0 calls BS on player 1's hidden play. `targetCardSprite` decides whether the accused lied,
   * and `paddingCardSprites` are the face-up cards the Reverse Rule counts.
   */
  const createContrarianBSScenario = (
    callerCharacter: BlowCowCharacterName,
    targetCardSprite: string,
    paddingCardSprites: string[] = [],
  ) => {
    const state = createScenarioState()
    const { events, record } = createEventRecorder()

    state.players['0'].character = callerCharacter
    state.players['0'].hand = [card('clubs_ace.png')]
    state.players['1'].hand = [card('spades_king.png')]
    state.round.trumpRank = 'Q'
    state.round.lastNonPassingPlayerID = '1'
    state.table.plays = [
      ...paddingCardSprites.map((sprite, index) => ({
        id: `play-padding-${index}`,
        playerID: '0',
        cards: [card(sprite)],
        claimedRank: 'Q' as const,
        playedAtRound: 1,
        playedAtTurn: index + 1,
        revealedAtTurn: index + 2,
        wasTrumpSelection: false,
      })),
      {
        id: 'play-target',
        playerID: '1',
        cards: [card(targetCardSprite)],
        claimedRank: 'Q' as const,
        playedAtRound: 1,
        playedAtTurn: 4,
        revealedAtTurn: null,
        wasTrumpSelection: false,
      },
    ]
    state.players['1'].pendingRevealPlayID = 'play-target'

    return { state, events, record }
  }

  const resolveContrarianBS = (state: BlowCowState, events: TestContext['events']) => {
    assert.equal(callBSMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 5,
      },
      events,
      playerID: '0',
    }), undefined)

    assert.ok(state.bsResolution)
    const { id: resolutionID, punishment } = state.bsResolution
    assert.ok(punishment)

    completeBSReveal(state, events, 5)
    assert.equal(finalizeBSResolutionMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 5,
      },
      events,
      playerID: '0',
    }, {
      resolutionID,
    }), undefined)

    return punishment
  }

  {
    // A dishonest accused would normally take the table. The Contrarian called it, so the caller does
    // instead — the ability cuts against its owner exactly as often as it helps them.
    const { state, events, record } = createContrarianBSScenario('The Contrarian', 'spades_king.png')
    const punishment = resolveContrarianBS(state, events)

    assert.equal(punishment.contrarianTriggered, true)
    assert.equal(punishment.reverseRuleTriggered, false)
    assert.equal(punishment.punishedPlayerID, '0')
    assert.equal(punishment.unpunishedPlayerID, '1')
    assert.equal(state.players['0'].matchStats.punishmentCount, 1)
    assert.equal(state.players['1'].matchStats.punishmentCount, 0)
    // The unpunished player opens the next round, so the flip hands that away too.
    assert.equal(record.nextPlayerID, '1')
    assert.equal(state.players['0'].matchStats.bsWinCount, 0)
    assert.match(
      state.history.find((entry) => entry.kind === 'verdict')?.detail ?? '',
      /is The Contrarian, so the punishment was reversed\./,
    )
  }

  {
    // ...and the mirror: an honest accused normally sends the table to the caller, and here it does
    // not. This is the half worth having.
    const { state, events, record } = createContrarianBSScenario('The Contrarian', 'hearts_queen.png')
    const punishment = resolveContrarianBS(state, events)

    assert.equal(punishment.contrarianTriggered, true)
    assert.equal(punishment.punishedPlayerID, '1')
    assert.equal(punishment.unpunishedPlayerID, '0')
    assert.equal(state.players['1'].matchStats.punishmentCount, 1)
    assert.equal(state.players['0'].matchStats.bsWinCount, 1)
    assert.equal(record.nextPlayerID, '0')
  }

  {
    // Two layers of reverse cancel. Four trump-rank cards on the table plus The Contrarian is the
    // default punishment after all, and the verdict line says so rather than narrating a flip back.
    const { state, events } = createContrarianBSScenario('The Contrarian', 'hearts_queen.png', [
      'clubs_queen.png',
      'diamonds_queen.png',
      'spades_queen.png',
    ])
    const punishment = resolveContrarianBS(state, events)

    assert.equal(punishment.reverseRuleTriggered, true)
    assert.equal(punishment.contrarianTriggered, true)
    // Accused was honest, so the default punishes the caller and both flips leave it there.
    assert.equal(punishment.punishedPlayerID, '0')
    assert.match(
      state.history.find((entry) => entry.kind === 'verdict')?.detail ?? '',
      /is The Contrarian, so the default punishment stood\./,
    )
  }

  {
    // Bound to the caller's seat. Being called on by a Contrarian does nothing at all.
    const { state, events } = createContrarianBSScenario('The Believer', 'spades_king.png')
    state.players['1'].character = 'The Contrarian'
    const punishment = resolveContrarianBS(state, events)

    assert.equal(punishment.contrarianTriggered, false)
    assert.equal(punishment.punishedPlayerID, '1')
    assert.doesNotMatch(
      state.history.find((entry) => entry.kind === 'verdict')?.detail ?? '',
      /Contrarian/,
    )
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
    // A random play must be indistinguishable from a manual one in the log: the whole point of the
    // ability is that nobody can tell. The archive, which never reaches a client, still records it.
    assert.ok(!state.history.some((entry) => entry.title.includes('The Drunkard')))
    assert.equal(
      state.archive.turns
        .filter((archivedTurn) => archivedTurn.turnNumber === 1 && archivedTurn.playerID === '0')
        .flatMap((archivedTurn) => archivedTurn.actions)
        .find((action) => action.kind === 'play')?.playMode,
      'random',
    )

    // Nor may the wire answer it. Player 1 has played manually and player 0 randomly; to each other
    // the two seats must be indistinguishable, while each still sees the truth about their own.
    state.players['1'].hasUsedManualPlay = true
    const drunkardPlayerView = BlowCowGame.playerView as (
      args: { G: BlowCowState; playerID: string | null },
    ) => BlowCowState

    assert.equal(drunkardPlayerView({ G: state, playerID: '0' }).players['1'].hasUsedManualPlay, false)
    assert.equal(drunkardPlayerView({ G: state, playerID: '1' }).players['0'].hasUsedManualPlay, false)
    assert.equal(drunkardPlayerView({ G: state, playerID: '1' }).players['1'].hasUsedManualPlay, true)
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
    // The flip is public on the table, so it is left out of the log entirely. The archive keeps it.
    assert.ok(!state.history.some((entry) => entry.title.includes('The Cat')))
    assert.match(
      state.archive.turns
        .filter((archivedTurn) => archivedTurn.turnNumber === 4 && archivedTurn.playerID === '0')
        .flatMap((archivedTurn) => archivedTurn.actions)
        .find((action) => action.kind === 'hideTableCard')?.detail ?? '',
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

  {
    // The Cat's second half: the direction flip, on their own turn and in silence.
    const state = createScenarioState(3)
    const { events, record } = createEventRecorder()

    state.players['0'].character = 'The Cat'
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
    // A flip writes nothing to the log at all, so The Cat's flip leaves the same trace as a
    // cheat's: none. The telemetry line that does exist names nobody either.
    assert.equal(state.history.find((entry) => entry.title === 'The turn direction changed'), undefined)
    const toggleEvent = state.telemetry.events.find((entry) => entry.title === 'The turn direction changed')
    assert.ok(toggleEvent)
    assert.equal(toggleEvent.playerID, null)
    assert.match(toggleEvent.detail, /counterclockwise/i)
    assert.doesNotMatch(toggleEvent.detail, /cat/i)

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
    // Unlimited use, so flipping twice inside one turn is legal and simply puts the sign back.
    const state = createScenarioState(3)
    const { events } = createEventRecorder()

    state.players['0'].character = 'The Cat'
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
    // Nobody else may flip it, and The Contrarian least of all: the ability moved off that seat.
    const state = createScenarioState(3)
    const { events } = createEventRecorder()

    state.players['0'].character = 'The Contrarian'
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

  {
    /*
     * Taking the table costs The Privileged the next round's start, so the seat that won the BS call
     * against them actually keeps what it earned. The claim lapses for exactly one round.
     */
    const state = createScenarioState()
    const { events, record } = createEventRecorder()

    state.players['0'].hand = [card('clubs_ace.png')]
    state.players['1'].character = 'The Privileged'
    state.players['1'].hand = [card('spades_king.png')]
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
    completeBSReveal(state, events, 5)
    assert.ok(state.bsResolution)

    const finalizeBSResult = finalizeBSResolutionMove({
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

    assert.equal(finalizeBSResult, undefined)
    assert.equal(state.players['1'].matchStats.punishmentCount, 1)
    assert.equal(state.players['1'].wasPunishedLastRound, true)
    assert.equal(state.round.roundNumber, 2)
    assert.equal(state.round.startingPlayerID, '0')
    assert.equal(record.nextPlayerID, '0')

    // One round later, with nobody punished, the claim comes straight back.
    state.players['0'].hand = [card('clubs_ace.png')]
    state.players['1'].hand = [card('diamonds_king.png')]
    state.round.status = 'inProgress'
    state.round.trumpRank = 'K'
    state.round.passStreak = 1
    state.round.lastNonPassingPlayerID = '0'
    state.table.plays = [
      {
        id: 'play-2',
        playerID: '0',
        cards: [card('hearts_king.png')],
        claimedRank: 'K',
        playedAtRound: 2,
        playedAtTurn: 6,
        revealedAtTurn: 6,
        wasTrumpSelection: false,
      },
    ]

    const passResult = passMove({
      G: state,
      ctx: {
        currentPlayer: '1',
        turn: 7,
      },
      events,
      playerID: '1',
    })

    assert.equal(passResult, undefined)
    completeResetReveal(state, events, 7)
    assert.ok(state.resetResolution)

    const finalizeReturnResult = finalizeResetResolutionMove({
      G: state,
      ctx: {
        currentPlayer: '1',
        turn: 7,
      },
      events,
      playerID: '1',
    }, {
      resolutionID: state.resetResolution.id,
    })

    assert.equal(finalizeReturnResult, undefined)
    assert.equal(state.round.roundNumber, 3)
    assert.equal(state.players['1'].wasPunishedLastRound, false)
    assert.equal(state.round.startingPlayerID, '1')
    assert.equal(record.nextPlayerID, '1')
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
        contrarianTriggered: false,
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

    // Nothing is announced at all, or the accusation would be a formality. The arrow in the hub and
    // the nudge on the flipper's block are the whole of it, and neither leaves a record to read back.
    assert.equal(state.history.find((entry) => entry.title === 'The turn direction changed'), undefined)
    const toggleEvent = state.telemetry.events.find((entry) => entry.title === 'The turn direction changed')
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
    // The Cat's flip is still bound to their own turn, unlike The Dreamer's.
    const { state, events } = createDreamerDirectionScenario()
    state.players['1'].character = 'The Cat'

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
    // Refused on the mover's own turn, and refused for anyone who is not The Dreamer.
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

    assert.equal(state.table.plays.length, 2)
  }

  {
    /*
     * A sneak before the round has a trump rank. The card claims nothing at the time and inherits
     * whatever rank the round settles on, which is what makes the window the widest one the cheat
     * has: it opens before the round even has a shape.
     */
    const state = createScenarioState(3)
    const { events } = createEventRecorder()
    const sneakedCard = card('clubs_king.png')

    state.players['0'].hand = [card('clubs_queen.png'), card('diamonds_queen.png')]
    state.players['1'].character = 'The Dreamer'
    state.players['1'].hand = [sneakedCard]
    state.players['2'].hand = [card('spades_ace.png')]
    state.round.status = 'awaitingTrumpSelection'
    state.round.startingPlayerID = '0'

    assert.equal(state.round.trumpRank, null)
    assert.equal(sneakPlayMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 1,
      },
      events,
      playerID: '1',
    }, {
      cardIDs: [sneakedCard.id],
    }), undefined)

    // On the table with no claim, and no lie counted yet: there is nothing to have lied about.
    assert.equal(state.table.plays.length, 1)
    assert.equal(state.table.plays[0].claimedRank, null)
    assert.equal(state.players['1'].matchStats.playCount, 1)
    assert.equal(state.players['1'].matchStats.lieCount, 0)

    // The trump-selecting play settles it. A King against a Q trump was a lie all along.
    assert.equal(selectTrumpAndPlayMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 1,
      },
      events,
      playerID: '0',
    }, {
      trumpRank: 'Q',
      cardIDs: [state.players['0'].hand[0].id],
    }), undefined)

    assert.equal(state.round.trumpRank, 'Q')
    assert.equal(state.table.plays[0].claimedRank, 'Q')
    assert.equal(state.players['1'].matchStats.lieCount, 1)
    // The honest play that named the rank is untouched by the settle.
    assert.equal(state.table.plays[1].claimedRank, 'Q')
    assert.equal(state.players['0'].matchStats.lieCount, 0)
  }

  {
    // Manipulate names the rank without putting anything on the table, so it settles the sneak too.
    const state = createScenarioState(3)
    const { events } = createEventRecorder()
    const sneakedCard = card('clubs_queen.png')

    state.players['0'].character = 'The Invisible Hand'
    state.players['0'].hand = [card('clubs_ace.png')]
    state.players['1'].character = 'The Dreamer'
    state.players['1'].hand = [sneakedCard]
    state.players['2'].hand = [card('spades_ace.png')]
    state.round.status = 'awaitingTrumpSelection'
    state.round.startingPlayerID = '0'

    assert.equal(sneakPlayMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 1,
      },
      events,
      playerID: '1',
    }, {
      cardIDs: [sneakedCard.id],
    }), undefined)
    assert.equal(state.table.plays[0].claimedRank, null)

    assert.equal(manipulateMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 1,
      },
      events,
      playerID: '0',
    }, {
      targetPlayerID: '2',
      trumpRank: 'Q',
      direction: 'clockwise',
    }), undefined)

    // A real Queen against a Q trump, so the settle counts no lie.
    assert.equal(state.table.plays[0].claimedRank, 'Q')
    assert.equal(state.players['1'].matchStats.lieCount, 0)
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
 * Seat 1 is The Dreamer with a pile in front of them: one play fully face up, and one holding a card
 * each way. Seat 0 is on the clock, so a take-back by seat 1 happens on somebody else's turn unless a
 * case says otherwise.
 */
function createTakeBackScenario() {
  const state = createScenarioState(3)
  const { events, record } = createEventRecorder()

  const openCard = card('hearts_queen.png')
  const revealedCard = card('clubs_queen.png')
  const hiddenCard = card('diamonds_queen.png')

  state.players['0'].hand = [card('clubs_ace.png')]
  state.players['1'].character = 'The Dreamer'
  state.players['1'].hand = []
  state.players['2'].hand = [card('spades_king.png')]
  state.round.trumpRank = 'Q'
  state.round.direction = 'clockwise'
  state.round.lastNonPassingPlayerID = '2'
  state.table.plays = [
    // Fully open, so palming its one card empties the play.
    {
      id: 'play-open',
      playerID: '1',
      cards: [openCard],
      claimedRank: 'Q',
      playedAtRound: 1,
      playedAtTurn: 1,
      revealedAtTurn: 1,
      wasTrumpSelection: false,
    },
    // One card each way, so the same play answers both the face-up and the face-down case.
    {
      id: 'play-mixed',
      playerID: '1',
      cards: [revealedCard, hiddenCard],
      revealedCardIDs: [revealedCard.id],
      claimedRank: 'Q',
      playedAtRound: 1,
      playedAtTurn: 2,
      revealedAtTurn: null,
      wasTrumpSelection: false,
    },
    // Somebody else's face-up card, which is never a legal target.
    {
      id: 'play-other',
      playerID: '2',
      cards: [card('spades_queen.png')],
      claimedRank: 'Q',
      playedAtRound: 1,
      playedAtTurn: 2,
      revealedAtTurn: 2,
      wasTrumpSelection: false,
    },
  ]

  beginTurn({ G: state, ctx: { currentPlayer: '0', turn: 3 }, events })

  return { state, events, record, openCard, revealedCard, hiddenCard }
}

function runTakeBackCheatCheck() {
  {
    // The power itself: a revealed card leaves the table and rejoins the hand, in silence.
    const { state, events, record, openCard } = createTakeBackScenario()
    const tableStatusBefore = state.tableStatus

    assert.equal(
      takeBackCardMove(
        { G: state, ctx: { currentPlayer: '0', turn: 3 }, events, playerID: '1' },
        { cardID: openCard.id },
      ),
      undefined,
    )

    // The play held nothing else, so it goes with the card rather than staying as an empty shell.
    assert.equal(state.table.plays.some((play) => play.id === 'play-open'), false)
    assert.equal(getTableCardCount(state.table), 3)
    assertCardSet(state.players['1'].hand, ['hearts_queen.png'])
    assert.equal(state.takeBackTamper?.playerID, '1')
    assert.equal(state.takeBackTamper?.turnNumber, 3)

    // Nothing announces it, exactly as with a sneak play: no history, no telemetry, no table status
    // rewrite, and the turn stays where it was.
    assert.equal(state.history.length, 0)
    assert.equal(state.telemetry.events.some((entry) => entry.playerID === '1'), false)
    assert.equal(state.tableStatus, tableStatusBefore)
    assert.equal(record.nextPlayerID, null)

    // The archive is stripped by `hideSecretState`, so it is the one place that may name the card.
    const archivedTurn = state.archive.turns.find((entry) => entry.turnNumber === 3 && entry.playerID === '1')
    assert.ok(archivedTurn)
    assert.equal(archivedTurn.actions[0].kind, 'takeBackCard')
    assert.equal(archivedTurn.actions[0].characterUsed, 'The Dreamer')
    assert.match(archivedTurn.actions[0].detail, /Q of Hearts/)

    /*
     * The one asymmetry in `hideSecretState`: stripped from every other seat, kept for the player it
     * names. An opponent holding it would be checking the answer rather than gambling an accusation;
     * its owner cannot use it that way and needs it to serve their own lock.
     */
    const ownerView = BlowCowGame.playerView({ G: state, playerID: '1' }) as BlowCowState
    const opponentView = BlowCowGame.playerView({ G: state, playerID: '0' }) as BlowCowState
    const spectatorView = BlowCowGame.playerView({ G: state, playerID: null }) as BlowCowState
    assert.equal(ownerView.takeBackTamper?.playerID, '1')
    assert.equal(opponentView.takeBackTamper, null)
    assert.equal(spectatorView.takeBackTamper, null)
  }

  {
    // Unlimited, and each one re-arms the lock the client serves, so the record has to change.
    const { state, events, openCard, revealedCard } = createTakeBackScenario()
    const context = { G: state, ctx: { currentPlayer: '0', turn: 3 }, events, playerID: '1' }

    assert.equal(takeBackCardMove(context, { cardID: openCard.id }), undefined)
    const firstTamperID = state.takeBackTamper?.id
    assert.equal(takeBackCardMove(context, { cardID: revealedCard.id }), undefined)

    assert.notEqual(state.takeBackTamper?.id, firstTamperID)
    assertCardSet(state.players['1'].hand, ['hearts_queen.png', 'clubs_queen.png'])
    // The mixed play keeps its face-down card, so it stays on the table and stays challengeable.
    const mixedPlay = state.table.plays.find((play) => play.id === 'play-mixed')
    assert.equal(mixedPlay?.cards.length, 1)
    assert.deepEqual(mixedPlay?.revealedCardIDs, [])
  }

  {
    /*
     * Refusals. A face-down card is still a live claim, so palming one would let a player answer a
     * BS call by deleting the evidence; somebody else's card would move a pile whose owner's hand
     * count does not move with it; and an unlicensed seat has no business doing either.
     */
    const { state, events, openCard, hiddenCard } = createTakeBackScenario()
    const dreamerContext = { G: state, ctx: { currentPlayer: '0', turn: 3 }, events, playerID: '1' }

    assert.equal(takeBackCardMove(dreamerContext, { cardID: hiddenCard.id }), 'INVALID_MOVE')
    assert.equal(
      takeBackCardMove(dreamerContext, { cardID: state.table.plays[2].cards[0].id }),
      'INVALID_MOVE',
    )
    assert.equal(takeBackCardMove(dreamerContext, { cardID: 'not-a-card' }), 'INVALID_MOVE')
    assert.equal(
      takeBackCardMove({ ...dreamerContext, playerID: '0' }, { cardID: openCard.id }),
      'INVALID_MOVE',
    )
    assert.equal(state.players['1'].hand.length, 0)
    assert.equal(getTableCardCount(state.table), 4)
    assert.equal(state.takeBackTamper ?? null, null)

    // And refused while a procedure owns the table, like every other move.
    state.resetResolution = {
      id: 'reset-1',
      callerPlayerID: '0',
      kind: 'reset',
      revealOrder: [],
      revealStepIndex: 0,
    }
    assert.equal(takeBackCardMove(dreamerContext, { cardID: openCard.id }), 'INVALID_MOVE')
  }

  {
    // Legal on the cheat's own turn too, which is the case the client's two-second lock exists for.
    const { state, events, openCard } = createTakeBackScenario()
    // A card in hand, or the Leave Game Rule takes the seat out before their turn can start.
    state.players['1'].hand = [card('clubs_02.png')]
    beginTurn({ G: state, ctx: { currentPlayer: '1', turn: 4 }, events })

    assert.equal(
      takeBackCardMove(
        { G: state, ctx: { currentPlayer: '1', turn: 4 }, events, playerID: '1' },
        { cardID: openCard.id },
      ),
      undefined,
    )
    assert.equal(state.takeBackTamper?.turnNumber, 4)
  }

  {
    // Caught inside the turn it happened in, and the verdict says what was done.
    const { state, events, openCard } = createTakeBackScenario()

    assert.equal(
      takeBackCardMove(
        { G: state, ctx: { currentPlayer: '0', turn: 3 }, events, playerID: '1' },
        { cardID: openCard.id },
      ),
      undefined,
    )
    assert.equal(
      accuseDreamerMove(
        { G: state, ctx: { currentPlayer: '0', turn: 3 }, events, playerID: '2' },
        { targetPlayerID: '1' },
      ),
      undefined,
    )

    assert.equal(state.accusation?.wasSuccessful, true)
    assert.equal(state.accusation?.caughtCheat, 'takeBackCard')

    completeAccusationPunishment(state, events, 3)
    assert.equal(state.players['1'].matchStats.punishmentCount, 1)
    assert.match(
      state.history.find((entry) => entry.kind === 'verdict')?.detail ?? '',
      /took a revealed card back off the table/i,
    )
  }

  {
    // And uncatchable once that turn ends: the record dies with the window, like a direction tamper.
    const { state, events, openCard } = createTakeBackScenario()

    assert.equal(
      takeBackCardMove(
        { G: state, ctx: { currentPlayer: '0', turn: 3 }, events, playerID: '1' },
        { cardID: openCard.id },
      ),
      undefined,
    )
    beginTurn({ G: state, ctx: { currentPlayer: '1', turn: 4 }, events })
    assert.equal(state.takeBackTamper ?? null, null)

    assert.equal(
      accuseDreamerMove(
        { G: state, ctx: { currentPlayer: '1', turn: 4 }, events, playerID: '2' },
        { targetPlayerID: '1' },
      ),
      undefined,
    )
    assert.equal(state.accusation?.wasSuccessful, false)
  }

  {
    // Removing the No Cheating Rule hands the cheat to an ordinary seat, like the other five.
    const { state, events, openCard } = createTakeBackScenario()
    state.players['1'].character = 'The Believer'
    assert.equal(
      takeBackCardMove(
        { G: state, ctx: { currentPlayer: '0', turn: 3 }, events, playerID: '1' },
        { cardID: openCard.id },
      ),
      'INVALID_MOVE',
    )

    state.rules.noCheating = 'removed'
    assert.equal(
      takeBackCardMove(
        { G: state, ctx: { currentPlayer: '0', turn: 3 }, events, playerID: '1' },
        { cardID: openCard.id },
      ),
      undefined,
    )
    // Nobody's character in particular any more, so the archive credits none.
    const archivedTurn = state.archive.turns.find((entry) => entry.turnNumber === 3 && entry.playerID === '1')
    assert.equal(archivedTurn?.actions[0].characterUsed, null)
  }
}

/**
 * The No Cheating Rule. While it stands, cheating is The Dreamer's alone and only The Dreamer may be
 * accused; removed, all six cheats belong to everybody and every seat is worth naming. Each case
 * below is run by a player holding an ordinary character, so nothing here can pass by accident.
 */
function runNoCheatingRuleCheck() {
  {
    // Flipping the direction on somebody else's turn, by a player who is not The Cat.
    const { state, events } = createDreamerDirectionScenario()
    state.players['1'].character = 'The Believer'

    const context: TestContext = {
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 3,
      },
      events,
      playerID: '1',
    }

    // Refused while the rule stands: no licence, and no Cat ability either.
    assert.notEqual(toggleDirectionMove(context), undefined)
    assert.equal(state.round.direction, 'clockwise')
    assert.equal(state.directionTamper, null)

    state.rules.noCheating = 'removed'

    assert.equal(toggleDirectionMove(context), undefined)
    assert.equal(state.round.direction, 'counterclockwise')
    assert.deepEqual(state.directionTamper, { playerID: '1', turnNumber: 3 })

    // Still unannounced. Removing the rule widens who may cheat, never who gets told.
    assert.equal(state.history.find((entry) => entry.title === 'The turn direction changed'), undefined)
    assert.equal(BlowCowGame.playerView({ G: state, playerID: '2' }).directionTamper, null)

    assert.equal(accuseDreamerMove({ ...context, playerID: '2' }, { targetPlayerID: '1' }), undefined)
    assert.equal(state.accusation?.wasSuccessful, true)
    assert.equal(state.accusation?.caughtCheat, 'directionChange')
  }

  {
    // The Cat's own-turn flip stays legal. Separate scenarios, because flipping twice inside
    // one turn puts the direction back where the turn started and erases the tamper by design.
    const { state, events } = createDreamerDirectionScenario()
    state.players['1'].character = 'The Cat'
    state.rules.noCheating = 'removed'

    assert.equal(toggleDirectionMove({
      G: state,
      ctx: {
        currentPlayer: '1',
        turn: 3,
      },
      events,
      playerID: '1',
    }), undefined)
    assert.equal(state.directionTamper, null)
  }

  {
    // ...and their off-turn flip becomes a tamper like anyone else's. The character never stops being
    // a character; it just stops being the only exception.
    const { state, events } = createDreamerDirectionScenario()
    state.players['1'].character = 'The Cat'
    state.rules.noCheating = 'removed'

    assert.equal(toggleDirectionMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 3,
      },
      events,
      playerID: '1',
    }), undefined)
    assert.deepEqual(state.directionTamper, { playerID: '1', turnNumber: 3 })
  }

  {
    // Slipping a card onto the table during somebody else's turn.
    const { state, events } = createDreamerDirectionScenario()
    state.players['1'].character = 'The Believer'

    const context: TestContext = {
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 3,
      },
      events,
      playerID: '1',
    }
    const sneakedCardID = state.players['1'].hand[0].id

    assert.notEqual(sneakPlayMove(context, { cardIDs: [sneakedCardID] }), undefined)
    assert.equal(state.table.plays.length, 2)

    state.rules.noCheating = 'removed'

    assert.equal(sneakPlayMove(context, { cardIDs: [sneakedCardID] }), undefined)
    assert.equal(state.table.plays.length, 3)
    assert.equal(state.players['1'].hand.length, 0)

    assert.equal(accuseDreamerMove({ ...context, playerID: '2' }, { targetPlayerID: '1' }), undefined)
    assert.equal(state.accusation?.caughtCheat, 'sneakPlay')
  }

  {
    // More cards than declared, by an ordinary player. The play still announces 2.
    const state = createScenarioState()
    const { events } = createEventRecorder()
    const extraCards = [card('clubs_queen.png'), card('diamonds_queen.png'), card('hearts_queen.png')]

    state.rules.noCheating = 'removed'
    state.players['0'].hand = [card('clubs_ace.png')]
    state.players['1'].hand = [...extraCards]
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
      cardIDs: extraCards.map((entry) => entry.id),
    }), undefined)

    assert.equal(state.table.plays[0]?.cards.length, 3)
    assert.equal(state.table.plays[0]?.declaredCardCount, 2)
    assert.equal(state.history[0]?.title, 'Seat 2 played 2 card(s)')
    // No character to credit any more, so the archive names none.
    assert.equal(
      state.archive.turns.find((turn) => turn.turnNumber === 1 && turn.playerID === '1')
        ?.actions.find((action) => action.kind === 'play')?.characterUsed,
      null,
    )

    assert.equal(accuseDreamerMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 2,
      },
      events,
      playerID: '0',
    }, {
      targetPlayerID: '1',
    }), undefined)
    assert.equal(state.accusation?.caughtCheat, 'extraCardCount')
  }

  {
    // Reusing the previous round's trump on the opening play.
    const state = createScenarioState()
    const { events } = createEventRecorder()
    const repeatedTrumpCard = card('clubs_queen.png')

    state.rules.noCheating = 'removed'
    state.players['0'].hand = [card('clubs_ace.png')]
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
    assert.equal(state.round.trumpRank, 'Q')

    assert.equal(accuseDreamerMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 2,
      },
      events,
      playerID: '0',
    }, {
      targetPlayerID: '1',
    }), undefined)
    assert.equal(state.accusation?.caughtCheat, 'repeatTrump')
  }

  {
    // Pushing the table past MaxCardsOnTable.
    const state = createScenarioState()
    const { events } = createEventRecorder()
    const playedCards = [card('clubs_queen.png'), card('diamonds_queen.png')]
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

    state.rules.noCheating = 'removed'
    state.players['0'].hand = [card('clubs_ace.png')]
    state.players['1'].hand = [...playedCards]
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

    assert.equal(playMove({
      G: state,
      ctx: {
        currentPlayer: '1',
        turn: 10,
      },
      events,
      playerID: '1',
    }, {
      cardIDs: playedCards.map((entry) => entry.id),
    }), undefined)
    assert.equal(state.table.plays.flatMap((play) => play.cards).length, 11)

    assert.equal(accuseDreamerMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 11,
      },
      events,
      playerID: '0',
    }, {
      targetPlayerID: '1',
    }), undefined)
    assert.equal(state.accusation?.caughtCheat, 'exceededTableLimit')
  }

  {
    // Who may be named. While the rule stands an ordinary seat is refused outright rather than
    // resolved as a miss, so a wasted accusation costs nothing; removed, the same call is a real
    // gamble that misses. Either way the budget stays at one per player per round.
    const { state, events } = createDreamerDirectionScenario()
    state.players['1'].character = 'The Believer'

    const context: TestContext = {
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 3,
      },
      events,
      playerID: '2',
    }

    assert.equal(accuseDreamerMove(context, { targetPlayerID: '1' }), 'INVALID_MOVE')
    assert.equal(state.accusation ?? null, null)
    assert.equal(state.players['2'].hasUsedAccusationThisRound, false)

    state.rules.noCheating = 'removed'

    assert.equal(accuseDreamerMove(context, { targetPlayerID: '1' }), undefined)
    assert.equal(state.accusation?.wasSuccessful, false)
    assert.equal(state.players['2'].hasUsedAccusationThisRound, true)

    state.accusation = null
    assert.equal(accuseDreamerMove(context, { targetPlayerID: '0' }), 'INVALID_MOVE')
    assert.equal(state.accusation, null)
  }

  {
    // The Dreamer is unaffected by the removal: their licence was never conditional on the rule.
    const { state, events } = createDreamerDirectionScenario()
    state.rules.noCheating = 'removed'

    assert.equal(toggleDirectionMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 3,
      },
      events,
      playerID: '1',
    }), undefined)
    assert.deepEqual(state.directionTamper, { playerID: '1', turnNumber: 3 })
  }
}

function runEmoteCheck() {
  const state = createScenarioState(2)
  const { events } = createEventRecorder()

  /*
   * Server-only, because the id is cut from a table-wide counter: a client predicting it would draw
   * a different id whenever somebody else emoted first, and the board would animate the same emote
   * twice.
   */
  assert.equal(BlowCowGame.moves.emote.client, false)

  const result = emoteMove({
    G: state,
    // An emote is intentionally legal off-turn and during any ordinary player turn.
    ctx: { currentPlayer: '1', turn: 4 },
    events,
    playerID: '0',
  }, { emoteID: 12 })

  assert.equal(result, undefined)
  assert.equal(state.emoteSequence, 1)
  assert.deepEqual(state.emotes, [{
    id: 'emote-1-0',
    playerID: '0',
    emoteID: 12,
  }])
  assert.deepEqual((BlowCowGame.playerView({ G: state, playerID: '1' }) as BlowCowState).emotes, state.emotes)

  assert.equal(emoteMove({
    G: state,
    ctx: { currentPlayer: '1', turn: 4 },
    events,
    playerID: '0',
  }, { emoteID: 0 }), 'INVALID_MOVE')

  state.players['0'].hasLeft = true
  assert.equal(emoteMove({
    G: state,
    ctx: { currentPlayer: '1', turn: 4 },
    events,
    playerID: '0',
  }, { emoteID: 1 }), 'INVALID_MOVE')
}

/**
 * The direction-flip tell. `G.directionFlip` is the one public record of who touched the sign, and it
 * is published for every flip — the legal ones included, or an unpublished flip could only ever be
 * The Cat's.
 */
function runDirectionFlipTellCheck() {
  {
    // A cheat's flip publishes the tell, and unlike the tamper it survives playerView.
    const { state, events } = createDreamerDirectionScenario()

    assert.equal(state.directionFlip ?? null, null)
    assert.equal(toggleDirectionMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 3,
      },
      events,
      playerID: '1',
    }), undefined)

    assert.equal(state.directionFlip?.playerID, '1')
    assert.equal(BlowCowGame.playerView({ G: state, playerID: '2' }).directionFlip?.playerID, '1')
    // ...while the verdict on that same flip still does not.
    assert.equal(BlowCowGame.playerView({ G: state, playerID: '2' }).directionTamper, null)
  }

  {
    // The Cat's legal flip publishes exactly the same way, and a second flip carries a new id
    // so a client can tell it apart from the one it has already played.
    const { state, events } = createDreamerDirectionScenario()
    state.players['0'].character = 'The Cat'

    const context: TestContext = {
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 3,
      },
      events,
      playerID: '0',
    }

    assert.equal(toggleDirectionMove(context), undefined)
    const firstFlipID = state.directionFlip?.id
    assert.ok(firstFlipID)
    assert.equal(state.directionFlip?.playerID, '0')
    assert.equal(state.directionTamper, null)

    assert.equal(toggleDirectionMove(context), undefined)
    assert.equal(state.directionFlip?.playerID, '0')
    assert.notEqual(state.directionFlip?.id, firstFlipID)
  }

  {
    // The tell belongs to the turn it happened in, exactly as the tamper does.
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
    assert.ok(state.directionFlip)

    beginTurn({
      G: state,
      ctx: {
        currentPlayer: '2',
        turn: 4,
      },
      events,
    })

    assert.equal(state.directionFlip, null)
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
      /broke no rule/i,
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

function runSeekerRulesCheck() {
  // Not turn-bound: '1' takes a card while '0' is on the clock, and the turn is untouched by it.
  {
    const state = createScenarioState(3)

    state.players['1'].character = 'The Seeker'
    state.players['2'].character = 'The Spy'

    assert.ok(isSeeker(state, '1'))

    const choices = getSeekerCharacterChoices(state, '1')
    assert.ok(!choices.includes('The Seeker' as never), 'The Seeker cannot be taken again.')
    assert.ok(!choices.includes('The Spy'), 'A character another seat holds is not on offer.')
    assert.ok(!choices.includes('The Believer'), 'The Believer is held by the other two seats.')
    assert.ok(choices.includes('The Cat'))

    const seekResult = seekCharacterMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 4,
      },
      events: createEventRecorder().events,
      playerID: '1',
    }, {
      characterName: 'The Cat',
    })

    assert.equal(seekResult, undefined)
    assert.equal(state.players['1'].character, 'The Cat')
    assert.equal(state.players['1'].seekerPickedCharacter, 'The Cat')
    assert.equal(isSeeker(state, '1'), false)
    assert.match(
      state.history.find((entry) => entry.title.includes('used The Seeker'))?.detail ?? '',
      /Took The Cat from the character pool/i,
    )
    assert.ok(state.archive.turns
      .flatMap((turn) => turn.actions)
      .some((action) => action.kind === 'seekCharacter' && action.characterUsed === 'The Seeker'))

    // Spent, so a second call finds nothing to spend.
    assert.notEqual(seekCharacterMove({
      G: state,
      ctx: {
        currentPlayer: '1',
        turn: 5,
      },
      events: createEventRecorder().events,
      playerID: '1',
    }, {
      characterName: 'The Rogue' as never,
    }), undefined)
  }

  // A character somebody else already holds, and a name nobody is offering, are both refused.
  {
    const state = createScenarioState(3)

    state.players['0'].character = 'The Seeker'
    state.players['1'].character = 'The Pawn'

    const takenResult = seekCharacterMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 3,
      },
      events: createEventRecorder().events,
      playerID: '0',
    }, {
      characterName: 'The Pawn',
    })

    assert.notEqual(takenResult, undefined)
    assert.equal(state.players['0'].character, 'The Seeker')

    assert.notEqual(seekCharacterMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 3,
      },
      events: createEventRecorder().events,
      playerID: '0',
    }, {
      characterName: 'Not A Character' as never,
    }), undefined)

    // Only the seat holding the card may spend it.
    assert.notEqual(seekCharacterMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 3,
      },
      events: createEventRecorder().events,
      playerID: '2',
    }, {
      characterName: 'The Cat',
    }), undefined)
    assert.equal(state.players['2'].character, 'The Believer')
  }

  // Scoped to the room's pool, so a card the host left out of the match cannot be sought out.
  {
    const state = createInitialBlowCowState(3, reverseShuffle, {
      useCharacters: true,
      characterPool: ['The Seeker', 'The Cat', 'The Spy'],
    })
    const seekerPlayerID = state.seatOrder.find((playerID) => isSeeker(state, playerID))

    assert.ok(seekerPlayerID, 'Expected a Seeker to be dealt from a three-card pool of three players.')

    const choices = getSeekerCharacterChoices(state, seekerPlayerID)
    assert.ok(!choices.includes('The Dreamer'), 'A character outside the room pool is not on offer.')
    assert.ok(choices.every((characterName) => characterName === 'The Cat' || characterName === 'The Spy'))
  }

  // Refused while a resolution is running, like every other move.
  {
    const state = createScenarioState(3)

    state.players['0'].character = 'The Seeker'
    state.resetResolution = {
      id: 'reset-1',
      callerPlayerID: '1',
      kind: 'reset',
      revealOrder: [],
      revealStepIndex: 0,
    }

    assert.notEqual(seekCharacterMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 3,
      },
      events: createEventRecorder().events,
      playerID: '0',
    }, {
      characterName: 'The Cat',
    }), undefined)
    assert.equal(state.players['0'].character, 'The Seeker')
  }
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

function runRuleCardsCheck() {
  // Every ID has exactly one definition, and no definition exists for an ID that was never declared.
  assert.equal(BLOW_COW_RULE_DEFINITIONS.length, BLOW_COW_RULE_IDS.length)
  assert.deepEqual(BLOW_COW_RULE_DEFINITIONS.map((definition) => definition.id), [...BLOW_COW_RULE_IDS])

  /*
   * Removability and upgradability are derived from the copy, so a rule offering a variant it has no
   * description for would silently show the active text under a changed title.
   */
  for (const definition of BLOW_COW_RULE_DEFINITIONS) {
    assert.equal(canRuleTakeStatus(definition.id, 'active'), true)
    assert.equal(canRuleTakeStatus(definition.id, 'removed'), definition.removedDescription !== undefined)
    assert.equal(canRuleTakeStatus(definition.id, 'upgraded'), definition.upgradedDescription !== undefined)

    for (const status of getRuleStatusOptions(definition.id)) {
      assert.notEqual(getRuleDescription(definition, status), '')
    }
  }

  // The four rules the design fixes in place must never offer a Removed option.
  for (const ruleID of ['maxCardsPerPlay', 'leaveGame', 'finalRanking', 'callReset'] as const) {
    assert.equal(canRuleTakeStatus(ruleID, 'removed'), false)
    assert.deepEqual(getRuleStatusOptions(ruleID), ['active', 'upgraded'])
  }

  const defaultRules = createDefaultRulesState()
  assert.equal(isDefaultRulesSelection(defaultRules), true)
  assert.equal(Object.keys(defaultRules).length, BLOW_COW_RULE_IDS.length)
  assert.ok(BLOW_COW_RULE_IDS.every((ruleID) => defaultRules[ruleID] === 'active'))

  // Only upgraded rules carry the plus, so a removed card never reads as an improvement.
  const reverseDefinition = BLOW_COW_RULE_DEFINITIONS[0]
  assert.equal(formatRuleTitle(reverseDefinition, 'active'), 'Reverse Rule')
  assert.equal(formatRuleTitle(reverseDefinition, 'removed'), 'Reverse Rule')
  assert.equal(
    formatRuleTitle(BLOW_COW_RULE_DEFINITIONS.find((definition) => definition.id === 'passEnding')!, 'upgraded'),
    'Pass Ending Rule+',
  )

  // The sanitiser is the only thing standing between a hand-built selection and `G`.
  const normalized = normalizeRulesSelection({
    joker: 'removed',
    maxCardsPerPlay: 'removed',
    passEnding: 'upgraded',
    notARule: 'removed',
    reveal: 'sideways',
  })
  assert.equal(normalized.joker, 'removed')
  assert.equal(normalized.maxCardsPerPlay, 'active')
  assert.equal(normalized.passEnding, 'upgraded')
  assert.equal(normalized.reveal, 'active')
  assert.equal(Object.keys(normalized).length, BLOW_COW_RULE_IDS.length)
  assert.ok(!('notARule' in normalized))
  assert.deepEqual(normalizeRulesSelection(undefined), defaultRules)
  assert.deepEqual(normalizeRulesSelection([]), defaultRules)

  assert.equal(
    BlowCowGame.validateSetupData?.({ rules: { joker: 'removed', callReset: 'upgraded' } }),
    undefined,
  )
  assert.equal(
    BlowCowGame.validateSetupData?.({ rules: { notARule: 'removed' } } as unknown as BlowCowSetupData),
    'Rule selection contains an unknown rule.',
  )
  assert.equal(
    BlowCowGame.validateSetupData?.({ rules: { joker: 'sideways' } } as unknown as BlowCowSetupData),
    'Rule selection contains an unknown rule status.',
  )
  assert.equal(
    BlowCowGame.validateSetupData?.({ rules: { leaveGame: 'removed' } }),
    'leaveGame does not support the removed status.',
  )
  assert.equal(
    BlowCowGame.validateSetupData?.({ rules: [] } as unknown as BlowCowSetupData),
    'Choose a valid rule selection.',
  )

  // A default match leaves every card active, and a configured one survives the deal untouched.
  assert.deepEqual(createInitialBlowCowState(2, undefined, { rankSelectionMode: 'default' }).rules, defaultRules)

  const configuredState = createInitialBlowCowState(2, undefined, {
    rankSelectionMode: 'default',
    rules: { reverse: 'removed', maxCardsOnTable: 'upgraded' },
  })
  assert.equal(configuredState.rules.reverse, 'removed')
  assert.equal(configuredState.rules.maxCardsOnTable, 'upgraded')
  assert.equal(configuredState.rules.pass, 'active')
  assert.equal(configuredState.archive.initial?.rules.reverse, 'removed')

  /*
   * Rule cards are reference material every seat reads, so unlike hands and the archive they have to
   * survive `playerView` intact.
   */
  const rulesPlayerView = BlowCowGame.playerView as (
    args: { G: BlowCowState; playerID: string | null },
  ) => BlowCowState
  assert.deepEqual(rulesPlayerView({ G: configuredState, playerID: '1' }).rules, configuredState.rules)

  /*
   * Upgrades are still display-only, so an upgraded cap leaves the real capacity alone. Removals are
   * enforced, and `runRemovedRuleEnforcementCheck` below covers each one.
   */
  const cappedState = createInitialBlowCowState(2, undefined, {
    rankSelectionMode: 'default',
    rules: { maxCardsOnTable: 'upgraded', pass: 'removed' },
  })
  assert.equal(cappedState.round.maxCardsOnTable, 10)

  const unchangedRules: BlowCowRulesState = { ...cappedState.rules }
  assert.equal(isDefaultRulesSelection(unchangedRules), false)
}

/** Every removable rule, removed, checked at the site that used to enforce it. */
function runRemovedRuleEnforcementCheck() {
  // Pass Rule: the action is gone outright.
  const passRemovedState = createScenarioState()
  passRemovedState.rules.pass = 'removed'
  passRemovedState.players['0'].hand = [card('clubs_ace.png')]
  passRemovedState.players['1'].hand = [card('spades_king.png')]
  passRemovedState.round.trumpRank = 'J'

  const passRemovedRecorder = createEventRecorder()
  assert.equal(
    passMove({
      G: passRemovedState,
      ctx: { currentPlayer: '0', turn: 4 },
      events: passRemovedRecorder.events,
      playerID: '0',
    }),
    'INVALID_MOVE',
  )
  assert.equal(passRemovedState.round.passStreak, 0)
  assert.equal(passRemovedState.players['0'].matchStats.passCount, 0)

  /*
   * Pass Ending Rule: passing still works and still counts, but a full circle of passes no longer
   * ends the round. The same scenario with the rule active is `runAllPassResetCheck`.
   */
  const passEndingState = createScenarioState()
  passEndingState.rules.passEnding = 'removed'
  passEndingState.players['0'].hand = [card('clubs_ace.png')]
  passEndingState.players['1'].hand = [card('spades_king.png')]
  passEndingState.round.trumpRank = 'J'
  passEndingState.round.passStreak = 1
  passEndingState.round.lastNonPassingPlayerID = '1'

  const passEndingRecorder = createEventRecorder()
  assert.equal(
    passMove({
      G: passEndingState,
      ctx: { currentPlayer: '0', turn: 4 },
      events: passEndingRecorder.events,
      playerID: '0',
    }),
    undefined,
  )
  assert.equal(passEndingState.resetResolution, null)
  assert.equal(passEndingState.round.passStreak, 2)
  assert.equal(passEndingState.round.roundNumber, 1)
  assert.equal(passEndingRecorder.record.nextPlayerID, '1')

  // Rank Change Rule: the previous round's trump becomes selectable again.
  const rankChangeState = createScenarioState()
  rankChangeState.rules.rankChange = 'removed'
  rankChangeState.round.status = 'awaitingTrumpSelection'
  rankChangeState.round.trumpRank = null
  rankChangeState.round.previousTrumpRank = 'Q'
  rankChangeState.players['0'].hand = [card('hearts_queen.png')]
  rankChangeState.players['1'].hand = [card('spades_king.png')]

  const rankChangeRecorder = createEventRecorder()
  assert.equal(
    selectTrumpAndPlayMove({
      G: rankChangeState,
      ctx: { currentPlayer: '0', turn: 2 },
      events: rankChangeRecorder.events,
      playerID: '0',
    }, {
      trumpRank: 'Q',
      cardIDs: [rankChangeState.players['0'].hand[0].id],
    }),
    undefined,
  )
  assert.equal(rankChangeState.round.trumpRank, 'Q')
  // Repeating the rank is legal now, so it is not a lie either.
  assert.equal(rankChangeState.players['0'].matchStats.lieCount, 0)

  // Max Cards On Table Rule: a play may push the table past the cap, which still gates Call Reset.
  const tableLimitState = createScenarioState()
  tableLimitState.rules.maxCardsOnTable = 'removed'
  tableLimitState.round.trumpRank = 'Q'
  tableLimitState.round.maxCardsOnTable = 2
  tableLimitState.players['0'].hand = [card('hearts_queen.png'), card('clubs_queen.png')]
  tableLimitState.players['1'].hand = [card('spades_king.png')]
  tableLimitState.table.plays = [
    {
      id: 'play-0',
      playerID: '1',
      cards: [card('diamonds_09.png'), card('clubs_03.png')],
      claimedRank: 'Q',
      playedAtRound: 1,
      playedAtTurn: 1,
      revealedAtTurn: 1,
      wasTrumpSelection: false,
    },
  ]

  const tableLimitRecorder = createEventRecorder()
  assert.equal(
    playMove({
      G: tableLimitState,
      ctx: { currentPlayer: '0', turn: 2 },
      events: tableLimitRecorder.events,
      playerID: '0',
    }, {
      cardIDs: tableLimitState.players['0'].hand.map((handCard) => handCard.id),
    }),
    undefined,
  )
  assert.equal(getTableCardCount(tableLimitState.table), 4)
  assert.equal(tableLimitState.round.maxCardsOnTable, 2)

  // Joker Rule: a Joker has no rank, so claiming it as trump is a lie.
  const jokerState = createScenarioState()
  jokerState.rules.joker = 'removed'
  jokerState.round.trumpRank = 'Q'
  jokerState.players['0'].hand = [card('Joker1.png')]
  jokerState.players['1'].hand = [card('spades_king.png')]

  const jokerRecorder = createEventRecorder()
  assert.equal(
    playMove({
      G: jokerState,
      ctx: { currentPlayer: '0', turn: 2 },
      events: jokerRecorder.events,
      playerID: '0',
    }, {
      cardIDs: [jokerState.players['0'].hand[0].id],
    }),
    undefined,
  )
  assert.equal(jokerState.players['0'].matchStats.lieCount, 1)

  // The same Joker with the rule in play is wild, and so honest.
  const wildJokerState = createScenarioState()
  wildJokerState.round.trumpRank = 'Q'
  wildJokerState.players['0'].hand = [card('Joker1.png')]
  wildJokerState.players['1'].hand = [card('spades_king.png')]

  const wildJokerRecorder = createEventRecorder()
  playMove({
    G: wildJokerState,
    ctx: { currentPlayer: '0', turn: 2 },
    events: wildJokerRecorder.events,
    playerID: '0',
  }, {
    cardIDs: [wildJokerState.players['0'].hand[0].id],
  })
  assert.equal(wildJokerState.players['0'].matchStats.lieCount, 0)

  // Reveal Rule: the previous play stays face down and the pending pointer is simply dropped.
  const revealState = createScenarioState()
  revealState.rules.reveal = 'removed'
  revealState.round.trumpRank = 'Q'
  revealState.players['0'].hand = [card('clubs_ace.png')]
  revealState.players['1'].hand = [card('spades_king.png')]
  revealState.table.plays = [
    {
      id: 'play-0',
      playerID: '0',
      cards: [card('hearts_queen.png')],
      claimedRank: 'Q',
      playedAtRound: 1,
      playedAtTurn: 1,
      revealedAtTurn: null,
      wasTrumpSelection: false,
    },
  ]
  revealState.players['0'].pendingRevealPlayID = 'play-0'

  const revealRecorder = createEventRecorder()
  beginTurn({
    G: revealState,
    ctx: { currentPlayer: '0', turn: 3 },
    events: revealRecorder.events,
  })

  assert.equal(revealState.table.plays[0].revealedAtTurn, null)
  assert.equal(revealState.players['0'].pendingRevealPlayID, null)
  assert.equal(isCardFaceUpOnTable(revealState.table.plays[0], revealState.table.plays[0].cards[0].id), false)
  assert.equal(revealState.history.length, 0)

  /*
   * Reverse Rule: four trump cards are on the table and the accused was honest, so the caller is
   * punished either way — with the rule active the punishment flips to the accused instead.
   */
  const buildReverseScenario = (isReverseRemoved: boolean) => {
    const state = createScenarioState()
    if (isReverseRemoved) {
      state.rules.reverse = 'removed'
    }
    state.round.trumpRank = 'Q'
    state.round.lastNonPassingPlayerID = '1'
    state.players['0'].hand = [card('clubs_ace.png')]
    state.players['1'].hand = [card('spades_king.png')]
    state.table.plays = [
      {
        id: 'play-0',
        playerID: '0',
        cards: [card('clubs_queen.png'), card('diamonds_queen.png')],
        claimedRank: 'Q',
        playedAtRound: 1,
        playedAtTurn: 2,
        revealedAtTurn: 2,
        wasTrumpSelection: false,
      },
      {
        id: 'play-1',
        playerID: '1',
        cards: [card('hearts_queen.png'), card('spades_queen.png')],
        claimedRank: 'Q',
        playedAtRound: 1,
        playedAtTurn: 3,
        revealedAtTurn: null,
        wasTrumpSelection: false,
      },
    ]
    state.players['1'].pendingRevealPlayID = 'play-1'

    const recorder = createEventRecorder()
    callBSMove({
      G: state,
      ctx: { currentPlayer: '0', turn: 4 },
      events: recorder.events,
      playerID: '0',
    })

    return state
  }

  const reverseActiveResolution = buildReverseScenario(false).bsResolution
  assert.ok(reverseActiveResolution)
  assert.equal(reverseActiveResolution.targetVerdict?.targetWasHonest, true)
  assert.equal(reverseActiveResolution.punishment?.reverseRuleTriggered, true)
  assert.equal(reverseActiveResolution.punishment?.punishedPlayerID, '1')

  const reverseRemovedResolution = buildReverseScenario(true).bsResolution
  assert.ok(reverseRemovedResolution)
  assert.equal(reverseRemovedResolution.targetVerdict?.targetWasHonest, true)
  assert.equal(reverseRemovedResolution.punishment?.reverseRuleTriggered, false)
  // The honest accused is spared and the caller takes the table, as the default verdict says.
  assert.equal(reverseRemovedResolution.punishment?.punishedPlayerID, '0')

  // Direction Change Rule: the new round keeps the direction the last one ended on.
  const directionState = createScenarioState()
  directionState.rules.directionChange = 'removed'
  directionState.round.direction = 'clockwise'
  directionState.round.trumpRank = 'J'
  directionState.round.passStreak = 1
  directionState.round.lastNonPassingPlayerID = '1'
  directionState.players['0'].hand = [card('clubs_ace.png')]
  directionState.players['1'].hand = [card('spades_king.png')]
  directionState.table.plays = [
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
  ]

  const directionRecorder = createEventRecorder()
  passMove({
    G: directionState,
    ctx: { currentPlayer: '0', turn: 4 },
    events: directionRecorder.events,
    playerID: '0',
  })

  assert.ok(directionState.resetResolution)
  completeResetReveal(directionState, directionRecorder.events, 4)
  finalizeResetResolutionMove({
    G: directionState,
    ctx: { currentPlayer: '0', turn: 4 },
    events: directionRecorder.events,
    playerID: '0',
  }, {
    resolutionID: directionState.resetResolution.id,
  })

  assert.equal(directionState.round.roundNumber, 2)
  assert.equal(directionState.round.direction, 'clockwise')
}

/** The Broken: one rule card, torn out once, and only ever one that defines a removed variant. */
function runBrokenCharacterCheck() {
  assert.ok(BLOW_COW_IMPLEMENTED_CHARACTER_NAMES.includes('The Broken'))

  const state = createScenarioState()
  state.players['0'].character = 'The Broken'
  state.players['0'].hand = [card('clubs_ace.png')]
  state.players['1'].hand = [card('spades_king.png')]

  // Only rules that define a removed variant are on the menu, and only ones still standing.
  const choices = getBreakableRuleIDs(state)
  assert.deepEqual(choices, ['reverse', 'pass', 'joker', 'maxCardsOnTable', 'directionChange', 'passEnding', 'reveal', 'rankChange', 'noCheating'])
  assert.equal(canBreakRule(state, '0'), true)
  assert.equal(canBreakRule(state, '1'), false)

  const { events } = createEventRecorder()
  const context = { G: state, ctx: { currentPlayer: '1', turn: 3 }, events, playerID: '0' }

  // A rule with no removed variant is refused even though it exists.
  assert.equal(breakRuleMove(context, { ruleID: 'leaveGame' }), 'INVALID_MOVE')
  assert.equal(breakRuleMove(context, { ruleID: 'notARule' as BlowCowRuleID }), 'INVALID_MOVE')
  // Another seat cannot spend an ability it does not hold.
  assert.equal(
    breakRuleMove({ ...context, playerID: '1' }, { ruleID: 'pass' }),
    'INVALID_MOVE',
  )
  assert.equal(state.rules.pass, 'active')

  /*
   * Deliberately taken on someone else's turn: the ability belongs to the start of the match, not to
   * a turn, so making the table wait on one player's screen would be the bug.
   */
  assert.equal(breakRuleMove(context, { ruleID: 'pass' }), undefined)
  assert.equal(state.rules.pass, 'removed')
  assert.equal(state.players['0'].brokenRemovedRuleID, 'pass')
  assert.equal(state.players['0'].character, 'The Broken')
  assert.equal(state.history.length, 1)
  assert.match(state.history[0]?.title ?? '', /used The Broken/)

  // Spent once and for all, and the rule it took is off the menu for anyone else.
  assert.equal(canBreakRule(state, '0'), false)
  assert.equal(breakRuleMove(context, { ruleID: 'joker' }), 'INVALID_MOVE')
  assert.equal(state.rules.joker, 'active')
  assert.ok(!getBreakableRuleIDs(state).includes('pass'))

  // The removal is live immediately: Pass stops working the moment the card is torn up.
  assert.equal(
    passMove({ G: state, ctx: { currentPlayer: '0', turn: 4 }, events, playerID: '0' }),
    'INVALID_MOVE',
  )

  const archiveAction = state.archive.turns
    .flatMap((archiveTurn) => archiveTurn.actions)
    .find((action) => action.kind === 'breakRule')
  assert.ok(archiveAction)
  assert.equal(archiveAction?.characterUsed, 'The Broken')

  // A resolution already under way keeps its own rules until it finishes.
  const midResolutionState = createScenarioState()
  midResolutionState.players['0'].character = 'The Broken'
  midResolutionState.resetResolution = {
    id: 'reset-1',
    callerPlayerID: '1',
    kind: 'reset',
    revealOrder: [],
    revealStepIndex: 0,
  }
  assert.equal(
    breakRuleMove({
      G: midResolutionState,
      ctx: { currentPlayer: '0', turn: 2 },
      events,
      playerID: '0',
    }, {
      ruleID: 'reveal',
    }),
    'INVALID_MOVE',
  )
  assert.equal(midResolutionState.rules.reveal, 'active')
}

function runPrototypeCharacterCheck() {
  assert.ok(BLOW_COW_IMPLEMENTED_CHARACTER_NAMES.includes('The Prototype'))

  const state = createScenarioState()
  const doomedCard = card('hearts_ace.png')
  const keptCard = card('clubs_queen.png')
  const spareHeart = card('hearts_queen.png')
  state.players['0'].character = 'The Prototype'
  state.players['0'].hand = [doomedCard, keptCard, spareHeart]
  state.players['1'].hand = [card('spades_king.png')]

  assert.equal(canUseDefy(state, '0'), true)
  assert.equal(canUseDefy(state, '1'), false)

  const { events, record } = createEventRecorder()
  const context = {
    G: state,
    ctx: { currentPlayer: '0', turn: 3 },
    events,
    playerID: '0',
    random: { Shuffle: identityShuffle },
  }

  // Turn-bound, unlike The Broken's start-of-game removal.
  assert.equal(
    defyMove({ ...context, ctx: { currentPlayer: '1', turn: 3 } }, { cardID: doomedCard.id }),
    'INVALID_MOVE',
  )
  // A card that is not in hand is not a card this player may destroy.
  assert.equal(defyMove(context, { cardID: 'not-a-card' }), 'INVALID_MOVE')
  assert.equal(state.players['0'].hand.length, 3)

  /*
   * Hearts and nothing else. Refused before either half lands, so a card of the wrong suit costs
   * neither the hand card nor the rule card nor the round's one use.
   */
  const rulePoolBeforeDefy = getBreakableRuleIDs(state)
  assert.equal(defyMove(context, { cardID: keptCard.id }), 'INVALID_MOVE')
  assert.equal(state.players['0'].hand.length, 3)
  assert.equal(state.players['0'].hasUsedDefyThisRound, false)
  assert.deepEqual(getBreakableRuleIDs(state), rulePoolBeforeDefy)

  const destroyedRuleID = getBreakableRuleIDs(state)[0]
  assert.equal(defyMove(context, { cardID: doomedCard.id }), undefined)

  // Both halves land: the hand card is gone from the game and the drawn rule is removed.
  assert.deepEqual(
    state.players['0'].hand.map((handCard) => handCard.id),
    [keptCard.id, spareHeart.id],
  )
  assert.equal(state.rules[destroyedRuleID], 'removed')
  assert.equal(state.players['0'].hasUsedDefyThisRound, true)
  // The whole point of the action: the turn is still this player's to spend.
  assert.equal(record.nextPlayerID, null)

  assert.equal(state.history.length, 1)
  assert.match(state.history[0]?.title ?? '', /used The Prototype/)
  // The rule is public, the card is not: naming it would show the table a card out of a hidden hand.
  assert.doesNotMatch(state.history[0]?.detail ?? '', /A of Hearts/)
  // The log's closing line, which only this ability writes.
  assert.equal(state.history[0]?.omen, DEFY_HISTORY_OMEN)
  assert.ok(state.telemetry.events.every((event) => !('omen' in event)))

  const archiveAction = state.archive.turns
    .flatMap((archiveTurn) => archiveTurn.actions)
    .find((action) => action.kind === 'defy')
  assert.ok(archiveAction)
  assert.equal(archiveAction?.characterUsed, 'The Prototype')
  assert.deepEqual(archiveAction?.cards.map((archivedCard) => archivedCard.id), [doomedCard.id])
  assert.match(archiveAction?.detail ?? '', /A of Hearts/)

  // One use per round, so the second attempt is refused with the hand untouched — and refused on
  // the spare heart, which the suit rule has nothing to say about.
  assert.equal(canUseDefy(state, '0'), false)
  assert.equal(defyMove(context, { cardID: spareHeart.id }), 'INVALID_MOVE')
  assert.equal(state.players['0'].hand.length, 2)

  // Per round, not per match: everyone passing rolls the round over and hands the use back.
  assert.equal(passMove({ ...context, ctx: { currentPlayer: '0', turn: 3 } }), undefined)
  assert.equal(passMove({ ...context, ctx: { currentPlayer: '1', turn: 4 }, playerID: '1' }), undefined)
  assert.ok(state.resetResolution)
  completeResetReveal(state, events, 4)
  assert.equal(
    finalizeResetResolutionMove({
      G: state,
      ctx: { currentPlayer: '1', turn: 4 },
      events,
      playerID: '1',
    }, {
      resolutionID: state.resetResolution.id,
    }),
    undefined,
  )
  assert.equal(state.round.roundNumber, 2)
  assert.equal(state.players['0'].hasUsedDefyThisRound, false)
  assert.equal(canUseDefy(state, '0'), true)

  // A resolution already under way keeps its own rules until it finishes.
  const midResolutionState = createScenarioState()
  const midResolutionCard = card('hearts_ace.png')
  midResolutionState.players['0'].character = 'The Prototype'
  midResolutionState.players['0'].hand = [midResolutionCard]
  midResolutionState.resetResolution = {
    id: 'reset-1',
    callerPlayerID: '0',
    kind: 'reset',
    revealOrder: [],
    revealStepIndex: 0,
  }
  assert.equal(
    defyMove({
      G: midResolutionState,
      ctx: { currentPlayer: '0', turn: 2 },
      events,
      playerID: '0',
    }, {
      cardID: midResolutionCard.id,
    }),
    'INVALID_MOVE',
  )

  /*
   * With every removable rule but one already gone the draw is forced, which is what makes the
   * removal testable: Pass has to stop working the moment Defy tears the card up.
   */
  const lastRuleState = createScenarioState()
  const lastRuleCard = card('hearts_ace.png')
  lastRuleState.players['0'].character = 'The Prototype'
  lastRuleState.players['0'].hand = [lastRuleCard]
  lastRuleState.players['1'].hand = [card('spades_king.png')]
  for (const ruleID of getBreakableRuleIDs(lastRuleState)) {
    if (ruleID !== 'pass') {
      lastRuleState.rules[ruleID] = 'removed'
    }
  }

  const lastRuleContext = {
    G: lastRuleState,
    ctx: { currentPlayer: '0', turn: 4 },
    events,
    playerID: '0',
  }
  assert.equal(defyMove(lastRuleContext, { cardID: lastRuleCard.id }), undefined)
  assert.equal(lastRuleState.rules.pass, 'removed')
  assert.equal(passMove(lastRuleContext), 'INVALID_MOVE')

  // Nothing left to destroy, and an empty hand, are each enough to take the action away.
  assert.equal(getBreakableRuleIDs(lastRuleState).length, 0)
  lastRuleState.players['0'].hasUsedDefyThisRound = false
  assert.equal(canUseDefy(lastRuleState, '0'), false)

  const emptyHandState = createScenarioState()
  emptyHandState.players['0'].character = 'The Prototype'
  emptyHandState.players['0'].hand = []
  assert.equal(canUseDefy(emptyHandState, '0'), false)

  // A full hand of the wrong suit is the same as no hand at all, since only a heart can pay for the
  // rule card. The joker is in there because it is the one card that belongs to no suit.
  const heartlessState = createScenarioState()
  heartlessState.players['0'].character = 'The Prototype'
  heartlessState.players['0'].hand = [
    card('clubs_ace.png'),
    card('spades_king.png'),
    card('diamonds_queen.png'),
    card('Joker1.png'),
  ]
  assert.equal(canUseDefy(heartlessState, '0'), false)
  assert.equal(
    defyMove({
      G: heartlessState,
      ctx: { currentPlayer: '0', turn: 2 },
      events,
      playerID: '0',
    }, {
      cardID: heartlessState.players['0'].hand[0].id,
    }),
    'INVALID_MOVE',
  )
}

function runMastermindCharacterCheck() {
  assert.ok(BLOW_COW_IMPLEMENTED_CHARACTER_NAMES.includes('The Mastermind'))

  const state = createScenarioState(3)
  const ownCard = card('clubs_ace.png')
  const targetTrumpCard = card('hearts_queen.png')
  const targetOtherCard = card('spades_king.png')
  const bystanderCard = card('diamonds_king.png')
  state.players['0'].character = 'The Mastermind'
  // A live Dreamer next door, so the accusation refused below is one that would otherwise be legal.
  state.players['2'].character = 'The Dreamer'
  state.players['0'].hand = [ownCard]
  state.players['1'].hand = [targetTrumpCard, targetOtherCard]
  state.players['2'].hand = [bystanderCard]

  assert.deepEqual(getConspiracyTargetPlayerIDs(state, '0'), ['1', '2'])
  assert.equal(canConspire(state, '0'), true)
  assert.equal(canConspire(state, '1'), false)

  const { events, record } = createEventRecorder()
  const context = {
    G: state,
    ctx: { currentPlayer: '0', turn: 3 },
    events,
    playerID: '0',
  }

  // Turn-bound, and never against yourself.
  assert.equal(
    conspireMove({ ...context, ctx: { currentPlayer: '1', turn: 3 } }, { targetPlayerID: '1' }),
    'INVALID_MOVE',
  )
  assert.equal(conspireMove(context, { targetPlayerID: '0' }), 'INVALID_MOVE')

  assert.equal(conspireMove(context, { targetPlayerID: '1' }), undefined)
  assert.deepEqual(state.conspiracy, { playerID: '0', targetPlayerID: '1', turnNumber: 3 })
  assert.equal(state.players['0'].hasUsedConspireThisRound, true)
  // Public the moment it lands: the victim's hand is about to shrink for no other visible reason.
  assert.match(state.history[0]?.title ?? '', /used The Mastermind/)

  const conspireArchiveAction = state.archive.turns
    .flatMap((archiveTurn) => archiveTurn.actions)
    .find((action) => action.kind === 'conspire')
  assert.ok(conspireArchiveAction)
  assert.equal(conspireArchiveAction?.characterUsed, 'The Mastermind')
  assert.equal(conspireArchiveAction?.targetPlayerID, '1')
  // The archive is the only record of what The Mastermind actually got to look at.
  assert.deepEqual(
    conspireArchiveAction?.cards.map((archivedCard) => archivedCard.id),
    [targetTrumpCard.id, targetOtherCard.id],
  )

  // The commitment: every other way out of the turn is shut until the play lands.
  assert.equal(passMove(context), 'INVALID_MOVE')
  assert.equal(callResetMove(context), 'INVALID_MOVE')
  assert.equal(callBSMove(context, { targetPlayerID: '2' }), 'INVALID_MOVE')
  // Accuse would otherwise be legal here, and it ends the round — which would clear the conspiracy.
  assert.equal(accuseDreamerMove(context, { targetPlayerID: '2' }), 'INVALID_MOVE')
  assert.equal(state.accusation, null)

  // The cards come out of the opened hand, and only out of it.
  assert.equal(
    selectTrumpAndPlayMove(context, { trumpRank: 'Q', cardIDs: [ownCard.id] }),
    'INVALID_MOVE',
  )
  assert.equal(
    selectTrumpAndPlayMove(context, { trumpRank: 'Q', cardIDs: [targetTrumpCard.id] }),
    undefined,
  )

  assert.equal(state.conspiracy, null)
  assert.deepEqual(state.players['0'].hand.map((handCard) => handCard.id), [ownCard.id])
  assert.deepEqual(state.players['1'].hand.map((handCard) => handCard.id), [targetOtherCard.id])

  // In every respect other than where the cards came from, this is The Mastermind's own play.
  const conspiredPlay = state.table.plays.at(-1)
  assert.equal(conspiredPlay?.playerID, '0')
  assert.equal(state.round.lastNonPassingPlayerID, '0')
  assert.equal(state.players['0'].matchStats.playCount, 1)
  assert.equal(state.players['0'].matchStats.cardsPlayed, 1)
  assert.equal(state.players['1'].matchStats.playCount, 0)
  assert.ok(record.nextPlayerID)

  const playArchiveAction = state.archive.turns
    .filter((archiveTurn) => archiveTurn.turnNumber === 3 && archiveTurn.playerID === '0')
    .flatMap((archiveTurn) => archiveTurn.actions)
    .find((action) => action.kind === 'play')
  assert.equal(playArchiveAction?.characterUsed, 'The Mastermind')
  assert.equal(playArchiveAction?.targetPlayerID, '1')

  // One use per round, spent whether or not the play went well.
  assert.equal(canConspire(state, '0'), false)
  assert.equal(
    conspireMove({ ...context, ctx: { currentPlayer: '0', turn: 6 } }, { targetPlayerID: '1' }),
    'INVALID_MOVE',
  )

  // Only The Mastermind's own view opens the hand. Everyone else, including the table at large, sees
  // the same card backs they always did.
  const viewState = createScenarioState(3)
  viewState.players['0'].character = 'The Mastermind'
  viewState.players['1'].hand = [card('hearts_queen.png')]
  viewState.conspiracy = { playerID: '0', targetPlayerID: '1', turnNumber: 2 }

  const playerView = BlowCowGame.playerView as (args: { G: BlowCowState; playerID: string | null }) => BlowCowState
  assert.equal(playerView({ G: viewState, playerID: '0' }).players['1'].hand[0].sprite, 'hearts_queen.png')
  assert.equal(playerView({ G: viewState, playerID: '2' }).players['1'].hand[0].sprite, CARD_BACK_SPRITE)
  assert.equal(playerView({ G: viewState, playerID: null }).players['1'].hand[0].sprite, CARD_BACK_SPRITE)
  // And it closes with the conspiracy rather than lingering for the rest of the turn.
  viewState.conspiracy = null
  assert.equal(playerView({ G: viewState, playerID: '0' }).players['1'].hand[0].sprite, CARD_BACK_SPRITE)

  // An empty hand is not a hand to conspire with, because the play it commits to could never happen.
  const emptyTargetState = createScenarioState()
  emptyTargetState.players['0'].character = 'The Mastermind'
  emptyTargetState.players['0'].hand = [card('clubs_ace.png')]
  emptyTargetState.players['1'].hand = []
  assert.deepEqual(getConspiracyTargetPlayerIDs(emptyTargetState, '0'), [])
  assert.equal(canConspire(emptyTargetState, '0'), false)

  // Neither is a full table, for the same reason: there would be no room to play what was opened.
  const fullTableState = createScenarioState()
  fullTableState.players['0'].character = 'The Mastermind'
  fullTableState.players['0'].hand = [card('clubs_ace.png')]
  fullTableState.players['1'].hand = [card('hearts_queen.png'), card('spades_queen.png')]
  fullTableState.round.trumpRank = 'Q'
  fullTableState.round.maxCardsOnTable = 1
  fullTableState.table.plays = [{
    id: 'play-full',
    playerID: '1',
    cards: [card('diamonds_king.png')],
    declaredCardCount: 1,
    revealedCardIDs: [],
    rehiddenCardIDs: [],
    claimedRank: 'Q',
    playedAtRound: 1,
    playedAtTurn: 1,
    revealedAtTurn: null,
    wasTrumpSelection: false,
  }]
  assert.equal(canConspire(fullTableState, '0'), true)
  assert.equal(
    conspireMove({
      G: fullTableState,
      ctx: { currentPlayer: '0', turn: 2 },
      events,
      playerID: '0',
    }, {
      targetPlayerID: '1',
    }),
    'INVALID_MOVE',
  )

  // Per round, not per match: everyone passing rolls the round over and hands the use back.
  const roundRolloverState = createScenarioState()
  roundRolloverState.players['0'].character = 'The Mastermind'
  roundRolloverState.players['0'].hand = [card('clubs_ace.png')]
  roundRolloverState.players['1'].hand = [card('hearts_queen.png')]
  roundRolloverState.players['0'].hasUsedConspireThisRound = true

  const rolloverContext = {
    G: roundRolloverState,
    ctx: { currentPlayer: '0', turn: 3 },
    events,
    playerID: '0',
  }
  assert.equal(passMove(rolloverContext), undefined)
  assert.equal(passMove({ ...rolloverContext, ctx: { currentPlayer: '1', turn: 4 }, playerID: '1' }), undefined)
  assert.ok(roundRolloverState.resetResolution)
  completeResetReveal(roundRolloverState, events, 4)
  assert.equal(
    finalizeResetResolutionMove({
      G: roundRolloverState,
      ctx: { currentPlayer: '1', turn: 4 },
      events,
      playerID: '1',
    }, {
      resolutionID: roundRolloverState.resetResolution.id,
    }),
    undefined,
  )
  assert.equal(roundRolloverState.round.roundNumber, 2)
  assert.equal(roundRolloverState.players['0'].hasUsedConspireThisRound, false)
  assert.equal(canConspire(roundRolloverState, '0'), true)
}

function runInvisibleHandCharacterCheck() {
  assert.ok(BLOW_COW_IMPLEMENTED_CHARACTER_NAMES.includes('The Invisible Hand'))

  const state = createScenarioState(3)
  state.players['0'].character = 'The Invisible Hand'
  state.round.status = 'awaitingTrumpSelection'
  state.round.startingPlayerID = '0'
  state.round.direction = 'clockwise'
  state.round.previousTrumpRank = 'K'
  for (const playerID of state.seatOrder) {
    state.players[playerID].hand = [card('hearts_queen.png'), card('clubs_ace.png')].map((handCard) => ({
      ...handCard,
      id: `${handCard.id}-${playerID}`,
    }))
  }

  assert.deepEqual(getManipulationTargetPlayerIDs(state, '0'), ['1', '2'])
  assert.equal(canManipulate(state, '0'), true)
  assert.equal(canManipulate(state, '1'), false)
  // Deciding the rank outright is still deciding it, so the Rank Change Rule applies.
  assert.equal(getManipulableTrumpRanks(state).includes('K'), false)
  assert.equal(getManipulableTrumpRanks(state).length, BLOW_COW_RANKS.length - 1)

  const { events, record } = createEventRecorder()
  const context = {
    G: state,
    ctx: { currentPlayer: '0', turn: 3 },
    events,
    playerID: '0',
  }

  // Turn-bound, never against yourself, and never the rank the last round ran on.
  assert.equal(
    manipulateMove(
      { ...context, ctx: { currentPlayer: '1', turn: 3 } },
      { targetPlayerID: '2', trumpRank: 'Q', direction: 'counterclockwise' },
    ),
    'INVALID_MOVE',
  )
  assert.equal(
    manipulateMove(context, { targetPlayerID: '0', trumpRank: 'Q', direction: 'counterclockwise' }),
    'INVALID_MOVE',
  )
  assert.equal(
    manipulateMove(context, { targetPlayerID: '2', trumpRank: 'K', direction: 'counterclockwise' }),
    'INVALID_MOVE',
  )
  assert.equal(state.round.trumpRank, null)

  assert.equal(
    manipulateMove(context, { targetPlayerID: '2', trumpRank: 'Q', direction: 'counterclockwise' }),
    undefined,
  )

  // All three decisions land, and the round is handed over rather than merely pointed at.
  assert.equal(state.round.trumpRank, 'Q')
  assert.equal(state.round.direction, 'counterclockwise')
  assert.equal(state.round.startingPlayerID, '2')
  assert.equal(state.round.forcedPlayPlayerID, '2')
  assert.equal(record.nextPlayerID, '2')
  // Manipulate puts no cards on the table, so it must leave nothing to call BS on.
  assert.equal(state.round.lastNonPassingPlayerID, null)
  assert.equal(state.table.plays.length, 0)
  assert.match(state.history[0]?.title ?? '', /used The Invisible Hand/)

  const archiveAction = state.archive.turns
    .flatMap((archiveTurn) => archiveTurn.actions)
    .find((action) => action.kind === 'manipulate')
  assert.ok(archiveAction)
  assert.equal(archiveAction?.characterUsed, 'The Invisible Hand')
  assert.equal(archiveAction?.targetPlayerID, '2')
  assert.equal(archiveAction?.claimedRank, 'Q')
  assert.equal(archiveAction?.directionBefore, 'clockwise')
  assert.equal(archiveAction?.directionAfter, 'counterclockwise')

  // Handing the round away is what spends the ability: the starting player is somebody else now.
  assert.equal(canManipulate(state, '0'), false)

  const forcedContext = {
    G: state,
    ctx: { currentPlayer: '2', turn: 4 },
    events,
    playerID: '2',
  }
  beginTurn({ G: state, ctx: { currentPlayer: '2', turn: 4 }, events })
  // The lock survives the turn it was made for.
  assert.equal(state.round.forcedPlayPlayerID, '2')
  assert.equal(passMove(forcedContext), 'INVALID_MOVE')
  assert.equal(state.round.passStreak, 0)
  assert.match(state.tableStatus, /must play and may not pass/)

  // The trump is already set, so the forced turn is an ordinary Play rather than a trump selection.
  const forcedCard = state.players['2'].hand[0]
  assert.equal(
    selectTrumpAndPlayMove(forcedContext, { trumpRank: 'Q', cardIDs: [forcedCard.id] }),
    'INVALID_MOVE',
  )
  assert.equal(playMove(forcedContext, { cardIDs: [forcedCard.id] }), undefined)
  assert.equal(state.round.lastNonPassingPlayerID, '2')
  // The play pays the lock off there and then, rather than at the next turn start. Nothing here can
  // tell the difference, but The Clown can: their play keeps the turn, and a lock still standing
  // would take Pass off the encore it earned.
  assert.equal(state.round.forcedPlayPlayerID, null)

  // One turn only: the next turn to begin lifts the lock and Pass comes back.
  beginTurn({ G: state, ctx: { currentPlayer: '1', turn: 5 }, events })
  assert.equal(state.round.forcedPlayPlayerID, null)
  beginTurn({ G: state, ctx: { currentPlayer: '2', turn: 6 }, events })
  assert.equal(
    passMove({ G: state, ctx: { currentPlayer: '2', turn: 6 }, events, playerID: '2' }),
    undefined,
  )

  // A round already under way cannot be re-opened, however it got under way.
  const passedState = createScenarioState(3)
  passedState.players['0'].character = 'The Invisible Hand'
  passedState.round.startingPlayerID = '0'
  passedState.round.passStreak = 1
  assert.equal(canManipulate(passedState, '0'), false)

  const playedState = createScenarioState(3)
  playedState.players['0'].character = 'The Invisible Hand'
  playedState.round.startingPlayerID = '0'
  playedState.round.lastNonPassingPlayerID = '1'
  assert.equal(canManipulate(playedState, '0'), false)

  const trumpedState = createScenarioState(3)
  trumpedState.players['0'].character = 'The Invisible Hand'
  trumpedState.round.startingPlayerID = '0'
  trumpedState.round.trumpRank = 'Q'
  assert.equal(canManipulate(trumpedState, '0'), false)

  // Not the starting player, no Manipulate. That is the whole timing condition.
  const notStartingState = createScenarioState(3)
  notStartingState.players['1'].character = 'The Invisible Hand'
  notStartingState.round.startingPlayerID = '0'
  assert.equal(canManipulate(notStartingState, '1'), false)

  // Removing the Rank Change Rule lifts the one restriction on the rank, exactly as it does for an
  // ordinary trump selection.
  const rankChangeRemovedState = createScenarioState(3)
  rankChangeRemovedState.players['0'].character = 'The Invisible Hand'
  rankChangeRemovedState.round.startingPlayerID = '0'
  rankChangeRemovedState.round.previousTrumpRank = 'K'
  rankChangeRemovedState.rules.rankChange = 'removed'
  assert.equal(getManipulableTrumpRanks(rankChangeRemovedState).length, BLOW_COW_RANKS.length)
  assert.equal(
    manipulateMove({
      G: rankChangeRemovedState,
      ctx: { currentPlayer: '0', turn: 2 },
      events,
      playerID: '0',
    }, {
      targetPlayerID: '1',
      trumpRank: 'K',
      direction: 'clockwise',
    }),
    undefined,
  )
  assert.equal(rankChangeRemovedState.round.trumpRank, 'K')

  // The round ending clears the lock even though no forced turn was ever taken.
  const roundEndState = createScenarioState()
  roundEndState.players['0'].character = 'The Invisible Hand'
  roundEndState.players['0'].hand = [card('clubs_ace.png')]
  roundEndState.players['1'].hand = [card('hearts_queen.png')]
  roundEndState.round.forcedPlayPlayerID = '1'
  const roundEndContext = {
    G: roundEndState,
    ctx: { currentPlayer: '0', turn: 3 },
    events,
    playerID: '0',
  }
  assert.equal(passMove(roundEndContext), undefined)
  assert.equal(
    passMove({ ...roundEndContext, ctx: { currentPlayer: '1', turn: 4 }, playerID: '1' }),
    'INVALID_MOVE',
  )
  roundEndState.round.forcedPlayPlayerID = null
  assert.equal(
    passMove({ ...roundEndContext, ctx: { currentPlayer: '1', turn: 4 }, playerID: '1' }),
    undefined,
  )
  assert.ok(roundEndState.resetResolution)
  completeResetReveal(roundEndState, events, 4)
  assert.equal(
    finalizeResetResolutionMove({
      G: roundEndState,
      ctx: { currentPlayer: '1', turn: 4 },
      events,
      playerID: '1',
    }, {
      resolutionID: roundEndState.resetResolution.id,
    }),
    undefined,
  )
  assert.equal(roundEndState.round.roundNumber, 2)
  assert.equal(roundEndState.round.forcedPlayPlayerID, null)
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
    // The ability is written as a delta so the board and the results tooltip can name a number.
    assert.deepEqual(state.players['0'].leaveEffect, { character: 'The Speedrunner', pointDelta: -2 })
    assert.equal(formatLeaveEffectLabel(state.players['0'].leaveEffect!), '-2 points (The Speedrunner)')
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
    assert.deepEqual(state.players['0'].leaveEffect, { character: 'The Streamer', pointDelta: -2 })
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
    assert.deepEqual(state.players['0'].leaveEffect, { character: 'The Pacifist', pointDelta: -1 })
    // Singular, so the label cannot read "-1 points".
    assert.equal(formatLeaveEffectLabel(state.players['0'].leaveEffect!), '-1 point (The Pacifist)')
  }

  {
    // The one ability that pays out. It has no condition beyond leaving, so it always fires.
    const state = createScenarioState()
    const { events, record } = createEventRecorder()

    state.players['0'].character = 'The Privileged'
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

    assert.equal(record.endedGame?.pointsByPlayer['0'], 3)
    assert.equal(state.players['0'].points, 3)
    assert.deepEqual(state.players['0'].leaveEffect, { character: 'The Privileged', pointDelta: 1 })
    assert.equal(formatLeaveEffectLabel(state.players['0'].leaveEffect!), '+1 point (The Privileged)')
  }

  {
    // The Drunkard needs a play on record and no manual one, so an untouched hand leaves it silent.
    const state = createScenarioState()
    const { events } = createEventRecorder()

    state.players['0'].character = 'The Drunkard'
    state.players['0'].hand = []
    state.players['0'].points = 5
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

    assert.equal(state.players['0'].points, 2)
    assert.deepEqual(state.players['0'].leaveEffect, { character: 'The Drunkard', pointDelta: -3 })
    assert.equal(formatLeaveEffectLabel(state.players['0'].leaveEffect!), '-3 points (The Drunkard)')
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
    // No ability fired, so there is nothing for the board or the results table to label.
    assert.equal(state.players['0'].leaveEffect, null)
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
    // The last player out triggers just like everyone else, which is what the win screen pauses on.
    assert.equal(state.players['0'].leaveEffect, null)
    assert.deepEqual(state.players['1'].leaveEffect, { character: 'The Streamer', pointDelta: -2 })
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

/**
 * The poker evaluator on its own, away from any game state. Every case here is a hand a Reset
 * showdown can actually produce, which is why so few of them are five cards: the point of these is
 * that a short hand is scored as it stands rather than padded out.
 */
function runPokerHandEvaluationCheck() {
  const handOf = (...sprites: string[]) => evaluatePokerHand(sprites.map((sprite) => card(sprite)))

  {
    // Nothing in front is its own category, below every hand that has a card in it.
    const empty = handOf()
    assert.equal(empty.category, 'none')
    assert.equal(empty.label, 'Nothing in front')
    assert.ok(comparePokerHands(handOf('clubs_02.png'), empty) > 0)
  }

  {
    // The categories a short hand can and cannot reach.
    assert.equal(handOf('clubs_king.png').category, 'highCard')
    assert.equal(handOf('clubs_king.png').label, 'King high')
    assert.equal(handOf('clubs_king.png', 'hearts_king.png').category, 'pair')
    assert.equal(handOf('clubs_king.png', 'hearts_king.png').label, 'Pair of Kings')
    assert.equal(handOf('clubs_king.png', 'hearts_king.png', 'spades_king.png').category, 'threeOfAKind')
    assert.equal(
      handOf('clubs_king.png', 'hearts_king.png', 'spades_king.png', 'diamonds_king.png').category,
      'fourOfAKind',
    )
    assert.equal(
      handOf('clubs_king.png', 'hearts_king.png', 'spades_04.png', 'diamonds_04.png').category,
      'twoPair',
    )
  }

  {
    /*
     * The rule that decides most showdowns: four to a flush is not a flush, and four to a straight is
     * not a straight. Both fall back to high card, which is what makes a big pile of mismatched cards
     * genuinely weak.
     */
    const fourFlush = handOf('diamonds_09.png', 'diamonds_07.png', 'diamonds_05.png', 'diamonds_02.png')
    assert.equal(fourFlush.category, 'highCard')
    assert.equal(fourFlush.label, '9 high')

    const fourStraight = handOf('clubs_09.png', 'hearts_08.png', 'spades_07.png', 'diamonds_06.png')
    assert.equal(fourStraight.category, 'highCard')

    const realFlush = handOf('diamonds_09.png', 'diamonds_07.png', 'diamonds_05.png', 'diamonds_02.png', 'diamonds_king.png')
    assert.equal(realFlush.category, 'flush')
    assert.equal(realFlush.label, 'King-high flush')

    const realStraight = handOf('clubs_09.png', 'hearts_08.png', 'spades_07.png', 'diamonds_06.png', 'clubs_05.png')
    assert.equal(realStraight.category, 'straight')
    assert.equal(realStraight.label, '9-high straight')
  }

  {
    // A pair beats the four-card flush above, which is the ordering players have to learn.
    assert.ok(comparePokerHands(
      handOf('clubs_02.png', 'hearts_02.png'),
      handOf('diamonds_09.png', 'diamonds_07.png', 'diamonds_05.png', 'diamonds_02.png'),
    ) > 0)
  }

  {
    // The ace is high and only high, so A-2-3-4-5 is not a straight.
    const wheel = handOf('clubs_ace.png', 'hearts_02.png', 'spades_03.png', 'diamonds_04.png', 'clubs_05.png')
    assert.equal(wheel.category, 'highCard')
    assert.equal(wheel.label, 'Ace high')

    const broadway = handOf('clubs_ace.png', 'hearts_king.png', 'spades_queen.png', 'diamonds_jack.png', 'clubs_10.png')
    assert.equal(broadway.category, 'straight')
    assert.equal(broadway.label, 'Ace-high straight')
  }

  {
    // Jokers are wild, so they fill in for whatever the rest of the hand is reaching for.
    assert.equal(handOf('clubs_king.png', 'Joker1.png').category, 'pair')
    assert.equal(handOf('clubs_king.png', 'hearts_king.png', 'Joker1.png').category, 'threeOfAKind')
    assert.equal(
      handOf('diamonds_09.png', 'diamonds_07.png', 'diamonds_05.png', 'diamonds_02.png', 'Joker1.png').category,
      'flush',
    )
    assert.equal(
      handOf('clubs_09.png', 'hearts_08.png', 'spades_07.png', 'Joker1.png', 'clubs_05.png').category,
      'straight',
    )
    // One wild card, spent once: it completes the flush or the trips, not both.
    assert.equal(handOf('clubs_king.png', 'hearts_king.png', 'clubs_04.png', 'clubs_07.png', 'Joker1.png').category, 'threeOfAKind')
  }

  {
    // Same reading, so the shorter hand is the weaker one. This is the last word before a real tie.
    const shortPair = handOf('clubs_king.png', 'hearts_king.png')
    const longPair = handOf('clubs_king.png', 'hearts_king.png', 'spades_02.png')
    assert.ok(comparePokerHands(longPair, shortPair) > 0)
    assert.equal(comparePokerHands(shortPair, handOf('spades_king.png', 'diamonds_king.png')), 0)
  }

  {
    // Category first, then the ranks inside it.
    assert.ok(comparePokerHands(handOf('clubs_ace.png', 'hearts_ace.png'), handOf('clubs_king.png', 'hearts_king.png')) > 0)
    assert.ok(comparePokerHands(
      handOf('clubs_03.png', 'hearts_03.png', 'spades_03.png'),
      handOf('clubs_ace.png', 'hearts_ace.png'),
    ) > 0)
  }
}

/**
 * The Gambler. A Reset stops being a redistribution and becomes a showdown, whoever called it, and
 * the weakest hand in front takes the whole table.
 */
function runGamblerCharacterCheck() {
  /**
   * Three players, each with a fixed pile in front, and player 0 about to call Reset. The last play
   * is left face down so the reveal procedure has something to walk.
   */
  const createShowdownScenario = (frontCardsByPlayer: Record<string, string[]>) => {
    const state = createScenarioState(3)
    const { events, record } = createEventRecorder()

    state.players['0'].hand = [card('clubs_ace.png')]
    state.players['1'].hand = [card('spades_king.png')]
    state.players['2'].hand = [card('diamonds_king.png')]
    state.round.trumpRank = 'A'
    state.round.maxCardsOnTable = 1
    state.round.lastNonPassingPlayerID = '2'
    state.table.plays = Object.entries(frontCardsByPlayer)
      .filter(([, sprites]) => sprites.length > 0)
      .map(([playerID, sprites], index) => ({
        id: `play-${playerID}`,
        playerID,
        cards: sprites.map((sprite) => card(sprite)),
        claimedRank: 'A' as const,
        playedAtRound: 1,
        playedAtTurn: index + 1,
        // Player 2 played last, so their pile is the one still hidden.
        revealedAtTurn: playerID === '2' ? null : index + 2,
        wasTrumpSelection: false,
      }))
    state.players['2'].pendingRevealPlayID = 'play-2'

    return { state, events, record }
  }

  const callReset = (state: BlowCowState, events: TestContext['events']) => {
    return callResetMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 6,
      },
      events,
      playerID: '0',
      random: {
        Shuffle: identityShuffle,
      },
    })
  }

  {
    /*
     * The ability belongs to the table, not to the caller: player 1 holds The Gambler and player 0
     * calls the Reset. Player 2 has a lone card against two pairs, so they take everything.
     */
    const { state, events, record } = createShowdownScenario({
      '0': ['clubs_king.png', 'hearts_king.png'],
      '1': ['clubs_04.png', 'hearts_04.png'],
      '2': ['spades_09.png'],
    })
    state.players['1'].character = 'The Gambler'

    assert.equal(callReset(state, events), undefined)
    assert.ok(state.resetResolution?.showdown)
    assert.match(state.tableStatus, /showdown/i)

    // Withheld until the caller has turned the table over, exactly like a BS punishment.
    assert.equal(
      (BlowCowGame.playerView({ G: state, playerID: '0' }) as BlowCowState).resetResolution?.showdown,
      null,
    )

    completeResetReveal(state, events, 6)

    const showdown = state.resetResolution?.showdown
    assert.ok(showdown)
    assert.deepEqual(showdown.standings.map((standing) => standing.playerID), ['0', '1', '2'])
    assert.equal(showdown.standings[0].handLabel, 'Pair of Kings')
    assert.equal(showdown.standings[2].handLabel, '9 high')
    assert.deepEqual(showdown.weakestPlayerIDs, ['2'])
    // ...and now it reaches the client, because the cards backing it are face up.
    assert.ok((BlowCowGame.playerView({ G: state, playerID: '0' }) as BlowCowState).resetResolution?.showdown)

    assert.ok(state.resetResolution)
    const resolutionID = state.resetResolution.id
    const punishContext: TestContext = {
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 6,
      },
      events,
      playerID: '0',
      random: {
        Shuffle: identityShuffle,
      },
    }

    // Only a weakest hand may be named, however the button was pressed.
    assert.notEqual(beginResetPunishmentMove(punishContext, { resolutionID, punishedPlayerID: '0' }), undefined)
    assert.equal(state.resetResolution?.showdown?.isPunishing, false)

    assert.equal(beginResetPunishmentMove(punishContext, { resolutionID, punishedPlayerID: '2' }), undefined)
    assert.equal(state.resetResolution?.showdown?.isPunishing, true)
    assert.equal(state.resetResolution?.showdown?.punishedPlayerID, '2')

    assert.equal(finalizeResetResolutionMove(punishContext, { resolutionID }), undefined)

    // The whole table went to one player rather than being dealt out.
    assert.equal(state.players['2'].hand.length, 6)
    assert.equal(state.players['0'].hand.length, 1)
    assert.equal(state.players['1'].hand.length, 1)
    assert.equal(state.players['2'].matchStats.punishmentCount, 1)
    // `beginNextRound` has already rolled the round over, so the flag The Privileged reads sits here.
    assert.equal(state.players['2'].wasPunishedLastRound, true)
    assert.equal(state.table.plays.length, 0)
    assert.equal(state.resetResolution, null)
    // The caller still opens the next round, which is the part of Call Reset the showdown leaves alone.
    assert.equal(record.nextPlayerID, '0')
    assert.equal(state.round.startingPlayerID, '0')
    assert.match(
      state.history.find((entry) => entry.kind === 'verdict')?.detail ?? '',
      /Pair of Kings/,
    )
  }

  {
    // A tie leaves every tied seat available, and the caller's press is what settles it.
    const { state, events } = createShowdownScenario({
      '0': ['clubs_king.png', 'hearts_king.png'],
      '1': ['clubs_04.png'],
      '2': ['spades_04.png'],
    })
    state.players['0'].character = 'The Gambler'

    assert.equal(callReset(state, events), undefined)
    completeResetReveal(state, events, 6)

    const showdown = state.resetResolution?.showdown
    assert.ok(showdown)
    assert.deepEqual([...showdown.weakestPlayerIDs].sort(), ['1', '2'])

    assert.ok(state.resetResolution)
    const resolutionID = state.resetResolution.id
    const punishContext: TestContext = {
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 6,
      },
      events,
      playerID: '0',
      random: {
        Shuffle: identityShuffle,
      },
    }

    assert.equal(beginResetPunishmentMove(punishContext, { resolutionID, punishedPlayerID: '1' }), undefined)
    assert.equal(finalizeResetResolutionMove(punishContext, { resolutionID }), undefined)

    assert.equal(state.players['1'].hand.length, 5)
    assert.equal(state.players['2'].hand.length, 1)
    assert.match(
      state.history.find((entry) => entry.kind === 'verdict')?.detail ?? '',
      /tied for weakest/i,
    )
  }

  {
    // A seat that passed all round has nothing in front, which is the weakest thing there is.
    const { state, events } = createShowdownScenario({
      '0': ['clubs_02.png', 'hearts_03.png'],
      '1': [],
      '2': ['spades_09.png'],
    })
    state.players['2'].character = 'The Gambler'
    state.players['1'].pendingRevealPlayID = null

    assert.equal(callReset(state, events), undefined)
    completeResetReveal(state, events, 6)

    const showdown = state.resetResolution?.showdown
    assert.ok(showdown)
    assert.deepEqual(showdown.weakestPlayerIDs, ['1'])
    assert.equal(showdown.standings.find((standing) => standing.playerID === '1')?.handLabel, 'Nothing in front')
  }

  {
    // No Gambler at the table, so a Reset is the redistribution it has always been.
    const { state, events } = createShowdownScenario({
      '0': ['clubs_king.png', 'hearts_king.png'],
      '1': ['clubs_04.png', 'hearts_04.png'],
      '2': ['spades_09.png'],
    })

    assert.equal(callReset(state, events), undefined)
    assert.equal(state.resetResolution?.showdown ?? null, null)

    completeResetReveal(state, events, 6)
    assert.ok(state.resetResolution)
    assert.equal(finalizeResetResolutionMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 6,
      },
      events,
      playerID: '0',
      random: {
        Shuffle: identityShuffle,
      },
    }, { resolutionID: state.resetResolution.id }), undefined)

    // Five cards over three players: one each, and the caller takes the remainder.
    assert.equal(state.players['0'].hand.length, 4)
    assert.equal(state.players['1'].hand.length, 2)
    assert.equal(state.players['2'].hand.length, 2)
  }

  {
    // A Gambler who has left the game takes the showdown with them.
    const { state, events } = createShowdownScenario({
      '0': ['clubs_king.png', 'hearts_king.png'],
      '1': ['clubs_04.png', 'hearts_04.png'],
      '2': ['spades_09.png'],
    })
    state.players['1'].character = 'The Gambler'
    state.players['1'].hasLeft = true

    assert.equal(callReset(state, events), undefined)
    assert.equal(state.resetResolution?.showdown ?? null, null)
  }

  {
    // An all-pass return is not a Reset, so it never becomes a showdown.
    const { state, events } = createShowdownScenario({
      '0': ['clubs_king.png', 'hearts_king.png'],
      '1': ['clubs_04.png', 'hearts_04.png'],
      '2': ['spades_09.png'],
    })
    state.players['1'].character = 'The Gambler'
    state.round.passStreak = 2
    state.round.maxCardsOnTable = 12

    assert.equal(passMove({
      G: state,
      ctx: {
        currentPlayer: '0',
        turn: 6,
      },
      events,
      playerID: '0',
    }), undefined)

    assert.equal(state.resetResolution?.kind, 'roundReturn')
    assert.equal(state.resetResolution?.showdown ?? null, null)
  }
}

function runMimeCharacterCheck() {
  assert.ok(BLOW_COW_IMPLEMENTED_CHARACTER_NAMES.includes('The Mime'))

  const state = createScenarioState(3)
  state.players['0'].character = 'The Mime'
  state.players['1'].character = 'The Cat'
  state.players['0'].hand = [card('clubs_ace.png')]
  state.players['1'].hand = [card('hearts_queen.png'), card('spades_king.png')]
  state.players['2'].hand = [card('diamonds_king.png')]
  state.players['1'].points = 1
  state.players['1'].scoredSets = [{
    id: 'set-source',
    rank: 'K',
    cards: [card('clubs_king.png')],
    awardedAtRound: 1,
    awardedAtTurn: 1,
    source: 'initialDeal',
  }]
  const mimeFrontCard = card('clubs_02.png')
  // One face down and one already face up, so the held-back set is the face-down half and only that.
  const sourceHiddenFrontCard = card('diamonds_02.png')
  const sourceRevealedFrontCard = card('spades_03.png')
  state.table.plays = [
    {
      id: 'play-mime',
      playerID: '0',
      cards: [mimeFrontCard],
      declaredCardCount: 1,
      revealedCardIDs: [],
      rehiddenCardIDs: [],
      claimedRank: 'Q',
      playedAtRound: 1,
      playedAtTurn: 1,
      revealedAtTurn: null,
      wasTrumpSelection: false,
    },
    {
      id: 'play-source',
      playerID: '1',
      cards: [sourceHiddenFrontCard, sourceRevealedFrontCard],
      declaredCardCount: 2,
      revealedCardIDs: [sourceRevealedFrontCard.id],
      rehiddenCardIDs: [],
      claimedRank: 'Q',
      playedAtRound: 1,
      playedAtTurn: 2,
      revealedAtTurn: null,
      wasTrumpSelection: false,
    },
  ]

  // The ability names its own target: the next active seat in the current direction.
  assert.equal(getMimicryTargetPlayerID(state, '0'), '1')
  assert.equal(canMimic(state, '0'), true)
  assert.equal(canMimic(state, '1'), false)

  const { events, record } = createEventRecorder()
  // `identityShuffle` leaves the coin on its first face, which is the swap.
  const context = {
    G: state,
    ctx: { currentPlayer: '0', turn: 3 },
    events,
    playerID: '0',
    random: { Shuffle: identityShuffle },
  }

  assert.equal(mimicMove({ ...context, ctx: { currentPlayer: '1', turn: 3 } }), 'INVALID_MOVE')
  assert.equal(mimicMove(context), undefined)

  // Everything copied is frozen where it stood, including which plays each block is wearing.
  assert.deepEqual(state.mimicry, {
    playerID: '0',
    sourcePlayerID: '1',
    turnNumber: 3,
    character: 'The Cat',
    points: 1,
    pointRanks: ['K'],
    handCount: 2,
    wasSeekerPick: false,
    borrowedPlayIDs: ['play-source'],
    hiddenPlayIDs: ['play-mime'],
    // Only the face-down half is held back. A card already face up is public, and hiding it again
    // would be taking something off the table rather than delaying it.
    borrowedFaceDownCardIDs: [sourceHiddenFrontCard.id],
    revealedPlayerIDs: [],
    // The turn about to be handed over, which must not count as the source arriving at their chair.
    pendingHandoverPlayerID: '1',
  })
  assert.equal(state.players['0'].hasUsedMimicThisRound, true)
  // The one field that is the coin flip written down, and the only part of the record withheld.
  const mimicPlayerView = BlowCowGame.playerView as (args: { G: BlowCowState; playerID: string | null }) => BlowCowState
  assert.equal(mimicPlayerView({ G: state, playerID: '2' }).mimicry?.pendingHandoverPlayerID ?? null, null)
  assert.equal(mimicPlayerView({ G: state, playerID: '2' }).mimicry?.sourcePlayerID, '1')

  // The chairs really moved, and `seatIndex` moved with them rather than with the players — which is
  // what keeps every "Seat N" label attached to a position on the ring.
  assert.deepEqual(state.seatOrder, ['1', '0', '2'])
  assert.equal(state.players['0'].seatIndex, 1)
  assert.equal(state.players['1'].seatIndex, 0)
  assert.ok(state.seatOrder.every((seatID, seatIndex) => state.players[seatID].seatIndex === seatIndex))
  // The turn stays in the chair it was in, and the source is now sitting in it.
  assert.equal(record.nextPlayerID, '1')

  // The one anonymous history event in the game: naming a seat would answer the whole question.
  const mimicEvent = state.history.at(-1)
  assert.equal(mimicEvent?.title, 'Mimic')
  assert.equal(mimicEvent?.playerID, null)
  assert.ok(!mimicEvent?.detail.includes('Seat'))

  const mimicArchiveAction = state.archive.turns
    .flatMap((archiveTurn) => archiveTurn.actions)
    .find((action) => action.kind === 'mimic')
  assert.equal(mimicArchiveAction?.characterUsed, 'The Mime')
  assert.equal(mimicArchiveAction?.targetPlayerID, '1')
  // The archive is where the coin flip is written down, and it never leaves the server.
  assert.match(mimicArchiveAction?.detail ?? '', /swapped seats/)

  /*
   * The broadcast status recites the acting player's own action space, and The Cat's Change Direction
   * is in it. While the disguise stands the two seats it hangs between show the same character but
   * only one of them has it, so the status is trimmed to what both have in common.
   */
  beginTurn({ G: state, ctx: { currentPlayer: '1', turn: 4 }, events })
  assert.ok(state.mimicry)
  assert.ok(!state.tableStatus.includes('Change Direction'))
  /*
   * That was the handover. From outside the ring the turn never moved chairs, so it is not the source
   * arriving at theirs — counting it would turn the borrowed pile over a turn earlier here than in
   * the branch where the seats stayed put, which is the coin flip read straight off the table.
   */
  assert.deepEqual(state.mimicry?.revealedPlayerIDs, [])
  assert.equal(state.mimicry?.pendingHandoverPlayerID ?? null, null)

  // No turn start takes the disguise off, including its wearer's own. It is worn for the round.
  // What a turn start does move is the pile, one chair at a time, starting with the chair after the
  // acting one — which after this swap is The Mime's.
  beginTurn({ G: state, ctx: { currentPlayer: '0', turn: 5 }, events })
  assert.ok(state.mimicry)
  assert.deepEqual(state.mimicry?.revealedPlayerIDs, ['0'])
  beginTurn({ G: state, ctx: { currentPlayer: '2', turn: 6 }, events })
  assert.deepEqual(state.mimicry?.revealedPlayerIDs, ['0'])
  beginTurn({ G: state, ctx: { currentPlayer: '1', turn: 7 }, events })
  assert.ok(state.mimicry)
  assert.deepEqual(state.mimicry?.revealedPlayerIDs, ['0', '1'])

  // The other face of the coin: no swap, and the turn keeps running.
  const stayState = createScenarioState(3)
  stayState.players['0'].character = 'The Mime'
  stayState.players['0'].hand = [card('clubs_ace.png')]
  stayState.players['1'].hand = [card('hearts_queen.png')]
  stayState.players['2'].hand = [card('diamonds_king.png')]

  const { events: stayEvents, record: stayRecord } = createEventRecorder()
  const stayContext = {
    G: stayState,
    ctx: { currentPlayer: '0', turn: 3 },
    events: stayEvents,
    playerID: '0',
    random: { Shuffle: reverseShuffle },
  }
  assert.equal(mimicMove(stayContext), undefined)
  assert.deepEqual(stayState.seatOrder, ['0', '1', '2'])
  assert.equal(stayState.players['0'].seatIndex, 0)
  assert.equal(stayRecord.nextPlayerID, null)
  assert.ok(stayState.mimicry)
  // Nothing was handed over, so there is no arrival to discount.
  assert.equal(stayState.mimicry.pendingHandoverPlayerID ?? null, null)

  // One use per round, spent whichever way the coin landed.
  assert.equal(canMimic(stayState, '0'), false)
  assert.equal(mimicMove(stayContext), 'INVALID_MOVE')

  /*
   * The symmetry the whole ability rests on. In both branches the turn moves once and exactly one of
   * the two chairs has turned its pile over — the chair after the acting one. Which player is sitting
   * in it differs, and that is precisely what the table cannot see.
   */
  beginTurn({ G: stayState, ctx: { currentPlayer: '1', turn: 4 }, events: stayEvents })
  assert.deepEqual(stayState.mimicry?.revealedPlayerIDs, ['1'])

  // And it outlasts a full lap back to The Mime's own next turn, which used to be where it ended.
  beginTurn({ G: stayState, ctx: { currentPlayer: '0', turn: 8 }, events: stayEvents })
  assert.ok(stayState.mimicry)
  assert.deepEqual(stayState.mimicry?.revealedPlayerIDs, ['1', '0'])

  // Either half of the disguise leaving takes it down: the leaver's table cards go with them.
  const leaveState = createScenarioState(3)
  leaveState.players['0'].character = 'The Mime'
  leaveState.players['0'].hand = [card('clubs_ace.png')]
  leaveState.players['1'].hand = []
  leaveState.players['2'].hand = [card('diamonds_king.png')]
  leaveState.mimicry = {
    playerID: '0',
    sourcePlayerID: '1',
    turnNumber: 2,
    character: 'The Believer',
    points: 0,
    pointRanks: [],
    handCount: 0,
    wasSeekerPick: false,
    borrowedPlayIDs: [],
    hiddenPlayIDs: [],
    borrowedFaceDownCardIDs: [],
    revealedPlayerIDs: [],
  }
  beginTurn({ G: leaveState, ctx: { currentPlayer: '1', turn: 3 }, events })
  assert.equal(leaveState.players['1'].hasLeft, true)
  assert.equal(leaveState.mimicry ?? null, null)

  // No disguise survives a procedure opening the table, and the round that follows hands the use back.
  const procedureState = createScenarioState()
  procedureState.players['0'].character = 'The Mime'
  procedureState.players['0'].hand = [card('clubs_ace.png')]
  procedureState.players['1'].hand = [card('hearts_queen.png')]
  procedureState.players['0'].hasUsedMimicThisRound = true
  procedureState.mimicry = {
    playerID: '0',
    sourcePlayerID: '1',
    turnNumber: 1,
    character: 'The Believer',
    points: 0,
    pointRanks: [],
    handCount: 1,
    wasSeekerPick: false,
    borrowedPlayIDs: [],
    hiddenPlayIDs: [],
    borrowedFaceDownCardIDs: [],
    revealedPlayerIDs: [],
  }

  assert.equal(passMove({ G: procedureState, ctx: { currentPlayer: '0', turn: 2 }, events, playerID: '0' }), undefined)
  // A pass on its own is not a procedure, so the disguise is still standing.
  assert.ok(procedureState.mimicry)
  assert.equal(passMove({ G: procedureState, ctx: { currentPlayer: '1', turn: 3 }, events, playerID: '1' }), undefined)
  assert.ok(procedureState.resetResolution)
  assert.equal(procedureState.mimicry ?? null, null)
  assert.equal(
    mimicMove({ G: procedureState, ctx: { currentPlayer: '0', turn: 3 }, events, playerID: '0' }),
    'INVALID_MOVE',
  )

  completeResetReveal(procedureState, events, 3)
  assert.equal(
    finalizeResetResolutionMove({
      G: procedureState,
      ctx: { currentPlayer: '1', turn: 3 },
      events,
      playerID: '1',
    }, {
      resolutionID: procedureState.resetResolution.id,
    }),
    undefined,
  )
  assert.equal(procedureState.round.roundNumber, 2)
  assert.equal(procedureState.players['0'].hasUsedMimicThisRound, false)
  assert.equal(canMimic(procedureState, '0'), true)
}

/**
 * The claim the whole character rests on: while the disguise stands, the ring draws the same thing
 * whichever way the coin fell.
 *
 * Both branches are built identically, run side by side through the same observable sequence of
 * turns, and compared chair by chair — chairs, not players, because the seats may have traded and
 * the table can only see chairs. Each comparison is made through `playerView` for an uninvolved
 * seat, so it is literally what a third party's client would render.
 *
 * The Reveal Rule is what this is really guarding. Left to itself it flips the borrowed pile on both
 * blocks at once, at whichever chair the source really sits in, which gives the answer away on the
 * next lap.
 */
function runMimeDisguiseSymmetryCheck() {
  const playerView = BlowCowGame.playerView as (args: { G: BlowCowState; playerID: string | null }) => BlowCowState

  const buildScenario = () => {
    const state = createScenarioState(3)
    state.players['0'].character = 'The Mime'
    state.players['0'].hand = [card('clubs_ace.png'), card('clubs_king.png')]
    state.players['1'].hand = [card('hearts_queen.png'), card('spades_king.png')]
    state.players['2'].hand = [card('diamonds_king.png')]
    // Both owe the table a reveal, which is the event whose timing the disguise has to rearrange.
    state.players['0'].pendingRevealPlayID = 'play-mime'
    state.players['1'].pendingRevealPlayID = 'play-source'
    state.table.plays = [
      {
        id: 'play-mime',
        playerID: '0',
        cards: [card('clubs_02.png')],
        declaredCardCount: 1,
        revealedCardIDs: [],
        rehiddenCardIDs: [],
        claimedRank: 'Q',
        playedAtRound: 1,
        playedAtTurn: 1,
        revealedAtTurn: null,
        wasTrumpSelection: false,
      },
      {
        id: 'play-source',
        playerID: '1',
        cards: [card('diamonds_02.png'), card('spades_03.png')],
        declaredCardCount: 2,
        revealedCardIDs: [],
        rehiddenCardIDs: [],
        claimedRank: 'Q',
        playedAtRound: 1,
        playedAtTurn: 2,
        revealedAtTurn: null,
        wasTrumpSelection: false,
      },
    ]

    return state
  }

  /*
   * The sprite a face-down card is drawn with is the card back, whatever it really is — see
   * `FrontCardRow`. Describing the drawn sprite rather than the underlying one is the point: in the
   * branch where the seats swapped the source really has revealed, so their faces are unmasked on
   * the wire while still being drawn face down. That is a difference a client could read out of its
   * own state and never one it puts on screen, which is the line this character draws throughout.
   */
  const describeRing = (state: BlowCowState) => {
    const view = playerView({ G: state, playerID: '2' })

    return view.seatOrder.map((seatID) => {
      return getDisplayedFrontCards(view.table.plays, seatID, view.mimicry ?? null)
        .map((frontCard) => (frontCard.faceDown ? `${CARD_BACK_SPRITE}(down)` : `${frontCard.card.sprite}(up)`))
        .join(',')
    })
  }

  const swapState = buildScenario()
  const stayState = buildScenario()
  const { events } = createEventRecorder()

  assert.equal(mimicMove({
    G: swapState,
    ctx: { currentPlayer: '0', turn: 3 },
    events,
    playerID: '0',
    random: { Shuffle: identityShuffle },
  }), undefined)
  assert.equal(mimicMove({
    G: stayState,
    ctx: { currentPlayer: '0', turn: 3 },
    events,
    playerID: '0',
    random: { Shuffle: reverseShuffle },
  }), undefined)
  assert.deepEqual(swapState.seatOrder, ['1', '0', '2'])
  assert.deepEqual(stayState.seatOrder, ['0', '1', '2'])

  // The swap hands the turn over, so its branch begins a turn the other never has to. Both leave
  // chair 1 acting, which is the only thing the table sees.
  beginTurn({ G: swapState, ctx: { currentPlayer: '1', turn: 4 }, events })

  assert.deepEqual(describeRing(swapState), describeRing(stayState))
  assert.ok(describeRing(swapState).every((chair) => !chair.includes('(up)')))

  let turnNumber = 5
  for (const chairIndex of [1, 2, 0, 1, 2, 0]) {
    beginTurn({ G: swapState, ctx: { currentPlayer: swapState.seatOrder[chairIndex], turn: turnNumber }, events })
    beginTurn({ G: stayState, ctx: { currentPlayer: stayState.seatOrder[chairIndex], turn: turnNumber }, events })
    turnNumber += 1

    assert.deepEqual(
      describeRing(swapState),
      describeRing(stayState),
      `The two branches drew different rings once the turn reached chair ${chairIndex + 1}.`,
    )
  }

  // And the reveal really did happen on both, so the comparison above was not two blank tables.
  assert.ok(describeRing(swapState).some((chair) => chair.includes('(up)')))
  assert.ok(describeRing(swapState).every((chair) => !chair.includes('(down)')))
}

function runClownCharacterCheck() {
  assert.ok(BLOW_COW_IMPLEMENTED_CHARACTER_NAMES.includes('The Clown'))

  const state = createScenarioState(3)
  const openerCard = card('hearts_king.png')
  const clownFirstCard = card('spades_king.png')
  const clownSecondCard = card('clubs_king.png')
  state.players['1'].character = 'The Clown'
  state.players['0'].hand = [openerCard]
  state.players['1'].hand = [clownFirstCard, clownSecondCard]
  state.players['2'].hand = [card('diamonds_king.png')]

  const { events, record } = createEventRecorder()

  // Player 0 opens the round, so the encore below has a real BS target to displace.
  assert.equal(
    selectTrumpAndPlayMove(
      { G: state, ctx: { currentPlayer: '0', turn: 1 }, events, playerID: '0' },
      { trumpRank: 'K', cardIDs: [openerCard.id] },
    ),
    undefined,
  )
  assert.equal(state.round.lastNonPassingPlayerID, '0')
  assert.equal(canEarnEncore(state, '1'), true)
  // Nobody else earns one, whatever they play.
  assert.equal(canEarnEncore(state, '2'), false)

  const clownContext = { G: state, ctx: { currentPlayer: '1', turn: 2 }, events, playerID: '1' }
  record.nextPlayerID = null
  assert.equal(playMove(clownContext, { cardIDs: [clownFirstCard.id] }), undefined)

  // The whole ability: the cards landed and the turn stayed where it was.
  assert.equal(record.nextPlayerID, null)
  assert.equal(state.encore?.playerID, '1')
  assert.equal(state.encore?.turnNumber, 2)
  assert.equal(state.players['1'].hasUsedClownEncoreThisRound, true)
  assert.equal(canEarnEncore(state, '1'), false)
  // An ordinary play in every other respect.
  assert.equal(state.round.lastNonPassingPlayerID, '1')
  assert.equal(state.round.passStreak, 0)
  assert.equal(getTableCardCount(state.table), 2)

  // Player 0 is no longer the latest non-passing player, and the encore is the only reason Call BS
  // still points anywhere at all.
  assert.equal(state.encore?.bsTargetPlayerID, '0')
  assert.equal(getEncoreBSTargetPlayerID(state, '1'), '0')
  assert.equal(getEncoreBSTargetPlayerID(state, '2'), null)
  assert.match(state.tableStatus, /still holds the turn/)
  assert.match(state.tableStatus, /Call BS/)
  // The status must not offer the one action the encore takes away.
  assert.doesNotMatch(state.tableStatus, /may Play/)

  // A second play is that one action, and it is refused with the hand untouched.
  assert.equal(playMove(clownContext, { cardIDs: [clownSecondCard.id] }), 'INVALID_MOVE')
  assert.deepEqual(state.players['1'].hand.map((handCard) => handCard.id), [clownSecondCard.id])
  assert.equal(getTableCardCount(state.table), 2)

  const playArchiveAction = state.archive.turns
    .flatMap((archiveTurn) => archiveTurn.actions)
    .find((action) => action.kind === 'play' && action.characterUsed === 'The Clown')
  assert.ok(playArchiveAction)
  assert.match(playArchiveAction?.detail ?? '', /keeps the turn/)

  // And the second action really is spendable on the remembered target.
  assert.equal(callBSMove(clownContext, { targetPlayerID: '0' }), undefined)
  assert.equal(state.bsResolution?.callerPlayerID, '1')
  assert.equal(state.bsResolution?.targetPlayerID, '0')

  /*
   * A round of its own for the Pass branch, which is how an encore is declined: there is no separate
   * end-turn action, so passing after playing is legal and counts as a pass like any other.
   */
  const passState = createScenarioState()
  const passClownCard = card('hearts_queen.png')
  const passOpponentCard = card('spades_queen.png')
  passState.players['0'].character = 'The Clown'
  // A card to spare, so the play below does not empty the hand and hand player 1 a Final Two
  // Players Rule turn on which Pass is not available in the first place.
  passState.players['0'].hand = [passClownCard, card('clubs_02.png')]
  passState.players['1'].hand = [passOpponentCard]

  const passRecorder = createEventRecorder()
  const passClownContext = {
    G: passState,
    ctx: { currentPlayer: '0', turn: 1 },
    events: passRecorder.events,
    playerID: '0',
  }

  // Opening the round, so there is nothing to challenge — the encore still lands, because Pass alone
  // is enough to make it worth having.
  assert.equal(
    selectTrumpAndPlayMove(passClownContext, { trumpRank: 'Q', cardIDs: [passClownCard.id] }),
    undefined,
  )
  assert.equal(passRecorder.record.nextPlayerID, null)
  assert.equal(passState.encore?.bsTargetPlayerID, null)

  assert.equal(passMove(passClownContext), undefined)
  assert.equal(passRecorder.record.nextPlayerID, '1')
  assert.equal(passState.round.passStreak, 1)

  // The record dies with the turn it belonged to, spent or not.
  beginTurn({ G: passState, ctx: { currentPlayer: '1', turn: 2 }, events: passRecorder.events })
  assert.equal(passState.encore, null)

  // Per round, not per match: everyone passing rolls the round over and hands the use back.
  assert.equal(
    passMove({ ...passClownContext, ctx: { currentPlayer: '1', turn: 2 }, playerID: '1' }),
    undefined,
  )
  assert.ok(passState.resetResolution)
  completeResetReveal(passState, passRecorder.events, 2)
  assert.equal(
    finalizeResetResolutionMove({
      G: passState,
      ctx: { currentPlayer: '1', turn: 2 },
      events: passRecorder.events,
      playerID: '1',
    }, {
      resolutionID: passState.resetResolution.id,
    }),
    undefined,
  )
  assert.equal(passState.round.roundNumber, 2)
  assert.equal(passState.players['0'].hasUsedClownEncoreThisRound, false)
  assert.equal(canEarnEncore(passState, '0'), true)

  /*
   * The other half of `isEncoreWorthTaking`, and the combination the ability is really for: a table
   * the encore's own play just filled leaves Call Reset, which is enough on its own. Pass removed and
   * the round only just opened, so nothing else is available to be doing the work here.
   */
  const resetState = createScenarioState()
  const resetClownCard = card('hearts_ace.png')
  resetState.rules.pass = 'removed'
  resetState.round.maxCardsOnTable = 1
  resetState.players['0'].character = 'The Clown'
  resetState.players['0'].hand = [resetClownCard, card('clubs_03.png')]
  resetState.players['1'].hand = [card('spades_ace.png')]

  const resetRecorder = createEventRecorder()
  const resetContext = {
    G: resetState,
    ctx: { currentPlayer: '0', turn: 1 },
    events: resetRecorder.events,
    playerID: '0',
  }
  assert.equal(
    selectTrumpAndPlayMove(resetContext, { trumpRank: 'A', cardIDs: [resetClownCard.id] }),
    undefined,
  )
  assert.equal(resetRecorder.record.nextPlayerID, null)
  assert.equal(resetState.encore?.bsTargetPlayerID, null)
  assert.equal(passMove(resetContext), 'INVALID_MOVE')
  assert.equal(callResetMove(resetContext), undefined)
  assert.equal(resetState.resetResolution?.callerPlayerID, '0')

  /*
   * An encore that buys nothing is refused outright, because a play is the one action it takes away:
   * granting it here would leave the turn with no legal move at all. Pass removed, nobody to
   * challenge, and a table nowhere near its cap is the only way all three doors close at once.
   */
  const strandedState = createScenarioState()
  const strandedCard = card('hearts_jack.png')
  strandedState.rules.pass = 'removed'
  strandedState.players['0'].character = 'The Clown'
  strandedState.players['0'].hand = [strandedCard]
  strandedState.players['1'].hand = [card('spades_jack.png')]

  const strandedRecorder = createEventRecorder()
  assert.equal(canEarnEncore(strandedState, '0'), true)
  assert.equal(
    selectTrumpAndPlayMove({
      G: strandedState,
      ctx: { currentPlayer: '0', turn: 1 },
      events: strandedRecorder.events,
      playerID: '0',
    }, {
      trumpRank: 'J',
      cardIDs: [strandedCard.id],
    }),
    undefined,
  )
  assert.equal(strandedState.encore, null)
  // Nothing was spent either, so the use is still there for a play that can carry it.
  assert.equal(strandedState.players['0'].hasUsedClownEncoreThisRound, false)
  assert.equal(strandedRecorder.record.nextPlayerID, '1')

  // A play by anybody else ends the turn exactly as it always did.
  const believerState = createScenarioState()
  const believerCard = card('hearts_10.png')
  believerState.players['0'].hand = [believerCard]
  believerState.players['1'].hand = [card('spades_08.png')]

  const believerRecorder = createEventRecorder()
  assert.equal(
    selectTrumpAndPlayMove({
      G: believerState,
      ctx: { currentPlayer: '0', turn: 1 },
      events: believerRecorder.events,
      playerID: '0',
    }, {
      trumpRank: '10',
      cardIDs: [believerCard.id],
    }),
    undefined,
  )
  assert.equal(believerState.encore, null)
  assert.equal(believerRecorder.record.nextPlayerID, '1')
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
  ['seeker rules', runSeekerRulesCheck],
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
  ['take back cheat', runTakeBackCheatCheck],
  ['no cheating rule', runNoCheatingRuleCheck],
  ['emotes', runEmoteCheck],
  ['direction flip tell', runDirectionFlipTellCheck],
  ['accusation rules', runAccusationRulesCheck],
  ['turn ownership guards', runTurnOwnershipCheck],
  ['spy rules', runSpyRulesCheck],
  ['characters disabled', runCharactersDisabledCheck],
  ['leave character effects', runLeaveCharacterEffectsCheck],
  ['staged start', runStagedStartCheck],
  ['manual rank selection', runManualRankSelectionCheck],
  ['setup validation', runSetupValidationCheck],
  ['rule cards', runRuleCardsCheck],
  ['removed rule enforcement', runRemovedRuleEnforcementCheck],
  ['broken character', runBrokenCharacterCheck],
  ['prototype character', runPrototypeCharacterCheck],
  ['mastermind character', runMastermindCharacterCheck],
  ['invisible hand character', runInvisibleHandCharacterCheck],
  ['poker hand evaluation', runPokerHandEvaluationCheck],
  ['gambler character', runGamblerCharacterCheck],
  ['mime character', runMimeCharacterCheck],
  ['mime disguise symmetry', runMimeDisguiseSymmetryCheck],
  ['clown character', runClownCharacterCheck],
] as const

for (const [label, runCheck] of checks) {
  runCheck()
  console.log(`PASS ${label}`)
}

console.log('All targeted Blow Cow gameplay checks passed.')
