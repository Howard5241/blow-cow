# Blow Cow RL — Ante Mode

Reinforcement learning for **Ante Mode**: first one round at five seats, the smallest piece of Blow
Cow that is still the game, and then a whole multi-round match. Agents from both layers ship in the
browser as the practice bots.

`rl/README.md` is the classic-mode work, and its diagnosis — arrived at over four stages and one
retired intervention at a time — is **credit assignment**: an auxiliary head supervised on the truth
learns to read a lie to 78-85% accuracy inside 12k decisions, while 2.5M decisions of placement reward
bought +0.8 points of call discrimination. Handing the answer over as a precomputed input changed
nothing, which is the direct test that closed the case.

This package attacks that by changing the problem rather than the method. One Ante round is a complete
decision problem whose reward arrives **at the end of the round** — five to ten turns — instead of
being folded into a final placement across ninety of them. **That worked**: the same architecture, the
same loss and the same observation that learned almost nothing about reading a lie in the full game
learn it here in a tenth of the budget, reaching **+35 call discrimination within 115k decisions**
where classic PPO reached +0.8 in 2.5M.

Two later findings reframe what remained:

* **The real ceiling is extraction, not information.** A supervised probe on the round agent's own 200
  features ranks a lie at **0.851** AUC where the trained policy's own `Call BS` probability manages
  **0.675**, and **0.401 — below chance — against a bluffer**. PPO with a sparse reward learns a far
  worse lie detector than supervised learning does on identical inputs.
* **At the shipped config the match layer has almost nothing to do.** Ante's gold economy is
  inflationary, so at 5 starting gold a competent table sees an elimination in 0.3% of matches and the
  acting seat is on its last coin in 1.4% of decisions. See "Two levers, and the config decides which
  one exists".

---

## The subgame

Five players, one round, and the gold that moves is the reward:

| | |
| --- | --- |
| `+1` | winning the round, by any of the three endings |
| `-1` | losing a `Call BS` |
| `0` | everyone else |

That is literally `RULES-ANTE.md`'s economy, not a shaped proxy. Two of the three endings mint a gold
and only `Call BS` takes one away, so the reward is **not zero-sum** — which is the mode's design.

Five seats draw seven standard ranks plus two Jokers: a 30-card deck, six cards each.

### Why this is a better-posed problem than the classic game

* **The reward is close to the decision.** A round is 5-10 turns and 1-3 decisions per seat. A `Call
  BS` is answered immediately. This is the whole point.
* **Every episode terminates, and the arithmetic proves it.** Hands only shrink, and `n` consecutive
  passes end the round, so between any two plays there are at most `n - 1` passes. There is no move
  limit, nothing to truncate, and no way for a policy to stall. The classic environment had to *score*
  truncation because an agent could refuse to finish; here the option does not exist.
* **No discounting is needed, or wanted.** The reward is terminal and the episode is finite, so
  `gamma` is 1 and the Monte-Carlo return **is** the terminal reward. GAE at `lambda = 1` reduces to
  exactly that, so the advantage is `R - V(s)` with no bootstrap anywhere. Both of the classic
  trainer's stalling pathologies were consequences of the two things this deletes.
* **The state is small enough to be exact.** 30 cards, 8 card types, 398 actions.

### What the mode drops

Everything `CHARACTERS.md` covers, plus rule cards, statuses, action ranks, cheating, the point
system, `MaxCardsOnTable`, `Call Reset`, the Leave Game Rule, the Rank Change Rule and the Direction
Change Rule. What is left is five actions and one hidden fact.

---

## Layout

```
rl/
  ante/
    config.py             seats, ranks, and everything derived from them
    game.py               the round: rules, endings, legal actions, the counting estimate
    spaces.py             the flat action space and its index arithmetic
    observation.py        the 200-feature round encoder
    env.py                the one-round self-play environment
    agents.py             the five scripted baselines
    nets.py               the policy/value network and the checkpoint wrapper
    match.py              the match: gold, elimination, the deck resize, the public record
    match_observation.py  the 298-feature match encoder (the round's 200, plus 98)
    match_env.py          the whole-match environment, with incremental reward
    match_agents.py       match checkpoints, the one-round control, and the guard transcriptions
  ante_conformance.py     lockstep against the real engine, one round or a whole match (CLI)
  ante_check.py           the round encoding, held to the round simulator (CLI)
  ante_match_check.py     the match layer, held to the round layer (CLI)
  ante_train.py           PPO self-play over one round (CLI)
  ante_match_train.py     PPO self-play over a match, with per-seat GAE (CLI)
  ante_evaluate.py        one-round head-to-head and round-robin (CLI)
  ante_match_evaluate.py  match head-to-head and mixed tables (CLI)
  ante_match_probe.py     criticality, and what a match policy encodes (CLI)
  export_ante_round.py    checkpoint -> model_weights/ blobs, round and match
  dump_ante_bot_cases.py  fixtures for the TypeScript port
```

The one-round files are the **control**, and are deliberately untouched by the match work:
`ante_train.py` still produces the agent every multi-round result is read against, and
`match_observation.py` appends its block after the round's 200 features rather than reworking them, so
a one-round checkpoint is still loadable and still sees exactly what it was trained on. The `round
slice` check in `ante_match_check.py` holds that to being true rather than intended.

`rl/oracle/blowcow-oracle.ts` is shared with the classic work. It gained three optional setup fields
(`gameMode`, `roundLimit`, `startingGold`) and, **only** when the match is Ante, two projection keys
(`gold` and `selectedRanks`). A classic `new` sends none of them and gets byte for byte the projection
it always did.

Run directories are under `rl/runs/`. The cohort directories (`_chal/`, `_gen2/`, `_gen3/`, `_gen3r/`,
`_gen4-3p/`, `_lie_feed/`, `_lie_gen3/`, `_lie_pool/`, `_lp2/`, `_mrf/`, `_optimiser/`,
`_recheck/`, `_round_fix/`) hold the raw evaluation
outputs, a `train.sh` and an `evaluate.sh`; most also carry a `PROTOCOL.md` (or `ROLLOUT.md` at
`_gen3r/`) with the recipe and a `RESULTS.md` with the reading, and `_gen2/SHIPLIST.txt` records what
generation two shipped — with the caveat about its 6-seat row under measurement rule 6.

## Running it

```bash
npm run check:rl:ante          # lockstep against the engine, with mask probing
npm run check:rl:ante:env      # the encoding, the reward, and two symmetry claims
npm run check:rl:ante:match      # lockstep over 30-round matches, at 1 gold so seats actually go out
npm run check:rl:ante:match:env  # the match layer held to the round layer

npm run rl:ante:train -- --steps 3000000 --run rl/runs/ante-v1
npm run rl:ante:eval -- --agents ckpt:rl/runs/ante-v1/final.pt heuristic --games 800
npm run rl:ante:match:train -- --steps 2000000 --rounds 20 --run rl/runs/m-ante-v1

# a population rather than a ladder: seat other lineages permanently in the pool
npm run rl:ante:train -- --steps 3000000 --pool-init rl/runs/ante-v1/final.pt rl/runs/ante-v1-s2/final.pt

# exploitability: a fresh learner in one seat against four frozen copies of the target
python rl/ante_train.py --steps 800000 --exploiter --opponent ckpt:rl/runs/ante-v1/final.pt \
  --run rl/runs/x-ante-v1

# the mixed table, which is the protocol to trust: five different agents, seats rotated
python rl/ante_match_evaluate.py --games 1000 --seed 11 --rounds 20 --gold 5 --table \
    round:rl/runs/ante-s2-long/final.pt ckpt:rl/runs/m2-5p/final.pt ...

# is there anything for the match layer to do at this config, and does the policy encode it?
# `round:` and any ablation arm are the negative controls: they must come back at ratio 1.00.
python rl/ante_match_probe.py --games 200 --gold 5 --rounds 20 --agents ... --field ...
```

**Seating an ablation checkpoint.** `BLOWCOW_ANTE_NO_RECORD` is what a *training* run sets, and it can
only ever be the default: it is a process global, and a table may hold an ablation arm and a
record-reading arm at once. A run trained under it stamps `record_features: false` into its checkpoint
and `ckpt:` blinds that seat alone. The two runs written before the flag existed —
`m-ante-norecord` and `m-warm-norecord` — carry no stamp and must be seated as `norecord:<path>`,
since the ablation zeroes columns rather than dropping them and nothing about the file gives it away.

`--gold 1` in the conformance check is not a weakened test: eliminating a seat costs five lost `Call
BS` calls at the default, so at 5 gold a run of any affordable length never reaches the elimination
sweep or the deck resize at all. It is the same code path reached sooner — and the check **fails** a
multi-round run in which nobody was eliminated, for the same reason it fails one that never armed the
Reverse Rule.

**Interpreters.** `ante_conformance.py` has no third-party dependencies and runs on any Python 3.10+
(as do `ante/game.py` and `ante/spaces.py`, deliberately). `ante_check.py` needs numpy; the trainer and
the checkpoint agent need torch. Use the project virtualenv.

**Where to train.** Locally. Three 2M-decision arms ran concurrently in **96-97 minutes each** on 12
cores at `--device cpu`, `OMP_NUM_THREADS=3` per arm; the same 2M took **176 minutes** on a Colab A100
runtime granting the same 12 vCPU. Local is faster per arm, runs a whole cohort in one wall clock,
cannot be reclaimed mid-run, and writes `args.json` where it will be kept. A 1000-match evaluation is
~11 minutes single-threaded and the jobs share nothing. Four concurrent exploiters at three threads
saturate a 12-core box at ~67 minutes each; three at a time leaves headroom.

---

## How to measure things here

Every rule below was paid for by a published claim that later reversed. They are stated once here
rather than at each result.

**1. Zero is not neutral, and the seats are not symmetric.** `Ending 2` and `Ending 3` mint a gold
from the bank and only `Call BS` takes one away, so a table sums to `+1` on a round that ends without
a challenge. The table average is `P(no challenge) / 5`, not zero. And seat 0 opens the round while the
last seat takes a free round if everyone passes — five `heuristic` bots at one table score
`-0.256, +0.311, -0.051, +0.071, -0.075` by chair. Every protocol rotates seats; a number taken without
rotation is measuring the chair. Together those mean **the reference for exploitability has to be
computed, not assumed to be zero**: it is what the target itself scores in the challenger seat against
four copies of itself, which by symmetry is exactly the table mean.

**2. Never rank on a one-vs-fixed-field score.** That protocol measures how well the challenger
bluff-exploits whatever sits in the other four chairs, and it has produced a ranking that reverses
under a fairer protocol **four times** in this file. Its worst case: seven arms scored against
`round:ante-s2-long`, with score tracking bluff rate almost monotonically (30.0% → +0.823,
38.7% → +1.225, 49.7% → +1.010, 52.7% → +4.549, 54.0% → +2.698, 56.3% → +3.191) because the field is
the very control this file records as best-responded to by bluffing. Use mixed tables, or head to head
in both directions, or exploitability.

**3. Head to head must be two-sided, and compared in the same role.** This file records a 1-vs-4
head-to-head where *both* directions came out negative, which is a challenger chair talking rather
than a policy. It also records a cohort where every arm scored *positive* in both directions, which
cannot mean both are stronger: the **singleton position** — one policy among four identical ones — is
worth about a gold here whichever policy holds it, because a homogeneous field is easier to play
against. The fix is to compare the two policies in the *same* role.

**4. Read within one mixed table only.** Three tables linked by shared contestants had the control
anchor at +1.043, −1.433 and −0.601 while a shared arm went +2.314 → +3.849. The two shared
contestants move in *opposite* directions, so the tables are not related by an additive shift and no
cross-table subtraction is legitimate. Even a *within-seed within-table* contrast moves by nearly a
gold on which other seed's pair shares the table.

**5. Quote the noise floor, and know which count it came from.** A 1000-match mixed table has a
per-agent error of about **0.1 gold** — two eval seeds agree to within 0.12 on every row, repeatedly.
An 800k exploitability measurement has a floor of about **2.1 gold**, established by three readings of
one unchanged checkpoint (+11.171, +9.074, +10.660). The largest effect this package has ever measured
is the **training seed** — three identically configured arms spanning 2.1 gold — so nothing here is
readable at `n = 1`, and several published claims were.

