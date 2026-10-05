import type { WorkflowDefinition, WorkflowStep } from './catalog'
import { PCT_CUSTOMER_VOLUME_TYPE_NAME, PCT_OUR_VOLUME_TYPE_NAME } from './pct-config'

export interface WorkflowPreviewNames {
  customerType?: string
  ourType?: string
}

export interface PreviewPiece {
  stepId: string
  lines: string[]
  arms?: string[][]
}

function field(step: WorkflowStep, id: string): string {
  return step.params.find(item => item.id === id)?.value.trim() ?? ''
}

function clip(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 48)
}

function stepLines(step: WorkflowStep, index: number): string[] {
  const title = `${index + 1} ${step.title || '这一步'}`
  if (step.skillId === 'start') return [title, field(step, 'surface_label') || '期限监控'].map(clip)
  if (step.skillId === 'read-sheet') {
    return field(step, 'col_lead')
      ? [title, '收件人列：技术负责人', '抄送列：IPR'].map(clip)
      : [title, '一行一件'].map(clip)
  }
  if (step.skillId === 'check-name') return [title, field(step, 'proc_label') || '要核对的事项'].map(clip)
  if (step.skillId === 'send-style') return [title, '同一客户、同一收件人和抄送'].map(clip)
  if (step.skillId === 'people') {
    return field(step, 'recipient_mode') === 'lead'
      ? [title, '技术负责人收', 'IPR 和商务抄送'].map(clip)
      : [title, 'IPR 收', '商务抄送'].map(clip)
  }
  if (step.skillId === 'sender') return [title, field(step, 'sender_mailset_label') || '沿用规则或客户上的邮箱'].map(clip)
  if (step.skillId === 'review') return [title, field(step, 'review_label') || '提交给当前登录人'].map(clip)
  if (step.skillId === 'lookup') return [title, '勾选后先记下，这一步不发出'].map(clip)
  return [title].map(clip)
}

/** 整条工作流从左到右排开。对信这一步分成有客户文号、只有我方文号两条，再汇合。 */
export function workflowPreview(flow: WorkflowDefinition, names: WorkflowPreviewNames = {}): PreviewPiece[] {
  return flow.steps.map((step, index) => {
    if (step.skillId !== 'match-letter') return { stepId: step.id, lines: stepLines(step, index) }
    const customer = names.customerType?.trim() || field(step, 'customer_type_name') || PCT_CUSTOMER_VOLUME_TYPE_NAME
    const ours = names.ourType?.trim() || field(step, 'our_type_name') || PCT_OUR_VOLUME_TYPE_NAME
    return {
      stepId: step.id,
      lines: [`${index + 1} ${step.title || '对上要发的信'}`].map(clip),
      arms: [
        ['有客户文号', customer].map(clip),
        ['只有我方文号', ours].map(clip)
      ]
    }
  })
}
