export const ink = '#f0f0f0'
export const paper = '#0a0a0a'
export const mono = 'Consolas, monospace'

const bayer = [
  0, 32, 8, 40, 2, 34, 10, 42,
  48, 16, 56, 24, 50, 18, 58, 26,
  12, 44, 4, 36, 14, 46, 6, 38,
  60, 28, 52, 20, 62, 30, 54, 22,
  3, 35, 11, 43, 1, 33, 9, 41,
  51, 19, 59, 27, 49, 17, 57, 25,
  15, 47, 7, 39, 13, 45, 5, 37,
  63, 31, 55, 23, 61, 29, 53, 21,
]

export function isInk(x: number, y: number, density: number): boolean {
  return density * 64 > bayer[(y & 7) * 8 + (x & 7)] + 0.5
}
