# Blow Cow Characters

Every player is dealt one character at the start of the match. A character is a standing exception to
the rules in `RULES.md` — it adds an action, changes how a rule resolves for that seat, or adjusts
their points. This file is the rules-level reference for all of them.

- `RULES.md` is the vanilla game: what every player does regardless of who they are. Where a
  character modifies a rule, that section carries a one-line pointer back here.
- `Characters.csv` is the wording printed on the card art, and the authoring source for it.
- `CLAUDE.md` covers how these are implemented — move names, state fields, and why the code is shaped
  the way it is. No rules are stated there; it points here.

## How Characters Are Dealt

- The host chooses a character pool in the lobby. Characters are dealt at random from that pool, one
  per player.
- If the pool is smaller than the player count, the pool repeats, so two players may hold the same
  character.
- A character a player is holding is theirs for the whole match. Leaving the game does not release
  it — `The Seeker` may not take a character still held by a player who has left.
- `The Confused` is not dealt when the deck has no Jacks, since their ability would do nothing.

## Roster

| Character | Ability | Limit |
| --- | --- | --- |
| The Dreamer | May cheat, and is the only player `Accuse` may name | Unlimited |
| The Believer | None | — |
| The Cat | May flip a revealed table card face down, or change `Direction` | Unlimited, own turn |
| The Contrarian | Their own `Call BS` always reverses the punishment | Unlimited |
| The Confused | Jacks also function as Jokers | Passive |
| The Deranged | On scoring a point, remove 2 cards in hand from the game | Not implemented |
| The Drunkard | May play random cards instead of chosen ones | Unlimited, penalty on leave |
| The Foreigner | On `Pass`, may add any card from outside the game to hand | Unlimited |
| The Grandmaster | May `Call BS` on any player holding a hidden play | One use |
| The Invisible Hand | `Manipulate`: set the rank, `Direction`, and who starts the round | Unlimited, round's first turn |
| The Philanthropist | As starting player, may play 3 cards for the rest of the round | Not implemented |
| The Privileged | Always the starting player; +1 point on leaving | Passive |
| The Rogue | With an all-Clubs hand, may reveal it and become starting player | Not implemented |
| The Speedrunner | Leaving first on exactly 2 points scores 0 instead | Passive |
| The Spy | Reveals only one card of a two-card play | Passive |
| The Streamer | Leaving without ever passing costs 2 points | Passive |
| The Pacifist | Leaving without ever calling BS costs 1 point | Passive |
| The Pawn | `En Passant`: `Call BS` one play further back | Unlimited |
| The Seeker | Takes any unclaimed character from the pool | Once, at game start |
| The Broken | Removes one rule card | Once, at game start |
| The Prototype | `Defy`: destroy a heart from hand and a random rule card | One use per round |
| The Mastermind | `Conspire`: see another player's hand and play out of it | One use per round |
| The Gambler | Every `Reset` becomes a poker showdown | Passive |
| The Mime | `Mimic`: copy the next player's block, and maybe swap seats | One use per round |
| The Clown | Their first `Play` each round does not end the turn | One use per round |
| The Thinker | Their points step at the end of each of their turns | Passive |

## The Dreamer

**May cheat. You will be punished if caught. Unlimited use.**

- The single exception to the `No Cheating Rule`, and the only player `Accuse` may name while that
  rule stands.
- The six cheats, their windows, and how accusations resolve are written under `No Cheating Rule` in
  `RULES.md`. They are properties of the rule, not of this character.
- Nothing announces that a cheat happened. Every accusation is a guess.
- If the `No Cheating Rule` is removed, everyone gains all six cheats and The Dreamer is left an
  ordinary seat. See `Removed Rules` below.

## The Believer

**No ability.**

- Plays the vanilla game exactly as written in `RULES.md`. It is the baseline the other 25 are
  exceptions to.

## The Cat

**On your turn, you may click a revealed card to flip it face down, or change `Direction`. Unlimited
use.**

- Both flips are free. Neither is an action, and neither ends the turn.
- The card flip turns one face-up card on the table face down again. Everyone sees it happen.
- The direction flip is the only legal one in the game. Every other change to `Direction`, by anyone,
  is the direction cheat under the `No Cheating Rule`.
- It is legal only on The Cat's own turn. Reaching into somebody else's turn makes them a cheat like
  anyone else, licence or not.
