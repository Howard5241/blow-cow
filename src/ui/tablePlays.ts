import type { BlowCowState } from '../game/blowCowGame.ts'

export type BlowCowTablePlay = BlowCowState['table']['plays'][number]

export function getDisplayedPlayCardCount(play: BlowCowTablePlay) {
  return play.declaredCardCount ?? play.cards.length
}

export function getExplicitlyRevealedCardIDSet(play: BlowCowTablePlay) {
  return new Set(play.revealedCardIDs ?? [])
}

export function getCatHiddenCardIDSet(play: BlowCowTablePlay) {
  return new Set(play.rehiddenCardIDs ?? [])
}

export function getHiddenOverlayCardIDs(play: BlowCowTablePlay) {
  if (play.revealedAtTurn !== null) {
    return [] as string[]
  }

  const revealedCardIDSet = getExplicitlyRevealedCardIDSet(play)
  return play.cards
    .filter((card) => !revealedCardIDSet.has(card.id))
    .map((card) => `${play.id}-${card.id}`)
}

/**
 * Everything the table is actually showing face down, Cat-rehidden cards included. Mirrors the
 * server's `getFaceDownCardsForPlay`, which the BS reveal procedure walks. This is deliberately
 * not `getHiddenOverlayCardIDs`: that one ignores `rehiddenCardIDs` because re-hiding a card must
 * not make its owner challengeable again.
 */
export function getFaceDownOverlayCardIDs(play: BlowCowTablePlay) {
  const revealedCardIDSet = getExplicitlyRevealedCardIDSet(play)
  const catHiddenCardIDSet = getCatHiddenCardIDSet(play)

  return play.cards
    .filter((card) => catHiddenCardIDSet.has(card.id)
      || (play.revealedAtTurn === null && !revealedCardIDSet.has(card.id)))
    .map((card) => `${play.id}-${card.id}`)
}

/**
 * The exact complement of `getFaceDownOverlayCardIDs`. The flip animation watches this rather than
 * `getRevealedOverlayCardIDs` so that un-rehiding a Cat-hidden card still animates: such a card is
 * already in `revealedCardIDs`, so only the rehidden set moves when the BS reveal opens it.
 */
export function getFaceUpOverlayCardIDs(play: BlowCowTablePlay) {
  const faceDownOverlayCardIDSet = new Set(getFaceDownOverlayCardIDs(play))

  return play.cards
    .map((card) => `${play.id}-${card.id}`)
    .filter((overlayCardID) => !faceDownOverlayCardIDSet.has(overlayCardID))
}

export function getRevealedOverlayCardIDs(play: BlowCowTablePlay) {
  if (play.revealedAtTurn !== null) {
    return play.cards.map((card) => `${play.id}-${card.id}`)
  }

  const revealedCardIDSet = getExplicitlyRevealedCardIDSet(play)
  return play.cards
    .filter((card) => revealedCardIDSet.has(card.id))
    .map((card) => `${play.id}-${card.id}`)
}

export function getCatHiddenOverlayCardIDs(play: BlowCowTablePlay) {
  const catHiddenCardIDSet = getCatHiddenCardIDSet(play)

  return play.cards
    .filter((card) => catHiddenCardIDSet.has(card.id))
    .map((card) => `${play.id}-${card.id}`)
}

export type BlowCowWornMimicry = NonNullable<BlowCowState['mimicry']>

export type DisplayedFrontCard = {
  /** Unique across the board. A borrowed card is drawn twice, so its copy carries its own id. */
  overlayCardID: string
  play: BlowCowTablePlay
  card: BlowCowTablePlay['cards'][number]
  faceDown: boolean
  /** Drawn on this block for the disguise rather than owned by the seat showing it. */
  isBorrowed: boolean
}

