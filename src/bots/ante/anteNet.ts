/**
 * The Ante round policy, run in the browser.
 *
 * A port of `AnteNet._compute` in `rl/ante/nets.py`, tensor for tensor and in the same order. It is
 * plain `Float32Array` arithmetic with no dependency, because the network is small — 176k parameters,
 * one 208-wide trunk — and a matrix library would be more surface area than the thirty lines of
 * matmul it would replace.
 *
 * **Why the architecture has to be ported rather than flattened.** The action head is factored: a
 * trump-play logit is a per-slot logit plus a per-choice logit plus a learned gate over a static
 * table. Collapsing that into one dense head is not possible without retraining, and evaluating it
 * in the wrong order is the kind of bug that produces a *weaker* bot rather than a broken one — which
 * is why `scripts/check-ante-bot.ts` holds every logit here to the Python network's own output.
 *
 * The weights are fetched once and cached. Nothing here is on a hot path: a bot decides one move
 * every 900ms.
 */
import {
  STATIC_FEATURES,
  buildPairIndices,
  buildStaticTable,
  createActionSpace,
  createAnteConfig,
  type AnteActionSpace,
  type AnteConfig,
} from './anteSpaces.ts'

type TensorSpec = { name: string; offset: number; shape: number[] }

export type AnteRoundManifest = {
  format: string
  source: string
  steps: number
  numPlayers: number
  numRanks: number
  hidden: number
  typeDim: number
  headDim: number
  /**
   * The match block appended after the round's features — 0 for a one-round policy, `18 + 16n` for a
   * match policy at `n` seats. Nothing in the forward pass branches on it, because the block rides
   * into the trunk with the seat and event rows and `observationSize` already carries the sum; it is
   * here so a caller can tell which kind of observation to build.
   */
  extraWidth?: number
  /** `value_scale` from the checkpoint. Absent on manifests written before match policies, where it was 1.0. */
  valueScale?: number
  /** The match config the policy was trained at, or null for a one-round policy. */
  roundLimit?: number | null
  startingGold?: number | null
  observationSize: number
  actionSize: number
  floats: number
  tensors: TensorSpec[]
}

/** A weight matrix as PyTorch stores it: `(out, in)`, row-major. */
type Linear = { weight: Float32Array; bias: Float32Array; inputs: number; outputs: number }

export type AnteRoundNet = {
  config: AnteConfig
  space: AnteActionSpace
  observationSize: number
  actionSize: number
  /** 0 for a one-round policy; the match block's width for a match policy. */
  extraWidth: number
  /** Which checkpoint this is, for the dev log. */
  source: string
  steps: number
  forward: (observation: Float32Array) => { logits: Float32Array; value: number }
}

function readTensor(blob: Float32Array, spec: TensorSpec): Float32Array {
  const count = spec.shape.reduce((product, size) => product * size, 1)
  return blob.subarray(spec.offset, spec.offset + count)
}

function readLinear(blob: Float32Array, specs: Map<string, TensorSpec>, prefix: string): Linear {
  const weightSpec = specs.get(`${prefix}.weight`)
  const biasSpec = specs.get(`${prefix}.bias`)
  if (!weightSpec || !biasSpec) throw new Error(`ante weights are missing ${prefix}`)
  const [outputs, inputs] = weightSpec.shape
  return {
    weight: readTensor(blob, weightSpec),
    bias: readTensor(blob, biasSpec),
    inputs,
    outputs,
  }
}

/** `y = x @ W.T + b`, reading `x` from `input` at `inputOffset`. */
function linear(layer: Linear, input: Float32Array, inputOffset: number, out: Float32Array, outOffset: number) {
  for (let row = 0; row < layer.outputs; row += 1) {
    let sum = layer.bias[row]
    const base = row * layer.inputs
    for (let column = 0; column < layer.inputs; column += 1) {
      sum += layer.weight[base + column] * input[inputOffset + column]
    }
    out[outOffset + row] = sum
  }
}

function relu(values: Float32Array, offset: number, count: number) {
  for (let index = offset; index < offset + count; index += 1) {
    if (values[index] < 0) values[index] = 0
  }
}

