import { ref } from 'vue'
import { AGENT_CONFIG_DEFAULT, AGENT_CONFIG_KEY, normalizeAgentConfig, type AgentConfig } from '../agent/config'

/** 设置页的 Agent 配置读写。存本机 chrome.storage.local；没有扩展存储时（测试）只留在内存。 */
export function useAgentConfig() {
  const config = ref<AgentConfig | null>(null)
  const ready = ref(false)

  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    void chrome.storage.local.get(AGENT_CONFIG_KEY).then(stored => {
      config.value = normalizeAgentConfig(stored[AGENT_CONFIG_KEY])
      ready.value = true
    }).catch(() => {
      config.value = null
      ready.value = true
    })
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !(AGENT_CONFIG_KEY in changes)) return
      const next = normalizeAgentConfig(changes[AGENT_CONFIG_KEY]?.newValue)
      // 思考开关单独写入。不要把地址、密钥的未保存修改盖掉。
      config.value = config.value ? { ...config.value, thinking: next.thinking } : next
    })
  } else {
    config.value = { ...AGENT_CONFIG_DEFAULT }
    ready.value = true
  }

  async function save(next: AgentConfig): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return
    await chrome.storage.local.set({ [AGENT_CONFIG_KEY]: normalizeAgentConfig(next) })
  }

  /** 思考开关立即写入已保存的配置，不等「保存配置」。 */
  async function setThinking(thinking: boolean): Promise<void> {
    if (config.value) config.value = { ...config.value, thinking }
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return
    const stored = normalizeAgentConfig((await chrome.storage.local.get(AGENT_CONFIG_KEY))[AGENT_CONFIG_KEY])
    await chrome.storage.local.set({ [AGENT_CONFIG_KEY]: { ...stored, thinking } })
  }

  return { config, ready, save, setThinking }
}