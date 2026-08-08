import { CARD_BACK_FILENAME, getCardLabel, getFrontCardSprite } from './cardSprites.ts'
import type { FrontCard } from './boardTypes.ts'

type FrontCardRowProps = {
  cards: FrontCard[]
  enteringCardIDSet: Set<string>
  onCatHideCard: (cardID: string) => void
  onRevealCard: (cardID: string) => void
  onTakeBackCard: (cardID: string) => void
  /** Names the card's owner, so the reveal prompt says whose hidden play is being opened. */
  seatName: string
  /**
   * Registers each rendered card element with the board. These nodes are the destination of
   * the front-card entry animation and the source of every punishment, all-pass return, and
   * reset travel sequence, so a card must never be dropped from the DOM while it is on the
   * table.
   */
  registerFrontCard: (overlayCardID: string, element: HTMLDivElement | null) => void
}

export function FrontCardRow({
  cards,
  enteringCardIDSet,
  onCatHideCard,
  onRevealCard,
  onTakeBackCard,
  registerFrontCard,
  seatName,
}: FrontCardRowProps) {
  // An empty row renders nothing. `.seat-front-cards` keeps its min-height, so blocks stay
  // the same size and the ring radii (which assume a fixed block height) do not shift.
  if (cards.length === 0) {
    return null
  }

  return (
    <div className="front-card-row">
      {cards.map((card) => {
        const takeBackLabel = `Palm ${getCardLabel(card.sprite)} back into your hand`
        const catHideLabel = `Use The Cat to flip ${getCardLabel(card.sprite)} face down`
        const revealLabel = `Reveal ${seatName}'s hidden card`
        /*
         * The reveal never overlaps the other two — it is the only one on face-down cards — but the
         * take-back and The Cat's flip both want face-up ones, and a Cat who may also cheat owns
         * cards that qualify for either. The take-back is checked first, which is what settles it:
         * their own pile is palmed, everyone else's is still flipped.
         */
        const actionLabel = card.isTakeBackActionable
          ? takeBackLabel
          : card.isCatActionable
          ? catHideLabel
          : card.isRevealable
          ? revealLabel
          : undefined
        const onAction = card.isTakeBackActionable
          ? () => {
              onTakeBackCard(card.cardID)
            }
          : card.isCatActionable
          ? () => {
              onCatHideCard(card.cardID)
            }
          : card.isRevealable
          ? () => {
              onRevealCard(card.cardID)
            }
          : undefined

        return (
          <div
            aria-label={actionLabel}
            className={`front-card ${card.faceDown ? 'face-down' : 'face-up'}${card.isDeparted ? ' departed-placeholder' : ''}${card.isFlipping ? ' flipping' : ''}${card.isTargeted ? ' target-card' : ''}${card.isTrumpHighlighted ? ' trump-card' : ''}${enteringCardIDSet.has(card.id) ? ' entering-placeholder' : ''}${card.isCatActionable ? ' cat-actionable' : ''}${card.isTakeBackActionable ? ' take-back-actionable' : ''}${card.isRevealable ? ' revealable' : ''}`}
            key={card.id}
            onClick={onAction}
            onKeyDown={onAction ? (event) => {
              if (event.key !== 'Enter' && event.key !== ' ') {
                return
              }

              event.preventDefault()
              onAction()
            } : undefined}
            ref={(element) => {
              registerFrontCard(card.id, element)
            }}
            role={onAction ? 'button' : undefined}
            tabIndex={onAction ? 0 : undefined}
            title={actionLabel}
          >
            <img
              alt={card.faceDown ? 'Face-down card' : getCardLabel(card.sprite)}
              src={getFrontCardSprite(card.faceDown ? CARD_BACK_FILENAME : card.sprite)}
            />
          </div>
        )
      })}
    </div>
  )
}
