# Blow Cow Rules — Extensions

Optional additions to Classic Mode. `RULES.md` is the vanilla game, played with a standard deck and no
modifiers, and remains the source of truth for everything this file does not add. Read that file
first — everything here is layered on top of it.

Neither extension exists in Ante Mode. See `RULES-ANTE.md`.

## Action Ranks
- `Plague`, `Skip` and `Peek` are ranks of their own, printed in the same four suits as every other
  card, so each one that is included adds 4 cards to the deck.
- They are off by default. The host turns each one on or off when creating the room, independently of
  the standard ranks and independently of one another.
- They are dealt, held, played and lied with exactly like any other card.
- They may never be selected as the trump rank, by any means.
- Because no trump rank can ever match them, a play made with one is always a lie.
- Four of a kind of an action rank is removed from the hand exactly as any other four of a kind is
  under the `Point System`, but it awards no point.
- Each one has an effect that happens when the card is turned face up by the `Reveal Rule`, and at no
  other time. A card turned up by a `Call BS`, `Call Reset` or `Accuse` procedure, or by a character
  ability, does nothing. Neither does a card that was already face up when the reveal came round to it.
- Every effect counts seats outward from the player performing the reveal, in the current `Direction`,
  and each rank counts its own seats independently of the others.
- Revealing two of the same rank together reaches two seats, three reaches three, and so on. The count
  never goes further than once round the table.

| Action Rank | On Reveal |
| --- | --- |
| `Skip` | The next player's turn is skipped. |
| `Peek` | The revealing player sees the next player's hand. Nobody else sees it. |
| `Plague` | The next player is afflicted with a random status for 2 turns. See `Statuses`. |

- With 2 players, the seat after the opponent is the revealing player themselves, so a revealed `Skip`
  hands them another turn.
- A `Skip` is spent by the very next turn hand-over. If the revealing player's turn ends some other
  way — a `Call BS`, an `Accuse`, the round ending — the skip is lost.
- A `Peek` is closed by the player who took it, and closes on its own when their turn ends.
- A `Plague` that rolls a status the target is immune to, or that finds them already holding as many
  statuses as they can, simply does not land. Nothing is re-rolled.

### Action Ranks And The Reveal Rule
- The `Reveal Rule` is the only thing that sets an action rank off. Removing that card therefore takes
  every action rank's effect with it: the cards stay in the deck, stay unable to be trump, and still
  score nothing, but nothing ever turns one up — they become dead cards.

## Statuses
A status is a temporary condition on a single player that removes or constrains one action. Statuses
are public: every player can see who is under what, and for how much longer.

- A player holds at most **2** statuses at a time.
- Every status carries a counter. It goes down by 1 at the end of that player's own turn, and the
  status wears off when it reaches 0. Another player's turn ending costs nothing. This is the
  `Status Rule`; without it the counters never move and every status is permanent.
- Statuses are counted in turns, not rounds. A status handed out near the end of a round carries over
  into the next one.
- No status ever forces an action. A status that makes `Play` impossible simply leaves the player
  with their other actions.

| Status | Effect |
| --- | --- |
| Tilted | Cannot take the `Pass` action. |
| Worried | Cannot take the `Play` action. |
| Mad | Must lie. A `Play` cannot be truthful, but you are never forced to play. |
| Nervous | Must be truthful. A `Play` cannot be a lie, but you are never forced to play. |
| Blind | Cannot see any face-up card on the table. |
| Broken | `Play` sends one random card from your hand. You still choose the trump rank. |

Notes on the edges:

- Truthfulness for `Mad` and `Nervous` is the same judgement `Call BS` makes: every played card must
  be of the claimed rank, and no rule may have been broken to make the play. A cheat that breaks a
  rule is therefore a lie for these two as well.
- `Mad` on a player holding only trump-rank cards leaves them no legal `Play`. So does holding `Mad`
  and `Nervous` at once. Both are legal positions, not stalemates: `Pass`, `Call BS` and
  `Call Reset` are unaffected.
- `Tilted` and `Worried` never sit on the same player. Holding either one makes that player immune to
  the other, so the status already in place wins and the second is simply never applied. This is
  deliberately unannounced: no card says it, nothing in the game reports the refusal, and the lobby
  will let a host pick both and hand out only the first. It is refused ahead of the two-status cap,
  so it is a real immunity rather than a player who happened to be full.
- `Worried` removes the `Play` action. It does not stop a player from cheating cards onto the table.
- `Blind` is lifted while a `Call BS` or `Call Reset` reveal is running, so a blind caller can still
  resolve the challenge they started.
- `Broken` takes the choice of card, not the action. The player still chooses the trump rank when the
  round has none.
- `Tilted` and `Broken` each cut across a character. See `CHARACTERS.md`.

The only thing in the game that inflicts a status is a revealed `Plague`. The other source is the
host's testing panel in the lobby, which starts every player with the same statuses at the same
counter.

### Removed Status Rule
- `Status Rule`: status counters are still shown but never go down, so every status a player is given
  lasts for the rest of the match. Removing it mid-match freezes whatever counters are standing at
  that moment; it does not clear anything and it does not hand anybody a status.
