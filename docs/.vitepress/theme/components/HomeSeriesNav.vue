<script setup lang="ts">
import { computed } from 'vue'
import { useData, withBase } from 'vitepress'

type TimelineItem = {
  title: string
  date: string
  summary: string
  type: string
  link: string
}

const SERIES = [
  { key: 'study', label: '研习', link: '/courses/', type: '研习' },
  { key: 'dive', label: '拆解', link: '/dives/', type: '拆解' },
  { key: 'question', label: '追问', link: '/questions/', type: '追问' },
  { key: 'notes', label: '礼记', link: '/notes/', type: '礼记' },
] as const

const { theme } = useData()
const items = computed(() => (theme.value.timeline || []) as TimelineItem[])

const counts = computed(() => {
  const map: Record<string, number> = {}
  for (const s of SERIES) {
    map[s.key] = items.value.filter(i => i.type === s.type).length
  }
  return map
})
</script>

<template>
  <div class="home-series-nav">
    <a
      v-for="s in SERIES"
      :key="s.key"
      :href="withBase(s.link)"
      :class="['home-series-nav__btn', `home-series-nav__btn--${s.key}`]"
    >
      <span class="home-series-nav__label">{{ s.label }}</span>
      <span class="home-series-nav__badge">{{ counts[s.key] }}</span>
    </a>
  </div>
</template>
