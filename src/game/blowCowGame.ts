import {
  BLOW_COW_IMPLEMENTED_CHARACTER_NAMES,
  assignRandomImplementedCharacters,
  getAvailableImplementedCharacterNames,
  isImplementedCharacterName,
  type BlowCowCharacterName,
  type BlowCowImplementedCharacterName,
} from './blowCowCharacters.ts'
import {
  BLOW_COW_RULE_IDS,
  canRuleTakeStatus,
  getRuleDefinition,
  getRemovableRuleIDs,
  isBlowCowRuleID,
  isBlowCowRuleStatus,
  isDefaultRulesSelection,
  normalizeRulesSelection,
  type BlowCowRuleID,
  type BlowCowRulesState,
} from './blowCowRules.ts'
import {
  BLOW_COW_MAX_STATUSES_PER_PLAYER,
  DEFAULT_BLOW_COW_STATUS_TURNS,
  MAX_BLOW_COW_STATUS_TURNS,
  formatStatusTitles,
  getOpposedStatusID,
  isBlowCowStatusID,
  normalizeStatusSelection,
  normalizeStatusTurns,
  type BlowCowStatusID,
} from './blowCowStatuses.ts'
import { comparePokerHands, evaluatePokerHand } from './blowCowPoker.ts'

export const BLOW_COW_GAME_NAME = 'blow-cow'
export const BLOW_COW_MIN_PLAYERS = 2
export const BLOW_COW_MAX_PLAYERS = 8
export const INITIAL_TABLE_STATUS = 'Waiting for everyone to sit down before the bluffing starts.'
export const CARD_BACK_SPRITE = 'back01.png'
export const DEFAULT_BLOW_COW_SPEED_MULTIPLIER = 1 as const
export const BLOW_COW_SPEED_MULTIPLIERS = [0.5, DEFAULT_BLOW_COW_SPEED_MULTIPLIER, 2] as const
/**
 * How many emote sprites `emote_sprites/` holds. Hand-synced, because this module is also loaded
 * directly by node and so cannot glob the folder. `EMOTE_SPRITES` in `src/ui/emoteSprites.ts` reads
 * it back to drop any sprite the server would refuse, so the picker can never offer an unsendable one.
 */
export const BLOW_COW_EMOTE_COUNT = 26
const INVALID_MOVE = 'INVALID_MOVE' as const
/**
 * boardgame.io's `Stage.NULL`, which is the literal `null`: a player who is active but in no stage.
 *
 * Spelled out rather than imported from `boardgame.io/core`, because that specifier resolves only
 * through a bundler and this module is also loaded directly by node for `npm run check:gameplay`.
 * Keeping the game module free of runtime dependencies is deliberate. The cast exists only because
 * `StageArg` is typed as a stage name; upstream types its own constant as `any` for the same reason.
 */
const NULL_STAGE = null as unknown as string

export const BLOW_COW_RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const
export const BLOW_COW_SUITS = ['clubs', 'diamonds', 'hearts', 'spades'] as const
export const BLOW_COW_DIRECTIONS = ['clockwise', 'counterclockwise'] as const

export type BlowCowRank = (typeof BLOW_COW_RANKS)[number]
export type BlowCowSpeedMultiplier = (typeof BLOW_COW_SPEED_MULTIPLIERS)[number]
export type BlowCowSuit = (typeof BLOW_COW_SUITS)[number]
export type BlowCowDirection = (typeof BLOW_COW_DIRECTIONS)[number]
export type BlowCowCardRank = BlowCowRank | 'Joker'
export type BlowCowCardSuit = BlowCowSuit | 'joker'
export type BlowCowGameStatus = 'staging' | 'active' | 'finished'
export type BlowCowRoundStatus = 'awaitingTrumpSelection' | 'inProgress' | 'betweenRounds'
export type BlowCowHistoryEventKind = 'system' | 'action' | 'verdict' | 'punishment' | 'point' | 'leave'
export type BlowCowTelemetryEventKind = BlowCowHistoryEventKind | 'turn' | 'game'
export type BlowCowCardGainSource = 'initialDeal' | 'punishment' | 'reset' | 'roundReturn' | 'other'
export type BlowCowRankSelectionMode = 'default' | 'manual'

export type BlowCowCard = {
  id: string
  rank: BlowCowCardRank
  suit: BlowCowCardSuit
  sprite: string
  deckOrder: number
}

export type BlowCowScoredSet = {
  id: string
  rank: BlowCowRank
  cards: BlowCowCard[]
  awardedAtRound: number
  awardedAtTurn: number
  source: BlowCowCardGainSource
}

export type BlowCowTablePlay = {
  id: string
  playerID: string
  cards: BlowCowCard[]
  declaredCardCount?: number
  revealedCardIDs?: string[]
  rehiddenCardIDs?: string[]
  /**
   * Null only for a card sneaked onto the table before the round had a trump rank. There was nothing
   * to claim yet, so the play claims nothing until one is chosen and `settleUnclaimedPlays` fills it
   * in. Every other route to the table names a rank at the moment the cards land.
   */
  claimedRank: BlowCowRank | null
  playedAtRound: number
  playedAtTurn: number
  revealedAtTurn: number | null
  wasTrumpSelection: boolean
}

/**
 * A status effect a player is currently under. Public in every sense — the counter is drawn on the
 * seat block for everyone, which is the point of it.
 */
export type BlowCowPlayerStatus = {
  id: BlowCowStatusID
  /** Ticks down by 1 at the end of this player's own turn. The status is dropped when it hits 0. */
  turnsRemaining: number
}

export type BlowCowPlayerState = {
  id: string
  seatIndex: number
  character: BlowCowCharacterName | null
  hand: BlowCowCard[]
  points: number
  scoredSets: BlowCowScoredSet[]
  matchStats: BlowCowPlayerMatchStats
  pendingRevealPlayID: string | null
  turnStartingDirection?: BlowCowDirection | null
  hasUsedManualPlay: boolean
  hasUsedGrandmasterBSOverride: boolean
  /**
   * The character this player took with The Seeker, or null. `character` has already been overwritten
   * with it by then, so this is the only surviving trace that the seat started the match as The
   * Seeker — worth keeping, because the badge everyone reads gives no hint that the card was chosen.
   */
  seekerPickedCharacter: BlowCowCharacterName | null
  /**
   * The rule this player tore up with The Broken, or null. Doubles as the spent flag — unlike The
   * Seeker, breaking a rule leaves `character` alone, so there has to be something else to read.
   */
  brokenRemovedRuleID: BlowCowRuleID | null
  /** One accusation per player per round, spent whether or not it lands. Cleared by `beginNextRound`. */
  hasUsedAccusationThisRound: boolean
  /** One Defy per round for The Prototype, spent the moment it lands. Cleared by `beginNextRound`. */
  hasUsedDefyThisRound: boolean
  /**
   * One Conspire per round for The Mastermind, spent the moment the hand is opened rather than when
   * the play lands — there is no backing out of a conspiracy, so the two are the same commitment.
   * Cleared by `beginNextRound`.
   */
  hasUsedConspireThisRound: boolean
  /**
   * One Mimic per round for The Mime, spent whichever way the coin lands. Cleared by `beginNextRound`.
   */
  hasUsedMimicThisRound: boolean
  /**
   * One encore per round for The Clown, spent by the play that earns it rather than by the action it
   * buys — there is no way to decline an encore, so the two are the same moment. Cleared by
   * `beginNextRound`.
   */
  hasUsedClownEncoreThisRound: boolean
  /**
   * Took the table this round, by a BS verdict or a resolved accusation. Both flags exist only so
   * The Privileged can be denied the next round's start: the claim is read while the new round is
   * being opened, by which point "this round" has already become the last one, so `beginNextRound`
   * rolls the first into the second before it picks a starting player.
   */
  wasPunishedThisRound: boolean
  wasPunishedLastRound: boolean
  hasLeft: boolean
  leaveOrder: number | null
  /** The leave-triggered ability that moved this player's points, or null. Set once, never cleared. */
  leaveEffect: BlowCowLeaveEffect | null
  /**
   * The status effects this player is under, at most `BLOW_COW_MAX_STATUSES_PER_PLAYER` of them.
   * Optional in the type as well as in practice: a match staged before statuses existed restores from
   * `data/matches/` without the field, and nobody in it was ever afflicted.
   */
  statuses?: BlowCowPlayerStatus[]
}

/**
 * A leave-triggered character ability that changed a player's point total.
 *
 * Kept in `G` rather than left to the history log because two surfaces need it long after the fact:
 * the label that sits above the block for the rest of the match, and the results table, which has to
 * explain why a total does not match the ranks that were scored. Public in every sense — characters
 * are public, and the ability announces itself in the log the moment it fires.
 */
export type BlowCowLeaveEffect = {
  character: BlowCowCharacterName
  /** Signed, and never 0: only abilities that actually moved the total are recorded. */
  pointDelta: number
}

/** `-2 points (The Speedrunner)`. Shared so the seat label and the results tooltip cannot drift. */
export function formatLeaveEffectLabel(leaveEffect: BlowCowLeaveEffect) {
  const magnitude = Math.abs(leaveEffect.pointDelta)

  return `${leaveEffect.pointDelta > 0 ? '+' : '-'}${magnitude} point${magnitude === 1 ? '' : 's'} (${leaveEffect.character})`
}

export type BlowCowPlayerMatchStats = {
  playCount: number
  callBSCount: number
  passCount: number
  resetCount: number
  turnsInGame: number
  lieCount: number
  cardsPlayed: number
  punishmentCount: number
  bsWinCount: number
  accusationCount: number
  accusationWinCount: number
}

export type BlowCowRoundState = {
  roundNumber: number
  status: BlowCowRoundStatus
  direction: BlowCowDirection
  startingPlayerID: string
  pendingStartingPlayerID: string | null
  trumpRank: BlowCowRank | null
  previousTrumpRank: BlowCowRank | null
  passStreak: number
  lastNonPassingPlayerID: string | null
  /**
   * The player The Invisible Hand handed the round to, who owes the table a play on the one turn
   * that follows. Only `Pass` is actually taken off them, because on the first turn of a round there
   * is nothing to challenge and nothing to reset, so that is already the whole action space.
   *
   * Optional in the type as well as in practice: a match staged before The Invisible Hand existed
   * restores from `data/matches/` without the field, and nobody in it was ever forced to play.
   */
  forcedPlayPlayerID?: string | null
  /**
   * The turn number `handleTurnStart` last actually opened, and the guard the status tick reads: a
   * turn that never began never ends, so it cannot spend a status counter. `startMatch` handing play
   * to the first seat is the case this exists for.
   *
   * Optional for the same reason as the field above it — a match restored from before statuses
   * existed has no turn on record, and its first real turn start writes one.
   */
  startedTurnNumber?: number | null
  maxCardsOnTable: number
}

export type BlowCowTableState = {
  plays: BlowCowTablePlay[]
}

export type BlowCowBSRevealPlay = {
  playID: string
  playerID: string
  cards: BlowCowCard[]
}

/**
 * Withheld from clients by `hideSecretState` until the accused's reveal step is confirmed.
 *
 * A BS call asks one question only — were the hidden cards really the claimed rank. The Dreamer's
 * rule-breaking is not part of it; that is what `accuseDreamer` is for.
 */
export type BlowCowBSTargetVerdict = {
  targetWasHonest: boolean
}

/** Withheld from clients by `hideSecretState` until every reveal step is confirmed. */
export type BlowCowBSPunishment = {
  reverseRuleTriggered: boolean
  /** The Contrarian called this one, so the punishment was flipped a second time. */
  contrarianTriggered: boolean
  punishedPlayerID: string
  unpunishedPlayerID: string
}

export const BLOW_COW_DREAMER_CHEAT_KINDS = [
  'directionChange',
  'sneakPlay',
  'takeBackCard',
  'extraCardCount',
  'exceededTableLimit',
  'repeatTrump',
] as const

export type BlowCowDreamerCheatKind = (typeof BLOW_COW_DREAMER_CHEAT_KINDS)[number]

/**
 * A Dreamer direction change waiting to be caught. Secret state: `hideSecretState` strips it, so no
 * client can tell whether the flip everyone just watched was The Cat acting legally on their
 * own turn or The Dreamer reaching into someone else's.
 */
export type BlowCowDirectionTamper = {
  playerID: string
  /** The accusation window. A tamper is only catchable while `ctx.turn` still matches. */
  turnNumber: number
}

/**
 * A card taken back off the table waiting to be caught, and the only cheat that needs a record to be
 * catchable at all. The others leave their evidence on the table — cards that appeared, a direction
 * that moved, a count that does not match — while this one leaves a gap, and a gap is exactly what an
 * honest table looks like a moment before somebody plays into it.
 *
 * The one piece of secret state `hideSecretState` hands back to a single player rather than to
 * nobody. `directionTamper` is stripped from everyone because any client holding it could check the
 * answer before gambling an accusation; this is stripped from everyone *except its owner*, who is the
 * one person at the table who cannot use it that way — they already know what they did, and they may
 * not accuse themselves. What they need it for is the lock: the cheat is only worth anything if the
 * table gets a moment to notice the gap, so the client that made it grounds its own action buttons
 * for two seconds rather than letting the same hand take a card back and end the turn on top of it.
 *
 * `id` changes on every take-back, so an unlimited run of them re-arms that lock each time instead of
 * the client seeing one record it has already served.
 */
export type BlowCowTakeBackTamper = {
  id: string
  playerID: string
  /** The accusation window, and the lock's own scope. Both die when the turn does. */
  turnNumber: number
}

/**
 * The last flip of the direction sign, published so every client can nudge the block of whoever made
 * it. The deliberate opposite of `directionTamper`, and the reason both exist: this says who touched
 * the sign, never whether they were entitled to. Working that out from their character and whose
 * turn it was is the whole tell, and the answer itself still never leaves the server.
 *
 * Every flip is published, the legal ones included. Nudging only the cheats would announce the
 * verdict along with the culprit, and nudging only the illegitimate flippers would say the same
 * thing in reverse — an unnudged flip could then only be The Cat's.
 *
 * `id` changes on every flip, so a client can tell a fresh one from the one it has already played.
 */
export type BlowCowDirectionFlip = {
  id: string
  playerID: string
}

/** A public, non-gameplay signal that the board briefly animates above its owner's avatar. */
export type BlowCowEmote = {
  id: string
  playerID: string
  emoteID: number
}

/**
 * A live accusation. It freezes every other move until the accuser resolves it, so unlike a BS call
 * it can be raised out of turn without letting two procedures overlap. The outcome is public from
 * the moment it is raised — there is nothing to reveal, so nothing to withhold.
 *
 * Either way round it ends in a punishment: a caught Dreamer takes the table, and so does an accuser
 * who was wrong. Only `punishedPlayerID` differs between the two.
 */
export type BlowCowAccusation = {
  id: string
  accuserPlayerID: string
  targetPlayerID: string
  wasSuccessful: boolean
  /** The rule that was broken, or null when the accusation missed. */
  caughtCheat: BlowCowDreamerCheatKind | null
  punishmentCardCount: number
  /** The accused on a hit, the accuser on a miss. */
  punishedPlayerID: string
  /** Starts the next round, mirroring how a BS resolution hands the round on. */
  unpunishedPlayerID: string
  /** Set by `beginAccusationPunishment`; drives the punishment travel animation on every client. */
  isPunishing: boolean
}

/**
 * A live conspiracy: The Mastermind has opened another player's hand and now owes the table a play
 * out of it. Turn-bound and committing — while it stands, the only move its owner may make is a
 * play, and those cards come out of `targetPlayerID`'s hand rather than their own.
 *
 * Public state, unlike the hand it opens. Everyone is told who is conspiring against whom the moment
 * it lands, because the victim's hand count is about to drop for reasons only this explains. What
 * stays private is the card faces: `hideSecretState` unmasks the target's hand for the conspirator
 * alone, and for nobody else, including the target's other opponents.
 */
export type BlowCowConspiracy = {
  /** The Mastermind. Always the player on the clock, since Conspire is turn-bound. */
  playerID: string
  targetPlayerID: string
  /** The turn it was opened on. A conspiracy never outlives its turn. */
  turnNumber: number
}

/**
 * A live encore: The Clown has made the round's first play and the turn did not end with it. While it
 * stands the turn is still theirs, and every action but another play is open.
 *
 * `bsTargetPlayerID` is why this is a record rather than a flag. A BS call always targets the latest
 * non-passing player, and the play that earned the encore has just made that The Clown themselves —
 * so without remembering who it was beforehand, playing would silently close the very action the
 * encore exists to hand back. It is public in every sense: it is whoever the table could already see
 * was challengeable a moment ago.
 *
 * Turn-bound like a conspiracy, and cleared the same way. Nothing about it survives the turn.
 */
export type BlowCowEncore = {
  /** The Clown. Always the player on the clock, since only their own play can earn this. */
  playerID: string
  /** The turn the play landed on. An encore never outlives it. */
  turnNumber: number
  /** Who Call BS pointed at before the play, or null if it pointed at nobody. */
  bsTargetPlayerID: string | null
}

/**
 * A live disguise: The Mime is wearing their next player's block, and the two may or may not have
 * traded chairs behind it. Everything here is a frozen copy taken the moment Mimic landed, because
 * the whole point is that the two blocks read the same afterwards — see `resolveMimic` for why a
 * snapshot rather than a live mirror is what makes the coin flip unreadable.
 *
 * This is a *display* illusion and nothing more. The engine never consults it: hands, points, plays
 * and turn order all continue to belong to whoever really owns them, and a client that reads its own
 * state rather than its own screen can still see which seat is disguised. What it hides is what a
 * player at the table can see, which is the only place the bluff has to hold.
 */
export type BlowCowMimicry = {
  /** The Mime. */
  playerID: string
  /** Whose block is being worn: The Mime's next player at the moment Mimic landed. */
  sourcePlayerID: string
  /** When the copy was taken. Nothing is scoped to it — the disguise outlives the turn — but it is
   * what tells one Mimic apart from the next for anything keying off the record. */
  turnNumber: number
  character: BlowCowCharacterName | null
  points: number
  /** The scored ranks behind `points`, for the pill's tooltip. */
  pointRanks: BlowCowRank[]
  /**
   * The copied hand count. What the board shows is this minus whatever The Mime has played since,
   * which is the same subtraction the source's own block performs on itself — see `resolveMimic`.
   */
  handCount: number
  wasSeekerPick: boolean
  /**
   * The source's statuses as they stood. Copied rather than read live, and copied at all, because a
   * disguise that showed The Mime's own status column would be two identical blocks differing in the
   * one place the illusion is supposed to be airtight. Optional for the usual restore reason.
   */
  statuses?: BlowCowPlayerStatus[]
  /** The source's plays as they stood, worn in place of The Mime's own. */
  borrowedPlayIDs: string[]
  /** The Mime's own plays as they stood, hidden underneath the borrowed ones. */
  hiddenPlayIDs: string[]
  /**
   * The borrowed cards still face down when the copy was taken. Only these are held back — a card
   * already face up is public, and hiding it again would be taking something off the table.
   */
  borrowedFaceDownCardIDs: string[]
  /**
   * Which of the two chairs has turned its share of the borrowed pile face up. The Reveal Rule is
   * per chair rather than per card here: each of the two turns the pile over when the turn reaches
   * it, so the pile behaves the same way in both branches of the coin flip instead of flipping on
   * both blocks at once and announcing which chair the source really sits in.
   *
   * The consequence, and it is intended: in the branch where the seats swapped, the source's own
   * genuinely-revealed cards stay drawn face down on their own block until the turn comes back to
   * them. They are already public on the other block by then, so nothing is withheld for longer than
   * a lap, and the other branch has the same gap in the mirror position.
   */
  revealedPlayerIDs: string[]
  /**
   * The turn a swap hands over, which must not count as the turn arriving at that chair — from
   * outside the ring the turn never moved. Consumed by the first `handleTurnStart` that sees it.
   *
   * Stripped by `hideSecretState`, because a value here is the coin flip written down. It is
   * consumed inside the same update that sets it, so no client should ever see one; the strip is
   * there so that staying true does not depend on that.
   */
  pendingHandoverPlayerID?: string | null
}

/**
 * A live BS challenge. The caller drives the reveal by hand: one step per player holding face-down
 * table cards, each card flipped with `revealBSCard`, each step confirmed with `advanceBSReveal`.
 * The resolution deliberately carries no card faces — clients read them from `G.table.plays`, which
 * `hideSecretState` masks until the caller has actually flipped them.
 */
export type BlowCowBSResolution = BlowCowRevealWalk & {
  id: string
  callerPlayerID: string
  targetPlayerID: string
  targetPlayID: string
  targetDeclaredCardCount: number
  trumpRank: BlowCowRank
  punishmentCardCount: number
  /** Set by `beginBSPunishment`; drives the punishment travel animation on every client. */
  isPunishing: boolean
  targetVerdict: BlowCowBSTargetVerdict | null
  punishment: BlowCowBSPunishment | null
}

export type BlowCowTableReturnResolutionKind = 'reset' | 'roundReturn'

/**
 * The caller-driven walk shared by both table-reveal procedures. One step per player holding
 * face-down cards, in `revealOrder`; `revealStepIndex` is how many steps the caller has confirmed.
 */
export type BlowCowRevealWalk = {
  revealOrder: string[]
  revealStepIndex: number
}

/** One seat's reading in a Gambler showdown. Card faces stay on the table; only the verdict is here. */
export type BlowCowResetShowdownStanding = {
  playerID: string
  /** Player-facing, and the only description of the hand that reaches a client. */
  handLabel: string
  cardCount: number
}

/**
 * The Gambler's Reset showdown. Withheld by `hideSecretState` until the reveal is complete, exactly
 * like a BS punishment and for the same reason: until the caller has turned the table over, the
 * hands this ranks are still face down, and the standings would name the loser before anyone could
 * see why.
 */
export type BlowCowResetShowdown = {
  /** Every active player, strongest hand first. Seats with nothing in front are listed too, at the bottom. */
  standings: BlowCowResetShowdownStanding[]
  /**
   * Everyone tied for weakest. Usually one seat; more than one is a genuine tie, and the caller
   * picks between them by pressing one of the Punish buttons.
   */
  weakestPlayerIDs: string[]
  punishmentCardCount: number
  /** Set by `beginResetPunishment` along with the choice; drives the punishment travel on every client. */
  isPunishing: boolean
  /** Null until the caller commits to one of `weakestPlayerIDs`. */
  punishedPlayerID: string | null
}

export type BlowCowResetResolution = BlowCowRevealWalk & {
  id: string
  callerPlayerID: string
  kind: BlowCowTableReturnResolutionKind
  /**
   * Non-null only for a `reset` while a Gambler is seated. Optional in the type as well as in
   * practice, because a match staged before The Gambler existed restores without the field.
   */
  showdown?: BlowCowResetShowdown | null
}

export type BlowCowHistoryEvent = {
  id: string
  kind: BlowCowHistoryEventKind
  playerID: string | null
  title: string
  detail: string
  /**
   * A closing line the log renders in its own alarmed style, under the detail. Optional in the type
   * as well as in practice, because a match staged before it existed restores without the field.
   */
  omen?: string
  roundNumber: number
  turnNumber: number
}

export type BlowCowTelemetryEvent = {
  id: string
  kind: BlowCowTelemetryEventKind
  playerID: string | null
  title: string
  detail: string
  roundNumber: number
  turnNumber: number
  handCountsByPlayer: Record<string, number>
}

export type BlowCowTelemetryState = {
  events: BlowCowTelemetryEvent[]
}

export type BlowCowArchiveInitialPlayerState = {
  playerID: string
  seatIndex: number
  character: BlowCowCharacterName | null
  hand: BlowCowCard[]
  points: number
  scoredSets: BlowCowScoredSet[]
}

export type BlowCowArchiveInitialState = {
  playerOrder: string[]
  playerCount: number
  startingPlayerID: string
  direction: BlowCowDirection
  deckConfig: BlowCowDeckConfig
  speedMultiplier: BlowCowSpeedMultiplier
  useCharacters: boolean
  characterPool: BlowCowImplementedCharacterName[]
  rules: BlowCowRulesState
  players: Record<string, BlowCowArchiveInitialPlayerState>
}

export type BlowCowArchiveTurnActionKind =
  | 'revealPendingPlay'
  | 'toggleDirection'
  | 'seekCharacter'
  | 'breakRule'
  | 'defy'
  | 'conspire'
  | 'manipulate'
  | 'mimic'
  | 'hideTableCard'
  | 'takeBackCard'
  | 'gainOutsideCard'
  | 'play'
  | 'pass'
  | 'callBS'
  | 'resolveBS'
  | 'accuse'
  | 'resolveAccusation'
  | 'callReset'
  | 'resolveReset'
  | 'roundReturn'
  | 'leave'

export type BlowCowArchiveTurnAction = {
  kind: BlowCowArchiveTurnActionKind
  playerID: string | null
  detail: string
  characterUsed: BlowCowCharacterName | null
  targetPlayerID: string | null
  revealedPlayerID: string | null
  cards: BlowCowCard[]
  cardsByPlayer: Record<string, BlowCowCard[]> | null
  declaredCardCount: number | null
  claimedRank: BlowCowRank | null
  wasHonest: boolean | null
  punishedPlayerID: string | null
  unpunishedPlayerID: string | null
  resetKind: BlowCowTableReturnResolutionKind | null
  additionalRevealPlays: BlowCowBSRevealPlay[] | null
  passStreak: number | null
  endedRound: boolean | null
  usedGrandmasterBSOverride: boolean | null
  usedPawnEnPassant: boolean | null
  pawnTriggerPlayerID: string | null
  playMode: 'manual' | 'random' | null
  directionBefore: BlowCowDirection | null
  directionAfter: BlowCowDirection | null
  remainingHiddenCardCount: number | null
  leaveOrder: number | null
}

export type BlowCowArchiveTurn = {
  turnNumber: number
  roundNumber: number
  playerID: string
  tableCardCountAtStart: number
  handCountAtStart: number
  trumpRankAtStart: BlowCowRank | null
  directionAtStart: BlowCowDirection
  maxCardsOnTableAtStart: number
  actions: BlowCowArchiveTurnAction[]
}

export type BlowCowArchiveState = {
  initial: BlowCowArchiveInitialState | null
  turns: BlowCowArchiveTurn[]
}

export type BlowCowDeckConfig = {
  rankSelectionMode: BlowCowRankSelectionMode
  selectedRanks: BlowCowRank[]
  includesJokers: true
  defaultRankCount: number
}

export type BlowCowSetupData = {
  rankSelectionMode?: BlowCowRankSelectionMode
  selectedRanks?: BlowCowRank[]
  speedMultiplier?: BlowCowSpeedMultiplier
  useCharacters?: boolean
  characterPool?: BlowCowImplementedCharacterName[]
  rules?: Partial<BlowCowRulesState>
  /**
   * Statuses every player starts the match under, and how many turns they last. A testing lever
   * rather than a game mode: nothing else in the game hands out a status yet.
   */
  initialStatuses?: BlowCowStatusID[]
  initialStatusTurns?: number
}

export type BlowCowState = {
  tableStatus: string
  gameStatus: BlowCowGameStatus
  hostPlayerID: string
  deckConfig: BlowCowDeckConfig
  speedMultiplier: BlowCowSpeedMultiplier
  useCharacters: boolean
  characterPool: BlowCowImplementedCharacterName[]
  /*
   * Public on purpose: `hideSecretState` leaves this alone so every seat's Rules panel reads the
   * same statuses. Nothing in the engine branches on it yet — the rules are still enforced
   * unconditionally, and this only drives what the panel displays.
   */
  rules: BlowCowRulesState
  /*
   * The staged status selection, carried from the lobby through staging to `startMatchState`, which
   * is what actually deals it out. Public and optional, like every field added after the first
   * release — a match staged before statuses existed restores without them, and nobody in it is
   * afflicted.
   */
  initialStatuses?: BlowCowStatusID[]
  initialStatusTurns?: number
  seatOrder: string[]
  players: Record<string, BlowCowPlayerState>
  round: BlowCowRoundState
  table: BlowCowTableState
  bsResolution: BlowCowBSResolution | null
  resetResolution: BlowCowResetResolution | null
  accusation: BlowCowAccusation | null
  directionTamper: BlowCowDirectionTamper | null
  /*
   * Optional for the same restore reason as `conspiracy`. Nobody is mid-take-back in a match staged
   * before the cheat existed.
   */
  takeBackTamper?: BlowCowTakeBackTamper | null
  /*
   * Optional for the same restore reason as `conspiracy`: a match staged before the tell existed
   * comes back without the field, and nobody is mid-nudge in a match that never had one.
   */
  directionFlip?: BlowCowDirectionFlip | null
  /**
   * The most recent public emotes. Kept bounded because they are animation triggers, not match
   * history, and optional so a persisted match from before emotes restores normally.
   */
  emotes?: BlowCowEmote[]
  emoteSequence?: number
  /*
   * Optional in the type as well as in practice: a match staged before The Mastermind existed
   * restores from `data/matches/` without the field, and every read of it optional-chains for that
   * reason. Nobody is mid-conspiracy in a match that never had one.
   */
  conspiracy?: BlowCowConspiracy | null
  /*
   * Optional for the same restore reason as `conspiracy`. Nobody is wearing anybody else's face in a
   * match staged before The Mime existed.
   */
  mimicry?: BlowCowMimicry | null
  /*
   * Optional for the same restore reason as `conspiracy`. Nobody is owed a second action in a match
   * staged before The Clown existed.
   */
  encore?: BlowCowEncore | null
  history: BlowCowHistoryEvent[]
  telemetry: BlowCowTelemetryState
  archive: BlowCowArchiveState
  placements: string[]
}

