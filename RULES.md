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
4. Check whether the Reverse Rule applies.
5. The punished player takes all cards on the table.
6. The round ends and a new round begins.
7. The unpunished player, among the caller and the accused player, becomes the starting player of the next round.

### Reverse Rule
- After `Call BS` is used and every card on the table is face up, check the trump rank selected by the starting player of the round.
- If 4 or more cards of that rank are on the table, the punishment is reversed.
- Example: if player `X` calls BS on player `Y` and `X` would normally be punished, then `Y` is punished instead. If `Y` would normally be punished, then `X` is punished instead.

### Call Reset
- This action immediately ends the round.
- This action is only available if `MaxCardsOnTable` is reached.
- Flip all cards on the table face up.
- Shuffle all cards on the table together.
- Deal those cards evenly and randomly to every player currently still in the game.
- Each player adds the cards they receive to their hand.
- If the number of table cards is not divisible by `n`, the player who called `Reset` receives the extra cards.
- The player who called `Reset` becomes the starting player of the next round.

## Other Rules

### Leave Game Rule
- At the start of every new round, before the first turn begins, each player with no cards in hand immediately leaves the game.
- During a round, if the current player starts their turn with no cards in hand, that player immediately leaves the game.
- Before that exact moment, the player still counts toward `n`, pass counting, `MaxCardsOnTable`, and next-round setup.
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

## Final Ranking
- First place goes to the player with the fewest points.
- Lower points are always better.
- If players are tied on points, the player who leaves the game earlier ranks higher.
- Final placements are determined first by points, then by leave order.
- This is intentional: leaving the game earlier means you can no longer gain more points, and it also helps in tie-breaks.