- The direction tell fires on this legal flip exactly as it does on the cheat, so it gives an accuser
  nothing on its own. See `No Cheating Rule` in `RULES.md`.

## The Contrarian

**When you call BS, you always punish the opposite player.**

- A second layer on top of the `Reverse Rule`, not an override. A call that trips both is reversed
  twice, so the default punishment stands.
- It is bound to the caller. Being called on by The Contrarian does nothing.
- If the `Reverse Rule` is removed, The Contrarian still reverses their own calls — that layer is
  written on their card, not on the rule card. Removing it makes them the only thing in the game that
  ever reverses a punishment.
- They have no effect on `Direction`.

## The Confused

**Jacks now also function as Jokers.**

- For judging plays and resolving `Call BS`, this player's Jacks are wild and count as the trump rank.
- They stay Jacks everywhere else: they still count toward 4-of-a-kind scoring, they do not count
  toward the `Reverse Rule`, and they are not wild in a `Reset Showdown`.
- Not dealt when the deck holds no Jacks.
- If the `Joker Rule` is removed, this ability is worthless too — it makes Jacks behave as Jokers, and
  a Joker is then nothing.

## The Deranged

**Whenever you get a point, remove 2 cards in hand of your choice from the game. Unlimited use.**

- **Not implemented.** The player may also choose to remove nothing.

## The Drunkard

**Whenever you play cards, you may play random cards instead. If you have always played randomly,
-3 points after leaving the game.**

- `Play Random` is a separate action from `Play`, with a count selector beside it.
- The cards are drawn from hand at random by the server. The player still chooses the trump rank when
  the round has none.
- The penalty applies on leaving only if the player played at least once and never used the ordinary
  `Play`. A single manual play cancels it for the rest of the match.
- The `Broken` status opens `Play Random` to a non-Drunkard and forces it down to one card. A play
  made that way is not The Drunkard's.

## The Foreigner

**When you pass, you may add a card from outside the game to your hand. Unlimited use.**

- The card may be any card at all, Jokers included, regardless of what is in the deck this match. It
  is created from outside the card pool rather than drawn from it.
- Taking a card is optional; the pass stands on its own either way.
- Anything that removes `Pass` removes this ability with it, since there is no pass to hang it on:
  the `Pass Rule` being removed, and the `Tilted` status.

## The Grandmaster

**You may call BS on anyone. One use only.**

- Normally `Call BS` targets the previous non-passing player. This ignores that and names any player
  holding a hidden play — that is, a play still face down in front of them.
- One use for the whole match, not per round. It is spent on the call.
- The call resolves as a normal `Call BS` in every other respect.

## The Invisible Hand

**`Manipulate`: as the starting player, choose the rank, the `Direction`, and the player who starts
the round. Unlimited use.**

- The window is the starting player on the round's very first turn. Any pass or play in the round
  closes it.
- All three decisions are made at once: the trump rank, the round's `Direction`, and which other
  player takes the first turn.
- The chosen rank obeys the `Rank Change Rule` — it may not repeat the previous round's trump.
- The chosen player may not `Pass` on the turn handed to them. That lock lifts the moment any other
  turn begins.
- They may not name themselves. Unlimited use needs no counter, because handing the round away is
  what stops them being the starting player.
- The handed-over turn has nothing to `Call BS` on: no play has been made yet.

## The Philanthropist

**If you are the starting player, you may declare this ability and play 3 cards on any of your turns
that round. One use only.**

- **Not implemented.** Once declared, the 3-card play is available on every turn of that round.

## The Privileged

**By default you are always the starting player, unless another character's ability says otherwise.
+1 point after leaving the game.**

- The claim is checked when each round's starting player is chosen, and beats the ordinary rules for
  who starts.
- **They forfeit the claim for one round after being punished.** A seat that earned the start by
  winning a BS call or an accusation against The Privileged actually keeps it.
- Another character's ability overrides the claim where the two conflict.
- The +1 point applies on leaving. Since lower points are better, it is a penalty.

## The Rogue

**At the start of a round, if every card in your hand is a Club, you may show your hand to everyone
and become the starting player. Unlimited use.**

- **Not implemented.**

## The Speedrunner

**If you are the first to leave the game and you have exactly 2 points, you have 0 points instead.**