export type BlowCowSelectTrumpAndPlayArgs = {
  trumpRank: BlowCowRank
  cardIDs: string[]
}

export type BlowCowPlayArgs = {
  cardIDs: string[]
}

export type BlowCowSneakPlayArgs = {
  cardIDs: string[]
}

export type BlowCowTakeBackCardArgs = {
  cardID: string
}

export type BlowCowPlayRandomArgs = {
  cardCount: number
  trumpRank?: BlowCowRank | null
}

export type BlowCowPassArgs = {
  foreignerCardCode?: string | null
}

export type BlowCowCallBSArgs = {
  targetPlayerID?: string | null
}

export type BlowCowCatHideCardArgs = {
  cardID: string
}

export type BlowCowSeekCharacterArgs = {
  characterName: BlowCowImplementedCharacterName
}

export type BlowCowBreakRuleArgs = {
  ruleID: BlowCowRuleID
}

export type BlowCowDefyArgs = {
  cardID: string
}

export type BlowCowConspireArgs = {
  targetPlayerID: string
}

export type BlowCowManipulateArgs = {
  targetPlayerID: string
  trumpRank: BlowCowRank
  direction: BlowCowDirection
}

export type BlowCowEmoteArgs = {
  emoteID: number
}

export type BlowCowAccuseDreamerArgs = {
  targetPlayerID: string
}

export type BlowCowBeginAccusationPunishmentArgs = {
  accusationID: string
}

export type BlowCowFinalizeAccusationArgs = {
  accusationID: string
}

export type BlowCowRevealBSCardArgs = {
  resolutionID: string
  cardID: string
}

export type BlowCowAdvanceBSRevealArgs = {
  resolutionID: string
}

export type BlowCowBeginBSPunishmentArgs = {
  resolutionID: string
}

export type BlowCowFinalizeBSResolutionArgs = {
  resolutionID: string
}

export type BlowCowRevealResetCardArgs = {
  resolutionID: string
  cardID: string
}

export type BlowCowAdvanceResetRevealArgs = {
  resolutionID: string
}

export type BlowCowFinalizeResetResolutionArgs = {
  resolutionID: string
}

/**
 * The caller's choice of who takes the table in a Gambler showdown. It carries a player because a
 * tie leaves more than one weakest hand, and breaking that tie is the caller's to make.
 */
export type BlowCowBeginResetPunishmentArgs = {
  resolutionID: string
  punishedPlayerID: string
}

export type BlowCowGameOver = {
  placements: string[]
  winnerID: string
  pointsByPlayer: Record<string, number>
}

type BlowCowShuffle = <Value>(values: Value[]) => Value[]

type BlowCowSetupContext = {
  ctx: {
    numPlayers: number
  }
  random?: {
    Shuffle?: BlowCowShuffle
  }
}

type BlowCowRuntimeCtx = {
  currentPlayer: string
  turn: number
}

type BlowCowEventsAPI = {
  endTurn: (arg?: { next: string }) => void
  endGame: (gameover?: BlowCowGameOver) => void
}

type BlowCowHookContext = {
  G: BlowCowState
  ctx: BlowCowRuntimeCtx
  events: BlowCowEventsAPI
  random?: {
    Shuffle?: BlowCowShuffle
  }
}

type BlowCowMoveContext = BlowCowHookContext & {
  playerID: string
}

type BlowCowScoreHandResult = {
  remainingHand: BlowCowCard[]
  scoredSets: BlowCowScoredSet[]
  pointsAwarded: number
}

const SUIT_SORT_INDEX: Record<BlowCowCardSuit, number> = {
  clubs: 0,
  diamonds: 1,
  hearts: 2,
  spades: 3,
  joker: 4,
}

const RANK_SORT_INDEX: Record<BlowCowCardRank, number> = {
  A: 0,
  '2': 1,
  '3': 2,
  '4': 3,
  '5': 4,
  '6': 5,
  '7': 6,
  '8': 7,
  '9': 8,
  '10': 9,
  J: 10,
  Q: 11,
  K: 12,
  Joker: 13,
}

const RANK_TO_SPRITE_SEGMENT: Record<BlowCowRank, string> = {
  A: 'ace',
  '2': '02',
  '3': '03',
  '4': '04',
  '5': '05',
  '6': '06',
  '7': '07',
  '8': '08',
  '9': '09',
  '10': '10',
  J: 'jack',
  Q: 'queen',
  K: 'king',
}

function getCardSpriteFilename(suit: BlowCowSuit, rank: BlowCowRank) {
  return `${suit}_${RANK_TO_SPRITE_SEGMENT[rank]}.png`
}

function isBlowCowRank(value: unknown): value is BlowCowRank {
  return typeof value === 'string' && (BLOW_COW_RANKS as readonly string[]).includes(value)
}

function isBlowCowSuit(value: unknown): value is BlowCowSuit {
  return typeof value === 'string' && (BLOW_COW_SUITS as readonly string[]).includes(value)
}

function isBlowCowDirection(value: unknown): value is BlowCowDirection {
  return BLOW_COW_DIRECTIONS.some((direction) => direction === value)
}

function isBlowCowSpeedMultiplier(value: unknown): value is BlowCowSpeedMultiplier {
  return typeof value === 'number'
    && (BLOW_COW_SPEED_MULTIPLIERS as readonly number[]).includes(value)
}

function sortRanks(ranks: BlowCowRank[]) {
  return [...ranks].sort((leftRank, rightRank) => RANK_SORT_INDEX[leftRank] - RANK_SORT_INDEX[rightRank])
}

function normalizeSelectedRanks(selectedRanks: readonly BlowCowRank[] | undefined) {
  if (!selectedRanks) {
    return [] as BlowCowRank[]
  }

  return sortRanks(
    [...new Set(selectedRanks)].filter((rank): rank is BlowCowRank => isBlowCowRank(rank)),
  )
}

function createSeatOrder(numPlayers: number) {
  return Array.from({ length: numPlayers }, (_, seatIndex) => String(seatIndex))
}

function shuffleCards<Value>(values: Value[], shuffle?: BlowCowShuffle) {
  return shuffle ? shuffle(values) : [...values]
}

function toggleDirection(direction: BlowCowDirection): BlowCowDirection {
  return direction === 'counterclockwise' ? 'clockwise' : 'counterclockwise'
}

function formatSeatLabel(seatIndex: number | null | undefined, playerID?: string) {
  if (seatIndex !== undefined && seatIndex !== null && !Number.isNaN(seatIndex)) {
    return `Seat ${seatIndex + 1}`
  }

  return playerID ? `Player ${playerID}` : 'Unknown seat'
}

function formatPlayerLabel(stateOrPlayerID: Pick<BlowCowState, 'players'> | string, playerID?: string) {
  if (typeof stateOrPlayerID === 'string') {
    const seatIndex = Number.parseInt(stateOrPlayerID, 10)
    return formatSeatLabel(Number.isNaN(seatIndex) ? null : seatIndex, stateOrPlayerID)
  }

  const resolvedPlayerID = playerID ?? ''
  return formatSeatLabel(stateOrPlayerID.players[resolvedPlayerID]?.seatIndex, resolvedPlayerID)
}

function formatCardLabel(card: BlowCowCard) {
  if (card.rank === 'Joker') {
    return 'Joker'
  }

  return `${card.rank} of ${card.suit[0].toUpperCase()}${card.suit.slice(1)}`
}

type BlowCowGeneratedCardSpec = Pick<BlowCowCard, 'rank' | 'suit' | 'sprite'>

function parseForeignerCardCode(cardCode: string | null | undefined) {
  if (!cardCode || cardCode === 'none') {
    return {
      isValid: true,
      cardSpec: null,
    } as const
  }

  if (cardCode === 'joker') {
    return {
      isValid: true,
      cardSpec: {
        rank: 'Joker',
        suit: 'joker',
        sprite: 'Joker1.png',
      } satisfies BlowCowGeneratedCardSpec,
    } as const
  }

  const [rankValue, suitValue, ...rest] = cardCode.split(':')
  if (rest.length > 0 || !isBlowCowRank(rankValue) || !isBlowCowSuit(suitValue)) {
    return {
      isValid: false,
      cardSpec: null,
    } as const
  }

  return {
    isValid: true,
    cardSpec: {
      rank: rankValue,
      suit: suitValue,
      sprite: getCardSpriteFilename(suitValue, rankValue),
    } satisfies BlowCowGeneratedCardSpec,
  } as const
}

function createForeignerOutsideCard(playerID: string, turnNumber: number, cardSpec: BlowCowGeneratedCardSpec) {
  return {
    id: `outside-${playerID}-${turnNumber}-${cardSpec.rank}-${cardSpec.suit}`,
    rank: cardSpec.rank,
    suit: cardSpec.suit,
    sprite: cardSpec.sprite,
    deckOrder: -1,
  } satisfies BlowCowCard
}

function createHiddenCard(card: BlowCowCard): BlowCowCard {
  return {
    ...card,
    rank: 'Joker',
    suit: 'joker',
    sprite: CARD_BACK_SPRITE,
  }
}

function createHistoryEvent(
  state: BlowCowState,
  kind: BlowCowHistoryEventKind,
  title: string,
  detail: string,
  playerID: string | null,
  turnNumber: number,
  omen?: string,
) {
  return {
    id: `history-${state.round.roundNumber}-${turnNumber}-${state.history.length}`,
    kind,
    playerID,
    title,
    detail,
    // Omitted rather than set to null when there is none, so the field only exists on the few
    // events that actually carry one.
    ...(omen ? { omen } : {}),
    roundNumber: state.round.roundNumber,
    turnNumber,
  } satisfies BlowCowHistoryEvent
}

function createTelemetryEvent(
  state: BlowCowState,
  kind: BlowCowTelemetryEventKind,
  title: string,
  detail: string,
  playerID: string | null,
  turnNumber: number,
) {
  return {
    id: `telemetry-${state.round.roundNumber}-${turnNumber}-${state.telemetry.events.length}`,
    kind,
    playerID,
    title,
    detail,
    roundNumber: state.round.roundNumber,
    turnNumber,
    handCountsByPlayer: Object.fromEntries(
      Object.entries(state.players).map(([targetPlayerID, player]) => [targetPlayerID, player.hand.length]),
    ),
  } satisfies BlowCowTelemetryEvent
}

function appendTelemetryEvent(
  state: BlowCowState,
  kind: BlowCowTelemetryEventKind,
  title: string,
  detail: string,
  playerID: string | null,
  turnNumber: number,
) {
  state.telemetry.events.push(createTelemetryEvent(state, kind, title, detail, playerID, turnNumber))
}

function appendHistoryEvent(
  state: BlowCowState,
  kind: BlowCowHistoryEventKind,
  title: string,
  detail: string,
  playerID: string | null,
  turnNumber: number,
  omen?: string,
) {
  state.history.push(createHistoryEvent(state, kind, title, detail, playerID, turnNumber, omen))
  // Telemetry carries no omen: it is flavour written for the log's readers, not a fact about the
  // match, and the analysis lines are the one place that distinction matters.
  appendTelemetryEvent(state, kind, title, detail, playerID, turnNumber)
}

function appendPointHistoryEvents(
  state: BlowCowState,
  playerID: string,
  scoredSets: BlowCowScoredSet[],
  turnNumber: number,
) {
  for (const scoredSet of scoredSets) {
    appendHistoryEvent(
      state,
      'point',
      `${formatPlayerLabel(state, playerID)} gained 1 point`,
      `Removed four ${scoredSet.rank}s from hand.`,
      playerID,
      turnNumber,
    )
  }
}

function getPlayerState(state: BlowCowState, playerID: string) {
  return state.players[playerID]
}

function cloneCard(card: BlowCowCard): BlowCowCard {
  return { ...card }
}

function cloneCards(cards: BlowCowCard[]) {
  return cards.map((card) => cloneCard(card))
}

function cloneScoredSet(scoredSet: BlowCowScoredSet): BlowCowScoredSet {
  return {
    ...scoredSet,
    cards: cloneCards(scoredSet.cards),
  }
}

function cloneScoredSets(scoredSets: BlowCowScoredSet[]) {
  return scoredSets.map((scoredSet) => cloneScoredSet(scoredSet))
}

function cloneBSRevealPlays(revealPlays: BlowCowBSRevealPlay[]) {
  return revealPlays.map((revealPlay) => ({
    ...revealPlay,
    cards: cloneCards(revealPlay.cards),
  }))
}

function cloneCardsByPlayer(cardsByPlayer: Record<string, BlowCowCard[]>) {
  return Object.fromEntries(
    Object.entries(cardsByPlayer).map(([playerID, cards]) => [playerID, cloneCards(cards)]),
  ) as Record<string, BlowCowCard[]>
}

function createCardsByPlayerRecord(entries: Iterable<[string, BlowCowCard[]]>) {
  return Object.fromEntries(
    Array.from(entries, ([playerID, cards]) => [playerID, cloneCards(cards)]),
  ) as Record<string, BlowCowCard[]>
}

function createEmptyArchiveState(): BlowCowArchiveState {
  return {
    initial: null,
    turns: [],
  }
}

function createInitialArchiveState(state: BlowCowState): BlowCowArchiveInitialState {
  return {
    playerOrder: [...state.seatOrder],
    playerCount: state.seatOrder.length,
    startingPlayerID: state.round.startingPlayerID,
    direction: state.round.direction,
    deckConfig: {
      ...state.deckConfig,
      selectedRanks: [...state.deckConfig.selectedRanks],
    },
    speedMultiplier: state.speedMultiplier,
    useCharacters: state.useCharacters,
    characterPool: [...state.characterPool],
    rules: { ...state.rules },
    players: Object.fromEntries(
      Object.entries(state.players).map(([playerID, player]) => [
        playerID,
        {
          playerID,
          seatIndex: player.seatIndex,
          character: player.character,
          hand: cloneCards(player.hand),
          points: player.points,
          scoredSets: cloneScoredSets(player.scoredSets),
        },
      ]),
    ) as Record<string, BlowCowArchiveInitialPlayerState>,
  }
}

function findArchiveTurn(state: BlowCowState, playerID: string, turnNumber: number) {
  for (let turnIndex = state.archive.turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const archivedTurn = state.archive.turns[turnIndex]
    if (archivedTurn.turnNumber === turnNumber && archivedTurn.playerID === playerID) {
      return archivedTurn
    }
  }

  return null
}

function ensureArchiveTurn(state: BlowCowState, playerID: string, turnNumber: number) {
  const existingTurn = findArchiveTurn(state, playerID, turnNumber)
  if (existingTurn) {
    return existingTurn
  }

  const archivedTurn = {
    turnNumber,
    roundNumber: state.round.roundNumber,
    playerID,
    tableCardCountAtStart: getTableCardCount(state.table),
    handCountAtStart: state.players[playerID]?.hand.length ?? 0,
    trumpRankAtStart: state.round.trumpRank,
    directionAtStart: state.round.direction,
    maxCardsOnTableAtStart: state.round.maxCardsOnTable,
    actions: [],
  } satisfies BlowCowArchiveTurn

  state.archive.turns.push(archivedTurn)
  return archivedTurn
}

type BlowCowArchiveTurnActionInput = Pick<BlowCowArchiveTurnAction, 'kind' | 'detail'>
  & Partial<Omit<BlowCowArchiveTurnAction, 'kind' | 'detail' | 'playerID'>>

function appendArchiveTurnAction(
  state: BlowCowState,
  playerID: string,
  turnNumber: number,
  action: BlowCowArchiveTurnActionInput,
) {
  const archivedTurn = ensureArchiveTurn(state, playerID, turnNumber)

  archivedTurn.actions.push({
    kind: action.kind,
    playerID,
    detail: action.detail,
    characterUsed: action.characterUsed ?? null,
    targetPlayerID: action.targetPlayerID ?? null,
    revealedPlayerID: action.revealedPlayerID ?? null,
    cards: action.cards ? cloneCards(action.cards) : [],
    cardsByPlayer: action.cardsByPlayer ? cloneCardsByPlayer(action.cardsByPlayer) : null,
    declaredCardCount: action.declaredCardCount ?? null,
    claimedRank: action.claimedRank ?? null,
    wasHonest: action.wasHonest ?? null,
    punishedPlayerID: action.punishedPlayerID ?? null,
    unpunishedPlayerID: action.unpunishedPlayerID ?? null,
    resetKind: action.resetKind ?? null,
    additionalRevealPlays: action.additionalRevealPlays ? cloneBSRevealPlays(action.additionalRevealPlays) : null,
    passStreak: action.passStreak ?? null,
    endedRound: action.endedRound ?? null,
    usedGrandmasterBSOverride: action.usedGrandmasterBSOverride ?? null,
    usedPawnEnPassant: action.usedPawnEnPassant ?? null,
    pawnTriggerPlayerID: action.pawnTriggerPlayerID ?? null,
    playMode: action.playMode ?? null,
    directionBefore: action.directionBefore ?? null,
    directionAfter: action.directionAfter ?? null,
    remainingHiddenCardCount: action.remainingHiddenCardCount ?? null,
    leaveOrder: action.leaveOrder ?? null,
  })
}

function createInitialPlayerMatchStats(): BlowCowPlayerMatchStats {
  return {
    playCount: 0,
    callBSCount: 0,
    passCount: 0,
    resetCount: 0,
    turnsInGame: 0,
    lieCount: 0,
    cardsPlayed: 0,
    punishmentCount: 0,
    bsWinCount: 0,
    accusationCount: 0,
    accusationWinCount: 0,
  }
}

function createEmptyPlayerState(playerID: string, seatIndex: number): BlowCowPlayerState {
  return {
    id: playerID,
    seatIndex,
    character: null,
    hand: [],
    points: 0,
    scoredSets: [],
    matchStats: createInitialPlayerMatchStats(),
    pendingRevealPlayID: null,
    turnStartingDirection: null,
    hasUsedManualPlay: false,
    hasUsedGrandmasterBSOverride: false,
    hasUsedAccusationThisRound: false,
    hasUsedDefyThisRound: false,
    hasUsedConspireThisRound: false,
    hasUsedMimicThisRound: false,
    hasUsedClownEncoreThisRound: false,
    wasPunishedThisRound: false,
    wasPunishedLastRound: false,
    hasLeft: false,
    leaveOrder: null,
    leaveEffect: null,
    seekerPickedCharacter: null,
    brokenRemovedRuleID: null,
    statuses: [],
  }
}

function getRevealedCardIDSet(play: BlowCowTablePlay) {
  return new Set(play.revealedCardIDs ?? [])
}

function getRehiddenCardIDSet(play: BlowCowTablePlay) {
  return new Set(play.rehiddenCardIDs ?? [])
}

export function isCardFaceUpOnTable(play: BlowCowTablePlay, cardID: string) {
  return (play.revealedAtTurn !== null || getRevealedCardIDSet(play).has(cardID))
    && !getRehiddenCardIDSet(play).has(cardID)
}

/**
 * Every card the table is actually showing face down, including Cat-rehidden ones. This is what the
 * BS reveal procedure walks. It deliberately differs from `getHiddenCardsForPlay`, which ignores
 * `rehiddenCardIDs` so that The Cat cannot manufacture new BS targets — see that helper.
 */
function getFaceDownCardsForPlay(play: BlowCowTablePlay) {
  return play.cards.filter((card) => !isCardFaceUpOnTable(play, card.id))
}

function getFaceDownTableCardsForPlayer(state: BlowCowState, playerID: string) {
  return state.table.plays
    .filter((play) => play.playerID === playerID)
    .flatMap((play) => getFaceDownCardsForPlay(play))
}

/**
 * Everything sitting in front of one player, face up or not. This is the "cards in front" a Gambler
 * showdown reads as a poker hand, so it spans every play that player made this round rather than
 * just their latest one.
 */
function getTableCardsForPlayer(state: BlowCowState, playerID: string) {
  return state.table.plays
    .filter((play) => play.playerID === playerID)
    .flatMap((play) => play.cards)
}

/**
 * Cards that still count as an unresolved play for BS targeting. Cat-rehidden cards are excluded on
 * purpose: re-hiding an already-revealed card must not make its owner challengeable again. Use
 * `getFaceDownCardsForPlay` when the question is "what is the table showing".
 */
function getHiddenCardsForPlay(play: BlowCowTablePlay) {
  if (play.revealedAtTurn !== null) {
    return [] as BlowCowCard[]
  }

  const revealedCardIDSet = getRevealedCardIDSet(play)
  return play.cards.filter((card) => !revealedCardIDSet.has(card.id))
}

function playHasHiddenCards(play: BlowCowTablePlay) {
  return getHiddenCardsForPlay(play).length > 0
}

function getPendingRevealPlay(state: BlowCowState, playerID: string) {
  const pendingRevealPlayID = state.players[playerID]?.pendingRevealPlayID
  if (!pendingRevealPlayID) {
    return null
  }

  return state.table.plays.find((play) => play.id === pendingRevealPlayID) ?? null
}

function getPendingPlay(state: BlowCowState, playerID: string) {
  const pendingRevealPlay = getPendingRevealPlay(state, playerID)
  if (pendingRevealPlay && playHasHiddenCards(pendingRevealPlay)) {
    return pendingRevealPlay
  }

  for (let playIndex = state.table.plays.length - 1; playIndex >= 0; playIndex -= 1) {
    const play = state.table.plays[playIndex]
    if (play.playerID === playerID && playHasHiddenCards(play)) {
      return play
    }
  }

  return null
}

function clearPendingRevealIDs(state: BlowCowState) {
  for (const player of Object.values(state.players)) {
    player.pendingRevealPlayID = null
  }
}

function getAllTableCards(state: BlowCowState) {
  return state.table.plays.flatMap((play) => play.cards)
}

function collectTableCardsByOwner(state: BlowCowState) {
  const cardsByOwner = new Map<string, BlowCowCard[]>()

  for (const play of state.table.plays) {
    const existingCards = cardsByOwner.get(play.playerID) ?? []
    existingCards.push(...play.cards)
    cardsByOwner.set(play.playerID, existingCards)
  }

  return cardsByOwner
}

export function getMaxCardsOnTable(playerCount: number) {
  if (playerCount <= 2) {
    return 10
  }

  if (playerCount <= 4) {
    return 12
  }

  if (playerCount === 5) {
    return 15
  }

  if (playerCount === 6) {
    return 12
  }

  if (playerCount === 7) {
    return 14
  }

  return 16
}

export function getDefaultStandardRankCount(playerCount: number) {
  if (playerCount <= 2) {
    return 4
  }

  if (playerCount === 3) {
    return 6
  }

  if (playerCount === 4) {
    return 9
  }

  if (playerCount === 5) {
    return 11
  }

  return BLOW_COW_RANKS.length
}

function getDefaultSelectedRanks(
  numPlayers: number,
  shuffle?: BlowCowShuffle,
  requiredRanks: readonly BlowCowRank[] = [],
) {
  const defaultRankCount = getDefaultStandardRankCount(numPlayers)

  if (defaultRankCount >= BLOW_COW_RANKS.length) {
    return [...BLOW_COW_RANKS]
  }

  const requiredRankSet = new Set(requiredRanks)
  const lockedRanks = BLOW_COW_RANKS.filter((rank) => requiredRankSet.has(rank))
  const availableRanks = BLOW_COW_RANKS.filter((rank) => !requiredRankSet.has(rank))
  const shuffledRanks = shuffle ? shuffle([...availableRanks]) : [...availableRanks]

  return sortRanks([
    ...lockedRanks,
    ...shuffledRanks.slice(0, Math.max(0, defaultRankCount - lockedRanks.length)),
  ])
}

function normalizeCharacterPoolSelection(characterPool: BlowCowSetupData['characterPool']) {
  if (!Array.isArray(characterPool)) {
    return []
  }

  const requestedCharacterNames = new Set(characterPool.filter(isImplementedCharacterName))

  return BLOW_COW_IMPLEMENTED_CHARACTER_NAMES.filter((characterName) => requestedCharacterNames.has(characterName))
}

function resolveDeckConfig(
  numPlayers: number,
  setupData: BlowCowSetupData | undefined,
  shuffle?: BlowCowShuffle,
): BlowCowDeckConfig {
  const defaultRankCount = getDefaultStandardRankCount(numPlayers)
  const selectedCharacterPool = normalizeCharacterPoolSelection(setupData?.characterPool)

  if (setupData?.rankSelectionMode === 'manual') {
    const selectedRanks = normalizeSelectedRanks(setupData.selectedRanks)

    if (selectedRanks.length >= 2) {
      return {
        rankSelectionMode: 'manual',
        selectedRanks,
        includesJokers: true,
        defaultRankCount,
      }
    }
  }

  return {
    rankSelectionMode: 'default',
    selectedRanks: getDefaultSelectedRanks(
      numPlayers,
      shuffle,
      selectedCharacterPool.includes('The Confused') ? ['J'] : [],
    ),
    includesJokers: true,
    defaultRankCount,
  }
}

function resolveSpeedMultiplier(setupData: BlowCowSetupData | undefined) {
  return isBlowCowSpeedMultiplier(setupData?.speedMultiplier)
    ? setupData.speedMultiplier
    : DEFAULT_BLOW_COW_SPEED_MULTIPLIER
}

function resolveUseCharacters(setupData: BlowCowSetupData | undefined) {
  return setupData?.useCharacters ?? true
}

function resolveCharacterPool(setupData: BlowCowSetupData | undefined) {
  const selectedCharacterPool = normalizeCharacterPoolSelection(setupData?.characterPool)

  return selectedCharacterPool.length > 0
    ? selectedCharacterPool
    : [...BLOW_COW_IMPLEMENTED_CHARACTER_NAMES]
}

function resolveRules(setupData: BlowCowSetupData | undefined) {
  return normalizeRulesSelection(setupData?.rules)
}

function resolveInitialStatuses(setupData: BlowCowSetupData | undefined) {
  return normalizeStatusSelection(setupData?.initialStatuses)
}

function resolveInitialStatusTurns(setupData: BlowCowSetupData | undefined) {
  return normalizeStatusTurns(setupData?.initialStatusTurns)
}

function formatInitialStatusesSummary(statusIDs: readonly BlowCowStatusID[], turns: number) {
  return statusIDs.length === 0
    ? 'started everyone with no statuses'
    : `started everyone with ${formatStatusTitles(statusIDs)} for ${turns} turn(s)`
}

function formatRulesSummary(rules: BlowCowRulesState) {
  if (isDefaultRulesSelection(rules)) {
    return 'left every rule card active'
  }

  const changedRules = BLOW_COW_RULE_IDS
    .filter((ruleID) => rules[ruleID] !== 'active')
    .map((ruleID) => `${getRuleDefinition(ruleID).title} ${rules[ruleID]}`)

  return `marked ${changedRules.join(', ')} (rule cards are not enforced yet)`
}

export function validateBlowCowSetupData(setupData: BlowCowSetupData | undefined) {
  if (setupData?.rules !== undefined) {
    if (typeof setupData.rules !== 'object' || setupData.rules === null || Array.isArray(setupData.rules)) {
      return 'Choose a valid rule selection.'
    }

    for (const [ruleID, status] of Object.entries(setupData.rules)) {
      if (!isBlowCowRuleID(ruleID)) {
        return 'Rule selection contains an unknown rule.'
      }

      if (!isBlowCowRuleStatus(status)) {
        return 'Rule selection contains an unknown rule status.'
      }

      if (!canRuleTakeStatus(ruleID, status)) {
        return `${ruleID} does not support the ${status} status.`
      }
    }
  }

  if (setupData?.initialStatuses !== undefined) {
    if (!Array.isArray(setupData.initialStatuses)) {
      return 'Choose a valid starting status selection.'
    }

    if (setupData.initialStatuses.some((statusID) => !isBlowCowStatusID(statusID))) {
      return 'Starting status selection contains an unknown status.'
    }

    if (new Set(setupData.initialStatuses).size !== setupData.initialStatuses.length) {
      return 'Starting status selection cannot contain duplicate statuses.'
    }

    if (setupData.initialStatuses.length > BLOW_COW_MAX_STATUSES_PER_PLAYER) {
      return `A player can hold at most ${BLOW_COW_MAX_STATUSES_PER_PLAYER} statuses at a time.`
    }
  }

  if (setupData?.initialStatusTurns !== undefined) {
    if (
      !Number.isInteger(setupData.initialStatusTurns)
      || setupData.initialStatusTurns < 1
      || setupData.initialStatusTurns > MAX_BLOW_COW_STATUS_TURNS
    ) {
      return `Starting statuses must last between 1 and ${MAX_BLOW_COW_STATUS_TURNS} turns.`
    }
  }

  if (setupData?.speedMultiplier !== undefined && !isBlowCowSpeedMultiplier(setupData.speedMultiplier)) {
    return 'Choose a valid game speed multiplier.'
  }

  if (setupData?.useCharacters !== undefined && typeof setupData.useCharacters !== 'boolean') {
    return 'Choose whether character cards are enabled.'
  }

  const useCharacters = resolveUseCharacters(setupData)
  if (useCharacters && setupData?.characterPool !== undefined) {
    if (!Array.isArray(setupData.characterPool)) {
      return 'Choose a valid character pool.'
    }

    if (setupData.characterPool.some((characterName) => !isImplementedCharacterName(characterName))) {
      return 'Character pool contains an unknown character.'
    }

    if (new Set(setupData.characterPool).size !== setupData.characterPool.length) {
      return 'Character pool cannot contain duplicate characters.'
    }

    if (setupData.characterPool.length < 1) {
      return 'Select at least 1 character for the character pool.'
    }
  }

  const rankSelectionMode = setupData?.rankSelectionMode ?? 'default'
  if (rankSelectionMode !== 'default' && rankSelectionMode !== 'manual') {
    return 'Choose a valid rank selection mode.'
  }

  if (rankSelectionMode !== 'manual') {
    return undefined
  }

  if (!Array.isArray(setupData?.selectedRanks)) {
    return 'Select at least 2 ranks for a manual deck.'
  }

  if (setupData.selectedRanks.some((rank) => !isBlowCowRank(rank))) {
    return 'Manual rank selection contains an unknown rank.'
  }

  if (new Set(setupData.selectedRanks).size !== setupData.selectedRanks.length) {
    return 'Manual rank selection cannot contain duplicate ranks.'
  }

  if (setupData.selectedRanks.length < 2) {
    return 'Select at least 2 ranks for a manual deck.'
  }

  if (useCharacters && setupData.characterPool?.includes('The Confused') && !setupData.selectedRanks.includes('J')) {
    return 'The Confused requires J to be included in a manual deck.'
  }

  return undefined
}

