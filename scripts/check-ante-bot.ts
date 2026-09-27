/**
 * Holds the browser Ante bot to the Python package it was ported from.
 *
 * The risk this exists for is stated in `src/bots/blowCowBotTypes.ts`: running a trained checkpoint
 * in the client needs the model exported *and* the observation encoder and the action space
 * re-implemented in TypeScript, "faithfully enough that a mismatch would not silently produce a
 * weaker bot". A weaker bot is exactly what a wrong feature or a transposed matmul yields — it plays
 * legal moves, badly, and nothing raises. So the port is checked against fixtures rather than argued
 * about.
 *
 * Three layers, each held to the one below it:
 *
 * * **network** — every logit and the value, over random observations, against the real `AnteNet`.
 * * **encoder** — every one of the 200 features and every mask bit, over positions from real
 *   rollouts, against `ObservationEncoder` and `ActionSpace.legal_mask`.
 * * **spaces** — the flat action space's own arithmetic, by enumeration.
 *
 * Regenerate the fixtures with::
 *
 *     python rl/dump_ante_bot_cases.py --out rl/runs/_check/ante-bot-cases.json
 *
 * Then run::
 *
 *     npm run check:ante:bot
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { createAnteRoundNet } from '../src/bots/ante/anteNet.ts'
import {
  encodeAnteObservation,
  observationSize,
  type AnteRoundView,
} from '../src/bots/ante/anteObservation.ts'
import { buildAnteActionMask } from '../src/bots/ante/anteBotPolicy.ts'
import { encodeAnteMatchBlock, matchBlockWidth } from '../src/bots/ante/anteMatchObservation.ts'
import {
  buildChoices,
  createActionSpace,
  createAnteConfig,
  decomposeAction,
  type AnteConfig,
} from '../src/bots/ante/anteSpaces.ts'

/** Reads `--weights <prefix>` and `--fixtures <path>` off argv, defaulting to the 5-seat pair. */
function argValue(flag: string, fallback: string): string {
  const index = process.argv.indexOf(flag)
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback
}

const WEIGHT_PREFIX = argValue('--weights', 'model_weights/ante-round')
const FIXTURES = resolve(process.cwd(), argValue('--fixtures', 'rl/runs/_check/ante-bot-cases.json'))
const MANIFEST = resolve(process.cwd(), `${WEIGHT_PREFIX}.json`)
const WEIGHTS = resolve(process.cwd(), `${WEIGHT_PREFIX}.bin`)

type NetworkCase = { observation: number[]; logits: number[]; value: number }
type RoundDescription = {
  numPlayers: number
  activeRanks: number
  copies: number[]
  viewer: number
  current: number
  trump: number | null
  passStreak: number
  lastNonPassing: number | null
  turn: number
  hand: number[]
  handSizes: number[]
  bsTarget: number | null
  table: { seat: number; types: number[] | null; size: number; revealed: boolean }[]
  events: { seat: number; kind: 'play' | 'pass' | 'reveal'; size: number }[]
}
type EncoderCase = { round: RoundDescription; observation: number[]; mask: boolean[] | null }

type Fixtures = {
  checkpoint: string
  numPlayers: number
  numRanks: number
  observationSize: number
  actionSize: number
  network: NetworkCase[]
  encoder: EncoderCase[]
  /** Match-block cases; empty for a one-round checkpoint. */
  matchEncoder?: MatchEncoderCase[]
}

let failures = 0

/**
 * One match-block position: the view a client would build out of `G`, and the 98 features
 * `ante/match_observation.py` produced from the same state. The seat rows arrive already ordered, so
 * a disagreement about *seating* surfaces here as a feature mismatch rather than silently handing
 * the network somebody else's honesty record.
 */
type MatchSeatCase = {
  gold: number
  isEliminated: boolean
  record: {
    lies: number
    honest: number
    callsMade: number
    callsWon: number
    roundsWon: number
    bsLosses: number
  }
}

type MatchEncoderCase = {
  numSeats: number
  roundNumber: number
  roundLimit: number
  startingGold: number
  seats: MatchSeatCase[]
  /** The seat doing the looking. Not `seats[0]` — see `AnteMatchView.viewer`. */
  viewer: MatchSeatCase
  viewerRowIndex: number
  match: number[]
}