/**
 * What one seat's block draws in front of it, disguise included. The single source of truth for both
 * the seat rows and the flip watcher, so a card can never be animated as flipping while it is drawn
 * the other way up.
 *
 * Three cases. An undisguised seat shows its own plays, which is all this ever used to do. The Mime's
 * block shows the borrowed pile with their own later plays stacked on top of it and their earlier
 * ones dropped underneath. And the source's own block, which looks untouched, still has to hold back
 * the borrowed cards until the turn reaches it — see `mimicry.revealedPlayerIDs` for why the Reveal
 * Rule has to run per chair here rather than per play.
 */
export function getDisplayedFrontCards(
  tablePlays: BlowCowTablePlay[],
  seatID: string,
  mimicry: BlowCowWornMimicry | null,
): DisplayedFrontCard[] {
  const isWearer = mimicry?.playerID === seatID
  const borrowedPlayIDSet = new Set(isWearer ? mimicry.borrowedPlayIDs : [])
  const hiddenPlayIDSet = new Set(isWearer ? mimicry.hiddenPlayIDs : [])

  /*
   * The borrowed pile first, then whatever The Mime has played on top of it since. That is the order
   * the source's own block builds itself in, so a play lands on the copy exactly as it would have
   * landed on the original — which is the whole trick, because the block holding the turn is the one
   * that grows whichever way the coin fell. The Mime's own earlier plays are not drawn at all; they
   * are still on the table, and the table's counter still counts them.
   */
  const displayedPlays = isWearer && mimicry
    ? [
        ...tablePlays.filter((play) => borrowedPlayIDSet.has(play.id)),
        ...tablePlays.filter((play) => play.playerID === seatID && !hiddenPlayIDSet.has(play.id)),
      ]
    : tablePlays.filter((play) => play.playerID === seatID)

  const isDisguisedPair = isWearer || mimicry?.sourcePlayerID === seatID
  const heldBackCardIDSet = isDisguisedPair && mimicry && !mimicry.revealedPlayerIDs.includes(seatID)
    ? new Set(mimicry.borrowedFaceDownCardIDs)
    : new Set<string>()

  return displayedPlays.flatMap((play) => {
    const revealedCardIDSet = getExplicitlyRevealedCardIDSet(play)
    const catHiddenCardIDSet = getCatHiddenCardIDSet(play)
    const isBorrowed = play.playerID !== seatID

    return play.cards.map((card) => ({
      overlayCardID: `${isBorrowed ? 'mimic-' : ''}${play.id}-${card.id}`,
      play,
      card,
      isBorrowed,
      faceDown: heldBackCardIDSet.has(card.id)
        || catHiddenCardIDSet.has(card.id)
        || (play.revealedAtTurn === null && !revealedCardIDSet.has(card.id)),
    }))
  })
}

export function getLatestHiddenPlay(tablePlays: BlowCowTablePlay[], playerID: string | null | undefined) {
  if (!playerID) {
    return null
  }

  for (let playIndex = tablePlays.length - 1; playIndex >= 0; playIndex -= 1) {
    const play = tablePlays[playIndex]
    if (play.playerID === playerID && getHiddenOverlayCardIDs(play).length > 0) {
      return play
    }
  }

  return null
}

export function getPawnEnPassantTargetPlay(
  tablePlays: BlowCowTablePlay[],
  defaultTargetPlay: BlowCowTablePlay | null,
  currentSeatID: string | null,
) {
  if (!defaultTargetPlay || defaultTargetPlay.cards.length !== 2) {
    return null
  }

  const defaultTargetPlayIndex = tablePlays.findIndex((play) => play.id === defaultTargetPlay.id)
  if (defaultTargetPlayIndex <= 0) {
    return null
  }

  const previousPlay = tablePlays[defaultTargetPlayIndex - 1]
  if (previousPlay.playerID === currentSeatID || getHiddenOverlayCardIDs(previousPlay).length === 0) {
    return null
  }

  const latestTargetPlay = getLatestHiddenPlay(tablePlays, previousPlay.playerID)
  return latestTargetPlay?.id === previousPlay.id ? latestTargetPlay : null
}
