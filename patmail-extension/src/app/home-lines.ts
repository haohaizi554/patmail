/** 首页副文案。给恒诚知识产权的同事，围绕专利、商标、版权和发文日常。 */

const MAIL_WHENS = ['发文前', '点发送前', '预览邮件时', '写主题时', '选收件人时', '挂附件时', '写正文时', '客户打开前', '签名之前', '抄送之前', '点击发送前', '装订附件时', '定称呼时', '写说明时', '核对清单时', '寄出这封信前']
const DRAFT_WHENS = ['定稿前', '交客户前', '答复前', '落笔前', '改完以后', '初稿之后', '统稿时', '内部审前', '第二遍时', '提交稿前', '写权项时', '补实施例时', '对交底时', '看对比文件时', '收笔之前', '修改落定前']
const LIMIT_WHENS = ['今天早上', '收到官文后', '建档之时', '分案之时', '更新监控前', '发提醒前', '标注日历前', '交接的时候', '周末之前', '月底之前', '新案进来时', '客户询问前', '期限临近时', '录入系统前', '做周计划时', '打开监控表时']
const MARK_WHENS = ['申报之前', '续展之前', '答辩之前', '看驳回通知后', '登记之前', '选类别时', '看公告时', '交图样前', '核对权属时', '客户确认前', '异议期内', '补正之前', '指定商品时', '准备证据时', '写理由时', '提交商标前']
const FOREIGN_WHENS = ['进国家前', '做国际申请时', '译完以后', '寄出要求前', '选外所前', '看外所来信后', '改译文前', '统一术语时', '核对报价前', '填写期限表时', '下指令前', '确认指定国时', '寄出译文前', '内部先看时', '对照原文时', '国家阶段前']
const TEAM_WHENS = ['回复客户前', '开会之前', '交接之前', '写备注时', '通完电话后', '方案发出前', '报价之前', '写周报时', '请同事看前', '内部讨论前', '答应日期前', '改口径前', '同步进度前', '归档之前', '复盘的时候', '把案子交出前']

const MAIL_NOUNS = ['主题', '收件人', '抄送', '附件', '正文', '称呼', '文号', '申请号', '落款', '联系人', '文件名', '发文说明', '客户名', '官文名称', '邮件标题', '确认事项']
const DRAFT_NOUNS = ['权利要求', '说明书', '摘要', '附图', '实施例', '意见陈述', '补正说明', '保护范围', '技术特征', '术语', '修改对照', '背景技术', '独立权项', '从属权项', '具体方案', '引用关系']
const LIMIT_NOUNS = ['官方期限', '客户期限', '内部期限', '申请日', '优先权日', '缴费期限', '答复期限', '公开日', '续展日', '年费期限', '届满日', '提交日', '进入期限', '宽展期', '授权日', '优先权期限']
const MARK_NOUNS = ['商标类别', '商品项目', '图样', '注册号', '异议理由', '驳回理由', '使用证据', '作品名称', '权属链', '类似群', '指定商品', '版权归属', '申请人', '代理委托', '优先权证明', '公告信息']
const FOREIGN_NOUNS = ['国际申请号', '外所名称', '译文', '指定国家', '费用清单', '外所指令', '申请人译名', '优先权文件', '公开文本', '修改文本', '期限表', '往来邮件', '权利要求译文', '说明书译文', '代理指示', '国家阶段']
const TEAM_NOUNS = ['客户原话', '待确认点', '下一步', '负责人', '交付时间', '风险点', '修改原因', '口径', '进度', '待办', '问题清单', '结论', '依据', '版本号', '未决事项', '交接备注']

