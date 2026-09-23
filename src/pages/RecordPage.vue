<script setup>
import { computed, inject, ref } from 'vue'
import PageHead from '../components/PageHead.vue'
import BrandLogo from '../components/BrandLogo.vue'
import { bg, icon } from '../assets'
import { records } from '../data'

const ui = inject('ui')
const tab = ref('全部记录')
const rows = computed(() => records.filter((r) => {
  const ok = tab.value === '全部记录' || r.status === tab.value
  const q = ui.search.value
  return ok && (!q || r.name.includes(q) || r.id.includes(q) || r.subject.includes(q))
}))
const templates = [
  ['审查意见答复模板', '适用于审查意见的答复文件', 12],
  ['年费缴纳通知模板', '适用于专利年费缴纳提醒', 4],
  ['授权办理通知模板', '适用于专利权授权后的手续办理', 11],
  ['PCT进入国家阶段模板', '适用于PCT国际申请进入国家阶段', 2],
  ['费用减缓申请模板', '适用于费用减缓相关文件', 27]
]
const rules = [
  ['客户发文映射规则', '根据客户自动匹配发文方式'],
  ['文件命名规则', '按申请号+文件类型自动命名'],
  ['邮件主题规则', '根据文件类型生成邮件主题'],
  ['发送时间规则', '工作日 9:00-18:00 自动发送'],
  ['失败重试规则', '失败后间隔 30 分钟自动重试']
]
</script>

<template>
  <PageHead title="发文记录" desc="记录每一次专业的发送，让专利服务更透明、更可追溯。" :art="bg('靠近成功的一步.png')" />
  <div class="with-rail">
    <div class="col">
      <div class="metric-row">
        <article class="metric tone-pink"><img :src="icon(11)" alt="" /><div><b>今日发文</b><strong>28</strong><small class="up">↑ 较昨日 +12%</small></div></article>
        <article class="metric tone-green"><img :src="icon(25)" alt="" /><div><b>发送成功率</b><strong>94.7%</strong><small class="up">↑ 较昨日 +2.3%</small></div></article>
        <article class="metric tone-rose"><img :src="icon(30)" alt="" /><div><b>发送失败</b><strong>5</strong><small class="down">↓ 较昨日 -50%</small></div></article>
        <article class="metric tone-blue"><img :src="icon(23)" alt="" /><div><b>待重试</b><strong>9</strong><small class="down">↓ 较昨日 -25%</small></div></article>
      </div>
      <section class="card">
        <div class="tabs">
          <button v-for="t in ['全部记录','发送成功','发送失败','待重试','已取消']" :key="t" :class="{ on: tab === t }" @click="tab = t">{{ t }}</button>
          <button class="linkish push" @click="ui.open('高级筛选')">高级筛选 ▾</button>
        </div>
        <div class="filters">
          <input value="2024-04-01　～　2024-04-28" readonly />
          <select><option>全部客户</option></select>
          <select><option>全部发文方式</option><option>邮箱直发</option><option>系统直发</option></select>
          <select><option>全部状态</option></select>
        </div>
        <div class="filters">
          <label class="grow"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M16 16l4 4" stroke="currentColor" stroke-width="1.7"/></svg><input v-model="ui.search.value" placeholder="搜索批次号、邮件主题、申请号..." /></label>
          <button class="solid" @click="ui.notify('搜索完成')">搜索</button>
          <button class="ghost" @click="ui.search.value = ''">重置</button>
        </div>
        <table class="grid">
          <thead><tr><th></th><th>发文批次</th><th>客户名称</th><th>发文方式</th><th>邮件主题</th><th>文件数</th><th>发送时间</th><th>审核人</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-for="r in rows" :key="r.id">
              <td><input type="checkbox" /></td>
              <td>{{ r.id }}</td>
              <td class="who"><BrandLogo :brand="r.brand" /><span>{{ r.name }}</span></td>
              <td>✉ {{ r.method }}</td>
              <td>{{ r.subject }}</td>
              <td>{{ r.count }}</td>
              <td>{{ r.time }}</td>
              <td>{{ r.reviewer }}</td>
              <td><em class="status" :class="r.status">● {{ r.status }}</em></td>
              <td><button @click="ui.open(r.id)">查看</button><button @click="ui.notify(r.status === '发送成功' ? '已打开详情' : '已加入重试队列')">{{ r.status === '发送成功' ? '详情' : '重新发送' }}</button></td>
            </tr>
          </tbody>
        </table>
        <div class="pager"><span>已选择 0 项</span><span>共 328 条记录</span><div><button>‹</button><button class="on">1</button><button>2</button><button>3</button><button>4</button><button>5</button><button>···</button><button>33</button><button>›</button></div><button class="ghost">10 条/页 ▾</button></div>
      </section>
      <div class="pair">
        <section class="card">
          <div class="card-head"><h2>最近发送动态</h2><button class="linkish">查看更多 ›</button></div>
          <div class="feed" v-for="r in records.slice(0, 4)" :key="r.id">
            <b>{{ r.time.slice(11) }}</b>
            <em class="status" :class="r.status">● {{ r.status }}</em>
            <span>{{ r.name }}</span>
            <small>{{ r.subject }}</small>
          </div>
        </section>
        <img class="quote" :src="bg('专业与信任.png')" alt="发出的不只是邮件，更是专业与信任" />
      </div>
    </div>
    <aside class="rail">
      <section class="card">
        <div class="card-head"><h2>最近发文模板</h2><button class="linkish">查看更多 ›</button></div>
        <div class="mini" v-for="t in templates" :key="t[0]"><img :src="icon(t[2])" alt="" /><span><b>{{ t[0] }}</b><small>{{ t[1] }}</small></span><button class="use" @click="ui.open(t[0])">使用</button></div>
      </section>
      <section class="card">
        <div class="card-head"><h2>常用规则</h2><button class="linkish" @click="ui.go('发文规则与映射配置')">查看更多 ›</button></div>
        <div class="mini" v-for="(r,i) in rules" :key="r[0]"><img :src="icon([31,2,20,23,30][i])" alt="" /><span><b>{{ r[0] }}</b><small>{{ r[1] }}</small></span><button class="use" @click="ui.open(r[0])">使用</button></div>
      </section>
      <section class="card soft-note">
        <p>✓ 自动化让专业更专注</p>
        <p>✓ 减少重复，让创造发生</p>
        <p>✓ 与创新同行，温柔而坚定</p>
      </section>
    </aside>
  </div>
</template>
