<script setup>
import Bunny from './Bunny.vue'
defineProps({ title: String, desc: String, art: String, artLarge: Boolean })
</script>

<template>
  <header class="page-head">
    <Bunny />
    <div class="page-copy">
      <h1>{{ title }}</h1>
      <p>{{ desc }} <span>♥</span></p>
    </div>
    <slot />
    <img v-if="art" class="page-art" :class="{ 'page-art-lg': artLarge }" :src="art" alt="" />
  </header>
</template>
