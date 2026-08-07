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
  const normalizedStem = normalizeCharacterSpriteStem(filename)
  const suffixMatch = /\s(\d+)$/.exec(normalizedStem)

  return {
    filename,
    normalizedStem,
    /** The trailing number in the filename, or null for the unsuffixed base art. */
    suffixNumber: suffixMatch ? Number(suffixMatch[1]) : null,
    url,
  }
})

function getCharacterSpriteMatches(characterName: BlowCowCharacterName | string | null) {
  if (!characterName) {
    return []
  }

  const normalizedCharacterName = normalizeCharacterSpriteStem(characterName)

  return characterSpriteEntries.filter((entry) => {
    return entry.normalizedStem === normalizedCharacterName
      || entry.normalizedStem.startsWith(`${normalizedCharacterName} `)
  })
}

/**
 * Every sprite belonging to one character, in the order they should be shown.
 *
 * Usually one file. A suffix after the name normally only marks a newer revision of the same art —
 * `The Cat 2.png` supersedes a `The Cat.png` that no longer ships — so a suffixed file on its own is
 * still one still picture. A run that starts at `1` is the exception and the only one: a revision is
 * never numbered 1, because the first of them is the unsuffixed file, so `The Prototype 1/2/3.png`
 * can only be the frames of one animation.
 */
export function getCharacterCardSpriteFrames(characterName: BlowCowCharacterName | string | null) {
  const matches = getCharacterSpriteMatches(characterName)
  const numberedFrames = matches
    .filter((entry) => entry.suffixNumber !== null)
    .sort((left, right) => (left.suffixNumber ?? 0) - (right.suffixNumber ?? 0))

  if (numberedFrames.length > 1 && numberedFrames[0].suffixNumber === 1) {
    return numberedFrames.map((entry) => entry.url)
  }

  const stillSprite = getCharacterCardSprite(characterName)

  return stillSprite ? [stillSprite] : []
}

export function getCharacterCardSprite(characterName: BlowCowCharacterName | string | null) {
  return getCharacterSpriteMatches(characterName)[0]?.url ?? ''
}