export function isJokerCard(card: BlowCowCard) {
  return card.rank === 'Joker'
}

function isConfusedWildJack(playerCharacter: BlowCowCharacterName | null | undefined, card: BlowCowCard) {
  return playerCharacter === 'The Confused' && card.rank === 'J'
}

export function isTrumpCard(
  card: BlowCowCard,
  trumpRank: BlowCowRank | null,
  playerCharacter: BlowCowCharacterName | null | undefined = null,
  jokersAreWild = true,
) {
  if (!trumpRank) {
    return false
  }

  /*
   * A Joker's rank never matches a real trump, so a removed Joker Rule leaves it worthless. The
   * Confused's Jacks go with it: the ability says they function as Jokers, and a Joker that is
   * nothing is nothing to function as.
   */
  if (isJokerCard(card) || isConfusedWildJack(playerCharacter, card)) {
    return jokersAreWild
  }

  return card.rank === trumpRank
}

/**
 * `isTrumpCard` with the match's Joker Rule status already applied. Prefer this inside the engine.
 *
 * Exported for the board's Mad and Nervous mirror, which has to ask the same question of a selection
 * before it is played. The board's answer stops at the cards; the server adds the cheat modifiers.
 */
export function isTrumpCardInMatch(
  state: BlowCowState,
  card: BlowCowCard,
  trumpRank: BlowCowRank | null,
  playerCharacter: BlowCowCharacterName | null | undefined = null,
) {
  return isTrumpCard(card, trumpRank, playerCharacter, !isRuleRemoved(state, 'joker'))
}

export function countsTowardReverseRule(
  card: BlowCowCard,
  trumpRank: BlowCowRank | null,
  playerCharacter: BlowCowCharacterName | null | undefined = null,
) {
  return trumpRank !== null && card.rank === trumpRank && !isConfusedWildJack(playerCharacter, card)
}

export function sortCards(cards: BlowCowCard[]) {
  return [...cards].sort((leftCard, rightCard) => {
    return RANK_SORT_INDEX[leftCard.rank] - RANK_SORT_INDEX[rightCard.rank]
      || SUIT_SORT_INDEX[leftCard.suit] - SUIT_SORT_INDEX[rightCard.suit]
      || leftCard.sprite.localeCompare(rightCard.sprite)
      || leftCard.id.localeCompare(rightCard.id)
  })
}

export function createDeck(selectedRanks: readonly BlowCowRank[] = BLOW_COW_RANKS) {
  const deck: BlowCowCard[] = []
  let deckOrder = 0

  for (const suit of BLOW_COW_SUITS) {
    for (const rank of selectedRanks) {
      deck.push({
        id: `card-${deckOrder}`,
        rank,
        suit,
        sprite: getCardSpriteFilename(suit, rank),
        deckOrder,
      })
      deckOrder += 1
    }
  }

  for (let jokerIndex = 1; jokerIndex <= 2; jokerIndex += 1) {
    deck.push({
      id: `card-${deckOrder}`,
      rank: 'Joker',
      suit: 'joker',
      sprite: `Joker${jokerIndex}.png`,
      deckOrder,
    })
    deckOrder += 1
  }

  return deck
}

function dealCards(deck: BlowCowCard[], seatOrder: string[]) {
  const hands = Object.fromEntries(
    seatOrder.map((playerID) => [playerID, [] as BlowCowCard[]]),
  ) as Record<string, BlowCowCard[]>

  deck.forEach((card, cardIndex) => {
    const playerID = seatOrder[cardIndex % seatOrder.length]
    hands[playerID].push(card)
  })

  return hands
}

// Scoring removes each complete four-of-a-kind immediately and can award multiple
// points for the same rank when a player receives 8 or more matching cards.
export function scoreHand(
  hand: BlowCowCard[],
  playerID: string,
  source: BlowCowCardGainSource,
  awardedAtRound: number,
  awardedAtTurn: number,
) {
  const sortedHand = sortCards(hand)
  const cardsByRank = new Map<BlowCowRank, BlowCowCard[]>()

  for (const card of sortedHand) {
    if (card.rank === 'Joker') {
      continue
    }

    const matchingCards = cardsByRank.get(card.rank) ?? []
    matchingCards.push(card)
    cardsByRank.set(card.rank, matchingCards)
  }

  const scoredCardIDs = new Set<string>()
  const scoredSets: BlowCowScoredSet[] = []

  for (const rank of BLOW_COW_RANKS) {
    const matchingCards = cardsByRank.get(rank) ?? []
    const setCount = Math.floor(matchingCards.length / 4)

    for (let setIndex = 0; setIndex < setCount; setIndex += 1) {
      const setCards = matchingCards.slice(setIndex * 4, (setIndex + 1) * 4)
      for (const card of setCards) {
        scoredCardIDs.add(card.id)
      }

      scoredSets.push({
        id: `score-${playerID}-${awardedAtRound}-${awardedAtTurn}-${rank}-${setIndex}`,
        rank,
        cards: setCards,
        awardedAtRound,
        awardedAtTurn,
        source,
      })
    }
  }

  return {
    remainingHand: sortedHand.filter((card) => !scoredCardIDs.has(card.id)),
    scoredSets,
    pointsAwarded: scoredSets.length,
  } satisfies BlowCowScoreHandResult
}

export function getActivePlayerIDs(state: Pick<BlowCowState, 'seatOrder' | 'players'>) {
  return state.seatOrder.filter((playerID) => !state.players[playerID].hasLeft)
}

function getActivePlayerCount(state: Pick<BlowCowState, 'seatOrder' | 'players'>) {
  return getActivePlayerIDs(state).length
}

/**
 * The Privileged forfeit the claim for one round after taking the table, so the seat that earned the
 * start by winning a BS call or an accusation against them actually keeps it.
 */
function getPrivilegedStartingPlayerID(state: Pick<BlowCowState, 'seatOrder' | 'players'>) {
  return getActivePlayerIDs(state).find((playerID) => {
    return state.players[playerID].character === 'The Privileged' && !state.players[playerID].wasPunishedLastRound
  }) ?? null
}

function getDefaultStartingPlayerID(
  state: Pick<BlowCowState, 'seatOrder' | 'players'>,
  fallbackPlayerID: string | null | undefined,
) {
  const activePlayerIDs = getActivePlayerIDs(state)

  if (activePlayerIDs.length === 0) {
    return null
  }

  return getPrivilegedStartingPlayerID(state)
    ?? (fallbackPlayerID && activePlayerIDs.includes(fallbackPlayerID) ? fallbackPlayerID : activePlayerIDs[0])
}

export function getNextActivePlayerID(
  currentPlayerID: string,
  seatOrder: string[],
  direction: BlowCowDirection,
  activePlayerIDs = seatOrder,
) {
  if (seatOrder.length === 0 || activePlayerIDs.length === 0) {
    return null
  }

  const currentIndex = seatOrder.indexOf(currentPlayerID)
  if (currentIndex === -1) {
    return null
  }

  const activeSet = new Set(activePlayerIDs)
  const step = direction === 'counterclockwise' ? -1 : 1

  for (let offset = 1; offset <= seatOrder.length; offset += 1) {
    const nextIndex = (currentIndex + step * offset + seatOrder.length) % seatOrder.length
    const nextPlayerID = seatOrder[nextIndex]

    if (activeSet.has(nextPlayerID)) {
      return nextPlayerID
    }
  }

  return null
}

export function getTableCardCount(table: BlowCowTableState) {
  return table.plays.reduce((totalCards, play) => totalCards + play.cards.length, 0)
}

export function getPlayerFrontCards(state: BlowCowState, playerID: string) {
  return state.table.plays
    .filter((play) => play.playerID === playerID)
    .flatMap((play) => play.cards)
}

function updateRoundCapacity(state: BlowCowState) {
  state.round.maxCardsOnTable = getMaxCardsOnTable(getActivePlayerCount(state))
}

function addCardsToPlayerHand(
  state: BlowCowState,
  playerID: string,
  cards: BlowCowCard[],
  source: BlowCowCardGainSource,
  turnNumber: number,
  options: { deferPointHistory?: boolean } = {},
) {
  if (cards.length === 0) {
    return [] as BlowCowScoredSet[]
  }

  const player = getPlayerState(state, playerID)
  const scoredHand = scoreHand(
    [...player.hand, ...cards],
    playerID,
    source,
    state.round.roundNumber,
    turnNumber,
  )

  player.hand = scoredHand.remainingHand
  player.points += scoredHand.pointsAwarded
  player.scoredSets.push(...scoredHand.scoredSets)
  if (!options.deferPointHistory) {
    appendPointHistoryEvents(state, playerID, scoredHand.scoredSets, turnNumber)
  }

  return scoredHand.scoredSets
}

function removeCardsFromPlayerHand(state: BlowCowState, playerID: string, cardIDs: string[]) {
  const uniqueCardIDs = [...new Set(cardIDs)]
  if (uniqueCardIDs.length !== cardIDs.length || uniqueCardIDs.length === 0) {
    return null
  }

  const player = getPlayerState(state, playerID)
  const handByID = new Map(player.hand.map((card) => [card.id, card]))
  const selectedCards = uniqueCardIDs.map((cardID) => handByID.get(cardID))

  if (selectedCards.some((card) => card === undefined)) {
    return null
  }

  const selectedCardIDSet = new Set(uniqueCardIDs)
  player.hand = player.hand.filter((card) => !selectedCardIDSet.has(card.id))

  return selectedCards as BlowCowCard[]
}

function createPlay(
  state: BlowCowState,
  playerID: string,
  cards: BlowCowCard[],
  declaredCardCount: number,
  claimedRank: BlowCowRank | null,
  turnNumber: number,
  wasTrumpSelection: boolean,
  options: { skipPendingReveal?: boolean } = {},
) {
  const playID = `play-${state.round.roundNumber}-${turnNumber}-${playerID}`

  state.table.plays.push({
    id: playID,
    playerID,
    cards,
    declaredCardCount,
    revealedCardIDs: [],
    rehiddenCardIDs: [],
    claimedRank,
    playedAtRound: state.round.roundNumber,
    playedAtTurn: turnNumber,
    revealedAtTurn: null,
    wasTrumpSelection,
  })

  // The Dreamer's out-of-turn play skips this. Pending reveal means "the play you owe the table at
  // the start of your next turn", and overwriting the pointer would quietly retire the real play
  // they still owe — handing them a second, unasked-for power on top of the cheat.
  if (!options.skipPendingReveal) {
    state.players[playerID].pendingRevealPlayID = playID
  }
}

function isDreamer(state: BlowCowState, playerID: string) {
  return state.players[playerID]?.character === 'The Dreamer'
}

/**
 * Who is allowed to break the rules. The Dreamer alone while the No Cheating Rule stands, and
 * everybody once it falls — the one removal that widens the game instead of narrowing it.
 *
 * Every cheat below routes through here, permission and detection alike, so the licence to cheat and
 * the window to be accused of it can never disagree about who is answerable. `isDreamer` survives
 * only where the question really is "is this player The Dreamer" — archive labelling, and nothing
 * else.
 */
function canCheat(state: BlowCowState, playerID: string) {
  return isDreamer(state, playerID) || isRuleRemoved(state, 'noCheating')
}

/**
 * Hands the round's trump rank to every play still waiting for one. Only a card sneaked onto the
 * table before the rank was chosen can be waiting, and from here on it is an ordinary face-down play
 * that BS judges like any other — the claim it inherits is the same one everybody else is under.
 *
 * The lie is counted here rather than at the sneak, because there was nothing to be a lie about yet.
 * Called wherever `round.trumpRank` goes from null to a rank, which is the trump-selecting play and
 * The Invisible Hand's Manipulate.
 */
function settleUnclaimedPlays(state: BlowCowState, trumpRank: BlowCowRank) {
  for (const play of state.table.plays) {
    if (play.claimedRank !== null) {
      continue
    }

    play.claimedRank = trumpRank
    const character = state.players[play.playerID]?.character ?? null
    const wasHonest = play.cards.every((card) => isTrumpCardInMatch(state, card, trumpRank, character))
    if (!wasHonest) {
      state.players[play.playerID].matchStats.lieCount += 1
    }
  }
}

function isDrunkard(state: BlowCowState, playerID: string) {
  return state.players[playerID]?.character === 'The Drunkard'
}

function isGrandmaster(state: BlowCowState, playerID: string) {
  return state.players[playerID]?.character === 'The Grandmaster'
}

function isCat(state: BlowCowState, playerID: string) {
  return state.players[playerID]?.character === 'The Cat'
}

function isContrarian(state: BlowCowState, playerID: string) {
  return state.players[playerID]?.character === 'The Contrarian'
}

function isPawn(state: BlowCowState, playerID: string) {
  return state.players[playerID]?.character === 'The Pawn'
}

/**
 * Holding the card is the whole permission, and taking a character spends it by overwriting
 * `character`. So this doubles as the "has not chosen yet" test and needs no separate flag.
 */
export function isSeeker(state: BlowCowState, playerID: string) {
  return state.players[playerID]?.character === 'The Seeker'
}

/**
 * What The Seeker may take: every character the room put in play, minus the ones already sitting at
 * the table, minus The Seeker itself — taking that again would only re-ask the same question.
 *
 * Scoped to `state.characterPool` rather than to every implemented character, because the pool is
 * the host's statement of which cards exist in this match and a card that was never dealt is not one
 * to seek out. That also inherits, for free, the rule keeping The Confused out of a Jack-less deck.
 *
 * Players who have already left still hold their card, so their character stays claimed.
 */
export function getSeekerCharacterChoices(state: BlowCowState, playerID: string) {
  const claimedCharacterNames = new Set(
    Object.values(state.players)
      .filter((player) => player.id !== playerID)
      .map((player) => player.character),
  )

  return getAvailableImplementedCharacterNames(state.deckConfig.selectedRanks, state.characterPool)
    .filter((characterName) => characterName !== 'The Seeker' && !claimedCharacterNames.has(characterName))
}

/**
 * The single question every enforcement site asks. Optional-chained on purpose: a match staged
 * before rule cards existed restores from `data/matches/` with no `rules` at all, and the honest
 * answer for it is that nothing was removed.
 */
export function isRuleRemoved(state: BlowCowState, ruleID: BlowCowRuleID) {
  return state.rules?.[ruleID] === 'removed'
}

export function isBroken(state: BlowCowState, playerID: string) {
  return state.players[playerID]?.character === 'The Broken'
}

/**
 * Every status a player is under. Optional-chained for the same reason `isRuleRemoved` is: a match
 * staged before statuses existed restores with no `statuses` at all, and the honest answer for it is
 * that nobody is afflicted.
 *
 * This is the only reader of the raw field. Enforcement sites ask `hasStatus` instead, so what a
 * status forbids and what the seat block draws can never disagree.
 */
export function getPlayerStatuses(state: BlowCowState, playerID: string): BlowCowPlayerStatus[] {
  return state.players[playerID]?.statuses ?? []
}

export function hasStatus(state: BlowCowState, playerID: string, statusID: BlowCowStatusID) {
  return getPlayerStatuses(state, playerID).some((status) => status.id === statusID)
}

/**
 * The one door in. Re-afflicting a status the player already has refreshes its counter rather than
 * stacking a second copy, and the cap is enforced here rather than left to the caller.
 *
 * Nothing in the game calls this outside setup yet — it exists so the character or rule card that
 * eventually hands statuses out has somewhere to hand them to.
 */
export function addPlayerStatus(
  state: BlowCowState,
  playerID: string,
  statusID: BlowCowStatusID,
  turns: number,
) {
  const player = state.players[playerID]
  if (!player) {
    return false
  }

  const statuses = player.statuses ?? []
  const turnsRemaining = normalizeStatusTurns(turns)
  const existing = statuses.find((status) => status.id === statusID)

  if (existing) {
    existing.turnsRemaining = turnsRemaining
    player.statuses = statuses
    return true
  }

  /*
   * Immunity, and the reason this refusal is checked before the cap rather than after: a player
   * already holding the opposing status is not full, they are immune, and the two have to be told
   * apart by anything that ever reports why an application failed. Nothing announces it — see
   * `getOpposedStatusID`.
   */
  const opposedStatusID = getOpposedStatusID(statusID)
  if (opposedStatusID && statuses.some((status) => status.id === opposedStatusID)) {
    return false
  }

  if (statuses.length >= BLOW_COW_MAX_STATUSES_PER_PLAYER) {
    return false
  }

  player.statuses = [...statuses, { id: statusID, turnsRemaining }]
  return true
}

/** One turn off every status this player holds, dropping the ones that run out. */
function tickPlayerStatuses(state: BlowCowState, playerID: string) {
  const player = state.players[playerID]
  if (!player?.statuses?.length) {
    return
  }

  player.statuses = player.statuses
    .map((status) => ({ ...status, turnsRemaining: status.turnsRemaining - 1 }))
    .filter((status) => status.turnsRemaining > 0)
}

/**
 * What is still there to destroy: every rule that defines a removed variant and is still standing. A
 * rule the host already removed in the lobby is not a second choice to spend an ability on.
 *
 * Shared by The Broken, who picks one, and The Prototype, who gets a random one. Both destroy the
 * same pool, so neither can invent a removal the rule card itself does not describe.
 */
export function getBreakableRuleIDs(state: BlowCowState) {
  return getRemovableRuleIDs().filter((ruleID) => !isRuleRemoved(state, ruleID))
}

/** Breaking a rule leaves `character` alone, so the spent flag has to be read off the pick itself. */
export function canBreakRule(state: BlowCowState, playerID: string) {
  return isBroken(state, playerID) && state.players[playerID]?.brokenRemovedRuleID === null
}

export function isPrototype(state: BlowCowState, playerID: string) {
  return state.players[playerID]?.character === 'The Prototype'
}

/**
 * The card Defy is allowed to burn. Hearts and nothing else, so the ability costs a specific card
 * rather than whichever one the hand values least, and a joker can never pay for it.
 */
export function isDefyDestroyableCard(card: BlowCowCard) {
  return card.suit === 'hearts'
}

/**
 * Defy needs a rule left to destroy and a heart to spend, not just an unspent use. Both halves of
 * the action are written on the card, so the ability is offered only when it can do all of what it
 * says — which also keeps it from becoming a free way to dump a card once every removable rule is
 * gone.
 */
export function canUseDefy(state: BlowCowState, playerID: string) {
  const player = state.players[playerID]

  return isPrototype(state, playerID)
    && !player?.hasUsedDefyThisRound
    && !player?.hasLeft
    && Boolean(player?.hand.some(isDefyDestroyableCard))
    && getBreakableRuleIDs(state).length > 0
}

export function isMastermind(state: BlowCowState, playerID: string) {
  return state.players[playerID]?.character === 'The Mastermind'
}

/**
 * Whose hand The Mastermind may open: every other player still in the game holding at least one
 * card. An empty hand is excluded because the conspiracy commits its owner to a play, and a play out
 * of nothing is a turn that can never be finished.
 */
export function getConspiracyTargetPlayerIDs(state: BlowCowState, playerID: string) {
  return getActivePlayerIDs(state).filter((targetPlayerID) => targetPlayerID !== playerID
    && state.players[targetPlayerID].hand.length > 0)
}

/**
 * The character-and-round half of Conspire's legality, mirrored by the board. The turn checks live in
 * `resolveConspire` alongside the table-room check, which is the one condition this action shares
 * with the play it commits to: opening a hand the player cannot then play out of would strand the
 * turn with no legal move left.
 */
export function canConspire(state: BlowCowState, playerID: string) {
  const player = state.players[playerID]

  return isMastermind(state, playerID)
    && !player?.hasUsedConspireThisRound
    && !player?.hasLeft
    && !state.conspiracy
    && getConspiracyTargetPlayerIDs(state, playerID).length > 0
}

/**
 * The conspiracy this player owes a play on, or null. Scoped to the turn it was opened on so a
 * record that somehow outlived its turn can never redirect a later play to someone else's hand.
 */
export function getOpenConspiracy(state: BlowCowState, playerID: string, turnNumber: number) {
  const conspiracy = state.conspiracy
  if (!conspiracy || conspiracy.playerID !== playerID || conspiracy.turnNumber !== turnNumber) {
    return null
  }

  return conspiracy
}

export function isClown(state: BlowCowState, playerID: string) {
  return state.players[playerID]?.character === 'The Clown'
}

/**
 * Whether this player's next play would leave the turn running. Read inside `performPlay` before
 * anything moves, because the play itself is what spends the round's one use.
 *
 * Unlike every other once-a-round ability there is no button for this and so no board mirror to keep
 * in step: the encore is not chosen, it simply happens to the first play of the round.
 */
export function canEarnEncore(state: BlowCowState, playerID: string) {
  const player = state.players[playerID]

  return isClown(state, playerID)
    && !player?.hasUsedClownEncoreThisRound
    && !player?.hasLeft
    && !state.encore
}

/**
 * Whether an encore would be worth handing out, checked after the play has landed. An encore that
 * buys nothing is worse than none at all: the turn would never end, because a play is the one action
 * it takes away.
 *
 * The three terms are the whole turn action space and are deliberately independent of each other, so
 * this can be answered before `G.encore` is written rather than after. `bsTargetPlayerID` is the
 * remembered pre-play target, which is also the only case in which the Final Two Players Rule closes
 * Pass — so a true first term covers the one situation the second and third cannot see. Accuse is
 * left out because it is not turn-bound: it is never what rescues a turn from having nothing left.
 */
function isEncoreWorthTaking(state: BlowCowState, bsTargetPlayerID: string | null) {
  return bsTargetPlayerID !== null
    || getTableCardCount(state.table) >= state.round.maxCardsOnTable
    || !isRuleRemoved(state, 'pass')
}

/**
 * The encore this player is still standing on, or null. Turn-scoped like `getOpenConspiracy`, so a
 * record that somehow outlived its turn can neither block a later play nor lend it a stale BS target.
 */
export function getOpenEncore(state: BlowCowState, playerID: string, turnNumber: number) {
  const encore = state.encore
  if (!encore || encore.playerID !== playerID || encore.turnNumber !== turnNumber) {
    return null
  }

  return encore
}

/**
 * The BS target an encore is holding open for its owner, or null for everyone else.
 *
 * Not turn-scoped, unlike `getOpenEncore`, and it cannot be: `getDefaultBSTargetPlayerID` is asked
 * the question from tooltips and status lines that have no turn number to hand it. `handleTurnStart`
 * clears the record, so there is never a stale one for this to read.
 */
export function getEncoreBSTargetPlayerID(state: BlowCowState, playerID: string) {
  return state.encore?.playerID === playerID ? state.encore.bsTargetPlayerID : null
}

export function isInvisibleHand(state: BlowCowState, playerID: string) {
  return state.players[playerID]?.character === 'The Invisible Hand'
}

/** Whom the round may be handed to: anyone still in the game except the player handing it over. */
export function getManipulationTargetPlayerIDs(state: BlowCowState, playerID: string) {
  return getActivePlayerIDs(state).filter((targetPlayerID) => targetPlayerID !== playerID)
}

/**
 * The ranks Manipulate may install as trump. Deciding the rank outright is still deciding it, so the
 * Rank Change Rule applies exactly as it does to an ordinary trump selection — and lifts with the
 * card, the same way. Not narrowed to the deck's own ranks, because an ordinary trump selection is
 * not either: claiming a rank nobody holds is a legal, and very loud, way to make everything a lie.
 */
export function getManipulableTrumpRanks(state: BlowCowState) {
  const forbiddenRank = isRuleRemoved(state, 'rankChange') ? null : state.round.previousTrumpRank

  return BLOW_COW_RANKS.filter((rank) => rank !== forbiddenRank)
}

/**
 * Manipulate's window, which is narrow by design: the starting player, on the first turn of the
 * round, before anything at all has happened in it. A pass or a play breaks every one of the three
 * conditions below, so a round that has begun can never be re-opened.
 *
 * Unlimited use needs no spent flag because the ability spends its own precondition — handing the
 * round to somebody else is what stops being the starting player, and The Invisible Hand may not
 * name themselves. It comes back the next time they legitimately open a round.
 */
export function canManipulate(state: BlowCowState, playerID: string) {
  return isInvisibleHand(state, playerID)
    && !state.players[playerID]?.hasLeft
    && state.round.startingPlayerID === playerID
    && state.round.trumpRank === null
    && state.round.passStreak === 0
    && state.round.lastNonPassingPlayerID === null
    && getManipulationTargetPlayerIDs(state, playerID).length > 0
}

export function isMime(state: BlowCowState, playerID: string) {
  return state.players[playerID]?.character === 'The Mime'
}

/**
 * Whose block Mimic copies, and the seat it may trade chairs with: the next active player in the
 * current direction. There is no choice to make, which is why Mimic sits in the action row rather
 * than on a player block — the ability names its own target.
 */
export function getMimicryTargetPlayerID(state: BlowCowState, playerID: string) {
  const targetPlayerID = getNextActivePlayerID(
    playerID,
    state.seatOrder,
    state.round.direction,
    getActivePlayerIDs(state),
  )

  return targetPlayerID === playerID ? null : targetPlayerID
}

/**
 * The character-and-round half of Mimic's legality, mirrored by the board. The turn checks live in
 * `resolveMimic`, alongside the final-two refusal that turn is the only place able to see.
 */
export function canMimic(state: BlowCowState, playerID: string) {
  const player = state.players[playerID]

  return isMime(state, playerID)
    && !player?.hasUsedMimicThisRound
    && !player?.hasLeft
    && !state.mimicry
    && getMimicryTargetPlayerID(state, playerID) !== null
}

/**
 * Drops the disguise. Deliberately not tied to a turn: The Mime keeps wearing the face through their
 * own later turns, so it comes off only when the round it belongs to does — through the start of any
 * procedure, through `beginNextRound` behind it, or when either of the two players leaves.
 *
 * The procedure case is the one that carries the weight, and it is also the only route a round has
 * out. A BS call, a Reset and an accusation all open the table and move cards between their real
 * owners, and a borrowed pile would be exposed as a copy the moment the first card turned over, so
 * every site that starts one drops the disguise first. `beginNextRound` clearing it again is belt
 * and braces for a restored match rather than a second ending.
 */
function clearMimicry(state: BlowCowState) {
  state.mimicry = null
}

/**
 * Turns one chair's share of the borrowed pile face up, when the turn arrives at that chair.
 *
 * The Reveal Rule normally belongs to a play, and a borrowed pile is drawn twice, so obeying it
 * literally would flip both copies at once — at whichever chair the source really occupies, which is
 * the coin flip read straight off the table. Splitting it per chair is what makes the two branches
 * look alike: whichever way the seats fell, the chair after the disguise turns its pile over first
 * and the chair holding the turn follows a lap later.
 *
 * The handover a swap creates is skipped because it is not a fresh arrival. Nobody outside the pair
 * saw the turn move — it was at that chair before Mimic and it is at that chair after — so counting
 * it would put the swapped branch one turn ahead of the other.
 */
function advanceMimicryReveal(state: BlowCowState, currentPlayerID: string) {
  const mimicry = state.mimicry
  if (!mimicry || (currentPlayerID !== mimicry.playerID && currentPlayerID !== mimicry.sourcePlayerID)) {
    return
  }

  if (mimicry.pendingHandoverPlayerID === currentPlayerID) {
    mimicry.pendingHandoverPlayerID = null
    return
  }

  if (!mimicry.revealedPlayerIDs.includes(currentPlayerID)) {
    mimicry.revealedPlayerIDs.push(currentPlayerID)
  }
}

