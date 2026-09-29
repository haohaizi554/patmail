import { cloneCatalog, defaultWorkflowCatalog, normalizeWorkflowCatalog, type WorkflowCatalog } from './catalog'

export const WORKFLOW_CATALOG_KEY = 'patmail.workflowCatalog.v1'

let current = defaultWorkflowCatalog()
const listeners = new Set<(catalog: WorkflowCatalog) => void>()
let watching = false

function publish(): void {
  for (const listener of listeners) listener(cloneCatalog(current))
}

export function watchWorkflowCatalog(listener: (catalog: WorkflowCatalog) => void): () => void {
  listeners.add(listener)
  if (!watching && typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    watching = true
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !(WORKFLOW_CATALOG_KEY in changes)) return
      current = normalizeWorkflowCatalog(changes[WORKFLOW_CATALOG_KEY]?.newValue)
      publish()
    })
  }
  return () => {
    listeners.delete(listener)
  }
}

export async function loadWorkflowCatalog(): Promise<WorkflowCatalog> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return cloneCatalog(current)
  try {
    const stored = await chrome.storage.local.get(WORKFLOW_CATALOG_KEY)
    if (Object.prototype.hasOwnProperty.call(stored, WORKFLOW_CATALOG_KEY)) {
      current = normalizeWorkflowCatalog(stored[WORKFLOW_CATALOG_KEY])
    }
  } catch {
    /* 读不到时用已经在内存里的那份 */
  }
  return cloneCatalog(current)
}

export async function saveWorkflowCatalog(input: WorkflowCatalog): Promise<WorkflowCatalog> {
  current = normalizeWorkflowCatalog(input)
  publish()
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    try {
      await chrome.storage.local.set({ [WORKFLOW_CATALOG_KEY]: current })
    } catch {
      /* 当前页面已经按新值生效 */
    }
  }
  return cloneCatalog(current)
}
