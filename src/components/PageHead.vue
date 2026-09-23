<script setup>
import Bunny from './Bunny.vue'
defineProps({ title: String, desc: String, art: String })
</script>

<template>
  <header class="page-head">
    <Bunny />
    <div class="page-copy">
      <h1>{{ title }}</h1>
      <p>{{ desc }} <span>♥</span></p>
    </div>
    <img v-if="art" class="page-art" :src="art" alt="" />
  </header>
</template>
