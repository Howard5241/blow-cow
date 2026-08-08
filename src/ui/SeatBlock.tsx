import type { CSSProperties } from 'react'
import { FrontCardRow } from './FrontCardRow.tsx'
import { SeatStatusColumn } from './SeatStatusColumn.tsx'
import {
  BLOCK_HOVER_ICON_SPRITE,
  BS_TARGET_ICON_SPRITE,
  CARDS_ICON_SPRITE,
  POINT_ICON_SPRITE,
} from './iconSprites.ts'
import type { PointsFlashDirection, SeatHalf, SeatRow } from './boardTypes.ts'

export type SeatEmote = {
  id: string
  sprite: string
}

type SeatBlockProps = {
  /**
   * The Continue and Punish controls of a live BS resolution. Only ever supplied to the caller, so
   * on every other client the buttons do not exist at all.
   */
  revealActions?: React.ReactNode
  /**
   * Holds the BS target mark back until the call trail has landed. Its keyframe fills backwards
   * from opacity 0, so the delay alone keeps it hidden.
   */
  bsTargetMarkDelayMs?: number
  /** 'Honest' or 'Lie', once the BS caller has finished revealing the accused's cards. */
  bsVerdictLabel?: 'Honest' | 'Lie' | null
  /**
   * What this player is currently saying. Callouts do not expire: the board clears them when that
   * player starts a turn, says something else, or the round ends.
   */
  calloutText: string | null
  /** Any freshly received emotes travelling out from this seat's avatar. */
  emotes: SeatEmote[]
  /** This block is the one pulled to the centre of the table for its BS reveal step. */
  isRevealFocused?: boolean
  /** This player was just caught cheating, and stays red until they are punished. */
  isAccusedCheat?: boolean
  /**
   * How this seat's cards in front read as a poker hand, during a Gambler showdown. Server-supplied
   * and withheld until the reveal is complete, so it cannot appear before the cards do.
   */
  showdownHandLabel?: string | null
  /** This seat holds one of the weakest hands in the showdown, so it is a Punish target. */
  isShowdownLoser?: boolean
  /**
   * This player just flipped the direction sign, and their block nods toward the hub to say so. The
   * board's only word on who touched the sign, and it never says whether they were allowed to.
   */
  isDirectionFlipTell?: boolean
  enteringCardIDSet: Set<string>
  /** Which way this seat's points last moved, or null when the pill is not flashing. */
  pointsFlashDirection: PointsFlashDirection | null
  isPunishmentImpact: boolean
  isSelectable: boolean
  isSelected: boolean
  onCatHideCard: (cardID: string) => void
  onEmoteAnimationEnd: (emoteID: string) => void
  onOpenCharacterCard: (seat: SeatRow) => void
  onRevealCard: (cardID: string) => void
  onSelect: (seatID: string) => void
  onTakeBackCard: (cardID: string) => void
  registerFrontCard: (overlayCardID: string, element: HTMLDivElement | null) => void
  registerHandCountPill: (seatID: string, element: HTMLSpanElement | null) => void
  seat: SeatRow
  seatHalf?: SeatHalf
  seatLabel: string
  /** Marks this seat as the one a live BS call is being resolved against. */
  showBSTargetMark?: boolean
  /** Carries only `--seat-angle`; the ring position is computed in CSS from it. */
  style?: CSSProperties
  /**
   * The Call BS and Accuse controls. Rendered for every selectable seat and revealed by CSS on
   * hover, focus, or sticky selection, so pointing at a block is enough to act on it.
   */
  targetActions?: React.ReactNode
}

