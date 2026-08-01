import type { CSSProperties, ReactNode } from 'react'
import { SeatBlock } from './SeatBlock.tsx'
import type { SeatHalf, SeatRow } from './boardTypes.ts'

// Screen y grows downward, so sin(90deg) puts the anchor seat at the bottom of the ring.
const BOTTOM_SEAT_ANGLE_DEG = 90

function getSeatAngleDeg(ringOrderIndex: number, seatCount: number) {
  return BOTTOM_SEAT_ANGLE_DEG + (ringOrderIndex * 360) / seatCount
}

function getRingOrderIndex(seatOrderIndex: number, anchorIndex: number, seatCount: number) {
  return (seatOrderIndex - anchorIndex + seatCount) % seatCount
}

/**
 * Quantises the seat angle into the side of the ring it sits on, so its action bubble can be
 * placed on the hub-facing side with four static CSS rules instead of more trigonometry.
 */
function getSeatHalf(angleDeg: number): SeatHalf {
  const normalisedAngle = ((angleDeg % 360) + 360) % 360

  if (normalisedAngle >= 45 && normalisedAngle < 135) {
    return 'bottom'
  }

  if (normalisedAngle >= 135 && normalisedAngle < 225) {
    return 'left'
  }

  if (normalisedAngle >= 225 && normalisedAngle < 315) {
    return 'top'
  }

  return 'right'
}

type PlayerRingProps = {
  /** The seat the ring rotates around, so it always lands at the bottom angle. */
  anchorSeatID: string | null
  calloutSeatID: string | null
  calloutText: string
  /** The centre hub. */
  children: ReactNode
  /**
   * The seat rendered outside the ring, in the hand row. Its bottom angle is left empty rather
   * than redistributed, which keeps every other seat at its true position relative to the
   * viewing player. Null for spectators, who have no seat to dock.
   */
  dockedSeatID: string | null
  enteringCardIDSet: Set<string>
  flashingPointSeatIDSet: Set<string>
  getSeatLabel: (seatIndex: number) => string
  onCatHideCard: (cardID: string) => void
  onOpenCharacterCard: (seat: SeatRow) => void
  onSelectSeat: (seatID: string) => void
  registerFrontCard: (overlayCardID: string, element: HTMLDivElement | null) => void
  registerHandCountPill: (seatID: string, element: HTMLSpanElement | null) => void
  renderTargetActions: (seat: SeatRow) => ReactNode
  seats: SeatRow[]
  selectableSeatIDSet: Set<string>
  selectedSeatID: string | null
}

export function PlayerRing({
  anchorSeatID,
  calloutSeatID,
  calloutText,
  children,
  dockedSeatID,
  enteringCardIDSet,
  flashingPointSeatIDSet,
  getSeatLabel,
  onCatHideCard,
  onOpenCharacterCard,
  onSelectSeat,
  registerFrontCard,
  registerHandCountPill,
  renderTargetActions,
  seats,
  selectableSeatIDSet,
  selectedSeatID,
}: PlayerRingProps) {
  const seatCount = seats.length
  const anchorIndex = Math.max(0, seats.findIndex((seat) => seat.id === anchorSeatID))

  return (
    <div className="player-ring" data-seat-count={seatCount}>
      {seats.map((seat, seatOrderIndex) => {
        // Mapped over the full seat list so the docked seat still consumes its share of the
        // circle; skipping it here only removes the block, never shifts the others.
        if (seat.id === dockedSeatID) {
          return null
        }

        const angleDeg = getSeatAngleDeg(
          getRingOrderIndex(seatOrderIndex, anchorIndex, seatCount),
          seatCount,
        )
        const isSelected = seat.id === selectedSeatID

        return (
          <SeatBlock
            calloutText={calloutSeatID === seat.id ? calloutText : null}
            enteringCardIDSet={enteringCardIDSet}
            isPointsFlashing={flashingPointSeatIDSet.has(seat.id)}
            isSelectable={selectableSeatIDSet.has(seat.id)}
            isSelected={isSelected}
            key={seat.id}
            onCatHideCard={onCatHideCard}
            onOpenCharacterCard={onOpenCharacterCard}
            onSelect={onSelectSeat}
            registerFrontCard={registerFrontCard}
            registerHandCountPill={registerHandCountPill}
            seat={seat}
            seatHalf={getSeatHalf(angleDeg)}
            seatLabel={getSeatLabel(seat.seatIndex)}
            style={{ '--seat-angle': `${angleDeg}deg` } as CSSProperties}
            targetActions={isSelected ? renderTargetActions(seat) : null}
          />
        )
      })}

      {children}
    </div>
  )
}
