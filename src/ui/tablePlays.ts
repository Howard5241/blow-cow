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
