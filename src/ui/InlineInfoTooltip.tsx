type InlineInfoAlignment = 'center' | 'start' | 'end'

export function InlineInfoTooltip({
  alignment = 'center',
  tooltip,
}: {
  alignment?: InlineInfoAlignment
  tooltip: string
}) {
  return (
    <span aria-label={tooltip} className={`inline-info-trigger align-${alignment}`} tabIndex={0}>
      <span aria-hidden="true" className="inline-info-icon">i</span>
      <span className="inline-info-tooltip" role="tooltip">{tooltip}</span>
    </span>
  )
}
