/** Agent（LLM）接入配置。与写开关一样存在本机 chrome.storage.local，不上传。 */
export const AGENT_CONFIG_KEY = 'patmail.agent.config.v1'

export interface AgentConfig {
  /** OpenAI 兼容接口根地址，含版本段，例如 http://host:8588/v1。 */
  baseUrl: string
  /** 同时放在 Authorization: Bearer 和 x-api-key 两个请求头里。 */
  apiKey: string
  model: string
  /** 单次回复上限。思考和正文共用这一额度；0 表示不传，由服务端默认。 */
  maxTokens: number
  /** 思考型模型的思考链开关。关掉可以省 token、直接出正文。 */
  thinking: boolean
}

export const AGENT_CONFIG_DEFAULT: AgentConfig = {
  baseUrl: 'http://43.138.138.200:8588/v1',
  apiKey: '8588',
  model: 'Qwen3.6-35B-A3B-oQ4-fp16-mtp',
  maxTokens: 8192,
  thinking: false
}

/** 配置由后台自己读取，不信任页面消息里的地址和密钥。 */
export function isAgentConfig(value: unknown): value is AgentConfig {
  if (typeof value !== 'object' || value === null) return false
  const config = value as Record<string, unknown>
  return typeof config.baseUrl === 'string' && /^https?:\/\/[^\s]+$/i.test(config.baseUrl) && config.baseUrl.length <= 300 &&
    typeof config.apiKey === 'string' && config.apiKey.length <= 200 &&
    typeof config.model === 'string' && config.model.trim().length > 0 && config.model.length <= 200 &&
    typeof config.maxTokens === 'number' && Number.isSafeInteger(config.maxTokens) && config.maxTokens >= 0 && config.maxTokens <= 1_048_576 &&
    typeof config.thinking === 'boolean'
}

/** 旧默认 1024 会把思考和正文一起截断。后来抬到 1048576 又会把整段窗口占满。这两个数都收回到现在的默认。 */
function storedMaxTokens(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 1_048_576) return 0
  return value === 1024 || value === 1_048_576 ? AGENT_CONFIG_DEFAULT.maxTokens : value
}

export function normalizeAgentConfig(value: unknown): AgentConfig {
  if (typeof value !== 'object' || value === null) return AGENT_CONFIG_DEFAULT
  const record = value as Record<string, unknown>
  const next: AgentConfig = {
    baseUrl: typeof record.baseUrl === 'string' ? record.baseUrl.trim().replace(/\/+$/, '') : '',
    apiKey: typeof record.apiKey === 'string' ? record.apiKey : '',
    model: typeof record.model === 'string' ? record.model.trim() : '',
    maxTokens: storedMaxTokens(record.maxTokens),
    thinking: typeof record.thinking === 'boolean' ? record.thinking : false
  }
  return isAgentConfig(next) ? next : AGENT_CONFIG_DEFAULT
}

export interface ConfigStorage {
  get(key: string): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
}

export async function loadAgentConfig(area?: ConfigStorage): Promise<AgentConfig> {
  const storage = area ?? (typeof chrome !== 'undefined' ? chrome.storage?.local : undefined)
  if (!storage) return AGENT_CONFIG_DEFAULT
  try {
    return normalizeAgentConfig((await storage.get(AGENT_CONFIG_KEY))[AGENT_CONFIG_KEY])
  } catch {
    return AGENT_CONFIG_DEFAULT
  }
}

export async function saveAgentConfig(area: ConfigStorage, config: AgentConfig): Promise<AgentConfig> {
  const next = normalizeAgentConfig(config)
  await area.set({ [AGENT_CONFIG_KEY]: next })
  return next
}