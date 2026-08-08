# Blow Cow Rules

## Overview
- Blow Cow is a multiplayer bluffing card game.
- The game consists of many rounds, and a round usually consists of many turns.
- Supported player count: 2 to 8 players.
- The base card pool comes from 1 deck that contains 2 Jokers.
- By default, the game uses only a certain number of standard ranks from that card pool, depending on the number of players when the game starts.
- The 2 Jokers are always included, even when only some standard ranks are used.
- The chosen standard ranks can be any ranks. They are not restricted to a specific fixed subset.
- For example, if 4 standard ranks are used, the game might use Jacks, Queens, Kings, and Aces.
- At the start of the game, cards are dealt randomly and as evenly as possible to all players.

## Default Standard Ranks Used By Starting Player Count
| Starting Players | Standard Ranks Used By Default |
| --- | --- |
| 2 | 4 ranks |
| 3 | 6 ranks |
| 4 | 9 ranks |
| 5 | 11 ranks |
| 6 to 8 | Entire deck |

## Notation
- `N`: the number of players when the game starts.
- `n`: the number of players currently still in the game. This may become smaller than `N` because players may leave the game over time according to the rules.
- `MaxCardsOnTable`: the maximum number of cards allowed on the table at once. This value depends on `n`.
- `Direction`: determines who gets the next turn. Possible values are `clockwise` and `counterclockwise`.
- `Direction` affects who the next player is during a round. It does not determine who the starting player of a round is.

## MaxCardsOnTable By Player Count
| Current Players (`n`) | `MaxCardsOnTable` |
| --- | --- |
| 2 | 10 |
| 3 or 4 | 12 |
| 5 | 15 |
| 6 | 12 |
| 7 | 14 |
| 8 | 16 |

## Round Structure
- Each round has a starting player.
- The starting player takes the first turn of the round.
- By default, `Direction` is `counterclockwise`.
- When a round ends, `Direction` changes to the opposite value.
- At the beginning of a round, no trump rank has been selected yet.
- At the start of a new round, before the first turn begins, each player with no cards in hand leaves the game immediately.
- This round-start leave check follows the new round's turn order, beginning with the chosen starting player.
- Before a trump rank is selected, each player in turn order may either choose a trump rank and play or pass.
- If the starting player passes, the next player may choose the trump rank or pass.
- The player who selects the trump rank may not choose the same rank as the trump rank of the previous round.
- If the chosen starting player leaves this way, the next eligible player becomes the starting player instead.

## Turn Structure
- At the beginning of each player's turn, that player reveals what they played on their previous turn by flipping those card(s) face up.
- This reveal is mandatory and is not an action.
- On each turn, a player must choose exactly one action.
- `The Clown` is the exception: their first `Play` of each round does not end their turn, and they
  then take one more action out of the same action space, minus `Play`. The play counts in every
  other way, so the pass counter resets on it and they become the previous non-passing player.
- Because of that, `Call BS` taken as their second action still targets whoever was the previous
  non-passing player before their own play, not themselves.
- The pass counter resets after any non-passing action.

## Action Spaces

### Before A Trump Rank Has Been Selected
- `{Select trump rank and play, Pass}`

### Normal Action Space
- `{Play, Call BS, Pass}`

### If Everyone Else Except You Passes
- If there are `n - 1` consecutive passes, the current player is the previous non-passing player, so `Call BS` is not available.
- If `MaxCardsOnTable` has not been reached, the only available action is `{Play, Pass}`.
- If `MaxCardsOnTable` has been reached, the action space is `{Call Reset, Pass}`.

### If The Table Reaches Max Capacity
- If the number of cards on the table reaches `MaxCardsOnTable`, `Call Reset` becomes available. And Play becomes unavailable. 
- `Call Reset` is available only when `MaxCardsOnTable` has been reached, regardless of what other players did.
- If there is also a valid BS target, the action space is `{Call Reset, Call BS, Pass}`.

### If Only 2 Players Remain And One Just Emptied Their Hand By Playing
- `Play` is not available to the other player.
- `Pass` is not available to the other player.
- `Call BS` remains available.
- If `MaxCardsOnTable` has been reached, `Call Reset` is also available.
- Therefore the action space is `{Call BS}` or `{Call Reset, Call BS}`, depending on whether the table is full.

## Action Definitions

### Play
- Put down at most 2 cards face down on the table in front of you.
- Claim that the card or cards you played are of the trump rank.
- You may not play cards if doing so would make the number of cards on the table exceed `MaxCardsOnTable`.
- `Play` is not available when there are already at least `MaxCardsOnTable` cards on the table.

