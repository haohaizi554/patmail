const REDACTED = '[REDACTED]'
const SENSITIVE_NAME = /token|authorization|password|secret|cookie|credential|session|csrf|xsrf|api[-_]?key/i
const SAFE_ATTRIBUTE = /^(id|name|type|class|role|title|placeholder|autocomplete|maxlength|minlength|min|max|step|pattern|tabindex|hidden|disabled|readonly|required|checked|selected|multiple|aria-[\w-]+|data-[\w-]+)$/i

export { REDACTED }

export function isSensitiveName(value: string): boolean {
  return SENSITIVE_NAME.test(value)
}

/** 仅保留表单语义相关属性；值属性单独处理，避免密码、文件路径泄漏。 */
export function readAttributes(element: Element): {
  attributes: Record<string, string>
  dataset: Record<string, string>
} {
  const attributes: Record<string, string> = Object.create(null)
  const dataset: Record<string, string> = Object.create(null)
  for (const attribute of Array.from(element.attributes)) {
    const name = attribute.name.toLowerCase()
    if (!SAFE_ATTRIBUTE.test(name)) continue
    const value = isSensitiveName(name) ? REDACTED : attribute.value.slice(0, 512)
    attributes[name] = value
    if (name.startsWith('data-')) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
      Object.defineProperty(dataset, key, { value, enumerable: true, configurable: true })
    }
  }
  return { attributes, dataset }
}

/** URL 的用户名、密码、hash 和敏感查询参数不进入快照。 */
export function sanitizeUrl(raw: string, base?: string): string {
  try {
    const url = new URL(raw, base)
    if (url.protocol === 'data:' || url.protocol === 'javascript:') return `${url.protocol}[REDACTED]`
    url.username = ''
    url.password = ''
    url.hash = ''
    for (const key of Array.from(url.searchParams.keys())) {
      if (isSensitiveName(key) || /^(code|auth|access_key)$/i.test(key)) url.searchParams.set(key, REDACTED)
    }
    return base && raw.startsWith('/') && !raw.startsWith('//') ? `${url.pathname}${url.search}` : url.href
  } catch {
    return '[INVALID URL]'
  }
}
