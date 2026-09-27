import { useState } from 'react'
import { HISTORY_EVENT_LABELS } from './historyLabels.ts'
import type { HistoryEvent } from './boardTypes.ts'
import type { BlowCowCard } from '../game/blowCowGame.ts'
import { getCardLabel, getCardSprite } from './cardSprites.ts'
import { SPECIAL_RANK_ICON_SPRITES } from './iconSprites.ts'
import {
  createDefaultRulesState,
  type BlowCowRuleID,
  type BlowCowRulesState,
} from '../game/blowCowRules.ts'
import { RuleCardDeck } from './RuleCardDeck.tsx'

type BoardOverlayProps = {
  children: React.ReactNode
  /** Suppresses the kicker/title/subtitle block, leaving only the Close button. */
  hideHeaderCopy?: boolean
  kicker?: string
  onClose: () => void
  panelClassName: string
  subtitle?: string
  title: string
  titleID: string
}

function BoardOverlay({
  children,
  hideHeaderCopy = false,
  kicker,
  onClose,
  panelClassName,
  subtitle,
  title,
  titleID,
}: BoardOverlayProps) {
  return (
    <div
      // With the visible title suppressed there is no element left to point at, so the dialog names
      // itself instead.
      aria-label={hideHeaderCopy ? title : undefined}
      aria-labelledby={hideHeaderCopy ? undefined : titleID}
      aria-modal="true"
      className="board-overlay"
      onClick={onClose}
      role="dialog"
    >
      <section
        className={`board-overlay-panel ${panelClassName}`}
        onClick={(event) => {
          event.stopPropagation()
        }}
      >
        <div className={`board-overlay-header ${hideHeaderCopy ? 'bare' : ''}`}>
          {hideHeaderCopy ? null : (
            <div className="board-overlay-copy">
              {/*
                * Both lines are optional, so an overlay that wants a bare title is not left with two
                * empty paragraphs holding its header open. Only the title is unconditional.
                */}
              {kicker ? <p className="panel-kicker">{kicker}</p> : null}
              <h2 id={titleID}>{title}</h2>
              {subtitle ? <p className="room-note">{subtitle}</p> : null}
            </div>
          )}

          <button className="secondary-button" onClick={onClose} type="button">
            Close
          </button>
        </div>

        {children}
      </section>
    </div>
  )
}

export function HistoryOverlay({
  historyEvents,
  onClose,
}: {
  historyEvents: HistoryEvent[]
  onClose: () => void
}) {
  return (
    <BoardOverlay
      kicker="Match Log"
      onClose={onClose}
      panelClassName="history-overlay-panel"
      subtitle="Scroll from the start of the game to the latest action."
      title="Major Events"
      titleID="history-overlay-title"
    >
      <div className="history-scroll">
        {historyEvents.map((event) => (
          <article className={`history-entry ${event.kind}`} key={event.id}>
            <span className={`history-entry-label ${event.kind}`}>
              {HISTORY_EVENT_LABELS[event.kind]}
            </span>
            <h3>{event.title}</h3>
            <p>{event.detail}</p>
            {event.omen ? <p className="history-entry-omen">{event.omen}</p> : null}
          </article>
        ))}
      </div>
    </BoardOverlay>
  )
}

/**
 * What Ante plays, written out. It gets a list rather than the rule-card deck because Ante does not
 * use the rule card system at all: half those cards describe rules it does not play, so drawing them
 * all as `Active` would be the one surface in the game telling a player something untrue.
 */
const ANTE_RULE_SUMMARY: readonly { title: string; description: string }[] = [
  {
    title: 'The Deal',
    description: 'Every card in the game is shuffled and dealt out again at the start of every round. No card moves from one player to another inside a round.',
  },
  {
    title: 'Winning A Round',
    description: 'A round ends three ways, and each names one winner: a BS call, every player passing in a row, or a player starting their turn with an empty hand. The winner takes 1 gold.',
  },
  {
    title: 'Call BS',
    description: 'The only action that costs anybody anything. The loser pays 1 gold to the winner, and no cards change hands. The Reverse Rule still applies: 4 or more trump-rank cards face up on the table swap the result.',
  },
  {
    title: 'Passing',
    description: 'When every player still in the game passes in a row, the round ends and the last of them wins it. Nobody loses gold.',
  },
  {
    title: 'An Empty Hand',
    description: 'If your turn comes round and you hold no cards, you win the round immediately. No turn is opened and nothing is revealed, so your last play is never seen.',
  },
  {
    title: 'Leaving',
    description: 'A player who reaches 0 gold leaves the game. The deck then shrinks to the rank count for however many players are left, and the ranks it loses never come back.',
  },
  {
    title: 'Not In Play',
    description: 'No characters, no rule cards, no statuses, no action ranks, and no points. There is no table limit, no Call Reset, the trump rank may repeat, and the direction never changes.',
  },
]

export function RulesOverlay({
  isAnteMode = false,
  onClose,
  roundLimit,
  rules,
  startingGold,
}: {
  /** Ante gets the written summary below instead of the rule-card deck. */
  isAnteMode?: boolean
  onClose: () => void
  roundLimit?: number
  /*
   * Optional because a match staged before rule cards existed restores from `data/matches/` without
   * the field, and the panel has to keep rendering rather than take the board down with it.
   */
  rules: BlowCowRulesState | undefined
  startingGold?: number
}) {
  if (isAnteMode) {
    return (
      <BoardOverlay
        kicker="Ante Mode"
        onClose={onClose}
        panelClassName="rules-overlay-panel"
        subtitle={`${roundLimit ?? 20} rounds, ${startingGold ?? 5} starting gold. Most gold at the end wins.`}
        title="Rules"
        titleID="rules-overlay-title"
      >
        <div className="ante-rule-list">
          {ANTE_RULE_SUMMARY.map((rule) => (
            <article className="ante-rule-item" key={rule.title}>
              <h3>{rule.title}</h3>
              <p>{rule.description}</p>
            </article>
          ))}
        </div>
      </BoardOverlay>
    )
  }

  return (
    <BoardOverlay
      hideHeaderCopy
      onClose={onClose}
      panelClassName="rules-overlay-panel"
      title="Rules"
      titleID="rules-overlay-title"
    >
      <RuleCardDeck rules={rules ?? createDefaultRulesState()} />
    </BoardOverlay>
  )
}

