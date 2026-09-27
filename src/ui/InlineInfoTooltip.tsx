import { useTooltip } from './tooltipContext.ts'

/**
 * The small `i` that sits beside a heading or a number and explains it.
 *
 * It carries no tooltip markup of its own any more — it is a trigger and nothing else. The old
 * `alignment` prop went with that: the shared layer measures the viewport, so an `i` near an edge no
 * longer has to be told which way to open.
 */
export function InlineInfoTooltip({
  description,
  title,
}: {
  description: string
  title: string
}) {
  const tooltip = useTooltip()

  return (
    <span
      aria-label={`${title}: ${description}`}
      className="inline-info-trigger"
      tabIndex={0}
      {...tooltip({ title, description })}
    >
      <span aria-hidden="true" className="inline-info-icon">i</span>
    </span>
  )
}
