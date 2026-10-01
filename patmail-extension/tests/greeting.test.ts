import { describe, expect, it } from 'vitest'
import { greetingForHour } from '../src/app/greeting'

describe('首页问候', () => {
  it('按本地钟点切换，晚上十点不算下午', () => {
    expect(greetingForHour(9)).toBe('早上好')
    expect(greetingForHour(10)).toBe('早上好')
    expect(greetingForHour(11)).toBe('中午好')
    expect(greetingForHour(12)).toBe('中午好')
    expect(greetingForHour(13)).toBe('下午好')
    expect(greetingForHour(17)).toBe('下午好')
    expect(greetingForHour(18)).toBe('晚上好')
    expect(greetingForHour(22)).toBe('晚上好')
    expect(greetingForHour(0)).toBe('晚上好')
  })
})
