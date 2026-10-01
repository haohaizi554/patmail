import { describe, expect, it } from 'vitest'
import { avatarImageUrl, avatarStorageKey, BROWSER_AVATAR_KEY, centerCropRect, clearAccountAvatar, ensureBrowserAvatar, forgetUpload, loadAccountAvatar, loadUploadLibrary, MAX_AVATAR_DATA_URL, pickPresetId, readStoredAvatar, rememberUpload, resolveShownAvatar, saveAccountAvatar, saveUploadLibrary, type AvatarArea, type BrowserAvatarStore } from '../src/settings/avatar'

const ORIGIN = 'http://183.36.43.66:88'
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

function memoryArea(): AvatarArea {
  const store = new Map<string, unknown>()
  return {
    async get(key) {
      return store.has(key) ? { [key]: store.get(key) } : {}
    },
    async set(items) {
      for (const [key, value] of Object.entries(items)) store.set(key, value)
    },
    async remove(key) {
      store.delete(key)
    },
  }
}

function memoryBrowserStore(): BrowserAvatarStore {
  const store = new Map<string, string>()
  return {
    get: key => store.get(key) ?? null,
    set: (key, value) => { store.set(key, value) },
  }
}

describe('account avatar', () => {
  it('binds the storage key to the easy origin and operator', () => {
    const key = avatarStorageKey(ORIGIN, USER)
    expect(key).toBe(`patmail.avatar.v1:${ORIGIN}:${USER}`)
    expect(key).not.toBe(avatarStorageKey(ORIGIN, OTHER))
    expect(avatarStorageKey('https://example.com', USER)).toBeNull()
    expect(avatarStorageKey(ORIGIN, 'not-a-user')).toBeNull()
  })

  it('keeps a preset or a small jpeg and drops anything else', () => {
    expect(readStoredAvatar({ v: 1, kind: 'preset', id: 'avatar-01' })).toEqual({ kind: 'preset', id: 'avatar-01' })
    expect(readStoredAvatar({ v: 1, kind: 'preset', id: 'avatar-21' })).toBeNull()
    const image = `data:image/webp;base64,${'a'.repeat(32)}`
    expect(readStoredAvatar({ v: 1, kind: 'upload', image })).toEqual({ kind: 'upload', id: 'legacy', image })
    expect(readStoredAvatar({ v: 1, kind: 'upload', image: `data:image/png;base64,${'a'.repeat(32)}` })).toEqual({ kind: 'upload', id: 'legacy', image: `data:image/png;base64,${'a'.repeat(32)}` })
    expect(readStoredAvatar({ v: 1, kind: 'upload', image: `data:image/gif;base64,${'a'.repeat(32)}` })).toBeNull()
    expect(readStoredAvatar({ v: 1, kind: 'upload', image: `data:image/webp;base64,${'a'.repeat(MAX_AVATAR_DATA_URL)}` })).toBeNull()
    expect(avatarImageUrl({ kind: 'preset', id: 'avatar-03' })).toBe('./avatars/avatar-03.png')
  })

  it('saves and clears one account without touching another', async () => {
    const area = memoryArea()
    await saveAccountAvatar(area, ORIGIN, USER, { kind: 'preset', id: 'avatar-07' })
    const uploaded = `data:image/png;base64,${'b'.repeat(40)}`
    await saveAccountAvatar(area, ORIGIN, OTHER, { kind: 'upload', id: 'upload-1', image: uploaded })
    expect(await loadAccountAvatar(area, ORIGIN, USER)).toEqual({ kind: 'preset', id: 'avatar-07' })
    await clearAccountAvatar(area, ORIGIN, USER)
    expect(await loadAccountAvatar(area, ORIGIN, USER)).toBeNull()
    expect(await loadAccountAvatar(area, ORIGIN, OTHER)).toEqual({ kind: 'upload', id: 'upload-1', image: uploaded })
    await expect(saveAccountAvatar(area, ORIGIN, 'guest', { kind: 'preset', id: 'avatar-01' })).rejects.toThrow('先登录')
  })

  it('draws one preset per browser and keeps it', () => {
    const store = memoryBrowserStore()
    expect(pickPresetId(() => 0)).toBe('avatar-01')
    expect(pickPresetId(() => 0.999)).toBe('avatar-20')
    const first = ensureBrowserAvatar(store, () => 0.42)
    const again = ensureBrowserAvatar(store, () => 0.9)
    expect(again).toBe(first)
    expect(store.get(BROWSER_AVATAR_KEY)).toBe(first)
    const otherBrowser = ensureBrowserAvatar(memoryBrowserStore(), () => 0.9)
    expect(otherBrowser).not.toBe(first)
  })

  it('center-crops wide and tall pictures onto the middle square', () => {
    expect(centerCropRect(400, 200)).toEqual({ sx: 100, sy: 0, side: 200 })
    expect(centerCropRect(200, 500)).toEqual({ sx: 0, sy: 150, side: 200 })
    expect(centerCropRect(300, 300)).toEqual({ sx: 0, sy: 0, side: 300 })
    expect(centerCropRect(180, 180).side).toBe(180)
  })

  it('keeps uploaded pictures so they can be chosen again', async () => {
    const area = memoryArea()
    const first = `data:image/webp;base64,${'a'.repeat(40)}`
    const second = `data:image/webp;base64,${'b'.repeat(40)}`
    const library = rememberUpload(rememberUpload([], first, 'one'), second, 'two')
    expect(library.map(item => item.id)).toEqual(['two', 'one'])
    expect(rememberUpload(library, first, 'again').map(item => item.id)).toEqual(['one', 'two'])
    await saveUploadLibrary(area, ORIGIN, USER, library)
    await saveAccountAvatar(area, ORIGIN, USER, { kind: 'preset', id: 'avatar-02' })
    expect(await loadUploadLibrary(area, ORIGIN, USER)).toEqual(library)
    expect(await loadAccountAvatar(area, ORIGIN, USER)).toEqual({ kind: 'preset', id: 'avatar-02' })
    expect(avatarImageUrl({ kind: 'upload', id: 'two', image: second })).toBe(second)
    expect(readStoredAvatar({ v: 1, kind: 'upload', cached: true })).toBeNull()
  })

  it('drops one uploaded picture and refuses a preset id', async () => {
    const area = memoryArea()
    const first = `data:image/webp;base64,${'a'.repeat(40)}`
    const second = `data:image/webp;base64,${'b'.repeat(40)}`
    const library = rememberUpload(rememberUpload([], first, 'one'), second, 'two')
    expect(forgetUpload(library, 'avatar-01')).toBeNull()
    const left = forgetUpload(library, 'two')
    expect(left?.map(item => item.id)).toEqual(['one'])
    await saveUploadLibrary(area, ORIGIN, USER, left ?? [])
    await saveAccountAvatar(area, ORIGIN, USER, { kind: 'upload', id: 'two', image: second })
    await clearAccountAvatar(area, ORIGIN, USER)
    expect(await loadUploadLibrary(area, ORIGIN, USER)).toEqual([{ id: 'one', image: first }])
    expect(await loadAccountAvatar(area, ORIGIN, USER)).toBeNull()
  })

  it('uses the browser draw only when the account has no avatar', () => {
    expect(resolveShownAvatar(null, 'avatar-04')).toEqual({ kind: 'preset', id: 'avatar-04' })
    expect(resolveShownAvatar({ kind: 'preset', id: 'avatar-09' }, 'avatar-04')).toEqual({ kind: 'preset', id: 'avatar-09' })
  })
})
