/**
 * What an Ante bot seat does next: the learned round policy, turned into a boardgame.io move.
 *
 * The shape is the same as `src/bots/blowCowBotPolicy.ts` and for the same reason — **nothing here
 * decides an outcome.** The server is authoritative and every move below is validated there, so this
 * file's job is to be right about legality rather than to be trusted about it. The difference is what
 * chooses: a network rather than a hand-written rule, so the legality argument is carried by the
 * action mask, which is a port of `ActionSpace.legal_mask` in `rl/ante/spaces.py`.
 *
 * **Which agent it is depends on the room**, and `pickAnteWeights` in `anteWeights.ts` is where that
 * is decided — the match policy at the config it was trained for, the one-round policy otherwise.
 * This file does not branch on it. A match network is the same forward pass over a wider observation,
 * so the only difference here is the block appended in `decideAnteTurnAction`, gated on
 * `net.extraWidth` rather than on a flag naming a checkpoint.
 *
 * What the fallback costs is measured rather than guessed: the one-round policy plays every round as
 * if it were the only one, which is exactly what `RoundOnlyAgent` measures in
 * `rl/ante/match_agents.py`. It cannot see its own gold, so it plays a last coin the way it plays a
 * fifth and goes bankrupt in 18.1% of matches against match-trained agents where they go bankrupt in
 * 1.8%. There is no patch for that here — the one that used to stand made it worse, and the note
 * below the imports says how much.
 */
import {
  getActivePlayerIDs,
  isJokerCard,
  type BlowCowCard,
  type BlowCowRank,
  type BlowCowState,
} from '../../game/blowCowGame.ts'
import { getClientDefaultBSTargetSeatID } from '../../ui/bsTargeting.ts'
import { chooseProcedureMove, type BotMove } from '../blowCowBotPolicy.ts'
import { sampleAction, type AnteRoundNet } from './anteNet.ts'
import {
  buildAnteRoundView,
  buildTurnOrder,
  encodeAnteObservation,
  type AnteRoundView,
} from './anteObservation.ts'
import { buildAnteMatchView, encodeAnteMatchBlock } from './anteMatchObservation.ts'
import { CALL_BS_INDEX, PASS_INDEX, decomposeAction, type AnteActionSpace } from './anteSpaces.ts'

/*
 * **There is deliberately no gold guard here any more.** There used to be: below 2 gold the bot
 * declined any `Call BS` it was not 60% sure of, on the argument that a lost call at 1 gold is
 * elimination and the round policy cannot see its own gold to know that.
 *
 * The argument was backwards, and `guard:`/`guard-round:` in `rl/ante/match_agents.py` — which
 * transcribe exactly what stood here — are what measured it. Against a match policy it is a wash at
 * every seat count (|delta| <= 0.28 gold, sign flipping), which is unsurprising: that one holds gold
 * in its observation and was trained to price the last coin. Against the round policy it was *worse
 * than nothing* at four of six seat counts, replicated at two to three seeds: -2.8 gold at 5 seats
 * with bankruptcy going from ~2% to 33-41%, and 35% to 71% at 8.
 *
 * The mechanism is clean. Winning a challenge is the main way to take gold back, while being caught
 * lying costs gold whether or not you challenge — so refusing to challenge below 2 gold removes the
 * only route out of the hole and leaves every route into it open. It converted low gold into an
 * absorbing state, which is the exact opposite of what it was written to do. `rl/ANTE.md` has the
 * table. Do not reintroduce a clamp on this decision without measuring it the same way.
 */
/** The trump ranks that may be named: the ones in the deck, plus the off-deck representative. */
function trumpSlots(view: AnteRoundView): number[] {
  const slots: number[] = []
  for (let slot = 0; slot < view.activeRanks; slot += 1) slots.push(slot)
  // A slot for "some rank the deck does not hold" only exists while some rank does not hold.
  if (view.activeRanks < 13) slots.push(view.config.offDeckTrump)
  return slots
}

