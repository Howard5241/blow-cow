# Blow Cow RL

Reinforcement learning for the **vanilla** game: a headless simulator held to the real engine, and a
self-play environment held to the simulator.

* **Stage A** — the simulator and the lockstep conformance harness. Done.
* **Stage B** — the canonical encoding, the action space, and the environment. Done.
* **Stage C** — the network, the baselines, PPO self-play, evaluation and exploitability. Done.
* **Stage D** — R-NaD, meant to bring exploitability down. Built, verified against its own closed
  forms, and it made things two to three times worse. Giving it back the opponent pool did not
  rescue it.
* **Diagnosis** — the learned agents cannot tell a lie from an honest play. A supervised head learns
  to in 12k decisions while 2.5M decisions of placement reward bought +0.8 points of call
  discrimination. Handing the answer over as a precomputed input changed nothing, which is the
  direct test: the bottleneck is **downstream of knowing**.
* **Search** — ISMCTS at play time. Worth **+0.290 ± 0.068** at two seats against the same
  checkpoint unsearched, and nothing at four.
* **The critic** — the value head is the ceiling, and its limit is the **learning signal, not
  capacity**. A network with *fewer* parameters predicts placement far better when trained on the
  outcome directly, and 22x the parameters buys +0.007. Fixing it turns simulation count from
  worthless into **+0.560**.

**Ante Mode is a separate package and a separate document.** `rl/ante/` and `rl/ANTE.md` cover one
Ante round and then a whole Ante match — a subgame chosen precisely because its reward lands at the
end of a round rather than folded into a placement across ninety of them, which is the bottleneck
this file spends four stages arriving at. Nothing below applies to it.

**One finding over there applies back here, and it retires a loose end.** This file records that
handing the analytic lie estimate over as a precomputed input changed nothing, and read that as
evidence the bottleneck is downstream of knowing. Measured against *trained* opponents in Ante, that
estimate has an AUC of **0.42-0.51** — at or below chance, because it assumes the hidden cards are a
uniform draw from the unseen pool, which is exactly wrong for a player who chooses what to play. So
the intervention did not fail because knowing does not help; it failed because what was handed over
was not knowledge. A supervised probe on the *same* observation reaches 0.851 where the trained
policy's own call ranking reaches 0.675 — see "The real ceiling is extraction, not information" in
`rl/ANTE.md`.

## What "vanilla" means here

Characters off, no action ranks, no statuses, every rule card active — `useCharacters: false`,
`specialRanks: []`, `initialStatuses: []`, and the default rule selection.

That collapses the game a long way. `canCheat` is `isDreamer(...) || isRuleRemoved(state, 'noCheating')`
and both halves are false, so `sneakPlay`, `takeBackCard`, `toggleDirection` and `accuseDreamer` are
illegal for everyone. What is left is five actions, one of which carries a card selection:

| Action | Argument |
| --- | --- |
| `Play` | 1 or 2 cards from hand |
| `Select trump rank and play` | a rank, plus 1 or 2 cards |
| `Call BS` | none — the target is fixed as the previous non-passing player |
| `Call Reset` | none |
| `Pass` | none |

`Take Turn`, the Reveal Rule's flips, and both reveal walks are pressed by hand in the real client but
are not choices. The simulator drives them itself through `BlowCowEngine.forced_move()`, so a policy
is only ever asked the question above.

**Training is capped at six seats.** The engine still plays two to eight and the conformance run still
covers all of them; the observation encoder refuses anything above six.

## Layout

```
rl/
  oracle/blowcow-oracle.ts   JSONL driver over the real engine — the conformance oracle
  blowcow/
    rng.py                   xorshift32 + Fisher-Yates, byte-identical to the oracle's
    cards.py                 deck construction, rank/suit tables, MaxCardsOnTable
    state.py                 state records, plus the public event trace
    engine.py                the simulator: rules, moves, forced procedures, legal actions
    actions.py               the decision space
    projection.py            the comparable shape, produced identically on both sides
    oracle_client.py         subprocess client for the oracle
    canonical.py             rank -> canonical slot, the relabelling that hides rank identity
    spaces.py                the flat action space and its index arithmetic
    observation.py           the observation encoder and its feature names
    bridge.py                observation + mask + index-to-move, for any engine instance
    env.py                   the self-play environment and its rewards
    pettingzoo_env.py        optional AEC wrapper (the only file that imports pettingzoo)
    nets.py                  the policy/value network
    agents.py                scripted baselines and the checkpoint wrapper
    rnad.py                  the R-NaD transform, the NeuRD loss, and their config
    ismcts.py                single-observer ISMCTS with a learned prior and value
    lookahead.py             one-ply argmax over shared determinizations (a negative result)
  conformance.py             Stage A: lockstep against the real engine (CLI)
  check_env.py               Stage B: the encoding held to the simulator (CLI)
  check_rnad.py              Stage D: R-NaD held to its own closed forms (CLI)
  check_ismcts.py            search: legal determinizations, read-only, budget spent (CLI)
  analyze.py                 behavioural diagnostics: bluffing, calling, discrimination (CLI)
  predictability.py          behavioural-cloning accuracy, as an exploitability proxy (CLI)
  belief.py                  can a lie detector be learned, and does it transfer (CLI)
  value_calibration.py       does the value head predict placement at all (CLI)
  train_value.py             supervised placement regression, the size sweep, and the critic (CLI)
  train_expert.py            expert iteration: distil the search, fine-tune, gated promotion (CLI)
  train_ppo.py               PPO self-play with a frozen pool; also --exploiter
  train_rnad.py              R-NaD, as a subclass of that trainer
  evaluate.py                round-robin with seat rotation (CLI)
  bench.py                   throughput (CLI)
```

## Running it

```bash
npm run check:rl        # Stage A: 12 matches, mask probing on
npm run check:rl:env    # Stage B: the encoding checks
npm run check:rl:rnad   # Stage D: the R-NaD formulas
npm run check:rl:search # ISMCTS: determinizations and search hygiene
npm run rl:bench        # raw simulator throughput
npm run rl:value        # value-head skill against the always-zero predictor
npm run rl:train:value  # supervised critic, and the capacity-vs-signal sweep
npm run rl:train:expert # expert iteration over the search

python rl/conformance.py --games 60 --probe none   # transitions only, fast and broad
python rl/conformance.py --games 6 --probe full    # exhaustive mask probing, slow
python rl/conformance.py --suit-invariance         # check that suits really are irrelevant
python rl/check_env.py --games 30 --oracle         # also replay canonical play against the engine

npm run rl:train -- --steps 2500000 --run runs/ppo-v1
npm run rl:eval  -- --agents ckpt:runs/ppo-v1/final.pt heuristic random --games 300

# exploitability: a fresh learner against a frozen checkpoint, scored at a fixed table size
python rl/train_ppo.py --steps 1000000 --opponent runs/ppo-v1/final.pt --exploiter --run runs/exploit
python rl/evaluate.py --agents ckpt:runs/exploit/final.pt ckpt:runs/ppo-v1/final.pt \
  ckpt:runs/ppo-v1/final.pt ckpt:runs/ppo-v1/final.pt --players 4 --games 300
```

**Interpreters.** Stage A has no third-party dependencies and runs on any Python 3.10+. Stage B needs
`numpy`, Stages C and D need `torch`, and the optional AEC wrapper needs `pettingzoo` and
`gymnasium` — activate the project virtualenv first, or invoke that interpreter directly.
`rl/check_env.py` says so rather than tracebacking if you forget. The `blowcow` package re-exports its
numpy-backed half lazily so that importing it on a bare interpreter still works.

---

# How to measure things here

