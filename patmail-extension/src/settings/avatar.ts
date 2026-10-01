import { isEasyOrigin } from '../api/config'
import { isConfirmedOperator } from '../automation/operator'

export const AVATAR_STORAGE_PREFIX = 'patmail.avatar.v1'
export const UPLOAD_LIBRARY_PREFIX = 'patmail.avatar.uploads.v1'
export const UPLOAD_LIBRARY_LIMIT = 12
export const BROWSER_AVATAR_KEY = 'patmail.avatar.browserDefault.v1'
export const AVATAR_PRESET_IDS = Array.from({ length: 20 }, (_, index) => `avatar-${String(index + 1).padStart(2, '0')}`)
const PRESET_ID = /^avatar-(0[1-9]|1\d|20)$/
const STORED_IMAGE = /^data:image\/(jpeg|png|webp);base64,/
export const MAX_AVATAR_DATA_URL = 160_000

export interface AvatarArea {
  get(key: string): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
  remove(key: string): Promise<void>
}

export interface SavedUpload {
  id: string
  image: string
}

export type StoredAvatar =
  | { kind: 'preset'; id: string }
  | { kind: 'upload'; id: string; image: string }

export interface CropRect {
  sx: number
  sy: number
  side: number
}

/** 宽图裁左右，高图裁上下，正方形不动。取景始终在画面正中。 */
export function centerCropRect(width: number, height: number): CropRect {
  const side = Math.max(1, Math.floor(Math.min(width, height)))
  return {
    side,
    sx: Math.floor((width - side) / 2),
    sy: Math.floor((height - side) / 2),
  }
}

export function uploadLibraryKey(origin: string, operatorId: string): string | null {
  const key = avatarStorageKey(origin, operatorId)
  if (!key) return null
  return `${UPLOAD_LIBRARY_PREFIX}:${origin}:${operatorId}`
}

/** 系统预存的编号不能从上传记录里删。找不到时原样返回。 */
export function forgetUpload(items: SavedUpload[], id: string): SavedUpload[] | null {
  if (PRESET_ID.test(id)) return null
  return items.filter(item => item.id !== id)
}

/** 新上传放在最前。同一张图不重复记。换头像不会删掉这份记录。 */
export function rememberUpload(items: SavedUpload[], image: string, id: string): SavedUpload[] {
  if (!isStoredImage(image)) return items.filter(item => isStoredImage(item.image)).slice(0, UPLOAD_LIBRARY_LIMIT)
  const existing = items.find(item => item.image === image)
  const kept = existing ?? { id, image }
  const rest = items.filter(item => item.id !== kept.id && item.image !== image && isStoredImage(item.image))
  return [kept, ...rest].slice(0, UPLOAD_LIBRARY_LIMIT)
}

export function avatarStorageKey(origin: string, operatorId: string): string | null {
  if (!isEasyOrigin(origin) || !isConfirmedOperator(operatorId)) return null
  return `${AVATAR_STORAGE_PREFIX}:${origin}:${operatorId}`
}

export function presetAvatarUrl(id: string): string {
  return `./avatars/${id}.png`
}

export interface BrowserAvatarStore {
  get(key: string): string | null
  set(key: string, value: string): void
}

/** 每台浏览器只抽一次。已经记过的不会再换。 */
export function ensureBrowserAvatar(store: BrowserAvatarStore, random: () => number = Math.random): string {
  const existing = store.get(BROWSER_AVATAR_KEY)
  if (existing && PRESET_ID.test(existing)) return existing
  const id = pickPresetId(random)
  store.set(BROWSER_AVATAR_KEY, id)
  return id
}

export function pickPresetId(random: () => number): string {
  const index = Math.min(AVATAR_PRESET_IDS.length - 1, Math.max(0, Math.floor(random() * AVATAR_PRESET_IDS.length)))
  return AVATAR_PRESET_IDS[index]
}

/** 账号没设过头像时，用这台浏览器抽到的那张。 */
export function resolveShownAvatar(account: StoredAvatar | null, browserId: string): StoredAvatar {
  return account ?? { kind: 'preset', id: browserId }
}

export function readStoredAvatar(value: unknown): StoredAvatar | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (record.v !== 1) return null
  if (record.kind === 'preset' && typeof record.id === 'string' && PRESET_ID.test(record.id)) {
    return { kind: 'preset', id: record.id }
  }
  if (record.kind === 'upload' && typeof record.image === 'string' && isStoredImage(record.image)) {
    const id = typeof record.id === 'string' && record.id.trim() ? record.id : 'legacy'
    return { kind: 'upload', id, image: record.image }
  }
  return null
}

export function avatarImageUrl(stored: StoredAvatar | null): string {
  if (!stored) return ''
  if (stored.kind === 'preset') return presetAvatarUrl(stored.id)
  return 'image' in stored ? stored.image : ''
}

export async function loadAccountAvatar(area: AvatarArea, origin: string, operatorId: string): Promise<StoredAvatar | null> {
  const key = avatarStorageKey(origin, operatorId)
  if (!key) return null
  const stored = await area.get(key)
  return readStoredAvatar(stored[key])
}

export async function saveAccountAvatar(area: AvatarArea, origin: string, operatorId: string, avatar: StoredAvatar): Promise<void> {
  const key = avatarStorageKey(origin, operatorId)
  if (!key) throw new Error('先登录 EASY，头像才能记到这个账号。')
  if (avatar.kind === 'preset') {
    if (!PRESET_ID.test(avatar.id)) throw new Error('这个头像不在可选列表里。')
    await area.set({ [key]: { v: 1, kind: 'preset', id: avatar.id } })
    return
  }
  if (!isStoredImage(avatar.image) || !avatar.id.trim()) throw new Error('头像需要先压成一张小图再保存。')
  await area.set({ [key]: { v: 1, kind: 'upload', id: avatar.id, image: avatar.image } })
}

export function readUploadLibrary(value: unknown): SavedUpload[] {
  if (!value || typeof value !== 'object') return []
  const record = value as Record<string, unknown>
  if (record.v !== 1 || !Array.isArray(record.items)) return []
  return record.items.flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const entry = item as Record<string, unknown>
    if (typeof entry.id !== 'string' || !entry.id.trim() || typeof entry.image !== 'string' || !isStoredImage(entry.image)) return []
    return [{ id: entry.id, image: entry.image }]
  }).slice(0, UPLOAD_LIBRARY_LIMIT)
}

export async function loadUploadLibrary(area: AvatarArea, origin: string, operatorId: string): Promise<SavedUpload[]> {
  const key = uploadLibraryKey(origin, operatorId)
  if (!key) return []
  const stored = await area.get(key)
  return readUploadLibrary(stored[key])
}

export async function saveUploadLibrary(area: AvatarArea, origin: string, operatorId: string, items: SavedUpload[]): Promise<void> {
  const key = uploadLibraryKey(origin, operatorId)
  if (!key) throw new Error('先登录 EASY，头像才能记到这个账号。')
  await area.set({ [key]: { v: 1, items: readUploadLibrary({ v: 1, items }) } })
}

export async function clearAccountAvatar(area: AvatarArea, origin: string, operatorId: string): Promise<void> {
  const key = avatarStorageKey(origin, operatorId)
  if (!key) throw new Error('先登录 EASY，头像才能记到这个账号。')
  await area.remove(key)
}

function isStoredImage(value: string): boolean {
  return STORED_IMAGE.test(value) && value.length <= MAX_AVATAR_DATA_URL && value.length > 30
}