function canUseGrandmasterBSOverride(state: BlowCowState, playerID: string) {
  return isGrandmaster(state, playerID) && !state.players[playerID]?.hasUsedGrandmasterBSOverride
}

/**
 * What the table is told a play contains. A player licensed to cheat never declares more than 2, so
 * any card past the second is one nobody was told about — which is the whole `extraCardCount` cheat.
 */
function getDeclaredCardCount(state: BlowCowState, playerID: string, actualCardCount: number) {
  return canCheat(state, playerID) && actualCardCount > 2 ? 2 : actualCardCount
}

/*
 * All four card-and-trump cheat tests are gated twice: on the rule they break still being in play,
 * and on the player holding a licence to break it. A cheat is only a cheat against a live rule —
 * once the Rank Change or Max Cards On Table card is gone, everyone may do the thing openly, so the
 * play is honest and there is nothing for an accusation to catch.
 */
function canRepeatPreviousTrump(
  state: BlowCowState,
  playerID: string,
  nextTrumpRank: BlowCowRank | null,
) {
  return nextTrumpRank !== null
    && !isRuleRemoved(state, 'rankChange')
    && state.round.trumpRank === null
    && state.round.previousTrumpRank !== null
    && state.round.previousTrumpRank === nextTrumpRank
    && canCheat(state, playerID)
}

function didRepeatPreviousTrump(state: BlowCowState, play: BlowCowTablePlay) {
  return play.wasTrumpSelection
    && !isRuleRemoved(state, 'rankChange')
    && state.round.previousTrumpRank !== null
    && play.claimedRank === state.round.previousTrumpRank
    && canCheat(state, play.playerID)
}

function didPlayExtraCards(state: BlowCowState, play: BlowCowTablePlay) {
  return canCheat(state, play.playerID) && play.cards.length > (play.declaredCardCount ?? play.cards.length)
}

function didExceedTableLimit(state: BlowCowState, play: BlowCowTablePlay) {
  return canCheat(state, play.playerID)
    && !isRuleRemoved(state, 'maxCardsOnTable')
    && getTableCardCount(state.table) > state.round.maxCardsOnTable
}

/**
 * The play `playerID` put on the table during `turnNumber`, if any.
 *
 * Every legal route to the table is gated on `ctx.currentPlayer`, so a play here that belongs to
 * anyone but the player on the clock can only have been sneaked. That is deliberately derived
 * rather than recorded: a `wasSneakPlay` flag on the play would have to survive `hideSecretState`
 * to be useful to the server and would give the cheat away the moment it did not.
 */
function getPlayForPlayerAtTurn(state: BlowCowState, playerID: string, turnNumber: number) {
  return state.table.plays.find(
    (play) => play.playerID === playerID && play.playedAtTurn === turnNumber,
  ) ?? null
}

function getLatestPlayForPlayer(state: BlowCowState, playerID: string) {
  for (let playIndex = state.table.plays.length - 1; playIndex >= 0; playIndex -= 1) {
    if (state.table.plays[playIndex].playerID === playerID) {
      return state.table.plays[playIndex]
    }
  }

  return null
}

/**
 * The one cheat `targetPlayerID` is currently answerable for, or null when the accusation would
 * miss. Only `accuseDreamer` calls this — a BS call no longer looks at any of it.
 *
 * The windows differ because the cheats do. Tampering with the direction and reaching into someone
 * else's turn to play are properties of the turn they happened in, so they close when that turn
 * ends. The other three are properties of a play, and follow the play's own hidden lifetime:
 * catchable during the turn immediately after it was made, and gone once that turn is over.
 */
function getAccusableCheat(
  state: BlowCowState,
  targetPlayerID: string,
  currentPlayerID: string,
  turnNumber: number,
): BlowCowDreamerCheatKind | null {
  if (!canCheat(state, targetPlayerID)) {
    return null
  }

  if (state.directionTamper?.playerID === targetPlayerID && state.directionTamper.turnNumber === turnNumber) {
    return 'directionChange'
  }

  if (targetPlayerID !== currentPlayerID && getPlayForPlayerAtTurn(state, targetPlayerID, turnNumber)) {
    return 'sneakPlay'
  }

  // Read off the record rather than off the table, because a card taken back leaves nothing behind to
  // inspect — see `BlowCowTakeBackTamper`. Same one-turn window as the direction tamper above.
  if (state.takeBackTamper?.playerID === targetPlayerID && state.takeBackTamper.turnNumber === turnNumber) {
    return 'takeBackCard'
  }

  const latestPlay = getLatestPlayForPlayer(state, targetPlayerID)
  if (!latestPlay || latestPlay.playedAtTurn + 1 !== turnNumber) {
    return null
  }

  if (didPlayExtraCards(state, latestPlay)) {
    return 'extraCardCount'
  }

  if (didExceedTableLimit(state, latestPlay)) {
    return 'exceededTableLimit'
  }

  if (didRepeatPreviousTrump(state, latestPlay)) {
    return 'repeatTrump'
  }

  return null
}

/**
 * Whether a procedure currently owns the table. The three are mutually exclusive by construction:
 * each one's opening move refuses while either of the others is live, so nothing can start on top
 * of a resolution someone is still walking through by hand.
 */
export function isProcedureRunning(state: BlowCowState) {
  return state.bsResolution !== null || state.resetResolution !== null || state.accusation !== null
}

export function getDreamerCheatDescription(cheatKind: BlowCowDreamerCheatKind) {
  if (cheatKind === 'directionChange') {
    return 'changed the turn direction'
  }

  if (cheatKind === 'sneakPlay') {
    return 'slipped cards onto the table out of turn'
  }

  if (cheatKind === 'takeBackCard') {
    return 'took a revealed card back off the table'
  }

  if (cheatKind === 'extraCardCount') {
    return 'played more cards than they declared'
  }

  if (cheatKind === 'exceededTableLimit') {
    return 'pushed the table past its card limit'
  }

  return 'reused the previous round trump on the opening play'
}

function getDefaultBSTargetPlayerID(state: BlowCowState, currentPlayerID: string) {
  if (state.bsResolution) {
    return null
  }

  /*
   * The remembered target comes first, and only The Clown mid-encore has one. Their own play is the
   * latest non-passing one by then, so reading the round the usual way would answer "yourself" and
   * take Call BS off the encore it was meant to be spendable on.
   */
  const targetPlayerID = getEncoreBSTargetPlayerID(state, currentPlayerID) ?? state.round.lastNonPassingPlayerID
  if (!state.round.trumpRank || !targetPlayerID || targetPlayerID === currentPlayerID) {
    return null
  }

  const pendingPlay = getPendingPlay(state, targetPlayerID)
  return pendingPlay ? targetPlayerID : null
}

function getPawnEnPassantTargetSelection(
  state: BlowCowState,
  currentPlayerID: string,
) {
  if (!isPawn(state, currentPlayerID) || state.bsResolution || !state.round.trumpRank) {
    return null
  }

  const triggerPlayerID = getDefaultBSTargetPlayerID(state, currentPlayerID)
  if (!triggerPlayerID) {
    return null
  }

  const triggerPlay = getPendingPlay(state, triggerPlayerID)
  if (!triggerPlay || triggerPlay.cards.length !== 2) {
    return null
  }

  const triggerPlayIndex = state.table.plays.findIndex((play) => play.id === triggerPlay.id)
  if (triggerPlayIndex <= 0) {
    return null
  }

  const targetPlay = state.table.plays[triggerPlayIndex - 1]
  if (!playHasHiddenCards(targetPlay) || targetPlay.playerID === currentPlayerID) {
    return null
  }

  const pendingTargetPlay = getPendingPlay(state, targetPlay.playerID)
  if (!pendingTargetPlay || pendingTargetPlay.id !== targetPlay.id) {
    return null
  }

  return {
    triggerPlayerID,
    targetPlayerID: targetPlay.playerID,
    targetPlay: pendingTargetPlay,
  }
}

function resolveBSTargetSelection(
  state: BlowCowState,
  currentPlayerID: string,
  requestedTargetPlayerID?: string | null,
) {
  if (state.bsResolution || !state.round.trumpRank) {
    return null
  }

  const defaultTargetPlayerID = getDefaultBSTargetPlayerID(state, currentPlayerID)
  if (!requestedTargetPlayerID || requestedTargetPlayerID === defaultTargetPlayerID) {
    const defaultTargetPlay = defaultTargetPlayerID ? getPendingPlay(state, defaultTargetPlayerID) : null
    return defaultTargetPlayerID && defaultTargetPlay
      ? {
          targetPlayerID: defaultTargetPlayerID,
          targetPlay: defaultTargetPlay,
          usedGrandmasterBSOverride: false,
          usedPawnEnPassant: false,
          pawnTriggerPlayerID: null,
        }
      : null
  }

  const pawnEnPassantTarget = getPawnEnPassantTargetSelection(state, currentPlayerID)
  if (pawnEnPassantTarget && requestedTargetPlayerID === pawnEnPassantTarget.targetPlayerID) {
    return {
      targetPlayerID: pawnEnPassantTarget.targetPlayerID,
      targetPlay: pawnEnPassantTarget.targetPlay,
      usedGrandmasterBSOverride: false,
      usedPawnEnPassant: true,
      pawnTriggerPlayerID: pawnEnPassantTarget.triggerPlayerID,
    }
  }

  if (requestedTargetPlayerID === currentPlayerID || !canUseGrandmasterBSOverride(state, currentPlayerID)) {
    return null
  }

  const requestedTargetPlay = getPendingPlay(state, requestedTargetPlayerID)
  if (!requestedTargetPlay) {
    return null
  }

  return {
    targetPlayerID: requestedTargetPlayerID,
    targetPlay: requestedTargetPlay,
    usedGrandmasterBSOverride: true,
    usedPawnEnPassant: false,
    pawnTriggerPlayerID: null,
  }
}

function isFinalTwoResolutionTurn(state: BlowCowState, currentPlayerID: string) {
  const activePlayerIDs = getActivePlayerIDs(state)
  if (activePlayerIDs.length !== 2) {
    return false
  }

  const targetPlayerID = getDefaultBSTargetPlayerID(state, currentPlayerID)
  if (!targetPlayerID) {
    return false
  }

  return state.players[targetPlayerID].hand.length === 0
}

/**
 * The order a caller walks the table in: `startPlayerID` first, then around the ring against the
 * current turn direction, skipping anyone with nothing face down. Shared by both procedures — BS
 * starts at the accused, Reset at whoever called it. Frozen at call time so the direction flip in
 * `beginNextRound` cannot reorder a resolution that is already running.
 */
function getTableRevealOrder(state: BlowCowState, startPlayerID: string) {
  const revealDirection = toggleDirection(state.round.direction)
  const activePlayerIDs = getActivePlayerIDs(state)
  const visitOrder = [startPlayerID]

  for (let step = 1; step < state.seatOrder.length; step += 1) {
    const nextPlayerID = getNextActivePlayerID(
      visitOrder[visitOrder.length - 1],
      state.seatOrder,
      revealDirection,
      activePlayerIDs,
    )

    if (!nextPlayerID || nextPlayerID === startPlayerID) {
      break
    }

    visitOrder.push(nextPlayerID)
  }

  return visitOrder.filter((playerID) => getFaceDownTableCardsForPlayer(state, playerID).length > 0)
}

export function getRevealFocusedPlayerID(walk: BlowCowRevealWalk) {
  return walk.revealOrder[walk.revealStepIndex] ?? null
}

export function isRevealComplete(walk: BlowCowRevealWalk) {
  return walk.revealStepIndex >= walk.revealOrder.length
}

function createBSResolution(
  state: BlowCowState,
  callerPlayerID: string,
  targetPlayerID: string,
  targetPlay: BlowCowTablePlay,
  trumpRank: BlowCowRank,
) {
  // Honesty is now the whole question: were the hidden cards the rank they were claimed to be. The
  // Dreamer's rule-breaking is out of scope here and belongs to `accuseDreamer`, which is why the
  // Reverse Rule no longer has a Dreamer exception to make room for.
  const targetCharacter = state.players[targetPlayerID]?.character ?? null
  const targetWasHonest = targetPlay.cards.every((card) => isTrumpCardInMatch(state, card, trumpRank, targetCharacter))
  // Removing the Reverse Rule does not change the count; it stops the count from mattering.
  const reverseRuleTriggered = !isRuleRemoved(state, 'reverse')
    && state.table.plays.flatMap((play) => {
      const playCharacter = state.players[play.playerID]?.character ?? null
      return play.cards.filter((card) => countsTowardReverseRule(card, trumpRank, playCharacter))
    }).length >= 4
  // The Contrarian's own layer of reverse, and it is a layer rather than an override: it stacks with
  // the Reverse Rule, so a call that trips both flips twice and lands back on the default. Bound to
  // the caller's seat only — being called on by a Contrarian does nothing.
  const contrarianTriggered = isContrarian(state, callerPlayerID)
  const defaultPunishedPlayerID = targetWasHonest ? callerPlayerID : targetPlayerID
  const isPunishmentFlipped = reverseRuleTriggered !== contrarianTriggered
  const punishedPlayerID = isPunishmentFlipped
    ? (defaultPunishedPlayerID === callerPlayerID ? targetPlayerID : callerPlayerID)
    : defaultPunishedPlayerID
  const unpunishedPlayerID = punishedPlayerID === callerPlayerID ? targetPlayerID : callerPlayerID

  return {
    id: `bs-${state.round.roundNumber}-${targetPlay.playedAtTurn}-${callerPlayerID}`,
    callerPlayerID,
    targetPlayerID,
    targetPlayID: targetPlay.id,
    targetDeclaredCardCount: targetPlay.declaredCardCount ?? targetPlay.cards.length,
    trumpRank,
    punishmentCardCount: getTableCardCount(state.table),
    revealOrder: getTableRevealOrder(state, targetPlayerID),
    revealStepIndex: 0,
    isPunishing: false,
    targetVerdict: {
      targetWasHonest,
    },
    punishment: {
      reverseRuleTriggered,
      contrarianTriggered,
      punishedPlayerID,
      unpunishedPlayerID,
    },
  } satisfies BlowCowBSResolution
}

/**
 * The Gambler turns every Reset into a showdown, whoever calls it — the ability is a rule they
 * impose on the table rather than an action they spend, so it is read off the seating and not off
 * the caller. A Gambler who has left the game takes it with them.
 */
function isGamblerShowdownActive(state: BlowCowState) {
  return getActivePlayerIDs(state).some((playerID) => state.players[playerID]?.character === 'The Gambler')
}

/**
 * Reads the cards in front of every active player as a poker hand and ranks them. Built at call time
 * like a BS punishment, and hidden the same way until the reveal is complete.
 *
 * Everyone still in the game is ranked, including players who passed all round and have nothing in
 * front of them — an empty hand is the weakest thing there is, and leaving those seats out would
 * quietly protect the most passive player at the table from the one procedure that punishes passivity.
 */
function createResetShowdown(state: BlowCowState, callerPlayerID: string) {
  const rankedPlayers = getActivePlayerIDs(state)
    .map((playerID) => ({
      playerID,
      hand: evaluatePokerHand(getTableCardsForPlayer(state, playerID)),
    }))
    .sort((left, right) => comparePokerHands(right.hand, left.hand))

  const weakestHand = rankedPlayers[rankedPlayers.length - 1]?.hand ?? null

  return {
    standings: rankedPlayers.map(({ playerID, hand }) => ({
      playerID,
      handLabel: hand.label,
      cardCount: hand.cardCount,
    })),
    // A tie leaves more than one seat here, and every one of them is offered to the caller.
    weakestPlayerIDs: weakestHand
      ? rankedPlayers
          .filter(({ hand }) => comparePokerHands(hand, weakestHand) === 0)
          .map(({ playerID }) => playerID)
      : [callerPlayerID],
    punishmentCardCount: getTableCardCount(state.table),
    isPunishing: false,
    punishedPlayerID: null,
  } satisfies BlowCowResetShowdown
}

function createResetResolution(
  state: BlowCowState,
  callerPlayerID: string,
  kind: BlowCowTableReturnResolutionKind,
) {
  return {
    id: `${kind}-${state.round.roundNumber}-${state.table.plays.length}-${callerPlayerID}`,
    callerPlayerID,
    kind,
    // Starts at the caller, unlike BS, which starts at the accused. The caller is filtered out if
    // they have nothing face down, so an all-pass return can begin at someone else entirely.
    revealOrder: getTableRevealOrder(state, callerPlayerID),
    revealStepIndex: 0,
    // An all-pass return is not a Reset, so it is never a showdown: nobody called anything, and the
    // cards are going back to the players who put them down rather than being won or lost.
    showdown: kind === 'reset' && isGamblerShowdownActive(state)
      ? createResetShowdown(state, callerPlayerID)
      : null,
  } satisfies BlowCowResetResolution
}

function buildTurnStatus(state: BlowCowState, currentPlayerID: string) {
  if (state.gameStatus !== 'active') {
    return state.tableStatus
  }

  if (state.accusation) {
    const { accuserPlayerID, targetPlayerID, wasSuccessful, caughtCheat, punishedPlayerID } = state.accusation
    const callLabel = `${formatPlayerLabel(state, accuserPlayerID)} accused ${formatPlayerLabel(state, targetPlayerID)} of cheating.`
    const outcomeLabel = wasSuccessful && caughtCheat
      ? `They ${getDreamerCheatDescription(caughtCheat)}.`
      : 'The accusation missed.'

    return `${callLabel} ${outcomeLabel} ${formatPlayerLabel(state, punishedPlayerID)} must take the table.`
  }

  if (state.bsResolution) {
    // Broadcast prose, so it must never name the verdict before the caller has revealed it.
    const focusedPlayerID = getRevealFocusedPlayerID(state.bsResolution)
    const challengeLabel = `${formatPlayerLabel(state, state.bsResolution.callerPlayerID)} called BS on ${formatPlayerLabel(state, state.bsResolution.targetPlayerID)}.`

    return focusedPlayerID
      ? `${challengeLabel} Revealing ${formatPlayerLabel(state, focusedPlayerID)}'s cards.`
      : `${challengeLabel} Every card on the table is face up.`
  }

  if (state.resetResolution) {
    const focusedPlayerID = getRevealFocusedPlayerID(state.resetResolution)
    // Broadcast prose, so it may say a showdown is coming — The Gambler's seat is public — but never
    // who is losing it. That is the reveal's to tell.
    const callLabel = state.resetResolution.kind === 'roundReturn'
      ? `${formatPlayerLabel(state, state.resetResolution.callerPlayerID)} passed. Everyone passed, so the table cards are returning to their owners.`
      : state.resetResolution.showdown
      ? `${formatPlayerLabel(state, state.resetResolution.callerPlayerID)} called Reset. The Gambler makes it a showdown, so the weakest hand takes the table.`
      : `${formatPlayerLabel(state, state.resetResolution.callerPlayerID)} called Reset. Returning the table cards before redistributing them.`

    return focusedPlayerID
      ? `${callLabel} Revealing ${formatPlayerLabel(state, focusedPlayerID)}'s cards.`
      : `${callLabel} Every card on the table is face up.`
  }

  const playerLabel = formatPlayerLabel(state, currentPlayerID)
  const trumpRank = state.round.trumpRank
  const tableCardCount = getTableCardCount(state.table)
  const hasBSTarget = Boolean(getDefaultBSTargetPlayerID(state, currentPlayerID))
  const hasPawnEnPassantTarget = Boolean(getPawnEnPassantTargetSelection(state, currentPlayerID))
  const canReset = tableCardCount >= state.round.maxCardsOnTable
  const directionActionDetail = isCat(state, currentPlayerID)
    ? ' Change Direction is also available.'
    : canCheat(state, currentPlayerID)
    ? ' Change Direction is also available, but Accuse can catch it before the turn ends.'
    : ''

  const canPass = !isRuleRemoved(state, 'pass') && state.round.forcedPlayPlayerID !== currentPlayerID
  // The Clown has already played this turn and the encore does not buy a second one.
  const hasEncore = state.encore?.playerID === currentPlayerID
  // With the table cap gone, a full table no longer closes Play, so the two stop being exclusive.
  const canPlayMore = !hasEncore
    && (isRuleRemoved(state, 'maxCardsOnTable') || tableCardCount < state.round.maxCardsOnTable)

  // A conspiracy leaves exactly one legal move, so the status names it instead of listing an action
  // space that no longer applies.
  if (state.conspiracy?.playerID === currentPlayerID) {
    const conspiracyLabel = `${playerLabel} opened ${formatPlayerLabel(state, state.conspiracy.targetPlayerID)}'s hand and must play out of it.`

    return trumpRank
      ? `Trump is ${trumpRank}. Table ${tableCardCount}/${state.round.maxCardsOnTable}. ${conspiracyLabel}`
      : `Round ${state.round.roundNumber}. ${conspiracyLabel} A trump rank is chosen with it.`
  }

  /*
   * A disguise is up, and the seat on the clock is one of the two it hangs between. Everything below
   * is read off the acting player themselves — Change Direction off their character, En Passant off
   * The Pawn, Call BS off whether the last play was somebody else's — and all three differ between
   * The Mime and the player they copied. Reciting them would answer in prose the question the two
   * identical blocks are asking, so the status says only what both seats have in common.
   *
   * It cannot close the channel altogether. An ability the copy has and The Mime does not is still
   * an ability only its real owner can press, so using one gives the game away — that is the cost of
   * copying a face without the card behind it, and it is on the character.
   */
  if (state.mimicry
    && (currentPlayerID === state.mimicry.playerID || currentPlayerID === state.mimicry.sourcePlayerID)) {
    return trumpRank
      ? `Trump is ${trumpRank}. Table ${tableCardCount}/${state.round.maxCardsOnTable}. ${playerLabel} to act.`
      : `Round ${state.round.roundNumber}. ${playerLabel} to act. A trump rank is chosen with the first play.`
  }

  if (!trumpRank) {
    return canPass
      ? `Round ${state.round.roundNumber}. ${playerLabel} to act. Choose a trump rank and play, or pass.${directionActionDetail}`
      : `Round ${state.round.roundNumber}. ${playerLabel} to act. Choose a trump rank and play.${directionActionDetail}`
  }

  // The round was opened for them, rank and all, so there is one action left and the status says it
  // rather than reciting an action space they do not have.
  if (state.round.forcedPlayPlayerID === currentPlayerID) {
    return `Trump is ${trumpRank}. The Invisible Hand opened the round for ${playerLabel}, who must play and may not pass.${directionActionDetail}`
  }

  const tableSummary = `Trump is ${trumpRank}. Table ${tableCardCount}/${state.round.maxCardsOnTable}.`

  if (isFinalTwoResolutionTurn(state, currentPlayerID)) {
    const targetPlayerID = getDefaultBSTargetPlayerID(state, currentPlayerID)
    if (canReset) {
      return `${tableSummary} ${playerLabel} may Call Reset or Call BS while ${formatPlayerLabel(state, targetPlayerID ?? currentPlayerID)} waits on their final hidden play.${directionActionDetail}`
    }

    return `${tableSummary} ${playerLabel} may Call BS while ${formatPlayerLabel(state, targetPlayerID ?? currentPlayerID)} waits on their final hidden play.${directionActionDetail}`
  }

  /*
   * Assembled rather than written out per case. Every removable rule can take an action off this
   * list, and seven hand-written sentences would each need the same set of branches.
   */
  const availableActions = [
    ...(canPlayMore ? ['Play'] : []),
    ...(canReset ? ['Call Reset'] : []),
    ...(hasBSTarget ? ['Call BS'] : []),
    ...(hasBSTarget && hasPawnEnPassantTarget ? ['En Passant'] : []),
    ...(canPass ? ['Pass'] : []),
  ]

  if (availableActions.length === 0) {
    return `${tableSummary} ${playerLabel} has no legal action left this turn.${directionActionDetail}`
  }

  // Said outright, because a turn that does not move on after a play is otherwise indistinguishable
  // from a stalled table. `isEncoreWorthTaking` is what guarantees there is something in this list.
  if (hasEncore) {
    return `${tableSummary} ${playerLabel} played and still holds the turn, and may ${formatActionList(availableActions)}.${directionActionDetail}`
  }

  return `${tableSummary} ${playerLabel} may ${formatActionList(availableActions)}.${directionActionDetail}`
}

/** `A`, `A or B`, `A, B, or C` — the Oxford comma matches the sentences this replaced. */
function formatActionList(actions: string[]) {
  if (actions.length <= 1) {
    return actions.join('')
  }

  if (actions.length === 2) {
    return `${actions[0]} or ${actions[1]}`
  }

  return `${actions.slice(0, -1).join(', ')}, or ${actions[actions.length - 1]}`
}

function buildGameOverSummary(state: BlowCowState): BlowCowGameOver {
  const placements = [...state.seatOrder].sort((leftPlayerID, rightPlayerID) => {
    const leftPlayer = state.players[leftPlayerID]
    const rightPlayer = state.players[rightPlayerID]

    return leftPlayer.points - rightPlayer.points
      || (leftPlayer.leaveOrder ?? Number.MAX_SAFE_INTEGER) - (rightPlayer.leaveOrder ?? Number.MAX_SAFE_INTEGER)
      || leftPlayer.seatIndex - rightPlayer.seatIndex
  })

  return {
    placements,
    winnerID: placements[0],
    pointsByPlayer: Object.fromEntries(
      Object.entries(state.players).map(([playerID, player]) => [playerID, player.points]),
    ),
  }
}

function finalizeGame(state: BlowCowState, events: BlowCowEventsAPI, statusMessage: string, turnNumber: number) {
  const gameOver = buildGameOverSummary(state)
  state.gameStatus = 'finished'
  // Nothing left to bluff about, and the ring is still on screen behind the results.
  clearMimicry(state)
  state.placements = gameOver.placements
  state.tableStatus = statusMessage
  appendTelemetryEvent(state, 'game', 'Match finished', statusMessage, gameOver.winnerID, turnNumber)
  events.endGame(gameOver)
}

function getRoundStartPlayerOrder(state: BlowCowState) {
  const activePlayerIDs = getActivePlayerIDs(state)
  const fallbackStartingPlayerID = activePlayerIDs.includes(state.round.startingPlayerID)
    ? state.round.startingPlayerID
    : activePlayerIDs[0]
  const startingPlayerID = getDefaultStartingPlayerID(state, fallbackStartingPlayerID)

  if (!startingPlayerID) {
    return [] as string[]
  }

  const roundStartPlayerOrder = [startingPlayerID]

  while (roundStartPlayerOrder.length < activePlayerIDs.length) {
    const nextPlayerID = getNextActivePlayerID(
      roundStartPlayerOrder[roundStartPlayerOrder.length - 1] ?? startingPlayerID,
      state.seatOrder,
      state.round.direction,
      activePlayerIDs,
    )

    if (!nextPlayerID || roundStartPlayerOrder.includes(nextPlayerID)) {
      break
    }

    roundStartPlayerOrder.push(nextPlayerID)
  }

  return roundStartPlayerOrder
}

function beginNextRound(state: BlowCowState, nextStartingPlayerID: string, statusMessage: string) {
  state.round.roundNumber += 1
  if (!isRuleRemoved(state, 'directionChange')) {
    state.round.direction = toggleDirection(state.round.direction)
  }
  // Before the starting player is picked, not with the other per-round flags below: the round that
  // just ended is what The Privileged claim is measured against, and that claim is read right here.
  for (const player of Object.values(state.players)) {
    player.wasPunishedLastRound = player.wasPunishedThisRound
    player.wasPunishedThisRound = false
  }
  state.round.startingPlayerID = getDefaultStartingPlayerID(state, nextStartingPlayerID) ?? nextStartingPlayerID
  state.round.pendingStartingPlayerID = null
  state.round.previousTrumpRank = state.round.trumpRank ?? state.round.previousTrumpRank
  state.round.trumpRank = null
  state.round.passStreak = 0
  state.round.lastNonPassingPlayerID = null
  state.round.forcedPlayPlayerID = null
  // Statuses are deliberately not touched anywhere in here. They are counted in turns, not rounds, so
  // one handed out near a boundary is meant to survive it; only their turn marker is round-scoped.
  state.round.startedTurnNumber = null
  state.round.status = 'awaitingTrumpSelection'
  state.table.plays = []
  state.bsResolution = null
  state.resetResolution = null
  state.accusation = null
  // All round-scoped: nothing from the old round stays accusable, and everyone gets their one
  // accusation back, The Prototype their one Defy, The Mastermind their one Conspire, The Mime their
  // one Mimic, and The Clown their one encore. A disguise never outlives the round it was put on
  // either.
  state.directionTamper = null
  state.takeBackTamper = null
  state.directionFlip = null
  state.conspiracy = null
  state.encore = null
  clearMimicry(state)
  for (const player of Object.values(state.players)) {
    player.hasUsedAccusationThisRound = false
    player.hasUsedDefyThisRound = false
    player.hasUsedConspireThisRound = false
    player.hasUsedMimicThisRound = false
    player.hasUsedClownEncoreThisRound = false
  }
  clearPendingRevealIDs(state)
  updateRoundCapacity(state)
  state.tableStatus = statusMessage
}

