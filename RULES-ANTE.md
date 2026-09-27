# Blow Cow Rules — Ante Mode

The second game mode. `RULES.md` is the vanilla game and remains the source of truth for everything
this file does not change; where the two agree, this file points at it rather than restating it.
Read that file first — Ante Mode is a set of deltas on top of it, not a replacement for it.

Ante Mode is deliberately bare. Characters, rule cards, statuses, action ranks and cheating are all
out, so `CHARACTERS.md` does not apply here at all and no rule below has a `Removed` or `Upgraded`
variant.

## Overview
- The match is a fixed number of rounds, `RoundLimit`, which is `20` by default.
- Every player starts with `StartingGold` gold, which is `5` by default.
- Every round ends with exactly one winner, and winning a round is worth `1` gold.
- Every round ends with the whole table face up. Nothing played in a round stays secret past it.
- Gold is the only score. There are no points and no 4-of-a-kind scoring.
- A player who reaches `0` gold leaves the game.
- The whole deck is redealt at the start of every round, so a round always begins with everyone
  holding a full hand.
- No card ever moves from one player to another inside a round. The only thing a round moves is gold.
- Supported player count: 2 to 8 players.

## What Carries Over From `RULES.md` Unchanged
These are not restated below. Read them there.

- `Turn Structure`, in full: a turn does not begin on its own, `Take Turn` opens it, `Take Turn` is
  not an action, and one action is chosen per turn.
- `Reveal Rule`, in full: at the start of your turn you flip whatever you played on your previous
  turn face up, by hand, and the whole table waits while you do it. It is not the only reveal in the
  mode — every round ending turns the rest of the table over as well; see `The Three Round Endings`.
- `Play`: at most 2 cards, face down, claimed as the trump rank.
- `Select Trump Rank And Play`, minus the previous-round restriction — see `Rank Change Rule` below.
- `Pass`: end your turn without playing or calling anything.
- `Call BS` targeting: always the previous non-passing player, and unavailable when there is none.
- `Joker Rule`: Jokers are wild and count as the trump rank. They never count toward the
  `Reverse Rule`.
- `Reverse Rule`: after a BS call, once every table card is face up, 4 or more cards of the trump
  rank reverse the result. What gets reversed is the gold rather than a pile of cards — see
  `Ending 1` below.
- `Direction`: determines who takes the next turn, and does not determine who starts a round.

## What Ante Mode Removes
- **The point system.** No 4-of-a-kind check ever runs, on any deal or any card gained. Every card
  stays in the deck for the whole match, which is what lets the full deck be redealt every round.
- **`MaxCardsOnTable`.** The table has no limit and never needs one: a round ends as soon as any
  player's hand is empty at the start of their turn, so the table cannot grow indefinitely.
- **`Call Reset`.** It existed to recycle a full table, and there is no full table.
- **The `Leave Game Rule`.** Running out of cards is how you *win* a round here, not how you leave
  the game. Leaving is by gold alone — see `Elimination`.
- **The `Rank Change Rule`.** The same trump rank may be chosen in consecutive rounds.
- **The `Direction Change Rule`.** `Direction` never changes. It is `counterclockwise` for the whole
  match, and nothing in Ante Mode can flip it.
- **The take-back half of the `Pass Ending Rule`.** The trigger is unchanged at `n` consecutive
  passes, and the last passer is still the player it singles out. But there are no cards to take
  back — the whole deck is redealt — and that player now wins the round outright rather than merely
  starting the next one. See `Ending 2`.
- **Characters.** No player is dealt one, and no character ability exists in this mode.
- **Rule cards.** Every rule is `Active` and none may be removed or upgraded. There is no House Rules
  editor for an Ante Mode room.
- **Statuses.** No status is ever held, shown, or handed out.
- **Action ranks.** `Plague`, `Skip` and `Peek` are never in the deck.
- **Cheating and `Accuse`.** Both needed either `The Dreamer` or a removed `No Cheating Rule`, and
  neither exists here.
- **The `Final Two Players Rule`.** It is subsumed: see `Two Players` below.

## Notation
- `N`: the number of players when the match starts.
- `n`: the number of players still in the game. `n` shrinks as players are eliminated.
- `RoundLimit`: how many rounds the match lasts. `20` by default.
- `StartingGold`: how much gold every player starts with. `5` by default.
- `Direction`: who takes the next turn. Fixed at `counterclockwise` for the whole match.

## The Deck
- The card pool is the same as vanilla: 1 deck plus 2 Jokers.
- The number of standard ranks used is chosen by the **current** player count `n`, not the starting
  count, and is re-derived every time a player is eliminated.
- The 2 Jokers are always included, at every player count.
- The chosen standard ranks may be any ranks; they are not a fixed subset.
- The deck holds no action ranks.

