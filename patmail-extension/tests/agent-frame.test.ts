import { describe, expect, it } from 'vitest'
import { AGENT_FRAME_DEFAULT, AGENT_FRAME_MIN, clampAgentFrame, normalizeAgentFrame, resizeAgentFrame } from '../src/app/agent-frame'

const viewport = { width: 1200, height: 800 }

describe('agent frame', () => {
  it('keeps a saved size and falls back when the record is empty', () => {
    expect(normalizeAgentFrame({ width: 640, height: 480 }, viewport)).toEqual({ width: 640, height: 480 })
    expect(normalizeAgentFrame(null, viewport)).toEqual(AGENT_FRAME_DEFAULT)
    expect(normalizeAgentFrame({ width: 40, height: 9000 }, viewport)).toEqual({
      width: AGENT_FRAME_MIN.width,
      height: 784
    })
  })

  it('shrinks the panel to the viewport without going under the minimum', () => {
    expect(clampAgentFrame({ width: 900, height: 700 }, { width: 320, height: 400 })).toEqual({
      width: 304,
      height: 384
    })
  })

  it('grows from the corner and shifts left when the right edge hits the screen', () => {
    const start = { x: 100, y: 100, width: 380, height: 560, left: 800, top: 40 }
    const grown = resizeAgentFrame(start, 'se', { x: 220, y: 180 }, viewport)
    expect(grown.frame).toEqual({ width: 500, height: 640 })
    expect(grown.left).toBe(692)
    expect(grown.top).toBe(40)
    const east = resizeAgentFrame(start, 'e', { x: 160, y: 400 }, viewport)
    expect(east.frame.height).toBe(560)
    expect(east.frame.width).toBe(440)
  })
})
