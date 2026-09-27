import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  TOOLTIP_ELEMENT_ID,
  TooltipControllerContext,
  type TooltipContent,
  type TooltipController,
} from './tooltipContext.ts'

/**
 * The one tooltip on the page.
 *
 * Every tooltip in the app is the same shape — a title with a description under it — and every one of
 * them used to be a `position: absolute` span inside whatever opened it, shown by a `:hover` rule.
 * That meant six near-identical CSS blocks, and it meant each tooltip lived inside its opener's
 * clipping and stacking context: the action row's was cut off by `.hand-stage`, and the seat status
 * column's needed a set of `[data-seat-half]` rules just to stay on screen.
 *
 * This replaces all of it with one box, portalled to `document.body` so no ancestor's `overflow`,
 * `transform` or `z-index` can reach it, and positioned against the viewport at open time so it can
 * never be cut off by an edge either. Openers carry no markup of their own — `useTooltip` in
 * `./tooltipContext.ts` hands them four event props and nothing else.
 */

/** Clearance kept from every viewport edge. Paired with the box's own `max-width` in CSS. */
const VIEWPORT_MARGIN = 12
/** Gap between the box and the element that opened it. */
const ANCHOR_GAP = 10

type TooltipPlacement = {
  left: number
  top: number
  side: 'above' | 'below'
}

type TooltipRequest = {
  content: TooltipContent
  /** Measured when the tooltip opens. Any scroll or resize closes it rather than invalidating this. */
  anchor: DOMRect
}

/**
 * Puts the box on screen: above the trigger by preference, below when there is no room above, and
 * clamped on both axes so no edge can ever cut it off.
 *
 * Measured rather than guessed, which is why the caller reads the box's own `offsetWidth`/
 * `offsetHeight` — those ignore the transform that positions it, so the reading stays the natural
 * size on every pass.
 */
function getTooltipPlacement(anchor: DOMRect, width: number, height: number): TooltipPlacement {
  const spaceAbove = anchor.top - VIEWPORT_MARGIN - ANCHOR_GAP
  const spaceBelow = window.innerHeight - anchor.bottom - VIEWPORT_MARGIN - ANCHOR_GAP
  // Below only when above genuinely cannot hold it and below is the roomier of the two. A tooltip
  // taller than both still opens above, because that is where the reader is already looking.
  const side = height <= spaceAbove || spaceAbove >= spaceBelow ? 'above' : 'below'

  const unclampedTop = side === 'above' ? anchor.top - ANCHOR_GAP - height : anchor.bottom + ANCHOR_GAP
  const unclampedLeft = anchor.left + anchor.width / 2 - width / 2
  const maxTop = Math.max(VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN)
  const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN)

  return {
    left: Math.round(Math.min(Math.max(VIEWPORT_MARGIN, unclampedLeft), maxLeft)),
    top: Math.round(Math.min(Math.max(VIEWPORT_MARGIN, unclampedTop), maxTop)),
    side,
  }
}

function TooltipLayer({ request }: { request: TooltipRequest | null }) {
  const boxRef = useRef<HTMLDivElement | null>(null)
  const [placement, setPlacement] = useState<TooltipPlacement | null>(null)

  useLayoutEffect(() => {
    const box = boxRef.current
    if (!request || !box) {
      setPlacement(null)
      return
    }

    setPlacement(getTooltipPlacement(request.anchor, box.offsetWidth, box.offsetHeight))
  }, [request])

  /*
   * Always mounted, so `aria-describedby` on every trigger resolves whether or not anything is open,
   * and hidden with `visibility` rather than `display` so the box still has the layout box the
   * measurement above reads. It is invisible until placed, which is what stops a frame at the corner.
   */
  return (
    <div
      className={`tooltip-box${request && placement ? ' open' : ''}${placement ? ` ${placement.side}` : ''}`}
      id={TOOLTIP_ELEMENT_ID}
      ref={boxRef}
      role="tooltip"
      style={placement ? { transform: `translate3d(${placement.left}px, ${placement.top}px, 0)` } : undefined}
    >
      {request ? (
        <>
          <p className="tooltip-title">{request.content.title}</p>
          {request.content.description === undefined || request.content.description === null ? null : (
            <div className="tooltip-description">{request.content.description}</div>
          )}
        </>
      ) : null}
    </div>
  )
}

export function TooltipProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<TooltipRequest | null>(null)
  /*
   * Which element the open tooltip belongs to. Without it, moving the pointer from one trigger
   * straight onto another closes the second one: the first trigger's `pointerleave` arrives after
   * the second's `pointerenter`, and would otherwise clear the state that had just been set.
   */
  const anchorElementRef = useRef<Element | null>(null)

  const controller = useMemo<TooltipController>(() => ({
    show: (element, content) => {
      anchorElementRef.current = element
      setRequest({ content, anchor: element.getBoundingClientRect() })
    },
    hide: (element) => {
      if (anchorElementRef.current !== element) {
        return
      }

      anchorElementRef.current = null
      setRequest(null)
    },
  }), [])

  /*
   * A measured anchor goes stale the moment anything moves, and re-measuring every frame would cost
   * more than the tooltip is worth. Closing is both cheaper and what a reader expects: scrolling the
   * hand strip or the lobby is not a request to keep reading.
   */
  useEffect(() => {
    if (!request) {
      return
    }

    const close = () => {
      anchorElementRef.current = null
      setRequest(null)
    }

    /*
     * A mouse click closes it too, and that is not just tidiness: an element removed while the
     * pointer is still on it — a card played out of the hand — never fires `pointerleave`, so its
     * tooltip would be left standing over nothing. Restricted to the mouse because on a touch screen
     * `pointerdown` arrives *after* the `pointerenter` that opened it, and closing there would mean
     * a tap could never show one at all.
     */
    const closeOnMouseDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse') {
        close()
      }
    }

    // Captured, because the scroll that matters is usually on an inner element rather than the page.
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    window.addEventListener('pointerdown', closeOnMouseDown, true)

    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('pointerdown', closeOnMouseDown, true)
    }
  }, [request])

  return (
    <TooltipControllerContext.Provider value={controller}>
      {children}
      {createPortal(<TooltipLayer request={request} />, document.body)}
    </TooltipControllerContext.Provider>
  )
}