function resolveRoundStartLeaves(state: BlowCowState, turnNumber: number) {
  const roundStartPlayerOrder = getRoundStartPlayerOrder(state)
  let nextStartingPlayerID: string | null = null

  for (const playerID of roundStartPlayerOrder) {
    if (state.players[playerID].hand.length === 0) {
      markPlayerLeft(
        state,
        playerID,
        turnNumber,
        'Started the round with no cards in hand and left immediately.',
      )
      continue
    }

    if (!nextStartingPlayerID) {
      nextStartingPlayerID = playerID
    }
  }

  nextStartingPlayerID = getDefaultStartingPlayerID(state, nextStartingPlayerID)

  if (nextStartingPlayerID) {
    state.round.startingPlayerID = nextStartingPlayerID
  }

  return nextStartingPlayerID
}

function revealPendingPlayAtTurnStart(
  state: BlowCowState,
  currentPlayerID: string,
  turnNumber: number,
  shuffle?: BlowCowShuffle,
) {
  const pendingPlay = getPendingRevealPlay(state, currentPlayerID)
  if (!pendingPlay) {
    return
  }

  /*
   * Without the Reveal Rule nothing is flipped at the start of a turn, so the pointer is dropped
   * rather than acted on and the play stays face down until a BS call or a Reset opens it. The Spy
   * goes with it: their ability only ever chose how much of this reveal happened.
   */
  if (isRuleRemoved(state, 'reveal')) {
    state.players[currentPlayerID].pendingRevealPlayID = null
    return
  }

  const hiddenCards = getHiddenCardsForPlay(pendingPlay)
  if (state.players[currentPlayerID].character === 'The Spy' && hiddenCards.length >= 2) {
    const revealedCard = shuffleCards(hiddenCards, shuffle)[0] ?? hiddenCards[0]
    pendingPlay.revealedCardIDs = [...new Set([...(pendingPlay.revealedCardIDs ?? []), revealedCard.id])]
    state.players[currentPlayerID].pendingRevealPlayID = null
    const remainingHiddenCardCount = getHiddenCardsForPlay(pendingPlay).length
    appendHistoryEvent(
      state,
      'action',
      `${formatPlayerLabel(state, currentPlayerID)} revealed 1 card(s)`,
      `The Spy revealed ${formatCardLabel(revealedCard)} after claiming ${pendingPlay.claimedRank}. ${remainingHiddenCardCount} card(s) remained hidden.`,
      currentPlayerID,
      turnNumber,
    )
    appendArchiveTurnAction(state, currentPlayerID, turnNumber, {
      kind: 'revealPendingPlay',
      detail: `The Spy revealed ${formatCardLabel(revealedCard)} after claiming ${pendingPlay.claimedRank}.`,
      characterUsed: 'The Spy',
      revealedPlayerID: currentPlayerID,
      cards: [revealedCard],
      claimedRank: pendingPlay.claimedRank,
      remainingHiddenCardCount,
    })
    return
  }

  pendingPlay.revealedAtTurn = turnNumber
  pendingPlay.rehiddenCardIDs = []
  state.players[currentPlayerID].pendingRevealPlayID = null
  appendHistoryEvent(
    state,
    'action',
    `${formatPlayerLabel(state, currentPlayerID)} revealed ${pendingPlay.cards.length} card(s)`,
    `Revealed ${pendingPlay.cards.map((card) => formatCardLabel(card)).join(', ')} after claiming ${pendingPlay.claimedRank}.`,
    currentPlayerID,
    turnNumber,
  )
  appendArchiveTurnAction(state, currentPlayerID, turnNumber, {
    kind: 'revealPendingPlay',
    detail: `Revealed ${pendingPlay.cards.length} card(s) after claiming ${pendingPlay.claimedRank}.`,
    revealedPlayerID: currentPlayerID,
    cards: pendingPlay.cards,
    claimedRank: pendingPlay.claimedRank,
    remainingHiddenCardCount: 0,
  })
}

/**
 * Applies the point change, records it for the board and the results table, and logs it. The three
 * always happen together, so no branch below can move a total without leaving a trace of why.
 */
function recordLeaveCharacterEffect(
  state: BlowCowState,
  playerID: string,
  character: BlowCowCharacterName,
  pointDelta: number,
  detail: string,
  turnNumber: number,
) {
  const player = getPlayerState(state, playerID)

  player.points += pointDelta
  player.leaveEffect = { character, pointDelta }
  appendHistoryEvent(
    state,
    'system',
    `${formatPlayerLabel(state, playerID)} triggered ${character}`,
    detail,
    playerID,
    turnNumber,
  )
}

function applyLeaveCharacterEffect(state: BlowCowState, playerID: string, turnNumber: number) {
  const player = getPlayerState(state, playerID)

  if (player.character === 'The Speedrunner' && player.leaveOrder === 1 && player.points === 2) {
    // Written as a delta rather than an assignment so the label can name a number. The guard pins
    // the total at 2, so this is always exactly -2 and always lands on 0.
    recordLeaveCharacterEffect(
      state,
      playerID,
      'The Speedrunner',
      -player.points,
      'Left first with exactly 2 points, so the total became 0 instead.',
      turnNumber,
    )
    return
  }

  if (player.character === 'The Privileged') {
    recordLeaveCharacterEffect(
      state,
      playerID,
      'The Privileged',
      1,
      'Left the game, so 1 point was added.',
      turnNumber,
    )
    return
  }

  if (player.character === 'The Streamer' && player.matchStats.passCount === 0) {
    recordLeaveCharacterEffect(
      state,
      playerID,
      'The Streamer',
      -2,
      'Left the game without ever passing, so 2 points were lost.',
      turnNumber,
    )
    return
  }

  if (player.character === 'The Pacifist' && player.matchStats.callBSCount === 0) {
    recordLeaveCharacterEffect(
      state,
      playerID,
      'The Pacifist',
      -1,
      'Left the game without ever calling BS, so 1 point was lost.',
      turnNumber,
    )
    return
  }

  if (player.character === 'The Drunkard' && player.matchStats.playCount > 0 && !player.hasUsedManualPlay) {
    recordLeaveCharacterEffect(
      state,
      playerID,
      'The Drunkard',
      -3,
      'Left the game after only ever using Play Random, so 3 points were lost.',
      turnNumber,
    )
  }
}

function removeLeftPlayerTableCards(state: BlowCowState, playerID: string) {
  const removedCards = getPlayerFrontCards(state, playerID)
  if (removedCards.length === 0) {
    return removedCards
  }

  state.table.plays = state.table.plays.filter((play) => play.playerID !== playerID)

  return removedCards
}

function markPlayerLeft(
  state: BlowCowState,
  playerID: string,
  turnNumber: number,
  detail = 'Started the turn with no cards in hand and left immediately.',
) {
  const player = getPlayerState(state, playerID)
  if (player.hasLeft) {
    return
  }

  player.hasLeft = true
  player.leaveOrder = Object.values(state.players).filter((entry) => entry.hasLeft).length
  player.pendingRevealPlayID = null
  // Either half of a disguise leaving takes it down: the leaver's table cards are removed below, and
  // a borrowed pile pointing at cards that are no longer in the game would simply vanish from under
  // it. A block wearing a face that has left the table is not a disguise anybody would be fooled by.
  if (state.mimicry?.playerID === playerID || state.mimicry?.sourcePlayerID === playerID) {
    clearMimicry(state)
  }
  const removedTableCards = removeLeftPlayerTableCards(state, playerID)
  appendHistoryEvent(
    state,
    'leave',
    `${formatPlayerLabel(state, playerID)} left the game`,
    detail,
    playerID,
    turnNumber,
  )
  appendArchiveTurnAction(state, playerID, turnNumber, {
    kind: 'leave',
    detail,
    leaveOrder: player.leaveOrder,
    cards: removedTableCards,
  })

  if (removedTableCards.length > 0) {
    appendHistoryEvent(
      state,
      'system',
      `${removedTableCards.length} card(s) left the game with ${formatPlayerLabel(state, playerID)}`,
      `${removedTableCards.map((card) => formatCardLabel(card)).join(', ')} sat in front of them on the table and were removed from the game entirely.`,
      playerID,
      turnNumber,
    )
  }

  applyLeaveCharacterEffect(state, playerID, turnNumber)
  updateRoundCapacity(state)
}

function finalizeGameForLastRemainingPlayer(
  state: BlowCowState,
  events: BlowCowEventsAPI,
  currentPlayerID: string,
  turnNumber: number,
) {
  const activePlayerIDs = getActivePlayerIDs(state)
  const lastRemainingPlayerID = activePlayerIDs[0] ?? currentPlayerID

  if (activePlayerIDs.length === 1) {
    markPlayerLeft(
      state,
      lastRemainingPlayerID,
      turnNumber,
      'Was the last player remaining, so left the game last.',
    )
  }

  finalizeGame(
    state,
    events,
    `${formatPlayerLabel(state, lastRemainingPlayerID)} is the last player remaining.`,
    turnNumber,
  )
}

function resolveRoundStart(state: BlowCowState, events: BlowCowEventsAPI, turnNumber: number) {
  const nextStartingPlayerID = resolveRoundStartLeaves(state, turnNumber)
  const activePlayerIDs = getActivePlayerIDs(state)

  if (activePlayerIDs.length === 0) {
    finalizeGame(
      state,
      events,
      'All remaining players had no cards in hand at the start of the round and left immediately.',
      turnNumber,
    )
    return null
  }

  if (activePlayerIDs.length <= 1) {
    finalizeGameForLastRemainingPlayer(state, events, nextStartingPlayerID ?? state.round.startingPlayerID, turnNumber)
    return null
  }

  return nextStartingPlayerID ?? activePlayerIDs[0] ?? null
}

function handleTurnStart({ G, ctx, events, random }: BlowCowHookContext) {
  if (G.gameStatus !== 'active') {
    return
  }

  const currentPlayerID = ctx.currentPlayer
  G.players[currentPlayerID].turnStartingDirection = G.round.direction
  // Stamped before anything below can end the turn again, because this is what tells `handleTurnEnd`
  // that a turn genuinely opened and so has a status counter to spend.
  G.round.startedTurnNumber = ctx.turn
  // The window on a direction tamper is the turn it happened in, so a new turn closes it. The tell
  // goes with it: every connected client has played the nudge by now, and a player who reconnects
  // later is not owed a replay of something they were meant to catch live.
  G.directionTamper = null
  G.directionFlip = null
  // Same one-turn window, and the same reason for closing it here. The two-second lock this record
  // arms is scoped to the turn as well, so a turn that has ended has nothing left to hold down.
  G.takeBackTamper = null
  // A conspiracy is paid off by the play it commits to, so one still standing here belongs to a turn
  // that ended some other way — an accusation resolving mid-turn, or a match restored mid-flight.
  G.conspiracy = null
  // An encore never outlives the turn that earned it, whether it was spent or simply not taken up.
  // This is the clearing site that matters; `beginNextRound` is belt and braces behind it.
  G.encore = null
  advanceMimicryReveal(G, currentPlayerID)
  /*
   * Manipulate's lock covers exactly one turn: the one it forced. Any turn that is not the forced
   * player's is proof that theirs has been and gone. Two turns in a row is not a case to worry
   * about — it would take every other player leaving, and the game ends before that.
   */
  if (G.round.forcedPlayPlayerID !== currentPlayerID) {
    G.round.forcedPlayPlayerID = null
  }
  G.players[currentPlayerID].matchStats.turnsInGame += 1
  ensureArchiveTurn(G, currentPlayerID, ctx.turn)
  revealPendingPlayAtTurnStart(G, currentPlayerID, ctx.turn, random?.Shuffle)
  appendTelemetryEvent(
    G,
    'turn',
    `${formatPlayerLabel(G, currentPlayerID)} turn started`,
    `Started the turn with ${G.players[currentPlayerID].hand.length} card(s) in hand.`,
    currentPlayerID,
    ctx.turn,
  )

  if (getPlayerState(G, currentPlayerID).hand.length === 0) {
    markPlayerLeft(G, currentPlayerID, ctx.turn)

    const activePlayerIDs = getActivePlayerIDs(G)
    if (activePlayerIDs.length <= 1) {
      finalizeGameForLastRemainingPlayer(G, events, currentPlayerID, ctx.turn)
      return
    }

    const nextActivePlayerID = getNextActivePlayerID(currentPlayerID, G.seatOrder, G.round.direction, activePlayerIDs)
    const nextPlayerID = G.round.trumpRank === null
      ? getDefaultStartingPlayerID(G, nextActivePlayerID)
      : nextActivePlayerID

    if (nextPlayerID) {
      if (G.round.trumpRank === null && G.round.startingPlayerID === currentPlayerID) {
        G.round.startingPlayerID = nextPlayerID
      }

      G.tableStatus = `${formatPlayerLabel(G, currentPlayerID)} left the game. ${formatPlayerLabel(G, nextPlayerID)} is next to act.`
      events.endTurn({ next: nextPlayerID })
    }
    return
  }

  updateRoundCapacity(G)
  G.tableStatus = buildTurnStatus(G, currentPlayerID)
}

/**
 * The status tick, and the only thing that hangs off `turn.onEnd`.
 *
 * It lives on the framework hook rather than in `advanceTurn` because a turn ends eleven different
 * ways here — a play, a pass, a BS or Reset resolution, an accusation, a Mimic seat swap, Manipulate,
 * a player leaving with an empty hand — and only two of them go through `advanceTurn`. `onEnd` is the
 * one place all of them meet.
 *
 * The `startedTurnNumber` guard is what keeps it honest. `startMatch` flips `gameStatus` to `active`
 * and *then* ends the staging turn to hand play to the first seat, so a gameStatus check alone would
 * charge that seat a turn they never took.
 */
function handleTurnEnd({ G, ctx }: BlowCowHookContext) {
  if (G.gameStatus !== 'active') {
    return
  }

  /*
   * Without the Status Rule the counters stay on screen and simply stop moving, so every status a
   * player is given is permanent. Read here rather than where a status is handed out, because the
   * rule can be torn up mid-match and a counter frozen at the moment of removal is the whole effect.
   */
  if (isRuleRemoved(G, 'status')) {
    return
  }

  if (G.round.startedTurnNumber !== ctx.turn) {
    return
  }

  tickPlayerStatuses(G, ctx.currentPlayer)
}

function advanceTurn(state: BlowCowState, events: BlowCowEventsAPI, currentPlayerID: string, turnNumber: number) {
  const activePlayerIDs = getActivePlayerIDs(state)
  if (activePlayerIDs.length <= 1) {
    finalizeGameForLastRemainingPlayer(state, events, currentPlayerID, turnNumber)
    return
  }

  const nextPlayerID = getNextActivePlayerID(currentPlayerID, state.seatOrder, state.round.direction, activePlayerIDs)
  if (nextPlayerID) {
    events.endTurn({ next: nextPlayerID })
  }
}

function validateCommonPlay(
  state: BlowCowState,
  playerID: string,
  currentPlayerID: string,
  cardIDs: string[],
  nextTrumpRank: BlowCowRank | null,
) {
  // Explicit because `turn.activePlayers` makes every seat framework-active; see the note there.
  if (currentPlayerID !== playerID) {
    return false
  }

  if (state.gameStatus !== 'active' || isProcedureRunning(state) || isFinalTwoResolutionTurn(state, playerID)) {
    return false
  }

  /*
   * Worried takes the Play action away, and this is the gate in front of all three moves that are
   * one — `play`, `selectTrumpAndPlay` and `playRandom`. It deliberately does not reach `sneakPlay`
   * or `takeBackCard`: those are cheats, not the action.
   */
  if (hasStatus(state, playerID, 'worried')) {
    return false
  }

  if (state.round.trumpRank === null && nextTrumpRank === null) {
    return false
  }

  if (state.round.trumpRank !== null && nextTrumpRank !== null) {
    return false
  }

  if (
    nextTrumpRank !== null
    && !isRuleRemoved(state, 'rankChange')
    && state.round.previousTrumpRank === nextTrumpRank
    && !canRepeatPreviousTrump(state, playerID, nextTrumpRank)
  ) {
    return false
  }

  if (cardIDs.length === 0) {
    return false
  }

  if (!canCheat(state, playerID) && cardIDs.length > 2) {
    return false
  }

  return canCheat(state, playerID)
    || isRuleRemoved(state, 'maxCardsOnTable')
    || getTableCardCount(state.table) + cardIDs.length <= state.round.maxCardsOnTable
}

type BlowCowPlayMode = 'manual' | 'random'

function performPlay(
  context: BlowCowMoveContext,
  cardIDs: string[],
  nextTrumpRank: BlowCowRank | null,
  playMode: BlowCowPlayMode = 'manual',
) {
  const { G, ctx, events, playerID } = context
  if (!validateCommonPlay(G, playerID, ctx.currentPlayer, cardIDs, nextTrumpRank)) {
    return INVALID_MOVE
  }

  /*
   * The only thing a conspiracy changes about a play is where the cards come from. It is still The
   * Mastermind's play in every other respect — it lands in front of them, it makes them the latest
   * non-passing player, and it is their name on the BS call that answers it. Emptying the target's
   * hand this way is legal and is part of the bargain: they leave at the start of their next turn
   * under the Leave Game Rule, which is a gift as often as it is a theft.
   */
  const conspiracy = getOpenConspiracy(G, playerID, ctx.turn)
  const handSourcePlayerID = conspiracy?.targetPlayerID ?? playerID

  /*
   * An encore buys one action and a play is the one thing it does not buy, so a second play on the
   * same turn is refused here rather than in `validateCommonPlay` — that helper has no turn number,
   * and the encore is scoped to a turn like the conspiracy above it.
   */
  if (getOpenEncore(G, playerID, ctx.turn)) {
    return INVALID_MOVE
  }

  /*
   * Both read before a card moves. `earnsEncore` because the play is what spends the round's use, and
   * the remembered target because the play is about to make this player the latest non-passing one —
   * see `BlowCowEncore`.
   */
  const earnsEncore = canEarnEncore(G, playerID)
  const encoreBSTargetPlayerID = earnsEncore ? getDefaultBSTargetPlayerID(G, playerID) : null

  const selectedCards = removeCardsFromPlayerHand(G, handSourcePlayerID, cardIDs)
  if (!selectedCards) {
    return INVALID_MOVE
  }

  const claimedRank = nextTrumpRank ?? G.round.trumpRank
  if (!claimedRank) {
    addCardsToPlayerHand(G, handSourcePlayerID, selectedCards, 'other', ctx.turn)
    return INVALID_MOVE
  }

  const declaredCardCount = getDeclaredCardCount(G, playerID, selectedCards.length)
  const usedRepeatTrump = canRepeatPreviousTrump(G, playerID, nextTrumpRank)
  // Only for labelling the archive action. The direction cheat itself is tracked on `directionTamper`
  // now that it is scoped to a turn rather than to a play, and can happen on a turn with no play.
  const usedDirectionChange = canCheat(G, playerID) && G.directionTamper?.playerID === playerID
  const usedExtraCardCount = canCheat(G, playerID) && selectedCards.length > declaredCardCount
  const usedExceededTableLimit = canCheat(G, playerID)
    && !isRuleRemoved(G, 'maxCardsOnTable')
    && getTableCardCount(G.table) + selectedCards.length > G.round.maxCardsOnTable
  const playerCharacter = G.players[playerID].character
  const playerMatchStats = G.players[playerID].matchStats
  const wasHonest = selectedCards.every((card) => isTrumpCardInMatch(G, card, claimedRank, playerCharacter))
    && !usedRepeatTrump
    && !usedExtraCardCount
    && !usedExceededTableLimit

  /*
   * Mad and Nervous judge the play by the same `wasHonest` the game judges every other play by, cheat
   * modifiers included: a Mad player who overfills the table has lied, and a Nervous one may not.
   *
   * Checked here rather than in `validateCommonPlay` because honesty cannot be read until the cards
   * are out of the hand and the cheat flags are settled, so the refusal puts them back the same way
   * the missing-rank branch above does. Neither status forces a play — a Mad player holding nothing
   * but trump cards simply has no legal play, and Pass, Call BS and Call Reset are all still open.
   */
  if ((hasStatus(G, playerID, 'mad') && wasHonest) || (hasStatus(G, playerID, 'nervous') && !wasHonest)) {
    addCardsToPlayerHand(G, handSourcePlayerID, selectedCards, 'other', ctx.turn)
    return INVALID_MOVE
  }

  playerMatchStats.playCount += 1
  playerMatchStats.cardsPlayed += selectedCards.length
  /*
   * A random play the Broken status forced still counts as this player having played by hand, because
   * the alternative is charging a Drunkard The Drunkard's leave penalty for a choice a status took
   * away from them.
   */
  if (playMode === 'manual' || hasStatus(G, playerID, 'broken')) {
    G.players[playerID].hasUsedManualPlay = true
  }
  if (!wasHonest) {
    playerMatchStats.lieCount += 1
  }

  /*
   * A random play is never announced. Nothing separates it from a manual one on the wire either —
   * the archive keeps `playMode` for the replay, and `hideSecretState` empties the archive before it
   * reaches a client — so the table cannot tell whether The Drunkard chose those cards or drew them.
   * That uncertainty is the whole ability: an announced random play would be a free tell.
   */
  createPlay(G, playerID, selectedCards, declaredCardCount, claimedRank, ctx.turn, nextTrumpRank !== null)
  G.round.trumpRank = nextTrumpRank ?? G.round.trumpRank
  // After `createPlay`, so a card sneaked in before the rank existed and the play that names it are
  // both settled against the same rank, in the order they reached the table.
  if (nextTrumpRank !== null) {
    settleUnclaimedPlays(G, nextTrumpRank)
  }
  G.round.status = 'inProgress'
  G.round.passStreak = 0
  G.round.lastNonPassingPlayerID = playerID
  // The debt the conspiracy created is paid. Clearing it here rather than at turn end is what stops
  // a second play in the same turn from reaching back into a hand that was opened once.
  if (conspiracy) {
    G.conspiracy = null
  }
  /*
   * So is the debt Manipulate created, and for the same reason. The lock only ever meant "you may not
   * pass instead of playing"; leaving it up until the next turn would take Pass off the encore below
   * from a player who has already done what it asked.
   */
  if (G.round.forcedPlayPlayerID === playerID) {
    G.round.forcedPlayPlayerID = null
  }

  // Read after the play has landed, because a table the play itself filled is one of the things that
  // makes an encore worth having.
  const takesEncore = earnsEncore && isEncoreWorthTaking(G, encoreBSTargetPlayerID)
  if (takesEncore) {
    G.players[playerID].hasUsedClownEncoreThisRound = true
    G.encore = {
      playerID,
      turnNumber: ctx.turn,
      bsTargetPlayerID: encoreBSTargetPlayerID,
    }
  }

  const conspiracyDetailSuffix = conspiracy
    ? ` The card(s) came out of ${formatPlayerLabel(G, conspiracy.targetPlayerID)}'s hand.`
    : ''
  // Announced, unlike most of what a play carries. The turn not ending is about to be visible to
  // everyone anyway, and an unexplained turn that refuses to move on reads as a stalled table.
  const encoreDetailSuffix = takesEncore
    ? ' The Clown keeps the turn and may take one more action, but not another play.'
    : ''
  const playDetail = nextTrumpRank !== null
    ? `Selected ${nextTrumpRank} as trump and placed ${declaredCardCount} card(s) face down.${conspiracyDetailSuffix}${encoreDetailSuffix}`
    : `Claimed ${claimedRank} and placed ${declaredCardCount} card(s) face down.${conspiracyDetailSuffix}${encoreDetailSuffix}`

  appendHistoryEvent(
    G,
    'action',
    `${formatPlayerLabel(G, playerID)} played ${declaredCardCount} card(s)`,
    playDetail,
    playerID,
    ctx.turn,
  )
  appendArchiveTurnAction(G, playerID, ctx.turn, {
    kind: 'play',
    detail: playDetail,
    characterUsed: conspiracy
      ? 'The Mastermind'
      // The character, not the play mode: the Broken status routes through the same random play and
      // is nobody's ability.
      : playMode === 'random' && isDrunkard(G, playerID)
      ? 'The Drunkard'
      // Still `isDreamer`, not `canCheat`: the field names the character behind the play, and once
      // the No Cheating Rule is gone the licence is nobody's character in particular.
      : isDreamer(G, playerID)
        && (usedRepeatTrump || usedDirectionChange || usedExtraCardCount || usedExceededTableLimit)
      ? 'The Dreamer'
      // Last in the chain only because a seat holds one character: nothing above this can also be
      // The Clown. The action the encore buys writes its own archive entry beside this one.
      : takesEncore
      ? 'The Clown'
      : null,
    // Whose hand the cards left, which for an ordinary play is nobody's business but the player's own.
    targetPlayerID: conspiracy?.targetPlayerID ?? null,
    cards: selectedCards,
    declaredCardCount,
    claimedRank,
    wasHonest,
    playMode,
    directionBefore: G.players[playerID].turnStartingDirection ?? G.round.direction,
    directionAfter: G.round.direction,
  })

  // The Clown's first play of the round is the one play that leaves the turn where it was.
  if (takesEncore) {
    G.tableStatus = buildTurnStatus(G, playerID)
    return
  }

  advanceTurn(G, events, playerID, ctx.turn)
}

/**
 * A play whose cards nobody chose. The Drunkard's ability, and — since the Broken status takes the
 * choice of card away rather than the action — the only route a Broken player has to the table.
 *
 * The two differ in exactly one thing: The Drunkard names how many cards to draw, and Broken always
 * sends one. The trump rank stays the player's own decision either way.
 */
function resolveDrunkardRandomPlay(
  context: BlowCowMoveContext,
  args?: BlowCowPlayRandomArgs,
) {
  const { G, ctx, playerID, random } = context
  const isBrokenStatusPlay = hasStatus(G, playerID, 'broken')

  // Guarded before the shuffle, not only inside `performPlay`, so an out-of-turn attempt cannot
  // burn a draw from the randomness plugin and shift every later shuffle in the match.
  if (ctx.currentPlayer !== playerID || !(isDrunkard(G, playerID) || isBrokenStatusPlay)) {
    return INVALID_MOVE
  }

  // Forced rather than validated, so a Broken client asking for two cards gets one instead of a
  // refusal it has no way to act on.
  const cardCount = isBrokenStatusPlay ? 1 : (args?.cardCount ?? 0)
  if (!Number.isInteger(cardCount) || cardCount <= 0) {
    return INVALID_MOVE
  }

  const randomCards = shuffleCards(G.players[playerID].hand, random?.Shuffle).slice(0, cardCount)
  if (randomCards.length !== cardCount) {
    return INVALID_MOVE
  }

  return performPlay(
    context,
    randomCards.map((card) => card.id),
    args?.trumpRank ?? null,
    'random',
  )
}

/**
 * Reaching into someone else's turn to put cards on the table. The Dreamer's alone while the No
 * Cheating Rule stands; anyone's once it falls.
 *
 * Deliberately not routed through `performPlay`: almost everything that move does is wrong here.
 * A sneaked play ends nobody's turn, claims no new trump, breaks no pass streak, does not become
 * the latest non-passing play, and — the point of it — is never announced. It writes no history
 * event and no telemetry, so no callout fires and whatever the Dreamer was already saying stays up.
 *
 * What it does not do is hide. The cards land face down in front of the Dreamer for everyone to
 * see, and their hand count drops to match; the cheat lives or dies on whether anyone was watching
 * a player who was not supposed to be acting. That is why nothing here is secret state.
 */
function resolveSneakPlay(
  context: BlowCowMoveContext,
  args?: BlowCowSneakPlayArgs,
) {
  const { G, ctx, playerID } = context
  const cardIDs = args?.cardIDs ?? []

  if (G.gameStatus !== 'active' || isProcedureRunning(G)) {
    return INVALID_MOVE
  }

  if (!canCheat(G, playerID) || G.players[playerID].hasLeft) {
    return INVALID_MOVE
  }

  // Reaching into another turn is the whole cheat. On their own turn the player just plays.
  if (ctx.currentPlayer === playerID) {
    return INVALID_MOVE
  }

  // Exactly one card: a handful appearing at once is the opposite of sleight of hand, and the whole
  // cheat rests on the table not noticing. A missing trump rank is no obstacle — see below.
  if (cardIDs.length !== 1) {
    return INVALID_MOVE
  }

  // One per turn. `createPlay` derives the play id from the round, turn and player, so a second
  // one would collide with the first, and the accusation window stays a single yes or no.
  if (getPlayForPlayerAtTurn(G, playerID, ctx.turn)) {
    return INVALID_MOVE
  }

  const selectedCards = removeCardsFromPlayerHand(G, playerID, cardIDs)
  if (!selectedCards) {
    return INVALID_MOVE
  }

  /*
   * The one route to the table that does not need a trump rank. A sneak claims nothing of its own —
   * it inherits whatever the round settles on — so before the rank is chosen there is simply nothing
   * to inherit yet, and `settleUnclaimedPlays` fills it in the moment somebody names one. Slipping a
   * card in before the round has a shape is the best moment for it, and refusing that was an
   * accident of the claim being written at play time rather than a rule anyone wanted.
   */
  const claimedRank = G.round.trumpRank
  const playerMatchStats = G.players[playerID].matchStats
  // Honesty needs a rank to be measured against. With none yet, the judgement waits for the settle.
  const wasHonest = claimedRank === null
    ? null
    : selectedCards.every((card) => isTrumpCardInMatch(G, card, claimedRank, G.players[playerID].character))

  playerMatchStats.playCount += 1
  playerMatchStats.cardsPlayed += selectedCards.length
  if (wasHonest === false) {
    playerMatchStats.lieCount += 1
  }

  createPlay(G, playerID, selectedCards, selectedCards.length, claimedRank, ctx.turn, false, {
    skipPendingReveal: true,
  })

  const claimDetail = claimedRank === null
    ? 'claiming nothing yet, since the round has no trump rank'
    : `claiming ${claimedRank}`
  // Archive only. `hideSecretState` empties the archive before it reaches a client, so this is the
  // one record that can name the cheat without handing the accusation to everyone at the table.
  appendArchiveTurnAction(G, playerID, ctx.turn, {
    kind: 'play',
    detail: `Slipped ${formatCardLabel(selectedCards[0])} onto the table during ${formatPlayerLabel(G, ctx.currentPlayer)}'s turn, ${claimDetail}. Accuse can catch this until that turn ends.`,
    characterUsed: isDreamer(G, playerID) ? 'The Dreamer' : null,
    cards: selectedCards,
    declaredCardCount: selectedCards.length,
    claimedRank,
    wasHonest: wasHonest ?? undefined,
    playMode: 'manual',
    directionBefore: G.round.direction,
    directionAfter: G.round.direction,
  })
}