Five rules, each of which was paid for by a published claim that turned out to be wrong. They are
stated once here rather than repeated at every result below.

**1. Rank checkpoints head to head, never by score against a fixed opponent.** `heuristic` calls BS
on 76-84% of its opportunities, so against it bluffing is punished and honesty rewarded, and a policy
that is getting *better* at the actual game scores worse against it every step. Measured on
`runs/ppo-lie`, three checkpoints from one run:

| | vs `heuristic` | head-to-head |
| --- | --- | --- |
| 500k | **-0.076** (best) | loses to 1.5M by -0.458, to 2.5M by -0.338 |
| 1.5M | -0.246 | loses to 2.5M by -0.325 |
| 2.5M | **-0.290** (worst) | **beats both** |

Exactly inverted and perfectly transitive, at `-0.353 ± 0.020` over 1,100 matches. The number measures
how honest a policy is, not how strong. Keep `heuristic` as a diagnostic; never as a ranking. The same
inversion is reproduced independently in Ante mode. `--eval-anchor` exists so progress can be tracked
against a same-family reference instead.

**2. Fix the table size.** `Trainer.evaluate_against` cycles `--players`, so the default figure
averages 2- through 6-seat tables. At two seats a score is `+1` or `-1` and nothing else, so any edge
reads as a full point and the two-seat games dominate. The same exploiter scores **+0.45** mixed and
**+0.16** at exactly four seats. Every exploitability number below is at four seats.

**3. An exploitability figure is a lower bound indexed by a budget, so quote the budget.** Stage C's
originally reported +0.199 was simply an unfinished exploiter; run to 1.4M it reaches +0.51-0.61 on
the mixed protocol. Two independent exploiters against the same target landed at +0.033 and +0.162 at
four seats, so **0.13 is roughly the noise floor** at 300 matches.

**4. Anchor the scale.** `--opponent` accepts a baseline name. The handcrafted `heuristic` — which
wins every head-to-head in this repo — is exploitable for **+0.367 at 100k and +0.542 at 200k**,
faster and further than any R-NaD agent. Strength and unexploitability are close to orthogonal here.

**5. Report a table composition, not a score.** Rankings reverse on who else is sitting down: the
R-NaD `eta=0.02` agent is first in a five-way field and third head to head, `heuristic` beats a
learned policy at four seats while losing to it at two, and the same checkpoint is ahead at three
seats and behind at two depending on whether it searches. Always include the head-to-head against
whatever you changed. Note that `evaluate.py` cycles the slate to fill spare seats, so a mixed table
must be run at exactly the slate's size or earlier agents get duplicate chairs.

`evaluate.py` prints a standard error beside every score. Several gaps this repo once took seriously
are the size of the noise at 120 matches.

---

# Stage A — the simulator

Both sides start from the same seed and take the same moves. After **every** move — forced ones
included — their projected states are compared leaf by leaf. At every decision point the simulator's
legal-action mask is checked against the engine by probing each candidate move on a throwaway clone,
so both directions are covered: nothing the engine would accept is hidden from a policy, and nothing
it would refuse is offered.

**Compared:** turn and current player, game status, placements and the game-over record, seat order,
every round field, every table play (cards, declared count, revealed cards, claimed rank, round and
turn stamps, reveal turn, trump-selection flag), every player (seat index, hand contents *in order*,
points, scored sets, pending reveal pointer, left flag, leave order), the BS resolution including its
verdict and Reverse Rule outcome, the Reset resolution, and exactly which cards the Reveal Rule owes.

**Not compared:** history, telemetry, the archive, and every rendered status string. Those are prose
*about* the state rather than the state.

Randomness is kept in lockstep rather than synchronised after the fact. The engine takes its whole
supply through one injected `Shuffle`, and a vanilla match calls it in exactly three places: the
seating, the deck, and once per `Call Reset`. `rng.py` and the oracle implement the same xorshift32
and the same descending Fisher-Yates.

| Run | Result | Time |
| --- | --- | --- |
| 120 matches, 2–8 players, transitions only | 144,152 moves agreed | 69s |
| 12 matches, 2–8 players, `--probe fast` | 102,724 mask probes agreed | 34s |
| 6 matches, 2–8 players, `--probe full` (whole cross product) | 208,785 mask probes agreed | 55s |
| 8 matches, `--suit-invariance` | 433 checks over 21,967 concrete card subsets agreed | 14s |

Probes go over in batches — one round trip per decision point rather than one per candidate — and the
oracle strips history, telemetry and the archive before cloning, since none is read by any legality
test and by mid-match they are most of the state by volume. Together those took the 12-match probing
run from 505s to 33s without changing an answer.

Throughput, single-threaded CPython, random play across 2–8 players: **~13,000 decisions/s** and
**~55,000 moves/s** (~84 complete matches/s, averaging 28 rounds and 157 decisions each).

---

# Stage B — the encoding

## Canonical rank slots

Rank identity carries no information. Holding two `2`s and a `Q` is the same position as holding two
`3`s and a `K`; nothing in the rules compares ranks, orders them, or treats one differently. What
matters is the partition: the `R` ranks in the deck (four copies each, mutually interchangeable), the
`13 - R` that are not (still selectable as trump, mutually interchangeable), and whichever rank was
trump last round.

So a match fixes one random bijection from the thirteen real ranks to thirteen **slots**, in-deck ranks
landing in `0..R-1` and the rest in `R..12`. It holds for the whole match, so a slot keeps its identity
turn to turn and an agent can still track "I hold three of slot 4". It is re-drawn every episode, so
the slot index itself carries nothing.

**That is what lets a trained policy sit at a real table.** Build the mapping from that match's own
`selectedRanks`, point a `CanonicalTable` at an engine mirroring it, and the policy sees the exact
distribution it trained on whatever ranks were dealt. `check_env.py` proves it: two decks that differ
only by a rank relabelling, driven by the same canonical action indices, produce byte-identical
observations for every seat, every decision, to the same final placements.

Suits are dropped at the same boundary — a hand is counts per canonical card type, with the Joker its
own type. Stage A's `--suit-invariance` is what earns that.

## Observation — 400 features

Three rules govern it: nothing private leaks, rank identity is gone, and belief is handed over rather
than learned from scratch.

| Block | Size | Contents |
| --- | --- | --- |
| Global | 28 | seats, deck size, round, direction, trump selected, table fill vs `MaxCardsOnTable`, pass streak, own hand size and points, points versus the table, **face-up trump count** (the Reverse Rule counter), final-two flag, unseen-card total |
| Per card type | 14 × 12 | in-deck, is-Joker, is-trump, is-previous-trump, is-the-off-deck-trump-option, own count, own count is three, own face-down on table, face-up on table, scored out of play, **unaccounted**, unaccounted-any |
| Per seat | 6 × 19 | present, is-me, has-left, hand size, hand empty, points, points minus mine, cards face down and face up in front, is-current, is-BS-target, is-last-non-passing, is-starting-player, cards claimed this round, revealed trump / revealed lie this round, turns until they act, **claim pending**, **analytic lie probability** |
| Recent events | 6 × 15 | actor seat, kind, card count, and whether the claim held where that is public |

Seats are indexed relative to the viewer by seat position, not turn order, so a seat keeps its row
when the direction flips between rounds.

`unaccounted` — copies neither in the viewer's hand, nor face up, nor scored, nor in the viewer's own
pile — is the sufficient statistic for what the opponents could be holding. The deck is small and
shrinking, so that is most of the inference problem, and a network should not have to rediscover
subtraction.

The encoder is held to exactly what `hideSecretState` sends a real client. Note that a player *can*
see their own face-down cards; everyone else's appear only as counts.

