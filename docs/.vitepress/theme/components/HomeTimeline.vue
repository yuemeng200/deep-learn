<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useData } from 'vitepress'

type TimelineItem = {
  title: string
  date: string
  summary: string
  type: string
  link: string
}

const PAGE_SIZE = 10

const { theme } = useData()

const items = computed(() => (theme.value.timeline || []) as TimelineItem[])

const isMounted = ref(false)
const visibleCount = ref(PAGE_SIZE)

onMounted(() => {
  isMounted.value = true
})

const visibleItems = computed(() => {
  if (!isMounted.value) return items.value
  return items.value.slice(0, visibleCount.value)
})

const hasMore = computed(() => isMounted.value && visibleCount.value < items.value.length)

function loadMore() {
  visibleCount.value += PAGE_SIZE
}

function formatDate(date: string): string {
  return date.replace(/-/g, '.')
}

function seriesClass(type: string): string {
  if (type === '研习') return 'home-timeline__item--study'
  if (type === '拆解') return 'home-timeline__item--dive'
  if (type === '礼记') return 'home-timeline__item--notes'
  return ''
}
</script>

<template>
  <section class="home-timeline" v-if="items.length > 0">
    <div class="home-timeline__header">
      <span>时间线</span>
    </div>
    <div
      v-for="item in visibleItems"
      :key="item.link"
      :class="['home-timeline__item', seriesClass(item.type)]"
    >
      <div class="home-timeline__date">
        <span class="home-timeline__dot"></span>
        <time :datetime="item.date">{{ formatDate(item.date) }}</time>
      </div>
      <a class="home-timeline__content" :href="item.link">
        <div class="home-timeline__meta">
          <h2>{{ item.title }}</h2>
          <span class="home-timeline__type">{{ item.type }}</span>
        </div>
        <p>{{ item.summary }}</p>
      </a>
    </div>
    <div class="home-timeline__more" v-if="hasMore">
      <button @click="loadMore">加载更多</button>
    </div>
  </section>
</template>
