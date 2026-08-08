import { useState } from 'react'
import { HISTORY_EVENT_LABELS } from './historyLabels.ts'
import type { HistoryEvent } from './boardTypes.ts'
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
              <p className="panel-kicker">{kicker}</p>
              <h2 id={titleID}>{title}</h2>
              <p className="room-note">{subtitle}</p>
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

export function RulesOverlay({
  onClose,
  rules,
}: {
  onClose: () => void
  /*
   * Optional because a match staged before rule cards existed restores from `data/matches/` without
   * the field, and the panel has to keep rendering rather than take the board down with it.
   */
  rules: BlowCowRulesState | undefined
}) {
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