The last two seat columns are the analytic lie estimate. They are a measured **negative result** —
see "The analytic lie feature" below — kept because they cost nothing, they are proven legal by
`hidden information`, and `analytic lie feature` holds them to `probability_claim_is_a_lie` so two
transcriptions of one hypergeometric cannot drift. The viewer's own seat is always zero, since you
know whether you lied and `unaccounted` excludes your own cards; `claim_pending` is what keeps a 0.0
estimate distinguishable from "no claim". `BLOWCOW_NO_LIE_FEATURE=1` zeroes both at unchanged width,
so an ablation trains an identically shaped network on identically shaped data.

## Action space — 1,669 indices

```
0                Pass
1                Call BS
2                Call Reset
3    .. 121      Play(card choice)                        119 choices
122  .. 1668     Select trump slot and play(card choice)  13 x 119
```

A card choice is one canonical card type or an unordered pair (a pair of the same type meaning two
cards of one rank): 14 + 105 = 119. `spaces.decompose` gives the factored view for an autoregressive
head; the flat masked categorical is there for a plain PPO.

**Off-deck trump ranks are collapsed.** Naming a rank that is not in the deck is legal, and it makes
every play of the round a lie, every `Call BS` a guaranteed hit, and the Reverse Rule unreachable —
a real strategic option. But all `13 - R` of them are the same move, so leaving every one unmasked
would split a policy's probability across identical actions. Exactly one representative is offered,
and it is marked in the observation. Each dropped one is checked to have a surviving twin.

## Reward

Both channels are zero-sum across the seats, so the table cannot farm either as a whole.

* `terminal` (default 1.0) — final placement, best to worst, mapped onto `+1 .. -1`.
* `dense_points` (default 0.1) — the same objective decomposed: a point gained is a point toward
  losing, spread over the other seats. Set it to 0 to train on the objective and nothing else.

**Points are a penalty.** Fewest points wins, so gaining a point is negative reward and making someone
else gain one is positive. Getting that sign wrong is the easiest way to train an agent to lose
confidently, which is why `check_env.py` asserts the winner both scored highest and held the fewest
points.

## Environment

`BlowCowEnv` is turn-based and sequential: each `step` names the seat that acts next and returns the
rewards everyone accrued in between. It depends on nothing but numpy.

```python
from blowcow.env import BlowCowEnv

env = BlowCowEnv(seed=0)
step = env.reset()                      # or reset(num_players=4)
while not step.terminated:
    step = env.step(env.sample_action())  # any index where step.action_mask is True
print(step.info["placements"])
```

`blowcow.pettingzoo_env.BlowCowAECEnv` wraps it for PettingZoo, and is the only file that imports it.
Seat count varies per episode, so `possible_agents` is the six-seat maximum and `agents` holds however
many sat down; the table terminates together, because a placement is only decided once every seat has
stopped scoring.

| Check | Result |
| --- | --- |
| observation spec | names unique and matching the vector |
| rank mapping bijection | 100 mappings, in-deck ranks always below the boundary |
| action space fidelity | 4,248 decisions; every engine-legal action masked or a collapsed off-deck twin; 3,052 masked actions applied on clones and accepted |
| rank relabelling invariance | 16,275 observation pairs byte-identical across relabelled decks, to identical placements |
| hidden information | 4,610 reshuffles of everything the viewer cannot see moved not one feature |
| analytic lie feature | the observation and `probability_claim_is_a_lie` share one hypergeometric |
| environment loop | 30 episodes over 2–6 seats, rewards zero-sum at every step, winner holds the fewest points |
| pettingzoo wrapper | PettingZoo `api_test` passed |
| canonical play vs real engine | 1,591 canonical actions applied to the real `BlowCowGame` and accepted, in lockstep |

Throughput with observations encoded: **~5,000 decisions/s** single-threaded (~42 episodes/s).

## Decisions worth knowing about

**Card identity is kept in the engine, not abstracted away.** A card is its `deckOrder` integer — the
same number the engine embeds in its `card-N` ids. Suits and rank identity collapse in the *encoder*,
because the conformance run compares hands and piles card for card.

**Legality is factored, not enumerated, on the hot path.** At a trump selection every rank pairs with
every card choice, and materialising the cross product allocates four figures' worth of objects for
one decision. `legal_action_parts()` returns the factors; `legal_actions()` enumerates them and stays
the reference Stage A checks. The environment reads the former and resolves the chosen index only.

**Random play picks a *kind* first by default in the conformance run.** Flat uniform is dominated by
plays — dozens of card choices against exactly one `Call BS` — and would barely exercise the
resolutions. `--sampling` alternates, because the flat mode is what fills a table and reaches
`Call Reset`.

---

# Stage C — the trainer

`nets.py` (the network), `agents.py` (baselines), `train_ppo.py` (PPO self-play with an opponent
pool), `evaluate.py` (round-robin and exploitability).

## The network

285k parameters, and two structural choices rather than a stack of dense layers.

**One shared encoder over the fourteen card-type rows.** `canonical.py` already relabels rank
identity away per episode; running the same MLP over every card-type row makes the network
*structurally* indifferent to which slot a rank landed in, so "three of something, and the trump is
elsewhere" is learned once instead of thirteen times. The rows are pooled (mean and max) into the
trunk and kept per-row for the head.

**A factored action head.** 1,669 dense logits would be a lookup table that has to rediscover that
`trumpPlay(slot 4, two Jokers)` and `trumpPlay(slot 9, two Jokers)` are the same card decision. The
head instead assembles a per-choice logit from the embeddings of the one or two card types it sends,
a per-slot trump logit, and a rank-16 interaction between them — which keeps the two decisions
correlated, as they are (the rank you name decides which of your cards are honest) without
materialising a 13 × 119 head.

## Turn-based bookkeeping

Two things that turn-based multi-agent RL gets wrong easily:

* **A seat's reward arrives long after its action.** Other seats act in between, and the punishment
  for a bad play lands several turns later. Rewards are accumulated onto the acting seat's own most
  recent transition, and GAE runs along each seat's own trajectory rather than along wall clock.
* **Opponents must not be only your current self.** Bluff rate and call rate chase each other in a
  rock-paper-scissors cycle, so most episodes seat the learner against snapshots taken earlier in
  training, plus a share of scripted bots. `--self-play-prob` and `--baseline-prob` set the mix.

## Two findings that changed the design

### 1. Vanilla Blow Cow does not terminate without challenges

Cards leave the game only through four-of-a-kind scoring and through players leaving, and both need
cards to *move*, which needs a `Call BS` or a `Call Reset`. A table where nobody challenges cycles
for ever: every round ends on an all-pass, every card goes back to the hand it came from, nothing
changes. Three of the five baselines — honest, liar, caller — hit the move limit on essentially every
match against copies of themselves.

That makes the move limit load-bearing rather than a safety net, and it makes truncation something
the environment has to *score*, not something it can treat as an accident.

### 2. Discounting pays an agent to stall

The first two training runs both learned to stall: rounds per match climbing 7 → 206 and truncation
reaching 49%, with the reported return "improving" the whole way. Two separate causes.

**Bootstrapping an endogenous truncation is unsound.** The textbook treatment of a time limit is to
bootstrap the value function rather than pay a terminal reward. That is correct when the limit is
exogenous. Here the agent *decides* whether the match ends, so a losing agent can always choose the
bootstrap over a terminal `-1`, the value function is never anchored by a real ending, and the whole
table converges on refusing to finish. Truncation now pays the standings at the limit, minus a
penalty to every seat, so finishing is strictly better than stalling for everyone.

