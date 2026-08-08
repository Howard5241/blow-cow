import type { SeatStatus } from './boardTypes.ts'

type SeatStatusColumnProps = {
  statuses: SeatStatus[]
}

/**
 * The status effects a seat is under, stacked to the right of its avatar with the turns left in the
 * corner of each sprite.
 *
 * Hovering the column opens one panel for the whole stack rather than one tooltip per icon, so a
 * player reads everything holding a seat back in a single glance. The panel is placed by CSS off the
 * block's `data-seat-half`, which points it at the hub — the same trick the seat action bubble uses,
 * and the reason nothing here has to measure the viewport to stay on screen.
 */
export function SeatStatusColumn({ statuses }: SeatStatusColumnProps) {
  if (statuses.length === 0) {
    return null
  }

  return (
    <div
      className="seat-status-column"
      // The block underneath is a click-and-Enter target of its own, and reading a status is not a
      // way to select a seat. Same reason the seat action bubble stops both.
      onClick={(event) => {
        event.stopPropagation()
      }}
      onKeyDown={(event) => {
        event.stopPropagation()
      }}
      tabIndex={0}
    >
      {statuses.map((status) => (
        <span className="seat-status-badge" key={status.id}>
          <img alt={status.title} src={status.sprite} />
          <span className="seat-status-count">{status.turnsRemaining}</span>
        </span>
      ))}

      <span className="seat-status-tooltip" role="tooltip">
        {statuses.map((status) => (
          <span className="seat-status-tooltip-row" key={status.id}>
            <img alt="" className="seat-status-tooltip-sprite" src={status.sprite} />
            <span className="seat-status-tooltip-copy">
              <span className="seat-status-tooltip-title">
                <strong>{status.title}</strong>
                <span className="seat-status-tooltip-turns">
                  {status.turnsRemaining} turn{status.turnsRemaining === 1 ? '' : 's'} left
                </span>
              </span>
              <span className="seat-status-tooltip-description">{status.description}</span>
            </span>
          </span>
        ))}
      </span>
    </div>
  )
}
