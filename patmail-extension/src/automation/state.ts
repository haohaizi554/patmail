import type { StageDefinition, StageId } from './types'

/** 阶段目录。执行器按阶段声明决定能不能写，不靠一个顺序循环假装跑完业务。 */
export const STAGES: Record<StageId, StageDefinition> = {
  SESSION_CHECK: stage('SESSION_CHECK', '页面来源', '会话摘要', '受信任站点', true, 'read', 'allowed', false, '已登录且有用户 GUID', '重新检测登录'),
  FILE_QUERY: stage('FILE_QUERY', '查询条件', '文件列表', '会话有效', true, 'read', 'allowed', false, 'GetSearchFiles 返回可解析列表', '可以再次查询'),
  FILE_SELECTION: stage('FILE_SELECTION', '文件列表', '选择集', '列表已加载', true, 'none', 'allowed', true, '每个文件都有 ID', '重新选择'),
  CUSTOMER_RESOLVE: stage('CUSTOMER_RESOLVE', '选择集和客户配置', '已确认绑定', '客户配置存在', true, 'none', 'allowed', true, '绑定已确认且来源名称一致', '不能编造客户'),
  DESCRIPTION_MAPPING: stage('DESCRIPTION_MAPPING', '文件描述', '发文类型', '描述非空', true, 'none', 'allowed', false, '映射唯一且是 GUID', '缺映射则阻塞'),
  MAIL_GROUPING: stage('MAIL_GROUPING', '已绑定文件', 'MailGroup', '客户和描述都明确', true, 'none', 'allowed', false, '分组规则与发文方式一致', '重新分组'),
  RECIPIENT_RESOLVE: stage('RECIPIENT_RESOLVE', '客户配置', '收件人和抄送', '存在启用模板', true, 'none', 'allowed', false, '至少一名收件人', '收件人为空则阻塞'),
  SUBJECT_BUILD: stage('SUBJECT_BUILD', '模板和文件', '主题', '模板已保存', true, 'none', 'allowed', false, '主题已生成', '缺变量则标出'),
  BODY_BUILD: stage('BODY_BUILD', '模板和签名', '正文', '模板已保存', true, 'none', 'allowed', false, '正文已生成', '缺变量则标出'),
  DRAFT_VALIDATE: stage('DRAFT_VALIDATE', '草稿', '校验结果', '分组完成', true, 'none', 'allowed', false, '没有错误级问题', '有错误则不是 READY'),
  MAIL_CREATE: stage('MAIL_CREATE', '就绪草稿', 'mail_id', '契约和写开关都已确认', false, 'write', 'forbidden-when-unknown', true, '回读到同一 mail_id', '禁止自动再创建'),
  MAIL_READ: stage('MAIL_READ', 'mail_id', '邮件快照', '已有 mail_id', true, 'read', 'allowed', false, 'GetMailInfo 对得上', '可以重读'),
  MAIL_DIFF: stage('MAIL_DIFF', '快照和计划', '差异摘要', '已经读到邮件', true, 'none', 'allowed', true, '用户看见当前摘要', '摘要变化则停止保存'),
  MAIL_SAVE: stage('MAIL_SAVE', '已确认差异', '保存结果', '摘要未变', false, 'write', 'forbidden-when-unknown', true, '保存响应已确认', '改为重读邮件'),
  FILE_BIND: stage('FILE_BIND', '文件集合', '关联结果', 'file_ids 格式已核对', false, 'write', 'reread-only', true, 'GetMailFile 与计划一致', '未核对格式则 BINDING_BLOCKED'),
  MAIL_VERIFY: stage('MAIL_VERIFY', 'mail_id', '核对结果', '保存已发生', true, 'read', 'allowed', false, '文件集合一致', '不一致则部分失败'),
  WORKFLOW_READ: stage('WORKFLOW_READ', 'mail_id', '流程快照', '邮件已核验或处于诊断', true, 'read', 'allowed', false, 'GetFlowInfo 的对象对得上', '可以重读'),
  NODE_RESOLVE: stage('NODE_RESOLVE', '下一节点响应', '候选节点', '流程已读取', true, 'none', 'allowed', true, '节点来自本次响应', '多个节点必须人工选择'),
  REVIEWER_RESOLVE: stage('REVIEWER_RESOLVE', '节点候选人', '本人 GUID', '当前用户 GUID 已知', true, 'none', 'allowed', true, 'GUID 相同', '不能按姓名选择'),
  WORKFLOW_PLAN: stage('WORKFLOW_PLAN', '节点和审核人', '提交计划', '人选已确认', true, 'none', 'allowed', true, '参数来源完整', '旧计划作废'),
  WORKFLOW_VERSION_CHECK: stage('WORKFLOW_VERSION_CHECK', '当前版本', '比较结果', '已有计划', true, 'read', 'allowed', true, 'update_time_ss 一致', '变化则 STALE'),
  WORKFLOW_SUBMIT: stage('WORKFLOW_SUBMIT', '计划', '提交结果', '契约和写开关都已确认', false, 'write', 'forbidden-when-unknown', true, '回读节点发生变化', '禁止自动重试'),
  WORKFLOW_VERIFY: stage('WORKFLOW_VERIFY', 'mail_id', '流程快照', '提交已发出', true, 'read', 'allowed', false, '节点已变化', '未知则只重读'),
  REVIEW_PREVIEW: stage('REVIEW_PREVIEW', '候选人', '身份结论', '审核人 GUID 已确认', true, 'none', 'allowed', true, '本人 GUID 匹配', '写接口保持 PENDING'),
  REVIEW_EXECUTE: stage('REVIEW_EXECUTE', '审核请求', '审核结果', '审核写契约已确认', false, 'write', 'forbidden-when-unknown', true, '回读审核历史', '当前没有已核对接口'),
  FINAL_VERIFY: stage('FINAL_VERIFY', '邮件和流程', '任务项状态', '前面的步骤有记录', true, 'read', 'allowed', false, '各项状态分别成立', '不因一项失败删除其他邮件')
}

function stage(id: StageId, input: string, output: string, precondition: string, readonly: boolean, sideEffect: StageDefinition['sideEffect'], retry: StageDefinition['retry'], needsConfirmation: boolean, success: string, unknown: string): StageDefinition {
  return { id, input, output, precondition, readonly, sideEffect, retry, needsConfirmation, success, unknown }
}

export const WRITE_STAGES = Object.values(STAGES).filter(item => item.sideEffect === 'write').map(item => item.id)
