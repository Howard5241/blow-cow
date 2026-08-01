import type { CSSProperties } from 'react'
import { FrontCardRow } from './FrontCardRow.tsx'
import { CARDS_ICON_SPRITE, POINT_ICON_SPRITE } from './iconSprites.ts'
import type { SeatHalf, SeatRow } from './boardTypes.ts'

type SeatBlockProps = {
  calloutText: string | null
  enteringCardIDSet: Set<string>
  /** Rendered in the hand row instead of on the ring, so it is laid out in normal flow. */
  isDocked?: boolean
  isPointsFlashing: boolean
  isSelectable: boolean
  isSelected: boolean
  onCatHideCard: (cardID: string) => void
  onOpenCharacterCard: (seat: SeatRow) => void
  onSelect: (seatID: string) => void
  registerFrontCard: (overlayCardID: string, element: HTMLDivElement | null) => void
  registerHandCountPill: (seatID: string, element: HTMLSpanElement | null) => void
  seat: SeatRow
  seatHalf?: SeatHalf
  seatLabel: string
  /** Carries only `--seat-angle`; the ring position is computed in CSS from it. */
  style?: CSSProperties
  /** Rendered only on the selected seat: the Call BS and Accuse controls. */
  targetActions?: React.ReactNode
}

export function SeatBlock({
  calloutText,
  enteringCardIDSet,
  isDocked = false,
  isPointsFlashing,
  isSelectable,
  isSelected,
  onCatHideCard,
  onOpenCharacterCard,
  onSelect,
  registerFrontCard,
  registerHandCountPill,
  seat,
  seatHalf,
  seatLabel,
  style,
  targetActions,
}: SeatBlockProps) {
  const className = [
    'seat-block',
    isDocked ? 'docked-seat' : '',
    seat.isViewingPlayer ? 'viewing-seat' : '',
    seat.isActingPlayer ? 'acting-seat' : '',
    seat.isTargetPlayer ? 'target-seat' : '',
    isSelectable ? 'selectable-seat' : '',
    isSelected ? 'selected-seat' : '',
    seat.hasLeft ? 'left-seat' : '',
    !seat.hasLeft && !seat.isConnected ? 'disconnected-seat' : '',
  ].filter(Boolean).join(' ')

  return (
    <article
      className={className}
      data-seat-half={seatHalf}
      onClick={isSelectable ? () => {
        onSelect(seat.id)
      } : undefined}
      onKeyDown={isSelectable ? (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') {
          return
        }

        event.preventDefault()
        onSelect(seat.id)
      } : undefined}
      role={isSelectable ? 'button' : undefined}
      style={style}
      tabIndex={isSelectable ? 0 : undefined}
      title={isSelectable ? `Select ${seat.name} to challenge` : undefined}
    >
      <div className="seat-block-top">
        {seat.avatarSprite ? (
          <img alt="" className="seat-avatar-image" src={seat.avatarSprite} />
        ) : (
          <div aria-hidden="true" className="seat-avatar-fallback">{seat.name.slice(0, 1).toUpperCase()}</div>
        )}

        {seat.characterSprite ? (
          <button
            aria-haspopup="dialog"
            aria-label={`Open ${seat.name}'s ${seat.characterName ?? 'character'} card`}
            className="seat-character-badge"
            onClick={(event) => {
              event.stopPropagation()
              onOpenCharacterCard(seat)
            }}
            type="button"
          >
            <img alt="" src={seat.characterSprite} />
          </button>
        ) : null}
      </div>

      <div className="seat-block-identity">
        <strong className="seat-block-name" data-punishment-target-name={seat.id}>
          {seat.name}
        </strong>
        <div className="seat-block-meta">
          <span className="seat-tag">{seatLabel}</span>
          {seat.hasLeft ? (
            <span className="seat-tag offline">Left</span>
          ) : (
            <span className={`seat-tag ${seat.isConnected ? 'online' : 'offline'}`}>
              {seat.isConnected ? 'Connected' : 'Offline'}
            </span>
          )}
        </div>
        {calloutText ? (
          <span aria-live="polite" className="player-play-callout" role="status">
            {calloutText}
          </span>
        ) : null}
      </div>

      <div className="seat-stat-row">
        <span className="seat-stat seat-stat-hand" title={`${seat.handCount} card(s) in hand`}>
          <img alt="" className="seat-stat-icon" src={CARDS_ICON_SPRITE} />
          <span
            aria-label={`Cards in hand: ${seat.handCount}`}
            className="seat-stat-value"
            ref={(element) => {
              registerHandCountPill(seat.id, element)
            }}
          >
            {seat.handCount}
          </span>
        </span>

        <span
          className="seat-stat seat-stat-points"
          title={seat.pointRanks.length > 0 ? `Scored ranks: ${seat.pointRanks.join(', ')}` : 'No scored ranks yet'}
        >
          <img alt="" className="seat-stat-icon" src={POINT_ICON_SPRITE} />
          <span
            aria-label={`Points: ${seat.points}. ${seat.pointRanks.length > 0 ? `Scored ranks: ${seat.pointRanks.join(', ')}` : 'No scored ranks yet.'}`}
            className={`seat-stat-value points-pill${isPointsFlashing ? ' flashing' : ''}`}
          >
            {seat.points}
          </span>
        </span>
      </div>

      <div className="seat-front-cards">
        <FrontCardRow
          cards={seat.frontCards}
          enteringCardIDSet={enteringCardIDSet}
          onCatHideCard={onCatHideCard}
          registerFrontCard={registerFrontCard}
        />
      </div>

      {targetActions}
    </article>
  )
}
