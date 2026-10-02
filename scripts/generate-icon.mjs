import { copyFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const dir = path.resolve('resources')
mkdirSync(dir, { recursive: true })
copyFileSync(path.join(dir, 'logo.png'), path.join(dir, 'icon.png'))
copyFileSync(path.join(dir, 'logo.png'), path.resolve('public', 'logo.png'))
console.log('Copied resources/logo.png to the app icon')
