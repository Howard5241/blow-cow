const avatarModules = import.meta.glob('../../avatar_sprites/*.png', {
  eager: true,
  import: 'default',
}) as Record<string, string>

function getAvatarFileIndex(path: string) {
  const stem = path.split('/').at(-1) ?? path
  const parsedIndex = Number.parseInt(stem.replace(/[^0-9]/g, ''), 10)
  return Number.isNaN(parsedIndex) ? Number.MAX_SAFE_INTEGER : parsedIndex
}

// Files are char_1.png .. char_13.png with no zero padding, so sort numerically.
const avatarSprites = Object.entries(avatarModules)
  .map(([path, url]) => ({ index: getAvatarFileIndex(path), url }))
  .sort((leftEntry, rightEntry) => leftEntry.index - rightEntry.index)
  .map((entry) => entry.url)

export const AVATAR_SPRITE_COUNT = avatarSprites.length

// FNV-1a. Any stable string hash works here; this one is short and matches across browsers.
function hashSeed(value: string) {
  let hash = 0x811c9dc5

  for (let charIndex = 0; charIndex < value.length; charIndex += 1) {
    hash ^= value.charCodeAt(charIndex)
    hash = Math.imul(hash, 0x01000193)
  }

  return hash >>> 0
}

function createSeededRandom(seed: number) {
  let state = seed >>> 0

  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let result = Math.imul(state ^ (state >>> 15), 1 | state)
    result = (result + Math.imul(result ^ (result >>> 7), 61 | result)) ^ result
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296
  }
}

const shuffledAvatarsByMatchID = new Map<string, string[]>()

function getShuffledAvatars(matchID: string) {
  const cachedAvatars = shuffledAvatarsByMatchID.get(matchID)
  if (cachedAvatars) {
    return cachedAvatars
  }

  const nextRandom = createSeededRandom(hashSeed(matchID))
  const shuffledAvatars = [...avatarSprites]

  for (let cardIndex = shuffledAvatars.length - 1; cardIndex > 0; cardIndex -= 1) {
    const swapIndex = Math.floor(nextRandom() * (cardIndex + 1))
    const swappedAvatar = shuffledAvatars[cardIndex]
    shuffledAvatars[cardIndex] = shuffledAvatars[swapIndex]
    shuffledAvatars[swapIndex] = swappedAvatar
  }

  shuffledAvatarsByMatchID.set(matchID, shuffledAvatars)
  return shuffledAvatars
}

/**
 * Picks a stable avatar for a seat. Both inputs are identical on every client, so all
 * clients agree without the avatar ever entering game state. Player IDs are the contiguous
 * strings '0'..'n-1' and a match holds at most 8 seats against 13 sprites, so seats in the
 * same match never collide.
 *
 * Keyed on playerID rather than the player's seatIndex, because seatIndex is reshuffled at
 * startMatch and the avatar would otherwise change between staging and the live board.
 */
export function getAvatarSprite(matchID: string, playerID: string) {
  if (AVATAR_SPRITE_COUNT === 0) {
    return ''
  }

  const shuffledAvatars = getShuffledAvatars(matchID)
  const seatIndex = Number.parseInt(playerID, 10)
  const avatarIndex = Number.isNaN(seatIndex) ? hashSeed(playerID) : seatIndex

  return shuffledAvatars[avatarIndex % AVATAR_SPRITE_COUNT]
}
