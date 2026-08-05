// The folder is lowercase with underscores on disk, matching the other sprite folders. Windows
// resolves this glob case-insensitively, but a Linux build would silently produce an empty map for
// the wrong casing.
const ruleSpriteModules = import.meta.glob('../../rule_card_sprites/*.png', {
  eager: true,
  import: 'default',
}) as Record<string, string>

function normalizeRuleSpriteStem(value: string) {
  return value
    .toLowerCase()
    .replace(/\.png$/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const ruleSpriteEntries = Object.entries(ruleSpriteModules).map(([path, url]) => {
  const filename = path.split('/').at(-1) ?? path

  return {
    filename,
    normalizedStem: normalizeRuleSpriteStem(filename),
    url,
  }
})

function findRuleSpriteByStem(normalizedStem: string) {
  return ruleSpriteEntries.find((entry) => entry.normalizedStem === normalizedStem)?.url
}

/**
 * Matched on the rule's plain title, never the upgraded `+` form.
 *
 * A `Rule 2.png` beside a `Rule.png` is the *upgraded* illustration, not a second revision of the
 * same art — every rule that ships one is a rule that defines an upgraded variant. So the two are
 * looked up separately rather than by the tolerant prefix match character sprites use, which took
 * whichever filename sorted first and handed every card the upgraded picture.
 *
 * The prefix match survives only as a last resort, for a rule whose base art is missing entirely.
 * Returns an empty string when there is no art at all; callers render a placeholder.
 */
export function getRuleCardSprite(ruleTitle: string, isUpgraded = false) {
  const normalizedRuleTitle = normalizeRuleSpriteStem(ruleTitle)
  if (!normalizedRuleTitle) {
    return ''
  }

  const upgradedURL = isUpgraded ? findRuleSpriteByStem(`${normalizedRuleTitle} 2`) : undefined
  const baseURL = findRuleSpriteByStem(normalizedRuleTitle)
  const suffixedURL = ruleSpriteEntries
    .find((entry) => entry.normalizedStem.startsWith(`${normalizedRuleTitle} `))?.url

  return upgradedURL ?? baseURL ?? suffixedURL ?? ''
}
