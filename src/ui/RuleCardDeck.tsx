import { useState } from 'react'
import {
  BLOW_COW_RULE_DEFINITIONS,
  formatRuleTitle,
  getRuleDescription,
  type BlowCowRuleDefinition,
  type BlowCowRulesState,
  type BlowCowRuleStatus,
} from '../game/blowCowRules.ts'
import { getRuleCardSprite } from './ruleCardSprites.ts'

const RULE_STATUS_TAGS = {
  removed: 'Removed',
  upgraded: 'Upgraded',
} as const

/*
 * Cards per page, and load-bearing: four is one four-column row, which is what keeps the panel
 * shorter than the viewport instead of scrolling. A second row overflows `board-overlay-panel` and
 * brings back the scrollbar the paging exists to avoid, so this does not grow with the rule count.
 */
const RULE_CARDS_PER_PAGE = 4

type RuleCardDeckProps = {
  /** Extra class names for one card, so a picker can mark the card it has selected. */
  getCardClassName?: (definition: BlowCowRuleDefinition) => string
  /**
   * Rendered under each card's description. This is the whole reason the deck is shared: the
   * in-match panel passes nothing, the lobby passes status buttons, and The Broken passes a Remove
   * control, over one identical set of cards.
   */
  renderCardFooter?: (definition: BlowCowRuleDefinition, status: BlowCowRuleStatus) => React.ReactNode
  rules: BlowCowRulesState
}

/**
 * The paged grid of rule cards, shared by every surface that shows them. Owns its own page index and
 * entrance animation; the cards themselves are stateless.
 */
export function RuleCardDeck({ getCardClassName, renderCardFooter, rules }: RuleCardDeckProps) {
  const [pageIndex, setPageIndex] = useState(0)
  // Which way the cards fly in. Paging forward should look like the deck sliding left, not a
  // direction-less flicker, so the entrance animation follows the button that was pressed.
  const [pageDirection, setPageDirection] = useState<'forward' | 'back'>('forward')
  const pageCount = Math.ceil(BLOW_COW_RULE_DEFINITIONS.length / RULE_CARDS_PER_PAGE)
  const pageStartIndex = pageIndex * RULE_CARDS_PER_PAGE
  const pageDefinitions = BLOW_COW_RULE_DEFINITIONS.slice(pageStartIndex, pageStartIndex + RULE_CARDS_PER_PAGE)

  return (
    <>
      {/* Keyed on the page so every turn remounts the cards and replays their entrance. */}
      <div className={`rule-card-grid ${pageDirection}`} key={pageIndex}>
        {pageDefinitions.map((definition, cardIndex) => {
          const status = rules[definition.id]
          const spriteURL = getRuleCardSprite(definition.title, status === 'upgraded')

          return (
            <article
              className={`rule-card ${status} ${getCardClassName?.(definition) ?? ''}`}
              key={definition.id}
              // Drives the per-card animation delay, so the row deals itself out left to right.
              style={{ '--rule-card-index': cardIndex } as React.CSSProperties}
            >
              <div className="rule-card-illustration">
                {spriteURL
                  ? <img alt="" src={spriteURL} />
                  : <span aria-hidden="true" className="rule-card-illustration-placeholder">?</span>}
                {status === 'active'
                  ? null
                  : <span className={`rule-card-status-tag ${status}`}>{RULE_STATUS_TAGS[status]}</span>}
              </div>

              <h3 className="rule-card-title">{formatRuleTitle(definition, status)}</h3>
              <p className="rule-card-description">{getRuleDescription(definition, status)}</p>

              {renderCardFooter ? (
                <div className="rule-card-footer">{renderCardFooter(definition, status)}</div>
              ) : null}
            </article>
          )
        })}
      </div>

      <div className="rule-card-pager">
        <button
          className="secondary-button"
          disabled={pageIndex === 0}
          onClick={() => {
            setPageDirection('back')
            setPageIndex((previousPageIndex) => Math.max(0, previousPageIndex - 1))
          }}
          type="button"
        >
          Previous
        </button>

        <span className="rule-card-pager-status">Page {pageIndex + 1} of {pageCount}</span>

        <button
          className="secondary-button"
          disabled={pageIndex >= pageCount - 1}
          onClick={() => {
            setPageDirection('forward')
            setPageIndex((previousPageIndex) => Math.min(pageCount - 1, previousPageIndex + 1))
          }}
          type="button"
        >
          Next
        </button>
      </div>
    </>
  )
}