### Select Trump Rank And Play
- Select a rank. That rank becomes the trump rank of the round.
- The selected rank may not be the same as the trump rank of the previous round.
- After selecting the rank, perform the `Play` action.

### Pass
- End your turn without playing cards or calling anything.
- If there are `n` consecutive passes, the round ends immediately.
- When a round ends this way, each player takes back the card(s) in front of them and adds them back to their hand.
- The player who passed last becomes the starting player of the next round.

### Call BS
- This action immediately ends the round.
- The target is always the previous non-passing player of the caller, meaning the last player who chose `Play`.
- If everyone except the current player passed on their last turns, `Call BS` is not available.
- A player reveals what they played only at the beginning of their next turn. Because of that, `Call BS` always targets the previous non-passing player whose last played card(s) are still the relevant hidden play.

### Call BS Resolution
1. Reveal what the target player played on their last turn.
2. Determine the default punishment:
	- If the target lied, meaning the card(s) they played on their last turn were not all of the trump rank, the target is punished.
	- If the target was honest, the caller is punished.
3. Flip all other cards on the table face up.
4. Check whether the Reverse Rule applies, and whether the caller is `The Contrarian`. Each one
   reverses the punishment, so both together leave it where the default put it.
5. The punished player takes all cards on the table.
6. The round ends and a new round begins.
7. The unpunished player, among the caller and the accused player, becomes the starting player of the next round.

### Reverse Rule
- After `Call BS` is used and every card on the table is face up, check the trump rank selected by the starting player of the round.
- If 4 or more cards of that rank are on the table, the punishment is reversed.
- Example: if player `X` calls BS on player `Y` and `X` would normally be punished, then `Y` is punished instead. If `Y` would normally be punished, then `X` is punished instead.
- `The Contrarian` reverses the punishment the same way, on every `Call BS` they make and regardless
  of what is on the table. It is a second layer rather than an override, so a call that triggers both
  is reversed twice and the default punishment stands. Being called on by `The Contrarian` does
  nothing; only their own calls carry it.

### Call Reset
- This action immediately ends the round.
- This action is only available if `MaxCardsOnTable` is reached.
- Flip all cards on the table face up.
- Shuffle all cards on the table together.
- Deal those cards evenly and randomly to every player currently still in the game.
- Each player adds the cards they receive to their hand.
- If the number of table cards is not divisible by `n`, the player who called `Reset` receives the extra cards.
- The player who called `Reset` becomes the starting player of the next round.

### Reset Showdown
- This replaces the shuffle and the deal above whenever `The Gambler` is still in the game. It applies
  to every `Reset`, whoever called it — the ability is a rule that character imposes on the table, not
  an action they spend.
- After every card on the table is face up, the cards in front of each player are read as a poker
  hand. The weakest hand takes every card on the table, and nothing is redistributed.
- Every player still in the game is ranked, including anyone who passed all round and has nothing in
  front of them. Nothing in front is the weakest hand there is.
- Hands are the standard five-card categories: straight flush, four of a kind, full house, flush,
  straight, three of a kind, two pair, pair, high card. A player holding more than five cards is read
  as their best five.
- Flushes and straights need a real five cards. Four to a flush is not a flush, and four to a straight
  is not a straight — both are read as high card. A short hand is scored as it stands and is never
  padded out, so two cards can never beat a pair.
- The ace is high only. `A-2-3-4-5` is not a straight.
- Jokers are wild, as the `Joker Rule` says, and stand in for whatever card makes the best hand. A
  wild card is spent once: a Joker that completes a flush is not also completing the trips.
  `The Confused`'s Jacks are not wild here — they stay Jacks, exactly as they do for 4-of-a-kind
  scoring.
- If two hands read the same, the player who has fewer cards in front is the weaker of the two.
- If they are still tied, the player who called `Reset` chooses which of the tied players is punished.
- The player who called `Reset` still becomes the starting player of the next round, even if they are
  the one who just took the table.

### Mimic
- `The Mime`'s action, once per round, on their own turn. It is not one of the actions above: taking
  it does not end the turn on its own.
- The target is fixed. It is always the caller's next player in the current `Direction`, so there is
  nothing to choose.