**That 2.1 is a *five-seat* number and does not travel.** Two readings of `chal-2p-s2` came back
+11.065 and +14.925 — a **3.86-gold** spread on one unchanged checkpoint at two seats, with both
exploiters converged and attacking. Two seats already carries the widest *training* seed spread in the
package (5.8 gold), and its exploiter spread is wider too. Every two-seat exploitability comparison
written before `_chal` was read against a floor 45% too small. Three seats, by contrast, replicated to
**0.47** across two seeds, so the quantity is not uniformly noisy — it is noisier where the game is
smaller. Measure the floor at the count you are working at, or quote the one you have and say so.

**6. An exploitability figure is only valid if the exploiter converged.** A low figure means the
target is sound *or* the best response failed to train, and the headline number does not distinguish
them. Two rules, one of which was itself refuted:

* **A negative `gold_edge` is a failed run, not a safe target.** A best response can always mirror its
  opponent, so it should never finish behind one. `rl/runs/xg2-6p` finished at 0.00% calling, 0.45%
  bluffing and `gold_edge` **−0.428**, and that collapsed run is what made `m2-6p` look like the
  safest checkpoint in the package. Re-measured it is **+6.614**, a 7.0-gold correction.
* **An exploiter that finished near 0% bluffing has measured nothing.** The same rule caught
  `m3r-5p-s2`'s celebrated +1.577: its exploiter bluffed 0.2%, and two further seeds put the target at
  **+2.862 / +3.046**. Treat any such row as unmeasured.
* **Low `explained_variance` alone is *not* a condemnation.** This was written as a third rule and
  re-measurement refuted it: `xg2-7p` (ev 0.31) and `xg2-8p` (ev 0.30) were both flagged and both
  reproduced (`m2-7p` +1.174 against a recorded +1.778; `m2-8p` **+3.726 against +3.776**, agreeing to
  0.05 across two sessions with different flags). Low ev at 7 and 8 seats looks structural — the
  return depends on six or seven other agents — and those exploiters still attacked on one axis. What
  condemned `xg2-6p` was doing **neither** of the two things this game rewards.

Also: exploitability figures are lower bounds indexed by the 800k budget every run here uses, and two
re-runs were **still climbing at 800k**. Comparisons between arms measured the same way hold; absolute
magnitudes do not.

**7. Call discrimination does not predict placement.** Reproduced **seven** times. The best-placed
arm in a table routinely reads a lie at chance while the worst reads it best — `m-warm-long-s2` has
the best discrimination in two tables and the worst gold in both, and the round-only control reads
best of anything at +23.93 and finishes last. In a match, survival beats challenge accuracy.

**8. A behavioural counter taken against the training population is not evidence about play.**
Generation three finished training with better logged discrimination than generation two and read a
lie *worse than chance* against it at the table: the logged number was measuring how well the arm read
its own pool. The same contamination afflicts `call_split` — ablation arms score +1.7 on it while
provably reading nothing, because within-round revealed honesty correlates with the cross-round record.

**9. Placement and gold censor in opposite directions.** Placement saturates when an exploiter
dominates (it is first in nearly every match, so it cannot separate two targets) and gold censors at
`−StartingGold`. Report both and read whichever is not against its wall.

---

## The simulator, and what holds it to the engine

`ante/game.py` is a transcription of `RULES-ANTE.md`, and `ante_conformance.py` makes that claim
checkable. Both sides start from the same deal — the engine is asked what it dealt and the simulator is
dealt exactly that, which is stricter than a shared PRNG because it catches a bug in `dealAnteHands`
rather than reproducing it — and then take the same actions. After every decision the two states are
compared leaf by leaf, and at every decision point the simulator's legal-action mask is probed against
the engine on throwaway clones in **both** directions.

**Compared:** current seat, trump slot, pass streak, the previous non-passing player, every hand as a
multiset of card types, every table play (owner, contents, size, face up or not), every pending reveal
pointer, whether the round is over, and the gold every seat finished with.

| Run | Result |
| --- | --- |
| 250 rounds, transitions only | 1,869 decisions agreed |
| 40 rounds, `--probe fast` | 15,592 mask probes agreed |
| 8 rounds, `--probe full` (every index at every decision) | 25,074 mask probes agreed |
| 24 matches of up to 30 rounds (`--rounds N`) | 706 rounds, 5,947 decisions, 309,866 mask probes, **46 eliminations and 45 deck resizes** agreeing |

Three things in the engine had to be learned rather than assumed, and each is a comment in the harness
now: card ids are prefixed **per round** (`dealAnteRound` uses `r${roundNumber}`); the engine deals the
next round *inside* the move that ends the current one, so the engine must be moved first and the
simulator second; and `finalizeGameForLastRemainingPlayer` marks the **last survivor** as having left,
so `hasLeft` and "went bankrupt" stop meaning the same thing at exactly the final round.
`resizeAnteDeck` drops ranks at random, so the harness reads `selectedRanks` back every round rather
than deriving them.

### Two abstractions, and why they are earned

**Cards are card *types*.** A card is its rank slot `0..6`, or the Joker. Suits do nothing in Ante — no
characters, no action ranks, no cheats — so every place a card is inspected asks only "is it the trump
rank" or "is it a Joker". Two cards of one rank are interchangeable everywhere, which lets a hand be a
vector of counts and the whole state be a few hundred bytes.

**Seats are indexed in turn order,** so the next to act is always `+1`. Ante fixes `Direction` at
counterclockwise for the whole match, so the engine's ring is this ring read backwards, and the
conformance harness is the one place that translates.

### One bug worth recording, because it was invisible

`normalizeSelectedRanks` sorts what the lobby sends, and `BLOW_COW_RANKS` puts **Ace first**. The
harness initially assumed its own `2..A` order, so `deckOrder % R` named the wrong rank —
*consistently on both sides*, since the harness used the same map to choose which card to send. Every
state comparison passed. The only thing that ever disagreed was a `Call BS` verdict, because that is
the one question whose answer depends on what a card actually is.

The fix is not the sort order. It is that `Table` now reads `selectedRanks` back **from the engine**
rather than assuming it. The general shape: **a comparison between two things that share an assumption
cannot test the assumption.**

---

## The encoding

### Action space — 398 indices

```
0              Pass
1              Call BS
2   .. 45      Play(card choice)                       44 choices
46  .. 397     Select trump slot and play(choice)      8 x 44
```

A card choice is one type or an unordered pair (a pair of one type meaning two cards of that rank):
`8 + 36 = 44`. Trump slots are the seven in-deck ranks plus **one representative** of the six that are
not: naming an off-deck rank is legal and is a real option — every play of the round becomes a lie
unless it is a Joker, and the Reverse Rule can never arm — but all six are the same move, so offering
each would split a policy's probability across identical actions.

### Round observation — 200 features

| Block | Size | Contents |
| --- | --- | --- |
| Global | 16 | trump selected / off-deck, pass streak (scalar and one-hot), **pass wins now**, table fill, known trump on table and whether the Reverse Rule is armed by it, face-down table cards, own hand size, unseen total, turn index |
| Per card type | 8 x 7 | is-trump, is-Joker, own count, own count is zero, face up on table, **unaccounted**, unaccounted is zero |
| Per seat | 5 x 16 | is-me, is-current, hand size / empty / one / two, cards face down and face up in front, is-last-non-passing, is-BS-target, **claim pending**, claim size, **analytic lie probability**, plays revealed as lies and as honest this round, turns until they act |
| Recent events | 8 x 6 | actor offset, play / pass / reveal, card count |

**Rank identity needs no per-episode bijection.** The classic encoder hides thirteen *named* ranks
behind a random relabelling so a policy cannot learn that "slot 0 is Aces". Here the simulator numbers
its ranks `0..R-1` and the deal is symmetric under permuting them, so there is nothing to hide. `rank
relabelling` asserts it both ways: permuting the ranks moves the observation only by permuting its
per-type rows, and the same episode played through the permutation reaches the same winner and reward.
That check is also what licenses the browser port mapping card types through `deckConfig.selectedRanks`
in its own order.

**`pass wins now` is handed over because it is a rule, not an inference.** With `n - 1` passes
standing, `Pass` ends the round and the passer wins it — a dominant action following from `Ending 2`
rather than stated anywhere as a rule of its own. `pass ending` asserts it.

**The revealed-honesty counters are public and load-bearing.** The Reveal Rule turns your previous play
face up at the start of your next turn, so the table finds out who has been lying. That is the one
channel through which behaviour becomes observable inside a round.

**The analytic lie estimate is present and is not a signal against trained opponents** — AUC 0.42-0.51,
at or below chance, because it assumes the hidden cards are a uniform draw from the unseen pool, which
is exactly wrong for a player who chooses what to play. `BLOWCOW_ANTE_NO_LIE_FEATURE=1` is the control,
zeroing the column at unchanged width.

### Match observation — the round's 200, plus 98

`match_observation.py` **appends** rather than reworking, which is what keeps a one-round checkpoint
loadable: `match_agents.RoundOnlyAgent` seats one by slicing the prefix, and the `round slice` check
holds the two encoders to producing an identical block. The 98 carry gold, elimination, rounds left,
and the cross-round public record of who has been caught lying and who has called.

**`RECENT_EVENTS` never scaled with the table.** It was 8 in every run ever made, under a comment
reading "long enough to cover a lap of the table plus the reveals inside it". That is true at five
seats and **false above them**: a lap is `n` plays and the Reveal Rule turns each seat's previous play
face up at the start of its next turn, so a lap generates about `2n` events. At seven and eight seats
the window is under half a lap — exactly the counts where the rollout shipped nothing and where the
match layer matters most. `AnteConfig.recent_events` now carries it, defaulting to 8 so every existing
checkpoint and the TypeScript port are untouched, with `--recent-events lap` opting into `max(8, 2n)`.
Untested. `event window` holds three things, and the second matters: **the narrow encoding is an exact
prefix of the wide one's round block**, because event rows are newest-first and last in that block — so
a *round* agent can slice a wide table's vector and a *match* agent cannot, since its match block has
moved (`MatchCheckpointAgent` re-encodes from the live match for that case). **Three guards had to come
with it**: a wider window grows the round block *in the middle*, so `load_round_weights`' right-hand
padding would slide every seat and match column onto the wrong inputs and train on nonsense without
erroring. `--init`, `--resume` and `--pool-init` all refuse a window mismatch outright. The consequence
for experiment design is real: **a wide-window arm cannot be warm-started from anything that exists**,
so the first A/B has to be from scratch against a common pool.

### Nothing private leaks, and the baselines are held to it too

`hidden information` reshuffles every card the viewer cannot see — the other seats' hands and their
face-down piles, keeping every public size — and requires the observation not to move by one bit.

`scripted agents` gives the five baselines the same test. They read the *position* rather than the
vector, which is convenient and is also exactly how a yardstick quietly ends up peeking at a hand it
cannot see and setting the bar somewhere no honest policy can reach.

---

## The network

285k-ish parameters, and three structural choices.

**A shared encoder over the eight card-type rows,** so the network is structurally indifferent to which
slot a rank landed in. Rows are pooled into the trunk and kept per-row for the head.

**A factored action head with the honesty structure supplied.** A flat head over 398 logits would have
to rediscover that `trumpPlay(slot 3, two of type 3)` and `trumpPlay(slot 5, two of type 5)` are the
same decision. Instead a trump-play logit is a per-slot logit plus a per-choice logit plus a learned
gate over a **static** table saying, for each (slot, choice), how many of those cards would be trump.
The table is exact, costs nothing, and covers the one thing a trump-selecting play turns on that the
observation cannot show: the candidate rank is not marked as trump, because it is not trump yet.

**An optional auxiliary honesty head** (`--lie-coef`), trained by BCE on the free labels the game hands
over a few turns later when the cards go face up. It is **training-time only** in the configuration
that ships: with `lie_to_policy` off, `_compute` computes the honesty logit and feeds it to nothing, so
`export_ante_round.py` drops the four `lie_head.*` tensors and `anteNet.ts` needed nothing. Verified
bit-identical on the shipped checkpoint — 600 positions, 0.0 change in logits and value.

