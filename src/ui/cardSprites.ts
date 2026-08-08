const spriteModules = import.meta.glob('../../card_sprites/*.png', {
  eager: true,
  import: 'default',
}) as Record<string, string>

const rectSpriteModules = import.meta.glob('../../rect_card_sprites/*.png', {
  eager: true,
  import: 'default',
}) as Record<string, string>

function createSpriteMap(modules: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(modules).map(([path, url]) => [path.split('/').at(-1) ?? path, url]),
  )
}

const spriteMap = createSpriteMap(spriteModules)
const rectSpriteMap = createSpriteMap(rectSpriteModules)

export const CARD_BACK_FILENAME = 'back01.png'
/**
 * A card that is face up on the table but unreadable to this viewer, which today means the Blind
 * status. Deliberately not the card back: the card is still face up, and drawing a back would say a
 * card had been turned over rather than that the viewer cannot make it out.
 */
export const UNKNOWN_CARD_FILENAME = 'unknown.png'

const rankLabels: Record<string, string> = {
  '02': '2',
  '03': '3',
  '04': '4',
  '05': '5',
  '06': '6',
  '07': '7',
  '08': '8',
  '09': '9',
  '10': '10',
  ace: 'Ace',
  jack: 'Jack',
  queen: 'Queen',
  king: 'King',
}

export function getCardSprite(filename: string) {
  return spriteMap[filename] ?? spriteMap[CARD_BACK_FILENAME] ?? ''
}

export function getFrontCardSprite(filename: string) {
  return rectSpriteMap[filename]
    ?? spriteMap[filename]
    ?? rectSpriteMap[CARD_BACK_FILENAME]
    ?? spriteMap[CARD_BACK_FILENAME]
    ?? ''
}

export function getCardLabel(filename: string) {
  if (filename === CARD_BACK_FILENAME) {
    return 'Face-down card'
  }

  if (filename === UNKNOWN_CARD_FILENAME) {
    return 'Unreadable card'
  }

  if (filename === 'Joker1.png' || filename === 'Joker2.png') {
    return 'Joker'
  }

  const stem = filename.replace('.png', '')
  const [suit, rawRank] = stem.split('_')
  const prettyRank = rankLabels[rawRank] ?? rawRank
  const prettySuit = suit ? suit[0].toUpperCase() + suit.slice(1) : 'Card'

  return `${prettyRank} of ${prettySuit}`
}