- Two things happen, in this order.
- First, the caller's block takes on the target's appearance: the same avatar, name, character card,
  point total, cards-in-hand count, and the same card or cards in front. Everything is copied as it
  stands at that moment and does not change afterwards, so cards played later stack onto the copied
  pile and count down from the copied hand, exactly as they would on the block being copied.
- Second, a coin is flipped. Half the time the two players swap seats, and half the time nothing
  moves. Nobody but `The Mime` is told which happened.
- On a swap, the two trade places in the seating: the turn stays with the chair, so the target takes
  it over and `The Mime` becomes the player after them. Seat numbers belong to the chairs and do not
  move, so the swap renames nothing.
- Without a swap, `The Mime` keeps the seat and the turn, and still owes the table an action.
- The seat swap is permanent. Nothing restores it.
- The appearance is not, but it lasts the rest of the round. `The Mime`'s own later turns do not end
  it: they keep acting from behind the copied block, and cards they play keep stacking onto the
  copied pile.
- It ends when the round ends, when either of the two players leaves the game, or the moment a
  `Call BS`, `Call Reset`, or `Accuse` procedure begins — whichever comes first. Since every way a
  round can end is one of those, the procedure is always what takes it off.
- The Reveal Rule runs per seat while the copy stands, rather than per play. Each of the two seats
  turns the copied card or cards face up when the turn reaches it, so the pile opens on one seat and
  then the other instead of on both at once.
- A consequence, and an intended one: if the seats swapped, the copied player's own cards stay face
  down on their seat until the turn comes back round to them, even though they have already revealed.
  They are face up on the other seat by then, so nothing stays hidden for longer than one lap of the
  table.
- Cards that were already face up when the copy was taken stay face up on both seats. Only what was
  still face down is held back.
- Only the appearance is copied. `The Mime` does not gain the copied character's ability, keeps their
  own hand, and answers for their own plays. `MaxCardsOnTable` still counts the real cards on the
  table, not the copies drawn on top of them.

## Other Rules

### Leave Game Rule
- At the start of every new round, before the first turn begins, each player with no cards in hand immediately leaves the game.
- During a round, if the current player starts their turn with no cards in hand, that player immediately leaves the game.
- Before that exact moment, the player still counts toward `n`, pass counting, `MaxCardsOnTable`, and next-round setup.
- When a player leaves, any cards in front of that player on the table disappear and are removed from the game entirely.
- Those removed cards no longer count toward `MaxCardsOnTable`, and they are never returned, redistributed by `Call Reset`, or taken as punishment.
- Because the round-start leave check happens after the previous round has been fully resolved, a player leaving at round start normally has no cards on the table.
- When that happens, `n` is reduced by 1.
- The current round immediately starts using the new `MaxCardsOnTable` value for the updated `n`.
- A player who leaves no longer participates in future rounds.
- If only one player is left after a player leaves, the game ends.

### Final Two Players Rule
- If only 2 players remain and one of them runs out of cards by playing, the other player may not choose `Play` or `Pass`.
- In that situation, `Call BS` remains available.
- If `MaxCardsOnTable` has been reached, `Call Reset` is also available.
- In that situation, passing is not used to end the game state.

### Reveal Rule
- At the beginning of each player's turn, the player reveals what they played on their last turn by flipping the card(s) face up.
- This is not an action.

### No Cheating Rule
- Nobody may break the rules of the game.
- `The Dreamer` is the single exception, and is the only player `Accuse` may name.
- The six things the exception covers are: playing more cards than you declare, pushing the table
  past `MaxCardsOnTable`, reusing the previous round's trump rank on the opening play, slipping a
  card onto the table during someone else's turn, taking one of your own revealed cards back off the
  table on anyone's turn, and changing `Direction` on anyone's turn.
- `Accuse` is how a cheat is caught. Anyone may raise one, on or off their turn, once per round.
  A hit makes the cheat take the table; a miss makes the accuser take it instead. Either way the
  round ends.
- Slipping a card onto the table is the one cheat that does not need a trump rank. Before the round
  has one, the card claims nothing; it takes on whichever rank the round settles on, whether that
  comes from the opening play or from `The Invisible Hand`. That makes it the widest window of the
  six — it is open before the round has a shape at all.
- Taking a revealed card back is the mirror of slipping one on, and the only cheat that may be done
  on your own turn as well as anyone else's. It takes exactly one of your own face-up cards back into
  your hand. Face-down cards may not be taken: those are still live claims, and palming one would let
  a player answer `Call BS` by deleting the evidence rather than hiding it. There is no limit on how
  many may be taken.
