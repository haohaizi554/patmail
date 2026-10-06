<script setup>
defineProps({ brand: { type: String, default: 'huawei' } })
</script>

<template>
  <span class="brand" :class="brand" aria-hidden="true">
    <svg v-if="brand === 'huawei'" viewBox="0 0 32 32">
      <g fill="#e4232b">
        <path d="M16 2c1.2 2.4 1.2 4.2 0 6.2-1.2-2-1.2-3.8 0-6.2zM16 30c-1.2-2.4-1.2-4.2 0-6.2 1.2 2 1.2 3.8 0 6.2zM2 16c2.4-1.2 4.2-1.2 6.2 0-2 1.2-3.8 1.2-6.2 0zM30 16c-2.4 1.2-4.2 1.2-6.2 0 2-1.2 3.8-1.2 6.2 0z"/>
        <path d="M6.2 6.2c2.2 1.4 3.6 2.6 4.4 4.4-1.8-.8-3-2.2-4.4-4.4zM25.8 25.8c-2.2-1.4-3.6-2.6-4.4-4.4 1.8.8 3 2.2 4.4 4.4zM25.8 6.2c-1.4 2.2-2.6 3.6-4.4 4.4.8-1.8 2.2-3 4.4-4.4zM6.2 25.8c1.4-2.2 2.6-3.6 4.4-4.4-.8 1.8-2.2 3-4.4 4.4z"/>
        <circle cx="16" cy="16" r="2.2"/>
      </g>
    </svg>
    <svg v-else-if="brand === 'tencent'" viewBox="0 0 64 24">
      <text x="0" y="18" font-size="15" font-weight="800" font-style="italic" fill="#1a73e8" font-family="Arial">Tencent</text>
    </svg>
    <svg v-else-if="brand === 'alibaba'" viewBox="0 0 32 32">
      <text x="4" y="25" font-size="26" font-weight="800" font-style="italic" fill="#ff6a00" font-family="Georgia">a</text>
    </svg>
    <svg v-else-if="brand === 'bytedance'" viewBox="0 0 32 32">
      <rect x="4" y="8" width="3.2" height="16" rx="1" fill="#111"/>
      <rect x="10" y="4" width="3.2" height="20" rx="1" fill="#2f6bff"/>
      <rect x="16" y="10" width="3.2" height="14" rx="1" fill="#111"/>
      <rect x="22" y="6" width="3.2" height="18" rx="1" fill="#2f6bff"/>
    </svg>
    <svg v-else-if="brand === 'catl'" viewBox="0 0 48 24">
      <text x="0" y="17" font-size="13" font-weight="800" fill="#123a8f" font-family="Arial">CATL</text>
    </svg>
    <svg v-else-if="brand === 'netease'" viewBox="0 0 40 24">
      <text x="0" y="18" font-size="15" font-weight="800" fill="#d0021b" font-family="Microsoft YaHei">网易</text>
    </svg>
    <svg v-else-if="brand === 'xiaomi'" viewBox="0 0 32 32">
      <rect width="32" height="32" rx="6" fill="#ff6900"/>
      <text x="5" y="22" font-size="14" font-weight="800" fill="#fff" font-family="Arial">mi</text>
    </svg>
    <svg v-else-if="brand === 'baidu'" viewBox="0 0 32 32">
      <circle cx="16" cy="16" r="12" fill="#2932e1"/>
      <path d="M11 18c1 3 9 3 10 0" stroke="#fff" stroke-width="1.6" fill="none"/>
      <circle cx="12" cy="14" r="1.3" fill="#fff"/>
      <circle cx="20" cy="14" r="1.3" fill="#fff"/>
    </svg>
    <svg v-else-if="brand === 'jd'" viewBox="0 0 36 24">
      <text x="0" y="18" font-size="16" font-weight="900" fill="#e1251b" font-family="Arial">JD</text>
    </svg>
    <svg v-else-if="brand === 'midea'" viewBox="0 0 36 24">
      <text x="0" y="17" font-size="12" font-weight="800" fill="#0092d0" font-family="Arial">Midea</text>
    </svg>
    <svg v-else-if="brand === 'bili'" viewBox="0 0 32 32">
      <rect x="3" y="8" width="26" height="16" rx="4" fill="#fb7299"/>
      <circle cx="12" cy="16" r="2" fill="#fff"/>
      <circle cx="20" cy="16" r="2" fill="#fff"/>
    </svg>
    <svg v-else-if="brand === 'pingan'" viewBox="0 0 32 32">
      <circle cx="16" cy="16" r="12" fill="#ff6a00"/>
      <path d="M16 8l6 4v6c0 4-3 6-6 7-3-1-6-3-6-7v-6z" fill="#fff"/>
    </svg>
    <svg v-else-if="brand === 'zte'" viewBox="0 0 40 24">
      <text x="0" y="18" font-size="16" font-weight="900" fill="#0b63ce" font-family="Arial">ZTE</text>
    </svg>
    <svg v-else viewBox="0 0 40 24">
      <text x="0" y="17" font-size="13" font-weight="800" fill="#ffc300" font-family="Microsoft YaHei">美团</text>
    </svg>
  </span>
</template>
