const defaultServerUrl = window.location.origin

export const GAME_NAME = 'blow-cow'
export const GAME_TITLE = 'Blow Cow'
export const GAME_SERVER_URL = import.meta.env.VITE_GAME_SERVER ?? defaultServerUrl
export const PLAYER_NAME_STORAGE_KEY = 'blow-cow.player-name'
/**
 * The seat this browser last held. Kept so a reload — after a server restart, a dropped connection,
 * or a stray refresh — walks straight back to the table instead of the lobby. The server persists
 * matches and the credentials in them, so the stored seat stays valid across a restart.
 */
export const ACTIVE_ROOM_STORAGE_KEY = 'blow-cow.active-room'