/**
 * Palming a card back off the table. The Dreamer's alone while the No Cheating Rule stands; anyone's
 * once it falls.
 *
 * The mirror image of `sneakPlay`, and it shares that move's silence for the same reason: it writes
 * no history event and no telemetry, so no callout fires and nothing announces it. What the table
 * gets instead is the gap. The card is gone from the block and the hand count has gone up to match,
 * for everyone to see — the cheat lives or dies on whether anybody was watching a pile they had
 * already read and stopped thinking about.
 *
 * Legal on any turn, the cheat's own included, which is what makes the lock necessary rather than
 * decorative. Doing this and then immediately ending your own turn would close the accusation window
 * in the same breath as opening it, so `takeBackTamper` goes back to its owner alone and their client
 * grounds itself for two seconds. That is a client-side pause by construction: a deadline in `G`
 * would have to be a wall clock, and a wall clock in `G` is not replayable.
 *
 * Unlimited, and deliberately so — each one re-arms the pause, so a player emptying their whole
 * revealed pile spends the turn doing it in full view rather than getting a free raid.
 */
function resolveTakeBackCard(
  context: BlowCowMoveContext,
  args?: BlowCowTakeBackCardArgs,
) {
  const { G, ctx, playerID } = context

  if (G.gameStatus !== 'active' || isProcedureRunning(G)) {
    return INVALID_MOVE
  }

  if (!canCheat(G, playerID) || G.players[playerID].hasLeft) {
    return INVALID_MOVE
  }

  const targetCardID = args?.cardID ?? null
  if (!targetCardID) {
    return INVALID_MOVE
  }

  /*
   * Your own pile only. Reaching into somebody else's would be a different cheat with a different
   * tell — their hand count would not move to match — and nothing in the accusation window
   * distinguishes the two, so the one that is written on the card is the only one allowed.
   */
  const targetPlay = G.table.plays.find((play) => play.playerID === playerID
    && play.cards.some((card) => card.id === targetCardID))
  const targetCard = targetPlay?.cards.find((card) => card.id === targetCardID)

  // Face up and nothing else. A face-down card is still a live claim that BS can be called on, and
  // palming one would let a player answer a challenge by deleting the evidence rather than hiding it.
  if (!targetPlay || !targetCard || !isCardFaceUpOnTable(targetPlay, targetCardID)) {
    return INVALID_MOVE
  }

  targetPlay.cards = targetPlay.cards.filter((card) => card.id !== targetCardID)
  targetPlay.revealedCardIDs = (targetPlay.revealedCardIDs ?? []).filter((cardID) => cardID !== targetCardID)
  targetPlay.rehiddenCardIDs = (targetPlay.rehiddenCardIDs ?? []).filter((cardID) => cardID !== targetCardID)

  /*
   * A play with nothing left in it is dropped rather than kept as an empty shell. `getLatestPlayForPlayer`
   * and The Pawn's En Passant both walk `table.plays` by position, so leaving one behind would put a
   * play that is no longer on the table between two that are.
   *
   * `pendingRevealPlayID` needs no clearing alongside it. Only face-up cards can be palmed, so a play
   * can only empty out once every card in it is face up — and by then the pointer has been dropped
   * by the reveal that turned them, whether that was the whole play or The Spy's single card.
   */
  if (targetPlay.cards.length === 0) {
    G.table.plays = G.table.plays.filter((play) => play.id !== targetPlay.id)
  }

  // Scored like any other way a card reaches a hand, so palming back the fourth of a rank pays out.
  addCardsToPlayerHand(G, playerID, [targetCard], 'other', ctx.turn)

  G.takeBackTamper = {
    id: `takeback-${G.round.roundNumber}-${ctx.turn}-${playerID}-${targetCardID}`,
    playerID,
    turnNumber: ctx.turn,
  }

  /*
   * Archive only, exactly as `sneakPlay` is. `hideSecretState` empties the archive before it reaches
   * a client, so this is the one record that can name the card without handing the table the
   * accusation. `tableStatus` is deliberately left alone too: rewriting it would re-announce the
   * cheat in prose, and the next turn to begin rebuilds it anyway.
   */
  appendArchiveTurnAction(G, playerID, ctx.turn, {
    kind: 'takeBackCard',
    detail: `Took ${formatCardLabel(targetCard)} back off the table during ${formatPlayerLabel(G, ctx.currentPlayer)}'s turn. Accuse can catch this until that turn ends.`,
    characterUsed: isDreamer(G, playerID) ? 'The Dreamer' : null,
    cards: [targetCard],
  })
}

function resolveCatHideCard(
  context: BlowCowMoveContext,
  args?: BlowCowCatHideCardArgs,
) {
  const { G, ctx, playerID } = context
  if (G.gameStatus !== 'active' || isProcedureRunning(G) || ctx.currentPlayer !== playerID) {
    return INVALID_MOVE
  }

  if (!isCat(G, playerID)) {
    return INVALID_MOVE
  }

  const targetCardID = args?.cardID ?? null
  if (!targetCardID) {
    return INVALID_MOVE
  }

  const targetPlay = G.table.plays.find((play) => play.cards.some((card) => card.id === targetCardID))
  const targetCard = targetPlay?.cards.find((card) => card.id === targetCardID)

  if (!targetPlay || !targetCard || !isCardFaceUpOnTable(targetPlay, targetCardID)) {
    return INVALID_MOVE
  }

  targetPlay.rehiddenCardIDs = [...new Set([...(targetPlay.rehiddenCardIDs ?? []), targetCardID])]
  // Deliberately silent in the log. The card visibly flips for everyone anyway, so a history line
  // only adds noise; the archive still records the flip for the replay.
  appendArchiveTurnAction(G, playerID, ctx.turn, {
    kind: 'hideTableCard',
    detail: `Flipped ${formatCardLabel(targetCard)} face down on the table.`,
    characterUsed: 'The Cat',
    cards: [targetCard],
  })
  G.tableStatus = buildTurnStatus(G, playerID)
}

/**
 * The Seeker trades their card in for any other one still going spare.
 *
 * Deliberately not turn-bound. The choice is made once, at the start of the match, and whoever
 * happens to be on the clock then is nobody's business but the shuffle's — binding it to their own
 * turn would freeze the table until The Seeker looked at their screen, which is the one thing this
 * ability must not do. It is still refused while a resolution is running, like every other move, so
 * a character cannot change underneath a procedure that has already been decided.
 *
 * There is no deadline. A choice that expired would take the ability away from an unlucky player
 * rather than from a slow one, and the pick is public the moment it lands either way.
 */
function resolveSeekerCharacterChoice(
  context: BlowCowMoveContext,
  args?: BlowCowSeekCharacterArgs,
) {
  const { G, ctx, playerID } = context
  if (G.gameStatus !== 'active' || isProcedureRunning(G)) {
    return INVALID_MOVE
  }

  const player = G.players[playerID]
  if (!player || player.hasLeft || !isSeeker(G, playerID)) {
    return INVALID_MOVE
  }

  const requestedCharacterName = args?.characterName
  if (
    !isImplementedCharacterName(requestedCharacterName)
    || !getSeekerCharacterChoices(G, playerID).includes(requestedCharacterName)
  ) {
    return INVALID_MOVE
  }

  player.character = requestedCharacterName
  player.seekerPickedCharacter = requestedCharacterName

  appendHistoryEvent(
    G,
    'action',
    `${formatPlayerLabel(G, playerID)} used The Seeker`,
    `Took ${requestedCharacterName} from the character pool.`,
    playerID,
    ctx.turn,
  )
  appendArchiveTurnAction(G, playerID, ctx.turn, {
    kind: 'seekCharacter',
    detail: `Took ${requestedCharacterName} from the character pool.`,
    characterUsed: 'The Seeker',
  })
}

/**
 * The Broken tears one rule card out of the match.
 *
 * Not turn-bound, for the same reason The Seeker's pick is not: the choice belongs to the start of
 * the match, and making the table wait on one player's screen is the one thing a start-of-game
 * ability must not do. The consequence is real and deliberate — a rule can vanish mid-turn, so every
 * enforcement site reads `G.rules` at the moment it runs rather than caching a decision.
 *
 * Refused while a resolution is running, so a procedure that has already been decided cannot have
 * its own rules pulled out from under it half-way through.
 */
function resolveBrokenRuleRemoval(
  context: BlowCowMoveContext,
  args?: BlowCowBreakRuleArgs,
) {
  const { G, ctx, playerID } = context
  if (G.gameStatus !== 'active' || isProcedureRunning(G)) {
    return INVALID_MOVE
  }

  const player = G.players[playerID]
  if (!player || player.hasLeft || !canBreakRule(G, playerID)) {
    return INVALID_MOVE
  }

  const requestedRuleID = args?.ruleID
  if (!isBlowCowRuleID(requestedRuleID) || !getBreakableRuleIDs(G).includes(requestedRuleID)) {
    return INVALID_MOVE
  }

  const ruleTitle = getRuleDefinition(requestedRuleID).title
  G.rules[requestedRuleID] = 'removed'
  player.brokenRemovedRuleID = requestedRuleID

  appendHistoryEvent(
    G,
    'action',
    `${formatPlayerLabel(G, playerID)} used The Broken`,
    `Removed the ${ruleTitle} from the game. ${getRuleDefinition(requestedRuleID).removedDescription ?? ''}`.trim(),
    playerID,
    ctx.turn,
  )
  appendArchiveTurnAction(G, playerID, ctx.turn, {
    kind: 'breakRule',
    detail: `Removed the ${ruleTitle} from the game.`,
    characterUsed: 'The Broken',
  })
  G.tableStatus = `${ruleTitle} was removed from this match by The Broken.`
}

/** The line the log adds under a Defy, in its own alarmed style. Destroying a rule should feel wrong. */
export const DEFY_HISTORY_OMEN = 'Your defiance has corrupted the game!'

/**
 * The Prototype destroys a heart out of their own hand and a rule card off the table of rules.
 *
 * Turn-bound and explicitly free: it costs the turn nothing, so the player still acts afterwards.
 * That is why this never touches `pendingRevealPlayID`, the pass streak, or the turn — the only
 * things it moves are the hand, the rules, and the once-a-round flag.
 *
 * The rule is drawn rather than chosen, so unlike The Broken the target is the shuffle's business.
 * Emptying the hand here is legal and is often the point: a player with no cards leaves at the start
 * of their next turn under the Leave Game Rule, which this action does not need to duplicate.
 */
function resolveDefy(
  context: BlowCowMoveContext,
  args?: BlowCowDefyArgs,
) {
  const { G, ctx, playerID, random } = context
  if (G.gameStatus !== 'active' || isProcedureRunning(G) || ctx.currentPlayer !== playerID) {
    return INVALID_MOVE
  }

  if (!canUseDefy(G, playerID)) {
    return INVALID_MOVE
  }

  const targetCardID = args?.cardID
  if (typeof targetCardID !== 'string') {
    return INVALID_MOVE
  }

  // Checked before anything is removed, so a card of the wrong suit refuses the whole action rather
  // than leaving the hand short of a card the rule card never asked for.
  const targetCard = G.players[playerID].hand.find((card) => card.id === targetCardID)
  if (!targetCard || !isDefyDestroyableCard(targetCard)) {
    return INVALID_MOVE
  }

  const destroyableRuleIDs = getBreakableRuleIDs(G)
  const destroyedRuleID = shuffleCards([...destroyableRuleIDs], random?.Shuffle)[0]

  const destroyedCards = removeCardsFromPlayerHand(G, playerID, [targetCardID])
  if (!destroyedCards) {
    return INVALID_MOVE
  }

  const destroyedCard = destroyedCards[0]
  const ruleTitle = getRuleDefinition(destroyedRuleID).title
  G.rules[destroyedRuleID] = 'removed'
  G.players[playerID].hasUsedDefyThisRound = true

  /*
   * The rule is named and the card is not. Which rule died is everybody's business — it changes the
   * game they are all playing — but the card came out of a hidden hand, and naming it would hand the
   * table a free look at cards nobody paid to see. The archive still records which card it was.
   */
  appendHistoryEvent(
    G,
    'action',
    `${formatPlayerLabel(G, playerID)} used The Prototype`,
    `Destroyed a card from hand and the ${ruleTitle}. ${getRuleDefinition(destroyedRuleID).removedDescription ?? ''}`.trim(),
    playerID,
    ctx.turn,
    DEFY_HISTORY_OMEN,
  )
  appendArchiveTurnAction(G, playerID, ctx.turn, {
    kind: 'defy',
    detail: `Destroyed ${formatCardLabel(destroyedCard)} from hand and the ${ruleTitle}.`,
    characterUsed: 'The Prototype',
    cards: [destroyedCard],
  })
  G.tableStatus = buildTurnStatus(G, playerID)
}

/**
 * The Mastermind opening another player's hand, and committing to playing out of it.
 *
 * Deliberately not a peek. Conspire spends itself the moment it lands and leaves the turn with
 * exactly one legal move — `play`, or `selectTrumpAndPlay` before the round has a trump — so the
 * information and the obligation arrive together. `pass`, `callBS` and `callReset` all refuse while
 * it stands, which is why the table-room check happens here rather than being discovered afterwards:
 * opening a hand that cannot be played out of would strand the turn with nothing legal left.
 *
 * The conspiracy itself is public, because the victim's hand is about to shrink for reasons nothing
 * else on the table would explain. What their cards actually are stays between them and The
 * Mastermind — see `hideSecretState`.
 */
function resolveConspire(
  context: BlowCowMoveContext,
  args?: BlowCowConspireArgs,
) {
  const { G, ctx, playerID } = context
  if (G.gameStatus !== 'active' || isProcedureRunning(G) || ctx.currentPlayer !== playerID) {
    return INVALID_MOVE
  }

  if (!canConspire(G, playerID) || isFinalTwoResolutionTurn(G, playerID)) {
    return INVALID_MOVE
  }

  // Room for the smallest play the conspiracy can end in. Anything larger is the play's own problem,
  // and `validateCommonPlay` still checks it.
  if (!isRuleRemoved(G, 'maxCardsOnTable') && getTableCardCount(G.table) >= G.round.maxCardsOnTable) {
    return INVALID_MOVE
  }

  const targetPlayerID = args?.targetPlayerID
  if (typeof targetPlayerID !== 'string' || !getConspiracyTargetPlayerIDs(G, playerID).includes(targetPlayerID)) {
    return INVALID_MOVE
  }

  G.conspiracy = {
    playerID,
    targetPlayerID,
    turnNumber: ctx.turn,
  }
  G.players[playerID].hasUsedConspireThisRound = true

  appendHistoryEvent(
    G,
    'action',
    `${formatPlayerLabel(G, playerID)} used The Mastermind`,
    `Opened ${formatPlayerLabel(G, targetPlayerID)}'s hand. This turn's play comes out of it.`,
    playerID,
    ctx.turn,
  )
  appendArchiveTurnAction(G, playerID, ctx.turn, {
    kind: 'conspire',
    detail: `Opened ${formatPlayerLabel(G, targetPlayerID)}'s hand and must play out of it this turn.`,
    characterUsed: 'The Mastermind',
    targetPlayerID,
    // The whole hand as it stood when it was opened: the archive is the only record of what The
    // Mastermind actually got to see, and `hideSecretState` empties it before any client reads it.
    cards: cloneCards(G.players[targetPlayerID].hand),
  })
  G.tableStatus = buildTurnStatus(G, playerID)
}

/**
 * The Mime taking their next player's face, and half the time their chair with it.
 *
 * Every number copied here is frozen rather than mirrored, and the two halves of the ability are why.
 * After Mimic the two seats hold identical blocks, and the table's whole job is to work out which of
 * them moved. The turn always belongs to the block in The Mime's old chair — either they kept it, or
 * they handed it over by moving out of it — so that block acts either way, and the illusion holds
 * only while a copied number changes exactly as often as the real one behind it.
 *
 * A frozen count does that, because the board subtracts The Mime's own plays from it. If the coin
 * said stay, The Mime plays and their copy loses those cards; if it said swap, the source plays and
 * their real count loses them while the untouched copy sits in the other chair. Either way one block
 * ends up short and the other does not, and both cases look the same from the outside. A live mirror
 * would give the answer away instead: the shared number would track the source, so it would move on a
 * swap and stand still without one. The borrowed pile works the same way, one card at a time.
 *
 * The seat trade is a real trade — `seatOrder` and both `seatIndex` values — so turn order, the ring
 * and every "Seat N" label follow it. The labels are what makes it invisible: `seatIndex` stays with
 * the chair rather than the player, so nothing on the board or in the log renames itself.
 */
function resolveMimic(context: BlowCowMoveContext) {
  const { G, ctx, events, playerID, random } = context
  if (G.gameStatus !== 'active' || isProcedureRunning(G) || ctx.currentPlayer !== playerID) {
    return INVALID_MOVE
  }

  if (!canMimic(G, playerID) || isFinalTwoResolutionTurn(G, playerID)) {
    return INVALID_MOVE
  }

  const sourcePlayerID = getMimicryTargetPlayerID(G, playerID)
  if (!sourcePlayerID) {
    return INVALID_MOVE
  }

  const source = getPlayerState(G, sourcePlayerID)
  // Read before the chairs can move, so the archive names the seat the copy was taken from rather
  // than the one its owner ended up in.
  const sourceLabel = formatPlayerLabel(G, sourcePlayerID)
  const borrowedPlays = G.table.plays.filter((play) => play.playerID === sourcePlayerID)
  G.mimicry = {
    playerID,
    sourcePlayerID,
    turnNumber: ctx.turn,
    character: source.character,
    points: source.points,
    pointRanks: source.scoredSets.map((scoredSet) => scoredSet.rank),
    handCount: source.hand.length,
    wasSeekerPick: source.seekerPickedCharacter !== null,
    statuses: getPlayerStatuses(G, source.id).map((status) => ({ ...status })),
    borrowedPlayIDs: borrowedPlays.map((play) => play.id),
    hiddenPlayIDs: G.table.plays.filter((play) => play.playerID === playerID).map((play) => play.id),
    borrowedFaceDownCardIDs: borrowedPlays.flatMap((play) => getFaceDownCardsForPlay(play)).map((card) => card.id),
    revealedPlayerIDs: [],
    pendingHandoverPlayerID: null,
  }
  G.players[playerID].hasUsedMimicThisRound = true

  // Shuffled rather than drawn as a number, because `Shuffle` is the only randomness this game takes
  // and mixing in a second source would shift every later shuffle in the match.
  const hasSwapped = shuffleCards([true, false], random?.Shuffle)[0] ?? false
  if (hasSwapped) {
    swapSeatPositions(G, playerID, sourcePlayerID)
    // The turn is about to be handed to the source, and that arrival is the one that must not count.
    G.mimicry.pendingHandoverPlayerID = sourcePlayerID
  }

  /*
   * Anonymous, and the only history event in the game that is. Naming the seat would answer the one
   * question the ability exists to ask — and it could not even be phrased, since by the time this
   * line is written the two seat labels may have changed hands. The archive records the truth; it is
   * emptied before any client sees it.
   */
  appendHistoryEvent(
    G,
    'action',
    'Mimic',
    'Two seats now look alike. One of them is The Mime, and only they know whether the chairs moved with the faces.',
    null,
    ctx.turn,
  )
  appendArchiveTurnAction(G, playerID, ctx.turn, {
    kind: 'mimic',
    detail: hasSwapped
      ? `Copied ${sourceLabel} and swapped seats with them, handing them the turn.`
      : `Copied ${sourceLabel} and kept both the seat and the turn.`,
    characterUsed: 'The Mime',
    targetPlayerID: sourcePlayerID,
  })

  if (hasSwapped) {
    // The chairs moved, so the turn stays where it was: the source now sits in it. Nothing here
    // touches `passStreak` or `lastNonPassingPlayerID` — no cards moved and nobody passed, so the
    // player being handed the turn inherits exactly the table the mover was looking at.
    events.endTurn({ next: sourcePlayerID })
    return
  }

  G.tableStatus = buildTurnStatus(G, playerID)
}

/**
 * Trades two players' chairs. `seatIndex` is the index of the player in `seatOrder`, and both move
 * together so the invariant holds — which is what keeps every "Seat N" label attached to a position
 * on the ring rather than to a player, and so what stops the trade from announcing itself.
 */
function swapSeatPositions(state: BlowCowState, playerID: string, otherPlayerID: string) {
  const seatIndex = state.seatOrder.indexOf(playerID)
  const otherSeatIndex = state.seatOrder.indexOf(otherPlayerID)
  if (seatIndex === -1 || otherSeatIndex === -1) {
    return
  }

  state.seatOrder[seatIndex] = otherPlayerID
  state.seatOrder[otherSeatIndex] = playerID
  state.players[playerID].seatIndex = otherSeatIndex
  state.players[otherPlayerID].seatIndex = seatIndex
}

/**
 * The Invisible Hand setting a round up and then handing it to somebody else to open.
 *
 * All three of the round's opening decisions in one move: the trump rank, the direction, and who
 * takes the first turn. It ends the mover's turn without a play, which is why nothing here touches
 * `lastNonPassingPlayerID` — there are no cards on the table to challenge, and leaving that pointer
 * null is what keeps `Call BS` unavailable to the player being handed the turn.
 *
 * The chosen player is left with a single legal action. Only `Pass` is explicitly taken from them,
 * because on the first turn of a round nothing has been played and nothing is on the table, so
 * `Call BS` and `Call Reset` are already unavailable on their own terms.
 */
function resolveManipulate(
  context: BlowCowMoveContext,
  args?: BlowCowManipulateArgs,
) {
  const { G, ctx, events, playerID } = context
  if (G.gameStatus !== 'active' || isProcedureRunning(G) || ctx.currentPlayer !== playerID) {
    return INVALID_MOVE
  }

  if (!canManipulate(G, playerID)) {
    return INVALID_MOVE
  }

  const targetPlayerID = args?.targetPlayerID
  if (typeof targetPlayerID !== 'string' || !getManipulationTargetPlayerIDs(G, playerID).includes(targetPlayerID)) {
    return INVALID_MOVE
  }

  const trumpRank = args?.trumpRank
  if (!isBlowCowRank(trumpRank) || !getManipulableTrumpRanks(G).includes(trumpRank)) {
    return INVALID_MOVE
  }

  const direction = args?.direction
  if (!isBlowCowDirection(direction)) {
    return INVALID_MOVE
  }

  const directionBefore = G.round.direction
  G.round.trumpRank = trumpRank
  // Manipulate puts nothing on the table, but it is still the moment the round gets a rank, so any
  // card sneaked in before it settles against the rank this player just chose.
  settleUnclaimedPlays(G, trumpRank)
  G.round.direction = direction
  G.round.status = 'inProgress'
  G.round.startingPlayerID = targetPlayerID
  G.round.forcedPlayPlayerID = targetPlayerID

  const detail = `Set the trump rank to ${trumpRank}, the direction to ${direction}, and handed the round to ${formatPlayerLabel(G, targetPlayerID)}, who must play.`
  appendHistoryEvent(
    G,
    'action',
    `${formatPlayerLabel(G, playerID)} used The Invisible Hand`,
    detail,
    playerID,
    ctx.turn,
  )
  appendArchiveTurnAction(G, playerID, ctx.turn, {
    kind: 'manipulate',
    detail,
    characterUsed: 'The Invisible Hand',
    targetPlayerID,
    claimedRank: trumpRank,
    directionBefore,
    directionAfter: direction,
  })

  events.endTurn({ next: targetPlayerID })
}

/**
 * The Cat's legal flip and the illegal one share this move, and deliberately share the same
 * silence: no history event at all. A cheat may reach into any player's turn, so a log line naming
 * the player would tell everyone exactly who to accuse and the cheat would be worth nothing — and a
 * line naming only the cheats would be the same giveaway in reverse, since an unattributed flip
 * could then only be The Cat's. The archive, which `hideSecretState` strips before any client
 * sees it, still records who really did it.
 *
 * What the log does not carry, `G.directionFlip` gives back as a body movement rather than a
 * sentence: every flip nudges its author's block toward the hub, so a player watching the table sees
 * who reached for the sign. That is the tell, and it stops there — it names the hand, never the
 * verdict, and it leaves nothing behind for anyone who was looking elsewhere to read afterwards.
 */
function resolveToggleDirection(
  context: BlowCowMoveContext,
) {
  const { G, ctx, playerID } = context
  if (G.gameStatus !== 'active' || isProcedureRunning(G)) {
    return INVALID_MOVE
  }

  const usedCat = isCat(G, playerID)
  const mayCheat = canCheat(G, playerID)
  if (!usedCat && !mayCheat) {
    return INVALID_MOVE
  }

  // The Cat is still bound to their own turn. A cheat is not, which is the whole power.
  if (!mayCheat && ctx.currentPlayer !== playerID) {
    return INVALID_MOVE
  }

  if (G.players[playerID].hasLeft) {
    return INVALID_MOVE
  }

  const directionBefore = G.round.direction
  G.round.direction = toggleDirection(G.round.direction)

  /*
   * The Cat's own turn is the only flip the rules allow, so everything else is a tamper —
   * including The Cat reaching into somebody else's turn once the No Cheating Rule is gone.
   *
   * Measured against the direction the *current* turn opened on, not the flipper's own last turn,
   * because the accusation window is that turn. Flipping back within the same turn erases the tamper
   * along with the advantage, exactly as it did when this was scoped to a play.
   */
  const isLegalFlip = usedCat && ctx.currentPlayer === playerID
  if (!isLegalFlip) {
    const turnStartingDirection = G.players[ctx.currentPlayer]?.turnStartingDirection ?? null
    G.directionTamper = turnStartingDirection !== null && G.round.direction !== turnStartingDirection
      ? { playerID, turnNumber: ctx.turn }
      : null
  }

  /*
   * Telemetry only. A flip writes no history event at all, so nothing about it reaches the in-game
   * log — the arrow in the hub and the nudge on the flipper's block are the whole announcement, and
   * a player who was not looking at the table missed it. The telemetry line stays anonymous anyway,
   * because telemetry is not stripped by `hideSecretState` and a named one would be readable.
   */
  appendTelemetryEvent(
    G,
    'action',
    'The turn direction changed',
    `The turn direction is now ${G.round.direction}.`,
    null,
    ctx.turn,
  )
  // After the telemetry event, so the length it reads from is one nobody has used before. Every flip
  // needs its own id — flipping back and forth within a turn is a legitimate thing to do.
  G.directionFlip = { id: `flip-${G.round.roundNumber}-${ctx.turn}-${G.telemetry.events.length}`, playerID }
  appendArchiveTurnAction(G, playerID, ctx.turn, {
    kind: 'toggleDirection',
    detail: isLegalFlip
      ? `Changed the direction to ${G.round.direction}.`
      : `Changed the direction to ${G.round.direction} during ${formatPlayerLabel(G, ctx.currentPlayer)}'s turn. Accuse can catch this until that turn ends.`,
    characterUsed: usedCat ? 'The Cat' : isDreamer(G, playerID) ? 'The Dreamer' : null,
    directionBefore,
    directionAfter: G.round.direction,
  })
  G.tableStatus = buildTurnStatus(G, ctx.currentPlayer)
}

function resolveForeignerPassCard(
  context: BlowCowMoveContext,
  foreignerCardCode: string | null | undefined,
) {
  const { G, ctx, playerID } = context
  const parsedCard = parseForeignerCardCode(foreignerCardCode)

  if (!parsedCard.isValid) {
    return INVALID_MOVE
  }

  if (!parsedCard.cardSpec) {
    return null
  }

  if (G.players[playerID].character !== 'The Foreigner') {
    return INVALID_MOVE
  }

  const outsideCard = createForeignerOutsideCard(playerID, ctx.turn, parsedCard.cardSpec)
  const scoredSets = addCardsToPlayerHand(G, playerID, [outsideCard], 'other', ctx.turn, { deferPointHistory: true })
  appendHistoryEvent(
    G,
    'action',
    `${formatPlayerLabel(G, playerID)} used The Foreigner`,
    `Added ${formatCardLabel(outsideCard)} from outside the game to hand.`,
    playerID,
    ctx.turn,
  )
  appendArchiveTurnAction(G, playerID, ctx.turn, {
    kind: 'gainOutsideCard',
    detail: `Added ${formatCardLabel(outsideCard)} from outside the game to hand.`,
    characterUsed: 'The Foreigner',
    cards: [outsideCard],
  })
  appendPointHistoryEvents(G, playerID, scoredSets, ctx.turn)

  return outsideCard
}

