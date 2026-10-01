<script setup>
import { computed } from 'vue'
import Avatar from './Avatar.vue'
import { bg } from '../assets'
import { nav } from '../data'

const props = defineProps({
  page: String,
  search: String,
  placeholder: String,
  items: { type: Array, default: null },
  profileName: { type: String, default: '林小樱' },
  profileDept: { type: String, default: '知识产权部' },
  avatarSrc: { type: String, default: '' },
  showDemo: { type: Boolean, default: true },
  showSettings: { type: Boolean, default: true }
})
const emit = defineEmits(['navigate', 'update:search', 'settings', 'preview'])
const menu = computed(() => props.items || nav)
</script>

<template>
  <div class="shell">
    <header class="topbar">
      <button class="logo-btn" @click="emit('navigate', '首页')">
        <img :src="bg('专利发文自动化.png')" alt="PatMail 专利发文自动化" />
      </button>
      <img class="slogan" :src="bg('让每一封专业邮件，都温柔且高效.png')" alt="让每一封专业邮件都温柔且高效" />
      <label class="search">
        <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M16 16l4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        <input :value="search" :placeholder="placeholder" @input="emit('update:search', $event.target.value)" />
      </label>
      <button class="bell" title="通知" @click="emit('settings', '通知')">
        <svg viewBox="0 0 24 24"><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2H4.5z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10 19a2 2 0 0 0 4 0" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>
        <i v-if="showDemo">3</i>
      </button>
      <button class="profile" @click="emit('settings', '个人资料')">
        <img v-if="avatarSrc" class="avatar-face" :src="avatarSrc" alt="" title="点击放大" @click.stop="emit('preview')" />
        <Avatar v-else />
        <span><b>{{ profileName }}</b><small>{{ profileDept }}</small></span>
        <svg viewBox="0 0 12 12"><path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
      </button>
      <img class="daily" :src="bg('今天也要高效发文.png')" alt="今天也要高效发文呀" />
    </header>
    <div class="frame">
      <aside class="sidebar">
        <nav>
          <button v-for="item in menu" :key="item.name" :class="{ active: page === item.name }" @click="emit('navigate', item.name)">
            <svg v-if="item.path === 'home'" viewBox="0 0 24 24"><path d="M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>
            <svg v-else-if="item.path === 'task'" viewBox="0 0 24 24"><rect x="5" y="4" width="14" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8 9h8M8 13h8M8 17h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
            <svg v-else-if="item.path === 'rule'" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
            <svg v-else-if="item.path === 'users'" viewBox="0 0 24 24"><circle cx="9" cy="9" r="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M4 19c.6-3 2.4-4.5 5-4.5S13.4 16 14 19" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="16.5" cy="9" r="2.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M16 14.6c2 .3 3.4 1.5 4 3.4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>
            <svg v-else-if="item.path === 'file'" viewBox="0 0 24 24"><path d="M4 7.5A1.5 1.5 0 0 1 5.5 6H10l2 2h6.5A1.5 1.5 0 0 1 20 9.5v8A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5z" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>
            <svg v-else-if="item.path === 'limit'" viewBox="0 0 24 24"><circle cx="12" cy="13" r="7" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 9.5V13l2.5 1.5M9 4h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
            <svg v-else-if="item.path === 'record'" viewBox="0 0 24 24"><rect x="6" y="3.5" width="12" height="17" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M9 8h6M9 12h6M9 16h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            <svg v-else-if="item.path === 'contact'" viewBox="0 0 24 24"><rect x="4" y="6" width="16" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="m5 8 7 5 7-5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
            <svg v-else viewBox="0 0 24 24"><path d="M5 19V10M10 19V5M15 19v-7M20 19V8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
            <span>{{ item.name }}</span>
          </button>
        </nav>
        <img class="mascot" :src="bg('专业细节，守护创新.png')" alt="专注细节 守护创新 让知识更有力量" />
        <button v-if="showSettings" class="settings" :class="{ active: page === '系统设置' }" @click="emit('settings', '系统设置')">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.5 1.5M16.5 16.5 18 18M18 6l-1.5 1.5M7.5 16.5 6 18" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          系统设置
        </button>
        <button v-if="showDemo" class="float-entry" @click="emit('navigate', '浮窗')">发文浮窗预览</button>
      </aside>
      <div class="workspace">
        <div class="workspace-body">
          <slot />
        </div>
        <footer class="site-foot">
          <span>© 2026 PatMail　专利发文自动化系统 v1.2.0　|　让知识产权服务更简单、更温暖、更高效 ♡</span>
          <span>Innovation for a Brighter Tomorrow. ♡</span>
        </footer>
      </div>
    </div>
  </div>
</template>
