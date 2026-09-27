import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { forbiddenDeliveryNames } from './delivery-guard.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const outputDir = join(root, 'test-results')
mkdirSync(outputDir, { recursive: true })
const output = join(outputDir, 'patmail-source.zip')
const include = [
  'src',
  'tests',
  'docs',
  'scripts',
  'package.json',
  'pnpm-lock.yaml',
  'tsconfig.json',
  'vite.config.ts',
  'vite.content.config.ts',
  'manifest.json',
  'app.html',
  'README.md',
  '.gitignore'
].filter(name => existsSync(join(root, name)))

const present = include.filter(name => existsSync(join(root, name)))
if (present.some(name => name.toLowerCase().endsWith('.pem'))) {
  console.error('拒绝打包：白名单里出现了私钥文件名。')
  process.exit(1)
}

const packed = spawnSync('tar', ['-a', '-c', '-f', output, ...present], { cwd: root, encoding: 'utf8' })
if (packed.status !== 0) {
  console.error(packed.stderr || '源码包没有生成。')
  process.exit(packed.status ?? 1)
}
const listed = spawnSync('tar', ['-tf', output], { cwd: root, encoding: 'utf8' })
if (listed.status !== 0) {
  console.error('源码包无法列出内容。')
  process.exit(listed.status ?? 1)
}
const names = listed.stdout.split(/\r?\n/).filter(Boolean)
const blocked = forbiddenDeliveryNames(names)
if (blocked.length > 0) {
  console.error(`源码包含有不能交付的文件名 ${blocked.length} 个，已停止。`)
  process.exit(1)
}
console.log(`source package entries: ${names.length}`)
