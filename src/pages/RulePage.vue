<script setup>
import { computed, inject, reactive, ref } from 'vue'
import PageHead from '../components/PageHead.vue'
import BrandLogo from '../components/BrandLogo.vue'
import { bg, icon } from '../assets'
import { customers, mappings } from '../data'

const ui = inject('ui')
const focus = ref('客户发文方式')
const localCustomers = reactive(customers.slice(0, 5).map((c) => ({ ...c })))
const rows = computed(() => localCustomers.filter((c) => !ui.search.value || c.name.includes(ui.search.value) || c.short.includes(ui.search.value)))
const jumps = [
  ['客户发文方式', 0, '按客户设置发文策略', 'tone-pink'],
  ['文件描述→发文类型映射', 1, '智能匹配发文类型', 'tone-blue'],
  ['收件人模板', 2, '快速配置收件人', 'tone-green'],
  ['抄送模板', 17, '常用抄送组合', 'tone-lilac'],
  ['标题注入规则', 20, '自动生成邮件标题', 'tone-orange'],
  ['全局签名', 3, '统一邮件签名', 'tone-sky']
]
const receivers = [['默认收件人','客户联系人 + 代理师','3'],['国内申请','客户专利部','3'],['外国申请','客户海外代理','4'],['审查意见答复','审查员 + 客户','5'],['缴费通知','客户联系人','3'],['变更请求','客户联系人 + 申请员','4']]
const copies = [['内部团队','项目团队成员','3'],['法务抄送','法务部','3'],['财务抄送','财务部','2'],['管理层','总经理 + 运营负责人','2'],['客户抄送','客户指定抄送人','4'],['不抄送','无抄送人','0']]
const titleRules = reactive([
  { name: '默认规则', expr: '【客户简称】【发文类型】-【申请号】-【文件日期】', on: true },
  { name: '仅发文类型', expr: '【发文类型】【申请号】', on: false },
  { name: '客户 + 类型', expr: '【客户名称】【发文类型】', on: true }
])
</script>