function report(name: string, detail: string, ok: boolean) {
  const status = ok ? '  ' : 'X '
  console.log(`${status}${name.padEnd(24)} ${detail}`)
  if (!ok) failures += 1
}

/**
 * The fixture's seats are absolute; the view's are relative to the viewer, because that is how the
 * observation's per-seat rows are defined. Rotating here rather than in the encoder is what keeps
 * the encoder a straight transcription of the Python.
 */
function toView(config: AnteConfig, description: RoundDescription): AnteRoundView {
  const n = description.numPlayers
  const relative = (seat: number | null) => (seat === null ? null : (seat - description.viewer + n) % n)

  const handSizes = new Array<number>(n).fill(0)
  for (let seat = 0; seat < n; seat += 1) {
    handSizes[(seat - description.viewer + n) % n] = description.handSizes[seat]
  }

  return {
    config,
    numPlayers: n,
    activeRanks: description.activeRanks,
    copies: description.copies,
    viewer: 0,
    current: relative(description.current) ?? 0,
    trump: description.trump,
    passStreak: description.passStreak,
    lastNonPassing: relative(description.lastNonPassing),
    turn: description.turn,
    hand: description.hand,
    handSizes,
    table: description.table.map((play) => ({ ...play, seat: relative(play.seat) as number })),
    events: description.events.map((event) => ({ ...event, seat: relative(event.seat) as number })),
    bsTarget: relative(description.bsTarget),
  }
}

function checkSpaces(config: AnteConfig) {
  const space = createActionSpace(config)
  const choices = buildChoices(config.numTypes)
  let mismatches = 0

  // Every index round-trips through decompose, and the choice order is the one the head was trained
  // against — a rearranged choice list would silently relabel 352 of the 398 logits.
  for (let index = 0; index < space.size; index += 1) {
    const action = decomposeAction(space, index)
    if (index === 0 && action.kind !== 'pass') mismatches += 1
    if (index === 1 && action.kind !== 'callBS') mismatches += 1
    if (index >= 2 && action.kind !== 'play') mismatches += 1
    if (action.kind === 'play') {
      const expectedIndex = action.trumpSlot === null
        ? space.playOffset + choices.findIndex((c) => sameChoice(c, action.choice))
        : space.trumpOffset + action.trumpSlot * space.numChoices
          + choices.findIndex((c) => sameChoice(c, action.choice))
      if (expectedIndex !== index) mismatches += 1
    }
  }

  // The width is the config's, not a constant: 398 at five seats, 72 at two. What is invariant is
  // the round-trip and the choice order, plus the width agreeing with the checkpoint's own count.
  report(
    'action space',
    `${space.size} indices round-tripped, ${space.numChoices} choices, ${config.numTrumpSlots} slots`,
    mismatches === 0 && space.size === 2 + space.numChoices * (1 + config.numTrumpSlots),
  )
}

