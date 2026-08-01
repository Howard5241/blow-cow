import { useCallback, useEffect, useRef, useState } from 'react'

export type TransientMessage = {
  id: string
  text: string
}

/**
 * Holds a short-lived message that clears itself. The id increments on every show so that
 * repeating the same text still produces a new React key, which restarts the CSS animation
 * and re-fires the live-region announcement.
 */
export function useTransientMessage(durationMs: number) {
  const [message, setMessage] = useState<TransientMessage | null>(null)
  const nextMessageIDRef = useRef(0)

  const messageID = message?.id ?? null

  useEffect(() => {
    if (!messageID) {
      return
    }

    const timeoutID = window.setTimeout(() => {
      setMessage(null)
    }, durationMs)

    return () => {
      window.clearTimeout(timeoutID)
    }
  }, [messageID, durationMs])

  const showMessage = useCallback((text: string) => {
    nextMessageIDRef.current += 1
    setMessage({ id: `transient-${nextMessageIDRef.current}`, text })
  }, [])

  const clearMessage = useCallback(() => {
    setMessage(null)
  }, [])

  return { message, showMessage, clearMessage }
}