/** `ActionSpace.legal_mask`, built from the hand rather than by enumerating actions. */
export function buildAnteActionMask(space: AnteActionSpace, view: AnteRoundView): boolean[] {
  const mask = new Array<boolean>(space.size).fill(false)
  mask[PASS_INDEX] = true // Ante takes nothing away from Pass — no statuses, no locks.
  if (view.bsTarget !== null) mask[CALL_BS_INDEX] = true

  const playable: number[] = []
  for (let choiceIndex = 0; choiceIndex < space.numChoices; choiceIndex += 1) {
    const needs = space.choiceNeeds[choiceIndex]
    if (needs.every(({ cardType, count }) => view.hand[cardType] >= count)) playable.push(choiceIndex)
  }

  if (view.trump === null) {
    for (const slot of trumpSlots(view)) {
      const base = space.trumpOffset + slot * space.numChoices
      for (const choiceIndex of playable) mask[base + choiceIndex] = true
    }
  } else {
    for (const choiceIndex of playable) mask[space.playOffset + choiceIndex] = true
  }

  return mask
}

/**
 * Pick actual cards for a chosen multiset of card types.
 *
 * The policy chooses *types*, because two cards of one rank are interchangeable in Ante — no
 * characters, no action ranks, no suits that matter. Which physical copy goes down is therefore free,
 * and taking the first match keeps it deterministic.
 */
function selectCardIDs(
  hand: BlowCowCard[],
  choice: number[],
  rankSlots: Map<string, number>,
  jokerType: number,
): string[] | null {
  const taken = new Set<string>()
  const cardIDs: string[] = []
  for (const wantedType of choice) {
    const card = hand.find((candidate) => {
      if (taken.has(candidate.id)) return false
      const type = isJokerCard(candidate) ? jokerType : rankSlots.get(candidate.rank as string)
      return type === wantedType
    })
    if (!card) return null
    taken.add(card.id)
    cardIDs.push(card.id)
  }
  return cardIDs
}

export type AnteBotDecision = BotMove & {
  /** The critic's read on the round, for the dev log only. */
  value: number
}

/**
 * Decide one Ante turn action. Procedures (Take Turn, the Reveal Rule walk, the round-end reveal) are
 * handled by the shared `chooseProcedureMove` in `blowCowBotPolicy.ts` — they are not choices, and
 * Ante drives them through the same records the classic game does.
 */
export function decideAnteTurnAction(
  state: BlowCowState,
  net: AnteRoundNet,
  playerID: string,
  currentPlayerID: string,
  roundFirstTurn: number | null,
  currentTurn: number,
  rng: () => number = Math.random,
  temperature = 1,
): AnteBotDecision | null {
  const view = buildAnteRoundView(net.config, state, playerID, currentPlayerID, roundFirstTurn, currentTurn)
  if (!view) return null

  // A match policy reads the round's features and then a match block appended after them; a
  // one-round policy is the same call with `extraWidth` 0 and no block. The two are assembled here
  // rather than inside the round encoder so that file stays a straight transcription of the Python's
  // round encoder, exactly as `match_observation.py` appends rather than reworking.
  const roundObservation = encodeAnteObservation(view)
  let observation = roundObservation
  if (net.extraWidth > 0) {
    observation = new Float32Array(net.observationSize)
    observation.set(roundObservation, 0)
    encodeAnteMatchBlock(
      buildAnteMatchView(state, buildTurnOrder(state, playerID), net.config.numPlayers, playerID),
      observation,
      roundObservation.length,
    )
  }
  if (observation.length !== net.observationSize) return null

  const mask = buildAnteActionMask(net.space, view)
  const { logits, value } = net.forward(observation)

  const index = sampleAction(logits, mask, rng, temperature)
  const action = decomposeAction(net.space, index)

  if (action.kind === 'pass') {
    return { move: 'pass', args: [{}], reason: 'passed', value }
  }

  if (action.kind === 'callBS') {
    const targetPlayerID = getClientDefaultBSTargetSeatID(state, playerID)
    if (!targetPlayerID) return { move: 'pass', args: [{}], reason: 'no BS target after all', value }
    return { move: 'callBS', args: [{ targetPlayerID }], reason: 'called BS', value }
  }

  const selectedRanks = state.deckConfig.selectedRanks ?? []
  const rankSlots = new Map<string, number>(selectedRanks.map((rank, i) => [rank as string, i]))
  const hand = state.players[playerID]?.hand ?? []
  const cardIDs = selectCardIDs(hand, action.choice, rankSlots, net.config.jokerType)
  // The mask is built from the same hand, so this cannot fail — but a refused move is silent on a
  // real table, so the bot passes rather than sending something the server will drop on the floor.
  if (!cardIDs) return { move: 'pass', args: [{}], reason: 'could not find the cards it chose', value }

  if (action.trumpSlot === null) {
    return { move: 'play', args: [{ cardIDs }], reason: 'played', value }
  }

  const trumpRank = pickTrumpRank(action.trumpSlot, selectedRanks, view)
  if (!trumpRank) return { move: 'pass', args: [{}], reason: 'no trump rank available', value }
  return {
    move: 'selectTrumpAndPlay',
    args: [{ trumpRank, cardIDs }],
    reason: `named ${trumpRank} and played`,
    value,
  }
}

