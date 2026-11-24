import { useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react'

const step = 25
const pixelsPerDetent = 24

interface Turn {
  pointer: number
  x: number
  y: number
  value: number
  axis?: 'horizontal' | 'vertical'
}

export function VolumeKnob({ volume, onVolume }: { volume: number; onVolume: (volume: number) => void }) {
  const turn = useRef<Turn | null>(null)
  const [turning, setTurning] = useState(false)
  const [adjusted, setAdjusted] = useState(false)

  function adjust(value: number) {
    setAdjusted(true)
    onVolume(Math.max(0, Math.min(100, value)))
  }

  function start(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || turn.current) return
    event.currentTarget.focus({ preventScroll: true })
    event.currentTarget.setPointerCapture(event.pointerId)
    turn.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, value: volume }
    setTurning(true)
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    const gesture = turn.current
    if (!gesture || gesture.pointer !== event.pointerId) return
    const dx = event.clientX - gesture.x
    const dy = gesture.y - event.clientY
    if (!gesture.axis && Math.max(Math.abs(dx), Math.abs(dy)) >= 6) {
      gesture.axis = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical'
    }
    if (!gesture.axis) return

    const detents = Math.trunc((gesture.axis === 'horizontal' ? dx : dy) / pixelsPerDetent)
    if (!detents) return
    if (gesture.axis === 'horizontal') gesture.x += detents * pixelsPerDetent
    else gesture.y -= detents * pixelsPerDetent
    const next = Math.max(0, Math.min(100, gesture.value + detents * step))
    if (next === gesture.value) return
    gesture.value = next
    adjust(next)
  }

  function finish(event: PointerEvent<HTMLDivElement>, cancelled = false) {
    const gesture = turn.current
    if (!gesture || gesture.pointer !== event.pointerId) return
    turn.current = null
    setTurning(false)
    if (cancelled || gesture.axis) return
    const rect = event.currentTarget.getBoundingClientRect()
    adjust(gesture.value + (event.clientX >= rect.left + rect.width / 2 ? step : -step))
  }

  function key(event: KeyboardEvent<HTMLDivElement>) {
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowUp': adjust(volume + step); break
      case 'ArrowLeft':
      case 'ArrowDown': adjust(volume - step); break
      case 'Home': adjust(0); break
      case 'End': adjust(100); break
      default: return
    }
    event.preventDefault()
  }

  return (
    <div className="volume-control">
      <div className="volume-knob" role="slider" tabIndex={0} aria-label="Volume" aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={volume} aria-valuetext={volume === 0 ? '0 percent, muted' : `${volume} percent`}
        aria-description="Drag up or right to raise the volume, or down or left to lower it. Arrow keys adjust by 25 percent."
        data-turning={turning} style={{ '--volume-angle': `${-120 + volume * 2.4}deg` } as CSSProperties}
        onPointerDown={start} onPointerMove={move} onPointerUp={(event) => finish(event)}
        onPointerCancel={(event) => finish(event, true)} onLostPointerCapture={(event) => finish(event, true)} onKeyDown={key}>
        <span className="volume-bezel" aria-hidden="true">
          {[0, 25, 50, 75, 100].map((mark) => (
            <i key={mark} className="volume-tick" data-current={mark === volume} style={{ transform: `rotate(${-120 + mark * 2.4}deg)` }} />
          ))}
          <span key={volume} className={adjusted ? 'volume-face volume-detent' : 'volume-face'}><i /></span>
        </span>
      </div>
      <span className="volume-readout" aria-hidden="true"><strong>{volume}%</strong></span>
    </div>
  )
}