**Any gamma below 1 is itself a stalling incentive.** The reward that matters is at the end, so
discounting shrinks it in proportion to how long the match runs. At `gamma=0.997` a 500-decision
match discounts its own terminal ±1 down to about a fifth — lengthening the game is a direct way to
dilute a bad outcome, and the policy found it. Episodes here are finite, so `gamma` defaults to
**1.0**.

## The baseline ladder

Five scripted opponents, round-robin, seats rotated, all table sizes 2–6:

| Agent | Score | Win % | Avg points | What it does |
| --- | --- | --- | --- | --- |
| `heuristic` | **+0.39** | 44% | 0.89 | counts unaccounted trump, bluffs only when the table is cheap, and knows the Reverse Rule inverts who is worth challenging |
| `honest` | +0.16 | 26% | 0.35 | never lies, never challenges |
| `caller` | −0.07 | 22% | 0.78 | challenges at every opportunity |
| `liar` | −0.18 | 18% | 0.79 | always plays, truth be damned |
| `random` | −0.25 | 17% | 2.27 | uniform over legal actions |

Score is the placement value the environment pays: `+1` first, `−1` last, so a table of equals
averages zero. The Reverse Rule wrinkle is the interesting part of `heuristic`: with four or more
face-up trump cards the punishment flips, so the profitable challenge is against someone you believe
is *honest*. Nothing else in the game inverts like that.

## Training result

2.5M learner decisions, ~50 minutes on a GTX 1050, tables of 2–6, `--self-play-prob 0.4
--baseline-prob 0.35`. Evaluated over 200 matches per pairing, seats rotated, mixed table sizes:

| Opponent | Agent score | Agent win % | Opponent score | Truncated |
| --- | --- | --- | --- | --- |
| `caller` | **+0.43** | 42% | −0.52 | 62% |
| `random` | **+0.40** | 37% | −0.48 | 0% |
| `liar` | **+0.34** | 38% | −0.42 | 36% |
| `honest` | **+0.23** | 34% | −0.28 | 56% |
| `heuristic` | **−0.20** | 15% | +0.24 | 0% |

It beats four of the five baselines and loses to the handcrafted one. **Do not read the `heuristic`
column as progress** — measurement rule 1. This run's apparent peak-and-decline against `heuristic`
was once cited as evidence that more PPO compute is not the lever; that conclusion is unsupported.
`ppo-v1` saved no periodic snapshots and its 388-wide observation no longer loads, so its own
checkpoints cannot settle it either. The supporting indicators do not rescue it: `runs/ppo-lie` showed
the same entropy collapse, the same climb in rounds per match and the same rising truncation across
the very range where it was monotonically getting stronger, so none of those is a strength proxy here.

The stalling pathology is visible in the same run and then resolves: truncation peaks near 18% around
100k steps while the policy is still weak, and falls to 4–6% once it can win rounds. It climbs again
at the very end as entropy collapses.

### Training hygiene, since fixed

Only `latest.pt` was ever written and `--eval-games` was 40, whose standard error near 0.15 is the
size of the whole signal — so a run could not see its own trajectory. Now every evaluation writes a
keep-forever `eval-<step>.pt`, `best.pt` is selected on the mean eval score, and `--eval-games`
defaults to **300**. The mean is over scores only, since averaging a truncation fraction into a
placement score selects on a different quantity than the one being reported.

**`best.pt` is not to be trusted, and neither is post-hoc selection on `eval_heuristic`** — on
`ppo-lie` that rule picks the *weakest* checkpoint of the ten. The default eval opponents are
`heuristic` and `random` and averaging them is not neutral: across `ppo-lie`'s first five evaluations
the `heuristic` score oscillated (-0.076, -0.131, -0.077, -0.148) while `random` climbed steadily
(0.113, 0.349, 0.365, 0.458), so the mean tracked the saturating opponent. The per-eval snapshots are
the load-bearing half of the fix: selection can be redone afterwards on whatever metric the question
actually wants. Prefer the latest checkpoint, or run the round-robin.

## Exploitability

Freeze the agent, and train a fresh learner from scratch **specifically against it**, one learner seat
against a table of frozen copies. A policy that played exactly like the frozen one would score 0.
Stage C's agent is exploited for **+0.033 / +0.162** by two independent 700k exploiters at four seats.

The sharpest part is what else an exploiter is. Stage C's scores **−0.37 against `heuristic`** and
only **+0.15 against `random`**, both far worse than the agent it beats, and at a three-way table it
finishes **last** (`heuristic` +0.08, the agent +0.02, the exploiter −0.09). It has not learned to
play Blow Cow well; it has learned to play *that one opponent* — which is what an exploiter is for,
and exactly why beating the baselines is not evidence of soundness.

Throughput is about **1,000 learner decisions/s** on a GTX 1050 at `--num-envs 128`. The two things
that mattered were batching the rollout-boundary bootstrap into one forward pass (it had been one per
open seat, 22% of the whole rollout) and not computing entropy over 1,669 classes on every rollout
step. CPU is roughly 4x slower than the GPU even at these batch sizes.

---

# Stage D — R-NaD

PPO plus a pool of snapshots is fictitious play. It converges on beating what it has already seen.
R-NaD is the other kind of method: it aims at the equilibrium itself.

**It did not work here.** The agents it produced are four to six times *more* exploitable than the one
it was meant to improve on. The implementation is verified against its own closed forms and the
mechanism demonstrably engages, so this is a result about the method on this problem at this budget
rather than a bug.

## The three pieces

Only the first two are R-NaD; the third is a solver and is swappable with `--solver ppo`.

**The reward transform.** Each seat is charged `eta * log(pi/pi_reg)` on its own actions, against a
frozen regularisation policy, and credited its share of everybody else's charge. The credit half is
the part that is easy to leave out and the part that matters: without it the transform is a per-seat
shaping term, and with it the regularised game is still zero-sum — which is what gives it a unique
equilibrium for the fixed point to converge onto.

**The fixed point.** Solve the regularised game, set `pi_reg` to the answer, solve again. Without that
outer iteration this is a policy on a leash.

**NeuRD.** Its whole difference from a policy gradient is *which quantity* the advantage moves. A
softmax policy gradient's expected pull on a logit carries a factor of that action's own probability,
so an action squeezed to 1% gets 1% of the update and can never climb back. NeuRD moves the logit
directly — `d(logit_a)/dt = q_a - v` — and in a bluffing game that is not a technicality: the actions
squeezed to zero against the current opponent are exactly the ones an exploiter will punish you for
not having.

## eta, and why the published value is wrong here

The Stratego setting is 0.2, and porting it without thinking gives a policy that never moves. The
charge is **per decision**, so the inner problem trades the *episode total* of it against a terminal
payoff of at most `±1`. A seat takes on the order of a hundred decisions a match, so at `eta = 0.2` a
per-step log-ratio of a quarter already outweighs winning by an order of magnitude: every inner solve
returns `pi_reg` and the outer iteration stands still.

The default is 0.02, and `rnad_cost` in the log is the measured charge per decision. Drift per
fixed-point iteration — the log-ratio reached just before each swap — shows the leash is real and
monotone in `eta`: 0.206 nats at `eta=0`, 0.064 at 0.02, 0.022 at 0.1.

## What is checked

`rl/check_rnad.py`, ten checks, none of which is a training curve — a curve cannot tell you *which*
formula you got wrong.

* the transform cancels across the table, over 4,000 random ratios and seat counts;
* the NeuRD gradient matches its closed form exactly on 1,000 rows — `-w(1 - 1/m)` on the action
  taken, `+w/m` on each other legal action, and **zero** on an illegal one;