- Each cheat stays catchable only inside a narrow window. Tampering with `Direction`, slipping a card
  onto the table, and taking one back off it are properties of the turn they happened in, so they
  close when that turn ends. The other three are properties of a play, and are catchable during the
  turn immediately after it.
- Nobody is ever told a cheat happened. Playing more cards than you declare announces the declared
  count, a slipped card is placed in silence, a card taken back simply stops being there, and a
  change of `Direction` is never written down at all — the arrow simply points the other way. Every
  accusation is a guess.
- A player who takes a card back on their own turn cannot act again immediately. Their own actions
  are held for two seconds, so the gap they have just left in their pile sits there long enough to be
  noticed rather than being closed by ending the turn in the same breath.
- The one thing the table does see is who touched the direction sign: the block of whoever flipped it
  leans toward the middle of the table and settles back. That happens on every flip, including
  `The Cat`'s legal one, and it says nothing about whether the flip was allowed — working that
  out from the flipper's character and whose turn it is remains the accuser's problem. It is also
  the only word on the subject, and it is gone as soon as it has played: a player looking elsewhere
  has nothing to go back and read.
- The rule card deliberately does not list the six cheats, so a player has to learn them from the
  characters that use them rather than from the card.

### Joker Rule
- Jokers function as wild cards.
- A Joker is treated as having the same rank as the trump rank.
- Jokers do not contribute to the Reverse Rule.
- In particular, a Joker does not count as one of the cards needed for the Reverse Rule to trigger.
- Jokers also do not count toward 4-of-a-kind scoring.

## Point System
- Whenever a player gets any card or cards into their hand, a 4-of-a-kind check happens immediately.
- This includes the initial deal, taking cards as punishment, receiving cards from `Call Reset`, and any other effect that adds cards to hand.
- Whenever a player has 4 cards of the same rank in hand, that player must immediately remove those 4 cards from hand and gain 1 point.
- If a player has 8 cards of the same rank, they remove 4, gain 1 point, then remove the other 4 and gain another point, for 2 total points.
- Jokers do not count toward 4-of-a-kind scoring.
- Removed 4-of-a-kind sets are not returned to any player's hand under any circumstance.
- Those removed sets remain on the table in a permanent scored area that is separate from the active round table.
- Scored 4-of-a-kind sets do not count toward any active table interaction, including `MaxCardsOnTable`, `Call Reset`, the Reverse Rule, or any other effect that checks cards currently on the round table.

## Rule Cards
- Every rule above is also a card, so that a rule can be shown to players and, eventually, changed by
  a character's ability.
- Each rule card has a status: `Active`, `Removed`, or `Upgraded`.
- Every rule card starts `Active`.
- An `Upgraded` rule card's title is written with a trailing `+`, such as `Pass Ending Rule+`.
- A rule card can only take a status it defines. Some rules may not be removed, and most may not be
  upgraded.
- `Removed` is enforced. A removed rule genuinely stops applying for the rest of the match, at the
  moment it is removed.
- `Upgraded` is not enforced yet. An upgraded card is shown to players with its `+` title and its
  upgraded description, but the game still plays the rule as written above.
- `The Broken` removes one rule card at the start of the game. Only a rule that defines a `Removed`
  variant can be chosen, and only one that is still `Active`.
- `The Prototype` destroys one heart card from their hand and one random rule card with the `Defy`
  action, once per round. The card must be of the heart suit; no other card, joker included, can pay
  for it. The rule is drawn from the same pool `The Broken` picks from: rules that define a `Removed`
  variant and are still `Active`. `Defy` is unavailable once that pool is empty, or once the hand
  holds no heart.

| Rule Card | Removed | Upgraded |
| --- | --- | --- |
| Reverse Rule | yes | no |
| Pass Rule | yes | no |
| Joker Rule | yes | no |
| Max Cards On Table Rule | yes | yes |
| Max Cards Per Play Rule | no | yes |
| Direction Change Rule | yes | yes |
| Pass Ending Rule | yes | yes |
| Reveal Rule | yes | no |
| Leave Game Rule | no | yes |
| Final Ranking Rule | no | yes |
| Call Reset Rule | no | yes |
| Rank Change Rule | yes | no |
| No Cheating Rule | yes | no |

### Removed Rule Cards
- `Reverse Rule`: the cards on the table never reverse a punishment. Whoever the default names takes
  it, however many trump-rank cards are showing. `The Contrarian` still reverses their own calls —
  that layer is the character's, not this card's.