**And a second auxiliary head on the same principle** (`--challenge-coef`), predicting *will the play
I am about to make be challenged*. It is the **dual** of the one above — that head represents "is the
opponent lying", this one "how suspicious does this table find me", and a bluff decision turns on the
second. Three things about it:

* **It feeds nothing, unconditionally.** There is no `lie_to_policy` equivalent, because that feed was
  measured and is not the lever. So a network carrying it is bit-identical in policy and value to one
  without, `export_ante_round.py` drops `challenge_head.*` exactly as it drops `lie_head.*`, and an
  arm carrying it **ships without a line changing in `anteNet.ts`**. `challenge head` in
  `ante_match_check.py` holds all of that, including refusing to pass if the head predicts nothing.
* **The label is deferred rather than privileged.** Whether a play is challenged is not known when it
  is made, so the trainer keeps one slot per environment — `bs_target()` is by definition the last
  non-passing player, so exactly one play is challengeable at a time and a pass never changes which —
  and writes `1.0` back when a challenge lands. A play nobody challenges keeps the `0.0` it was born
  with, which is the correct label and not a default.
* **It is conditioned on the state, not on the action**, because the trunk is computed from the
  observation and the observation does not contain the action about to be taken. What it estimates is
  therefore `P(challenged | position, policy)`, not the challenge probability of one specific play. An
  action-conditioned version would need a head over the action space. Stated as a limitation because
  it is one; it is also the reason the quantity is well-posed at all.

### `load_round_weights`, and why the fix had to be exact

Appending the match features widened the first trunk layer, so early match arms could not be
warm-started from a round checkpoint at all — which confounded "the match layer plus a weak round
policy" against "no match layer plus a strong one", and round-level play is most of the game.
`load_round_weights` copies a one-round checkpoint into the wide first trunk layer and **zeroes** the
match block's columns. At step zero the match network is then not "initialised from" the one-round
agent — it *is* that agent, since the 98 extra features multiply by zero and cannot move a logit.

`warm start` in `ante_match_check.py` holds that over a randomly initialised network so it needs no
artifact on disk; a direct check against the real checkpoint agreed on 9,259 positions with a maximum
logit difference of exactly `0.000e+00`. The check makes **two** comparisons and only one can be exact:
same network, same observation, match block populated versus zeroed is an identical matmul either way,
so any difference at all is the 98 features moving a logit — held to the bit. Comparing the warm
network against the *narrower* one it was loaded from is a matmul over 306 inputs against one over 208,
so summation order differs and equality holds only to float32 (`0.000e+00` here, `3e-8` on a Colab
A100); requiring bit-identity there would assert something about the host's BLAS, so it is held to
`1e-5`.

**The value head is the one part that must not transfer, and the first warm run proved it.** A round's
return lives in `{-1, 0, +1}` read through `1.0 * tanh(...)`; a match return spans the number of rounds
and is read through `value_scale * tanh(...)`, which is 20 at the default. Carrying the old weights
over multiplies every prediction by 20 — not a miscalibration training shrugs off but a value function
answering a different question. Measured: `explained_variance` of **−2.9 to −4.5** with `value_loss` an
order of magnitude high. `load_round_weights` resets it by default, and the check requires the policy
to be bit-identical under *both* loads and requires the reset to actually move the value.

**`--init` from a *match* checkpoint carries the value head over**, which is the opposite call and the
right one: that critic already answers this exact question at the same scale and is the slowest part of
the network to fit. Measured on the recursion: `explained_variance` starts at **0.511** instead of
**−0.69**, and `gold_edge` starts where the predecessor finished. `--init` says which it did.

The same `COLUMN_PADDED` trick extends to the two `lie_to_policy` head tensors, so a `lie_to_policy`
network *is* the network without it at step zero — verified on the real artifact, identical in both
policy and value over 828 positions, to the bit.

---

## Sub-task one: the round agent

Two seeds, 3M learner decisions each, five seats, `--self-play-prob 0.45 --baseline-prob 0.25` over a
pool of 8 snapshots and the four scripted bots. ~2,900 learner decisions/s on a GTX 1050, so about 17
minutes a run; the environment alone does ~6,700 decisions/s single-threaded with observations encoded
and is the bottleneck.

**It beats the handcrafted bot in both directions** — 800 rounds each way, seats rotated: the agent
scores **+0.190 ± 0.023** against four `heuristic`, and `heuristic` scores **−0.695 ± 0.023** against
four agents, losing a BS call in **80.8%** of rounds. This is the comparison the classic work never won,
where 2.5M steps of PPO finished at −0.20 against `heuristic` and the handcrafted bot won every
head-to-head in the repo. Full round-robin by challenger-seat average: learned agent **+0.519**,
`heuristic` +0.231, `honest` +0.150, `random` −0.073, `caller` −0.115, `liar` −0.143.

**Call discrimination is the number the classic work could not move.**

| agent | call discrimination | discretionary bluff% |
| --- | --- | --- |
| classic PPO, 2.5M decisions | +0.8 | 32.5 |
| classic `heuristic` (handcrafted) | +5.4 | 0.0 |
| classic R-NaD | −5.5 | 57.7 |
| **Ante agent, in training against the pool** | **+28 to +41** | **0.0** |
| **Ante agent, vs four `heuristic`** | **+19.0** | 0.0 |

It reaches +35 within **115k decisions**. **That is the result this package was built to test, and it
is unambiguous.** The critic moves with it: 0.19-0.47 explained variance from early on, against a
classic value head that was worse than answering zero for the first third of a match.

### The seed gap was a compute gap, and the interesting behaviour arrives late

Seed 1 never lies when it holds trump; seed 2 lies about a quarter of the time and is the stronger of
the two head to head. **This was first written up as seed variance and that reading was wrong.** Seed
2's discretionary bluff rate only leaves zero after 2.2M steps and was still climbing at the cutoff —
0.0, 0.3, 0.0, **5.6**, **11.7**, **21.3** across 1.75M to 3.00M — and **entropy rises while it does**,
0.114 to 0.225. The policy is climbing back *out* of a basin, not drifting within one; seed 1 sat at
entropy 0.07-0.11 and bluff 0.0 at the same point and never left. So they are one run that found a
second strategy and one that had not yet. **Check whether a run has stopped before calling the gap
between two of them variance.**

`runs/ante-s2-long` is seed 2 resumed for a further 4M decisions — 7M cumulative. The bluff rate
settled rather than kept climbing (17-36%, mean ~27%) and **entropy stopped collapsing**, holding
0.18-0.28 for the whole run instead of decaying to 0.07 as every other run did: the signature of a
policy that has found a mixture it wants to keep. It is **+0.087 over its own starting point** and
**+0.180 over seed 1**, against a 3M-vs-1.5M comparison that had shown nothing. The compute was not
saturated; the *measurement* was taken on the run that had stopped moving. The mechanism is visible in
the endings — 65% of rounds end without a challenge against four copies of it, against 76% for seed 1.

Ranked, every pair both ways, 250 rounds each way: `ante-s2-long` (7M) **+0.272**, `ante-v1-s2` (3M)
+0.245, `ante-v1` (seed 1, 3M) +0.214, `ante-v2` (`--pool-init`) +0.184, `honest` +0.062, `heuristic`
**−0.535**. Monotone in compute along the seed-2 lineage, with the two non-bluffing runs below both
bluffing ones — and `heuristic`, the bot that won every head-to-head in the classic repo, half a gold
behind the field once every other chair holds a learned agent.

**`eval_heuristic` ranks these backwards**, exactly as in classic mode: it is flat and slightly falling
over the run (+0.158 at 250k, +0.148 at 3M) while head to head 3M beats 250k by **+0.250 ± 0.018**.
That is an independent reproduction, in a different mode, of the correction at the end of
`rl/README.md`.

**Seating a bluffer in the population did nothing.** `runs/ante-v2` is 3M steps with both v1 seeds
permanently in the pool via `--pool-init`. It came out level with seed 1 (0.010 ± 0.025 apart), still
loses to seed 2 by the same margin seed 1 does, and its behaviour did not move either — `call% = 10.0`
and `bluff% = 0.0`, exactly seed 1's numbers. Meeting a bluffer is not the same as being pushed out of
the non-bluffing basin. This is the first of **three** failures of the population lever.

### Exploitability, and what the exploiter is actually doing

800k exploiter decisions each — a quarter of the target's own budget. The reference is computed, not
assumed (measurement rule 1):

| target | self-play endings | reference | exploiter's final score | **exploited for** | above the line from |
| --- | --- | --- | --- | --- | --- |
| `ante-s2-long`, 7M (strongest) | 65% no challenge | +0.130 | +0.383 | **+0.253** | 90k |
| `ante-v1`, seed 1, 3M | 76% no challenge | +0.152 | +0.387 | **+0.235** | 168k |
| `heuristic` | 0% no challenge | 0.000 | +0.407 | **+0.407** | **29k** |

So the learned agent is about **half as exploitable as the handcrafted bot**, and its exploiter needs
six times the budget merely to get above water. Note what the reference column does: reading the raw
scores side by side (+0.387 against +0.407) would have made the two targets look equally exploitable.

**Four times as strong is not less exploitable.** The 7M agent beats seed 1 by +0.180 head to head and
is exploited for +0.253 against its +0.235 — the wrong way round, and by less than the exploiter's own
run-to-run spread, so the honest statement is that they are indistinguishable.

**And the exploit is legible.** Every exploiter converges on the same best response, and it gets more
extreme against the better target: never challenge, and lie — 54.2% bluffing against seed 1 and
**92.4%** against `ante-s2-long`, at 0.0% calling in both. Every agent here reads a lie well (+19 to
+41 discrimination) and challenges on only 8-13% of its opportunities.

**The call rate is correctly calibrated, and a bias on the logit is not the fix.** A constant added to
the `Call BS` logit with nothing retrained is flat in-distribution (five settings within ±0.018 of each
other) and monotone against the bluffer, worth **+0.100** from one scalar at a bias of 5. So calling
more buys nothing against the distribution the agent trained on and something real against one it has
not met.

**But the conclusion once drawn from that sweep was wrong.** It was read as an information horizon — a
single round carries under one honesty observation per opponent, so nothing could separate a 27%
bluffer from a 92% bluffer at any budget. The supervised probe below disproves it. What the sweep is
still right about is that **a bias shifts *how often* the agent calls without changing *what it ranks
first*, and the ranking is what is broken.**

---

## The real ceiling is extraction, not information

The whole match layer rests on one empirical claim, and it is cheap to test without training anything.
Play matches; at every `Call BS` opportunity, record what was knowable about the target and whether
their live claim was in fact a lie. AUC against those labels, 200 matches a row, ~30-50k opportunities:

| population | `cross` (new) | `within` (already had) | `analytic` (already had) | oracle ceiling |
| --- | --- | --- | --- | --- |
| five copies of one policy | **0.492** | 0.523 | 0.456 | 0.507 |
| mixed: two seeds, an exploiter, `heuristic`, `honest` | **0.864** | 0.626 | 0.417 | 0.905 |
| four copies + one exploiter (the exploitability setting) | **0.835** | 0.683 | 0.508 | 0.846 |

`cross` is the seat's lie rate over **completed rounds only** — the genuinely new signal. `within` is
their lie rate inside the current round, which the one-round observation already carries. `oracle`
replaces the estimate with the truth.

* **In pure self-play the record is worth nothing** — 0.492, with the oracle agreeing at 0.507, so
  there is no signal to find rather than a signal being missed. **A self-play-only run cannot learn to
  use this block.** That is a training requirement, not a preference.
* **Against a heterogeneous field it is a strong predictor**, and strong in exactly the setting where
  the one-round agent fails: the exploiter that took +0.100 off it is detectable at 0.835 from
  behaviour alone.
* **The analytic hypergeometric is not predictive against trained opponents.** This retro-explains the
  classic result that handing the lie estimate over changed nothing: it was not too weak a signal,
  against strategic opponents it is not a signal.

**A separate opponent-model network is not worth building for *how often*.** The oracle column bounds
it: a model learning each opponent's lie rate has at most **0.041 AUC** of headroom on a mixed table
and **0.011** in the exploitability setting.

**For *when*, decisively yes.** Training `P(lie | opponent, position)` directly — supervised, on the
free labels every `Call BS` opportunity produces a few turns later — on held-out matches:

