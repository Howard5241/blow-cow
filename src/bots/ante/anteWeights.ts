/**
 * Fetching the Ante policy's weights, once per tab.
 *
 * The blob is 707KB and only a room that actually seats an Ante bot needs it, so it is loaded lazily
 * and cached as a promise — several bots seated at once share one fetch rather than racing.
 *
 * `model_weights/` sits at the repo root beside `card_sprites/` and the other asset folders, for the
 * same reason they do: it is an artifact, not source. It is produced by `rl/export_ante_round.py`.
 */
import { createAnteRoundNet, type AnteRoundNet, type AnteRoundManifest } from './anteNet.ts'
import { ANTE_AGENT_SUPPORTED_SEATS } from './anteSpaces.ts'

import manifest5 from '../../../model_weights/ante-round.json'
import weights5URL from '../../../model_weights/ante-round.bin?url'
import manifest2 from '../../../model_weights/ante-round-2p.json'
import weights2URL from '../../../model_weights/ante-round-2p.bin?url'
import manifest3 from '../../../model_weights/ante-round-3p.json'
import weights3URL from '../../../model_weights/ante-round-3p.bin?url'
import manifest4 from '../../../model_weights/ante-round-4p.json'
import weights4URL from '../../../model_weights/ante-round-4p.bin?url'
import manifest6 from '../../../model_weights/ante-round-6p.json'
import weights6URL from '../../../model_weights/ante-round-6p.bin?url'
import manifest7 from '../../../model_weights/ante-round-7p.json'
import weights7URL from '../../../model_weights/ante-round-7p.bin?url'
import manifest8 from '../../../model_weights/ante-round-8p.json'
import weights8URL from '../../../model_weights/ante-round-8p.bin?url'

import matchManifest5 from '../../../model_weights/ante-match.json'
import matchWeights5URL from '../../../model_weights/ante-match.bin?url'
import matchManifest2 from '../../../model_weights/ante-match-2p.json'
import matchWeights2URL from '../../../model_weights/ante-match-2p.bin?url'
import matchManifest3 from '../../../model_weights/ante-match-3p.json'
import matchWeights3URL from '../../../model_weights/ante-match-3p.bin?url'
import matchManifest4 from '../../../model_weights/ante-match-4p.json'
import matchWeights4URL from '../../../model_weights/ante-match-4p.bin?url'
import matchManifest6 from '../../../model_weights/ante-match-6p.json'
import matchWeights6URL from '../../../model_weights/ante-match-6p.bin?url'
import matchManifest7 from '../../../model_weights/ante-match-7p.json'
import matchWeights7URL from '../../../model_weights/ante-match-7p.bin?url'
import matchManifest8 from '../../../model_weights/ante-match-8p.json'
import matchWeights8URL from '../../../model_weights/ante-match-8p.bin?url'

/**
 * The seat counts a trained network exists for, and the asset pair that carries each one. The
 * default 5-seat weights ship with the app and are imported statically. Any other seat count is
 * registered here once its checkpoint has been exported by `rl/export_ante_round.py` to
 * `model_weights/ante-round-<n>p.{json,bin}` and given a matching static import. A count with no
 * entry has no network, and `loadAnteRoundNet` says so rather than fetching a 404 as weights.
 *
 * The seat list lives in `anteSpaces.ts` rather than being read off this table, so the seating gate
 * can read it without pulling the weight manifests (and their JSON import) into the Node checks.
 */
const ANTE_ROUND_WEIGHTS: Record<number, { manifest: AnteRoundManifest; weightsURL: string }> = {
  2: { manifest: manifest2 as AnteRoundManifest, weightsURL: weights2URL },
  3: { manifest: manifest3 as AnteRoundManifest, weightsURL: weights3URL },
  4: { manifest: manifest4 as AnteRoundManifest, weightsURL: weights4URL },
  5: { manifest: manifest5 as AnteRoundManifest, weightsURL: weights5URL },
  6: { manifest: manifest6 as AnteRoundManifest, weightsURL: weights6URL },
  7: { manifest: manifest7 as AnteRoundManifest, weightsURL: weights7URL },
  8: { manifest: manifest8 as AnteRoundManifest, weightsURL: weights8URL },
}

