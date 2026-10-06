export const nav = [
  { name: '首页', path: 'home' },
  { name: '发文任务', path: 'task' },
  { name: '发文规则与映射配置', path: 'rule' },
  { name: '客户管理', path: 'users' },
  { name: '文件管理', path: 'file' },
  { name: '期限监控', path: 'limit' },
  { name: '发文记录', path: 'record' },
  { name: '统计报表', path: 'chart' }
]

export const customers = [
  { brand: 'huawei', name: '华为技术有限公司', short: '华为', slogan: '创新不止 · 连接未来', industry: '通信/电子', mode: '邮箱发文', rule: '系统自动发文', to: '华为-默认', cc: '华为-抄送', history: 12, status: '启用中', approve: false },
  { brand: 'tencent', name: '腾讯科技（深圳）有限公司', short: '腾讯', slogan: '科技向善', industry: '互联网', mode: '邮箱发文', rule: '人工审核后发文', to: '腾讯-默认', cc: '腾讯-抄送', history: 8, status: '启用中', approve: true },
  { brand: 'alibaba', name: '阿里巴巴（中国）有限公司', short: '阿里', slogan: '让天下没有难做的生意', industry: '互联网', mode: '系统发文', rule: '系统自动发文', to: '阿里-默认', cc: '阿里-法务', history: 15, status: '启用中', approve: false },
  { brand: 'bytedance', name: '北京字节跳动科技有限公司', short: '字节', slogan: '激发创造 · 丰富生活', industry: '互联网', mode: '邮箱发文', rule: '仅生成草稿', to: '字节-默认', cc: '字节-抄送', history: 9, status: '启用中', approve: true },
  { brand: 'catl', name: '宁德时代新能源科技股份有限公司', short: '宁德时代', slogan: '新能源 · 更美好', industry: '新能源', mode: '系统发文', rule: '系统自动发文', to: '宁德-默认', cc: '宁德-抄送', history: 6, status: '启用中', approve: false },
  { brand: 'netease', name: '网易（杭州）网络有限公司', short: '网易', slogan: '游戏热爱者', industry: '互联网', mode: '邮箱发文', rule: '系统自动发文', to: '网易-默认', cc: '网易-抄送', history: 10, status: '启用中', approve: false },
  { brand: 'xiaomi', name: '小米科技有限责任公司', short: '小米', slogan: '永远相信美好的事情即将发生', industry: '消费电子', mode: '邮箱发文', rule: '系统自动发文', to: '小米-默认', cc: '小米-抄送', history: 7, status: '暂停', approve: false },
  { brand: 'bili', name: '上海哔哩哔哩科技有限公司', short: 'B站', slogan: '你感兴趣的视频都在B站', industry: '文化娱乐', mode: '邮箱发文', rule: '系统自动发文', to: 'B站-默认', cc: 'B站-抄送', history: 5, status: '启用中', approve: false },
  { brand: 'baidu', name: '百度在线网络技术（北京）有限公司', short: '百度', slogan: '百度一下', industry: '互联网', mode: '邮箱发文', rule: '系统自动发文', to: '百度-默认', cc: '百度-抄送', history: 14, status: '启用中', approve: false },
  { brand: 'jd', name: '京东科技控股股份有限公司', short: '京东', slogan: '多快好省', industry: '互联网', mode: '邮箱发文', rule: '系统自动发文', to: '京东-默认', cc: '京东-抄送', history: 9, status: '启用中', approve: true },
  { brand: 'midea', name: '美的集团股份有限公司', short: '美的', slogan: '科技尽善 · 生活尽美', industry: '制造业', mode: '向客户发文', rule: '系统自动发文', to: '美的-默认', cc: '美的-抄送', history: 11, status: '启用中', approve: false },
  { brand: 'pingan', name: '中国平安科技（集团）有限公司', short: '平安', slogan: '专业让生活更简单', industry: '金融', mode: '邮箱发文', rule: '系统自动发文', to: '平安-默认', cc: '平安-抄送', history: 8, status: '启用中', approve: false },
  { brand: 'zte', name: '中兴通讯股份有限公司', short: '中兴', slogan: '网络联接世界', industry: '通信/电子', mode: '邮箱发文', rule: '系统自动发文', to: '中兴-默认', cc: '中兴-抄送', history: 6, status: '启用中', approve: false },
  { brand: 'meituan', name: '美团（北京）科技有限公司', short: '美团', slogan: '帮大家吃得更好', industry: '互联网', mode: '邮箱发文', rule: '系统自动发文', to: '美团-默认', cc: '美团-抄送', history: 4, status: '启用中', approve: false }
]

