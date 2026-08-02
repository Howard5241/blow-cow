import { HISTORY_EVENT_LABELS } from './historyLabels.ts'
import type { HistoryEvent } from './boardTypes.ts'

type BoardOverlayProps = {
  children: React.ReactNode
  kicker: string
  onClose: () => void
  panelClassName: string
  subtitle: string
  title: string
  titleID: string
}

function BoardOverlay({
  children,
  kicker,
  onClose,
  panelClassName,
  subtitle,
  title,
  titleID,
}: BoardOverlayProps) {
  return (
    <div
      aria-labelledby={titleID}
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
        <div className="board-overlay-header">
          <div className="board-overlay-copy">
            <p className="panel-kicker">{kicker}</p>
            <h2 id={titleID}>{title}</h2>
            <p className="room-note">{subtitle}</p>
          </div>

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
          </article>
        ))}
      </div>
    </BoardOverlay>
  )
}