function returnCardsAfterAllPass(context: BlowCowMoveContext) {
  const { G, ctx, events, playerID } = context
  const cardsByOwner = collectTableCardsByOwner(G)
  const returnedCardsByPlayer = createCardsByPlayerRecord(cardsByOwner.entries())
  const scoredSetsByOwner = new Map<string, BlowCowScoredSet[]>()

  for (const [ownerPlayerID, cards] of cardsByOwner.entries()) {
    if (!G.players[ownerPlayerID].hasLeft) {
      scoredSetsByOwner.set(
        ownerPlayerID,
        addCardsToPlayerHand(G, ownerPlayerID, cards, 'roundReturn', ctx.turn, { deferPointHistory: true }),
      )
    }
  }

  appendHistoryEvent(
    G,
    'action',
    `${formatPlayerLabel(G, playerID)} passed`,
    'Everyone passed, so the round ended and each active player took back their own cards.',
    playerID,
    ctx.turn,
  )
  appendArchiveTurnAction(G, playerID, ctx.turn, {
    kind: 'roundReturn',
    detail: 'Everyone passed, so each active player took back their own cards.',
    resetKind: 'roundReturn',
    cardsByPlayer: returnedCardsByPlayer,
  })
  for (const [ownerPlayerID, scoredSets] of scoredSetsByOwner.entries()) {
    appendPointHistoryEvents(G, ownerPlayerID, scoredSets, ctx.turn)
  }
  beginNextRound(
    G,
    playerID,
    `${formatPlayerLabel(G, playerID)} passed last. A new round begins with the direction reversed.`,
  )

  const nextStartingPlayerID = resolveRoundStart(G, events, ctx.turn)
  if (nextStartingPlayerID) {
    events.endTurn({ next: nextStartingPlayerID })
  }
}

function resolveBS(context: BlowCowMoveContext, args?: BlowCowCallBSArgs) {
  const { G, ctx, playerID } = context
  // Call BS is still strictly a turn action, unlike Accuse.
  if (G.gameStatus !== 'active' || isProcedureRunning(G) || ctx.currentPlayer !== playerID) {
    return INVALID_MOVE
  }

  // An open conspiracy owes the table a play. See `resolveConspire`.
  if (getOpenConspiracy(G, playerID, ctx.turn)) {
    return INVALID_MOVE
  }

  const resolvedTarget = resolveBSTargetSelection(G, playerID, args?.targetPlayerID)
  const trumpRank = G.round.trumpRank

  if (!resolvedTarget || !trumpRank) {
    return INVALID_MOVE
  }

  const { targetPlayerID, targetPlay, usedGrandmasterBSOverride, usedPawnEnPassant, pawnTriggerPlayerID } = resolvedTarget

  if (usedGrandmasterBSOverride) {
    G.players[playerID].hasUsedGrandmasterBSOverride = true
    appendHistoryEvent(
      G,
      'action',
      `${formatPlayerLabel(G, playerID)} used The Grandmaster`,
      `Called BS on ${formatPlayerLabel(G, targetPlayerID)} even though they were not the latest non-passing player.`,
      playerID,
      context.ctx.turn,
    )
  }

  if (usedPawnEnPassant && pawnTriggerPlayerID) {
    appendHistoryEvent(
      G,
      'action',
      `${formatPlayerLabel(G, playerID)} used The Pawn`,
      `Used En Passant to call BS on ${formatPlayerLabel(G, targetPlayerID)} because ${formatPlayerLabel(G, pawnTriggerPlayerID)} just played 2 cards.`,
      playerID,
      context.ctx.turn,
    )
  }

  G.players[playerID].matchStats.callBSCount += 1
  clearMimicry(G)
  G.bsResolution = createBSResolution(G, playerID, targetPlayerID, targetPlay, trumpRank)
  G.tableStatus = `${formatPlayerLabel(G, playerID)} called BS on ${formatPlayerLabel(G, targetPlayerID)}. Resolving the table.`
  appendArchiveTurnAction(G, playerID, context.ctx.turn, {
    kind: 'callBS',
    detail: `Called BS on ${formatPlayerLabel(G, targetPlayerID)}.`,
    characterUsed: usedGrandmasterBSOverride
      ? 'The Grandmaster'
      : usedPawnEnPassant
      ? 'The Pawn'
      : null,
    targetPlayerID,
    usedGrandmasterBSOverride,
    usedPawnEnPassant,
    pawnTriggerPlayerID,
  })
  appendTelemetryEvent(
    G,
    'action',
    `${formatPlayerLabel(G, playerID)} called BS`,
    `Challenged ${formatPlayerLabel(G, targetPlayerID)} before the hidden play was resolved.`,
    playerID,
    context.ctx.turn,
  )
}

/**
 * Accusing a player of cheating. Unlike `callBS` this is not bound to the accuser's turn — anyone may
 * raise it at any time, which is the point: the cheats it catches happen on other people's turns.
 * What bounds it instead is the per-round budget and the narrow window each cheat stays catchable
 * for, both checked here. One accusation per round each, whether the table holds one licensed cheat
 * or every player at it.
 *
 * The accusation resolves immediately and publicly. A hit freezes the table until the accuser presses
 * Punish; a miss freezes it only for as long as the client takes to play the denial, then hands the
 * turn back untouched.
 */
function resolveAccuseDreamer(context: BlowCowMoveContext, args?: BlowCowAccuseDreamerArgs) {
  const { G, ctx, playerID } = context
  const targetPlayerID = args?.targetPlayerID ?? null

  if (G.gameStatus !== 'active' || isProcedureRunning(G)) {
    return INVALID_MOVE
  }

  if (!targetPlayerID || targetPlayerID === playerID || !G.players[targetPlayerID] || G.players[targetPlayerID].hasLeft) {
    return INVALID_MOVE
  }

  // Characters are public — every seat shows its own character card, and `hideSecretState` does not
  // mask `character` — so naming somebody with no licence to cheat was never a gamble, only a wasted
  // accusation. Refused outright rather than resolved as a miss, so it costs nothing. What stays a
  // gamble is the part that is genuinely hidden: whether they have actually cheated yet. Once the No
  // Cheating Rule is gone this refuses nobody, and every seat at the table is worth naming.
  if (!canCheat(G, targetPlayerID)) {
    return INVALID_MOVE
  }

  if (G.players[playerID].hasLeft || G.players[playerID].hasUsedAccusationThisRound) {
    return INVALID_MOVE
  }

  /*
   * The one thing that closes the accusation window for its owner. An accusation ends the round, and
   * `beginNextRound` clears the conspiracy with it — so without this, The Mastermind could open a
   * hand, read it, and then accuse their way out of the play they committed to.
   */
  if (getOpenConspiracy(G, playerID, ctx.turn)) {
    return INVALID_MOVE
  }

  const caughtCheat = getAccusableCheat(G, targetPlayerID, ctx.currentPlayer, ctx.turn)
  const wasSuccessful = caughtCheat !== null

  G.players[playerID].hasUsedAccusationThisRound = true
  G.players[playerID].matchStats.accusationCount += 1
  if (wasSuccessful) {
    G.players[playerID].matchStats.accusationWinCount += 1
  }

  clearMimicry(G)
  G.accusation = {
    id: `accuse-${G.round.roundNumber}-${ctx.turn}-${playerID}-${targetPlayerID}`,
    accuserPlayerID: playerID,
    targetPlayerID,
    wasSuccessful,
    caughtCheat,
    punishmentCardCount: getTableCardCount(G.table),
    // Naming someone falsely costs the same as being caught, so an accusation is a real gamble
    // rather than a free question.
    punishedPlayerID: wasSuccessful ? targetPlayerID : playerID,
    unpunishedPlayerID: wasSuccessful ? playerID : targetPlayerID,
    isPunishing: false,
  }
  G.tableStatus = buildTurnStatus(G, ctx.currentPlayer)
  appendArchiveTurnAction(G, playerID, ctx.turn, {
    kind: 'accuse',
    detail: wasSuccessful
      ? `Accused ${formatPlayerLabel(G, targetPlayerID)} of cheating and caught them: they ${getDreamerCheatDescription(caughtCheat)}.`
      : `Accused ${formatPlayerLabel(G, targetPlayerID)} of cheating and missed.`,
    targetPlayerID,
    wasHonest: !wasSuccessful,
  })
  appendTelemetryEvent(
    G,
    'action',
    `${formatPlayerLabel(G, playerID)} accused ${formatPlayerLabel(G, targetPlayerID)}`,
    wasSuccessful ? 'The accusation landed.' : 'The accusation missed.',
    playerID,
    ctx.turn,
  )
}

function getDrivableAccusation(context: BlowCowMoveContext, accusationID: string) {
  const { G, playerID } = context

  if (G.gameStatus !== 'active' || !G.accusation || G.accusation.id !== accusationID) {
    return null
  }

  return playerID === G.accusation.accuserPlayerID ? G.accusation : null
}

/**
 * Arms the punishment travel on every client, for the same reason `beginBSPunishment` does: the
 * animation measures the front-card elements of cards that `finalizeAccusation` is about to clear
 * off the table.
 */
function beginAccusationPunishment(
  context: BlowCowMoveContext,
  args?: BlowCowBeginAccusationPunishmentArgs,
) {
  const accusation = args ? getDrivableAccusation(context, args.accusationID) : null

  // Armed on a miss too: the accuser presses Punish on their own block and takes the cards.
  if (!accusation || accusation.isPunishing) {
    return INVALID_MOVE
  }

  accusation.isPunishing = true
  context.G.tableStatus = buildTurnStatus(context.G, context.ctx.currentPlayer)
}

function finalizeAccusation(context: BlowCowMoveContext, args?: BlowCowFinalizeAccusationArgs) {
  const { G, ctx, events } = context
  const accusation = args ? getDrivableAccusation(context, args.accusationID) : null

  if (!accusation || !accusation.isPunishing) {
    return INVALID_MOVE
  }

  const { accuserPlayerID, targetPlayerID, caughtCheat, punishedPlayerID, unpunishedPlayerID } = accusation
  // Both endings take the whole table and end the round; only who takes it differs. A caught cheat
  // keeps the direction they forced — being punished is the whole consequence.
  const punishmentCards = getAllTableCards(G)
  const punishmentLabels = punishmentCards.map((card) => formatCardLabel(card))
  const verdictDetail = caughtCheat
    ? `${formatPlayerLabel(G, targetPlayerID)} ${getDreamerCheatDescription(caughtCheat)}.`
    : `${formatPlayerLabel(G, targetPlayerID)} broke no rule, so the false accusation cost ${formatPlayerLabel(G, accuserPlayerID)} the table.`
  const punishmentScoredSets = addCardsToPlayerHand(
    G,
    punishedPlayerID,
    punishmentCards,
    'punishment',
    ctx.turn,
    { deferPointHistory: true },
  )

  G.players[punishedPlayerID].matchStats.punishmentCount += 1
  G.players[punishedPlayerID].wasPunishedThisRound = true
  G.accusation = null

  appendHistoryEvent(
    G,
    'verdict',
    accusation.wasSuccessful
      ? `${formatPlayerLabel(G, accuserPlayerID)} caught ${formatPlayerLabel(G, targetPlayerID)} cheating`
      : `${formatPlayerLabel(G, accuserPlayerID)} wrongly accused ${formatPlayerLabel(G, targetPlayerID)}`,
    verdictDetail,
    accusation.wasSuccessful ? targetPlayerID : accuserPlayerID,
    ctx.turn,
  )
  appendHistoryEvent(
    G,
    'punishment',
    `${formatPlayerLabel(G, punishedPlayerID)} took ${punishmentCards.length} card(s)`,
    punishmentCards.length > 0
      ? `Took ${punishmentLabels.join(', ')}.`
      : 'The table was empty, so there was nothing to take.',
    punishedPlayerID,
    ctx.turn,
  )
  appendArchiveTurnAction(G, accuserPlayerID, ctx.turn, {
    kind: 'resolveAccusation',
    detail: verdictDetail,
    targetPlayerID,
    cards: punishmentCards,
    cardsByPlayer: createCardsByPlayerRecord([[punishedPlayerID, punishmentCards]]),
    wasHonest: !accusation.wasSuccessful,
    punishedPlayerID,
    unpunishedPlayerID,
  })
  appendPointHistoryEvents(G, punishedPlayerID, punishmentScoredSets, ctx.turn)

  beginNextRound(
    G,
    unpunishedPlayerID,
    `${verdictDetail} ${formatPlayerLabel(G, unpunishedPlayerID)} starts the next round.`,
  )

  const nextStartingPlayerID = resolveRoundStart(G, events, ctx.turn)
  if (nextStartingPlayerID) {
    events.endTurn({ next: nextStartingPlayerID })
  }
}

/**
 * Shared entry guard for every interactive reveal move. Only the caller drives a procedure, and by
 * design there is no timeout fallback — a caller who drops recovers through the same-name rejoin
 * route rather than the table auto-advancing without them.
 */
function getDrivableResolution<Resolution extends { id: string; callerPlayerID: string }>(
  context: BlowCowMoveContext,
  resolution: Resolution | null,
  resolutionID: string,
) {
  if (context.G.gameStatus !== 'active' || !resolution || resolution.id !== resolutionID) {
    return null
  }

  return context.playerID === resolution.callerPlayerID ? resolution : null
}

/**
 * Flips one face-down card in the focused player's area. Shared by both procedures: the caller
 * clicks a card, the server writes the table play's own reveal state, and every client picks the
 * flip up through `playerView` and the existing reveal watcher.
 */
function resolveRevealTableCard(
  context: BlowCowMoveContext,
  walk: BlowCowRevealWalk & { callerPlayerID: string },
  cardID: string,
) {
  const { G } = context
  const play = G.table.plays.find((tablePlay) => tablePlay.cards.some((card) => card.id === cardID))

  if (!play || play.playerID !== getRevealFocusedPlayerID(walk) || isCardFaceUpOnTable(play, cardID)) {
    return INVALID_MOVE
  }

  play.revealedCardIDs = [...new Set([...(play.revealedCardIDs ?? []), cardID])]
  // A Cat-rehidden card stays face down until it leaves that set too, so flipping must clear both.
  play.rehiddenCardIDs = (play.rehiddenCardIDs ?? []).filter((rehiddenCardID) => rehiddenCardID !== cardID)
  G.tableStatus = buildTurnStatus(G, walk.callerPlayerID)
}

/**
 * Confirms the focused player's step. Only legal once they have nothing left face down, so the
 * Continue button is server-authoritative rather than trusted from the caller's client.
 */
function resolveAdvanceReveal(
  context: BlowCowMoveContext,
  walk: BlowCowRevealWalk & { callerPlayerID: string },
) {
  const { G } = context
  const focusedPlayerID = getRevealFocusedPlayerID(walk)

  if (!focusedPlayerID || getFaceDownTableCardsForPlayer(G, focusedPlayerID).length > 0) {
    return INVALID_MOVE
  }

  walk.revealStepIndex += 1
  G.tableStatus = buildTurnStatus(G, walk.callerPlayerID)
}

function revealBSCard(context: BlowCowMoveContext, args?: BlowCowRevealBSCardArgs) {
  const resolution = args ? getDrivableResolution(context, context.G.bsResolution, args.resolutionID) : null

  if (!args || !resolution || resolution.isPunishing || isRevealComplete(resolution)) {
    return INVALID_MOVE
  }

  return resolveRevealTableCard(context, resolution, args.cardID)
}

function advanceBSReveal(context: BlowCowMoveContext, args?: BlowCowAdvanceBSRevealArgs) {
  const resolution = args ? getDrivableResolution(context, context.G.bsResolution, args.resolutionID) : null

  if (!resolution || resolution.isPunishing || isRevealComplete(resolution)) {
    return INVALID_MOVE
  }

  return resolveAdvanceReveal(context, resolution)
}

function revealResetCard(context: BlowCowMoveContext, args?: BlowCowRevealResetCardArgs) {
  const resolution = args ? getDrivableResolution(context, context.G.resetResolution, args.resolutionID) : null

  if (!args || !resolution || isRevealComplete(resolution)) {
    return INVALID_MOVE
  }

  return resolveRevealTableCard(context, resolution, args.cardID)
}

function advanceResetReveal(context: BlowCowMoveContext, args?: BlowCowAdvanceResetRevealArgs) {
  const resolution = args ? getDrivableResolution(context, context.G.resetResolution, args.resolutionID) : null

  if (!resolution || isRevealComplete(resolution)) {
    return INVALID_MOVE
  }

  return resolveAdvanceReveal(context, resolution)
}

/**
 * Arms the punishment travel animation on every client. It is separate from `finalizeBSResolution`
 * because that move empties `G.table.plays`, and the animation measures the front-card elements
 * those cards render. It also makes the travel survive a reconnect: a client that remounts with
 * `isPunishing` set replays it and re-arms the finalize.
 */
function beginBSPunishment(context: BlowCowMoveContext, args?: BlowCowBeginBSPunishmentArgs) {
  const { G } = context
  const resolution = args ? getDrivableResolution(context, G.bsResolution, args.resolutionID) : null

  if (!resolution || resolution.isPunishing || !isRevealComplete(resolution)) {
    return INVALID_MOVE
  }

  if (G.table.plays.some((play) => getFaceDownCardsForPlay(play).length > 0)) {
    return INVALID_MOVE
  }

  resolution.isPunishing = true
  G.tableStatus = buildTurnStatus(G, resolution.callerPlayerID)
}

/**
 * The Gambler's counterpart to `beginBSPunishment`, and it splits from `finalizeResetResolution` for
 * the same reason: the travel animation measures front-card elements that the finalize deletes.
 *
 * Unlike the BS one it carries a choice. A tie leaves several equally weak hands, and rather than
 * picking for the caller the server offers all of them and takes whichever Punish button was pressed
 * — so the target is validated against `weakestPlayerIDs` here, and nowhere else.
 */
function beginResetPunishment(context: BlowCowMoveContext, args?: BlowCowBeginResetPunishmentArgs) {
  const { G } = context
  const resolution = args ? getDrivableResolution(context, G.resetResolution, args.resolutionID) : null
  const showdown = resolution?.showdown ?? null

  if (!resolution || !showdown || showdown.isPunishing || !isRevealComplete(resolution)) {
    return INVALID_MOVE
  }

  if (G.table.plays.some((play) => getFaceDownCardsForPlay(play).length > 0)) {
    return INVALID_MOVE
  }

  if (!args || !showdown.weakestPlayerIDs.includes(args.punishedPlayerID)) {
    return INVALID_MOVE
  }

  showdown.isPunishing = true
  showdown.punishedPlayerID = args.punishedPlayerID
  G.tableStatus = buildTurnStatus(G, resolution.callerPlayerID)
}

function finalizeBSResolution(
  context: BlowCowMoveContext,
  args?: BlowCowFinalizeBSResolutionArgs,
) {
  const { G, ctx, events, playerID } = context
  const resolution = G.bsResolution

  if (!resolution || (args?.resolutionID && resolution.id !== args.resolutionID)) {
    return INVALID_MOVE
  }

  const { targetVerdict, punishment } = resolution

  if (
    playerID !== resolution.callerPlayerID
    || !isRevealComplete(resolution)
    || !targetVerdict
    || !punishment
  ) {
    return INVALID_MOVE
  }

  // Rebuilt from the table rather than carried on the resolution, which holds no card faces so that
  // `hideSecretState` has nothing to leak. This runs before `beginNextRound` clears the table.
  const targetPlayCards = G.table.plays.find((play) => play.id === resolution.targetPlayID)?.cards ?? []
  const additionalRevealPlays: BlowCowBSRevealPlay[] = G.table.plays
    .filter((play) => play.id !== resolution.targetPlayID && resolution.revealOrder.includes(play.playerID))
    .map((play) => ({
      playID: play.id,
      playerID: play.playerID,
      cards: play.cards,
    }))
  const punishmentCards = getAllTableCards(G)
  const punishmentLabels = punishmentCards.map((card) => formatCardLabel(card))
  const revealedTargetLabels = targetPlayCards.map((card) => formatCardLabel(card))
  const targetCharacter = G.players[resolution.targetPlayerID]?.character ?? null
  const targetLiedAboutCards = targetPlayCards.some((card) => !isTrumpCardInMatch(G, card, resolution.trumpRank, targetCharacter))
  const reverseRuleReason = punishment.reverseRuleTriggered
    ? `Four or more ${resolution.trumpRank}s were on the table`
    : isRuleRemoved(G, 'reverse')
    ? 'The Reverse Rule is not in play'
    : `Fewer than four ${resolution.trumpRank}s were on the table`
  const contrarianReason = punishment.contrarianTriggered
    ? `, and ${formatPlayerLabel(G, resolution.callerPlayerID)} is The Contrarian`
    : ''
  // Both layers reverse, so two of them cancel. The line names the reasons and then the net result
  // rather than narrating a flip that was immediately undone.
  const outcomeDetail = punishment.reverseRuleTriggered !== Boolean(punishment.contrarianTriggered)
    ? `${reverseRuleReason}${contrarianReason}, so the punishment was reversed.`
    : `${reverseRuleReason}${contrarianReason}, so the default punishment stood.`
  const cardLieDetail = targetLiedAboutCards
    ? ' The hidden play was not all trump.'
    : ''
  const verdictDetail = targetVerdict.targetWasHonest
    ? `${formatPlayerLabel(G, resolution.targetPlayerID)} was honest. ${outcomeDetail}`
    : `${formatPlayerLabel(G, resolution.targetPlayerID)} was dishonest.${cardLieDetail} ${outcomeDetail}`
  const punishmentScoredSets = addCardsToPlayerHand(
    G,
    punishment.punishedPlayerID,
    punishmentCards,
    'punishment',
    ctx.turn,
    { deferPointHistory: true },
  )

  G.players[punishment.punishedPlayerID].matchStats.punishmentCount += 1
  G.players[punishment.punishedPlayerID].wasPunishedThisRound = true
  if (punishment.unpunishedPlayerID === resolution.callerPlayerID) {
    G.players[resolution.callerPlayerID].matchStats.bsWinCount += 1
  }

  appendHistoryEvent(
    G,
    'action',
    `${formatPlayerLabel(G, resolution.callerPlayerID)} called BS on ${formatPlayerLabel(G, resolution.targetPlayerID)}`,
    'Ended the round immediately and forced the hidden plays to be revealed.',
    resolution.callerPlayerID,
    ctx.turn,
  )
  appendHistoryEvent(
    G,
    'verdict',
    `BS verdict on ${formatPlayerLabel(G, resolution.targetPlayerID)}`,
    verdictDetail,
    resolution.targetPlayerID,
    ctx.turn,
  )
  appendHistoryEvent(
    G,
    'punishment',
    `${formatPlayerLabel(G, punishment.punishedPlayerID)} took ${punishmentCards.length} card(s)`,
    `Took ${punishmentLabels.join(', ')}. Revealed play: ${revealedTargetLabels.join(', ')}.`,
    punishment.punishedPlayerID,
    ctx.turn,
  )
  appendArchiveTurnAction(G, resolution.callerPlayerID, ctx.turn, {
    kind: 'resolveBS',
    detail: `${verdictDetail} Revealed in order: ${resolution.revealOrder.map((revealPlayerID) => formatPlayerLabel(G, revealPlayerID)).join(', ')}.`,
    targetPlayerID: resolution.targetPlayerID,
    cards: targetPlayCards,
    cardsByPlayer: createCardsByPlayerRecord([
      [punishment.punishedPlayerID, punishmentCards],
    ]),
    declaredCardCount: resolution.targetDeclaredCardCount,
    claimedRank: resolution.trumpRank,
    wasHonest: targetVerdict.targetWasHonest,
    punishedPlayerID: punishment.punishedPlayerID,
    unpunishedPlayerID: punishment.unpunishedPlayerID,
    additionalRevealPlays,
  })
  appendPointHistoryEvents(G, punishment.punishedPlayerID, punishmentScoredSets, ctx.turn)

  beginNextRound(
    G,
    punishment.unpunishedPlayerID,
    `BS resolved. ${formatPlayerLabel(G, punishment.unpunishedPlayerID)} starts the next round.`,
  )

  const nextStartingPlayerID = resolveRoundStart(G, events, ctx.turn)
  if (nextStartingPlayerID) {
    events.endTurn({ next: nextStartingPlayerID })
  }
}

function resolveReset(context: BlowCowMoveContext) {
  const { G, ctx, playerID } = context
  if (G.gameStatus !== 'active' || isProcedureRunning(G) || ctx.currentPlayer !== playerID || getTableCardCount(G.table) < G.round.maxCardsOnTable) {
    return INVALID_MOVE
  }

  // An open conspiracy owes the table a play. See `resolveConspire`.
  if (getOpenConspiracy(G, playerID, ctx.turn)) {
    return INVALID_MOVE
  }

  G.players[playerID].matchStats.resetCount += 1

  clearMimicry(G)
  G.resetResolution = createResetResolution(G, playerID, 'reset')
  // Routed through the shared builder so the showdown wording lives in one place.
  G.tableStatus = buildTurnStatus(G, playerID)

  const callDetail = G.resetResolution.showdown
    ? 'Marked the table for a Gambler showdown at the current turn.'
    : 'Marked the table for redistribution at the current turn.'

  appendArchiveTurnAction(G, playerID, context.ctx.turn, {
    kind: 'callReset',
    detail: callDetail,
    resetKind: 'reset',
    cards: getAllTableCards(G),
  })
  appendTelemetryEvent(
    G,
    'action',
    `${formatPlayerLabel(G, playerID)} called Reset`,
    callDetail,
    playerID,
    context.ctx.turn,
  )
}

/**
 * The Gambler's ending for a Reset. Nothing is shuffled and nothing is dealt: the weakest hand takes
 * the whole table, the way a lost BS call does.
 *
 * The caller still opens the next round, exactly as the Call Reset Rule says — the showdown replaces
 * the redistribution and leaves the rest of the rule alone. That is deliberately true even when the
 * caller is the one who just took the table, which is the risk in calling a Reset with a weak pile
 * in front of you.
 */
function resolveResetShowdown(
  context: BlowCowMoveContext,
  resolution: BlowCowResetResolution,
  showdown: BlowCowResetShowdown,
) {
  const { G, ctx, events } = context
  const punishedPlayerID = showdown.punishedPlayerID

  // Only reachable if a client somehow finalized without pressing Punish, which would otherwise hand
  // the table to nobody and clear it.
  if (!punishedPlayerID || !G.players[punishedPlayerID]) {
    return INVALID_MOVE
  }

  const punishmentCards = getAllTableCards(G)
  const punishmentLabels = punishmentCards.map((card) => formatCardLabel(card))
  const standingsDetail = showdown.standings
    .map((standing) => `${formatPlayerLabel(G, standing.playerID)}: ${standing.handLabel}`)
    .join('; ')
  // Naming the tie matters: it is the one point where the outcome was the caller's choice rather
  // than the cards', and the log is the only place that distinction survives.
  const tieDetail = showdown.weakestPlayerIDs.length > 1
    ? ` ${showdown.weakestPlayerIDs.map((playerID) => formatPlayerLabel(G, playerID)).join(' and ')} tied for weakest, so ${formatPlayerLabel(G, resolution.callerPlayerID)} chose.`
    : ''
  const punishmentScoredSets = addCardsToPlayerHand(
    G,
    punishedPlayerID,
    punishmentCards,
    'punishment',
    ctx.turn,
    { deferPointHistory: true },
  )

  G.players[punishedPlayerID].matchStats.punishmentCount += 1
  G.players[punishedPlayerID].wasPunishedThisRound = true

  appendHistoryEvent(
    G,
    'action',
    `${formatPlayerLabel(G, resolution.callerPlayerID)} called Reset`,
    'The Gambler turned it into a showdown, so the weakest hand took the table instead of it being redistributed.',
    resolution.callerPlayerID,
    ctx.turn,
  )
  appendHistoryEvent(
    G,
    'verdict',
    'Reset showdown',
    `${standingsDetail}.${tieDetail}`,
    punishedPlayerID,
    ctx.turn,
  )
  appendHistoryEvent(
    G,
    'punishment',
    `${formatPlayerLabel(G, punishedPlayerID)} took ${punishmentCards.length} card(s)`,
    punishmentCards.length > 0
      ? `Took ${punishmentLabels.join(', ')}.`
      : 'The table was empty.',
    punishedPlayerID,
    ctx.turn,
  )
  appendArchiveTurnAction(G, resolution.callerPlayerID, ctx.turn, {
    kind: 'resolveReset',
    detail: `The Gambler's showdown. ${standingsDetail}.${tieDetail}`,
    characterUsed: 'The Gambler',
    resetKind: 'reset',
    cards: punishmentCards,
    cardsByPlayer: createCardsByPlayerRecord([[punishedPlayerID, punishmentCards]]),
    punishedPlayerID,
  })
  appendPointHistoryEvents(G, punishedPlayerID, punishmentScoredSets, ctx.turn)

  beginNextRound(
    G,
    resolution.callerPlayerID,
    `${formatPlayerLabel(G, punishedPlayerID)} had the weakest hand and took the table. ${formatPlayerLabel(G, resolution.callerPlayerID)} starts the next round.`,
  )

  const nextStartingPlayerID = resolveRoundStart(G, events, ctx.turn)
  if (nextStartingPlayerID) {
    events.endTurn({ next: nextStartingPlayerID })
  }
}

