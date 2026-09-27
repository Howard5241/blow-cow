import { createContext, useContext, useMemo, type ReactNode } from 'react'

/**
 * The trigger half of the shared tooltip: the context every opener reads, and the hook that turns an
 * element into one. The layer that draws the box is `src/ui/Tooltip.tsx`, which is where the whole
 * design is written down; this is split off only so the hook and the components live in separate
 * files, which is what fast refresh wants.
 */

/** Stable because the box is always mounted, so `aria-describedby` always resolves to something. */
export const TOOLTIP_ELEMENT_ID = 'blow-cow-tooltip'

export type TooltipContent = {
  title: string
  /** A node rather than a string, so a richer tooltip keeps its own rows. Optional: a title can stand alone. */
  description?: ReactNode
}

/**
 * Only `currentTarget` is read, so one set of handlers spreads onto a button, a div or a label alike
 * without being generic over the element type.
 */
type TooltipTargetEvent = { currentTarget: Element }

export type TooltipTriggerProps = {
  'aria-describedby'?: string
  onPointerEnter?: (event: TooltipTargetEvent) => void
  onPointerLeave?: (event: TooltipTargetEvent) => void
  onFocus?: (event: TooltipTargetEvent) => void
  onBlur?: (event: TooltipTargetEvent) => void
}

export type TooltipController = {
  show: (element: Element, content: TooltipContent) => void
  hide: (element: Element) => void
}

/*
 * Deliberately carries the controller and not the open tooltip. The functions on it never change
 * identity, so a trigger subscribing to this never re-renders when some other trigger opens — which
 * matters, because the board has a trigger on every card.
 */
export const TooltipControllerContext = createContext<TooltipController | null>(null)

const NO_TOOLTIP_PROPS: TooltipTriggerProps = {}

/**
 * Call once per component. The function it returns builds the props that turn an element into a
 * tooltip trigger, so spread it onto as many elements as you like:
 *
 * ```tsx
 * const tooltip = useTooltip()
 * return items.map((item) => <button {...tooltip({ title: item.name })} />)
 * ```
 *
 * A builder rather than a hook taking the content, because most triggers here are inside a `.map` and
 * a hook cannot be called in a loop. Passing null or undefined builds nothing, which is what lets a
 * caller decide per item whether there is anything to say.
 *
 * Attach it to the element the pointer actually reaches. A disabled `<button>` dispatches no pointer
 * events in most browsers, so a tooltip that explains why a control is disabled belongs on the
 * wrapper around it rather than on the control.
 */
export function useTooltip() {
  const controller = useContext(TooltipControllerContext)

  return useMemo(() => (content: TooltipContent | null | undefined): TooltipTriggerProps => {
    if (!controller || !content) {
      return NO_TOOLTIP_PROPS
    }

    return {
      'aria-describedby': TOOLTIP_ELEMENT_ID,
      onPointerEnter: (event) => {
        controller.show(event.currentTarget, content)
      },
      onPointerLeave: (event) => {
        controller.hide(event.currentTarget)
      },
      onFocus: (event) => {
        controller.show(event.currentTarget, content)
      },
      onBlur: (event) => {
        controller.hide(event.currentTarget)
      },
    }
  }, [controller])
}
