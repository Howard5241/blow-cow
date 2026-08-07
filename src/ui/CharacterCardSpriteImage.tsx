import { useEffect, useState } from 'react'

/**
 * How long each frame of a multi-frame character card holds. Slow enough to read the art, fast
 * enough that the card reads as one moving picture rather than three cards swapping places.
 */
const CHARACTER_SPRITE_FRAME_INTERVAL_MS = 300

type CharacterCardSpriteImageProps = {
  alt: string
  className?: string
  /** Every frame of this character's art, in order. One entry is the ordinary case. */
  frames: string[]
}

/**
 * One character card, animated when its art ships as more than one frame. A single-frame character
 * renders exactly as a plain `<img>` would and starts no timer, so this costs nothing on the cards
 * that do not move.
 */
export function CharacterCardSpriteImage({ alt, className, frames }: CharacterCardSpriteImageProps) {
  const [frameIndex, setFrameIndex] = useState(0)
  const frameCount = frames.length
  // The frame list is rebuilt on every render at most call sites, so the timer keys off the URLs
  // themselves rather than the array holding them.
  const framesKey = frames.join('|')

  useEffect(() => {
    const frameURLs = framesKey.split('|')
    if (frameURLs.length < 2) {
      return
    }

    // The later frames are only fetched when the browser first paints them, which would blank the
    // card for one beat partway through the opening loop. Asking for them up front avoids that.
    for (const frameURL of frameURLs) {
      const preloadImage = new Image()
      preloadImage.src = frameURL
    }

    const intervalID = window.setInterval(() => {
      // Left to grow and wrapped at render time, so changing cards never needs a state write from
      // inside an effect to put the counter back to zero.
      setFrameIndex((previousFrameIndex) => previousFrameIndex + 1)
    }, CHARACTER_SPRITE_FRAME_INTERVAL_MS)

    return () => {
      window.clearInterval(intervalID)
    }
  }, [framesKey])

  if (frameCount === 0) {
    return null
  }

  return <img alt={alt} className={className} src={frames[frameIndex % frameCount]} />
}