<template>
  <PageHead title="发文规则与映射配置" desc="配置企业个性化发文规则，让自动化更贴合您的业务场景。" :art="bg('规则配置好，发文更轻松.png')" art-large />
  <div class="quick-grid">
    <button v-for="j in jumps" :key="j[0]" class="quick" :class="[j[3], { picked: focus === j[0] }]" @click="focus = j[0]; ui.notify('已定位到' + j[0])">
      <img :src="icon(j[1])" alt="" /><span><b>{{ j[0] }}</b><small>{{ j[2] }}</small></span>
    </button>
  </div>
  <div class="rule-layout">
    <section class="card">
      <div class="card-head"><h2><img :src="icon(0)" alt="" />客户发文方式</h2><button class="solid tiny" @click="ui.open('新增客户规则')">＋ 新增客户规则</button></div>
      <p class="hint">为不同客户配置默认的发文方式、审批设置等规则。</p>
      <label class="search slim"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M16 16l4 4" stroke="currentColor" stroke-width="1.7"/></svg><input v-model="ui.search.value" placeholder="搜索客户名称、公司简称..." /></label>
      <table class="grid">
        <thead><tr><th>客户名称</th><th>公司简称</th><th>默认发文方式</th><th>需要审批</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="c in rows" :key="c.name">
            <td class="who"><BrandLogo :brand="c.brand" /><span>{{ c.name }}</span></td>
            <td>{{ c.short }}</td>
            <td>{{ c.rule }}</td>
            <td><button class="switch" :class="{ on: c.approve }" @click="c.approve = !c.approve" /></td>
            <td><em class="status 启用中">● 启用</em></td>
            <td><button @click="ui.open(c.short)">编辑</button><button @click="ui.notify('更多操作')">···</button></td>
          </tr>
        </tbody>
      </table>
    </section>
    <section class="card">
      <div class="card-head"><h2><img :src="icon(1)" alt="" />文件描述 → 发文类型映射</h2><button class="solid tiny" @click="ui.open('新增映射')">＋ 新增映射</button></div>
      <p class="hint">根据文件描述关键词，自动匹配发文类型。</p>
      <table class="grid">
        <thead><tr><th>关键词（文件描述包含）</th><th>匹配的发文类型</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="m in mappings" :key="m.key">
            <td><em class="tag" :class="m.tone">{{ m.key }}</em></td>
            <td><em class="tag" :class="m.tone">{{ m.type }}</em></td>
            <td><button @click="ui.open(m.key)">编辑</button><button>···</button></td>
          </tr>
        </tbody>
      </table>
    </section>
    <section class="card">
      <div class="card-head"><h2>常用配置</h2></div>
      <button class="config" v-for="(n,i) in [['从历史数据生成规则','基于已有发文记录智能推荐',15],['导入配置','支持 Excel 批量导入',27],['导出配置','备份当前所有规则',2],['规则冲突检测','检测重复或冲突的规则',18],['恢复默认配置','一键恢复系统默认设置',31]]" :key="n[0]" @click="ui.open(n[0])">
        <img :src="icon(n[2])" alt="" /><span><b>{{ n[0] }}</b><small>{{ n[1] }}</small></span><i>›</i>
      </button>
    </section>
    <section class="card">
      <div class="card-head"><h2><img :src="icon(21)" alt="" />收件人模板</h2><button class="solid tiny" @click="ui.open('新增收件人模板')">＋ 新增模板</button></div>
      <p class="hint">预设常用收件人组合，一键应用到发文任务。</p>
      <div class="mini-cards">
        <button v-for="r in receivers" :key="r[0]" @click="ui.open(r[0])"><b>{{ r[0] }}</b><small>{{ r[1] }}</small><em>{{ r[2] }} 人</em></button>
      </div>
    </section>
    <section class="card">
      <div class="card-head"><h2><img :src="icon(17)" alt="" />抄送模板</h2><button class="solid tiny" @click="ui.open('新增抄送模板')">＋ 新增模板</button></div>
      <p class="hint">配置常用抄送人组合，支持部门、角色快速选择。</p>
      <div class="mini-cards">
        <button v-for="r in copies" :key="r[0]" @click="ui.open(r[0])"><b>{{ r[0] }}</b><small>{{ r[1] }}</small><em>{{ r[2] }} 人</em></button>
      </div>
    </section>
    <section class="card">
      <div class="card-head"><h2>最近修改记录</h2><button class="linkish">查看更多 ›</button></div>
      <div class="mini" v-for="n in [['林小樱','修改了客户「腾讯」的发文方式','今天 14:32'],['张小美','新增了文件描述映射规则','今天 11:15'],['王大明','更新了收件人模板「外国申请」','昨天 16:42'],['林小樱','修改了全局签名','昨天 09:20'],['陈老师','新增了抄送模板「管理层」','04-21 10:08']]" :key="n[1]">
        <b class="avatar-dot">{{ n[0].slice(0,1) }}</b><span><b>{{ n[0] }} {{ n[1] }}</b><small>{{ n[2] }}</small></span>
      </div>
    </section>
    <section class="card">
      <div class="card-head"><h2><img :src="icon(20)" alt="" />标题注入规则</h2><button class="solid tiny" @click="ui.open('新增标题规则')">＋ 新增规则</button></div>
      <p class="hint">自动在邮件标题中注入关键信息，支持自定义规则。</p>
      <div class="formula">【客户简称】【发文类型】-【申请号】-【文件日期】</div>
      <div class="vars">可用变量：客户名称　客户简称　发文类型　申请号　文件日期　自定义文本</div>
      <div class="rule-line" v-for="r in titleRules" :key="r.name">
        <button class="switch" :class="{ on: r.on }" @click="r.on = !r.on" />
        <b>{{ r.name }}</b><span>{{ r.expr }}</span>
        <button @click="ui.open(r.name)">编辑</button>
      </div>
    </section>
    <section class="card sign-card">
      <div class="card-head"><h2><img :src="icon(3)" alt="" />全局签名</h2><button class="solid tiny" @click="ui.open('编辑签名')">编辑签名</button></div>
      <p class="hint">所有发文邮件自动添加的统一签名。</p>
      <div class="signature">
        此致<br />敬礼！<br /><b>林小樱</b>　Patent Attorney<br />
        PatMail 知识产权代理有限公司<br />☎ +86 10 1234 5678<br />✉ linxiaoying@patmail.com<br />北京市海淀区中关村大街1号
      </div>
      <img :src="bg('专业文书准确送达.png')" alt="好的规则是高效发文的开始" />
    </section>
  </div>
</template>