// A registered seat count with no weights behind it would pass the gate and then fail to load, so
// the two lists are held to agreeing here, at module load.

/**
 * The **multi-round** policies, one per seat count. Each reads the round's features plus a match
 * block — gold, standings and every seat's public honesty record — so it can price its last coin and
 * read an opponent's history, neither of which a one-round policy can see.
 *
 * Every one of these beats its own seat count's round policy head to head in both directions, and is
 * harder to best-respond to than it; `rl/ANTE.md` carries the table. They are trained at 20 rounds
 * and 5 gold, and the match block normalises `rounds_left` and every gold column by exactly those,
 * so a room staged at any other setting gets the round policy instead — `pickAnteWeights` is where
 * that decision lives, and it mirrors the refusal `ante/match_agents.py` makes on the Python side.
 */
const ANTE_MATCH_WEIGHTS: Record<number, { manifest: AnteRoundManifest; weightsURL: string }> = {
  2: { manifest: matchManifest2 as AnteRoundManifest, weightsURL: matchWeights2URL },
  3: { manifest: matchManifest3 as AnteRoundManifest, weightsURL: matchWeights3URL },
  4: { manifest: matchManifest4 as AnteRoundManifest, weightsURL: matchWeights4URL },
  5: { manifest: matchManifest5 as AnteRoundManifest, weightsURL: matchWeights5URL },
  6: { manifest: matchManifest6 as AnteRoundManifest, weightsURL: matchWeights6URL },
  7: { manifest: matchManifest7 as AnteRoundManifest, weightsURL: matchWeights7URL },
  8: { manifest: matchManifest8 as AnteRoundManifest, weightsURL: matchWeights8URL },
}

for (const seats of ANTE_AGENT_SUPPORTED_SEATS) {
  if (!ANTE_ROUND_WEIGHTS[seats]) throw new Error(`no Ante weights registered for ${seats} seats`)
  const match = ANTE_MATCH_WEIGHTS[seats]
  // A match manifest whose seat count disagreed with its key would be loaded for the wrong table and
  // read garbage at the right offsets, so the two are held to agreeing at module load.
  if (match && match.manifest.numPlayers !== seats) {
    throw new Error(`ante match weights for ${seats} seats declare ${match.manifest.numPlayers}`)
  }
}

/**
 * The match policy when the room is staged at the config it was trained for, the round policy
 * otherwise. Returning the round policy is a real fallback rather than a failure: it is the agent
 * that shipped before this, and it plays every room legally.
 */
function pickAnteWeights(seats: number, roundLimit: number, startingGold: number) {
  const match = ANTE_MATCH_WEIGHTS[seats]
  if (
    match
    && match.manifest.roundLimit === roundLimit
    && match.manifest.startingGold === startingGold
  ) {
    return match
  }
  return ANTE_ROUND_WEIGHTS[seats]
}

const pendingBySeats = new Map<string, Promise<AnteRoundNet>>()

export function loadAnteRoundNet(
  seats: number,
  roundLimit: number,
  startingGold: number,
): Promise<AnteRoundNet> {
  const load = pickAnteWeights(seats, roundLimit, startingGold)
  if (!load) {
    return Promise.reject(new Error(`No Ante agent is trained for ${seats}-seat tables.`))
  }
  // Keyed by the asset rather than the seat count, so a tab holding rooms at two different configs
  // caches both rather than handing the second one the first one's network.
  const key = load.weightsURL
  let pending = pendingBySeats.get(key)
  if (!pending) {
    pending = fetch(load.weightsURL)
      .then((response) => {
        if (!response.ok) throw new Error(`ante weights failed to load: ${response.status}`)
        return response.arrayBuffer()
      })
      .then((buffer) => createAnteRoundNet(load.manifest, new Float32Array(buffer)))
      .catch((error) => {
        // Cleared so a transient failure can be retried by the next seat rather than poisoning the
        // cache for the life of the tab.
        pendingBySeats.delete(key)
        throw error
      })
    pendingBySeats.set(key, pending)
  }
  return pending
}
