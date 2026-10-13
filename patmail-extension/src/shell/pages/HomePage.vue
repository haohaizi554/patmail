<script setup>
import { inject } from 'vue'
import PageHead from '../components/PageHead.vue'
import BrandLogo from '../components/BrandLogo.vue'
import Donut from '../components/Donut.vue'
import { bg, icon } from '../assets'
import { homeTasks } from '../data'

const ui = inject('ui')
const quick = [
  ['新建发文任务', '一键创建 · 自动执行', 0, 'tone-pink', '新建发文任务'],
  ['客户管理', '维护客户配置', 1, 'tone-blue', '客户管理'],
  ['查询模板', '快速查询文件', 2, 'tone-green', '发文规则与映射配置'],
  ['发文规则', '配置映射关系', 3, 'tone-purple', '发文规则与映射配置'],
  ['文件预览', '查看历史文件', 4, 'tone-orange', '文件管理'],
  ['统计报表', '数据看板分析', 5, 'tone-sky', '统计报表']
]
const metrics = [
  ['已发文', '28', '+12%', '较昨日', 11, 'up', 'tone-pink'],
  ['处理中', '16', '-5%', '较昨日', 7, 'down', 'tone-blue'],
  ['待审核', '9', '-10%', '较昨日', 23, 'down', 'tone-purple'],
  ['文件总数', '1,326', '+8%', '较上周', 8, 'up', 'tone-lilac']
]
const parts = [
  { name: '已完成', value: 45, count: 28, color: '#ff5d98' },
  { name: '执行中', value: 26, count: 16, color: '#5eb2f6' },
  { name: '待审核', value: 15, count: 9, color: '#ffb15c' },
  { name: '失败', value: 8, count: 5, color: '#ff8eb8' },
  { name: '已暂停', value: 6, count: 4, color: '#d5d8e4' }
]
const actions = [
  ['扫描当前页面', '更新字段结构', 14, 'tone-pink'],
  ['从历史模板创建任务', '创建任务', 15, 'tone-blue'],
  ['批量自动发文', '按规则执行', 16, 'tone-green'],
  ['文件描述映射', '配置维护', 17, 'tone-lilac'],
  ['收件人模板', '快速设置', 21, 'tone-orange'],
  ['签名与标题', '全局规则', 20, 'tone-sky']
]
const bars = [28, 36, 78, 34, 52, 30, 44]
const reminders = [
  ['检测到系统字段发生变化，建议重新扫描页面', '重要', '2 小时前', 'dot-red'],
  ['客户「宁德时代」的发文规则已更新', '提示', '4 小时前', 'dot-blue'],
  ['有 3 个任务执行失败，请及时处理', '警告', '6 小时前', 'dot-orange']
]
</script>

<template>
  <PageHead title="下午好，林小樱！" desc="今日已为您准备好了最新的发文任务，一起继续加油吧！" :art="bg('专注每一次发文，让知识更有力量.png')" />
  <div class="quick-grid">
    <button v-for="q in quick" :key="q[0]" class="quick" :class="q[3]" @click="q[0] === '新建发文任务' ? ui.open(q[4]) : ui.go(q[4])">
      <img :src="icon(q[2])" alt="" />
      <span><b>{{ q[0] }}</b><small>{{ q[1] }}</small></span>
    </button>
  </div>
  <div class="home-grid">
    <div class="col">
      <section class="card">
        <div class="card-head"><h2><img :src="icon(10)" alt="" />今日概览</h2><span>2024年4月22日 星期一</span></div>
        <div class="metric-row">
          <article v-for="m in metrics" :key="m[0]" class="metric" :class="m[6]">
            <img :src="icon(m[4])" alt="" />
            <div>
              <b>{{ m[0] }}</b>
              <strong>{{ m[1] }}</strong>
              <small :class="m[5]"><i>{{ m[5] === 'up' ? '↑' : '↓' }}</i> {{ m[2] }}　{{ m[3] }}</small>
            </div>
          </article>
        </div>
      </section>
      <section class="card">
        <div class="card-head"><h2><img :src="icon(11)" alt="" />最近发文任务</h2><button class="linkish" @click="ui.go('发文任务')">查看全部 ›</button></div>
        <table class="grid">
          <thead><tr><th>客户名称</th><th>发文类型</th><th>文件数量</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-for="row in homeTasks" :key="row.name">
              <td class="who"><BrandLogo :brand="row.brand" /><span v-hint.clip="row.name">{{ row.name }}</span></td>
              <td>{{ row.type }}</td>
              <td>{{ row.count }}</td>
              <td><em class="status" :class="row.status">● {{ row.status }}</em></td>
              <td>{{ row.time }}</td>
              <td><button @click="ui.open(row.name)">查看</button><button @click="ui.notify('更多操作')">···</button></td>
            </tr>
          </tbody>
        </table>
      </section>
      <div class="remind-row">
        <section class="card">
          <div class="card-head"><h2><img :src="icon(18)" alt="" />系统提醒</h2></div>
          <div v-for="item in reminders" :key="item[0]" class="remind">
            <i :class="item[3]" />
            <span>{{ item[0] }}</span>
            <em :class="item[3]">{{ item[1] }}</em>
            <small>{{ item[2] }}</small>
          </div>
        </section>
        <img class="quote" :src="bg('自动化不是冷冰冰的工具.png')" alt="自动化不是冷冰冰的工具，而是让专业工作更温柔的伙伴" />
      </div>
    </div>
    <div class="col">
      <section class="card">
        <div class="card-head"><h2><img :src="icon(6)" alt="" />任务执行状态</h2><button class="linkish" @click="ui.go('发文任务')">查看全部 ›</button></div>
        <div class="donut-box">
          <Donut :parts="parts"><span>总任务</span><b>62</b></Donut>
          <ul>
            <li v-for="p in parts" :key="p.name"><i :style="{ background: p.color }" />{{ p.name }}<b>{{ p.count }}</b><small>{{ p.value }}%</small></li>
          </ul>
        </div>
      </section>
      <section class="card">
        <div class="card-head"><h2><img :src="icon(13)" alt="" />快捷操作</h2></div>
        <div class="action-grid">
          <button v-for="a in actions" :key="a[0]" :class="a[3]" @click="ui.open(a[0])">
            <img :src="icon(a[2])" alt="" /><b>{{ a[0] }}</b><small>{{ a[1] }}</small>
          </button>
        </div>
      </section>
      <section class="card">
        <div class="card-head"><h2><img :src="icon(19)" alt="" />本周统计</h2><button class="linkish" @click="ui.go('统计报表')">查看详情 ›</button></div>
        <div class="bars">
          <div v-for="(n, i) in bars" :key="i" :class="{ hot: i === 2 }">
            <em v-if="i === 2">周三<br />发文 48 篇</em>
            <i :style="{ height: n + '%' }" />
            <small>{{ ['周一','周二','周三','周四','周五','周六','周日'][i] }}</small>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
