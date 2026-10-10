<script setup>
import { inject, ref } from 'vue'
import PageHead from '../components/PageHead.vue'
import BrandLogo from '../components/BrandLogo.vue'
import Donut from '../components/Donut.vue'
import { bg, icon } from '../assets'
import ThemeSelect from '../components/ThemeSelect.vue'
import { textOptions } from '../components/theme-select'
import { ranks } from '../data'

const ui = inject('ui')
const range = ref('最近30天')
const modeParts = [
  { name: '自动发文', value: 62, count: 823, color: '#ff5d98' },
  { name: '手动发文', value: 24, count: 318, color: '#5eb2f6' },
  { name: '批量发文', value: 10, count: 133, color: '#ffb15c' },
  { name: 'API发文', value: 4, count: 52, color: '#c9a6ff' }
]
const failParts = [
  { name: '文件格式错误', value: 41, count: 32, color: '#ff5d98' },
  { name: '官方系统异常', value: 23, count: 18, color: '#5eb2f6' },
  { name: '客户信息不匹配', value: 15, count: 12, color: '#ffb15c' },
  { name: '网络超时', value: 10, count: 8, color: '#7d8cff' },
  { name: '文件内容不合规', value: 6, count: 5, color: '#3dce9a' },
  { name: '其他原因', value: 5, count: 3, color: '#c5cad8' }
]
const alerts = [
  ['北京某客户连续 3 次发文失败', '2 小时前'],
  ['官方系统响应较慢（>10s）', '4 小时前'],
  ['2 个文件格式不符合要求', '6 小时前'],
  ['客户邮箱配置未完成', '1 天前']
]
</script>