export const homeTasks = [
  { brand: 'huawei', name: '华为技术有限公司', type: '同客户合并发文', count: 12, status: '已完成', time: '04-22 14:30' },
  { brand: 'tencent', name: '腾讯科技（深圳）有限公司', type: '单个来文发文', count: 8, status: '执行中', time: '04-22 13:15' },
  { brand: 'alibaba', name: '阿里巴巴（中国）有限公司', type: '同客户合并发文', count: 25, status: '待审核', time: '04-22 11:20' },
  { brand: 'bytedance', name: '北京字节跳动科技有限公司', type: '单个来文发文', count: 6, status: '失败', time: '04-22 10:05' },
  { brand: 'catl', name: '宁德时代新能源科技股份有限公司', type: '同客户合并发文', count: 18, status: '已完成', time: '04-22 09:40' },
  { brand: 'netease', name: '网易（杭州）网络有限公司', type: '单个来文发文', count: 7, status: '执行中', time: '04-21 17:22' }
]

export const tasks = [
  { brand: 'huawei', name: '华为技术有限公司', mode: '向客户发文', count: 12, priority: '高', status: '待发', time: '2024-04-22 14:30', action: '执行' },
  { brand: 'tencent', name: '腾讯科技（深圳）有限公司', mode: '邮箱发文', count: 8, priority: '中', status: '处理中', time: '2024-04-22 13:15', action: '查看' },
  { brand: 'alibaba', name: '阿里巴巴（中国）有限公司', mode: '向客户发文', count: 25, priority: '高', status: '待审核', time: '2024-04-22 11:20', action: '查看' },
  { brand: 'bytedance', name: '北京字节跳动科技有限公司', mode: '邮箱发文', count: 6, priority: '中', status: '已完成', time: '2024-04-22 10:05', action: '查看' },
  { brand: 'catl', name: '宁德时代新能源科技股份有限公司', mode: '向客户发文', count: 18, priority: '高', status: '发送中', time: '2024-04-22 09:40', action: '查看' },
  { brand: 'netease', name: '网易（杭州）网络有限公司', mode: '邮箱发文', count: 7, priority: '低', status: '已完成', time: '2024-04-21 17:22', action: '查看' },
  { brand: 'xiaomi', name: '小米科技有限责任公司', mode: '向客户发文', count: 10, priority: '中', status: '待发', time: '2024-04-21 16:18', action: '执行' },
  { brand: 'baidu', name: '百度在线网络技术（北京）有限公司', mode: '邮箱发文', count: 14, priority: '低', status: '已完成', time: '2024-04-21 14:06', action: '查看' },
  { brand: 'jd', name: '京东科技控股股份有限公司', mode: '邮箱发文', count: 9, priority: '中', status: '待审核', time: '2024-04-21 11:33', action: '查看' },
  { brand: 'midea', name: '美的集团股份有限公司', mode: '向客户发文', count: 11, priority: '高', status: '失败', time: '2024-04-21 09:20', action: '重试' }
]

export const files = [
  { ext: 'pdf', name: '答复意见通知书.pdf', brand: 'huawei', customer: '华为技术有限公司', desc: 'OA答复意见通知书', type: '官方来文', time: '2024-04-22 14:30', status: '已归档', size: '1.2 MB' },
  { ext: 'docx', name: '权利要求书.docx', brand: 'tencent', customer: '腾讯科技（深圳）有限公司', desc: '修改后的权利要求书', type: '客户发文', time: '2024-04-22 13:15', status: '待处理', size: '860 KB' },
  { ext: 'pdf', name: '审查意见通知书.pdf', brand: 'alibaba', customer: '阿里巴巴（中国）有限公司', desc: '第二次审查意见', type: '官方来文', time: '2024-04-22 11:20', status: '已归档', size: '980 KB' },
  { ext: 'xlsx', name: '费用缴纳通知单.xlsx', brand: 'bytedance', customer: '北京字节跳动科技有限公司', desc: '年度缴纳清单', type: '官方来文', time: '2024-04-22 10:05', status: '异常', size: '240 KB' },
  { ext: 'pdf', name: '授权通知书.pdf', brand: 'catl', customer: '宁德时代新能源科技股份有限公司', desc: '发明专利授权通知', type: '官方来文', time: '2024-04-22 09:40', status: '已归档', size: '1.4 MB' },
  { ext: 'pptx', name: '技术方案说明.pptx', brand: 'netease', customer: '网易（杭州）网络有限公司', desc: '技术交底书', type: '客户发文', time: '2024-04-21 17:22', status: '待处理', size: '3.1 MB' },
  { ext: 'pdf', name: '检索报告.pdf', brand: 'pingan', customer: '中国平安科技（集团）有限公司', desc: '专利检索报告', type: '内部文件', time: '2024-04-21 16:08', status: '已归档', size: '2.2 MB' },
  { ext: 'docx', name: '审查意见答复.docx', brand: 'xiaomi', customer: '小米科技有限责任公司', desc: '审查意见答复', type: '客户发文', time: '2024-04-21 15:36', status: '待处理', size: '540 KB' }
]

