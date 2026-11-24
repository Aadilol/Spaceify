import { readdir } from 'node:fs/promises'
import { URL } from 'node:url'

const files = await readdir(new URL('../dist/', import.meta.url), { withFileTypes: true })
if (files.length !== 2 || !files.some((file) => file.name === 'index.html' && file.isFile()) ||
  !files.some((file) => file.name === 'assets' && file.isDirectory())) {
  throw new Error('The Pages build must contain only index.html and the generated assets directory.')
}

const assets = await readdir(new URL('../dist/assets/', import.meta.url), { withFileTypes: true })
if (!assets.length || assets.some((asset) => !asset.isFile() || !/^[\w-]+-[\w-]{8}\.(?:js|css|svg)$/.test(asset.name))) {
  throw new Error('Unexpected file in the Pages assets directory.')
}
