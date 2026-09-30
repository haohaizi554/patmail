import type { WorkflowParam, WorkflowStep } from './catalog'

/** 普通用户能看懂的一件事。参数名留在程序里，页面上只出现下面这些说法。 */
export interface SkillTemplate {
  id: string
  title: string
  blurb: string
  tint: 'pink' | 'peach' | 'lilac' | 'mint' | 'sky'
  detail: string
  params: WorkflowParam[]
}

function field(id: string, label: string, value: string, help: string, hidden = false): WorkflowParam {
  return hidden ? { id, label, value, help, hidden: true } : { id, label, value, help }
}

export const SKILLS: SkillTemplate[] = [
  {
    id: 'start',
    title: '从哪里开始',
    blurb: '先选定去哪个页面找案件',
    tint: 'sky',
    detail: '客户先选期限监控，再走这条。',
    params: [
      field('surface_label', '从哪里找', '期限监控', '从查询入口里点一个。')
    ]
  },
  {
    id: 'read-sheet',
    title: '读表格',
    blurb: '从表格里读出文号、客户和联系人',
    tint: 'peach',
    detail: '上传一份表格。表头要能对上下面这些列，一行是一件。',
    params: [
      field('col_our', '我方文号那一列', '我方文号', '没有这一列就读不了表。'),
      field('col_customer_volume', '客户文号那一列', '客户文号', '用来判断用贵方案号还是我方案号。'),
      field('col_customer_name', '客户名称那一列', '客户名称', '记在这一行上。'),
      field('col_contact', '第一客户联系人那一列', '第一客户联系人', '记在这一行上。默认发文不拿它当收件人。'),
      field('col_ipr', 'IPR 那一列', '客户联系人(IPR)', '默认发文的收件人从这里取。'),
      field('col_proc', '事项那一列', '处理事项', '用这一列的名字，到系统里的事项列表对上。')
    ]
  },
  {
    id: 'check-name',
    title: '核对事项',
    blurb: '看这一列是不是要提醒的那件事',
    tint: 'lilac',
    detail: '整列事项应对上下面这个名字。对不上的行会告诉你。',
    params: [
      field('proc_label', '要找的事项', '提醒申请PCT', '从事项名单里点一个。表格里这一列要写成同一个名字。')
    ]
  },
  {
    id: 'match-letter',
    title: '对上要发的信',
    blurb: '按文号，对上该发哪一种信',
    tint: 'pink',
    detail: '有客户文号一种，只有我方文号一种。从发文类型里点。',
    params: [
      field('customer_type_id', '有客户文号时发这种', '', '从发文类型里点一种。'),
      field('customer_type_name', '有客户文号时的信叫什么', '', '', true),
      field('our_type_id', '只有我方文号时发这种', '', '从发文类型里点一种。'),
      field('our_type_name', '只有我方文号时的信叫什么', '', '', true),
      field('type_keyword', '名字里要有', '提醒申请PCT', '几种信都要带这个词。'),
      field('customer_keyword', '有客户文号时还要有', '贵方案号', '这一行填了客户文号，就走这种。'),
      field('our_keyword', '只有我方文号时还要有', '我方案号', '没有客户文号、有我方文号时走这种。'),
      field('city_keyword', '要带上的城市', '深圳市', '名字里要出现。'),
      field('other_city_keyword', '这句不算这座城市', '非深圳市', '名字里有这句的，不算深圳市那种。'),
      field('customer_radio', '有客户文号时的位置', '1', '程序用来记住位置。', true),
      field('our_radio', '只有我方文号时的位置', '3', '程序用来记住位置。', true)
    ]
  },
  {
    id: 'send-style',
    title: '几件合成一封',
    blurb: '同一客户、同一收件人合成一封',
    tint: 'mint',
    detail: '同一客户里，收件人和抄送都相同的几件合成一封。收件人或抄送不同就分开。',
    params: [
      field('style_1_label', '发文方式', '同客户合并发文', '从名单里点一种。'),
      field('style_1_value', '同客户合并发文的记号', '1', '程序用来记住这一种。', true),
      field('style_2_label', '单个来文发文', '单个来文发文', '客户看到这个名字。', true),
      field('style_2_value', '单个来文发文的记号', '2', '程序用来记住这一种。', true),
      field('style_3_label', '同客户第一联系人合并发文', '同客户第一联系人合并发文', '客户看到这个名字。', true),
      field('style_3_value', '同客户第一联系人合并发文的记号', '3', '程序用来记住这一种。', true)
    ]
  },
  {
    id: 'people',
    title: '谁来收',
    blurb: '发给 IPR，抄送商务',
    tint: 'pink',
    detail: '收件人是表格里的 IPR，抄送是发文页的商务。',
    params: [
      field('recipient_mode', '收件方式', 'ipr', 'ipr 是表格 IPR 收、商务抄送。lead 是技术负责人收、IPR 和商务抄送。', true),
      field('to_role', '收件人', 'IPR', '从表格「客户联系人(IPR)」读。'),
      field('cc_business_role', '抄送', '商务', '从发文页的商务联系人读，不从表格读。')
    ]
  },
  {
    id: 'sender',
    title: '从哪个邮箱发',
    blurb: '用系统里已有的发件邮箱',
    tint: 'sky',
    detail: '这次选一个。没选的话，按下面这句话来。',
    params: [
      field('sender_mailset', '优先用这个邮箱', '', '不选的话，沿用下面写出来的那个邮箱。'),
      field('sender_mailset_label', '这个邮箱叫什么', '', '', true),
      field('sender_fallback', '这次没选时', '先用规则里记住的邮箱，再否则用客户上记住的', '客户和期限监控都按这个顺序。')
    ]
  },
  {
    id: 'review',
    title: '谁来看一眼',
    blurb: '写好后交给当前登录的人看',
    tint: 'lilac',
    detail: '从人员名单里点一个。现在登录的人会标出来。',
    params: [
      field('review_label', '交给谁', '提交给当前登录人', '点开名单选一个人。'),
      field('review_value', '交给谁的记号', 'self', '程序用来记住交给当前登录人。', true)
    ]
  },
  {
    id: 'lookup',
    title: '再查一遍并记下',
    blurb: '用文号和事项再找一次，勾选后记在这里',
    tint: 'mint',
    detail: '可以一件一件查，也可以把文号放在一起查。勾选先记在这里，这一步还不发出去。',
    params: [
      field('query_by', '用什么再查', '我方文号和处理事项', '文号可以用分号、空格或换行放在一起。'),
      field('confirm_scope', '勾选之后', '先记在这里，这一步还不发出去', '记在这位客户身上。')
    ]
  }
]

const SKILL_IDS = new Set(SKILLS.map(item => item.id))

export function isSkillId(value: unknown): value is string {
  return typeof value === 'string' && SKILL_IDS.has(value)
}

export function skillById(id: string | undefined): SkillTemplate | null {
  return SKILLS.find(item => item.id === id) ?? null
}

export function skillTint(id: string | undefined): SkillTemplate['tint'] {
  return skillById(id)?.tint ?? 'pink'
}
