<script setup>
import BrandLogo from '../components/BrandLogo.vue'
import { bg, icon } from '../assets'
import { inject } from 'vue'
const ui = inject('ui')
const hits = [
  ['huawei', '华为技术有限公司', '实审意见通知书', '同客户合并发文', '已匹配'],
  ['tencent', '腾讯科技（深圳）有限公司', '补正通知书', '单个来文发文', '已匹配'],
  ['alibaba', '阿里巴巴（中国）有限公司', '审查意见通知书', '同客户合并发文', '已匹配'],
  ['xiaomi', '小米通讯技术', '授权通知书', '单个来文发文', '待确认']
]
</script>

<template>
  <div class="browser">
    <div class="chrome">
      <div class="win-dots"><i /><i /><i /></div>
      <div class="tab">国家知识产权局 - 专利业务办理</div>
      <div class="omnibox">←　→　⟳　　https://cponline.cnipa.gov.cn</div>
      <button class="back-admin" @click="ui.go('首页')">返回后台</button>
    </div>
    <div class="site">
      <div class="site-banner"><b>国家知识产权局</b><span>专利业务办理系统</span></div>
      <div class="site-nav">首页　专利申请　文件查询　案件管理</div>
      <div class="site-row" v-for="n in 9" :key="n"><i /><span>2024 年专利申请业务记录</span><span>审查意见通知书</span><span>查看详情</span></div>
    </div>
    <aside class="float">
      <header>
        <img :src="bg('专利发文自动化.png')" alt="PatMail" />
        <div><b>发文助手浮窗</b><small>准备好帮你自动发文啦</small></div>
        <button @click="ui.go('首页')">×</button>
      </header>
      <img class="float-hello" :src="bg('让每一封专业邮件，都温柔且高效.png')" alt="" />
      <section>
        <div class="f-row"><img :src="icon(12)" alt="" /><b>当前客户</b><span>华为技术有限公司</span><button @click="ui.open('切换客户')">切换</button></div>
        <div class="f-row"><img :src="icon(2)" alt="" /><b>当前模板</b><span>发明专利-实审意见答复</span><button @click="ui.open('切换模板')">切换</button></div>
        <div class="f-row"><img :src="icon(31)" alt="" /><b>登录状态</b><span class="ok">● Cookie 已复用（已登录 2小时）</span><em>正常</em></div>
      </section>
      <section>
        <div class="card-head"><h2><img :src="icon(13)" alt="" />快速操作</h2><small>让重复工作变简单 ♡</small></div>
        <div class="float-actions">
          <button class="tone-pink" @click="ui.notify('正在扫描当前页面')"><img :src="icon(14)" alt="" /><b>扫描页面</b><small>识别当前文件</small></button>
          <button class="tone-purple" @click="ui.notify('正在读取模板')"><img :src="icon(12)" alt="" /><b>读取模板</b><small>匹配发文规则</small></button>
          <button class="tone-blue" @click="ui.notify('正在自动填表')"><img :src="icon(20)" alt="" /><b>自动填表</b><small>智能填写内容</small></button>
          <button class="tone-green" @click="ui.notify('发文已提交')"><img :src="icon(11)" alt="" /><b>提交发文</b><small>自动完成提交</small></button>
        </div>
      </section>
      <section>
        <div class="card-head"><h2>查询结果预览 <small>共 4 条匹配结果</small></h2><button class="linkish">查看全部 ›</button></div>
        <table class="grid">
          <thead><tr><th>客户</th><th>文件描述</th><th>发文方式</th><th>状态</th></tr></thead>
          <tbody>
            <tr v-for="h in hits" :key="h[1]"><td class="who"><BrandLogo :brand="h[0]" /><span>{{ h[1] }}</span></td><td>{{ h[2] }}</td><td>{{ h[3] }}</td><td><em class="status" :class="h[4] === '已匹配' ? '已完成' : '待处理'">● {{ h[4] }}</em></td></tr>
          </tbody>
        </table>
      </section>
      <section>
        <div class="card-head"><h2><img :src="icon(3)" alt="" />规则命中结果</h2><small>根据页面内容自动匹配规则</small></div>
        <div class="hit-grid">
          <button @click="ui.open('发文方式')"><b>发文方式</b><em>已命中</em><small>同客户合并发文</small></button>
          <button @click="ui.open('发文类型映射')"><b>发文类型映射</b><em>已命中</em><small>审查意见通知书 → 意见答复</small></button>
          <button @click="ui.open('收件人模板')"><b>收件人模板</b><em>已命中</em><small>华为 - 标准收件人 v3</small></button>
          <button @click="ui.open('标题规则')"><b>标题规则</b><em>已命中</em><small>【申请号】+ 文件类型 + 客户简称</small></button>
        </div>
      </section>
      <div class="float-cta">
        <button class="solid" @click="ui.notify('正在按规则执行全部发文')"><b>一键执行</b><small>按规则自动完成所有发文</small></button>
        <button class="ghost" @click="ui.go('发文任务')"><b>人工接管</b><small>跳转至页面手动操作</small></button>
      </div>
      <footer><button @click="ui.open('系统设置')">设置</button><span>♡ 专注细节，让知识更有力量 ♡</span><small>PatMail v1.2.0</small></footer>
    </aside>
  </div>
</template>
