import { afterEach, describe, expect, it } from 'vitest'
import { runMailLetterPool } from '../src/customer/limit-mail-submit'
import { clampMailConcurrency, mailConcurrency, setMailConcurrency } from '../src/settings/mail-concurrency'

describe('发文并发', () => {
  afterEach(async () => {
    await setMailConcurrency(1)
  })

  it('keeps a whole number from 1 to 4', async () => {
    expect(clampMailConcurrency(undefined)).toBe(1)
    expect(clampMailConcurrency(1.5)).toBe(1)
    expect(clampMailConcurrency(0)).toBe(1)
    expect(clampMailConcurrency(9)).toBe(4)
    expect(clampMailConcurrency('3')).toBe(3)
    await setMailConcurrency(3)
    expect(mailConcurrency()).toBe(3)
  })

  it('sends the next letter only after the current one finishes when the width is 1', async () => {
    const seen: number[] = []
    const result = await runMailLetterPool([0, 1, 2], 1, async item => {
      seen.push(item)
      return item === 0
    })
    expect(seen).toEqual([0])
    expect(result.halted).toBe(true)
    expect(result.unstarted).toEqual([1, 2])
  })

  it('starts several letters and leaves the rest unstarted after one halts', async () => {
    let started = 0
    let release: () => void = () => {}
    let opened: () => void = () => {}
    const gate = new Promise<void>(resolve => { release = resolve })
    const both = new Promise<void>(resolve => { opened = resolve })
    const running = runMailLetterPool([0, 1, 2], 2, async () => {
      started += 1
      if (started === 2) opened()
      await gate
      return true
    })
    await both
    expect(started).toBe(2)
    release()
    const result = await running
    expect(result.halted).toBe(true)
    expect(result.unstarted).toEqual([2])
  })
})
