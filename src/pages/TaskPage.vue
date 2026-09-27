<script setup>
import { computed, inject, ref } from 'vue'
import PageHead from '../components/PageHead.vue'
import BrandLogo from '../components/BrandLogo.vue'
import { bg, icon } from '../assets'
import { customers, tasks } from '../data'
import ThemeSelect from '../components/ThemeSelect.vue'

const ui = inject('ui')
const tab = ref('全部')
const status = ref('全部状态')
const mode = ref('全部发文方式')
const customer = ref('全部客户')
const page = ref(1)
const tabs = [['全部', 85], ['待发', 16], ['处理中', 12], ['待审核', 9], ['已完成', 48], ['已失败', 3]]
const rows = computed(() => tasks.filter((t) => {
  const tabOk = tab.value === '全部' || (tab.value === '已失败' ? t.status === '失败' : t.status === tab.value)
  const text = ui.search.value
  return tabOk && (status.value === '全部状态' || t.status === status.value) && (mode.value === '全部发文方式' || t.mode === mode.value) && (customer.value === '全部客户' || t.name === customer.value) && (!text || t.name.includes(text))
}))
</script>

<template>
  <div class="with-rail">
    <div class="col">
      <PageHead title="发文任务" desc="高效执行专利发文任务，让重要文件准时送达！" :art="bg('创业路上的小胜利.png')" />
      <div class="filters">
        <ThemeSelect v-model="customer" :options="[{ value: '全部客户', label: '全部客户' }, ...customers.map(c => ({ value: c.name, label: c.name }))]" />
        <ThemeSelect v-model="status" :options="[{ value: '全部状态', label: '全部状态' }, { value: '待发', label: '待发' }, { value: '处理中', label: '处理中' }, { value: '待审核', label: '待审核' }, { value: '已完成', label: '已完成' }, { value: '失败', label: '失败' }]" />
        <ThemeSelect v-model="mode" :options="[{ value: '全部发文方式', label: '全部发文方式' }, { value: '邮箱发文', label: '邮箱发文' }, { value: '向客户发文', label: '向客户发文' }]" />
        <input value="2024-04-01　～　2024-04-30" readonly />
        <label class="grow"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M16 16l4 4" stroke="currentColor" stroke-width="1.7"/></svg><input v-model="ui.search.value" placeholder="搜索任务名称、客户或文件..." /></label>
      </div>
      <div class="metric-row task-metrics">
        <article class="metric tall tone-pink"><img :src="icon(11)" alt="" /><div><b>待发任务</b><strong>16</strong><small class="up">↑ 较昨日 +6</small><button>需要尽快处理 ›</button></div></article>
        <article class="metric tall tone-blue"><img :src="icon(23)" alt="" /><div><b>处理中</b><strong>12</strong><small class="down">↓ 较昨日 -3</small><button>正在发送中 ›</button></div></article>
        <article class="metric tall tone-purple"><img :src="icon(8)" alt="" /><div><b>待审核</b><strong>9</strong><small class="up">↑ 较昨日 +2</small><button>需人工确认 ›</button></div></article>
        <article class="metric tall tone-green"><img :src="icon(25)" alt="" /><div><b>已完成</b><strong>48</strong><small class="up">↑ 较昨日 +12</small><button>今日已完成任务 ›</button></div></article>
      </div>
      <section class="card">
        <div class="card-head">
          <h2><img :src="icon(22)" alt="" />任务列表</h2>
          <button class="ghost" @click="ui.notify('已按创建时间倒序')">创建时间倒序 ▾</button>
        </div>
        <div class="tabs">
          <button v-for="t in tabs" :key="t[0]" :class="{ on: tab === t[0] }" @click="tab = t[0]">{{ t[0] }}<small v-if="t[0] !== '全部'"> ({{ t[1] }})</small><small v-else> ({{ t[1] }})</small></button>
        </div>
        <table class="grid">
          <thead><tr><th></th><th>客户名称</th><th>发文方式</th><th>文件数</th><th>优先级</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-for="row in rows" :key="row.name + row.time">
              <td><input type="checkbox" /></td>
              <td class="who"><BrandLogo :brand="row.brand" /><span>{{ row.name }}</span></td>
              <td>{{ row.mode }}</td>
              <td>{{ row.count }}</td>
              <td><em class="pri" :class="row.priority">{{ row.priority }}</em></td>
              <td><em class="status" :class="row.status">● {{ row.status }}</em></td>
              <td>{{ row.time }}</td>
              <td><button :class="{ go: row.action !== '查看' }" @click="ui.open(row.name)">{{ row.action }}</button><button @click="ui.notify('更多操作')">···</button></td>
            </tr>
          </tbody>
        </table>
        <div class="pager">
          <span>共 85 条任务</span>
          <div>
            <button>‹</button>
            <button v-for="n in [1,2,3,4,5,'···',9]" :key="n" :class="{ on: page === n }" @click="page = n">{{ n }}</button>
            <button>›</button>
          </div>
          <button class="ghost">10 条/页 ▾</button>
        </div>
      </section>
    </div>
    <aside class="rail">
      <section class="card">
        <div class="card-head"><h2><img :src="icon(13)" alt="" />快捷操作</h2></div>
        <button class="rail-btn solid" @click="ui.open('新建发文任务')"><img :src="icon(0)" alt="" /><span><b>新建发文任务</b><small>创建新的发文任务</small></span></button>
        <button class="rail-btn" @click="ui.notify('已准备批量执行')"><img :src="icon(26)" alt="" /><span><b>批量执行</b><small>选中任务一键发送</small></span></button>
        <button class="rail-btn" @click="ui.open('导入历史模板')"><img :src="icon(27)" alt="" /><span><b>导入历史模板</b><small>快速复用常用配置</small></span></button>
        <button class="rail-btn" @click="ui.open('预览邮件内容')"><img :src="icon(28)" alt="" /><span><b>预览邮件内容</b><small>检查发文内容与附件</small></span></button>
      </section>
      <img class="rail-art" :src="bg('专业文书准确送达.png')" alt="加油！让每一份专业文书准确送达" />
      <section class="card tip">
        <div class="card-head"><h2><img :src="icon(29)" alt="" />今日小贴士</h2><button class="linkish">换一条 ›</button></div>
        <img :src="bg('发文前预览一次.png')" alt="发送前预览一次，让专业更安心" />
      </section>
      <section class="card">
        <div class="card-head"><h2><img :src="icon(18)" alt="" />最近执行记录</h2><button class="linkish" @click="ui.go('发文记录')">查看更多 ›</button></div>
        <div class="mini" v-for="(n,i) in [['tencent','腾讯科技 · 8个文件','发送成功','2分钟前'],['alibaba','阿里巴巴 · 25个文件','正在发送中','12分钟前'],['huawei','华为技术 · 12个文件','任务已创建','28分钟前'],['xiaomi','小米科技 · 10个文件','审核已通过','1小时前']]" :key="i">
          <i :class="'s' + i" />
          <span><b>{{ n[1] }}</b><small>{{ n[2] }}</small></span>
          <small>{{ n[3] }}</small>
        </div>
      </section>
    </aside>
  </div>
</template>
