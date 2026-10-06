import { describe, expect, it } from 'vitest'
import { AGENT_MEMORY_KEY, AGENT_SESSIONS_KEY, MAX_AGENT_SESSIONS, createAgentSession, loadMemory, openAgentSession, readAgentSessions, removeAgentSession, renameAgentSession, saveMemory, type AgentMemoryState, type MemoryStorage } from '../src/agent/memory'

function storage(): MemoryStorage & { bag: Record<string, unknown> } {
  const bag: Record<string, unknown> = {}
  return {
    bag,
    async get(key) {
      return { [key]: bag[key] }
    },
    async set(items) {
      Object.assign(bag, items)
    }
  }
}

describe('agent sessions', () => {
  it('turns an old single transcript into one session and keeps the shared facts', async () => {
    const area = storage()
    area.bag[AGENT_MEMORY_KEY] = {
      summary: '',
      turns: [{ role: 'user', content: '查一下文号' }],
      facts: [{ id: 'fact-1', text: '常用客户甲', at: '2026-01-01T00:00:00.000Z' }]
    }
    const loaded = await loadMemory(area)
    expect(loaded.turns.map(turn => turn.content)).toEqual(['查一下文号'])
    expect(loaded.facts.map(fact => fact.text)).toEqual(['常用客户甲'])
    const listed = await readAgentSessions(area)
    expect(listed.sessions).toHaveLength(1)
    expect(listed.sessions[0]?.title).toBe('查一下文号')
    expect(area.bag[AGENT_MEMORY_KEY]).toBeNull()
  })

  it('opens a fresh context without copying or dropping long-term memory', async () => {
    const area = storage()
    const first = await readAgentSessions(area)
    const remembered: AgentMemoryState = {
      ...first.memory,
      turns: [{ role: 'user', content: '记住常用客户甲' }],
      facts: [{ id: 'fact-1', text: '常用客户甲', at: '2026-01-01T00:00:00.000Z' }]
    }
    await saveMemory(area, remembered)
    const created = await createAgentSession(area)
    expect(created.activeId).not.toBe(first.activeId)
    expect(created.memory.turns).toEqual([])
    expect(created.memory.facts.map(fact => fact.text)).toEqual(['常用客户甲'])
    const back = await openAgentSession(area, first.activeId)
    expect(back.memory.turns.map(turn => turn.content)).toEqual(['记住常用客户甲'])
    expect(back.memory.facts.map(fact => fact.text)).toEqual(['常用客户甲'])
  })

  it('does not open another session while the current one is still empty', async () => {
    const area = storage()
    const first = await readAgentSessions(area)
    const again = await createAgentSession(area)
    expect(again.activeId).toBe(first.activeId)
    expect(again.sessions).toHaveLength(1)
  })

  it('deletes one transcript and leaves the shared facts on the remaining session', async () => {
    const area = storage()
    const first = await readAgentSessions(area)
    await saveMemory(area, {
      ...first.memory,
      turns: [{ role: 'user', content: '第一段' }],
      facts: [{ id: 'fact-1', text: '常用客户甲', at: '2026-01-01T00:00:00.000Z' }]
    })
    const second = await createAgentSession(area)
    await saveMemory(area, {
      ...second.memory,
      turns: [{ role: 'user', content: '第二段' }]
    })
    const removed = await removeAgentSession(area, second.activeId)
    expect(removed.activeId).toBe(first.activeId)
    expect(removed.memory.turns.map(turn => turn.content)).toEqual(['第一段'])
    expect(removed.memory.facts.map(fact => fact.text)).toEqual(['常用客户甲'])
    expect(removed.sessions).toHaveLength(1)
    const gone = await openAgentSession(area, second.activeId)
    expect(gone.message).toBe('没有这段对话。')
  })

  it('keeps one empty session after the last transcript is deleted', async () => {
    const area = storage()
    const first = await readAgentSessions(area)
    await saveMemory(area, {
      ...first.memory,
      facts: [{ id: 'fact-1', text: '常用客户甲', at: '2026-01-01T00:00:00.000Z' }]
    })
    const removed = await removeAgentSession(area, first.activeId)
    expect(removed.sessions).toHaveLength(1)
    expect(removed.activeId).not.toBe(first.activeId)
    expect(removed.memory.turns).toEqual([])
    expect(removed.memory.facts.map(fact => fact.text)).toEqual(['常用客户甲'])
  })

  it('stops creating once the session list is full', async () => {
    const area = storage()
    await saveMemory(area, { ...(await loadMemory(area)), turns: [{ role: 'user', content: '第一段' }] })
    for (let index = 1; index < MAX_AGENT_SESSIONS; index += 1) {
      const created = await createAgentSession(area)
      await saveMemory(area, { ...created.memory, turns: [{ role: 'user', content: `第 ${index + 1} 段` }] })
    }
    const blocked = await createAgentSession(area)
    expect(blocked.sessions).toHaveLength(MAX_AGENT_SESSIONS)
    expect(blocked.message).toContain(String(MAX_AGENT_SESSIONS))
    expect(area.bag[AGENT_SESSIONS_KEY]).toBeTruthy()
  })

  it('keeps a name the user chose after the first message arrives', async () => {
    const area = storage()
    await saveMemory(area, { ...(await loadMemory(area)), turns: [{ role: 'user', content: '第一段' }] })
    const created = await createAgentSession(area, '周报核对')
    expect(created.sessions.find(item => item.active)?.title).toBe('周报核对')
    await saveMemory(area, { ...created.memory, turns: [{ role: 'user', content: '今天要核对哪几件' }] })
    const listed = await readAgentSessions(area)
    expect(listed.sessions.find(item => item.id === created.activeId)?.title).toBe('周报核对')
  })

  it('still names an unnamed session from the first visible line', async () => {
    const area = storage()
    await saveMemory(area, { ...(await loadMemory(area)), turns: [{ role: 'user', content: '第一段' }] })
    const created = await createAgentSession(area)
    await saveMemory(area, { ...created.memory, turns: [{ role: 'user', content: '查一下文号' }] })
    const listed = await readAgentSessions(area)
    expect(listed.sessions.find(item => item.id === created.activeId)?.title).toBe('查一下文号')
  })

  it('renames one session and leaves that name in place', async () => {
    const area = storage()
    const first = await readAgentSessions(area)
    await saveMemory(area, { ...first.memory, turns: [{ role: 'user', content: '1' }] })
    const renamed = await renameAgentSession(area, first.activeId, '客户甲的期限')
    expect(renamed.sessions[0]?.title).toBe('客户甲的期限')
    expect(renamed.message).toBe('')
    await saveMemory(area, { ...renamed.memory, turns: [{ role: 'user', content: '1' }, { role: 'assistant', content: '好' }] })
    const listed = await readAgentSessions(area)
    expect(listed.sessions[0]?.title).toBe('客户甲的期限')
    const blank = await renameAgentSession(area, first.activeId, '   ')
    expect(blank.message).toBe('名字不能是空的。')
    expect(blank.sessions[0]?.title).toBe('客户甲的期限')
  })
})
