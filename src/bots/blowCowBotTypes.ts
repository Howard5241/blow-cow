/**
 * The bot roster offered in the room staging page. Two rosters, because the two modes are two games.
 *
 * **Classic is scripted.** The five below are ports of the scripted agents in `rl/blowcow/agents.py`,
 * which are the yardsticks the RL work measures against, and they are deliberately what is on offer
 * rather than a trained checkpoint: `heuristic` beats every learned classic checkpoint measured so
 * far at four or more seats, so shipping one there would be a downgrade as well as a port.
 *
 * **Ante is the network.** There the result went the other way — the learned agent beats `heuristic`
 * in both directions and bankrupts it in 99.7% of matches (`rl/ANTE.md`) — so the port was worth
 * making, and `src/bots/ante/` is it. The cost that used to make it not worth making is real and was
 * paid rather than avoided: the model is exported by `rl/export_ante_round.py`, the observation
 * encoder and the flat action space are re-implemented in TypeScript, and two check scripts hold
 * that port to the Python it came from rather than trusting it. See `scripts/check-ante-bot.ts` for
 * the fixtures and `scripts/check-ante-bot-play.ts` for whole matches through the real reducer.
 */
export type BlowCowBotKind = 'random' | 'honest' | 'liar' | 'caller' | 'heuristic' | 'agent'

export const BLOW_COW_BOT_KINDS: readonly BlowCowBotKind[] = [
  'heuristic',
  'honest',
  'liar',
  'caller',
  'random',
]

/**
 * Ante Mode's roster, which is the learned agent and nothing else.
 *
 * The five scripted kinds above are ports of `rl/blowcow/agents.py` — the **classic** package — and
 * Ante is a different game: no rule cards, no points, no `Call Reset`, a different ending set and a
 * different table limit. A scripted bot pointed at it would not misplay visibly, it would issue moves
 * the server refuses, which reads as a frozen table. The learned agent is the one thing in the repo
 * that was actually trained on these rules.
 */
export const BLOW_COW_ANTE_BOT_KINDS: readonly BlowCowBotKind[] = ['agent']

export const BLOW_COW_BOT_LABELS: Record<BlowCowBotKind, string> = {
  heuristic: 'Card Counter',
  honest: 'Honest',
  liar: 'Bluffer',
  caller: 'Challenger',
  random: 'Random',
  agent: 'The Student',
}

/** Shown beside the picker. Says what the bot *does*, since that is what makes a game interesting. */
export const BLOW_COW_BOT_DESCRIPTIONS: Record<BlowCowBotKind, string> = {
  heuristic: 'Counts unseen cards, bluffs when the table is cheap, and knows the Reverse Rule. The toughest.',
  honest: 'Never lies. Plays trump when it holds trump, passes otherwise, and never challenges.',
  liar: 'Puts cards down regardless of the truth, emptying its hand as fast as the table allows.',
  caller: 'Challenges at every opportunity. Punishes bluffing hard and collapses against honesty.',
  random: 'Picks a legal action at random. The floor everything else has to clear.',
  agent: 'A neural network trained on seven million hands of Ante. Reads a lie well; rarely challenges.',
}

export const BLOW_COW_BOT_NAME_PREFIX = 'Bot '

/** Bot seats are recognised by name, so a reload can pick them back up from the room roster. */
export function getBotSeatName(kind: BlowCowBotKind, seatNumber: number) {
  return `${BLOW_COW_BOT_NAME_PREFIX}${BLOW_COW_BOT_LABELS[kind]} ${seatNumber}`
}

export function isBotSeatName(name: string | null | undefined) {
  return typeof name === 'string' && name.startsWith(BLOW_COW_BOT_NAME_PREFIX)
}

const BOT_KIND_BY_LABEL = new Map<string, BlowCowBotKind>(
  (Object.entries(BLOW_COW_BOT_LABELS) as [BlowCowBotKind, string][])
    .map(([kind, label]) => [label, kind]),
)

/**
 * The kind a bot seat name was built from, or null when the name is not one of ours.
 *
 * `getBotSeatName` is the only writer, so this reads its output back. It exists because a bot picked
 * up by a tab that did not add it has nothing but the room roster to go on: the kind was chosen in a
 * browser that is gone, and the seat name is the only place it survived. The trailing seat number is
 * stripped rather than split on, since a label may itself contain a space.
 */
export function getBotKindFromSeatName(name: string | null | undefined): BlowCowBotKind | null {
  if (!isBotSeatName(name)) {
    return null
  }

  const label = (name as string).slice(BLOW_COW_BOT_NAME_PREFIX.length).replace(/\s+\d+$/, '')
  return BOT_KIND_BY_LABEL.get(label) ?? null
}
