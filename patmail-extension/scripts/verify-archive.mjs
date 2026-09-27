import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { forbiddenDeliveryNames } from './delivery-guard.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const sourceRoots = ['src/', 'tests/', 'docs/', 'scripts/', 'package.json', 'pnpm-lock.yaml', 'tsconfig.json', 'vite.config.ts', 'vite.content.config.ts', 'manifest.json', 'app.html', 'README.md', '.gitignore']

function normalize(name) {
  return name.replace(/\\/g, '/')
}

function officialKind(name) {
  const normalized = normalize(name)
  if (normalized.startsWith('dist/')) return 'delivery'
  if (sourceRoots.some(prefix => normalized === prefix.replace(/\/$/, '') || normalized.startsWith(prefix))) return 'source'
  return null
}

function listArchive(archive) {
  const listed = spawnSync('tar', ['-tf', archive], { encoding: 'utf8' })
  if (listed.status !== 0) {
    console.error('压缩包无法列出内容。')
    process.exit(listed.status ?? 1)
  }
  return listed.stdout.split(/\r?\n/).map(normalize).filter(Boolean)
}

const requested = process.argv.slice(2)
const targets = requested.length > 0
  ? requested
  : [join(root, 'test-results/patmail-source.zip'), join(root, 'test-results/patmail-delivery.zip')]

for (const archive of targets) {
  if (!existsSync(archive)) {
    console.error('找不到要检查的压缩包。请先执行 pnpm pack:source 和 pnpm pack:delivery，或传入压缩包路径。')
    process.exit(1)
  }
  const names = listArchive(archive)
  const blocked = forbiddenDeliveryNames(names)
  if (blocked.length > 0) {
    console.error(`压缩包含不能交付的文件名 ${blocked.length} 个，已停止。`)
    process.exit(1)
  }
  const outside = names.filter(name => !name.endsWith('/') && !officialKind(name))
  if (outside.length > 0) {
    console.error(`压缩包有 ${outside.length} 个路径不在 pack:source 或 pack:delivery 白名单中。手工整包不能代替正式交付。`)
    process.exit(1)
  }
  console.log(`archive checked: ${names.length}`)
}
