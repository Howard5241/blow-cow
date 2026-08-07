import { InlineInfoTooltip } from './InlineInfoTooltip.tsx'
import { DIRECTION_ARROW_ICON_SPRITE } from './iconSprites.ts'

type TableCenterHubProps = {
  canToggleDirection: boolean
  directionArrowOrientation: string
  directionIndicatorLabel: string
  directionToggleTitle: string | undefined
  frontCardsTooltip: string
  maxCardsOnTable: number
  onToggleDirection: () => void
  totalCardsOnTable: number
  trumpLabel: string
  trumpRank: string
}

export function TableCenterHub({
  canToggleDirection,
  directionArrowOrientation,
  directionIndicatorLabel,
  directionToggleTitle,
  frontCardsTooltip,
  maxCardsOnTable,
  onToggleDirection,
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
        className={`turn-direction-indicator ${directionArrowOrientation}${canToggleDirection ? ' direction-ready' : ''}`}
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

      {/*
        * One tooltip, and it explains the number beside it. The turn-status one that used to lead
        * this row is gone: whose turn it is, what the trump is, and what they may do are all already
        * on the board, so it only restated them in prose.
        */}
      <div className="hub-table-meta">
        <span className="hub-table-count">
          {totalCardsOnTable}
          <span className="hub-table-count-separator">/</span>
          {maxCardsOnTable}
        </span>
        <InlineInfoTooltip alignment="end" tooltip={frontCardsTooltip} />
      </div>
    </div>
  )
}