| feature set | mixed | homogeneous | one exploiter |
| --- | --- | --- | --- |
| free statistic (1 feature) | 0.852 | 0.491 | 0.836 |
| learned, **round block only** (200) | 0.938 | **0.851** | 0.894 |
| learned, match block only (98) | 0.805 | 0.567 | 0.696 |
| learned, everything (298) | **0.981** | 0.821 | **0.931** |

The homogeneous column is the one that matters, because there the record provably carries nothing — and
a supervised probe on the **round block alone** still reaches **0.851**. That is not opponent
modelling. It is counting and position, on the features the one-round agent has always had.

So how much of that does the trained agent get? Its own `Call BS` probability, ranked against the same
labels on the same positions:

| population | agent's call-probability AUC | supervised probe, identical features |
| --- | --- | --- |
| four copies of itself | **0.675** | 0.851 |
| mixed table | **0.514** | 0.938 |
| one exploiter at the table | **0.401** | 0.894 |

**The agent reads at 0.675 where 0.851 is available from the features it already sees**, and against a
bluffer it reads at 0.401 — *below chance*, actively ranking honest claims above lies. That last number
is the exploit, quantified: the agent does not lack the information to catch the exploiter, its policy
ranks the exploiter's claims backwards. **PPO with a sparse reward learns a far worse lie detector than
supervised learning does on identical inputs**, and the gap is 0.18 to 0.42 AUC.

That is the case for the decomposition, and it is much stronger than the one this package started with.
The honesty predictor has dense, free, exactly-labelled supervision; the policy has a reward several
decisions away confounded by every other choice it made. Splitting them is putting each half on the
training signal it can actually use.

Note that the supervised probe reaching 0.851 uses **the same 2x256 trunk and the same 200 features**
as the policy reading 0.675. Capacity and representation are demonstrably not the binding constraint,
so a wider or deeper network is the *least* promising thing in this package.

---

## Sub-task two: the multi-round match

`ante/match.py` carries three things across a round boundary and nothing else: **gold** (and
elimination at zero), **the deck** (which shrinks as seats are lost), and **the public record** of who
has been caught lying and who has called. No card, hand or table position survives — the whole deck is
redealt.

**The match layer *is* stronger than the round agent, and that is the question the package was built
around.** The bar is two-sided: an arm counts only if it is ahead when it attacks *and* the round agent
is behind when it attacks. `challenger − field` inside the same matches, 1000 matches a side, seats
rotated, at the shipped 20 rounds and 5 gold:

| cohort | arms clearing the two-sided bar |
| --- | --- |
| `m-pop-rec-s{1,2,3}` and `m-pop-abl-s{1,2,3}` (diverse pool) | **6 of 6**, on gold and on placement |
| `m-warm*` (self-play pool, never met the round agent in training) | **6 of 7** |

The seventh is the both-directions-negative chair case, and read as the smaller loss it still favours
the match arm by 2.9 gold. So **thirteen match checkpoints across two recipes and five training seeds
all beat the strongest one-round agent**, including the six that never met it in training. Every seat
count reproduces it later — see the rollout.

**One warning about which arm to ship, and it recurs throughout this file.** Strongest head to head is
not best. `m-pop-rec-s3` wins that table by a mile and is simultaneously the **most exploitable arm in
its cohort** with its own risk sign backwards; `m2-5p` was the head-to-head winner at five seats and
the most exploitable arm in the package. Read head-to-head, the mixed table and exploitability
together.

### What is inside the match layer: null, null, and one thing that worked

Everything measured *within* the layer sits below the seed spread. The record features are the most
thoroughly tested and the most thoroughly null:

