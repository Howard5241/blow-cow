/**
 * Room-level rules the lobby UI and the server's clear route both have to agree on.
 *
 * Kept in its own module rather than duplicated because the two callers see the same match from
 * different angles — the server holds seats keyed by player ID, the browser gets the array
 * `createClientMatchData` builds — and a disagreement would show up as a button that offers
 * something the server then refuses.
 */

export type BlowCowRoomSeat = {
  isConnected?: boolean
}

export type BlowCowClearableRoom = {
  players: readonly BlowCowRoomSeat[]
  /**
   * boardgame.io writes the game's final payload here when the match ends, and it survives to the
   * browser because the lobby's match serializer spreads the whole metadata object. Its presence is
   * the only thing either side needs — the contents are the game's business, not the lobby's.
   */
  gameover?: unknown
}

export function hasRoomGameEnded(room: BlowCowClearableRoom) {
  return room.gameover !== undefined && room.gameover !== null
}

/**
 * Why this room may not be cleared, or `null` when it may be.
 *
 * Clearing wipes a persisted match outright, so the rule stays narrow: a room is fair game once its
 * game has ended, or while nobody is connected to it. A table with players still at it is somebody's
 * game in progress and is never anyone else's to delete.
 *
 * "Nobody connected" rather than "no seats claimed" is what makes the first rule useful at all —
 * boardgame.io deletes a match the moment its last named player leaves through the lobby, so a room
 * still on the list always has claimed seats. What it does not always have is anyone present.
 *
 * A reason string rather than a boolean, so the disabled button and the server's 409 say the same
 * thing without the wording being written twice.
 */
export function getRoomClearBlockReason(room: BlowCowClearableRoom): string | null {
  if (hasRoomGameEnded(room)) {
    return null
  }

  return room.players.some((seat) => seat.isConnected === true)
    ? 'Someone is still in this room.'
    : null
}
