import { InlineInfoTooltip } from './InlineInfoTooltip.tsx'
import { DIRECTION_ARROW_ICON_SPRITE } from './iconSprites.ts'
import type { TransientMessage } from './useTransientMessage.ts'

type TableCenterHubProps = {
  canToggleDirection: boolean
  directionArrowOrientation: string
  directionIndicatorLabel: string
  directionToggleTitle: string | undefined
  failMessage: TransientMessage | null
  frontCardsTooltip: string
  maxCardsOnTable: number
  onToggleDirection: () => void
  tableStatus: string
  totalCardsOnTable: number
  trumpLabel: string
  trumpRank: string
}

export function TableCenterHub({
  canToggleDirection,
  directionArrowOrientation,
  directionIndicatorLabel,
  directionToggleTitle,
  failMessage,
  frontCardsTooltip,
  maxCardsOnTable,
  onToggleDirection,
  tableStatus,
  totalCardsOnTable,
  trumpLabel,
  trumpRank,
}: TableCenterHubProps) {
  return (
    <div className="table-center-hub">
      <div aria-label={`${trumpLabel}: ${trumpRank}`} className="trump-rank-inline hub-trump">
        <span>{trumpLabel}</span>
        <strong>{trumpRank}</strong>
      </div>

      {/*
        * Never disabled: the cursor should not show a forbidden sign here. `onToggleDirection`
        * already no-ops unless the viewing player's character allows the flip.
        */}
      <button
        aria-label={directionIndicatorLabel}
        className={`turn-direction-indicator ${directionArrowOrientation}${canToggleDirection ? ' contrarian-ready' : ''}`}
        onClick={onToggleDirection}
        title={directionToggleTitle}
        type="button"
      >
        <img
          alt=""
          aria-hidden="true"
          className="turn-direction-arrow"
          src={DIRECTION_ARROW_ICON_SPRITE}
        />
      </button>

      <div className="hub-table-meta">
        <span className="hub-table-count">
          {totalCardsOnTable}
          <span className="hub-table-count-separator">/</span>
          {maxCardsOnTable}
        </span>
        <InlineInfoTooltip tooltip={tableStatus} />
        <InlineInfoTooltip alignment="end" tooltip={frontCardsTooltip} />
      </div>

      {failMessage ? (
        <div className="board-fail-message" key={failMessage.id} role="alert">
          {failMessage.text}
        </div>
      ) : null}
    </div>
  )
}