| lever | verdict |
| --- | --- |
| the 98 **record features** vs their ablation | null at three gold configs × three seeds × three protocols |
| **training budget** (2M vs 4M) | about **−1 gold**, two independent within-seed comparisons |
| **opponent-population diversity** | doubles how hard the record is read; buys **+0.23 gold**, 4 of 8 contrasts negative |
| **`--placement-weight 3`** | **the first lever in this layer that worked** |
| **`--entropy-coef 0.005`** | wins head to head, **loses the mixed table 4 of 4** — withdrawn |
| the **honesty head** (`--lie-coef`) | +1.5 gold over its own ablation, 6 of 6 — and it ships |
| **`--lie-to-policy`** (feed the head's output to the action head) | negative; the trunk is where the value is |

**The record features, in full, because they were the founding hypothesis.** The last live defence was
that they had only ever been ablated in a homogeneous population where they provably carry nothing. Six
arms (`m-pop-rec-s{1,2,3}` / `m-pop-abl-s{1,2,3}`) tested that with six unrelated strategies
permanently seated. The block **is** read about twice as hard — `call_split` 9.72 against the
ablation's 5.45, where the published self-play-pool pair was 4.34 against 2.21, and every record arm
above every ablation arm. **It converts to nothing**: eight within-seed within-table contrasts mean
**+0.23 gold**, four positive and four negative. And a counterfactual probe confirms the block is
functional rather than ignored — a 5-gold record arm multiplies its call probability by **×4.9 to
×6.6** on a seat forced to twelve straight lies, an absolute swing of +0.14 to +0.31 over 38,140
positions, while every ablation arm and the round-only control come back at exactly ×1.00. So it is not
an information problem and it is not a population problem. **The 98 record features are finished as a
lever on average performance.** What survives of them is the exploitability mechanism below.

**Population diversity also failed to reduce the variance**, which was the other reason to want it: the
record cohort spans **2.69 gold** at fixed recipe and fixed budget, wider than the 2.1 the earlier
cohort spanned under the self-play pool. And the old pool was not beaten — at one seed all five
contestants finish within 0.28 gold of each other, and at the other the old arms win by two to three
gold.

**One caveat that cohort carries and the earlier ones did not.** `round:ante-s2-long` sits in the
`--pool-init` list *and* anchors every table, so all six arms trained against the contestant they are
scored beside; its scores there are depressed by an amount nothing measures. The record-versus-ablation
contrasts are unaffected, since both arms of a pair trained against it equally.

### Two levers, and the config decides which one exists — they are anti-correlated

This is the section that explains every null result above, and it is a property of Ante's economy
rather than of the network, the encoder, the warm start or the trainer.

**Ante's gold economy is inflationary.** Two of the three endings mint a gold from the bank and only
`Call BS` removes one, so a seat's gold does not random-walk — it **drifts upward**. Elimination is a
tail event that gets *rarer* with match length. Five copies of `round:ante-s2-long`, 300 matches a row:

| gold | rounds | matches with an elimination | decisions with any seat on 1 gold |
| --- | --- | --- | --- |
| **5** | **20** | **0.3%** | **0.4%** |
| 4 | 20 | 3.3% | 2.1% |
| 3 | 20 | 9.3% | 8.3% |
| **2** | **20** | **33.0%** | **29.4%** |
| 1 | 20 | 89.0% | 60.1% |
| **5** | **60** | **0.7%** | **0.5%** |

The last row settles it: **tripling the match length does not make gold live**, because the drift is
positive. At the shipped default, total gold is very nearly the sum of twenty independent round
outcomes, and the policy that maximises it is the one-round policy. `ante_match_check.py` has known
this since it was written — it runs at `--gold 1` precisely because at 5 gold no affordable run reaches
the elimination sweep. The trainer was never told the same thing.

Three cohorts trained at 5, 3 and 2 gold on byte-identical recipes make it a ladder:

| | 5 gold | **3 gold** | 2 gold |
| --- | --- | --- | --- |
| decisions with the actor on 1 gold | 1.41% | **6.20%** | 15.26% |
| decisions with any live seat on 1 gold | 6.91% | **26.84%** | 53.76% |
| **record swing** (probe, mean of 3 record arms) | **×5.70** | **×1.68** | ×1.86 |
| **risk sign** (probe, `P(call at 1 gold) − P(call at 2 gold)`) | +0.007, **1 of 3** correct | **−0.007, 3 of 3** | −0.024, 3 of 3 |
| arms' own bluff rate | 22-47% | **51-75%** | 50-65% |
| round-only control eliminated | 3-26% | **72-84%** | 75-89% |
| record minus ablation | +0.23 gold, 4 of 8 positive | −0.28 place, 3 of 6 | −0.02 place, 4 of 6 |

Negative is the *correct* risk sign: losing a challenge on your last coin ends your match.

**The transition is a regime change between 5 and 3 gold, not a gradient.** Every axis moves almost its
whole distance in that one step and then flattens. So:

> **High gold** — the record is learnable and is read hard, but gold is dead, so the match layer's edge
> over the one-round agent is small and the record has little to buy.
> **Low gold** — gold is alive and the match layer's edge is enormous, but aggression pressure drives
> every seat to a 50-65% bluff rate, so a per-opponent record has nothing to distinguish.

**There is no setting where both matter at once**, and the reason is this file's own founding
measurement: a record needs opponents that differ, and scarce gold homogenises them.

What the layer *is*, on this evidence, is a **risk model**. It learns the correct risk sign the moment
the config gives it a gradient, the magnitude tracks criticality, and the payoff is the round-only
control's collapse.

**Seat count is a second knob on the same quantity.** The inflationary drift is one minted gold per
non-`Call BS` round **shared among N seats**, so per-seat drift falls as the table grows. The round
agent's elimination rate when it challenges runs 0.2% at two seats to **92.2% at seven** — so the high
counts are where the match layer matters most, which is fortunate, since those are the tables the round
agent was already weakest at.

### Exploitability: match training buys real robustness; nothing inside it does

Seven exploiters against the 5-gold cohort, 800k decisions each, all sharing `--seed 4`:

| target | gold edge | **exploiter's bluff%** | exploiter's call% |
| --- | --- | --- | --- |
| `round:ante-s2-long` (control) | +10.660 | **94.2** | 8.4 |
| `m-pop-rec-s1` / `-s2` / `-s3` | **+4.039** / **+4.538** / +10.666 | **1.5 / 13.1 / 2.2** | 24.2 / 14.8 / **45.1** |
| `m-pop-abl-s1` / `-s2` / `-s3` | +5.580 / +4.503 / +5.316 | 67.4 / 33.7 / 59.7 | 14.0 / 10.5 / 0.1 |

**The bluff column separates perfectly, 3 for 3, with no overlap** — every record arm forces its own
best response to near-honest play (mean 5.6%), every ablation arm is still bluffed at 34-67%, the
control at 94%. That is the one thing inside the layer to replicate cleanly at `n = 3`. **It buys no
reduction in exploitability, because the attack moves**: `m-pop-rec-s3` is the heaviest bluffer of the
six and its exploiter simply *called* 45.1% of the time for the same +10.7. Which attack is available
is set by the arm's own bluff rate, not by the record.

What is consistent: **five of six match arms are half as exploitable as the round-only control** (4.0-5.6
against 10.7), far outside the noise floor.

### Two more things about the objective and the optimiser

**`--placement-weight 3` is the first lever in this layer that actually worked.** It had sat at `0.0`
in every run ever made, so every match arm maximised **linear gold** — while `RULES-ANTE.md` ranks on
**placement**, where every eliminated seat finishes below every survivor however the gold fell. Linear
gold under-prices the last coin, which is exactly the decision the criticality evidence says this layer
is good at. `placement_rewards()` is terminal and lives in `[-1, +1]` while gold spans roughly ±5, so 3
makes them comparable and 10 makes placement dominant — a dose-response rather than a guess. Head to
head against `ante-s2-long`, mean over three seeds:

| objective | attacking (gold) | defending (round agent attacking) |
| --- | --- | --- |
| **`--placement-weight 3`** | **+7.59** | **−5.31** |
| `--placement-weight 0` (control) | +5.47 | −2.36 |
| `--placement-weight 10` | +4.08 | −2.82 |

It beats the control on both halves and by most on the harder one, the mixed table agrees within a
single table, **and the dose-response is the shape the theory predicted** — 3 helps and 10 does not,
because a large *terminal* reward reintroduces the credit-assignment problem the round decomposition
existed to remove. It also narrows the seed spread (three arms within 0.83 gold defending against the
control's 3.53), which at `n = 3` is suggestive rather than established.

Two caveats that travel with it. Cross-table placement means are not comparable, so that ranking is a
within-table reading plus the head-to-head. And three planned seed-cross tables never ran: the
harness's file-existence guard tested `${spec#*:}` as a path, which is the spec itself for a scripted
baseline, so every table containing `honest` was silently skipped.

**`--entropy-coef 0.005` cuts the seed spread by a factor of ten.** Nothing about the optimiser had
ever been swept: across the 151 runs carrying an `args.json`, `hidden` is 256 in **151 of 151**, `lr`
is 3e-4 in **151 of 151**, `type_dim` 32 in 150, `entropy_coef` 0.02 in 141. Three cohorts had attacked
the seed variance by changing the *population*; the optimiser was never a suspect because it was never
a variable. Two-sided head to head against `m3r-5p-s2`, three seeds a cell:

| cell | s1 | s2 | s3 | mean | **spread** |
| --- | --- | --- | --- | --- | --- |
| baseline, `ent` 0.02, `lr` 3e-4 | +1.393 | +0.552 | +0.397 | +0.781 | **0.996** |
| **`loent`, `ent` 0.005** | **+0.934** | **+0.840** | **+0.904** | **+0.893** | **0.094** |
| `lolr`, `lr` 1e-4 | +1.244 | +1.589 | +0.288 | +1.040 | 1.301 |

It does not cost the mean — it raises it — which is the protocol's stated win condition, written to
refuse a cell that narrows the spread by flattening every arm into mediocrity. All three `loent` arms
also beat the incumbent two-sidedly, which none of the population cohorts managed 3 for 3. The learning
rate is not the lever: `lolr` has the best mean and the worst spread, the ordinary shape of an
under-converged cell.

**Three cautions, and the second matters.** A spread estimated from three samples is itself noisy, so
"ten times" is the right order and not a coefficient. **0.094 is below the ~0.1 noise floor**, so what
has been shown is that the three `loent` arms are *indistinguishable at the resolution of the
instrument*. And this was head-to-head only — no mixed table, no exploitability.

#### The two missing legs have since been run, and both fail

`_optimiser/mixed_table.sh` and `exploit.sh`. One arm per family per table, two tables on disjoint
seeds, two eval seeds each; all four table-by-seed cells agree to ~0.12 gold, re-confirming the floor.

| | table s1 (seeds 11/12) | table s2 (seeds 11/12) |
| --- | --- | --- |
| `m3r-5p-s2` (incumbent) | **+1.974 / +1.911** | **+2.218 / +2.328** |
| `lf-ctrl-s*` (the ent 0.02 baseline cell) | +1.122 / +1.145 | +1.185 / +1.401 |
| `opt-lolr-s*` (`lr` 1e-4) | +0.709 / — | +1.034 / — |
| **`opt-loent-s*` (`ent` 0.005)** | **+0.587 / +0.687** | **−0.116 / −0.237** |
| `round:ante-s2-long` | −0.570 | +0.067 / — |

**`loent` is beaten by its own baseline cell in 4 of 4 cells** and finishes last or next-to-last in
both tables, while the incumbent it "beat" head to head wins both by a wide margin. Exploitability
gives it nothing either — **+5.454 / +2.279** across two seeds against the anchor's corrected
**+2.954**, a 3.2-gold spread that is *wider* than the 2.1 floor and so no evidence of the tighter
distribution the head-to-head suggested. All three exploiters attacked (call 27.4%, bluff 37.9%,
bluff 69.2%) at ev 0.43-0.55, so these are valid by the convergence rule.

So the entropy coefficient is **the fourth reproduction of measurement rule 2**: a one-vs-fixed-field
head-to-head win that reverses under a mixed table. What the low-entropy arms actually learned was to
beat `m3r-5p-s2` specifically. Do not run the next cohort at 0.005; `0.02` remains the default, and
the seed spread remains unattacked.

### Full post-round disclosure changed almost nothing, and has shipped

Carried as `MatchConfig.disclosure` so it was measurable before it was decided, and measured at
**≤0.001 AUC in every row**, for a structural reason: a `Call BS` ending flipped the whole table
already; an `n` passes ending flipped it too *by construction*, since reaching `n` consecutive passes
means every seat took a turn since its last play and the Reveal Rule flipped each one on the way; and
`Ending 3` was the only ending that hid anything — 3.5% of plays under random play and **0%** with
trained agents, because somebody challenges or the round passes out first.

The change has since shipped: `RULES-ANTE.md` now has all three endings turn the table face up, the
engine walks the two non-BS ones through the Reset reveal procedure, and `AnteRound._finish`
transcribes it. The `disclosure` check now asserts the two modes read the same table.
`MatchConfig.disclosure` is kept so saved manifests still load. Note what the measurement justifies: it
says the change costs the *record* nothing, which is why nothing had to be retrained. It was never the
argument *for* the change — that one is about what a player at the table gets to see.

---

## Shipping history: what is in `model_weights/`, and why

Which checkpoint is behind each blob is stamped in its manifest's `source`, which is the thing to read
rather than this section.

| | round policy | match policy |
| --- | --- | --- |
| 2 seats | `ante-2p-v1` | `_chal/chal-2p-s2` |
| 3 seats | `ante-3p-v1` | `m4-3p-s3` |
| 4 seats | `ante-4p-v1` | `_lp2/lp2-4p-s2` |
| **5 seats** | `ante-s2-long` | **`_lie_pool/lp-head-s2`** |
| 6 seats | `ante-6p-v1` | `m3r-6p-s1` |
| 7 / 8 seats | `ante-7p-v1` / `ante-8p-v1` | `m2-7p` / `m2-8p` |

`pickAnteWeights` in the browser returns the **match** network when the room is staged at 20 rounds and
5 starting gold, and the **round** network otherwise. That gate is not a nicety: the match block
normalises `rounds_left` and every gold column by exactly those two numbers, so any other room feeds it
inputs outside the range it was fitted on. It mirrors the refusal `match_agents.py` makes on the Python
side, and the fallback is a real fallback — the round policy plays every room legally.

### The generations

**Generation one** (`m-<n>p`) trained against a **thin** `--pool-init` — one round checkpoint. That is
the defect behind every problem at every count. **Generation two** (`m2-<n>p`) seeded three strategies:
the count's round agent, generation one, and generation one's exploiter. **Generation three by
recursion** (`m3r-<n>p-s*`) is generation two plus 2M further decisions of its own recipe, warm-started
from it, `INIT` the only difference.

Two seats is the clearest reading of the thin-pool defect, because it shipped generation one for a
while by a missed re-export rather than a decision. Head to head, 1,200 matches per cell, both
directions, two seeds: `m2-2p` takes **+9.79 to +9.95** gold and wins 95.0-96.2% of matches, while
`m-2p` goes bankrupt in 7.4-8.8% where `m2-2p` never does. The `disc` column is the tell — `m-2p` scores
**−22** on call discrimination, calling BS *more* often on honest claims than on lies. It is not a
weaker agent so much as an anti-calibrated one.

**Widening the pool with *related* families is harmful.** `m3-5p` added generation two and its own
exploiter to generation two's three, and lost to the generation it was meant to improve on at every
seed in both directions (−1.089 / −1.984 / −2.017 attacking, and beaten by +1.07 to +7.06 defending),
finishing 6-7 gold behind it on a mixed table. The mechanism is measurement rule 8: it finished
training reading a lie *better* than generation two by its own logged number (+24 to +30) and read one
**worse than chance** against it at the table (−7.54, −4.03, +4.84). The extra seeded strategies did
not broaden these agents; they moved them onto a narrower target. This is the third failure of the
population lever, and the first that is actively harmful rather than null. And the caveat runs the
wrong way for the negative, which strengthens it: `m2-5p` sits in generation three's pool, so these
arms trained against the very opponent they lose to.

**Widening with *unrelated* lineages is a different operation and it works** — worth **−8.75 gold** of
exploitability at `pw = 3`, holding the objective fixed (15.86 with a thin pool → 7.11 with a diverse
one, two seeds agreeing to 0.08). Holding the pool diverse, moving the objective from `pw = 0` to
`pw = 3` costs **+2.8 gold**, just outside the floor — a trade to make deliberately rather than a free
lunch. **The pool is much the larger factor.**

### The rollout: 7 of 7 beat their round agent, and 2 of 7 shipped

One arm per count, warm-started from that count's own shipped round checkpoint, 2M decisions,
`--placement-weight 3`, held to the two-sided bar against the agent it was warm-started from, 600
matches a side: **seven for seven STRONGER**, with margins from +1.107 gold at four seats to +18.542 at
eight. But those seven used the **thin** pool, and the five-seat one measured **+15.862**
exploitability against `ante-s2-long`'s +10.660 — markedly *more* exploitable than the agent it beats.
None shipped. That is the fourth time this file records "stronger head to head" and "safe to ship"
coming apart.

The recursive recipe was then run at 2, 3, 4, 6, 7 and 8 seats — three seeds a count, 18 arms, ~10.6
hours locally; `rl/runs/_gen3r/ROLLOUT.md` is the recipe and `summarise.py` reduces the 84 evaluations.
Phase 0 first rebuilt `xg1-<n>p` at 3, 4, 6 and 7 seats, which never survived the Colab VMs that
trained them and without which generation two's pool cannot be reproduced.

| seats | head to head + table | exploitability, arm / incumbent | verdict |
| --- | --- | --- | --- |
| 2 | all three arms pass | **+16.230** / +19.770 | **ship `m3r-2p-s3`** |
| 3 | `s1` only | +16.727 / +15.578 | tie — ship nothing |
| 4 | none; `s1` ties the round agent | +5.293 / +6.822 | tie — ship nothing |
| 6 | `s1` and `s2` pass | **+1.510** / +6.614 | **ship `m3r-6p-s1`** |
| 7 | none; all three lose the table | +2.113 / +1.174 | worse — ship nothing |
| 8 | none; all three lose the table | +1.424 / +3.726 | tie — ship nothing |

**The recursion helps exactly where the incumbent has a leak, and nowhere else.** At 2 and 6 seats the
incumbent was losing 19.8 and 6.6 gold to a best response and both improved sharply; at 3, 4 and 7 the
incumbent was already near its floor and every arm bought nothing real. That is checkable before
spending 2M decisions: **measure the incumbent first.**

**Beating the incumbent is not evidence.** Every count produced arms that beat generation two in both
directions; only two also cleared the round-agent control, kept the mixed table, and were safer by more
than the floor. At 3 and 4 seats the arm with the *largest* win over generation two was the one
furthest behind the control.

Two measurement bugs were found in the reading, both in `summarise.py` and both leniency: selection
ranked on the generation-two margin alone, which would have shipped an arm that loses to the one-round
control in both directions; and point estimates were compared without their standard errors, producing
a 0.021-gold "win" at 7 seats against a 2-sigma threshold of 0.159. Every comparison is now
significance tested and reported as `+`/`=`/`-`, and losing the mixed table is disqualifying. The
margins shrink steadily with seat count — 12.8 gold at 2 seats, 1.2 at 6, 0.02 at 7 — so at the larger
counts the effect is simply smaller than the instrument. Distinguishing arms at 7 and 8 seats would
need several thousand matches per comparison, not a better recipe.

### Three seats, generation four: the leak relocated instead of shrinking

Three seats was the one count where every generation made the agent *more* exploitable, and the
mechanism looked legible: the exploiter beat both the incumbent and the recursion by *calling* — 84%
and 88% accuracy against 1-3.6% bluffing — so both policies lied too readably. `xg2-3p`, the trained
best response to `m2-3p`, is by construction the strategy that punishes that, and no generation had
trained against it. Four arms in `rl/runs/_gen4-3p/`: three warm-started from `m2-3p` with that one
pool member added, one from scratch as a control.

**On play it worked.** `m4-3p-s3` beats generation two, the round agent and the recursion, all
two-sided, and wins the mixed table at both seeds. It is the first trained agent at 3 seats to beat the
*untrained* round agent in both directions (+1.784 and +3.611 against thresholds of ~0.28), which four
previous generations had not managed.

**On exploitability it did not.** 16.020 against the incumbent's 15.578 — a statistical tie, and
nowhere near the 14.965 the untrained round agent measures. The diagnostic detail is the finding:
against `m4-3p-s3` the exploiter's call accuracy drops to 78.6% and its bluffing rises to 20.0%. The
arm's lying really is less readable and calling alone no longer beats it — the attack had to move — but
the total gold extracted is unchanged. **The leak relocated rather than shrank.**

It ships anyway, on a reading the tie clause was written to permit: that clause exists to stop a
*bully* shipping on head-to-head strength alone, which `m2-5p` was at +13.578, and an agent that
dominates on play while matching on risk is not that case. Six independent measurements at this count
now span 14.965 to 17.510 — a 2.6 spread against a 2.1 floor, produced by five different training
procedures including no training at all — so **~15-16 gold looks structural to the three-player game**
rather than a defect any policy failed to fix, and a future arm here should be expected to move play
quality and not safety. The warm start was cleared of suspicion in passing: the from-scratch control is
the *most* exploitable arm of the four at 17.510. The pool was the variable.

### Five seats: the honesty head, and the pool that made it shippable

The head was tried three times and the sequence is the point.

**On generation four (`_lie_feed/`, three families of three seeds warm-started from `m3r-5p-s2`).** The
head is worth **+1.5 gold over its own control, 6 of 6 within-table contrasts** — the first component
in this layer to beat its own ablation consistently at `n = 3`, which the record features never managed
across three gold configs. **The feed is not what does it**: `--lie-to-policy` beats the head-only arm
at one seed of three and loses at the other two, well inside the spread, so **the extraction hypothesis
is not supported** — what buys the gold is having the head shape the trunk at all. That was cheap to
learn because the two families differ in exactly one flag and start as the same network. The cohort
also showed **further recursion at five seats is a regression**: the no-head control falls from the
incumbent's +1.970 to −0.321 while its bluff rate goes 13.3% to 33.4%. The head recovers most of that
loss without reaching the incumbent, which is a different claim from the head being good in the
abstract.

**On generation three with a narrow pool (`_lie_gen3/`).** The head wins the mixed table 6 of 6 in
*both* compositions but only **ties** the shipped arm head to head, and is **more exploitable by
2.2-3.4 gold** against a 2.1 floor. One leg of three, so nothing shipped. What it buys is punishing
bluffers: its edge is **+2.63 gold against a 57%-bluff field and +0.33 against an honest one** — real
(6 of 6 in both) but almost all of its size is who else is at the table.

**On generation three with a broad pool (`_lie_pool/`), which ships.** A 2x2 — `{head, no head}` ×
`{narrow, broad}`, three seeds a cell, of which the two narrow cells were already on disk, so six new
arms differing from the old ones in `--pool-init`/`--pool-size` and nothing else. The broad pool keeps
generation two's three own-lineage members, adds **five checkpoints sharing no ancestor with the arm**,
and **deliberately excludes `m2-5p` and `xg2-5p`** — which is exactly what separates it from the
`m3-5p` widening that failed.

* **Head to head passes 3/3 two-sided** against the shipped arm, where the narrow-pool head only tied.
* **The mixed table passes in both compositions**, and this is the cohort's real finding: the head
  holds **+0.70 at 6 of 6 against an honest field** while its own broad-pool control **fails that same
  table at 2 of 6**. So the effect is no longer composition-dependent the way `_lie_gen3`'s was, and it
  is the head rather than the pool that carries it.
* **Exploitability ties**, and the head's earlier 2.2-3.4 gold penalty was the pool: the three
  broad-pool head arms measure **+2.156 / +2.289 / +2.439**, a spread of 0.28 that is unusually tight
  for this quantity, against the narrow-pool head arms' +3.781 / +4.994.

**The anchor it is read against was itself wrong.** `m3r-5p-s2`'s celebrated +1.577 came from an
exploiter that bluffed 0.2% and called 0.0%; two further seeds put it at **+2.862 / +3.046**, so its
real exploitability is about **+2.95**. The corrected comparison is `lp-head` **+2.295** against
**+2.954** — still inside the 2.1 floor and so still formally a tie, but a tie in the *new* arm's
favour. And the comparison is biased *against* the head arms: their exploiters found 15-35% bluff
routes while the anchor's found 0.2% and is the likeliest of all of them not to have converged. One
row of the cohort was itself caught by that rule and re-measured — `xg-lp-head-s1` at `--seed 4`
finished at 3.1% bluffing and +1.607, and at `--seed 5` the same target measures **+2.156** with the
exploiter bluffing 15.4%. The correction moved *against* the arm and into line with its siblings.

Two things about the instrument outlast this cohort. **Every exploiter in it converges to ~0% calling**,
against control and head arms alike, which now looks like a property of the exploiter recipe at five
seats rather than of any target: the profitable best response to all of these arms is to bluff past
them, not to call them. And both re-runs were **still climbing at 800k**, so absolute numbers are lower
bounds; a cohort needing a real magnitude rather than a ranking should budget more.

**`lp-head-s2` shipped** as `model_weights/ante-match.{json,bin}`, replacing `m3r-5p-s2` at five seats
— the first shipped arm carrying the honesty head. All three seeds cleared the bar the same way, so the
choice was made on play: it has the strongest two-sided head-to-head of the three (+0.914 / −1.207,
where the arm it replaces manages only +0.010 attacking it), the largest low-bluff margin at one eval
seat, and its exploitability sits in the middle of a 0.28-gold spread. The export drops the four
`lie_head.*` tensors and the blob is the same 31 tensors as before; `check:ante:bot:match` passes (max
logit delta 2.00e-5, match block 4.94e-8, 0 mask bits disagreeing) and `check:ante:bot:play:match`
passes (2296 moves over 12 matches, 0 refused, 12/12 finished).

**A reproducibility note that still stands.** `ante_match_train.py` writes `args.json` unconditionally,
and the Colab-trained arms have none — only `final.pt`, `latest.pt` and `log.jsonl` were pulled back.
Architecture and step count are recoverable from the checkpoint; **the seed is not**, so those runs'
`-s2`/`-s3` labels are the run names' claim and not disk's. This is the same failure as the trainer
seeding one below, in a new place: the fix went into the trainer and the artifacts still do not carry
it. Pull `args.json` back with the checkpoints, or stamp the seed into the checkpoint beside
`record_features`.

**And "seed" once meant less than it says.** `torch.manual_seed(args.seed)` ran *after* the network was
constructed in both trainers, so the initial weights came from torch's process-default generator and
`--seed` governed the environments, the seating and the action sampling but not one parameter. The tell
was three warm-started arms with identical arguments and identical seeds logging `explained_variance`
of −0.65 / −1.31 / −2.86 on their first update while every behavioural counter matched to the digit.
**No run written before the fix reproduces from its own manifest.** Nothing measured is wrong — two runs
differing in initialisation as well as seed are, if anything, a *better* sample of the strategy
distribution — but they could not have been re-run. Fixed by seeding before construction, numpy
included, since the minibatch shuffle rides on its global generator.

### Two, three and four seats: the five-seat recipe transferred (`_lp2/`)

`lp-head-s2` is the only arm ever shipped on a *new* component, so the obvious question is whether its
recipe — broad pool plus the honesty head, `--init m2-<n>p`, `pw = 3`, 2M — travels. `_mrf` had already
answered no at 6, 7 and 8. `_lp2` is the remaining three counts, nine arms, three seeds each,
and it picked them by this file's own gate: **measure the incumbent first.** Two seats was leaking
+16.230 to a best response and four seats +6.822, the two largest remaining leaks.

**The recipe transfers at four seats, not at three, and marginally at two.** One arm of three cleared
the bar at two seats (`lp2-2p-s2`, +2.347 / −2.333 two-sided against a **5.8-gold** seed spread — wider
than anything else in this file); none at three; two of three at four, where `lp2-4p-s2` additionally
beats `m3r-4p-s1` two-sided (+1.609 / −1.397) and is **4.40 gold less exploitable** than the shipped
`m2-4p` (+2.420 against +6.822), the only outside-the-floor safety gain of the cohort. Two seats
improves to +14.590 and replicates at a second exploiter seed to **+14.740** — a 1.6-gold gain that is
still inside the 2.1 floor, so a tie in the arm's favour. The head trained everywhere, hardest where
the leak was: `lie_auc` **0.915-0.924** at two seats, above the 0.851 supervised-probe ceiling.

**The cohort's own finding is a trade, and it is the seventh thing in this file to look like a free
lunch and not be one.** The arms that beat the incumbents are markedly *worse* at extracting gold from
the one-round agent — `lp2-2p-s2` takes +6.503 off it where the incumbent takes **+12.845**, and
`lp2-4p-s2` is behind it attacking at −2.565 where `m2-4p` takes **+4.624**. The mechanism is legible:
the incumbents trained against generation two's thin pool, where the round agent is one of three
permanent members, so they are *specialised* to it; these arms met it as one of sixteen. **Generalising
the pool buys peer strength and safety and sells round-agent dominance.** Neither 4-seat arm *loses*
that leg under the strict two-sided rule — both tie it, as `m3r-4p-s1` does — and at 20 rounds / 5 gold
`pickAnteWeights` never seats a round policy anyway. But the arm that ships at five seats passes that
control at **+8.593 / −4.849**, so passing it is not something the shipping set fails to do.

**Both halves of leg 2 were contaminated, in opposite directions, and the lesson is new.** At three
seats the third chair `m3r-3p-s1` is bankrupt in **38.2%** of matches, so the tables read as a 3-gold
sweep while leg 1 said all three arms were worse — leg 1 wins, sixth reproduction of the trap. At four
seats the donor was **the incumbent itself**: `m2-4p` is bankrupt in 11.8-19.8%, `m3r-4p-s1` won all
six tables by farming it, and removing it *reverses* the ranking — both new arms above both old ones at
both eval seeds, which then agrees with the head-to-head. So: **at a count whose incumbent is weak, run
the leg-2 table twice, once with it and once without.** The reference seat cannot be omitted and can be
a donor, which is exactly the case the "peer-only" rule does not cover.

**Three seats is now well characterised and should be left alone.** Five procedures have failed to beat
`m4-3p-s3`, its exploitability has been measured six times across 14.965 to 17.510 against a 2.1 floor,
and these arms are worse on the only clean leg. Pool and objective changes are finished there.

`_lp2/RESULTS.md` has every number, the recommendation, and three protocol fixes — including that
`print` emits CRLF on Windows, so a Python-computed shortlist read through `$(...)` arrives with a
carriage return on every entry but the last and the consumer skipped two of three arms **in silence**.

### The second dense label: the challenge head (`_chal/`)

The honesty head is the only component in this layer ever to ship on its own merit, and the reason is
legible: its label is dense, free and exactly correct, so it is trained by supervised learning while
the policy is trained by a reward several decisions away. "What is next" named two more quantities
with that property and said neither was used. `--challenge-coef` is the first of them. (The second,
*will this seat still be in the game in five rounds*, is deliberately not built: at 20 rounds and 5
gold an elimination happens in 0.3% of matches, so the label is 0.997 constant and would shape
nothing. It is the right head for a **low-gold** arm and belongs with one.)

Nine arms, three seeds at each of 2, 3 and 5 seats, each differing from an existing cohort's arm in
**exactly that one flag** — the control cells were already on disk (`_lp2/lp2-{2,3}p-s*` and
`_lie_pool/lp-head-s*`), which is the same economy `_lie_pool` ran when two of its four cells existed.

**The component result is the cleanest in the package: 8 of 8 two-sided head-to-heads against its own
same-seed ablation**, +0.203 to +3.617 attacking with the control behind in every direction. The
honesty head's own best was 6 of 6 *within-table* contrasts; these are the stricter instrument. It is
also the first component here to be sign-consistent across three seat counts rather than one.

**It converts to a shipping candidate at one count.** Beating the cell is not the bar — the cell is not
the incumbent at 2 and 3 seats, and at 5 the incumbent is the cell's *selected best*.

| seats | leg 1 vs the incumbent | leg 2 | exploitability (two seeds) | verdict |
| --- | --- | --- | --- | --- |
| 2 | `s2` and `s3` **STRONGER** | n/a at two seats | `s2` +11.065 / **+14.925**; anchor +16.230 | **`chal-2p-s2` SHIPPED** |
| 3 | two ties and a loss | only `s2` holds its table | `s2` **+10.102 / +9.635**; anchor +16.020 | nothing ships — but see below |
| 5 | all three worse | all three below the incumbent | not measured | nothing ships |

**Two seats is the count this was aimed at** — the package's largest remaining leak at +16.230, left
explicitly open by `_lp2`. And the decision there had to be made on play, because **the exploitability
reading did not replicate**: +11.065 at seed 4 and **+14.925** at seed 5, a **3.86-gold spread between
two readings of one unchanged checkpoint**. Both exploiters converged and attacked, so neither is
invalid — they disagree, and the mean of +13.0 against +16.230 is a tie rather than the 5.17-gold gain
the first row alone suggested.

**That is a finding about the instrument, not just about the arm: the 2.1 gold floor this file quotes
is a *five-seat* number**, established from three readings of one checkpoint at five seats. Two seats
measures **3.86** the same way. Every two-seat exploitability comparison in this file has been read
against a floor 45% too small, and on the corrected one all four candidates at the count are
indistinguishable (`m3r-2p-s3` 16.23, `lp2-2p-s2` 14.67, `chal-2p-s2` 13.00, `chal-2p-s3` 16.01).

**So play settled it, through the peer comparison two seats had never had.** Three arms now beat
`m3r-2p-s3` two-sided, from two cohorts; at two seats a "table" *is* a head to head, so every pair was
run in both directions at 1000 matches a side. `chal-2p-s2` beats `chal-2p-s3` **+3.778 / −3.706** and
`lp2-2p-s2` **+2.485 / −2.842**, and those two tie each other. It is therefore the strongest two-seat
arm on every play comparison available — over the incumbent, over both rivals, and over its own
ablation — while tying on risk, which is the clause `m4-3p-s3` and `lp-head-s2` both shipped under. It
additionally **keeps the round-agent leg** at +12.083 / −12.074, which `_lp2`'s candidate sold away, so
that trade belongs to those arms rather than to a broad pool as such.

**Sixth reproduction of the fixed-field trap, this time inside one cohort.** `chal-2p-s3` has six
times `s2`'s margin *against the incumbent* and loses to it by 3.8 gold in both directions. Ranking
candidates by their score against a shared reference ranked them backwards again — and `lp2-2p-s2`,
held back by `_lp2` for want of a second cohort, turns out not to be the best arm at the count.

**Three seats produced the cohort's most consequential measurement, and it ships nothing.**
`chal-3p-s2` measures **+10.102 and +9.635** at two independent exploiter seeds — agreeing to **0.47
gold**, the tightest replication of this quantity in the package, both exploiters attacking hard
(bluff 80.6% / 78.1%, call 26.2% / 25.3%) — where six previous measurements at that count span 14.965
to 17.510. That range was read as *structural to the three-player game*, produced by five different
procedures including no training at all. The mean of **+9.87 is 5.1 gold below the bottom of it.**

**The three-seat floor is therefore not structural.** ~15-16 gold was never a property of the game,
only of every policy that had been tried in it. The standing advice to stop attacking the count was
right about *pool and objective* changes and wrong as a general claim.

**Five seats is the clean statement of a measurement problem rather than a result.** The head beats
`lp-head-s1` and `lp-head-s3` two-sided and loses to `lp-head-s2`, which is the arm that shipped
*because* it was the best of those three. So it is 2 of 3 on the component question and 0 of 3 on the
shipping one. **A component that raises a cell's average cannot be read off a comparison against that
cell's selected best** — the next experiment there is three more seeds, not a different component.

**What the heads learned.** `challenge_auc` reaches **0.79-0.88** at every count, level with the
honesty head's own and above the 0.851 supervised-probe ceiling at two seats — flat across the three
counts while the gold outcome runs from "ships" to "loses every leg". That is the **tenth**
reproduction of "discrimination does not predict placement" and the first for a second, different
discrimination measure. And the head very slightly *degrades* the honesty head beside it (`lie_auc`
0.01-0.03 below its control at every count, consistently): two auxiliary losses compete for one trunk,
so this head is not working by improving the other one.

**`chal-2p-s2` shipped** as `model_weights/ante-match-2p.{json,bin}`; the old blob is in
`model_weights/_superseded/`, and both npm scripts were repointed since a fixture dumped from an
undeployed checkpoint checks nothing. The export dropped four `lie_head.*` **and** four
`challenge_head.*` tensors and left the rest unchanged, so nothing in `anteNet.ts` moved.
`check:ante:bot:match:2p` passes at max logit delta 2.78e-5 / match block 4.98e-8 / 0 mask bits, and
`check:ante:bot:play:match:2p` at 863 moves over 12 matches, 0 refused, 12/12 finished.

`_chal/RESULTS.md` has every number.

---

## It has shipped: the bots in the browser

`src/bots/ante/` is the port and `CLAUDE.md` documents its shape; what matters here is which claims it
rests on and how they are held.

**The port is checked in three layers rather than argued about**, because the failure mode is a bot
that plays legally and badly and nothing else would catch it:

| check | holds | result |
| --- | --- | --- |
| `check:ante:bot` — network | every logit and the value against `AnteNet`, 40 random observations | max delta `5.0e-5`, 0 argmax disagreements |
| `check:ante:bot` — encoder | all 200 features against `ObservationEncoder`, 300 positions from real rollouts, every seat's view of each | max delta `5.0e-8` |
| `check:ante:bot` — mask | every bit against `ActionSpace.legal_mask` | 0 disagreements |
| `check:ante:bot:match` — match block | `anteMatchObservation.ts`'s 98 features against `match_observation.py` | ~5e-8 at all seven counts |
| `check:ante:bot:play` — legality | whole matches through the real reducer, each seat handed its own `playerView` | 2,077 moves, **0 refused**, 12/12 finished |
| `check:ante:bot:play` — strength | one agent against four flattened-to-uniform copies, seats rotated | **+6.56 gold** over the field |

The last row is the one that earns the others. Every fixture above would still pass if the observation
were internally correct but assembled from the wrong seats — valid numbers describing somebody else's
position, a legal mask, and a policy quietly reduced to noise. A working agent beats random by several
gold and a scrambled one does not, so that is the check that separates them, and it is the only one
covering the `G`-to-observation adapter, which has no fixture on either side.

Two things the port had to get right that the Python never thinks about. Card **types** are mapped
through `deckConfig.selectedRanks` in its own order, which is sound only because the network is
structurally indifferent to rank identity — the `rank relabelling` check licenses that. And the **event
ring** is not in `G` at all: `hideSecretState` empties `archive` for every client and `history` is
prose, so it is rebuilt from the table, using the fact that Ante has no skips and `ctx.turn` therefore
steps one seat at a time. The round's opening turn is the one thing that cannot be recovered that way,
so the bot runner stamps it.

### The match-block bug, whose shape recurs

`check:ante:bot` originally pointed at `model_weights/ante-round*` only, so `anteMatchObservation.ts` —
the 98 features that are the entire point of the match layer — was exercised by neither check. Closing
the gap failed immediately, at **four seats only**, on 25 of 300 positions, in `my_gold`,
`my_gold_rank`, `i_am_last`, `gold_lead_over_best_other`, `my_lie_rate` and every row's
`gold_gap_to_me` and `they_lead` — that is, all and only the *viewer* reads.

**The port had taken row 0 to be the viewer.** That is true while the viewer is seated in a live round,
which is the only case a bot ever encodes **for itself**, so the assumption held everywhere the shipped
bot looks and the five-seat fixture never contradicted it. The Python encodes every seat's view of
every position, a bankrupt seat included, and there the rows start at the first *active* seat while
`gold[viewer]` is still the eliminated one's. Four seats reached that state inside 300 sampled
positions where five did not. `AnteMatchView` now carries `viewer` and `viewerRowIndex` explicitly and
the fixture dumps both; the self-blanked lie columns stay keyed on **row 0**, because row 0 is what the
Python's `offset > 0` blanks.

Whether this was reachable from the browser is a fair question and the answer is probably not. That is
not a reason to leave it: the whole argument for these fixtures is that the failure mode is a bot that
plays legally and badly, and "the divergence is in a state we think is unreachable" is exactly the
claim a fixture exists to stop anyone having to make. **Run the `:match` variants for the seat counts a
change reaches, not only the default five.**

### The gold guard was worse than nothing, and has been removed

`applyGoldGuard` was the one non-learned thing in the shipped bot: below 2 gold, decline any `Call BS`
the policy was not 60% sure of. The argument was that a lost call at 1 gold is elimination and the
round policy cannot see its own gold to know that. `guard:<path>` and `guard-round:<path>` in
`ante/match_agents.py` transcribe it exactly, so a guarded seat can be sat beside a bare one at the same
table and the difference read off. That turned the question into a measurement.

**In front of a match policy it is a wash**, which is what "redundant" predicts — a guarded seat against
four bare copies of itself moves by −0.09 to +0.28 across 2, 3, 4, 5 and 6 seats.

**In front of the round policy — the one it was written for — it is actively harmful at four of six
seat counts.** One guarded and one bare copy of the round agent at the same table, the rest match
agents, replicated at two seeds each (three at five):

| seats | Δ gold | bankrupt, bare → guarded |
| --- | --- | --- |
| 2 | +0.46, +0.67, +0.27 | 0.8% → 0.2-0.6% |
| 3 | −0.53, −0.75 | 0.6-1.2% → **10.6-10.8%** |
| 4 | +1.18, +1.55 | 8.0% → 0.4% |
| 5 | −2.80, −2.40, −2.81 | 1.2-2.4% → **33.6-40.8%** |
| 6 | −1.20, −0.98 | 0.0-1.0% → 1.8-3.2% |
| 8 | −1.27, −1.32 | 35.4-36.6% → **71.4-71.6%** |

The bankruptcy column is the finding. A clamp written to *prevent* elimination raised it by a factor of
twenty at five seats and doubled it at eight, consistently.

**Why, and it is obvious in hindsight.** Winning a challenge is the main way gold comes back, while
being caught lying costs gold whether or not you challenge. Refusing to challenge below 2 gold closes
the only exit from the hole and leaves every entrance open — it converts low gold into an absorbing
state. The guard reasoned about the *variance* of a call and ignored its mean, in a mode where the mean
is the whole reason to call. The two counts where it helps, 2 and 4, are the ones where BS is not the
dominant ending (89.3% of rounds at two seats end in an all-pass), so the trap has nothing to spring —
a real pattern that replicates, but conditioning a hand-written clamp on seat count would be fitting a
heuristic to 500-match samples. It is removed instead. `anteBotPolicy.ts` carries a note saying not to
reintroduce one without measuring it the same way, and the `guard:` specs stay in the Python so a
future variant can be priced in an afternoon.

### One thing this changes for low-gold rooms

`MIN_BLOW_COW_ANTE_STARTING_GOLD` is 1, so a host can stage a room at 1 or 2 gold — and the shipped
one-round agent goes bankrupt in **75-89%** of matches there, finishing last by two and a half places.
**And it is not confined to the extreme settings**: at **3** gold it is already eliminated in **72-84%**
of matches and finishes last in every table by nearly two places. The cliff is between 5 and 3, so
every staged gold below the default is affected. That is the one place a match checkpoint is clearly
worth shipping, and unlike the 5-gold case the effect is far larger than the seed spread — but the
probe shows a policy's risk behaviour is set by the criticality it trained under, so such a checkpoint
should be **trained at the gold the room is staged at**.

---

## What is next

The decomposition worked, but not along the axis it was drawn on. Sub-task one is closed: moving the
reward from ninety rounds away to three decisions away made the same architecture learn call
discrimination in a tenth of the budget. Sub-task two produced agents that beat the round agent at
every seat count and at thirteen checkpoints across five seeds — and almost nothing *inside* it
differentiates, because at the shipped 5 gold there is nearly nothing for it to move.

**In rough order of expected value:**

* ~~**Export the three round agents that cleared all three legs.**~~ **Done.**
  `model_weights/ante-round-{6,7,8}p.json` carry `source: rl/runs/_round_fix/r{6-ctrl-s1,7-ctrl-s1,8-e04-s1}`
  and `package.json`'s `rl:ante:export:{6,7,8}p` point at them, so this list was stale — read the
  manifests, not this file. The reasoning it records is kept because it is the argument for the
  artifacts that are now deployed: `_round_fix/` had
  candidates at 6, 7 and 8 seats — `r6-ctrl-s1`, `r7-ctrl-s1` and `r8-e04-s1` — each beating its
  incumbent two-sided, leading or placing well on a mixed table that also holds that count's shipped
  match arms, and no more exploitable than the incumbent. Seven seats is the headline: exploitability
  falls from the incumbent's **+16.510 to +0.623** against an exploiter that bluffs 87.3% and finds
  nothing, with elimination going 3.6% → 0.0% and the incumbent finishing **last of seven** on the
  table. Eight seats halves a 29.8% elimination rate to 0.0%. Shipping needs `export_ante_round.py`
  plus `check:ante:bot` and `check:ante:bot:play` at those counts. Four seats produced nothing, and a
  warning: continuing it at the old `entropy_coef 0.01` *degraded* the incumbent. See
  `_round_fix/RESULTS.md`.
* ~~**Then rebuild the match arms at 6, 7 and 8 on the new round agents.**~~ **Done as `_mrf/`, and
  nothing ships.** Six arms warm-started from the repaired round agents against the first broad pool
  ever constructible outside five seats. Six seats loses the two-sided head-to-head outright; seven
  and eight tie it. On a clean table `mrf-7p-s1` is 2nd of 7 and above the shipped `m2-7p`, which is
  the only near miss. The honesty head reached `lie_auc` 0.839-0.897 at every count — at or above the
  supervised-probe ceiling — and still did not convert, the **eighth** reproduction of
  "discrimination does not predict placement". The broad pool did not narrow the seed spread either
  (`mrf-8p-s1` −1.128 against `mrf-8p-s2` +1.697 on one table). See `_mrf/RESULTS.md`.
* ~~**Re-test the rollout's rejected 7-seat arms.**~~ **Done, and `m2-7p` keeps the slot.** All three
  `m3r-7p-s*` beat it on a peer-only table (`s3` +1.335/+1.379 against +0.548/+0.467) and
  exploitability was already a tie on disk (+2.113 against +1.778 / +1.174), but the missing leg came
  back a **tie**: `m3r-7p-s3` scores −0.131 attacking and −0.137 defending, both negative and equal,
  so the 1-vs-6 chair is all that is being measured — at 7 seats the singleton position is a
  *disadvantage*, the opposite of its ~+1 gold at 5. Mixed table won, exploitability tied,
  head-to-head tied; the bar requires winning the head-to-head, and both arms that ever shipped on a
  tie (`m4-3p-s3`, `lp-head-s2`) won it. What the recheck *does* retire is `_gen3r`'s stated reason
  for rejecting the count — "loses the table" came from a slate carrying two donor seats. **Eight
  seats never had a lead**: the shipped `m2-8p` beats `m3r-8p-s3` on the clean table at both eval
  seeds. See `_recheck/RESULTS.md`.
* ~~**Reconsider the 7-seat round blob.**~~ **Settled: keep it.** A match-arm-majority table had
  `r7-ctrl-s1` bankrupt in 30.4% of matches against the old agent's 10.2%, but that table is at
  20 rounds / 5 gold — where `pickAnteWeights` returns the *match* network and a round blob is never
  seated. At the non-default golds where every bot does fall back to the round policy it wins
  two-sided by 10-20 standard errors with half the bankruptcy: **+1.063 / −1.499 at 3 gold** and
  **+0.791 / −1.490 at 2 gold**. Measure an artifact in the configuration it is deployed in.
* **Seat donors deliberately or not at all.** A mixed table holding an agent that is bankrupted in
  10-37% of matches is a farming contest, and the winner will be whoever bluffs at it — `m-7p` wins
  such a table while reading a lie at disc −12.56. This is the fixed-weak-field trap arriving through
  *table composition* rather than through the one-vs-fixed-field protocol, and it is the fifth
  reproduction. Peer-only slates for ranking; a donor only when the question is explicitly about
  robustness to one.
* **Gate high-seat-count runs on the ending mix, not on `bluff%`.** At 8 seats 94-100% of self-play
  rounds end in an all-pass, so no trump is selected and `bluff%` reads 0.0 for want of a denominator
  rather than by choice — `ante-8p-v1` calls **71.7%** against `random` and scores +0.627, so it is
  anything but passive. What separates the strong 8-seat arms is that they play rather than pass.
* **Ship a match checkpoint for low-gold rooms.** The clearest application-side gap, and unlike
  everything else here the effect is far larger than the seed spread: at 2 gold the shipped one-round
  agent is bankrupt in 75-89% of matches, and at 3 gold it is already 72-84%. Train at the gold the room
  is staged at.
* **Measure the incumbent before training a replacement.** The rollout's own finding: the recursion
  helped exactly at the two counts where the incumbent was leaking 6.6 and 19.8 gold to a best response,
  and bought nothing at the four where it was already near its floor. That is checkable for the price of
  one 800k exploiter rather than three 2M arms.
* ~~**Try the honesty head at the other seat counts.**~~ and ~~**a broad pool at every seat count**~~
  — **both now run at all six, and the answer is two candidates.** `_mrf/` did 6, 7 and 8 (nothing);
  `_lp2/` did 2, 3 and 4 and produced **`lp2-4p-s2`**, which clears all three legs, beats
  `m3r-4p-s1` two-sided and is 4.40 gold safer than the shipped `m2-4p`, and **`lp2-2p-s2`**, which
  clears leg 1 and the round control on an exploitability tie. **Neither has been exported** — see
  the decision below. What survives as advice: the pool must be widened with *unrelated* lineages and
  not with the arm's own predecessor and that predecessor's exploiter (the `m3-5p` failure), the
  material for that does not exist outside five seats, and 1-2 arms of three clear the bar, so train
  three and select rather than running one.
* ~~**Decide the two `_lp2` candidates.**~~ **Both settled: four seats shipped `lp2-4p-s2`, and two
  seats went to `_chal`'s arm instead.**
  `lp2-4p-s2` replaced `m2-4p` as `model_weights/ante-match-4p.{json,bin}` — the last generation-two
  arm in the package is out, and it was last in every table it entered and bankrupt in 11.8-19.8% of
  them. The export dropped the four `lie_head.*` tensors, leaving the same 31 as before, so
  **nothing in `anteNet.ts`** changed; the old blob is in `model_weights/_superseded/`, and
  `rl:ante:export:match:4p` and `rl:ante:dump-match-cases:4p` were repointed, since a fixture dumped
  from a checkpoint that is no longer deployed checks nothing. Both checks pass: `check:ante:bot:match:4p`
  at max logit delta 3.24e-5, match block 4.94e-8, 0 mask bits disagreeing;
  `check:ante:bot:play:match:4p` at 1,675 moves over 12 matches, **0 refused**, 12/12 finished, +8.00
  gold over a flattened field. **`lp2-2p-s2` was never exported, and the second cohort it was waiting
  for settled it the other way**: `_chal`'s peer head-to-head beats it **+2.485 / −2.842**, so the
  two-seat slot went to `chal-2p-s2`. Holding it back was the right call; the reason recorded at the
  time — "a tie inside the floor" — turns out to have understated the case, since the floor at two
  seats is 3.86 rather than 2.1.
* **Three seats is reopened: the "structural floor" is gone.** Six procedures have failed to beat
  `m4-3p-s3` on play, and that part stands — `_chal`'s three arms lose the only clean leg too, so pool
  and objective changes remain finished there. But `chal-3p-s2` measures **+10.102 and +9.635** at two
  exploiter seeds, agreeing to 0.47, against six previous readings spanning 14.965 to 17.510. ~15-16
  gold was never a property of the three-player *game*, only of every policy tried in it. Attack the
  count with **components** — the one class of intervention never tried there — and note that the arm
  which moved the floor did so while being no better on play, so the two are separable here.
* **Test `--recent-events lap` at 7 or 8 seats.** The window is under half a lap there, which is where
  the match layer matters most. Note a wide-window arm cannot be warm-started from anything on disk, so
  the first A/B is from scratch against a common pool.
* ~~**Find the other dense labels.**~~ **Half done, and the half that ran is the best component
  result in the package.** `--challenge-coef` — *will this play be challenged* — beats its own
  same-seed ablation in **8 of 8** two-sided head-to-heads across 2, 3 and 5 seats, and produced a
  two-seat candidate that closes the largest remaining leak by 5.17 gold. See `_chal/`. **The second
  label is still unbuilt and should stay that way until there is a low-gold arm to build it for**: at
  20 rounds and 5 gold, *will this seat still be in the game in five rounds* is 0.997 constant and
  would shape nothing. Build it with the low-gold checkpoint below, where elimination is 72-89%.
* **Three more seeds of the challenge head at five seats, against `lp-head-s2` specifically.** The
  cohort there is 2 of 3 over *unselected* control arms and 0 of 3 over the selected best, which is a
  selection artifact rather than a verdict on the component. Cheapest open question with real upside,
  and the only count where the control cell and the incumbent are the same lineage.
* **A risk-appetite head over `(gold vector, rounds left, who is eliminated)`.** Still the right idea
  and still unbuilt. The layer turned out to *be* a risk model, `--placement-weight 3` was the first
  thing inside it that worked, and it has been swept at exactly three points.
* **Stop measuring the match layer on average gold at 5 starting gold.** Three protocols were spent
  finding that component effects sit below the seed spread there, and the criticality sweep says the
  quantity they were all reading is nearly config-constant. Any future match-layer claim wants a config
  where the acting seat is on its last coin in more than one decision in seventy.
* **Do not port ISMCTS here yet.** In classic mode search helped at two seats and was worth nothing at
  four, and the value head was the ceiling. The critic here is far better, but the same measurement has
  to be made before the machinery is worth building.

**Closed, with the evidence:**

* ~~Carry a per-opponent honesty statistic across rounds.~~ Built. The block is read — ×5-6.6 on a
  counterfactual probe — and buys **+0.23 gold**, null at three gold configs × three seeds × three
  protocols. What survives is that record arms force their own best response to near-honest play, 3 for
  3 with no overlap. **Finished as a lever on average performance.**
* ~~The population is the lever.~~ Three failures: `ante-v2` at the round level (nothing), the `m-pop`
  cohort at the match level (+0.23 gold and a *wider* seed spread), and `m3-5p` at the match level
  (actively harmful). Diversity is a requirement for the record block to be *learnable* and not a route
  to it being worth anything — and it must be *unrelated* lineages, where it is worth −8.75 gold of
  exploitability.
* ~~Training budget is the lever.~~ Withdrawn. A single 4M arm looked like the strongest in the package
  by double; three more 4M arms span 2.1 gold, and the controlled within-seed test says doubling the
  budget is worth about **−1 gold**. It was one draw from a wide distribution.
* ~~Feed the honesty head's output into the policy head.~~ Built (`--lie-to-policy`), and it is not the
  lever — it wins at one seed of three, inside the spread. The auxiliary loss shaping the trunk is where
  the value is. Which is convenient, since the winning configuration needs nothing in the browser.
* ~~Raise the call rate.~~ A bias on the `Call BS` logit is flat in-distribution. The reason recorded at
  the time was wrong: a bias changes how often the agent calls without changing what it ranks first, and
  the ranking was what was broken (AUC 0.401 against a bluffer).
* ~~The ceiling is an information horizon.~~ Disproved by the supervised probe. The information was
  there all along; PPO was not extracting it.
* ~~Try 3 gold, the untested middle.~~ It is a cliff, not a middle: every axis moves almost its whole
  distance between 5 and 3 and then flattens. There is no config where gold is live *and* the table
  stays heterogeneous.
* ~~`applyGoldGuard`.~~ Measured and removed. Worse than nothing in front of the policy it was written
  for, raising bankruptcy from ~2% to 33-41% at five seats.
* ~~`--entropy-coef 0.005` is the fix for the seed spread.~~ **Withdrawn.** It wins head to head and
  then loses the mixed table to its own baseline cell in 4 of 4 cells, with exploitability spanning
  3.2 gold across two seeds. A fourth reproduction of the fixed-field trap. See "The two missing legs".
* ~~The per-count round agents are stuck in a never-bluff basin.~~ **Half right.** They were stuck,
  and 4M more decisions unsticks 6, 7 and 8 seats — but the *mechanism* was misdiagnosed from
  `bluff%`, which is near-undefined at high seat counts, and the entropy coefficient the cohort was
  built to test turned out to be mostly not the lever. Continuation was.