const CRAFTED = [
  '今日已为您准备好了最新的发文任务，一起继续加油吧！',
  '恒诚的一天，从看清期限开始。',
  '期限写清楚，心里就稳一半。',
  '客户看见的专业，藏在核对过的细节里。',
  '今天发出的邮件，要对得起案卷。',
  '审查意见先拆开，再决定怎么答。',
  '权利要求站得住，后面才好谈。',
  '附图和文字对上，提交才踏实。',
  '优先权日这种数字，不容记错。',
  '商标类别选准，比事后补救从容。',
  '译文交出去前，专有名词要统一。',
  '慢在核对，快在交付，是恒诚的节奏。',
  '一封邮件，只解决客户此刻的问题。',
  '不确定的句子，先圈出来再问。',
  '官文日期和内部期限，要能对上。',
  '交接时把口径写进备注。',
  '外观视图干净，审查才少往返。',
  '进入国家阶段前，把期限再算一遍。',
  '客户的话记原句，不要只记印象。',
  '复审理由可以短，依据不能少。',
  '无效的证据链，一环都不要断。',
  '今日清掉一件待办，案头就轻一点。',
  '发文是把对的文件，送到对的人。',
  '你多看的那一眼，客户会感觉到。',
  '专业不是喊出来的，是核对出来的。',
  '案卷离开自己之前，再通读一遍。',
  '恒诚的信用，长在每一次准时送达。',
  '把忙留给流程，把准留给客户。',
  '同事问起来，要能指出依据在哪一页。',
  '新申请交出去前，请求书和稿子一起对。',
  '补正不要只改表面，把通知里的点答完。',
  '同日申请的两类案子，期限要分开记。',
  '图片和简要说明，必须是同一件产品。',
  '版权登记先看权属，不看感觉。',
  '商标驳回先看群组，再谈怎么争。',
  '国际申请的期限，提前写进日历。',
  '外所的问题当天归类，不要攒成一堆。',
  '客户确认稿和最终稿，版本要分开。',
  '费用、期限、附件，三样齐了再发送。',
  '今日也适合把积压的官文登进监控。',
  '写给客户的话，少绕弯，多给结论。',
  '恒诚同事之间的口径，要比记忆可靠。',
  '一件案子的最后一公里，是发文前那次预览。',
  '对比文件在答复里，要叫得上号。',
  '保护范围写多宽，说明书就要撑得住。',
  '发明人署名，当场核对最省事。',
  '申请人地址变了，文稿和请求书一起改。',
  '年费快到了，比授权那天更要提醒。',
  '异议期不长，证据要趁早收齐。',
  '作品还没发表，权属也要先说清。',
  '今天的准确，会变成客户下一次的信任。',
  '把专业留在句子里，把匆忙留在流程外。',
  '你正在做的，是让创新被看得懂、被保住。',
  '深耕这一行，靠的是日复一日的准确。',
  '恒诚站在客户一侧，把知识产权的事办妥。',
  '邮件可以短，该有的信息不能缺。',
  '预览一次再发送，是对客户的基本礼貌。',
  '案头的秩序，就是对创新的尊重。',
  '专利、商标、版权，都吃同一份认真。',
  '恒诚的专业，不靠嗓门，靠经得起核对的稿子。'
]

function expandFamily(whens: string[], nouns: string[], focus: string): string[] {
  const lines: string[] = []
  for (const when of whens) {
    for (const noun of nouns) {
      if (when.includes(noun)) continue
      lines.push(`${when}，把${noun}再核对一遍。`)
      lines.push(`${when}，把${noun}写清楚。`)
      lines.push(`${when}，留一分钟给${noun}。`)
      lines.push(`${when}若只核对一件事，就看${noun}。`)
      lines.push(`${when}，${noun}要${focus}。`)
    }
  }
  for (const noun of nouns) {
    lines.push(`${noun}对齐了，这件事情才算稳。`)
    lines.push(`先把${noun}看准，再往下做。`)
    lines.push(`别小看${noun}，它经常决定案子顺不顺。`)
    lines.push(`${noun}清楚了，恒诚的交付才算完整。`)
  }
  return lines
}

function mix(seed: number, list: string[]): string[] {
  const copy = list.slice()
  let state = seed >>> 0
  for (let index = copy.length - 1; index > 0; index -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    const swap = state % (index + 1)
    const current = copy[index]
    copy[index] = copy[swap] ?? current
    copy[swap] = current
  }
  return copy
}

function accept(line: string, seen: Set<string>, picked: string[]): void {
  const text = line.trim()
  const size = [...text].length
  if (size < 12 || size > 32) return
  if (!/[。！]$/.test(text)) return
  if (seen.has(text)) return
  seen.add(text)
  picked.push(text)
}

function buildHomeLines(): string[] {
  const generated = [
    ...expandFamily(MAIL_WHENS, MAIL_NOUNS, '和案卷对得上'),
    ...expandFamily(DRAFT_WHENS, DRAFT_NOUNS, '和交底对得上'),
    ...expandFamily(LIMIT_WHENS, LIMIT_NOUNS, '单独记一笔'),
    ...expandFamily(MARK_WHENS, MARK_NOUNS, '和客户确认过'),
    ...expandFamily(FOREIGN_WHENS, FOREIGN_NOUNS, '和原文对得上'),
    ...expandFamily(TEAM_WHENS, TEAM_NOUNS, '写给下一手')
  ]
  const picked: string[] = []
  const seen = new Set<string>()
  for (const line of CRAFTED) accept(line, seen, picked)
  for (const line of mix(20261001, generated)) {
    if (picked.length >= 5000) break
    accept(line, seen, picked)
  }
  if (picked.length !== 5000) throw new Error(`首页文库只有 ${picked.length} 条，不足 5000。`)
  return picked
}

export const HOME_LINES: readonly string[] = buildHomeLines()

export function pickHomeLine(random: () => number = Math.random): string {
  const index = Math.min(HOME_LINES.length - 1, Math.floor(Math.max(0, random()) * HOME_LINES.length))
  return HOME_LINES[index] ?? HOME_LINES[0]
}