<template>
  <div class="stats-head">
    <PageHead title="统计报表" desc="用数据看见每一份努力，持续优化，让专利发文更简单！" :art="bg('今天也要高效发文.png')" />
    <div class="range">
      <input value="2024年4月1日　-　2024年4月28日" readonly />
      <button v-for="r in ['最近7天','最近30天','最近3个月','自定义']" :key="r" :class="{ on: range === r }" @click="range = r">{{ r }}</button>
    </div>
  </div>
  <div class="stats-top">
    <div class="metric-row">
      <article class="metric tone-pink"><img :src="icon(11)" alt="" /><div><b>发文总量</b><strong>1,326</strong><small class="up">↑ +12%　较上月</small></div></article>
      <article class="metric tone-green"><img :src="icon(25)" alt="" /><div><b>成功率</b><strong>94.2%</strong><small class="up">↑ +2.5%　较上月</small></div></article>
      <article class="metric tone-blue"><img :src="icon(5)" alt="" /><div><b>平均处理时长</b><strong>2.3 小时</strong><small class="down">↓ -18%　较上月</small></div></article>
      <article class="metric tone-purple"><img :src="icon(17)" alt="" /><div><b>客户覆盖数</b><strong>62</strong><small class="up">↑ +10%　较上月</small></div></article>
    </div>
    <section class="card highlights">
      <h2>本周亮点</h2>
      <p><b>发文总量较上周增长 28%</b><small>本周完成 356 份发文任务</small></p>
      <p><b>成功率保持在 94% 以上</b><small>高于近一个月平均水平</small></p>
      <p><b>新增客户 8 个</b><small>累计客户数达 62 个</small></p>
      <p><b>平均处理时长缩短 18%</b><small>从 2.8 小时降至 2.3 小时</small></p>
    </section>
  </div>
  <div class="stats-grid">
    <section class="card span2">
      <div class="card-head"><h2><img :src="icon(10)" alt="" />发文趋势</h2>
        <span class="legend-inline"><i style="background:#ff5d98" />发文总量　<i style="background:#5eb2f6" />成功数量　<i style="background:#ffb15c" />失败数量</span>
        <ThemeSelect :options="textOptions(['按天', '按周'])" />
      </div>
      <div class="line">
        <svg viewBox="0 0 760 180" preserveAspectRatio="none">
          <polyline fill="none" stroke="#ff5d98" stroke-width="3" points="0,120 40,132 80,118 120,100 160,108 200,92 240,78 280,70 320,62 360,80 400,74 440,58 480,66 520,72 560,88 600,80 640,70 680,74 720,52 760,64"/>
          <polyline fill="none" stroke="#5eb2f6" stroke-width="3" points="0,138 40,148 80,136 120,122 160,128 200,114 240,102 280,96 320,86 360,104 400,98 440,84 480,92 520,98 560,112 600,104 640,94 680,96 720,78 760,90"/>
          <polyline fill="none" stroke="#ffb15c" stroke-width="3" points="0,168 120,166 240,164 360,165 480,163 600,164 760,162"/>
        </svg>
        <div class="xlabel"><span v-for="d in ['04-01','04-04','04-07','04-10','04-13','04-16','04-19','04-22','04-25','04-28']" :key="d">{{ d }}</span></div>
      </div>
    </section>
    <section class="card">
      <div class="card-head"><h2>发文方式占比</h2><ThemeSelect :options="textOptions(['全部客户'])" /></div>
      <div class="donut-box">
        <Donut :parts="modeParts"><b>1,326</b><span>总发文数</span></Donut>
        <ul><li v-for="p in modeParts" :key="p.name"><i :style="{ background: p.color }" />{{ p.name }}<b>{{ p.value }}%</b><small>{{ p.count }}</small></li></ul>
      </div>
    </section>
    <section class="card">
      <div class="card-head"><h2>客户发文排行</h2><button class="linkish" @click="ui.notify('已展开 TOP 10')">TOP 10 ›</button></div>
      <table class="grid rank">
        <thead><tr><th>#</th><th>客户名称</th><th>发文数量</th><th>成功率</th></tr></thead>
        <tbody>
          <tr v-for="(r, i) in ranks" :key="r.name"><td>{{ i + 1 }}</td><td class="who"><BrandLogo :brand="r.brand" /><span v-hint.clip="r.name">{{ r.name }}</span></td><td>{{ r.count }}</td><td class="good">{{ r.rate }}%</td></tr>
        </tbody>
      </table>
    </section>
    <section class="card">
      <div class="card-head"><h2>失败原因分布</h2></div>
      <div class="donut-box">
        <Donut :parts="failParts" :size="128"><span>失败总数</span><b>78</b></Donut>
        <ul><li v-for="p in failParts" :key="p.name"><i :style="{ background: p.color }" />{{ p.name }}<b>{{ p.count }}</b><small>{{ p.value }}%</small></li></ul>
      </div>
    </section>
    <section class="card">
      <div class="card-head"><h2>本周概览</h2><span class="legend-inline"><i style="background:#ff8eb8" />发文总量　<i style="background:#8fd0ff" />成功数量</span></div>
      <div class="bars slim">
        <div v-for="(n, i) in [42, 55, 70, 48, 80, 36, 62]" :key="i"><i :style="{ height: n + '%' }" /><small>{{ ['4/22','4/23','4/24','4/25','4/26','4/27','4/28'][i] }}</small></div>
      </div>
      <div class="week-sum"><span>本周发文 <b>356</b></span><span>成功 <b>342</b></span><span>失败 <b>14</b></span><span>成功率 <b>94.4%</b></span></div>
    </section>
    <section class="card">
      <div class="card-head"><h2><img :src="icon(18)" alt="" />异常提醒</h2></div>
      <div class="remind" v-for="a in alerts" :key="a[0]"><i class="dot-red" /><span>{{ a[0] }}</span><small>{{ a[1] }}</small></div>
    </section>
    <img class="quote span-art" :src="bg('专注每一次发文，让知识更有力量.png')" alt="持续用数据优化，让专利发文变得更简单，也更温柔" />
  </div>
</template>