* a collapsed action stays recoverable, asserted as a formula: the expected pull is
  `min(1, clip * mu) * A`, giving 2.0x a policy gradient at `mu = 0.5` and a saturated 5.0x from
  `mu = 0.01` down to `mu = 0.0001`;
* `beta` gates one direction only — it never blocks a logit from coming back toward the pack;
* `pi_reg == pi` charges exactly zero over a live rollout, charges again the moment the policy moves,
  and stops again after a swap.

The `1/mu` weight is the one place a faithful-looking port goes wrong quietly. Weighting the sampled
action by `pi/mu` alone leaves the expected logit gradient proportional to `mu(a)` — the
policy-gradient behaviour NeuRD exists to remove. It has to be `1/mu`, and because that is unbounded
as `mu -> 0` with up to 1,669 legal actions, `weight_clip` caps it. The cap is exactly where the bias
is, and the check asserts its formula rather than its spirit.

## Results

Three runs, all `--solver neurd`, 2.5M learner decisions, pure self-play at 2-6 seats, `pi_reg`
replaced every 250k decisions for 10 fixed-point iterations. Throughput ~**1,500 decisions/s**,
faster than Stage C because every environment step is now a learner step. `eta = 0` is the control.

**At a mixed table the `eta=0.02` agent is the strongest thing in the repo** — 300 matches, exactly
five seats, one of each: R-NaD `eta=0.02` **+0.450**, `heuristic` +0.415, R-NaD `eta=0.1` +0.115,
Stage C PPO −0.430, R-NaD `eta=0` −0.550. At exactly four seats it sharpens further (+0.553 at a
58.3% win rate). **Head to head the same agent is third**, losing to `heuristic` by −0.485 while
Stage C loses by only −0.216. Both tables are correct; this is measurement rule 5 in its purest form,
and Stage C's pairwise-only evaluation could not have shown it. Note `eta` is not monotone: neither no
regularisation nor nine times more of it produces an agent as strong as 0.02 does.

### Exploitability: the number Stage D existed to lower, and did not

Final exploiter, 300 matches, exactly four seats:

| Target | Exploited for | Exploiter above water by |
| --- | --- | --- |
| Stage C PPO | **+0.033** / **+0.162** (two independent exploiters) | ~400-700k |
| R-NaD, `eta=0.02` | **+0.573** | <100k |
| R-NaD, `eta=0.1` | **+0.667** | <100k |
| R-NaD, `eta=0` (control) | **+0.647** | <100k |
| R-NaD, `eta=0.02` **+ snapshot pool** | **+0.536** | <100k |

**The control is the important row.** With the regularisation switched off entirely, exploitability is
the same. So R-NaD's transform is not what caused the regression — taking the opponent pool and the
scripted bots away is. **And giving the pool back does not rescue it.** A snapshot has a policy, so it
has a log-ratio and can be seated without breaking the transform; that run is the last row, still
three times more exploitable than plain PPO and still **−0.86 against `heuristic`** head to head.

## Why

1. **Pure self-play removed the only thing punishing the agent.** R-NaD needs a log-ratio for every
   seat's action, so a scripted bot cannot be seated and the pool goes with it. Stage C's non-learner
   seats were 25% scripted, and both `caller` and `heuristic` challenge — in a bluffing game that is
   the signal. This is the explanation the control supports, and it is a cost of the *setting* R-NaD
   requires rather than of its update rule.
2. **Ten fixed-point iterations is not a fixed point.** DeepNash ran orders of magnitude more.
3. **The game is not two-player zero-sum.** R-NaD's uniqueness argument is for 2p0s, and the
   intransitivity above is direct evidence that "the equilibrium" is not one thing here.
4. **The regularisation is a light touch even where it binds** — 0.004-0.016 per decision against
   advantages normalised to unit variance. It is worth about a placement point of playing strength
   over the control, but `eta=0.1` tightens it ninefold and gives most of that back, so more is not
   the answer either.

One more finding, from an aborted fourth run. Seeding R-NaD from the Stage C checkpoint moved **3.5
nats** away from it on the *first* update, before the critic had seen a single return, and never came
back. A warm start is the one case where an advantage read off an untrained value head is destructive
rather than merely slow, which is what `--value-warmup` is for. It was not enough alone — the same
move costs far more log-ratio when the reference policy is confident — but the flag stays because it
is right regardless.

---

# Diagnosis — what is actually wrong

`rl/analyze.py` plays with full ground truth and counts the decisions the game turns on. Two columns
carry almost all of the signal.

**Discretionary bluff rate.** An agent holding no trump has to lie or pass; that is arithmetic, not
bluffing. Only a lie told with a trump in hand is a choice. `heuristic` bluffs 7-23% overall and
**0.00%** discretionarily — it never once lies on purpose, and it beats everything head-to-head.

**Call discrimination**, `call.hit%` minus `was.good%`: how much better than the base rate of the
opportunities it saw an agent picks its challenges. This is the skill, and it is the one the learned
agents do not have.

| Agent | disc. bluff% | call% | discrimination | exploited for |
| --- | --- | --- | --- | --- |
| `heuristic` | 0.0 | 82.5 | +5.4 | +0.542 (200k, mixed) |
| Stage C PPO | 32.5 | 30.5 | +0.8 | +0.033 / +0.162 |
| PPO + aux head | 33.4 | 35.8 | **+17.0** | +0.360 |
| R-NaD `eta=0.02` | 57.7 | 20.5 | **-5.5** | +0.573 |

Put an exploiter beside its target and the mechanism is unmistakable. Against Stage C, at a table of
its own copies, the target bluffs 74% and calls BS on **5.4%** of its chances; the exploiter bluffs
80% and calls on **0.4%**. Nobody challenges anybody, so lying is free, and the best response to an
agent that cannot catch a lie is to tell more of them. That is the whole exploit, and it is why every
exploiter scores -1.000 against `heuristic`, which calls 82% of the time. The Reverse Rule is not the
explanation — it is armed on only 3-14% of opportunities.

## The information is there; the reward never taught it

`--aux-lie-coef` adds a head predicting whether the current BS target is lying, supervised from the
simulator during training and never consulted at play time. It reaches **78-85% accuracy within 12k
decisions**.

The observation already carries what the inference needs — unaccounted trump per rank, unseen cards,
the target's face-down pile, who has been caught lying this round — and a small network learns to read
it almost immediately when told to. Meanwhile 2.5M decisions of placement reward bought Stage C
**+0.8** points of call discrimination. The gap is not perception and not representation. It is credit
assignment.

## Interventions, and what each one cost

**A — a harder opposition (failed).** Seating `liar` and `honest` alongside `heuristic` and `caller`
at 55% turned tables into the non-terminating cycle the move limit exists for: truncation **57%**,
matches **185 rounds**. Even after dropping `honest` and rebalancing, the run scored **-0.96 against
`heuristic`**. More opposition is not better opposition, and any bot that neither challenges nor is
challenged poisons the episode length for everyone.

**B — the auxiliary lie head (partial).** Same settings as Stage C plus one loss term: call
discrimination +0.8 → **+17.0** in 20% fewer decisions, and exploitability +0.033/+0.162 → **+0.360**.
It did what it was built to do and made the agent **more** exploitable. Sharper play is a sharper
thing to best-respond to.

**C — the analytic lie estimate as an input feature (failed; the direct test).** Two features per seat
row handing over `probability_claim_is_a_lie` already computed. Two seeds per arm, 2.5M steps,
`BLOWCOW_NO_LIE_FEATURE=1` as the control at identical width, all four compared head to head at
matched steps over 500 matches per pairing:

