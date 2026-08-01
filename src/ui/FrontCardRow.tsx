import { CARD_BACK_FILENAME, getCardLabel, getFrontCardSprite } from './cardSprites.ts'
import type { FrontCard } from './boardTypes.ts'

type FrontCardRowProps = {
  cards: FrontCard[]
  enteringCardIDSet: Set<string>
  onCatHideCard: (cardID: string) => void
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
  registerFrontCard,
}: FrontCardRowProps) {
  // An empty row renders nothing. `.seat-front-cards` keeps its min-height, so blocks stay
  // the same size and the ring radii (which assume a fixed block height) do not shift.
  if (cards.length === 0) {
    return null
  }

  return (
    <div className="front-card-row">
      {cards.map((card) => {
        const catHideLabel = `Use The Cat to flip ${getCardLabel(card.sprite)} face down`

        return (
          <div
            aria-label={card.isCatActionable ? catHideLabel : undefined}
            className={`front-card ${card.faceDown ? 'face-down' : 'face-up'}${card.isDeparted ? ' departed-placeholder' : ''}${card.isFlipping ? ' flipping' : ''}${card.isTargeted ? ' target-card' : ''}${enteringCardIDSet.has(card.id) ? ' entering-placeholder' : ''}${card.isCatActionable ? ' cat-actionable' : ''}`}
            key={card.id}
            onClick={card.isCatActionable ? () => {
              onCatHideCard(card.cardID)
            } : undefined}
            onKeyDown={card.isCatActionable ? (event) => {
              if (event.key !== 'Enter' && event.key !== ' ') {
                return
              }

              event.preventDefault()
              onCatHideCard(card.cardID)
            } : undefined}
            ref={(element) => {
              registerFrontCard(card.id, element)
            }}
            role={card.isCatActionable ? 'button' : undefined}
            tabIndex={card.isCatActionable ? 0 : undefined}
            title={card.isCatActionable ? catHideLabel : undefined}
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