### Standard Ranks Used By Current Player Count
| Current Players (`n`) | Standard Ranks Used |
| --- | --- |
| 2 | 3 ranks |
| 3 | 4 ranks |
| 4 | 6 ranks |
| 5 | 7 ranks |
| 6 | 7 ranks |
| 7 | 10 ranks |
| 8 | 12 ranks |

### Resulting Deck And Hand Sizes
| `n` | Ranks | Deck | Hands |
| --- | --- | --- | --- |
| 2 | 3 | 14 | 7, 7 |
| 3 | 4 | 18 | 6 each |
| 4 | 6 | 26 | 6, 6, 7, 7 |
| 5 | 7 | 30 | 6 each |
| 6 | 7 | 30 | 5 each |
| 7 | 10 | 42 | 6 each |
| 8 | 12 | 50 | 6, 6, 6, 6, 6, 6, 7, 7 |

## The Deal
- At the start of every round, every card in the game is gathered — from hands, from the table, from
  in front of every player — shuffled together, and dealt out again.
- The deal is even wherever the deck divides by `n`. Only 4 and 8 players do not divide, and both
  leave exactly 2 cards over.
- Extra cards go to the seats **latest** in turn order, counting back from the round's starting
  player. The starting player chooses the trump rank and acts first, and in this mode holding fewer
  cards is an advantage, so the remainder is dealt away from them rather than toward them.
- No 4-of-a-kind check runs on the deal, or on anything else.

## Round Structure
- Each round has a starting player, who takes the first turn.
- At the beginning of a round, no trump rank has been selected yet.
- Before a trump rank is selected, each player in turn order may either select a trump rank and play,
  or pass. If the starting player passes, the next player may select it instead.
- The selected rank may be the same as the previous round's — the `Rank Change Rule` is not in play.
- No player can start a round with an empty hand: every round redeals the whole deck, and the
  smallest hand at any player count is 5 cards. There is no round-start leave check.
- The round ends in exactly one of the three ways below, and the winner of the round becomes the
  starting player of the next round.
- A round can never stall and never ends without a winner. Every `Play` puts down cards that do not
  come back inside the round, so hands only shrink. If nobody passes the round out and nobody calls
  BS, some hand empties and `Ending 3` fires.

## Action Spaces

### Before A Trump Rank Has Been Selected
- `{Select trump rank and play, Pass}`

### Normal Action Space
- `{Play, Call BS, Pass}`

`Play` is never unavailable for want of table room, and `Call Reset` is never offered.

## The Three Round Endings
Every round ends in one of these three ways. Each one names exactly one winner, that winner gains
`1` gold, and that winner starts the next round.

Every one of the three also **turns the whole table face up before the round settles**, card by card,
block by block. The player who *ended* the round is the one who does it: the caller in `Ending 1`, the
last passer in `Ending 2`, the player with the empty hand in `Ending 3`. In the last two that is also
the winner; in `Ending 1` it need not be, because a caller who guessed wrong — or who was reversed by
the `Reverse Rule` — still turns the table over and still loses the gold.

The reveal decides nothing. Every ending has already named its winner by the time it starts, and no
card turned over during it can change one. It is there so that the plays a round was won on are read
rather than swept away, which is what makes the next round's guesses about a player worth anything.

**The round is not settled until the last card is face up.** Gold moves, elimination is checked, and
the next round is dealt at the end of the reveal, not at the action that triggered it. In `Ending 2`
the `Reveal Rule` has almost always opened the table already, and a table with nothing left face down
is turned over instantly rather than walked.

### Ending 1 — `Call BS`
1. The caller names the previous non-passing player, exactly as in `RULES.md`.
2. Reveal what the target played on their last turn, then flip every other card on the table face up.
3. If the target lied, the caller wins. If the target was honest, the target wins.
4. Apply the `Reverse Rule`. If 4 or more cards of the trump rank are face up on the table, the
   result is swapped. Jokers never count toward this.
5. The winner gains `1` gold. The loser loses `1` gold.
6. No cards change hands. The table is simply gathered into the next round's deal.
7. The round ends.

This is the only ending that takes gold away from anybody, and so the only ending that can eliminate
a player.

### Ending 2 — `n` Consecutive Passes
- If `n` players pass in a row, the round ends and the player who passed last wins it.
- That player turns the table face up before the round settles. In practice there is nothing left to
  turn: reaching `n` means every player still in the game has taken a turn since their last play, so
  the `Reveal Rule` has already opened every card on the table. The step is written down because the
  ending shares it with the other two, not because it normally has anything to do.
- The pass counter resets after any non-passing action, exactly as in vanilla.
- The trigger and the winner are vanilla's `Pass Ending Rule` unchanged. Only the reward differs:
  that player takes the round rather than merely starting the next one, and nobody takes cards back,
  because the whole deck is redealt regardless.