function sameChoice(left: number[], right: number[]) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function main() {
  if (!existsSync(FIXTURES)) {
    console.error(`no fixtures at ${FIXTURES}`)
    console.error('run: python rl/dump_ante_bot_cases.py --out rl/runs/_check/ante-bot-cases.json')
    process.exit(2)
  }

  const fixtures = JSON.parse(readFileSync(FIXTURES, 'utf-8')) as Fixtures
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf-8'))
  const blob = new Float32Array(
    readFileSync(WEIGHTS).buffer.slice(
      readFileSync(WEIGHTS).byteOffset,
      readFileSync(WEIGHTS).byteOffset + readFileSync(WEIGHTS).byteLength,
    ),
  )
  const net = createAnteRoundNet(manifest, blob)
  const config = createAnteConfig(fixtures.numPlayers, fixtures.numRanks)

  console.log(
    `Ante bot port: ${fixtures.numPlayers}p/${fixtures.numRanks}r, `
    + `obs ${fixtures.observationSize}, actions ${fixtures.actionSize}`,
  )
  console.log(`  weights ${manifest.source} @ ${manifest.steps} steps`)

  checkSpaces(config)

  // -- the network --------------------------------------------------------
  // float32 accumulated in a different order on each side, so this is a tolerance and not equality.
  // 2e-3 is far below the gap between competing logits; a real porting bug moves them by whole units.
  let worstLogit = 0
  let worstValue = 0
  let worstArgmax = 0
  for (const testCase of fixtures.network) {
    const { logits, value } = net.forward(Float32Array.from(testCase.observation))
    for (let index = 0; index < logits.length; index += 1) {
      worstLogit = Math.max(worstLogit, Math.abs(logits[index] - testCase.logits[index]))
    }
    worstValue = Math.max(worstValue, Math.abs(value - testCase.value))
    const ours = argmax([...logits])
    const theirs = argmax(testCase.logits)
    if (ours !== theirs) worstArgmax += 1
  }
  report(
    'network',
    `${fixtures.network.length} observations, max logit delta ${worstLogit.toExponential(2)}, `
    + `max value delta ${worstValue.toExponential(2)}, ${worstArgmax} argmax disagreements`,
    worstLogit < 2e-3 && worstValue < 2e-3 && worstArgmax === 0,
  )

  // -- the observation encoder --------------------------------------------
  let worstFeature = 0
  let worstFeatureName = ''
  let maskMismatches = 0
  let maskedCases = 0
  const space = createActionSpace(config)
  for (const testCase of fixtures.encoder) {
    const view = toView(config, testCase.round)
    const ours = encodeAnteObservation(view)
    if (ours.length !== testCase.observation.length) {
      report('encoder', `width ${ours.length} against ${testCase.observation.length}`, false)
      return finish()
    }
    for (let index = 0; index < ours.length; index += 1) {
      const delta = Math.abs(ours[index] - testCase.observation[index])
      if (delta > worstFeature) {
        worstFeature = delta
        worstFeatureName = `feature ${index}`
      }
    }
    if (testCase.mask) {
      maskedCases += 1
      const mask = buildAnteActionMask(space, view)
      for (let index = 0; index < mask.length; index += 1) {
        if (mask[index] !== testCase.mask[index]) maskMismatches += 1
      }
    }
  }
  report(
    'observation',
    `${fixtures.encoder.length} positions x ${observationSize(config)} features, `
    + `max delta ${worstFeature.toExponential(2)}${worstFeature > 1e-6 ? ` at ${worstFeatureName}` : ''}`,
    worstFeature < 1e-6,
  )
  report(
    'legal mask',
    `${maskedCases} on-the-clock positions, ${maskMismatches} bit(s) disagreed`,
    maskMismatches === 0,
  )

  // -- the match block ------------------------------------------------------
  // Only a match checkpoint has these. The round port is held to 1e-6 across every feature and this
  // is held to the same bar, because the failure it guards against is not a crash: a wrong honesty
  // or gold column produces a bot that plays legally and badly, which nothing else here would catch.
  const matchCases = fixtures.matchEncoder ?? []
  if (matchCases.length > 0) {
    let worstMatch = 0
    let worstMatchIndex = -1
    for (const testCase of matchCases) {
      const width = matchBlockWidth(testCase.numSeats)
      if (width !== testCase.match.length) {
        report('match block', `width ${width} against ${testCase.match.length}`, false)
        break
      }
      const ours = new Float32Array(width)
      encodeAnteMatchBlock(
        {
          numSeats: testCase.numSeats,
          roundNumber: testCase.roundNumber,
          roundLimit: testCase.roundLimit,
          startingGold: testCase.startingGold,
          seats: testCase.seats.map((seat) => ({
            gold: seat.gold,
            isEliminated: seat.isEliminated,
            record: seat.record,
          })),
          viewer: testCase.viewer,
          viewerRowIndex: testCase.viewerRowIndex,
        },
        ours,
        0,
      )
      for (let index = 0; index < width; index += 1) {
        const delta = Math.abs(ours[index] - testCase.match[index])
        if (delta > worstMatch) {
          worstMatch = delta
          worstMatchIndex = index
        }
      }
    }
    report(
      'match block',
      `${matchCases.length} positions x ${matchBlockWidth(matchCases[0].numSeats)} features, `
      + `max delta ${worstMatch.toExponential(2)}`
      + (worstMatch > 1e-6 ? ` at column ${worstMatchIndex}` : ''),
      worstMatch < 1e-6,
    )
  }

  finish()
}

function argmax(values: number[]) {
  let best = 0
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] > values[best]) best = index
  }
  return best
}

function finish() {
  if (failures > 0) {
    console.log(`\n${failures} check(s) failed`)
    process.exit(1)
  }
  console.log('\nOK')
}

main()