- Both conditions are exact: first to leave, and exactly 2 points at that moment. 1 or 3 points does
  nothing.
- Applied as the player leaves, after every other effect on their total has settled.

## The Spy

**On your turn you reveal only one card of your last played hand, if there are at least 2 hidden
cards in front of you. Unlimited use.**

- A modifier on the `Reveal Rule`, always active, never declined.
- Which card is revealed is chosen at random by the server, not by the player. It is simply the only
  card their client will accept a press on.
- A one-card play reveals normally — there is nothing to hold back.
- If the `Reveal Rule` is removed, this ability has nothing to modify and does nothing.
- Only the card actually revealed sets off an action rank. A `Skip` held back behind the one card the
  server drew stays inert, and stays inert for good — it is never owed a reveal again. See `Action
  Ranks` in `RULES-EXTENSIONS.md`.

## The Streamer

**If you leave the game without ever passing, lose 2 points.**

- Counted across the whole match. One pass at any point avoids it.
- Negative totals are possible, and since lower is better, this is a reward.
- If the `Pass Rule` is removed, the penalty becomes unavoidable.

## The Pacifist

**If you leave the game without ever calling BS, lose 1 point.**

- Counted across the whole match. One `Call BS` at any point avoids it.
- Negative totals are possible, and since lower is better, this is a reward.

## The Pawn

**`En Passant`: if your previous non-passing player played two cards in a turn, you may call BS on
*their* previous non-passing player. Unlimited use.**

- Available only when the ordinary BS target played exactly two cards on their last turn, and there
  is an earlier play still hidden in front of somebody else to reach past them to.
- The trigger play must be the one immediately before the target's on the table.
- The target may not be The Pawn themselves.
- It resolves as a normal `Call BS` against the further-back player.

## The Seeker

**At the start of the game, take one character card of your choice from the entire card pool.**

- Chosen from the characters the host put in play, minus every character already held at the table,
  minus The Seeker itself.
- Players who have already left still hold their card, so their character stays claimed.
- Taking a character replaces The Seeker, which is what spends the ability. There is no separate
  limit.
- Not turn-bound and has no deadline. The pick can land in the middle of somebody else's turn.

## The Broken

**Remove 1 rule card at the start of the game.**

- Only a rule that defines a `Removed` variant may be chosen, and only one still `Active`. See the
  rule card table in `RULES.md`.
- Not turn-bound and has no deadline, so the rules in play can change mid-turn.
- The removal lasts the rest of the match.

## The Prototype

**`Defy`: destroy 1 heart card in hand and 1 random rule card. This action does not end your turn.
One use per round.**

- The card spent must be of the heart suit. No other card, Joker included, can pay for it.
- The rule card is drawn at random from the same pool The Broken picks from: rules that define a
  `Removed` variant and are still `Active`.
- `Defy` is unavailable when that pool is empty, or when the hand holds no heart — so it can never do
  only half of what the card says.
- It does not end the turn, and the player still owes the table an ordinary action.

## The Mastermind

**`Conspire`: choose another player, see their hand, and play their cards instead of yours. One use
per round.**

- Only a player still in the game and holding at least one card may be chosen. It is unavailable when
  the table has no room left for a play.
- **There is no cancel.** Opening the hand commits the turn: the only remaining action is a play out
  of that hand. `Pass`, `Call BS`, `Call Reset`, and `Accuse` are all unavailable until it is paid off.
- The cards leave the target's hand, but the play lands in front of The Mastermind, who answers the
  `Call BS` it draws. It is their play in every respect except where the cards came from.
- The round's use is spent when the hand is opened, not when the play lands.

## The Gambler

**When `Reset` is called, everyone forms a poker hand from the cards in front of them. The weakest
hand is punished and takes all the cards.**

This replaces the shuffle and the deal in `Call Reset` for as long as The Gambler is seated. It
applies to every `Reset`, whoever called it — the ability is a rule imposed on the table, not an
action they spend.

- After every card on the table is face up, the cards in front of each player are read as a poker
  hand. The weakest takes the whole table, and nothing is redistributed.
- Every player still in the game is ranked, including anyone who passed all round and has nothing in
  front of them. Nothing in front is the weakest hand there is.
- Hands are the standard five-card categories: straight flush, four of a kind, full house, flush,
  straight, three of a kind, two pair, pair, high card. A player holding more than five cards is read
  as their best five.
