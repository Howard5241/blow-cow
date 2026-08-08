import { getStatusDefinition, type BlowCowStatusID } from '../game/blowCowStatuses.ts'

const statusModules = import.meta.glob('../../status_sprites/*.png', {
  eager: true,
  import: 'default',
}) as Record<string, string>

const statusMap = Object.fromEntries(
  Object.entries(statusModules).map(([path, url]) => [path.split('/').at(-1) ?? path, url]),
)

/** The filename comes off the definition, so renaming the art is a one-line change in one file. */
export function getStatusSprite(statusID: BlowCowStatusID) {
  return statusMap[getStatusDefinition(statusID).sprite] ?? ''
}
