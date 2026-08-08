import { BLOW_COW_EMOTE_COUNT } from '../game/blowCowGame.ts'

const emoteModules = import.meta.glob('../../emote_sprites/*.png', {
  eager: true,
  import: 'default',
}) as Record<string, string>

/** The `(n)` in `bunny (7).png`, which is the emote id the server accepts. Null for anything else. */
function getEmoteID(path: string) {
  const filename = path.split('/').at(-1) ?? path
  const match = /\((\d+)\)\.png$/i.exec(filename)

  return match ? Number.parseInt(match[1], 10) : null
}

/*
 * A sprite that carries no id, or one outside the range `resolveEmote` allows, is dropped rather
 * than shown: the picker sends the id straight to the server, so an unnumbered file would either
 * collide with another unnumbered one or arm a button whose move is always refused.
 */
export const EMOTE_SPRITES = Object.entries(emoteModules)
  .map(([path, url]) => ({ id: getEmoteID(path), url }))
  .filter((emote): emote is { id: number, url: string } => (
    emote.id !== null && emote.id >= 1 && emote.id <= BLOW_COW_EMOTE_COUNT
  ))
  .sort((leftEmote, rightEmote) => leftEmote.id - rightEmote.id)

export function getEmoteSprite(emoteID: number) {
  return EMOTE_SPRITES.find((emote) => emote.id === emoteID)?.url ?? ''
}
