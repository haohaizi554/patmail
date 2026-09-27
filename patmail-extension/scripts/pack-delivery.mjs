import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { forbiddenDeliveryName, forbiddenDeliveryNames } from './delivery-guard.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const outputDir = join(root, 'test-results')
mkdirSync(outputDir, { recursive: true })
const output = join(outputDir, 'patmail-delivery.zip')
const dist = join(root, 'dist')
if (!existsSync(dist)) {
  console.error('还没有构建产物，请先执行 pnpm build。')
  process.exit(1)
}

function walk(directory, base) {
  const names = []
  for (const name of readdirSync(directory)) {
    const absolute = join(directory, name)
    const relative = join(base, name)
    if (statSync(absolute).isDirectory()) names.push(...walk(absolute, relative))
    else names.push(relative)
  }
  return names
}

const candidates = walk(dist, 'dist')
const rejected = candidates.filter(name => forbiddenDeliveryName(name))
if (rejected.length > 0) {
  console.error(`构建目录里有 ${rejected.length} 个不能交付的文件名，已停止。`)
  process.exit(1)
}
const packed = spawnSync('tar', ['-a', '-c', '-f', output, ...candidates], { cwd: root, encoding: 'utf8' })
if (packed.status !== 0) {
  console.error(packed.stderr || '交付包没有生成。')
  process.exit(packed.status ?? 1)
}
const listed = spawnSync('tar', ['-tf', output], { cwd: root, encoding: 'utf8' })
if (listed.status !== 0) {
  console.error('交付包无法列出内容。')
  process.exit(listed.status ?? 1)
}
const names = listed.stdout.split(/\r?\n/).filter(Boolean)
const blocked = forbiddenDeliveryNames(names)
if (blocked.length > 0) {
  console.error(`交付包包含不能对外提供的文件名 ${blocked.length} 个，已停止。`)
  process.exit(1)
}
console.log(`delivery package entries: ${names.length}`)