| | treatment vs control |
| --- | --- |
| s1 vs s1 / s1 vs s2 | **+0.142 ± 0.023** / **+0.126 ± 0.024** |
| s2 vs s1 / s2 vs s2 | **-0.054 ± 0.022** / **-0.100 ± 0.023** |
| **mean feature effect** | **+0.029** |
| within-arm: treatment s1 vs s2 | **+0.141 ± 0.023** |
| within-arm: control s1 vs s2 | **-0.029 ± 0.024** |

**The effect is entirely decided by which treatment seed you look at**, so at the seed level the
estimate is roughly **+0.03 ± 0.10**. The measurement itself is precise — +0.142 reproduced an earlier
+0.127 on a different evaluation seed — so the variance is in *training*, not scoring. Call
discrimination says the same thing more sharply: treatment +1.85 / −0.11, control +0.63 / +0.60,
against `heuristic`'s +5.4. Calling *frequency* tracks the seed rather than the feature.

**Why this is worth having measured.** The standing diagnosis was an inference from the aux head. This
is the direct test: perception was handed over free and already computed, and behaviour did not
change. **The bottleneck is confirmed to be downstream of knowing**, which retires this intervention
and any other feature engineering aimed at the same gap. Weakly supported and worth recording: the
treatment arm's seeds differ by 0.141 against the control's 0.029, so the feature may make training
*less* stable — treatment seed 2 sat in the non-terminating-table regime until 1.5M steps.

## Predictability is not the explanation either

The obvious story for "strong but exploitable" is that a good agent commits and a committed agent can
be read. `rl/predictability.py` clones the agent from its own trajectories and reports accuracy above
uniform-over-legal. It **refutes the hypothesis**.

| Agent | clone lift | exploited for |
| --- | --- | --- |
| `caller` / `honest` | 97.9 / 96.2 | — |
| `heuristic` | 82.7 | +0.542 (200k, mixed) |
| PPO + aux head | 34.7 | +0.360 |
| Stage C PPO | 34.3 | +0.033 / +0.162 |
| R-NaD `eta=0.02` | **11.2** | **+0.573** |

R-NaD is the least predictable agent measured and the most exploitable. Stage C and the aux agent have
the *same* clone lift to within noise and differ tenfold in exploitability. So there are at least two
independent ways in — being readable move by move, and being statistically weak in a way that needs no
prediction at all — and behavioural cloning accuracy measures only the first.

## A learned belief does not transfer; counting does

`rl/belief.py` trains a network on one agent's self-play to predict "is the current BS target lying",
then puts it in front of opponents it has never seen, with `heuristic`'s closed-form
`probability_claim_is_a_lie` as the control. Read **AUC** and ignore accuracy across rows: the base
rate of lies swings from 7.6% to 92.3%, so accuracy mostly measures the opponent.

| Evaluated on | learned AUC | analytic AUC | lies |
| --- | --- | --- | --- |
| Stage C self-play (held out, in-distribution) | **0.837** | 0.743 | 75.7% |
| `heuristic` | 0.737 | 0.743 | 7.6% |
| `liar` | 0.809 | 0.660 | 92.3% |
| R-NaD `eta=0.02` | 0.636 | **0.829** | 78.4% |

**Learning beats counting on the distribution it was trained on, and does not survive meeting a new
opponent.** Against the R-NaD agent the learned model falls to 0.636 while the analytic estimate
*rises* to 0.829, and its log loss trebles. This is also the best explanation on record for why the
auxiliary head made the agent more exploitable: it taught the policy to read lies **as the training
distribution tells them**, and an exploiter is by construction an opponent that lies differently.

**Read this alongside the Ante finding at the top of this file.** Against *trained* opponents the
analytic estimate is itself at or below chance (0.42-0.51), because it assumes hidden cards are a
uniform draw from the unseen pool. Counting is robust across the *scripted* opponents above and is not
a substitute for reading a strategic player.

---

# Search — ISMCTS at play time

Everything up to here tunes a **reactive policy**: a fixed function from observation to action. Both
levers that made that function better at reading a lie also made it easier to best-respond to.
`rl/blowcow/ismcts.py` changes the kind of thing being improved — sample the hidden cards, search the
resulting game, and answer from the position.

It is Cowling, Powley and Whitehouse's single-observer ISMCTS with two substitutions that make it
affordable: leaves are evaluated by a trained value head rather than rolled out, and selection is PUCT
against a trained policy prior rather than uniform over 1,669 actions. Availability counts are kept
per action, which is the part that makes it ISMCTS rather than PIMC.

Three things are specific to this game.

**Determinizations are uniform, and that is correct but uninformative.** The rules constrain the
*counts* of hidden cards and never their identities, so every permutation of what the viewer cannot
see is a world it cannot rule out — `check_ismcts.py` asserts exactly that, by encoding the viewer's
observation in the determinized world and requiring it not to move. It also throws away the fact that
a player who plays trump probably had trump. **The sampler is where a belief model plugs in, and
nothing else changes.**

**The backup is paranoid.** Placement is constant-sum but not two-player zero-sum, so there is no
single scalar every seat agrees on. Values are kept from the searching seat's point of view and every
other seat is assumed to minimise them — one sign flip, on the exploitation term only. Pessimistic at
three or more seats, and cheap. Settled negatively as a lever: head to head at four seats with the
good critic and 96 simulations, `opponent=prior` loses to paranoid by **+0.019 ± 0.042**, nothing.

**A clone must be given its own randomness.** `BlowCowEngine.clone()` shares the shuffle callback by
design, so a search reaching a `Call Reset` would draw from the live match's stream and desynchronise
it. `determinize` replaces it, and the check asserts the object identity differs.

## Making it affordable

The first working version took **336ms per 64-simulation search**. Profiling put the cost where it was
not expected: the network, not the cloning. At these sizes the network is entirely latency-bound — a
**batch of 64 costs the same 4.3ms as a batch of 2**, and cuda is *slower* than cpu at batch 2 because
it is all kernel launch. So leaves are evaluated in batches, with a virtual loss on the way down so
the batch spreads out. That took it to 129ms — and inverted the profile, after which `copy.deepcopy`
was **66% of the whole search**. `_copy_record` walks `__slots__` instead and `PublicEvent` became
frozen so the 64-entry public trace is shared rather than rebuilt; inlining PUCT selection took the
rest.

| | 64-simulation search |
| --- | --- |
| one leaf per forward | 336ms |
| batched leaves | 129ms |
| hand-rolled clone + inlined PUCT | **65ms** |

Two things make the hand-rolled clone safe to keep. It is driven off `__slots__`, so a field added to
`state.py` is copied without anyone remembering it exists; and `clone independence` scrambles a clone
to destruction and requires the original to be unchanged. That check was written twice: the first
version passed while silently proving nothing for 5 of the 8 fields. It now compares deep
fingerprints, refuses to pass if a field was null in every sample, and was verified by sabotaging
`clone` one field at a time and confirming each sabotage is caught.

One bug worth recording, because it is silent. With a batch at least as large as the simulation
budget, every simulation in the first batch reaches an unexpanded root, returns an empty path, and
records nothing — the search returns the prior with extra steps and looks entirely normal from
outside. The root is now primed before the loop, from the *real* state rather than a determinization.
`search uses its budget` is the check that fails if this regresses.

## Does it work? At two seats, yes. Beyond that, no.

**Search against the policy it searches with**, which is the only comparison that isolates it:

| table | ISMCTS (32 sims) vs the same checkpoint, no search | n |
| --- | --- | --- |
| 2 seats | **+0.290 ± 0.068** | 200 |
| 4 seats, 2v2 | −0.010 ± 0.038 | 400 |

