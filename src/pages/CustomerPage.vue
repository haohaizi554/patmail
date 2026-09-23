<script setup>
import { computed, inject } from 'vue'
import PageHead from '../components/PageHead.vue'
import BrandLogo from '../components/BrandLogo.vue'
import Donut from '../components/Donut.vue'
import { bg, icon } from '../assets'
import { customers } from '../data'

const ui = inject('ui')
const rows = computed(() => customers.slice(0, 8).filter((c) => !ui.search.value || c.name.includes(ui.search.value) || c.slogan.includes(ui.search.value)))
const parts = [
  { name: '互联网', value: 25, count: 32, color: '#ff5d98' },
  { name: '通信/电子', value: 19, count: 24, color: '#5eb2f6' },
  { name: '新能源', value: 14, count: 18, color: '#3dce9a' },
  { name: '生物医药', value: 13, count: 16, color: '#b48bff' },
  { name: '机械制造', value: 9, count: 12, color: '#ffb15c' },
  { name: '其他', value: 20, count: 26, color: '#c5cad8' }
]
const recent = [
  ['huawei', '华为技术有限公司', '更新了收件人模板', '今天 14:32'],
  ['tencent', '腾讯科技（深圳）有限公司', '新增了抄送人规则', '今天 11:20'],
  ['alibaba', '阿里巴巴（中国）有限公司', '更新了抄送人信息', '昨天 16:45'],
  ['bytedance', '北京字节跳动科技有限公司', '配置了发文规则', '昨天 10:18'],
  ['xiaomi', '小米科技有限责任公司', '更新了联系人', '04-21 09:12']
]
</script>

<template>
  <PageHead title="客户管理" desc="管理客户信息与发文配置，让每一位客户都享受专业、高效、贴心的服务。" :art="bg('靠近成功的一步.png')" />
  <div class="metric-row four-gap">
    <article class="metric tone-pink"><img :src="icon(0)" alt="" /><div><b>客户总数</b><strong>128</strong><small class="up">↑ +12%　较上月</small></div></article>
    <article class="metric tone-green"><img :src="icon(1)" alt="" /><div><b>启用中</b><strong>102</strong><small class="up">↑ +8%　较上月</small></div></article>
    <article class="metric tone-blue"><img :src="icon(23)" alt="" /><div><b>最近更新</b><strong>18</strong><small class="up">+14</small></div></article>
    <article class="metric tone-orange"><img :src="icon(21)" alt="" /><div><b>重点客户</b><strong>24</strong><small>占比 19%</small></div></article>
  </div>
  <div class="with-rail">
    <div class="col">
      <section class="card">
        <div class="filters">
          <label class="grow"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M16 16l4 4" stroke="currentColor" stroke-width="1.7"/></svg><input v-model="ui.search.value" placeholder="搜索客户名称、联系人或关键词..." /></label>
          <select><option>全部行业</option><option>互联网</option><option>通信/电子</option><option>新能源</option></select>
          <select><option>全部状态</option><option>启用中</option><option>暂停</option></select>
          <select><option>默认发文方式</option><option>邮箱发文</option><option>系统发文</option></select>
          <button class="solid" @click="ui.notify('已按条件搜索')">搜索</button>
          <button class="ghost" @click="ui.search.value = ''">重置</button>
          <button class="ghost" @click="ui.notify('更多筛选')">···</button>
        </div>
        <table class="grid">
          <thead><tr><th></th><th>客户名称</th><th>行业</th><th>默认发文方式</th><th>收件人模板</th><th>抄送模板</th><th>历史模板</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-for="c in rows" :key="c.name">
              <td><input type="checkbox" /></td>
              <td class="who"><BrandLogo :brand="c.brand" /><span>{{ c.name }}<small>{{ c.slogan }}</small></span></td>
              <td>{{ c.industry }}</td>
              <td>✉ {{ c.mode }}</td>
              <td><em class="chip">{{ c.to }}</em></td>
              <td><em class="chip">{{ c.cc }}</em></td>
              <td><em class="chip">历史 {{ c.history }}</em></td>
              <td><em class="status" :class="c.status === '暂停' ? '暂停' : '启用中'">● {{ c.status }}</em></td>
              <td><button @click="ui.open(c.name)">查看</button><button @click="ui.open('编辑 ' + c.short)">编辑</button></td>
            </tr>
          </tbody>
        </table>
      </section>
      <div class="pair">
        <section class="card">
          <div class="card-head"><h2><img :src="icon(10)" alt="" />客户分布（按行业）</h2><button class="linkish">查看更多 ›</button></div>
          <div class="donut-box">
            <Donut :parts="parts" :size="132"><span>客户总数</span><b>128</b></Donut>
            <ul><li v-for="p in parts" :key="p.name"><i :style="{ background: p.color }" />{{ p.name }}<b>{{ p.count }}</b><small>{{ p.value }}%</small></li></ul>
          </div>
        </section>
        <img class="quote" :src="bg('专业与信任.png')" alt="用专业的服务，收获长久的信任" />
      </div>
    </div>
    <aside class="rail">
      <section class="card">
        <div class="card-head"><h2>最近维护客户</h2><button class="linkish">查看更多 ›</button></div>
        <div class="mini" v-for="r in recent" :key="r[1]"><BrandLogo :brand="r[0]" /><span><b>{{ r[1] }}</b><small>{{ r[2] }}</small></span><small>{{ r[3] }}</small></div>
      </section>
      <section class="card">
        <div class="card-head"><h2><img :src="icon(13)" alt="" />快速创建客户规则</h2></div>
        <div class="action-grid two">
          <button class="tone-pink" @click="ui.open('新建客户')"><img :src="icon(0)" alt="" /><b>新建客户</b><small>快速录入客户信息</small></button>
          <button class="tone-blue" @click="ui.open('从模板创建')"><img :src="icon(2)" alt="" /><b>从模板创建</b><small>基于现有客户模板</small></button>
          <button class="tone-green" @click="ui.open('批量导入')"><img :src="icon(27)" alt="" /><b>批量导入</b><small>Excel 批量导入</small></button>
          <button class="tone-purple" @click="ui.open('智能识别')"><img :src="icon(28)" alt="" /><b>智能识别</b><small>从历史邮件识别</small></button>
        </div>
      </section>
      <section class="card tip">
        <div class="card-head"><h2><img :src="icon(29)" alt="" />小贴士</h2><button class="linkish">换一条 ›</button></div>
        <p>为重要客户设置专属发文模板，可以显著提升发文效率和准确性哦！</p>
      </section>
    </aside>
  </div>
</template>
