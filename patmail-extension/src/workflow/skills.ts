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
      field('surface_label', '从哪里找', '期限监控', '名字可以改。找案件的地方还是期限监控。')
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
      field('col_contact', '收件人那一列', '第一客户联系人', '这一行的收件人从这里取。'),
      field('col_ipr', '抄送人那一列', '客户联系人(IPR)', '这一行的抄送从这里取。'),
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
    detail: '到系统里已经有的发文类型中，按名字来对。对不上就先空着，不猜。',
    params: [
      field('customer_type_id', '有客户文号时发这种', '', '从已经配好的，或从全部种类里点。不点就按下面的词来对。'),
      field('customer_type_name', '有客户文号时的信叫什么', '', '', true),
      field('our_type_id', '只有我方文号时发这种', '', '从已经配好的，或从全部种类里点。不点就按下面的词来对。'),
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
    blurb: '同一客户合成一封，还是一件一封',
    tint: 'mint',
    detail: '具体用哪一种，在客户里选。这里改的是你看到的名字。',
    params: [
      field('style_1_label', '合成一封', '同客户合并发文', '客户里看到的名字。'),
      field('style_1_value', '合成一封的记号', '1', '程序用来记住这一种。', true),
      field('style_2_label', '一件一封', '单个来文发文', '客户里看到的名字。'),
      field('style_2_value', '一件一封的记号', '2', '程序用来记住这一种。', true),
      field('style_3_label', '按第一联系人合成', '同客户第一联系人合并发文', '客户里看到的名字。'),
      field('style_3_value', '按第一联系人合成的记号', '3', '程序用来记住这一种。', true)
    ]
  },
  {
    id: 'people',
    title: '谁来收',
    blurb: '收件人和抄送从表格里来',
    tint: 'pink',
    detail: '可以按每一行改。表格里的人加在后面，系统里已经填好的地址留在前面。',
    params: [
      field('to_role', '收件人是', '第一发明人（技术联系人）', '地址仍从收件人那一列读。'),
      field('cc_business_role', '抄送里的商务', '商务', '写在说明里。'),
      field('cc_ipr_role', '抄送里的联系人', 'IPR', '地址仍从抄送人那一列读。')
    ]
  },
  {
    id: 'sender',
    title: '从哪个邮箱发',
    blurb: '用系统里已有的发件邮箱',
    tint: 'sky',
    detail: '这次选一个。没选的话，按下面这句话来。',
    params: [
      field('sender_mailset', '优先用这个邮箱', '', '不选的话，先用规则里记住的邮箱，再否则用客户上记住的。'),
      field('sender_mailset_label', '这个邮箱叫什么', '', '', true),
      field('sender_fallback', '这次没选时', '先用规则里记住的邮箱，再否则用客户上记住的', '客户和期限监控都按这个顺序。')
    ]
  },
  {
    id: 'review',
    title: '谁来看一眼',
    blurb: '写好后交给当前登录的人看',
    tint: 'lilac',
    detail: '审核人是现在登录的这个人。',
    params: [
      field('review_label', '页面上怎么写', '提交给当前登录人', '客户里看到的名字。'),
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