export const limitRows = [
  { procId: 'demo-1', caseVolume: 'PA示例001', caseName: '电池模组结构', ctrlProc: '新申请', customerName: '宁德时代新能源科技股份有限公司', appNo: '202410000001.1', docDate: '2026-08-01', intDueDate: '2026-09-15', cusDueDate: '2026-09-20', legalDueDate: '2026-10-01' },
  { procId: 'demo-2', caseVolume: 'PA示例002', caseName: '充电控制方法', ctrlProc: '答复审查意见', customerName: '华为技术有限公司', appNo: '202410000002.8', docDate: '2026-08-12', intDueDate: '2026-09-18', cusDueDate: '2026-09-25', legalDueDate: '2026-10-08' }
]

export const records = [
  { id: 'PM20240428001', brand: 'huawei', name: '华为技术有限公司', method: '邮箱直发', subject: '关于专利申请的审查意见…', count: 12, time: '2024-04-28 14:30', reviewer: '张三', status: '发送成功' },
  { id: 'PM20240428002', brand: 'tencent', name: '腾讯科技（深圳）有限公司', method: '系统直发', subject: '发明专利年费缴纳通知', count: 8, time: '2024-04-28 13:15', reviewer: '李四', status: '发送成功' },
  { id: 'PM20240428003', brand: 'alibaba', name: '阿里巴巴（中国）有限公司', method: '系统直发', subject: '关于审查意见的答复文件', count: 25, time: '2024-04-28 12:10', reviewer: '王五', status: '发送失败' },
  { id: 'PM20240427008', brand: 'bytedance', name: '北京字节跳动科技有限公司', method: '系统直发', subject: 'PCT国际申请进入国家…', count: 6, time: '2024-04-27 16:42', reviewer: '张三', status: '待重试' },
  { id: 'PM20240427007', brand: 'catl', name: '宁德时代新能源科技股份有限公司', method: '邮箱直发', subject: '关于授权办理的通知', count: 18, time: '2024-04-27 10:20', reviewer: '李四', status: '发送成功' },
  { id: 'PM20240427006', brand: 'netease', name: '网易（杭州）网络有限公司', method: '邮箱直发', subject: '专利缴费提醒', count: 7, time: '2024-04-27 09:35', reviewer: '王五', status: '发送成功' },
  { id: 'PM20240426012', brand: 'xiaomi', name: '小米通讯技术有限公司', method: '系统直发', subject: '专利审查处理通知书', count: 10, time: '2024-04-26 17:13', reviewer: '张三', status: '发送失败' },
  { id: 'PM20240426011', brand: 'bili', name: '比亚迪股份有限公司', method: '邮箱直发', subject: '审查意见回复（修改稿）', count: 15, time: '2024-04-26 14:08', reviewer: '李四', status: '发送成功' },
  { id: 'PM20240426010', brand: 'jd', name: '京东方科技集团股份有限公司', method: '邮箱直发', subject: '发明专利年费公告通知', count: 9, time: '2024-04-26 11:25', reviewer: '王五', status: '发送成功' },
  { id: 'PM20240425009', brand: 'baidu', name: '百度在线网络技术（北京）有限公司', method: '系统直发', subject: '专利权评价报告', count: 6, time: '2024-04-25 16:18', reviewer: '张三', status: '待重试' }
]

export const ranks = [
  { brand: 'huawei', name: '华为技术有限公司', count: 256, rate: 97 },
  { brand: 'tencent', name: '腾讯科技（深圳）有限公司', count: 189, rate: 95 },
  { brand: 'alibaba', name: '阿里巴巴（中国）有限公司', count: 128, rate: 93 },
  { brand: 'bytedance', name: '北京字节跳动科技有限公司', count: 96, rate: 96 },
  { brand: 'catl', name: '宁德时代新能源科技股份有限公司', count: 78, rate: 92 },
  { brand: 'netease', name: '网易（杭州）网络有限公司', count: 64, rate: 95 },
  { brand: 'xiaomi', name: '小米科技有限责任公司', count: 52, rate: 94 },
  { brand: 'zte', name: '中兴通讯股份有限公司', count: 46, rate: 91 },
  { brand: 'baidu', name: '百度在线网络技术（北京）有限公司', count: 38, rate: 89 },
  { brand: 'meituan', name: '美团（北京）科技有限公司', count: 31, rate: 93 }
]

export const mappings = [
  { key: '授权', type: '授权通知书', tone: 'pink' },
  { key: '审查意见', type: '审查意见答复', tone: 'blue' },
  { key: '缴费', type: '缴费通知', tone: 'green' },
  { key: '变更', type: '变更请求', tone: 'orange' },
  { key: '恢复', type: '恢复权利请求', tone: 'purple' },
  { key: '放弃', type: '放弃专利权请求', tone: 'gray' }
]