- `Pass Rule`: `Pass` is not an available action. Every turn has to be resolved some other way.
- `Joker Rule`: Jokers have no rank at all, so any play containing one is always a lie.
- `Max Cards On Table Rule`: the table has no limit, and a play may push it to any size. `Call Reset`
  still unlocks at the original `MaxCardsOnTable` value.
- `Direction Change Rule`: `Direction` never changes on its own between rounds.
- `Pass Ending Rule`: consecutive passes never end a round.
- `Reveal Rule`: played cards stay face down. Nothing is revealed at the start of a turn.
- `Rank Change Rule`: the same trump rank may be chosen in consecutive rounds.
- `No Cheating Rule`: anyone may cheat, and anyone may be accused of it. Every player gains all five
  cheats listed under the rule above. Nothing else changes: the windows are the same, the silence is
  the same, the direction tell is the same, and each player still gets one accusation per round.
  The card itself says only the first sentence — spelling the cheats out on a card everybody can
  read would hand new players a checklist and take the discovery out of it.

#### Character Interactions With Removed Rules
A removed rule takes any ability built on top of it with it. This is a consequence of the removal,
not a special case:
- `Pass Rule` removed: The Foreigner has no way to use their ability, and The Streamer's leave
  penalty becomes unavoidable. It can also take The Clown's second action away, since `Pass` is how
  a kept turn is ended: with nothing to challenge and a table short of its cap, the turn is not kept
  at all and the play ends it as usual.
- `Joker Rule` removed: The Confused's Jacks are worthless too, because the ability makes them
  function as Jokers and a Joker is now nothing.
- `Reveal Rule` removed: The Spy has nothing to modify, since their ability only ever chose how much
  of the start-of-turn reveal happened. Taking a card back off the table goes with it, for the same
  reason running the other way: only face-up cards may be taken, and with no start-of-turn reveal
  nothing reaches the table face up in the first place.
- `Rank Change Rule` or `Max Cards On Table Rule` removed: the matching Dreamer cheat stops being a
  cheat, so the play is honest and `Accuse` cannot catch it.
- `Call Reset Rule` is the rule The Gambler overrides, and it is the one rule card that cannot be
  removed, so the showdown has no removal interaction at all. It simply replaces the redistribution
  for as long as that character is seated.
- `Reverse Rule` removed: The Contrarian is the exception that proves the rule above. Their layer is
  written on their own card and reverses their calls whatever this one says, so removing it does not
  disarm them — it makes them the only thing that ever reverses a punishment.
- `No Cheating Rule` removed: The Dreamer is left with an ordinary seat, because their whole ability
  was being the exception to that rule and everyone is now the exception. This is the same mechanic as
  the entries above, running the other way: it universalises the ability instead of deleting it.
  The Cat is the one character it partly cuts across — their own-turn flip is still the only
  legal one, and it is still the only flip that leaves nothing for `Accuse` to catch, but reaching
  into somebody else's turn now makes them a cheat like anyone else.

### Upgraded Rule Cards
- `Max Cards On Table Rule+`: `MaxCardsOnTable` is doubled for every player count.
- `Max Cards Per Play Rule+`: a play puts down at most 3 cards at a time instead of 2.
- `Direction Change Rule+`: `Direction` no longer flips on its own. It carries over from the last
  round, and the starting player sets it on their first turn of the round by clicking the direction
  arrow, the same way The Cat does.
- `Pass Ending Rule+`: the round ends after `2n` consecutive passes instead of `n`.
- `Leave Game Rule+`: running out of cards no longer removes a player. A player leaves when they make
  a successful BS call while holding no cards, meaning they called BS and the challenged player was
  punished as a result. A player with an empty hand may still take any action except `Play`. If every
  player starts a round with an empty hand, everyone leaves at once, in turn order beginning with the
  player whose turn it is.
- `Final Ranking Rule+`: points are ignored. Placements compare leave order only, and leaving earlier
  ranks higher.
- `Call Reset Rule+`: `Call Reset` no longer gathers, shuffles, and redistributes. Each player simply
  takes back the cards in front of them. The caller still becomes the starting player of the next
  round.

None of the upgraded variants above are enforced yet.

## Final Ranking
- First place goes to the player with the fewest points.
- Lower points are always better.
- If players are tied on points, the player who leaves the game earlier ranks higher.
- Final placements are determined first by points, then by leave order.
- This is intentional: leaving the game earlier means you can no longer gain more points, and it also helps in tie-breaks.