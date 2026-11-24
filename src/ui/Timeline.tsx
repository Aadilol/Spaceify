import type { MapArchive } from '../graph/archive.ts'
import type { TimelineMode } from '../graph/model.ts'

export function Timeline({ archive, year, scope, onYear, onScope }: {
  archive: MapArchive; year: number; scope: TimelineMode; onYear: (year: number) => void; onScope: (scope: TimelineMode) => void
}) {
  const first = archive.years[0]
  const last = archive.years[archive.years.length - 1]
  const summary = archive.hasMusic(year, scope)
    ? archive.demo ? 'demo listening history' : archive.publicChart ? 'owner chart, UTC' : 'imported listening history, UTC'
    : archive.demo ? 'no demo listens' : 'no music playback events'
  return (
    <section className="timeline" aria-label="Timeline">
      <div className="timeline-scope">
        <div role="group" aria-label="Timeline mode">
          <button type="button" aria-pressed={scope === 'year'} onClick={() => onScope('year')}>Year</button>
          <button type="button" aria-pressed={scope === 'through'} onClick={() => onScope('through')}>Through year</button>
        </div>
        {scope === 'through' && <span>{archive.publicChart ? 'Approximate listening time' : `${first}–${year} UTC`}</span>}
      </div>
      <input aria-label={scope === 'through' ? 'Listening through year' : 'Listening year'} type="range" min={first} max={last} step={1} value={year}
        disabled={first === last} aria-valuetext={`${scope === 'through' ? 'Through ' : ''}${year}, ${summary}`}
        onChange={(event) => onYear(event.currentTarget.valueAsNumber)} />
      <div className="timeline-years" aria-hidden="true">
        {archive.years.map((item) => (
          <span key={item} className={item === year ? 'current' : ''}
            hidden={archive.years.length > 14 && item !== first && item !== last && item !== year && item % 10 !== 0}
            style={archive.years.length > 14 ? {
              position: 'absolute', left: `${(item - first) / (last - first) * 100}%`,
              transform: `translateX(${item === first ? 0 : item === last ? -100 : -50}%)`,
            } : undefined}>{item}</span>
        ))}
      </div>
    </section>
  )
}