function finalizeResetResolution(
  context: BlowCowMoveContext,
  args?: BlowCowFinalizeResetResolutionArgs,
) {
  const { G, ctx, events, playerID, random } = context
  const resolution = G.resetResolution

  if (
    !resolution
    || (args?.resolutionID && resolution.id !== args.resolutionID)
    || resolution.callerPlayerID !== playerID
    || !isRevealComplete(resolution)
  ) {
    return INVALID_MOVE
  }

   if (resolution.kind === 'roundReturn') {
    return returnCardsAfterAllPass(context)
  }

  if (resolution.showdown) {
    return resolveResetShowdown(context, resolution, resolution.showdown)
  }

  const tableCards = shuffleCards(getAllTableCards(G), random?.Shuffle)
  const activePlayerIDs = getActivePlayerIDs(G)
  const callerFirstPlayerIDs = [
    resolution.callerPlayerID,
    ...activePlayerIDs.filter((activePlayerID) => activePlayerID !== resolution.callerPlayerID),
  ]
  const cardsPerPlayer = Math.floor(tableCards.length / activePlayerIDs.length)
  const extraCardCount = tableCards.length % activePlayerIDs.length
  const scoredSetsByPlayer = new Map<string, BlowCowScoredSet[]>()
  const redistributedCardsByPlayer: Record<string, BlowCowCard[]> = {}
  let cardIndex = 0

  for (const activePlayerID of callerFirstPlayerIDs) {
    const nextCards = tableCards.slice(cardIndex, cardIndex + cardsPerPlayer)
    cardIndex += cardsPerPlayer
    redistributedCardsByPlayer[activePlayerID] = cloneCards(nextCards)
    scoredSetsByPlayer.set(
      activePlayerID,
      addCardsToPlayerHand(G, activePlayerID, nextCards, 'reset', ctx.turn, { deferPointHistory: true }),
    )
  }

  if (extraCardCount > 0) {
    const extraCards = tableCards.slice(cardIndex, cardIndex + extraCardCount)
    const extraScoredSets = addCardsToPlayerHand(
      G,
      resolution.callerPlayerID,
      extraCards,
      'reset',
      ctx.turn,
      { deferPointHistory: true },
    )
    redistributedCardsByPlayer[resolution.callerPlayerID] = [
      ...(redistributedCardsByPlayer[resolution.callerPlayerID] ?? []),
      ...cloneCards(extraCards),
    ]
    scoredSetsByPlayer.set(resolution.callerPlayerID, [
      ...(scoredSetsByPlayer.get(resolution.callerPlayerID) ?? []),
      ...extraScoredSets,
    ])
  }

  appendHistoryEvent(
    G,
    'action',
    `${formatPlayerLabel(G, resolution.callerPlayerID)} called Reset`,
    'The table was shuffled and redistributed across the active players.',
    resolution.callerPlayerID,
    ctx.turn,
  )
  appendArchiveTurnAction(G, resolution.callerPlayerID, ctx.turn, {
    kind: 'resolveReset',
    detail: 'The table was shuffled and redistributed across the active players.',
    resetKind: 'reset',
    cardsByPlayer: redistributedCardsByPlayer,
  })
  for (const activePlayerID of callerFirstPlayerIDs) {
    appendPointHistoryEvents(G, activePlayerID, scoredSetsByPlayer.get(activePlayerID) ?? [], ctx.turn)
  }
  beginNextRound(
    G,
    resolution.callerPlayerID,
    `${formatPlayerLabel(G, resolution.callerPlayerID)} called Reset and starts the next round.`,
  )

  const nextStartingPlayerID = resolveRoundStart(G, events, ctx.turn)
  if (nextStartingPlayerID) {
    events.endTurn({ next: nextStartingPlayerID })
  }
}

function hideSecretState(state: BlowCowState, playerID: string | null) {
  /*
   * The one hand a player may see that is not their own. Scoped to the conspirator's view alone, so
   * the table learns that a hand was opened without learning what was in it, and it closes the
   * moment the conspiracy is paid off by the play. `playerID` is null for the spectator view, and a
   * conspiracy always names a seat, so no unseated viewer can match this.
   */
  const conspiracy = state.conspiracy?.playerID === playerID ? state.conspiracy : null

  const nextPlayers = Object.fromEntries(
    Object.entries(state.players).map(([targetPlayerID, player]) => [
      targetPlayerID,
      {
        ...player,
        hand: playerID === targetPlayerID || conspiracy?.targetPlayerID === targetPlayerID
          ? player.hand
          : player.hand.map((card) => createHiddenCard(card)),
        /*
         * The Drunkard's random plays are unannounced, and this flag is the one field that would
         * answer the question the silence exists to keep open. Forced rather than removed, so the
         * shape stays the same for every seat, and safe to force because it is read only by the
         * leave check on the server — no client has ever looked at it.
         */
        hasUsedManualPlay: playerID === targetPlayerID ? player.hasUsedManualPlay : false,
      },
    ]),
  ) as Record<string, BlowCowPlayerState>

  // The verdict is the outcome, so masking the card faces alone would not hide anything. Each half
  // unlocks only once the caller has actually revealed enough of the table to have earned it, and
  // `revealOrder[0]` is always the accused, so index >= 1 means their step is confirmed.
  const nextBSResolution = state.bsResolution === null
    ? null
    : {
        ...state.bsResolution,
        targetVerdict: state.bsResolution.revealStepIndex >= 1 ? state.bsResolution.targetVerdict : null,
        punishment: isRevealComplete(state.bsResolution) ? state.bsResolution.punishment : null,
      }

  /*
   * The showdown ranks hands that are still face down when the Reset is called, so publishing it
   * early would name the loser before the table could see why — the same leak `punishment` above is
   * held back for. Nulled rather than removed, so every client sees the same shape throughout; that a
   * Reset is a showdown at all is public from the start, because everyone can see The Gambler's seat.
   */
  const nextResetResolution = state.resetResolution === null
    ? null
    : {
        ...state.resetResolution,
        showdown: isRevealComplete(state.resetResolution) ? state.resetResolution.showdown ?? null : null,
      }

  return {
    ...state,
    archive: createEmptyArchiveState(),
    bsResolution: nextBSResolution,
    resetResolution: nextResetResolution,
    /*
     * The rest of the disguise is public — it is what every client draws one block from — but this
     * one field is the coin flip written down, since only a swap ever sets it. It is consumed inside
     * the update that sets it, so it should never be here at all; nulling it means that staying true
     * does not rest on that.
     */
    mimicry: state.mimicry ? { ...state.mimicry, pendingHandoverPlayerID: null } : null,
    // Never leaves the server. Everyone watches the direction indicator flip, and `directionFlip`
    // deliberately does go out, saying whose hand did it — but whether that hand was entitled to is
    // the gamble an accusation takes, and the tamper record is that answer written down.
    directionTamper: null,
    /*
     * Stripped from everyone except the player it names, which is the one asymmetry in this function
     * and the reason `BlowCowTakeBackTamper` documents itself so heavily. Nobody else may hold it —
     * an opponent with this record would be checking the answer instead of gambling an accusation.
     * Its owner may, because they cannot accuse themselves and already know what they did, and their
     * client is the only one that has to act on it: the two-second lock is theirs to serve.
     */
    takeBackTamper: state.takeBackTamper?.playerID === playerID ? state.takeBackTamper : null,
    players: nextPlayers,
    table: {
      plays: state.table.plays.map((play) => ({
        ...play,
        // No resolution-wide exemption: both BS and Reset now open the table one card at a time,
        // through the caller writing `revealedCardIDs`. Flipping everything face up the moment a
        // resolution started would give the answer away before anyone had turned a card.
        cards: play.cards.map((card) => {
          const isVisible = !getRehiddenCardIDSet(play).has(card.id)
            && (
              play.playerID === playerID
              || play.revealedAtTurn !== null
              || getRevealedCardIDSet(play).has(card.id)
            )

          return isVisible ? card : createHiddenCard(card)
        }),
      })),
    },
  }
}

function createStagedBlowCowState(
  numPlayers: number,
  shuffle?: BlowCowShuffle,
  setupData?: BlowCowSetupData,
): BlowCowState {
  const normalizedPlayerCount = Math.min(
    BLOW_COW_MAX_PLAYERS,
    Math.max(BLOW_COW_MIN_PLAYERS, numPlayers),
  )
  const deckConfig = resolveDeckConfig(normalizedPlayerCount, setupData, shuffle)
  const speedMultiplier = resolveSpeedMultiplier(setupData)
  const useCharacters = resolveUseCharacters(setupData)
  const characterPool = useCharacters ? resolveCharacterPool(setupData) : []
  const rules = resolveRules(setupData)
  const initialStatuses = resolveInitialStatuses(setupData)
  const initialStatusTurns = resolveInitialStatusTurns(setupData)
  const seatOrder = createSeatOrder(normalizedPlayerCount)
  const hostPlayerID = seatOrder[0] ?? '0'
  const history: BlowCowHistoryEvent[] = []
  const state = {
    tableStatus: `Waiting for the host to start the game once all ${normalizedPlayerCount} seat(s) are filled.`,
    gameStatus: 'staging',
    hostPlayerID,
    deckConfig,
    speedMultiplier,
    useCharacters,
    characterPool,
    rules,
    initialStatuses,
    initialStatusTurns,
    seatOrder,
    players: Object.fromEntries(
      seatOrder.map((playerID, seatIndex) => [playerID, createEmptyPlayerState(playerID, seatIndex)]),
    ) as Record<string, BlowCowPlayerState>,
    round: {
      roundNumber: 1,
      status: 'awaitingTrumpSelection',
      direction: 'counterclockwise',
      startingPlayerID: hostPlayerID,
      pendingStartingPlayerID: null,
      trumpRank: null,
      previousTrumpRank: null,
      passStreak: 0,
      lastNonPassingPlayerID: null,
      forcedPlayPlayerID: null,
      startedTurnNumber: null,
      maxCardsOnTable: getMaxCardsOnTable(normalizedPlayerCount),
    },
    table: {
      plays: [],
    },
    bsResolution: null,
    resetResolution: null,
    accusation: null,
    directionTamper: null,
    takeBackTamper: null,
    directionFlip: null,
    conspiracy: null,
    mimicry: null,
    encore: null,
    emotes: [],
    emoteSequence: 0,
    history,
    telemetry: {
      events: [],
    },
    archive: createEmptyArchiveState(),
    placements: [],
  } satisfies BlowCowState

  appendHistoryEvent(
    state,
    'system',
    'Room staged',
    `Prepared ${normalizedPlayerCount} seat(s), selected ${deckConfig.selectedRanks.length} standard rank(s) (${deckConfig.selectedRanks.join(', ')}), included 2 Jokers, set game speed to ${speedMultiplier}x, ${useCharacters ? 'enabled character cards' : 'disabled character cards'}, ${formatRulesSummary(rules)}, ${formatInitialStatusesSummary(initialStatuses, initialStatusTurns)}, and is waiting for the host to start the match.`,
    null,
    0,
  )

  return state
}

function startMatchState(state: BlowCowState, turnNumber: number, shuffle?: BlowCowShuffle) {
  const shuffledSeatOrder = shuffleCards([...state.seatOrder], shuffle)
  const shuffledDeck = shuffleCards(createDeck(state.deckConfig.selectedRanks), shuffle)
  const assignedCharacters = state.useCharacters
    ? assignRandomImplementedCharacters(shuffledSeatOrder.length, state.deckConfig.selectedRanks, state.characterPool, shuffle)
    : []
  const dealtHands = dealCards(shuffledDeck, shuffledSeatOrder)
  const seatIndexByPlayerID = new Map(shuffledSeatOrder.map((playerID, seatIndex) => [playerID, seatIndex]))
  const characterByPlayerID = new Map(shuffledSeatOrder.map((playerID, index) => [playerID, assignedCharacters[index] ?? null]))

  state.gameStatus = 'active'
  state.seatOrder = shuffledSeatOrder
  state.history = []
  state.placements = []
  state.table.plays = []
  state.bsResolution = null
  state.resetResolution = null
  state.accusation = null
  state.directionTamper = null
  state.takeBackTamper = null
  state.directionFlip = null
  state.conspiracy = null
  state.mimicry = null
  state.encore = null
  state.emotes = []
  state.emoteSequence = 0
  state.round.roundNumber = 1
  state.round.status = 'awaitingTrumpSelection'
  state.round.direction = 'counterclockwise'
  state.round.startingPlayerID = shuffledSeatOrder[0] ?? state.hostPlayerID
  state.round.pendingStartingPlayerID = null
  state.round.trumpRank = null
  state.round.previousTrumpRank = null
  state.round.passStreak = 0
  state.round.lastNonPassingPlayerID = null
  state.round.forcedPlayPlayerID = null
  state.round.startedTurnNumber = null
  state.round.maxCardsOnTable = getMaxCardsOnTable(shuffledSeatOrder.length)
  state.tableStatus = INITIAL_TABLE_STATUS
  state.telemetry = {
    events: [],
  }
  state.archive = createEmptyArchiveState()
  clearPendingRevealIDs(state)

  for (const [playerID, player] of Object.entries(state.players)) {
    player.character = characterByPlayerID.get(playerID) ?? null
    const scoredHand = scoreHand(dealtHands[playerID] ?? [], playerID, 'initialDeal', 1, turnNumber)

    player.seatIndex = seatIndexByPlayerID.get(playerID) ?? player.seatIndex
    player.hand = scoredHand.remainingHand
    player.points = scoredHand.pointsAwarded
    player.scoredSets = scoredHand.scoredSets
    player.matchStats = createInitialPlayerMatchStats()
    player.pendingRevealPlayID = null
    player.hasUsedManualPlay = false
    player.hasUsedGrandmasterBSOverride = false
    player.hasUsedAccusationThisRound = false
    player.hasUsedDefyThisRound = false
    player.hasUsedConspireThisRound = false
    player.hasUsedMimicThisRound = false
    player.hasUsedClownEncoreThisRound = false
    player.wasPunishedThisRound = false
    player.wasPunishedLastRound = false
    player.hasLeft = false
    player.leaveOrder = null
    player.leaveEffect = null
    player.seekerPickedCharacter = null
    player.brokenRemovedRuleID = null
    /*
     * The lobby's testing lever, and the only source of a status in the game today. Dealt through
     * `addPlayerStatus` one at a time rather than assigned wholesale, so the opposition between
     * Tilted and Worried applies here too: a host who picks both gets whichever came first, with no
     * warning, exactly as an ability handing out the second one would find.
     */
    player.statuses = []
    for (const statusID of state.initialStatuses ?? []) {
      addPlayerStatus(state, playerID, statusID, state.initialStatusTurns ?? DEFAULT_BLOW_COW_STATUS_TURNS)
    }
  }

  state.round.startingPlayerID = getDefaultStartingPlayerID(state, shuffledSeatOrder[0] ?? state.hostPlayerID) ?? state.hostPlayerID
  state.archive.initial = createInitialArchiveState(state)

  appendHistoryEvent(
    state,
    'system',
    'Match initialized',
    `Shuffled ${shuffledSeatOrder.length} seat(s), selected ${state.deckConfig.selectedRanks.length} standard rank(s) (${state.deckConfig.selectedRanks.join(', ')}), included 2 Jokers, set game speed to ${state.speedMultiplier}x, dealt opening hands, ${state.useCharacters ? 'assigned character cards' : 'left character cards disabled'}, ${formatInitialStatusesSummary(state.initialStatuses ?? [], state.initialStatusTurns ?? DEFAULT_BLOW_COW_STATUS_TURNS)}, and ${formatPlayerLabel(state, state.round.startingPlayerID)} will act first.`,
    null,
    turnNumber,
  )

  for (const playerID of shuffledSeatOrder) {
    appendPointHistoryEvents(state, playerID, state.players[playerID].scoredSets, turnNumber)
  }

  updateRoundCapacity(state)
}

export function createInitialBlowCowState(
  numPlayers: number,
  shuffle?: BlowCowShuffle,
  setupData?: BlowCowSetupData,
): BlowCowState {
  const state = createStagedBlowCowState(numPlayers, shuffle, setupData)
  startMatchState(state, 0, shuffle)
  resolveRoundStart(state, {
    endGame: () => {},
    endTurn: () => {},
  }, 0)
  return state
}

function resolveEmote(context: BlowCowMoveContext, args?: BlowCowEmoteArgs) {
  const { G, playerID } = context

  if (
    G.gameStatus !== 'active'
    || !playerID
    || G.players[playerID]?.hasLeft
    || !args
    || !Number.isInteger(args.emoteID)
    || args.emoteID < 1
    || args.emoteID > BLOW_COW_EMOTE_COUNT
  ) {
    return INVALID_MOVE
  }

  const nextSequence = (G.emoteSequence ?? 0) + 1
  const nextEmote: BlowCowEmote = {
    id: `emote-${nextSequence}-${playerID}`,
    playerID,
    emoteID: args.emoteID,
  }

  G.emoteSequence = nextSequence
  G.emotes = [...(G.emotes ?? []), nextEmote].slice(-24)
}

export const BlowCowGame = {
  name: BLOW_COW_GAME_NAME,
  minPlayers: BLOW_COW_MIN_PLAYERS,
  maxPlayers: BLOW_COW_MAX_PLAYERS,
  setup: ({ ctx, random }: BlowCowSetupContext, setupData?: BlowCowSetupData): BlowCowState => createStagedBlowCowState(
    ctx.numPlayers,
    random?.Shuffle,
    setupData,
  ),
  validateSetupData: (setupData: BlowCowSetupData | undefined) => validateBlowCowSetupData(setupData),
  events: {
    endGame: true,
    endTurn: true,
  },
  turn: {
    /*
     * Every seat is permanently "active" as far as boardgame.io is concerned, which makes this game
     * the sole authority on turn order.
     *
     * Without this, `IsPlayerActive` falls back to `ctx.currentPlayer === playerID` and the
     * framework silently drops every move from anyone else — and `BoardProps.isActive` goes false
     * on their client too. That is fatal for the powers that are defined by acting out of turn: The
     * Dreamer flipping the direction or slipping cards onto the table during somebody else's turn,
     * and anyone raising an accusation.
     *
     * The cost is that each move must now enforce the turn itself. `performPlay`,
     * `resolveDrunkardRandomPlay`, `pass`, `callBS` and `callReset` all check `ctx.currentPlayer`
     * explicitly for that reason; the procedure moves are stricter still, being caller-only. Any new
     * move that belongs to the current player has to carry its own guard. `sneakPlay` carries the
     * inverse one, refusing when the mover *is* on the clock.
     */
    activePlayers: { all: NULL_STAGE },
    onBegin: (context: BlowCowHookContext) => {
      handleTurnStart(context)
    },
    onEnd: (context: BlowCowHookContext) => {
      handleTurnEnd(context)
    },
  },
  moves: {
    emote: {
      /*
       * Server-only because the id an emote animates under is derived from `emoteSequence`, a
       * counter shared by the whole table. Any other player's emote landing between the local
       * prediction and the server's answer shifts that counter, so the predicted id and the
       * authoritative one differ — and the board, which animates every id it has not seen before,
       * would play the mover's own emote a second time. The counter is what makes the record
       * ordered; deciding it on the server is what makes it agree with every other client.
       */
      client: false,
      move: (context: BlowCowMoveContext, args: BlowCowEmoteArgs) => {
        return resolveEmote(context, args)
      },
    },
    startMatch: (context: BlowCowMoveContext) => {
      const { G, ctx, events, playerID, random } = context
      if (G.gameStatus !== 'staging' || playerID !== G.hostPlayerID) {
        return INVALID_MOVE
      }

      startMatchState(G, ctx.turn, random?.Shuffle)
      const nextStartingPlayerID = resolveRoundStart(G, events, ctx.turn)

      if (!nextStartingPlayerID) {
        return
      }

      if (ctx.currentPlayer === nextStartingPlayerID) {
        handleTurnStart({ G, ctx, events })
        return
      }

      events.endTurn({ next: nextStartingPlayerID })
    },
    selectTrumpAndPlay: {
      redact: true,
      move: (context: BlowCowMoveContext, args: BlowCowSelectTrumpAndPlayArgs) => {
        return performPlay(context, args?.cardIDs ?? [], args?.trumpRank ?? null)
      },
    },
    sneakPlay: {
      redact: true,
      move: (context: BlowCowMoveContext, args: BlowCowSneakPlayArgs) => {
        return resolveSneakPlay(context, args)
      },
    },
    takeBackCard: {
      // Redacted like the two play moves: the log line every other client receives must not name the
      // card that left the table, only that a move happened.
      redact: true,
      move: (context: BlowCowMoveContext, args: BlowCowTakeBackCardArgs) => {
        return resolveTakeBackCard(context, args)
      },
    },
    play: {
      redact: true,
      move: (context: BlowCowMoveContext, args: BlowCowPlayArgs) => {
        return performPlay(context, args?.cardIDs ?? [], null)
      },
    },
    playRandom: {
      redact: true,
      move: (context: BlowCowMoveContext, args?: BlowCowPlayRandomArgs) => {
        return resolveDrunkardRandomPlay(context, args)
      },
    },
    toggleDirection: (context: BlowCowMoveContext) => {
      return resolveToggleDirection(context)
    },
    catHideCard: (context: BlowCowMoveContext, args: BlowCowCatHideCardArgs) => {
      return resolveCatHideCard(context, args)
    },
    seekCharacter: (context: BlowCowMoveContext, args: BlowCowSeekCharacterArgs) => {
      return resolveSeekerCharacterChoice(context, args)
    },
    breakRule: (context: BlowCowMoveContext, args: BlowCowBreakRuleArgs) => {
      return resolveBrokenRuleRemoval(context, args)
    },
    defy: (context: BlowCowMoveContext, args: BlowCowDefyArgs) => {
      return resolveDefy(context, args)
    },
    conspire: {
      /*
       * The entire point of the move is state the client does not have: the target's hand faces are
       * masked in every local copy, so an optimistic run would open a hand of card backs and then be
       * corrected. Deciding it on the server means the hand arrives already unmasked.
       */
      client: false,
      move: (context: BlowCowMoveContext, args: BlowCowConspireArgs) => {
        return resolveConspire(context, args)
      },
    },
    manipulate: (context: BlowCowMoveContext, args: BlowCowManipulateArgs) => {
      return resolveManipulate(context, args)
    },
    mimic: {
      /*
       * The disguise is built out of the source's public state, which the client already has, but the
       * coin flip is not. Predicting it locally would show The Mime a swap that the server then
       * reversed — and the two outcomes differ in whose turn it is, so the correction would be loud.
       */
      client: false,
      move: (context: BlowCowMoveContext) => {
        return resolveMimic(context)
      },
    },
    pass: (context: BlowCowMoveContext, args?: BlowCowPassArgs) => {
      const { G, ctx, playerID, events } = context
      if (G.gameStatus !== 'active' || isProcedureRunning(G) || ctx.currentPlayer !== playerID || isFinalTwoResolutionTurn(G, playerID)) {
        return INVALID_MOVE
      }

      /*
       * Without the Pass Rule there is no Pass action at all. The Foreigner and The Streamer both
       * hang off passing, so removing this card takes The Foreigner's ability with it and makes The
       * Streamer's penalty unavoidable. That is the cost of the removal, not a special case.
       */
      if (isRuleRemoved(G, 'pass')) {
        return INVALID_MOVE
      }

      // Tilted takes Pass off this seat for as long as it lasts, and takes The Foreigner's pass card
      // with it for the same reason removing the Pass Rule does: there is no pass to hang it on.
      if (hasStatus(G, playerID, 'tilted')) {
        return INVALID_MOVE
      }

      // An open conspiracy owes the table a play. See `resolveConspire`.
      if (getOpenConspiracy(G, playerID, ctx.turn)) {
        return INVALID_MOVE
      }

      // So does a round somebody else opened on your behalf. See `resolveManipulate`.
      if (G.round.forcedPlayPlayerID === playerID) {
        return INVALID_MOVE
      }

      const foreignerCard = resolveForeignerPassCard(context, args?.foreignerCardCode)
      if (foreignerCard === INVALID_MOVE) {
        return INVALID_MOVE
      }

      G.players[playerID].matchStats.passCount += 1
      G.round.passStreak += 1
      if (!isRuleRemoved(G, 'passEnding') && G.round.passStreak >= getActivePlayerCount(G)) {
        clearMimicry(G)
        G.resetResolution = createResetResolution(G, playerID, 'roundReturn')
        G.tableStatus = `${formatPlayerLabel(G, playerID)} passed. Everyone passed, so the table cards are returning to their owners.`
        appendArchiveTurnAction(G, playerID, ctx.turn, {
          kind: 'pass',
          detail: 'Everyone passed, so the round will end after each active player takes back their own cards.',
          passStreak: G.round.passStreak,
          endedRound: true,
        })
        appendTelemetryEvent(
          G,
          'action',
          `${formatPlayerLabel(G, playerID)} ended the round with a pass`,
          'Everyone passed, so the round will end after each active player takes back their own cards.',
          playerID,
          ctx.turn,
        )
        return
      }

      appendHistoryEvent(
        G,
        'action',
        `${formatPlayerLabel(G, playerID)} passed`,
        `Pass streak is now ${G.round.passStreak} of ${getActivePlayerCount(G)}.`,
        playerID,
        ctx.turn,
      )
      appendArchiveTurnAction(G, playerID, ctx.turn, {
        kind: 'pass',
        detail: `Pass streak is now ${G.round.passStreak} of ${getActivePlayerCount(G)}.`,
        passStreak: G.round.passStreak,
        endedRound: false,
      })
      advanceTurn(G, events, playerID, ctx.turn)
    },
    callBS: {
      /*
       * Never predicted locally. In multiplayer boardgame.io deliberately skips `playerView` when
       * replaying a move on the client, so an optimistic run would judge the hidden play against
       * masked cards and briefly publish a made-up `targetWasHonest` to the caller.
       */
      client: false,
      move: (context: BlowCowMoveContext, args?: BlowCowCallBSArgs) => {
        return resolveBS(context, args)
      },
    },
    accuseDreamer: {
      /*
       * Same reason, and here it is not merely cosmetic: the verdict turns on `G.directionTamper`,
       * which `hideSecretState` strips entirely. A locally predicted accusation therefore *always*
       * decides "missed", and the client cannot tell that apart from a real miss.
       */
      client: false,
      move: (context: BlowCowMoveContext, args: BlowCowAccuseDreamerArgs) => {
        return resolveAccuseDreamer(context, args)
      },
    },
    beginAccusationPunishment: (context: BlowCowMoveContext, args: BlowCowBeginAccusationPunishmentArgs) => {
      return beginAccusationPunishment(context, args)
    },
    finalizeAccusation: (context: BlowCowMoveContext, args: BlowCowFinalizeAccusationArgs) => {
      return finalizeAccusation(context, args)
    },
    revealBSCard: (context: BlowCowMoveContext, args: BlowCowRevealBSCardArgs) => {
      return revealBSCard(context, args)
    },
    advanceBSReveal: (context: BlowCowMoveContext, args: BlowCowAdvanceBSRevealArgs) => {
      return advanceBSReveal(context, args)
    },
    beginBSPunishment: (context: BlowCowMoveContext, args: BlowCowBeginBSPunishmentArgs) => {
      return beginBSPunishment(context, args)
    },
    finalizeBSResolution: (context: BlowCowMoveContext, args: BlowCowFinalizeBSResolutionArgs) => {
      return finalizeBSResolution(context, args)
    },
    callReset: {
      /*
       * Same reason as `callBS`. A Gambler showdown is decided from cards the caller cannot see yet,
       * so an optimistic local run would rank masked hands and publish a made-up loser.
       */
      client: false,
      move: (context: BlowCowMoveContext) => {
        return resolveReset(context)
      },
    },
    revealResetCard: (context: BlowCowMoveContext, args: BlowCowRevealResetCardArgs) => {
      return revealResetCard(context, args)
    },
    advanceResetReveal: (context: BlowCowMoveContext, args: BlowCowAdvanceResetRevealArgs) => {
      return advanceResetReveal(context, args)
    },
    beginResetPunishment: (context: BlowCowMoveContext, args: BlowCowBeginResetPunishmentArgs) => {
      return beginResetPunishment(context, args)
    },
    finalizeResetResolution: (context: BlowCowMoveContext, args: BlowCowFinalizeResetResolutionArgs) => {
      return finalizeResetResolution(context, args)
    },
  },
  playerView: ({ G, playerID }: { G: BlowCowState; playerID: string | null }) => {
    return hideSecretState(G, playerID)
  },
}