export interface Point { x: number; y: number }
export interface Listening { minutes: number; events: number }
export interface ListeningTrack { id: string; name: string; events: number; coverTone: number; milliseconds?: number; catalog?: true; sharedTitle?: true }

export const day = 86_400_000