/**
 * The hands a revealed Peek opened, on the revealer's client and nowhere else.
 *
 * Mounted off `G.handPeek`, and every card in it arrived through `playerView` already unmasked —
 * there is no client-side unlocking here, and a viewer who is not the revealer never receives the
 * faces to draw in the first place. Closing it is a move rather than local state, so the record dies
 * on the server and a reconnect does not hand the hands back.
 *
 * A hand that has emptied since the peek keeps its section rather than being dropped, because "they
 * have nothing left" is exactly as much of an answer as a list of cards would be. The count beside
 * the name is what says so.
 */
export function HandPeekOverlay({
  handsByPlayerID,
  onClose,
  seatLabelsByPlayerID,
  targetPlayerIDs,
}: {
  handsByPlayerID: Record<string, BlowCowCard[]>
  onClose: () => void
  seatLabelsByPlayerID: Record<string, string>
  targetPlayerIDs: string[]
}) {
  return (
    <BoardOverlay
      onClose={onClose}
      panelClassName="hand-peek-panel"
      title="Opened Hands"
      titleID="hand-peek-title"
    >
      <div className="hand-peek-scroll">
        {targetPlayerIDs.map((targetPlayerID) => {
          const hand = handsByPlayerID[targetPlayerID] ?? []

          return (
            <section className="hand-peek-seat" key={targetPlayerID}>
              <header className="hand-peek-seat-header">
                <img alt="" className="hand-peek-mark" src={SPECIAL_RANK_ICON_SPRITES.Peek} />
                <h3>{seatLabelsByPlayerID[targetPlayerID] ?? targetPlayerID}</h3>
                <span className="hand-peek-count">{hand.length} card(s)</span>
              </header>

              {/* An empty hand needs no line of its own: the count beside the name already says 0. */}
              <div className="hand-peek-cards">
                {hand.map((card) => (
                  <img
                    alt={getCardLabel(card.sprite)}
                    key={card.id}
                    src={getCardSprite(card.sprite)}
                    title={getCardLabel(card.sprite)}
                  />
                ))}
              </div>
            </section>
          )
        })}
      </div>
    </BoardOverlay>
  )
}

/**
 * The Broken's start-of-game choice. Built on the same deck as the read-only Rules panel rather than
 * a list of names, because the decision is "which of these cards do I tear up" and the cards carry
 * the copy that answers it.
 *
 * Mounted only on The Broken's own client. Like The Seeker's picker it is dismissible and has no
 * deadline: the match runs on behind it, and a choice that expired would punish an unlucky player
 * rather than a slow one.
 */
export function BreakRuleOverlay({
  choices,
  isBlocked,
  blockedReason,
  onBreakRule,
  onClose,
  rules,
}: {
  choices: readonly BlowCowRuleID[]
  blockedReason: string
  isBlocked: boolean
  onBreakRule: (ruleID: BlowCowRuleID) => void
  onClose: () => void
  rules: BlowCowRulesState | undefined
}) {
  const [selectedRuleID, setSelectedRuleID] = useState<BlowCowRuleID | null>(null)
  const resolvedRules = rules ?? createDefaultRulesState()
  const canBreakSelectedRule = !isBlocked && selectedRuleID !== null && choices.includes(selectedRuleID)

  return (
    <BoardOverlay
      kicker="The Broken"
      onClose={onClose}
      panelClassName="rules-overlay-panel break-rule-panel"
      subtitle={choices.length === 0
        ? 'Nothing here can be removed. Every removable rule is already gone.'
        : 'Choose one rule card to remove from this match. Rules that define no removed variant cannot be chosen, and the choice is permanent.'}
      title="Break a Rule"
      titleID="break-rule-title"
    >
      <RuleCardDeck
        getCardClassName={(definition) => {
          if (selectedRuleID === definition.id) {
            return 'selected'
          }

          return choices.includes(definition.id) ? 'breakable' : 'unbreakable'
        }}
        renderCardFooter={(definition) => {
          const isBreakable = choices.includes(definition.id)

          return (
            <button
              aria-pressed={selectedRuleID === definition.id}
              className={`rule-card-select-button ${selectedRuleID === definition.id ? 'selected' : ''}`}
              disabled={!isBreakable}
              onClick={() => {
                setSelectedRuleID(definition.id)
              }}
              type="button"
            >
              {!isBreakable
                ? 'Cannot Be Removed'
                : selectedRuleID === definition.id
                ? 'Selected'
                : 'Select'}
            </button>
          )
        }}
        rules={resolvedRules}
      />

      <div className="break-rule-footer">
        <p className="room-note">
          {isBlocked
            ? blockedReason
            : selectedRuleID
            ? 'Breaking a rule spends The Broken, so this is the only choice you get.'
            : 'Nothing is decided until you confirm, and you can close this and come back to it at any point.'}
        </p>

        <button
          className="primary-button"
          disabled={!canBreakSelectedRule}
          onClick={() => {
            if (selectedRuleID) {
              onBreakRule(selectedRuleID)
            }
          }}
          type="button"
        >
          Break Rule
        </button>
      </div>
    </BoardOverlay>
  )
}