/**
 * The rank a trump slot names.
 *
 * Slots below `activeRanks` are the deck's own ranks. The off-deck slot stands for every standard
 * rank the deck does not hold — all of them are the same move, so any one will do, and the first
 * missing rank in the canonical order is the stable choice.
 */
const ALL_RANKS: BlowCowRank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']

function pickTrumpRank(
  slot: number,
  selectedRanks: readonly BlowCowRank[],
  view: AnteRoundView,
): BlowCowRank | null {
  if (slot < view.activeRanks) return selectedRanks[slot] ?? null
  const inDeck = new Set<string>(selectedRanks as string[])
  return ALL_RANKS.find((rank) => !inDeck.has(rank)) ?? null
}

/**
 * One Ante bot seat's next move, procedures included.
 *
 * The guards are `decideBotMove`'s, in the same order and for the same reasons, and the procedure
 * step is literally that file's — only the turn action is decided differently.
 */
export function decideAnteBotMove(
  state: BlowCowState,
  currentPlayerID: string,
  playerID: string,
  net: AnteRoundNet,
  roundFirstTurn: number | null,
  currentTurn: number,
  rng: () => number = Math.random,
  /** Raised only by `scripts/check-ante-bot-play.ts`, to flatten this policy into a random one. */
  temperature = 1,
): BotMove | null {
  if (state.gameStatus !== 'active') return null

  const player = state.players[playerID]
  if (!player || player.hasLeft) return null

  const procedure = chooseProcedureMove(state, playerID)
  if (procedure) return procedure

  // A procedure somebody else is driving holds the whole table, this seat included. Ante's two
  // non-BS round endings walk the Reset resolution, which is why that one is listed here too.
  if (state.bsResolution || state.resetResolution || state.accusation) return null

  if (currentPlayerID !== playerID) return null

  // The turn has to be open before it can be spent; `chooseProcedureMove` opens it.
  if (state.turnOpening && state.turnOpening.playerID === playerID && !state.turnOpening.isTaken) {
    return null
  }

  return decideAnteTurnAction(
    state, net, playerID, currentPlayerID, roundFirstTurn, currentTurn, rng, temperature,
  )
}

/** Whether this match is one the shipped checkpoint can actually play. */
export function getAnteBotBlockReason(state: BlowCowState, net: AnteRoundNet): string | null {
  const seats = getActivePlayerIDs(state).length
  if (seats !== net.config.numPlayers) {
    return `The Ante agent was trained for ${net.config.numPlayers} seats, not ${seats}.`
  }
  const ranks = (state.deckConfig.selectedRanks ?? []).length
  if (ranks !== net.config.numRanks) {
    return `The Ante agent was trained on a ${net.config.numRanks}-rank deck, not ${ranks}.`
  }
  return null
}