At two seats search is worth a third of a placement point. At four it is worth **nothing at all**. And
at a three-seat table holding one of each, the *searchless* policy leads by 0.43 (+0.390 ± 0.052
against −0.040 ± 0.050, with `heuristic` at −0.350).

**The big number against `heuristic` is a matchup, not a strength gain.** Search turns −0.304 ± 0.021
into +0.199 ± 0.031 at four seats, a swing of half a placement point that survives excluding truncated
matches. But since the two are level played against each other, that swing says ISMCTS matches up
better against `heuristic` specifically, and nothing more.

## At the useful budget there is no tree

Instrumenting `_descend` on real four-seat positions:

| sims | legal at root | root actions visited | mean depth | max depth |
| --- | --- | --- | --- | --- |
| 16 | 64 | 5.4 (8%) | **1.00** | **1** |
| 32 | 64 | 5.8 (9%) | 1.46 | 2 |
| 64 | 64 | 7.9 (12%) | 1.78 | 4 |
| 256 | 64 | 15.7 (25%) | 2.36 | 8 |

**At sixteen simulations the tree is exactly one ply deep.** It tries about five candidate moves,
samples the hidden cards, and asks the value head how the result looks. Nearly everything search wins,
it wins at depth one — which also explains why the `prior` opponent model changes nothing measurable.

Given the search is one ply anyway, the apparent improvement is to do that ply properly: evaluate
every candidate over *shared* determinizations, so the comparison is paired. That is
`blowcow/lookahead.py`, and it is **much worse** — `-0.647 ± 0.019` against `heuristic` at four seats
(0% wins in 400) against the raw policy's `-0.304 ± 0.021`. The cause is **maximisation bias**, not a
bug: argmax over twelve noisy estimates selects whichever candidate carries the largest positive
error, and with a critic scattering by ±0.3 that dominates the real differences between actions.
PUCT's prior term is exactly what protects ISMCTS from this. The module is kept as a recorded negative
result, with `lookahead legality` asserting it at least plays legal, read-only moves.

## The value head is the ceiling, and the limit is signal not capacity

If depth one is where the value comes from, the leaf evaluator is the whole algorithm.
`value_calibration.py` scores it against the trivial always-zero predictor, measured **on-policy**:

| phase of match | skill | correlation |
| --- | --- | --- |
| first third | **−0.003** | 0.248 |
| middle third | 0.200 | 0.447 |
| last third | 0.421 | 0.617 |

**For the first third of a match the critic is worse than answering zero.** Over a whole match it
explains 20% of the outcome's variance, is under-dispersed (predicted sd 0.45 against a true 0.71),
and runs optimistic at four seats. Distribution shift is *not* the problem — seated with `heuristic`,
skill goes **up** to 0.315, because matches containing a bot that ends them are more predictable.

`train_value.py` separates capacity from signal by deleting the reinforcement learning: play matches,
label every decision with the placement that seat actually finished with, fit by regression, sweep the
trunk width. Scored on held-out **matches**, not rows — consecutive decisions share a label, so a
row-wise split would leak the answer. 600 matches, 71,746 decisions, 15,531 held out:

| model | params | skill | **first third** | mid | last |
| --- | --- | --- | --- | --- | --- |
| PPO critic, as trained | 285,047 | 0.365 | **0.154** | 0.313 | 0.605 |
| supervised, hidden=128 | 120,823 | 0.559 | **0.361** | 0.514 | 0.780 |
| supervised, hidden=256 | 285,047 | 0.559 | 0.368 | 0.513 | 0.776 |
| supervised, hidden=512 | 810,103 | 0.562 | 0.372 | 0.511 | 0.783 |
| supervised, hidden=1024 | 2,646,647 | 0.566 | 0.377 | 0.516 | 0.783 |

**It is the signal.** A network with fewer than half the parameters beats the PPO critic 0.559 to
0.365, and 0.361 against 0.154 in the phase where the critic has no skill at all. Same features, same
architecture. The only change is an exact target in place of one bootstrapped through GAE across
ninety-odd rounds. **It is not capacity.** Twenty-two times the parameters moves skill by **+0.007**,
flat in every phase separately — which disposes of enlarging the model, and of redesigning an
architecture whose capacity is already going unused.

One caveat that cuts the other way: the supervised head is tested on the distribution it trained on
while the PPO critic is away from home. That is not enough to matter — `value_calibration.py` puts the
PPO critic at **0.205 on its own on-policy distribution**, worse than the 0.365 it manages here.

## Fixing the critic unlocks the search

The supervised critic was trained for real (`runs/value/critic-256.pt`, 1,200 matches) and given to
ISMCTS through `value=`, which loads a **separate** network for leaves while the policy prior stays
exactly the PPO one — so the critic is the only variable.

**At a fixed budget it is worth about a seventh of a placement point.** 32 simulations, 2 seats, head
to head against the identical search carrying the PPO critic: **+0.150 ± 0.070**.

**But its advantage is coverage, not accuracy.** Scored on pure `ckpt` self-play with the acting
seat's observations, the two critics are level (skill 0.190 against 0.193, both with a negative
opening third). What survives is the *off-turn* gap: the PPO critic's last-third skill falls from
0.605 to 0.267 when asked about a position it is not to move in, and the supervised one — trained on
every seat's view — does not. A search leaf is always such a position. **The critic is therefore not
fixed**: at skill ~0.19 it remains the bottleneck, and the gap between 0.647 in-distribution and 0.193
out of it says the fix is a broader generating distribution rather than a better fit to this one.

**And it makes simulation count matter, which it previously did not.**

| head to head, 2 seats | score | ms per decision |
| --- | --- | --- |
| PPO critic, 96 sims vs 16 | +0.043 ± 0.085 — nothing | — |
| supervised critic, 96 sims vs 16 | **+0.560 ± 0.059**, 78% wins | 203 vs 57 |
| supervised critic, 384 sims vs 96 | **+0.575 ± 0.065** | 662 vs 203 |

Each 4x of budget is worth about the same again, with no saturation yet. Cost is roughly linear (32
sims 57ms, 1,536 sims 2.7s, single-threaded cpu), so **384 simulations at about two thirds of a second
is a deployable operating point** for a turn-based game. The earlier finding that budget buys nothing
was true *conditional on the critic*, and that condition is gone. **A negative result about a lever
that consumes a broken component is a result about the component** — a trap fallen into twice here.

The mechanism is **breadth, not depth**. With the good critic, root actions visited at 256 sims goes
15.7 (25%) → **30.0 (47%)** while mean depth barely moves. What a trustworthy critic buys is the
ability to *tell candidate actions apart*, so PUCT spends its budget genuinely evaluating twice as
many of them. Stacked up, at two seats against the raw policy: **+0.360 ± 0.066**, 68% wins.

## The multiplayer deficit, and a fix that worked without helping

Five things have been tried against it, and all five land in the same place:

| at three seats, one of each | search | `ckpt` |
| --- | --- | --- |
| PPO critic, uniform, 32 sims | -0.040 | +0.390 |
| supervised critic, 32 sims | -0.010 | — |
| supervised critic, 96 sims | -0.055 | +0.340 |
| + `opponent=prior` | -0.030 | +0.355 |
| + belief-weighted determinization | -0.010 | +0.375 |

The belief sampler is worth recording carefully, because it is a **real defect, correctly fixed, that
bought no strength**. Uniform determinization was telling the search that opponents lie far more often
than they do — 83.8% of worlds saying "lie" against a truth of 46.0%, corrected to 48.6%. The
behaviour it was predicted to fix changed exactly as intended: the search's call rate halved from
24.5% to 12.3%, matching the raw policy's 13.9%, and its call discrimination went from −3.6 (worse
than random) to +0.24. The score moved from −0.06 to −0.07.

