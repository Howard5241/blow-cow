import type { BlowCowCharacterName } from '../game/blowCowCharacters.ts'

const characterSpriteModules = import.meta.glob('../../character_card_sprites/*.png', {
  eager: true,
  import: 'default',
}) as Record<string, string>

function normalizeCharacterSpriteStem(value: string) {
  return value
    .toLowerCase()
    .replace(/\.png$/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const characterSpriteEntries = Object.entries(characterSpriteModules).map(([path, url]) => {
  const filename = path.split('/').at(-1) ?? path

  return {
    filename,
    normalizedStem: normalizeCharacterSpriteStem(filename),
    url,
  }
})

export function getCharacterCardSprite(characterName: BlowCowCharacterName | null) {
  if (!characterName) {
    return ''
  }

  const normalizedCharacterName = normalizeCharacterSpriteStem(characterName)

  return characterSpriteEntries.find((entry) => {
    return entry.normalizedStem === normalizedCharacterName
      || entry.normalizedStem.startsWith(`${normalizedCharacterName} `)
  })?.url ?? ''
}