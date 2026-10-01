import { computed, ref, watch } from 'vue'
import { useWorkspace } from '../app/composables/useWorkspace'
import { avatarImageUrl, avatarStorageKey, BROWSER_AVATAR_KEY, clearAccountAvatar, ensureBrowserAvatar, forgetUpload, loadAccountAvatar, loadUploadLibrary, presetAvatarUrl, rememberUpload, resolveShownAvatar, saveAccountAvatar, saveUploadLibrary, uploadLibraryKey, type AvatarArea, type BrowserAvatarStore, type SavedUpload, type StoredAvatar } from './avatar'
import { fitAvatarFile } from './fit-avatar'

const browserPresetId = ensureBrowserAvatar(browserAvatarStore())
const src = ref(presetAvatarUrl(browserPresetId))
const presetId = ref(browserPresetId)
const uploadId = ref('')
const uploads = ref<SavedUpload[]>([])
const custom = ref(false)
const zoomed = ref(false)
const zoomSrc = ref('')
const note = ref('')
let bound = false
let serial = 0

export function useAccountAvatar() {
  const { connection } = useWorkspace()
  const signedIn = computed(() => Boolean(avatarStorageKey(connection.value.easyOrigin, connection.value.operatorId) && connection.value.sessionStatus === 'authenticated'))

  if (!bound) {
    bound = true
    watch(
      () => `${connection.value.easyOrigin}\u0000${connection.value.operatorId}\u0000${connection.value.sessionStatus}`,
      () => { void refresh() },
      { immediate: true },
    )
    window.addEventListener('keydown', event => {
      if (event.key === 'Escape') zoomed.value = false
    })
    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return
        const accountKey = avatarStorageKey(connection.value.easyOrigin, connection.value.operatorId)
        const libraryKey = uploadLibraryKey(connection.value.easyOrigin, connection.value.operatorId)
        if ((accountKey && Object.prototype.hasOwnProperty.call(changes, accountKey)) || (libraryKey && Object.prototype.hasOwnProperty.call(changes, libraryKey))) void refresh()
      })
    }
  }

  async function refresh(): Promise<void> {
    const ticket = ++serial
    const current = connection.value
    const area = chromeAvatarArea()
    if (!area || current.sessionStatus !== 'authenticated' || !avatarStorageKey(current.easyOrigin, current.operatorId)) {
      uploads.value = []
      apply(null)
      return
    }
    try {
      const [stored, library] = await Promise.all([
        loadAccountAvatar(area, current.easyOrigin, current.operatorId),
        loadUploadLibrary(area, current.easyOrigin, current.operatorId),
      ])
      if (ticket !== serial) return
      uploads.value = library
      apply(stored)
    } catch {
      if (ticket !== serial) return
      note.value = '头像暂时读不出来。'
    }
  }

  async function choosePreset(id: string): Promise<void> {
    await write({ kind: 'preset', id })
  }

  async function chooseUpload(id: string): Promise<void> {
    const found = uploads.value.find(item => item.id === id)
    if (!found) throw new Error('这张上传的头像已经不在记录里。')
    await write({ kind: 'upload', id: found.id, image: found.image })
  }

  async function upload(file: File): Promise<void> {
    const current = connection.value
    const area = requireArea(current.easyOrigin, current.operatorId)
    const image = await fitAvatarFile(file)
    const next = rememberUpload(uploads.value, image, `upload-${Date.now().toString(36)}`)
    const saved = next[0]
    if (!saved) throw new Error('头像没有保存。')
    await saveUploadLibrary(area, current.easyOrigin, current.operatorId, next)
    uploads.value = next
    await write({ kind: 'upload', id: saved.id, image: saved.image })
    note.value = '已按画面居中裁好，并留在下面，之后还能再选。'
  }

  async function removeUpload(id: string): Promise<void> {
    const next = forgetUpload(uploads.value, id)
    if (!next) throw new Error('系统预存的头像不能删除。')
    if (next.length === uploads.value.length) throw new Error('这张上传的头像已经不在记录里。')
    const current = connection.value
    const area = requireArea(current.easyOrigin, current.operatorId)
    const image = uploads.value.find(item => item.id === id)?.image ?? ''
    const removingCurrent = uploadId.value === id
    if (removingCurrent) await clearAccountAvatar(area, current.easyOrigin, current.operatorId)
    await saveUploadLibrary(area, current.easyOrigin, current.operatorId, next)
    uploads.value = next
    if (removingCurrent) apply(null)
    if (image && zoomSrc.value === image) zoomed.value = false
    note.value = removingCurrent
      ? '这张上传的头像已删掉，已换回这台浏览器抽到的默认头像。'
      : '这张上传的头像已删掉。'
  }

  async function clear(): Promise<void> {
    const current = connection.value
    const area = requireArea(current.easyOrigin, current.operatorId)
    await clearAccountAvatar(area, current.easyOrigin, current.operatorId)
    apply(null)
    note.value = '已恢复这台浏览器抽到的默认头像。上传过的图还留在下面。'
  }

  async function write(avatar: StoredAvatar): Promise<void> {
    const current = connection.value
    const area = requireArea(current.easyOrigin, current.operatorId)
    await saveAccountAvatar(area, current.easyOrigin, current.operatorId, avatar)
    apply(avatar)
    note.value = avatar.kind === 'upload' ? '已换回这张上传的头像。' : '头像已记到当前登录账号。'
  }

  function openZoom(image?: string): void {
    const next = image || src.value
    if (!next) return
    zoomSrc.value = next
    zoomed.value = true
  }

  function closeZoom(): void {
    zoomed.value = false
  }

  return { src, presetId, uploadId, uploads, custom, zoomed, zoomSrc, note, signedIn, choosePreset, chooseUpload, upload, removeUpload, clear, openZoom, closeZoom }
}

function apply(account: StoredAvatar | null): void {
  const shown = resolveShownAvatar(account, browserPresetId)
  src.value = avatarImageUrl(shown)
  presetId.value = shown.kind === 'preset' ? shown.id : ''
  uploadId.value = shown.kind === 'upload' ? shown.id : ''
  custom.value = account !== null
  if (!src.value) zoomed.value = false
}

function requireArea(origin: string, operatorId: string): AvatarArea {
  if (!avatarStorageKey(origin, operatorId)) throw new Error('先登录 EASY，头像才能记到这个账号。')
  const area = chromeAvatarArea()
  if (!area) throw new Error('当前页面保存不了头像。')
  return area
}

const memoryBrowserAvatar = new Map<string, string>()

function browserAvatarStore(): BrowserAvatarStore {
  try {
    if (typeof localStorage === 'undefined') return memoryStore()
    const probe = `${BROWSER_AVATAR_KEY}.probe`
    localStorage.setItem(probe, '1')
    localStorage.removeItem(probe)
    return {
      get: key => localStorage.getItem(key),
      set: (key, value) => localStorage.setItem(key, value),
    }
  } catch {
    return memoryStore()
  }
}

function memoryStore(): BrowserAvatarStore {
  return {
    get: key => memoryBrowserAvatar.get(key) ?? null,
    set: (key, value) => { memoryBrowserAvatar.set(key, value) },
  }
}

function chromeAvatarArea(): AvatarArea | null {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return null
  return {
    get: key => chrome.storage.local.get(key),
    set: items => chrome.storage.local.set(items),
    remove: key => chrome.storage.local.remove(key),
  }
}