- Flushes and straights need a real five cards. Four to a flush is not a flush and four to a straight
  is not a straight — both are read as high card. A short hand is scored as it stands and is never
  padded out, so two cards can never beat a pair.
- The ace is high only. `A-2-3-4-5` is not a straight.
- Jokers are wild and stand in for whatever card makes the best hand, but a wild card is spent once: a
  Joker that completes a flush is not also completing the trips. `The Confused`'s Jacks stay Jacks
  here, exactly as they do for 4-of-a-kind scoring.
- Action ranks are dead cards here. They are not wild and they have no rank to score, so a player
  holding one is reading their hand with one card fewer. See `Action Ranks` in `RULES-EXTENSIONS.md`.
- If two hands read the same, the player with fewer cards in front is the weaker of the two.
- If they are still tied, the player who called `Reset` chooses which of the tied players is punished.
- The caller still becomes the starting player of the next round, even when they are the one punished.
- An all-pass round ending is never a showdown, because nobody called anything — those cards go back
  to their owners as usual.
- The `Call Reset Rule` is the one rule card this overrides, and it is one of the rules that cannot be
  removed. So this ability has no removal interaction at all.

## The Mime

**`Mimic`: shapeshift as your next player. 50% chance to swap position with them. One use per round.**

Taken on The Mime's own turn. It is not one of the turn actions and does not end the turn on its own.

- **The target is fixed.** It is always the caller's next player in the current `Direction`, so there
  is nothing to choose.

Two things happen, in this order.

1. **The disguise.** The caller's block takes on the target's appearance: the same avatar, name,
   character card, point total, cards-in-hand count, statuses, and the same cards in front. Everything
   is copied as it stands at that moment and does not change afterwards, so cards played later stack
   onto the copied pile and count down from the copied hand, exactly as they would on the block being
   copied.
2. **The coin flip.** Half the time the two players swap seats, and half the time nothing moves.
   Nobody but The Mime is told which happened.

- On a swap, the two trade places in the seating. The turn stays with the chair, so the target takes
  it over and The Mime becomes the player after them. Seat numbers belong to the chairs and do not
  move, so the swap renames nothing.
- Without a swap, The Mime keeps the seat and the turn, and still owes the table an action.
- **The seat swap is permanent.** Nothing restores it.
- The disguise is not permanent, but it lasts the rest of the round. The Mime's own later turns do not
  end it: they keep acting from behind the copied block.
- It comes off when the round ends, when either of the two players leaves the game, or the moment a
  `Call BS`, `Call Reset`, or `Accuse` procedure begins — whichever comes first. Since every way a
  round can end is one of those, a procedure is always what takes it off. The forced reveal a turn
  opens with is the one procedure that leaves it standing: it is not raised by anybody, and a disguise
  that came off every turn would not be a disguise.
- **Only the appearance is copied.** The Mime does not gain the copied character's ability, keeps
  their own hand, and answers for their own plays. `MaxCardsOnTable` still counts the real cards on
  the table, not the copies drawn on top of them.

### Mimic And The Reveal Rule

- While the disguise stands, the `Reveal Rule` runs per seat rather than per play. Both blocks draw
  the same physical cards, so obeying it literally would flip the borrowed pile on both at once.
- Instead, each of the two seats turns the copied cards face up when the turn reaches it, so the pile
  opens on one seat and then the other.
- A consequence, and an intended one: if the seats swapped, the copied player's own cards stay face
  down on their seat until the turn comes back round to them, even though they have already revealed.
  They are face up on the other seat by then, so nothing stays hidden for longer than one lap.
- Cards already face up when the copy was taken stay face up on both seats. Only what was still face
  down is held back.
- A play of The Mime's own that the disguise is no longer drawing is turned face up at `Take Turn`
  with no procedure at all. There is nothing on screen for them to press.

## The Clown

**The first play you make each round does not end your turn. You may take a different action right
after.**

- The second action is the ordinary turn action space **minus `Play`**: `Call BS`, `Call Reset`,
  `Pass`, or `Accuse`.
- The play counts in every other way. The pass counter resets on it, and The Clown becomes the
  previous non-passing player.
- Because of that, `Call BS` taken as the second action still targets whoever was the previous
  non-passing player **before** The Clown's own play — otherwise the play would make them their own
  target and close the very action the kept turn hands back.
