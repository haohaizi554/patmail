/** 助手浮窗的宽高。记在本机，不进对话。 */
export const AGENT_FRAME_KEY = 'patmail.agent.frame.v1'

export interface AgentFrame {
  width: number
  height: number
}

export const AGENT_FRAME_DEFAULT: AgentFrame = { width: 380, height: 560 }
export const AGENT_FRAME_MIN: AgentFrame = { width: 280, height: 320 }

export type ResizeEdge = 'e' | 's' | 'se'

export function clampAgentFrame(frame: AgentFrame, viewport: { width: number; height: number }): AgentFrame {
  const maxWidth = Math.max(AGENT_FRAME_MIN.width, viewport.width - 16)
  const maxHeight = Math.max(AGENT_FRAME_MIN.height, viewport.height - 16)
  return {
    width: Math.round(Math.min(maxWidth, Math.max(AGENT_FRAME_MIN.width, frame.width))),
    height: Math.round(Math.min(maxHeight, Math.max(AGENT_FRAME_MIN.height, frame.height)))
  }
}

export function normalizeAgentFrame(value: unknown, viewport: { width: number; height: number }): AgentFrame {
  if (typeof value !== 'object' || value === null) return clampAgentFrame(AGENT_FRAME_DEFAULT, viewport)
  const record = value as Record<string, unknown>
  const width = typeof record.width === 'number' && Number.isFinite(record.width) ? record.width : AGENT_FRAME_DEFAULT.width
  const height = typeof record.height === 'number' && Number.isFinite(record.height) ? record.height : AGENT_FRAME_DEFAULT.height
  return clampAgentFrame({ width, height }, viewport)
}

/** 从右缘、下缘或右下角拖动。窗口变大碰到屏幕边时，左边和上边跟着让。 */
export function resizeAgentFrame(
  start: { x: number; y: number; width: number; height: number; left: number; top: number },
  edge: ResizeEdge,
  pointer: { x: number; y: number },
  viewport: { width: number; height: number }
): { frame: AgentFrame; left: number; top: number } {
  const frame = clampAgentFrame({
    width: edge === 's' ? start.width : start.width + pointer.x - start.x,
    height: edge === 'e' ? start.height : start.height + pointer.y - start.y
  }, viewport)
  const maxLeft = Math.max(8, viewport.width - frame.width - 8)
  const maxTop = Math.max(8, viewport.height - frame.height - 8)
  return {
    frame,
    left: Math.min(Math.max(8, Math.min(start.left, maxLeft)), maxLeft),
    top: Math.min(Math.max(8, Math.min(start.top, maxTop)), maxTop)
  }
}
