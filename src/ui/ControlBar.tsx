import { useState } from 'react'
import type { CSSProperties, Ref } from 'react'
import { ink, isInk, paper } from '../graph/dither.ts'
import { maxListened } from '../graph/model.ts'
import type { ChartDensity, LayoutMode, View } from '../graph/model.ts'
import { VolumeKnob } from './VolumeKnob.tsx'
import './controls.css'

function texture(size: number, density: (x: number, y: number) => number): string {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) return 'none'
  context.fillStyle = paper
  context.fillRect(0, 0, size, size)
  context.fillStyle = ink
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (isInk(x, y, density(x, y))) context.fillRect(x, y, 1, 1)
    }
  }
  return `url(${canvas.toDataURL()})`
}

let textures: CSSProperties | undefined

function controlTextures(): CSSProperties {
  textures ??= {
    '--raised-dither': texture(8, () => 0.89),
    '--recessed-dither': texture(8, () => 0.13),
    '--well-dither': texture(8, () => 0.34),
    '--dial-dither': texture(48, (x, y) => {
      const dx = x - 23.5
      const dy = y - 23.5
      const radius = Math.hypot(dx, dy)
      if (radius > 16) return 0.46 + 0.23 * Math.cos(Math.atan2(dy, dx) * 28) - (dx + dy) / 155
      return 0.91 - (dx + dy) / 190
    }),
  } as CSSProperties
  return textures
}

interface Props {
  view: View
  mode: LayoutMode
  density: ChartDensity
  canGroup: boolean
  volume: number
  showImages: boolean
  expanded: boolean
  status: string
  indexRef: Ref<HTMLButtonElement>
  onView: (view: View) => void
  onMode: (mode: LayoutMode) => void
  onDensity: (density: ChartDensity) => void
  onVolume: (volume: number) => void
  onImages: () => void
  onIndex: () => void
}

const views = ['Artist', 'Album'] as const
const layouts = ['Hours', 'Genre'] as const
const densities = ['Explore', 'Focus'] as const

export function ControlBar({ view, mode, density, canGroup, volume, showImages, expanded, status, indexRef, onView, onMode, onDensity, onVolume, onImages, onIndex }: Props) {
  const [style] = useState(controlTextures)

  return (
    <header className="atlas-header" style={style}>
      <p className="atlas-message" role="status">{status}</p>
      <div className="control-bank">
        <div className="control-pair chart-rockers">
          <div className="control-rocker" role="group" aria-label="Chart view">
            {views.map((item) => (
              <button className="rocker-face face-press" type="button" key={item} aria-pressed={view === item} onClick={() => onView(item)}>
                <span>{item}</span>
              </button>
            ))}
          </div>
          <div className="control-rocker" role="group" aria-label="Chart layout"
            title={canGroup ? undefined : 'Genre layout needs at least two groups in this period.'}>
            {layouts.map((item) => (
              <button className="rocker-face face-press" type="button" key={item} aria-pressed={mode === item}
                disabled={item === 'Genre' && !canGroup} onClick={() => onMode(item)}><span>{item}</span></button>
            ))}
          </div>
          <div className="control-rocker" role="group" aria-label="Chart density">
            {densities.map((item) => (
              <button className="rocker-face face-press" type="button" key={item} aria-pressed={density === item}
                title={item === 'Explore' ? 'Show the full listening archive' : 'Show the ' + maxListened + ' most-listened entries for this period'}
                onClick={() => onDensity(item)}><span>{item}</span></button>
            ))}
          </div>
        </div>
        <div className="control-pair control-actions">
          <button type="button" className="image-toggle index-toggle face-press" data-image-view={showImages}
            title={showImages ? 'Switch to star view' : 'Switch to image view'}
            onClick={onImages}><span>{showImages ? 'Star' : 'Image'}</span></button>
          <VolumeKnob volume={volume} onVolume={onVolume} />
          <button ref={indexRef} type="button" className="index-toggle face-press" aria-expanded={expanded} aria-controls="graph-inspector"
            aria-label={expanded ? 'Close star index' : 'Open star index'} onClick={onIndex}>
            {expanded ? '[ Close ]' : '[ Index ]'}
          </button>
        </div>
      </div>
    </header>
  )
}