export function SeatBlock({
  revealActions,
  bsTargetMarkDelayMs = 0,
  bsVerdictLabel = null,
  calloutText,
  emotes,
  enteringCardIDSet,
  isAccusedCheat = false,
  showdownHandLabel = null,
  isShowdownLoser = false,
  isDirectionFlipTell = false,
  isRevealFocused = false,
  pointsFlashDirection,
  isPunishmentImpact,
  isSelectable,
  isSelected,
  onCatHideCard,
  onEmoteAnimationEnd,
  onOpenCharacterCard,
  onRevealCard,
  onSelect,
  onTakeBackCard,
  registerFrontCard,
  registerHandCountPill,
  seat,
  seatHalf,
  seatLabel,
  showBSTargetMark = false,
  style,
  targetActions,
}: SeatBlockProps) {
  const className = [
    'seat-block',
    seat.isViewingPlayer ? 'viewing-seat' : '',
    seat.isActingPlayer ? 'acting-seat' : '',
    seat.isTargetPlayer ? 'target-seat' : '',
    isSelectable ? 'selectable-seat' : '',
    isSelected ? 'selected-seat' : '',
    isRevealFocused ? 'focused-seat' : '',
    isAccusedCheat ? 'accused-cheat-seat' : '',
    isDirectionFlipTell ? 'direction-flip-tell' : '',
    isPunishmentImpact ? 'punishment-impact' : '',
    seat.hasLeft ? 'left-seat' : '',
    !seat.hasLeft && !seat.isConnected ? 'disconnected-seat' : '',
  ].filter(Boolean).join(' ')

  return (
    <article
      className={className}
      data-seat-half={seatHalf}
      // The BS call trail measures block centres by this attribute, so it works for the docked
      // block in the hand row as well as the ring seats.
      data-seat-id={seat.id}
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
      {isSelectable ? (
        <img aria-hidden="true" alt="" className="seat-hover-frame" src={BLOCK_HOVER_ICON_SPRITE} />
      ) : null}

      {/*
        * The same outline sprite as the hover frame, but painted red. It is a mask rather than an
        * <img> because the sprite ships as a white glyph and CSS filters cannot recolour white
        * cleanly; masking paints a flat colour through the sprite's own alpha instead.
        */}
      {showBSTargetMark ? (
        <div
          aria-hidden="true"
          className="seat-bs-call-frame"
          style={{ '--seat-frame-sprite': `url(${BLOCK_HOVER_ICON_SPRITE})` } as CSSProperties}
        />
      ) : null}

      <div className="seat-block-top">
        {emotes.length > 0 ? (
          <div aria-hidden="true" className="seat-emote-layer">
            {emotes.map((emote, emoteIndex) => (
              <img
                alt=""
                className="seat-emote"
                key={emote.id}
                onAnimationEnd={() => {
                  onEmoteAnimationEnd(emote.id)
                }}
                src={emote.sprite}
                style={{ '--emote-delay': `${emoteIndex * 70}ms` } as CSSProperties}
              />
            ))}
          </div>
        ) : null}

        {seat.avatarSprite ? (
          <img alt="" className="seat-avatar-image" src={seat.avatarSprite} />
        ) : (
          <div aria-hidden="true" className="seat-avatar-fallback">{seat.name.slice(0, 1).toUpperCase()}</div>
        )}

        {/* Sits on the avatar, not the whole block, so the accused's face carries the mark. */}
        {showBSTargetMark ? (
          <img
            aria-hidden="true"
            alt=""
            className="seat-bs-target-mark"
            src={BS_TARGET_ICON_SPRITE}
            style={{ animationDelay: `${bsTargetMarkDelayMs}ms` }}
          />
        ) : null}

        {/*
          * Sits on the avatar so it scales with the block while it is centred, and stays put once
          * the block returns to the ring. It is driven by the server unmasking the verdict, so it
          * cannot appear before the caller has finished revealing the accused.
          */}
        {bsVerdictLabel ? (
          <span
            className={`seat-bs-verdict-label ${bsVerdictLabel === 'Honest' ? 'honest' : 'lie'}`}
            role="status"
          >
            {bsVerdictLabel}
          </span>
        ) : null}

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

        {/*
          * Absolutely placed beside the avatar rather than added to this row's flow, because the
          * block's height feeds the ring radii and a taller block would move every seat.
          */}
        <SeatStatusColumn statuses={seat.statuses} />
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
            className={`seat-stat-value points-pill${pointsFlashDirection ? ` flashing ${pointsFlashDirection}` : ''}`}
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
          onRevealCard={onRevealCard}
          onTakeBackCard={onTakeBackCard}
          registerFrontCard={registerFrontCard}
          seatName={seat.name}
        />
      </div>

      {/*
        * Directly under the cards it describes, because it is a reading of exactly those cards and
        * nothing else. Every seat carries one during a showdown, so the table can see the ranking it
        * is being punished by rather than only the result.
        */}
      {showdownHandLabel ? (
        <span
          className={`seat-showdown-label${isShowdownLoser ? ' weakest' : ''}`}
          role="status"
        >
          {showdownHandLabel}
        </span>
      ) : null}

      {/*
        * The leave-triggered ability that moved this player's points, and the reason the total on
        * the pill below no longer matches the ranks they scored. It never goes away, so it takes
        * the spot directly above the block on every side of the ring; the board stops feeding this
        * seat callouts once its player has left, so the two cannot collide.
        */}
      {seat.leaveEffect ? (
        <span
          className={`seat-leave-effect${seat.leaveEffect.isGain ? ' gain' : ''}`}
          role="status"
        >
          {seat.leaveEffect.label}
        </span>
      ) : null}

      {/*
        * A direct child of the block, not of the identity row, so it can sit outside the block
        * entirely. CSS points it at the hub from whichever side of the ring the seat is on, which
        * is also what keeps it off the edges of the board.
        */}
      {calloutText ? (
        <span
          aria-live="polite"
          className="player-play-callout"
          role="status"
        >
          {calloutText}
        </span>
      ) : null}

      {targetActions}

      {/*
        * Unlike the target actions these are never hover-gated: they are the only way forward in a
        * BS resolution, so they must be visible the moment they become legal.
        */}
      {revealActions ? (
        <div className="seat-reveal-actions">
          {revealActions}
        </div>
      ) : null}
    </article>
  )
}
