import { useCallback, useEffect, useRef, useState } from 'react'

type MechanicalSound = 'rocker' | 'volume' | 'zoom'
type Sound = 'move' | 'inspect' | 'preview' | MechanicalSound

const mechanicalNotes: Record<MechanicalSound, readonly { pitch: number; delay: number; length: number; volume: number }[]> = {
  rocker: [{ pitch: 560, delay: 0, length: 0.032, volume: 0.06 }, { pitch: 240, delay: 0.021, length: 0.036, volume: 0.035 }],
  volume: [{ pitch: 146, delay: 0, length: 0.098, volume: 0.11 }, { pitch: 410, delay: 0.014, length: 0.037, volume: 0.057 }],
  zoom: [{ pitch: 115, delay: 0, length: 0.105, volume: 0.16 }, { pitch: 630, delay: 0.013, length: 0.037, volume: 0.078 }],
}

function tone(context: AudioContext, to: AudioNode, pitch: number, start: number, length: number, volume: number) {
  const oscillator = context.createOscillator()
  const envelope = context.createGain()
  oscillator.type = 'triangle'
  oscillator.frequency.value = pitch
  envelope.gain.setValueAtTime(0, start)
  envelope.gain.linearRampToValueAtTime(volume, start + 0.018)
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + length)
  oscillator.connect(envelope).connect(to)
  oscillator.start(start)
  oscillator.stop(start + length + 0.02)
  oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect() }
}

function hiss(context: AudioContext, to: AudioNode) {
  const length = Math.ceil(context.sampleRate * 0.095)
  const buffer = context.createBuffer(1, length, context.sampleRate)
  const samples = buffer.getChannelData(0)
  for (let i = 0; i < length; i++) samples[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 2 * 0.035
  const source = context.createBufferSource()
  const filter = context.createBiquadFilter()
  source.buffer = buffer
  filter.type = 'bandpass'
  filter.frequency.value = 1780
  source.connect(filter).connect(to)
  source.start()
  source.onended = () => { source.disconnect(); filter.disconnect() }
}

export function useStarAudio() {
  const context = useRef<AudioContext | null>(null)
  const output = useRef<GainNode | null>(null)
  const clip = useRef<GainNode | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const level = useRef(0)
  const request = useRef(0)
  const [volume, setVolumeState] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [error, setError] = useState(false)

  const stopPreview = useCallback(() => {
    request.current++
    clip.current?.disconnect()
    clip.current = null
    clearTimeout(timer.current)
    setPlaying(false)
  }, [])

  const applyVolume = useCallback((next: number) => {
    level.current = next
    setVolumeState(next)
    if (!output.current || !context.current) return
    const gain = output.current.gain
    const now = context.current.currentTime
    gain.cancelScheduledValues(now)
    if (next === 0) gain.setValueAtTime(0, now)
    else gain.setTargetAtTime(next / 100, now, 0.012)
  }, [])

  const play = useCallback(async (sound: Sound, seed = 0) => {
    if (level.current === 0 && sound !== 'preview') return
    if (sound === 'preview') {
      stopPreview()
      if (level.current === 0) applyVolume(25)
    }
    const version = request.current
    try {
      if (!context.current) {
        context.current = new AudioContext()
        output.current = context.current.createGain()
        output.current.gain.value = level.current / 100
        output.current.connect(context.current.destination)
      }
      const audio = context.current
      const master = output.current!
      if (audio.state !== 'running') await audio.resume()
      if (level.current === 0 || version !== request.current) return
      setError(false)
      if (sound === 'inspect') {
        hiss(audio, master)
      } else if (sound === 'move') {
        tone(audio, master, 470 + seed % 100, audio.currentTime, 0.065, 0.045)
      } else if (sound === 'preview') {
        const voice = audio.createGain()
        voice.connect(master)
        clip.current = voice
        setPlaying(true)
        const root = 110 * 2 ** ((seed % 12) / 12)
        for (const [index, interval] of [0, 7, 12, 3, 10, 7, 15].entries()) {
          const start = audio.currentTime + index * 0.32
          tone(audio, voice, root * 2 ** (interval / 12), start, 0.67, 0.11)
          if (index < 6 && index % 2 === 0) tone(audio, voice, root / 2, start, 0.84, 0.10)
        }
        timer.current = setTimeout(stopPreview, 2750)
      } else {
        for (const note of mechanicalNotes[sound]) tone(audio, master, note.pitch, audio.currentTime + note.delay, note.length, note.volume)
      }
    } catch {
      if (level.current === 0 || version !== request.current) return
      applyVolume(0)
      setPlaying(false)
      setError(true)
    }
  }, [applyVolume, stopPreview])

  function setVolume(next: number) {
    if (next === level.current) return
    applyVolume(next)
    if (next === 0) stopPreview()
    else void play('volume')
  }

  useEffect(() => () => {
    request.current++
    level.current = 0
    clearTimeout(timer.current)
    clip.current?.disconnect()
    const audio = context.current
    context.current = null
    output.current = null
    if (audio && audio.state !== 'closed') void audio.close().catch(() => {})
  }, [])

  return { volume, playing, error, play, stopPreview, setVolume }
}
