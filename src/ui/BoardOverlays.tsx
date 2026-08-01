import { HISTORY_EVENT_LABELS } from './historyLabels.ts'
import type { HistoryEvent, SeatRow } from './boardTypes.ts'

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

export function CharacterStripOverlay({
  getSeatLabel,
  onClose,
  onOpenCharacterCard,
  seats,
}: {
  getSeatLabel: (seatIndex: number) => string
  onClose: () => void
  onOpenCharacterCard: (seat: SeatRow) => void
  seats: SeatRow[]
}) {
  return (
    <BoardOverlay
      kicker="Public Information"
      onClose={onClose}
      panelClassName="character-overlay-panel"
      subtitle={`${seats.length} public character ${seats.length === 1 ? 'card' : 'cards'}.`}
      title="Character Cards"
      titleID="character-strip-overlay-title"
    >
      <div className="character-strip" role="list">
        {seats.map((seat) => (
          <article
            className={`character-card-item${seat.isViewingPlayer ? ' viewing-player' : ''}${seat.hasLeft ? ' left' : ''}`}
            key={`character-${seat.id}`}
            role="listitem"
          >
            <div className="character-card-player">
              <strong>{seat.name}</strong>
              <span className="room-note character-card-seat">{getSeatLabel(seat.seatIndex)}</span>
            </div>

            {seat.characterSprite ? (
              <button
                aria-haspopup="dialog"
                aria-label={`Open ${seat.name}'s ${seat.characterName ?? 'character'} card`}
                className="character-card-trigger"
                onClick={() => {
                  onOpenCharacterCard(seat)
                }}
                type="button"
              >
                <img
                  alt={`${seat.name}: ${seat.characterName ?? 'No character assigned'}`}
                  className="character-card-image"
                  src={seat.characterSprite}
                />
              </button>
            ) : (
              <div className="character-card-fallback">
                {seat.characterName ?? 'No character assigned'}
              </div>
            )}
          </article>
        ))}
      </div>
    </BoardOverlay>
  )
}
