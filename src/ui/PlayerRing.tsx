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
  /** The seat scaled up and pulled to the centre for its BS reveal step. */
  focusedSeatID: string | null
  /** The seat caught cheating by an accusation, red until the accuser presses Punish. */
  accusedCheatSeatID: string | null
  /** Holds the BS target mark back until the call trail has finished arriving. */
  bsTargetMarkDelayMs: number
  /** The seat a live BS call is being resolved against, or null outside a BS resolution. */
  bsTargetSeatID: string | null
  /** Whether the accused was honest, or null while the verdict is still withheld. */
  bsVerdictIsHonest: boolean | null
  /** The seat the BS verdict label belongs to, or null before the accused has been revealed. */
  bsVerdictSeatID: string | null
  /** The line each seat is currently saying, keyed by seat id. Seats with nothing to say are absent. */
  calloutTextBySeatID: Record<string, string>
  /** The centre hub. */
  children: ReactNode
  enteringCardIDSet: Set<string>
  flashingPointSeatIDSet: Set<string>
  getSeatLabel: (seatIndex: number) => string
  onCatHideCard: (cardID: string) => void
  onOpenCharacterCard: (seat: SeatRow) => void
  onRevealCard: (cardID: string) => void
  onSelectSeat: (seatID: string) => void
  punishmentImpactSeatID: string | null
  registerFrontCard: (overlayCardID: string, element: HTMLDivElement | null) => void
  registerHandCountPill: (seatID: string, element: HTMLSpanElement | null) => void
  /** The Continue and Punish controls; returns null for every seat that has neither. */
  renderRevealActions: (seat: SeatRow) => ReactNode
  renderTargetActions: (seat: SeatRow) => ReactNode
  seats: SeatRow[]
  selectableSeatIDSet: Set<string>
  selectedSeatID: string | null
}

export function PlayerRing({
  anchorSeatID,
  accusedCheatSeatID,
  focusedSeatID,
  bsTargetMarkDelayMs,
  bsTargetSeatID,
  bsVerdictIsHonest,
  bsVerdictSeatID,
  calloutTextBySeatID,
  children,
  enteringCardIDSet,
  flashingPointSeatIDSet,
  getSeatLabel,
  onCatHideCard,
  onOpenCharacterCard,
  onRevealCard,
  onSelectSeat,
  punishmentImpactSeatID,
  registerFrontCard,
  registerHandCountPill,
  renderRevealActions,
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
        const angleDeg = getSeatAngleDeg(
          getRingOrderIndex(seatOrderIndex, anchorIndex, seatCount),
          seatCount,
        )
        const isSelectable = selectableSeatIDSet.has(seat.id)

        return (
          <SeatBlock
            revealActions={renderRevealActions(seat)}
            bsTargetMarkDelayMs={bsTargetMarkDelayMs}
            bsVerdictLabel={seat.id === bsVerdictSeatID && bsVerdictIsHonest !== null
              ? (bsVerdictIsHonest ? 'Honest' : 'Lie')
              : null}
            calloutText={calloutTextBySeatID[seat.id] ?? null}
            enteringCardIDSet={enteringCardIDSet}
            isAccusedCheat={seat.id === accusedCheatSeatID}
            isRevealFocused={seat.id === focusedSeatID}
            isPointsFlashing={flashingPointSeatIDSet.has(seat.id)}
            isPunishmentImpact={seat.id === punishmentImpactSeatID}
            isSelectable={isSelectable}
            isSelected={seat.id === selectedSeatID}
            key={seat.id}
            onCatHideCard={onCatHideCard}
            onOpenCharacterCard={onOpenCharacterCard}
            onRevealCard={onRevealCard}
            onSelect={onSelectSeat}
            registerFrontCard={registerFrontCard}
            registerHandCountPill={registerHandCountPill}
            seat={seat}
            seatHalf={getSeatHalf(angleDeg)}
            seatLabel={getSeatLabel(seat.seatIndex)}
            showBSTargetMark={seat.id === bsTargetSeatID}
            style={{ '--seat-angle': `${angleDeg}deg` } as CSSProperties}
            // Mounted for every selectable seat rather than only the selected one; CSS decides
            // when it is visible, so the buttons appear the moment the block is hovered.
            targetActions={isSelectable ? renderTargetActions(seat) : null}
          />
        )
      })}

      {children}
    </div>
  )
}