- The winner gains `1` gold. Nobody loses gold.
- This ending needs no guard about who has played. Reaching `n` means every player still in the game
  chose to pass, so the round can never be handed to somebody who has not acted.
- It applies before a trump rank has been selected as well as after. A round in which every player
  passes on the opening is an ordinary `Ending 2`, won by the last of them — not a round without a
  winner.
- A player whose own play went uncontested claims the round by passing. If you play and everyone else
  passes, your pass is the `n`th and the round is yours. You may keep playing instead.

### Ending 3 — An Empty Hand At The Start Of A Turn
- If a player's turn comes round and they hold no cards, they win the round.
- This is checked before `Take Turn`, so no turn is ever opened for them and the `Reveal Rule` never
  runs on their own terms.
- The round is theirs the moment it is checked. They then turn the whole table face up, starting with
  their own cards, and the round settles. The hand-emptying play is always among them: it is the one
  play the `Reveal Rule` never reached.
- This is the ending the reveal matters for. It is the only one in which a play reaches the end of a
  round unanswered — nobody challenged it, and no turn ever came round to flip it — so it is the only
  one where the reveal settles a question that was still open. That answer is worth nothing in this
  round and everything in the ones after it.
- The winner gains `1` gold. Nobody loses gold.
- This is the ending the whole mode turns on: emptying your hand wins, and `Call BS` is the only
  thing that can stop it, so the last play of a round is the one worth reading. Bluffing it through
  still wins the round; it just no longer wins it in secret.

## Two Players
With `n = 2` the round ends on the second consecutive pass, so passing first offers the opponent the
round and passing second takes it. Neither player can end a round alone, which is the whole reason
the trigger is `n` rather than `n - 1`.

No separate two-player rule is needed beyond that. A player who empties their hand wins on their next
turn whatever the opponent does, so `Call BS` is the only real answer to a hand-emptying play, and
the `Final Two Players Rule` from `RULES.md` has nothing left to say.

## Gold
- Gold is public. Everyone can read everyone's gold at all times.
- Every player starts with `StartingGold`.
- Winning a round is `+1`. Losing a BS call is `-1`. Nothing else moves gold.
- Gold has no floor above `0` and no ceiling.

## Elimination
- A player who reaches `0` gold leaves the game.
- Gold only moves at the end of a round, so elimination always happens at a round boundary, after
  that round's gold has settled and before the next round is dealt.
- Only `Ending 1` takes gold away, so at most one player can be eliminated per round.
- A player who leaves takes no further turns and is not dealt into any later round.
- When `n` drops, the deck is re-derived for the new `n` before the next deal. Standard ranks are
  dropped at random from the ranks currently in play until the count matches the table above.
- Dropped ranks never come back, even if the rank count for a later `n` would allow them.
- The match ends immediately if only one player remains.

## Game End And Final Ranking
- The match ends when `RoundLimit` rounds have been played, or when only one player remains,
  whichever comes first.
- First place goes to the player with the **most** gold. More gold is always better. This is the
  opposite of vanilla, where fewer points is better.
- Every eliminated player ranks below every surviving player.
- Eliminated players are ranked against each other by when they left: leaving later ranks higher.
- Surviving players tied on gold share a placement.

## Room Settings
The mode is the first choice in the lobby's create-room form, and it decides which of the settings
below that form offers. An Ante room is created with these and no others.

| Setting | Default | Notes |
| --- | --- | --- |
| Seats | — | 2 to 8, as in vanilla. |
| Game speed | `1x` | Unchanged from vanilla. |
| Rounds | `20` | The match length, `RoundLimit`. Between 1 and 100. |
| Starting gold | `5` | `StartingGold`, the same for every player. Between 1 and 50. |
| Standard ranks | Default | `Default` follows the table above and re-derives on elimination. `Manual` lets the host pick the starting ranks; elimination still trims them at random down to the count for the new `n`. |

Character cards, the character pool, house rules, starting statuses and action ranks are not offered
for an Ante Mode room. None of them exist in this mode.

## Design Notes
Consequences of the rules above rather than gaps in them. Both are deliberate, and are written down
so a later reader does not mistake either for an oversight.

- **Total gold rises over the match, by design.** `Ending 2` and `Ending 3` mint a gold from the
  bank, and only `Ending 1` takes one away. A table where nobody calls BS therefore never eliminates
  anybody, and a 20-round match can leave a player holding well over `StartingGold`. `Call BS` is the
  only thing in the mode that costs anyone anything, which is what makes it the only real decision.
- **Eliminating a player costs 5 lost BS calls** at the default `StartingGold`. `StartingGold` and
  `RoundLimit` are the two dials if that proves too slow in play.
