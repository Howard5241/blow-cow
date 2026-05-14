const defaultServerUrl = window.location.origin

export const GAME_NAME = 'blow-cow'
export const GAME_TITLE = 'Blow Cow'
export const GAME_SERVER_URL = import.meta.env.VITE_GAME_SERVER ?? defaultServerUrl
export const PLAYER_NAME_STORAGE_KEY = 'blow-cow.player-name'