// The folder name is capitalised on disk. Windows resolves this glob case-insensitively,
// but a Linux build would silently produce an empty map for the wrong casing.
const iconModules = import.meta.glob('../../Icon_sprites/*.png', {
  eager: true,
  import: 'default',
}) as Record<string, string>

const iconMap = Object.fromEntries(
  Object.entries(iconModules).map(([path, url]) => [path.split('/').at(-1) ?? path, url]),
)

export const CARDS_ICON_SPRITE = iconMap['cards_icon.png'] ?? ''
export const POINT_ICON_SPRITE = iconMap['point_icon.png'] ?? ''
// Drawn clockwise; the counterclockwise state mirrors it in CSS rather than shipping a second file.
export const DIRECTION_ARROW_ICON_SPRITE = iconMap['clockwise_arrow_icon.png'] ?? ''
export const PLAY_ICON_SPRITE = iconMap['play_icon.png'] ?? ''
export const PLAY_RANDOM_ICON_SPRITE = iconMap['play_random_icon.png'] ?? ''
export const SNEAK_PLAY_ICON_SPRITE = iconMap['sneak_play_icon.png'] ?? ''
export const PASS_ICON_SPRITE = iconMap['pass_icon.png'] ?? ''
export const RESET_ICON_SPRITE = iconMap['reset_icon.png'] ?? ''
export const DEFY_ICON_SPRITE = iconMap['defy_icon.png'] ?? ''
export const CONSPIRE_ICON_SPRITE = iconMap['conspire_icon.png'] ?? ''
export const MANIPULATE_ICON_SPRITE = iconMap['manipulate_icon.png'] ?? ''
export const MIMIC_ICON_SPRITE = iconMap['mimic_icon.png'] ?? ''
// A square outline drawn with ~8% transparent padding, so it is stretched slightly past the seat
// block for the drawn frame to land on the block's own edge.
export const BLOCK_HOVER_ICON_SPRITE = iconMap['block_hover_icon.png'] ?? ''
export const BS_TARGET_ICON_SPRITE = iconMap['BS_target_icon.png'] ?? ''
export const X_ICON_SPRITE = iconMap['x_icon.png'] ?? ''
// The three toolbar controls above the action row. Each carries its own accent colour in CSS.
export const RULES_ICON_SPRITE = iconMap['rules_icon.png'] ?? ''
export const HISTORY_ICON_SPRITE = iconMap['history_icon.png'] ?? ''
export const LEAVE_ROOM_ICON_SPRITE = iconMap['leave_room_icon.png'] ?? ''