export function createAnteRoundNet(manifest: AnteRoundManifest, blob: Float32Array): AnteRoundNet {
  if (manifest.format !== 'ante-round-policy/1') {
    throw new Error(`unknown ante weight format ${manifest.format}`)
  }
  if (blob.length !== manifest.floats) {
    throw new Error(`ante weights are ${blob.length} floats, manifest says ${manifest.floats}`)
  }

  const config = createAnteConfig(manifest.numPlayers, manifest.numRanks)
  const space = createActionSpace(config)
  if (space.size !== manifest.actionSize) {
    throw new Error(`action space is ${space.size}, checkpoint was trained on ${manifest.actionSize}`)
  }

  const specs = new Map(manifest.tensors.map((spec) => [spec.name, spec]))
  const typeEncoder0 = readLinear(blob, specs, 'type_encoder.0')
  const typeEncoder2 = readLinear(blob, specs, 'type_encoder.2')
  const trunk0 = readLinear(blob, specs, 'trunk.0')
  const trunk2 = readLinear(blob, specs, 'trunk.2')
  const context = readLinear(blob, specs, 'context')
  const simpleHead = readLinear(blob, specs, 'simple_head')
  const singleHead0 = readLinear(blob, specs, 'single_head.0')
  const singleHead2 = readLinear(blob, specs, 'single_head.2')
  const pairHead0 = readLinear(blob, specs, 'pair_head.0')
  const pairHead2 = readLinear(blob, specs, 'pair_head.2')
  const slotHead0 = readLinear(blob, specs, 'slot_head.0')
  const slotHead2 = readLinear(blob, specs, 'slot_head.2')
  const staticGate = readLinear(blob, specs, 'static_gate')
  const valueHead0 = readLinear(blob, specs, 'value_head.0')
  const valueHead2 = readLinear(blob, specs, 'value_head.2')
  const offDeckSlotSpec = specs.get('off_deck_slot')
  if (!offDeckSlotSpec) throw new Error('ante weights are missing off_deck_slot')
  const offDeckSlot = readTensor(blob, offDeckSlotSpec)

  const typeDim = manifest.typeDim
  const headDim = manifest.headDim
  // Absent from manifests written before match policies existed, where it was always 1.0.
  const valueScale = manifest.valueScale ?? 1.0
  const hidden = manifest.hidden
  const numTypes = config.numTypes
  const typeWidth = trunk0.inputs === 0 ? 0 : typeEncoder0.inputs
  const globalWidth = 16
  const numSlots = config.numTrumpSlots
  const numChoices = space.numChoices

  const staticTable = buildStaticTable(config, space)
  const pairs = buildPairIndices(numTypes)

  // Scratch, allocated once. A bot decides one move at a time on a timer, so there is never a second
  // call in flight and reusing these is safe.
  const embeddings = new Float32Array(numTypes * typeDim)
  const typeScratch = new Float32Array(typeDim)
  const trunkInput = new Float32Array(trunk0.inputs)
  const hidden1 = new Float32Array(hidden)
  const hidden2 = new Float32Array(hidden)
  const contextVector = new Float32Array(headDim)
  const headInput = new Float32Array(headDim + 2 * typeDim)
  const headScratch = new Float32Array(headDim)
  const playLogits = new Float32Array(numChoices)
  const trumpChoiceLogits = new Float32Array(numChoices)
  const slotLogits = new Float32Array(numSlots)
  const gate = new Float32Array(STATIC_FEATURES)
  const logits = new Float32Array(space.size)
  const valueScratch = new Float32Array(headDim)
  const pairOffset = numTypes

  function forward(observation: Float32Array) {
    if (observation.length !== manifest.observationSize) {
      throw new Error(`observation is ${observation.length} wide, expected ${manifest.observationSize}`)
    }

    // -- the shared encoder over the card-type rows ------------------------
    for (let cardType = 0; cardType < numTypes; cardType += 1) {
      const rowOffset = globalWidth + cardType * typeWidth
      linear(typeEncoder0, observation, rowOffset, typeScratch, 0)
      relu(typeScratch, 0, typeDim)
      linear(typeEncoder2, typeScratch, 0, embeddings, cardType * typeDim)
    }

    // -- trunk: globals, the pooled type rows, then everything else --------
    trunkInput.set(observation.subarray(0, globalWidth), 0)
    for (let unit = 0; unit < typeDim; unit += 1) {
      let sum = 0
      let max = -Infinity
      for (let cardType = 0; cardType < numTypes; cardType += 1) {
        const value = embeddings[cardType * typeDim + unit]
        sum += value
        if (value > max) max = value
      }
      trunkInput[globalWidth + unit] = sum / numTypes
      trunkInput[globalWidth + typeDim + unit] = max
    }
    const restOffset = globalWidth + numTypes * typeWidth
    trunkInput.set(observation.subarray(restOffset), globalWidth + 2 * typeDim)

    linear(trunk0, trunkInput, 0, hidden1, 0)
    relu(hidden1, 0, hidden)
    linear(trunk2, hidden1, 0, hidden2, 0)
    relu(hidden2, 0, hidden)
    linear(context, hidden2, 0, contextVector, 0)

    // -- Pass and Call BS --------------------------------------------------
    linear(simpleHead, hidden2, 0, logits, 0)

    // -- one card of a type -----------------------------------------------
    headInput.set(contextVector, 0)
    for (let cardType = 0; cardType < numTypes; cardType += 1) {
      for (let unit = 0; unit < typeDim; unit += 1) {
        headInput[headDim + unit] = embeddings[cardType * typeDim + unit]
      }
      linear(singleHead0, headInput, 0, headScratch, 0)
      relu(headScratch, 0, headDim)
      // Two outputs: a plain `Play`, and the choice half of a trump-selecting one.
      const pair = new Float32Array(2)
      linear(singleHead2, headScratch, 0, pair, 0)
      playLogits[cardType] = pair[0]
      trumpChoiceLogits[cardType] = pair[1]
    }

    // -- two cards, symmetric in the pair because a choice is a multiset ----
    for (let index = 0; index < pairs.left.length; index += 1) {
      const leftBase = pairs.left[index] * typeDim
      const rightBase = pairs.right[index] * typeDim
      for (let unit = 0; unit < typeDim; unit += 1) {
        const leftValue = embeddings[leftBase + unit]
        const rightValue = embeddings[rightBase + unit]
        headInput[headDim + unit] = leftValue + rightValue
        headInput[headDim + typeDim + unit] = leftValue * rightValue
      }
      linear(pairHead0, headInput, 0, headScratch, 0)
      relu(headScratch, 0, headDim)
      const pair = new Float32Array(2)
      linear(pairHead2, headScratch, 0, pair, 0)
      playLogits[pairOffset + index] = pair[0]
      trumpChoiceLogits[pairOffset + index] = pair[1]
    }

    // -- one logit per trump slot -----------------------------------------
    for (let slot = 0; slot < numSlots; slot += 1) {
      if (slot < config.numRanks) {
        for (let unit = 0; unit < typeDim; unit += 1) {
          headInput[headDim + unit] = embeddings[slot * typeDim + unit]
        }
      } else {
        // The off-deck representative has no card type to embed, so it carries its own parameter.
        for (let unit = 0; unit < typeDim; unit += 1) headInput[headDim + unit] = offDeckSlot[unit]
      }
      linear(slotHead0, headInput, 0, headScratch, 0)
      relu(headScratch, 0, headDim)
      const one = new Float32Array(1)
      linear(slotHead2, headScratch, 0, one, 0)
      slotLogits[slot] = one[0]
    }

    // -- assemble ----------------------------------------------------------
    logits.set(playLogits, space.playOffset)
    linear(staticGate, hidden2, 0, gate, 0)
    for (let slot = 0; slot < numSlots; slot += 1) {
      const slotLogit = slotLogits[slot]
      for (let choice = 0; choice < numChoices; choice += 1) {
        const staticBase = (slot * numChoices + choice) * STATIC_FEATURES
        let interaction = 0
        for (let feature = 0; feature < STATIC_FEATURES; feature += 1) {
          interaction += gate[feature] * staticTable[staticBase + feature]
        }
        logits[space.trumpOffset + slot * numChoices + choice] =
          slotLogit + trumpChoiceLogits[choice] + interaction
      }
    }

    linear(valueHead0, hidden2, 0, valueScratch, 0)
    relu(valueScratch, 0, headDim)
    const value = new Float32Array(1)
    linear(valueHead2, valueScratch, 0, value, 0)

    // `value_scale * tanh(...)`, matching `AnteNet.forward`. The scale is a plain attribute rather
    // than a learned tensor, so it comes from the manifest; it is 1.0 for every one-round policy,
    // which is why this read as a bare tanh for as long as only those shipped, and it is the round
    // limit (20, or 23 with a placement weight) for a match policy.
    return { logits, value: valueScale * Math.tanh(value[0]) }
  }

  return {
    config,
    space,
    observationSize: manifest.observationSize,
    actionSize: manifest.actionSize,
    extraWidth: manifest.extraWidth ?? 0,
    source: manifest.source,
    steps: manifest.steps,
    forward,
  }
}

