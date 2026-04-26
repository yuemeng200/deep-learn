<script setup lang="ts">
import DefaultTheme from 'vitepress/theme'
import HomeSeriesNav from './components/HomeSeriesNav.vue'
</script>

<template>
  <DefaultTheme.Layout>
    <template #home-hero-actions-after>
      <HomeSeriesNav />
    </template>
  </DefaultTheme.Layout>
</template>
