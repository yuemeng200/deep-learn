import { defineConfig } from 'vitepress'
import fs from 'fs'
import path from 'path'

const coursesDir = path.resolve(__dirname, '../courses')

// 从 .md 文件第一行提取 H1 标题
function extractTitle(filePath: string): string {
  const content = fs.readFileSync(filePath, 'utf-8')
  const match = content.match(/^#\s+(.+)$/m)
  return match ? match[1] : path.basename(filePath, '.md')
}

// 自定义排序：课程大纲 → 第N章（按数字） → 结业总结
function sortFiles(a: string, b: string): number {
  const order = (name: string): number => {
    if (name === 'index.md') return -2
    if (name.startsWith('00-')) return -1
    const m = name.match(/^第(\d+)章/)
    if (m) return parseInt(m[1])
    if (name === '结业总结.md') return 999
    return 500
  }
  return order(a) - order(b)
}

// 自动生成侧边栏
function generateSidebar() {
  if (!fs.existsSync(coursesDir)) return {}

  const sidebar: Record<string, any[]> = {}
  const courses = fs.readdirSync(coursesDir).filter(f =>
    fs.statSync(path.join(coursesDir, f)).isDirectory()
  )

  for (const course of courses) {
    const coursePath = path.join(coursesDir, course)
    const files = fs.readdirSync(coursePath)
      .filter(f => f.endsWith('.md') && f !== 'index.md')
      .sort(sortFiles)

    const items = files.map(file => ({
      text: extractTitle(path.join(coursePath, file)),
      link: `/courses/${course}/${file}`
    }))

    sidebar[`/courses/${course}/`] = items
  }

  return sidebar
}

// 自动生成导航栏
function generateNav() {
  if (!fs.existsSync(coursesDir)) return []

  return fs.readdirSync(coursesDir)
    .filter(f => fs.statSync(path.join(coursesDir, f)).isDirectory())
    .map(course => ({
      text: course.replace(/-课程$/, ''),
      link: `/courses/${course}/`
    }))
}

export default defineConfig({
  title: 'Deep Learn',
  description: 'Progressive Technical Courses',

  base: '/deep-learn/',
  cleanUrls: true,
  lastUpdated: true,

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    ['meta', { property: 'og:title', content: 'Deep Learn' }],
    ['meta', { property: 'og:description', content: 'Progressive Technical Courses' }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }]
  ],

  sitemap: {
    hostname: 'https://shichangzhen.github.io/deep-learn/'
  },

  markdown: {
    theme: {
      light: 'github-light',
      dark: 'github-dark'
    }
  },

  themeConfig: {
    nav: generateNav(),

    sidebar: generateSidebar(),

    outline: {
      level: [2, 3],
      label: '本节目录'
    },

    search: {
      provider: 'local'
    },

    docFooter: {
      prev: '上一章',
      next: '下一章'
    },

  }
})