/**
 * Pick an action from masked logits.
 *
 * Softmax over the legal set only, sampled — the training-time behaviour, and the right one for an
 * opponent: a greedy Ante policy is deterministic given the table, and a human would read it inside
 * two rounds. `temperature <= 0` is greedy, kept for the conformance harness which needs a
 * reproducible answer.
 */
export function sampleAction(
  logits: Float32Array,
  mask: boolean[],
  random: () => number,
  temperature = 1,
): number {
  let best = -1
  let bestLogit = -Infinity
  for (let index = 0; index < logits.length; index += 1) {
    if (mask[index] && logits[index] > bestLogit) {
      bestLogit = logits[index]
      best = index
    }
  }
  if (best < 0) throw new Error('no legal ante action')
  if (temperature <= 0) return best

  let total = 0
  const weights = new Float64Array(logits.length)
  for (let index = 0; index < logits.length; index += 1) {
    if (!mask[index]) continue
    // Shifted by the max before exponentiating, so a confident policy cannot overflow to NaN.
    const weight = Math.exp((logits[index] - bestLogit) / temperature)
    weights[index] = weight
    total += weight
  }
  if (!(total > 0)) return best

  let target = random() * total
  for (let index = 0; index < logits.length; index += 1) {
    if (!mask[index]) continue
    target -= weights[index]
    if (target <= 0) return index
  }
  return best
}