So the over-calling was a *symptom*, not the cause. The sampler is kept because it is right, and
`determinization legality` proves the weighted worlds are still legal ones — but the multiplayer gap
is still unexplained, and it is not the critic, the budget, the backup, or the world prior.

## Expert iteration — closed until the search leads above two seats

`train_expert.py` generates self-play with the full search, fits the policy to the search's visit
counts and the value to the realised placement, and promotes the result to be the next prior and
critic. Two guards keep the loop honest, and the first version had neither: **fine-tune, do not
refit** (a fresh network from ~50k targets scored **-0.240 ± 0.049** against its own starting point),
and **gate the promotion** on beating the incumbent head to head, so a bad round costs one iteration
instead of every iteration after it.

**At 64 simulations the loop does not work** and the gate said so three times running (-0.060,
-0.093, -0.082, nothing promoted). The reason is that at that budget the search barely disagrees with
its own prior — 76.2% argmax agreement and KL 0.253, against 52.4% and 0.769 at 384. **The simulation
budget decides whether there is anything to distil at all.**

Rerun at 384 the gate appeared to pass three times, and **every one of those numbers was an
artifact.** Re-scored honestly over 400 matches across 2/3/4 seats, `it0` fails at **-0.089** and the
loop should have halted before it started. Two faults, both fixed, both worth knowing generally:

* **The gate was selection-biased.** 300 matches has a standard error near 0.06, and promoting on
  `> 0` adopts about half of all neutral changes while reporting whatever positive noise carried them
  through. `--promote-margin` now defaults to **0.05** and `--promote-games` to 400. The bias is not
  merely optimistic, it is *compounding*, because a promoted checkpoint becomes the next round's
  generator and the next round's incumbent.
* **The gate measured only the table size it trained on.** Generation and gating were both two-seat,
  so nothing in the loop could see the four-seat collapse (+0.068 at two seats, -0.163 at four).
  `--promote-players` now defaults to **2,3,4** independently of `--players`, and
  `evaluate_promotion` returns a margin per table size as well as the pooled one.

Rerun as the corrected code prescribes — 384 sims, generating *and* gating across 2/3/4 seats, three
rounds — nothing was promoted and nothing came close (-0.103, -0.147, -0.175). The striking part is
the **ordering**: mixed-table targets do not merely dilute the two-seat gain, they **invert** it to
-0.188, and the damage is *largest* at two seats and smallest at four — precisely inverse to where the
search is strong. The cause is visible in the targets:

| targets from | rows | actions visited | entropy | share of visits on the top action |
| --- | --- | --- | --- | --- |
| 2 seats | 3,214 | 8.1 | 1.220 | **0.543** |
| 3 seats | 7,960 | 13.0 | 1.598 | 0.450 |
| 4 seats | 18,428 | 19.7 | 1.996 | **0.362** |

At two seats the search commits; at four it spreads 20 actions and its best gets barely a third — **a
target that is close to a shrug**. And that is a **sampling pathology as well as a quality one**: a
four-seat match yields far more decision rows, so an evenly-mixed *match* schedule produced 62% of its
targets from four seats and 11% from two. Naive mixing over-weights, automatically and invisibly,
exactly the table size where the expert is weakest.

**Distilling a search that is no better than its own prior is worse than not distilling at all.** If
this is revisited, the two obvious levers are balancing rows by table size rather than matches, and a
temperature on the visit counts — but neither is worth spending until the search is actually ahead
above two seats, which is the same upstream blocker as everywhere else in this file.

**The general lesson, paid for twice here:** a measurement is not a result until the thing measuring
it has been checked against a case whose answer is already known. Both gate faults were invisible from
inside the loop and obvious the moment the checkpoints were scored by a different instrument.

## Running the diagnostics

```bash
python rl/analyze.py --agents ckpt:runs/ppo-v1/final.pt heuristic --players 4 --games 200
python rl/predictability.py --agents heuristic ckpt:runs/ppo-v1/final.pt --games 150
python rl/belief.py --train ckpt:runs/ppo-v1/final.pt --test heuristic liar --games 150
python rl/train_ppo.py --steps 2000000 --aux-lie-coef 0.5 --run runs/ppo-aux

# anchor the scale before believing any exploitability number
python rl/train_ppo.py --steps 700000 --opponent heuristic --exploiter --run runs/x-heuristic
```

---

# Where this leaves it

Nothing here is both skilled and hard to exploit. `heuristic` and the aux agent are skilled and
exploitable; Stage C is hard to exploit and unskilled, and its robustness looks less like a virtue
than like having little worth punishing. The one lever with evidence behind it is the **population**:
Stage C is the only agent trained against a pool plus scripted opponents and the only one that is hard
to best-respond to, and the `eta = 0` control removed exactly that and lost exactly that.

## What is next

* **Attack credit assignment, since that is what is left.** Perception was handed over free and
  precomputed and behaviour did not move, so the gap is downstream of knowing. The candidates are a
  reward resolving nearer the decision, an auxiliary objective *trained on* rather than supplied, or
  search that carries the consequence back to the call. The aux-lie head is not the free answer: it
  gave the best discrimination measured (+17.0) and the most exploitable agent (+0.360). **The Ante
  package is the first candidate taken seriously**, and it worked — see `rl/ANTE.md`.
* **Retest whether more compute is a lever — `runs/ppo-long-s11/s12`.** The claim that it is *not*
  rested entirely on the `heuristic` score, which ranks backwards, and that claim is what steered the
  effort into search, distillation, critics and feature engineering, all four of which have now been
  measured and failed. Meanwhile the one thing showing clean monotone improvement is later-versus-
  earlier within a run. The runs continue `ppo-nolie` from 2.5M with `--init` and use `--eval-anchor`
  pointed at that same checkpoint, so `eval_anchor` reads as "what has the extra compute bought". Two
  seeds, because 0.14 differences here are seed noise.
* **Put the supervised critic to work.** It is 2.3x better than the PPO one where it matters most, and
  what has not been done is *using* it as the initialisation for PPO's own critic. `--init-value` is
  implemented and tensor-verified but **still never evaluated**. Track with `value_calibration.py`;
  first-third skill is the number to move. Note its checkpoints are 388-wide and predate the
  observation change.
* **A population, not a ladder.** A single score is the wrong summary. Rank from a population
  evaluated at several table compositions, and always include the head-to-head against whatever was
  changed.
* **Exploitability as a tracked metric.** Deprioritised rather than dropped. The goal here is an agent
  that beats strong opponents, and strength and unexploitability are close to orthogonal in this game.
* **Faster rollouts.** The observation encoder is now the remaining pure-Python cost; vectorising it,
  or moving env stepping to worker processes, is the next 2-4x. Note that cuda does not help — every
  batch size used here is latency-bound, and cpu wins.

**Closed, with the evidence:**

* ~~Expert iteration.~~ Tried twice; three honestly-gated rounds scored -0.103/-0.147/-0.175 and none
  was promoted. Distillation is downstream of the expert being expert, so it cannot fix the
  multiplayer deficit — it is one of the things blocked by it.
* ~~The analytic lie estimate as an input feature.~~ Built, measured over two seeds per arm, does
  nothing (+0.029 against a within-treatment seed gap of 0.141). The columns stay because they are
  free and proven legal.
* ~~R-NaD.~~ Built, verified, four to six times more exploitable, and the `eta = 0` control shows the
  regularisation was not the cause.
* ~~Belief-weighted determinizations.~~ Built and correct; the over-calling it fixed was a symptom.
