import { isSystemWorkflow, workflowFromSkills, type WorkflowCatalog } from '../workflow/catalog'
import { SKILLS, skillById } from '../workflow/skills'

export function skillIdFrom(token: string): string | null {
  const text = token.trim()
  if (!text) return null
  if (skillById(text)) return text
  return SKILLS.find(skill => skill.title === text)?.id ?? null
}

export function splitSkillList(value: string): string[] {
  return value.split(/[,，、;；\n]/).map(item => item.trim()).filter(Boolean)
}

export function createWorkflowInCatalog(catalog: WorkflowCatalog, name: string, summary: string, skillText: string): { catalog: WorkflowCatalog; text: string } {
  const label = name.trim().slice(0, 40)
  if (!label) return { catalog, text: '还缺工作流的名字。' }
  const ids = splitSkillList(skillText).flatMap(token => {
    const id = skillIdFrom(token)
    return id ? [id] : []
  })
  if (ids.length === 0) return { catalog, text: `没有对上的本领。可以用：${SKILLS.map(skill => skill.title).join('、')}` }
  if (catalog.workflows.some(item => item.label === label)) return { catalog, text: `已经有叫「${label}」的工作流。换一个名字，或说明要改哪一条。` }
  const created = workflowFromSkills(label, ids, catalog.workflows.map(item => item.id))
  if (summary.trim()) created.summary = summary.trim().slice(0, 400)
  const steps = created.steps.map((step, index) => `${index + 1}. ${step.title}`).join('\n')
  return {
    catalog: { workflows: [...catalog.workflows, created] },
    text: `已创建工作流「${created.label}」。\n${steps}\n可以在工作流页面看到。还没有提交发文。`
  }
}

export function setWorkflowFieldInCatalog(catalog: WorkflowCatalog, name: string, skill: string, field: string, value: string): { catalog: WorkflowCatalog; text: string } {
  const label = name.trim()
  const index = catalog.workflows.findIndex(item => item.label === label)
  const flow = catalog.workflows[index]
  if (!flow) return { catalog, text: '没有这条工作流。' }
  if (isSystemWorkflow(flow)) return { catalog, text: '系统自带的不能直接改。可以说按它复制一条再改。' }
  const skillId = skillIdFrom(skill)
  if (!skillId) return { catalog, text: '没有对上这个本领。' }
  const fieldName = field.trim()
  const nextValue = value.trim().slice(0, 200)
  if (!fieldName || !nextValue) return { catalog, text: '要写明改哪一栏、改成什么。' }
  let changed = false
  const steps = flow.steps.map(step => {
    if (step.skillId !== skillId) return step
    const params = step.params.map(param => {
      if (param.hidden || (param.id !== fieldName && param.label !== fieldName)) return param
      changed = true
      return { ...param, value: nextValue }
    })
    return { ...step, params }
  })
  if (!changed) return { catalog, text: '没有对上要改的那一栏。用本领的名字和栏的名字，例如「读表格」和「我方文号那一列」。' }
  const workflows = catalog.workflows.map((item, itemIndex) => itemIndex === index ? { ...flow, steps } : item)
  return { catalog: { workflows }, text: `已改「${flow.label}」里「${skill.trim()}」的「${fieldName}」。` }
}