- There is no decline and no end-turn button. `Pass` is how the kept turn is handed back, and it
  counts as an ordinary pass.
- If the kept turn would have no legal action at all — `Pass Rule` removed, nobody to challenge, and
  the table short of its cap — the play simply ends the turn as usual and the round's use goes
  unspent.
- The round's use is spent by the play, not by the action it buys.

## The Thinker

**At the end of your turn, your points update to: `0` if `n > 12`, `n / 2` if `n` is even, and
`3n + 1` if `n` is odd, where `n` is your current points.**

- The wipe is checked first, so a total above 12 never takes a parity branch.
- This happens however the turn ended — a play, a pass, a `Call BS` or `Call Reset` resolving, an
  accusation, `Manipulate`, `Mimic` — because it is the end of the turn and not any one action that
  triggers it.
- It is not an action, cannot be declined, and has no limit.
- The only character whose points move without any card changing hands. Their scored 4-of-a-kind sets
  deliberately stop adding up to their total.
- Because lower points are better, halving and the wipe are the reward and `3n + 1` is what holding an
  odd total costs. `0` is the one value that does not move, since it is even and halves to itself.
- It stops once The Thinker has left the game, so whatever the leave rules settled on is their final
  total.

## Character Interactions With Removed Rules

A removed rule takes any ability built on top of it with it. This is a consequence of the removal, not
a special case. See `Rule Cards` in `RULES.md` for what each removal does on its own.

- **`Pass Rule` removed:** The Foreigner has no way to use their ability, and The Streamer's leave
  penalty becomes unavoidable. It can also take The Clown's second action away, since `Pass` is how a
  kept turn is ended: with nothing to challenge and a table short of its cap, the turn is not kept at
  all and the play ends it as usual.
- **`Joker Rule` removed:** The Confused's Jacks are worthless too, because the ability makes them
  function as Jokers and a Joker is now nothing.
- **`Reveal Rule` removed:** The Spy has nothing to modify, since their ability only ever chose how
  much of the start-of-turn reveal happened. Taking a card back off the table goes with it, for the
  same reason running the other way: only face-up cards may be taken, and with no start-of-turn reveal
  nothing reaches the table face up in the first place. Every action rank in the deck goes dead too —
  the same consequence, reaching a card rather than a character.
- **`Rank Change Rule` or `Max Cards On Table Rule` removed:** the matching Dreamer cheat stops being
  a cheat, so the play is honest and `Accuse` cannot catch it.
- **`Reverse Rule` removed:** The Contrarian is the exception that proves the rule above. Their layer
  is written on their own card and reverses their calls whatever this one says, so removing it does
  not disarm them — it makes them the only thing that ever reverses a punishment.
- **`No Cheating Rule` removed:** The Dreamer is left with an ordinary seat, because their whole
  ability was being the exception to that rule and everyone is now the exception. This is the same
  mechanic as the entries above running the other way: it universalises the ability instead of
  deleting it. The Cat is the one character it partly cuts across — their own-turn flip is still the
  only legal one, and still the only flip that leaves nothing for `Accuse` to catch, but reaching into
  somebody else's turn now makes them a cheat like anyone else.
- **`Status Rule` removed:** nothing loses an ability. See `Statuses` in `RULES-EXTENSIONS.md`.
- **`Call Reset Rule`** cannot be removed, so The Gambler's showdown has no removal interaction.

## Character Interactions With Statuses

Statuses are defined in `RULES-EXTENSIONS.md`. Two of them cut across a character:

- **`Tilted`** removes `Pass`, and with it The Foreigner's pass-card pickup, for exactly the reason
  removing the `Pass Rule` does.
- **`Broken`** takes the choice of card rather than the action, opening a random play to a
  non-Drunkard. The play is not The Drunkard's and carries no leave penalty.

## Authoring Notes

- `Characters.csv` also carries `The Nice Guy`, which is not in the game's character list and is not
  implemented. It is a design draft, not a shipped character.
- Three characters above are marked **Not implemented**: The Deranged, The Philanthropist, and The
  Rogue. They are in the roster and have card wording, but no behavior.
- Character card sprites carry the name and ability text as art, and are the only place a player reads
  an ability in the UI. Keep the wording here, in `Characters.csv`, and on the art in agreement.
