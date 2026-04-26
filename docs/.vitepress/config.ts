import { defineConfig } from 'vitepress'
import fs from 'fs'
import path from 'path'

const docsDir = path.resolve(__dirname, '..')

type SeriesMode = 'directories' | 'files'

type SeriesConfig = {
  dir: string
  label: string
  mode: SeriesMode
  listText: string
  navText: (name: string) => string
}

type DocMeta = {
  title: string
  date?: string
  summary?: string
}

type TimelineItem = {
  title: string
  date: string
  summary: string
  type: string
  link: string
}

// 系列配置：添加新系列只需在此数组中追加一行
const SERIES_CONFIG = [
  {
    dir: 'courses',
    label: '研习',
    mode: 'directories',
    listText: '内容列表',
    navText: (name: string) => name.replace(/-课程$/, '')
  },
  {
    dir: 'dives',
    label: '拆解',
    mode: 'files',
    listText: '文章列表',
    navText: (name: string) => name
  },
  {
    dir: 'notes',
    label: '礼记',
    mode: 'files',
    listText: '日期列表',
    navText: (name: string) => name
  }
] satisfies SeriesConfig[]

function parseFrontmatter(filePath: string): Record<string, string> {
  const content = fs.readFileSync(filePath, 'utf-8')
  const match = content.match(/^---\n([\s\S]*?)\n---\n/)
  if (!match) return {}

  const result: Record<string, string> = {}

  for (const line of match[1].split('\n')) {
    const separatorIndex = line.indexOf(':')
    if (separatorIndex === -1) continue

    const key = line.slice(0, separatorIndex).trim()
    const value = line.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '')

    if (key) result[key] = value
  }

  return result
}

function getDocMeta(filePath: string): DocMeta {
  const content = fs.readFileSync(filePath, 'utf-8')
  const frontmatter = parseFrontmatter(filePath)
  const match = content.match(/^#\s+(.+)$/m)

  return {
    title: frontmatter.title || (match ? match[1] : path.basename(filePath, '.md')),
    date: frontmatter.date,
    summary: frontmatter.summary
  }
}

// 从 .md 文件提取展示标题
function extractTitle(filePath: string): string {
  return getDocMeta(filePath).title
}

// 自定义排序：index → 课程大纲 → 第N章（按数字） → 数字前缀 → 其他 → 结业总结
function sortFiles(a: string, b: string): number {
  const order = (name: string): number => {
    if (name === 'index.md') return -2
    if (name === '00-课程大纲.md') return -1
    const chapterMatch = name.match(/^第(\d+)章/)
    if (chapterMatch) return parseInt(chapterMatch[1])
    const numPrefixMatch = name.match(/^(\d+)-/)
    if (numPrefixMatch) return parseInt(numPrefixMatch[1])
    if (name === '结业总结.md') return 999
    return 500
  }
  return order(a) - order(b)
}

function getSeriesDirectories(seriesDir: string): string[] {
  if (!fs.existsSync(seriesDir)) return []
  return fs.readdirSync(seriesDir).filter(f =>
    fs.statSync(path.join(seriesDir, f)).isDirectory()
  )
}

function getSeriesMarkdownFiles(seriesDir: string): string[] {
  if (!fs.existsSync(seriesDir)) return []
  return fs.readdirSync(seriesDir)
    .filter(f => f.endsWith('.md') && f !== 'index.md')
    .sort(sortFiles)
}

function toDocLink(...segments: string[]): string {
  const fullPath = segments.join('/')
  return `/${fullPath.replace(/\.md$/, '')}`
}

function generateTimeline(): TimelineItem[] {
  const items: TimelineItem[] = []

  for (const series of SERIES_CONFIG) {
    const seriesDir = path.join(docsDir, series.dir)

    if (series.mode === 'directories') {
      for (const item of getSeriesDirectories(seriesDir)) {
        const filePath = path.join(seriesDir, item, 'index.md')
        if (!fs.existsSync(filePath)) continue

        const meta = getDocMeta(filePath)
        if (!meta.date || !meta.summary) continue

        items.push({
          title: meta.title,
          date: meta.date,
          summary: meta.summary,
          type: series.label,
          link: `/${series.dir}/${item}/`
        })
      }
    }

    if (series.mode === 'files') {
      for (const file of getSeriesMarkdownFiles(seriesDir)) {
        const filePath = path.join(seriesDir, file)
        const meta = getDocMeta(filePath)
        if (!meta.date || !meta.summary) continue

        items.push({
          title: meta.title,
          date: meta.date,
          summary: meta.summary,
          type: series.label,
          link: toDocLink(series.dir, file)
        })
      }
    }
  }

  return items.sort((a, b) => b.date.localeCompare(a.date))
}

// 自动生成侧边栏（遍历所有系列）
function generateSidebar() {
  const sidebar: Record<string, any[]> = {}

  for (const series of SERIES_CONFIG) {
    const seriesDir = path.join(docsDir, series.dir)

    if (series.mode === 'directories') {
      const items = getSeriesDirectories(seriesDir)

      if (fs.existsSync(path.join(seriesDir, 'index.md'))) {
        sidebar[`/${series.dir}/`] = items.map(item => ({
          text: extractTitle(path.join(seriesDir, item, 'index.md')),
          link: `/${series.dir}/${item}/`
        }))
      }

      for (const item of items) {
        const itemPath = path.join(seriesDir, item)
        const files = fs.readdirSync(itemPath)
          .filter(f => f.endsWith('.md') && f !== 'index.md')
          .sort(sortFiles)

        sidebar[`/${series.dir}/${item}/`] = files.map(file => ({
          text: extractTitle(path.join(itemPath, file)),
          link: toDocLink(series.dir, item, file)
        }))
      }
    }

    if (series.mode === 'files') {
      const files = getSeriesMarkdownFiles(seriesDir)

      sidebar[`/${series.dir}/`] = [
        {
          text: '系列总览',
          link: `/${series.dir}/`
        },
        {
          text: series.listText,
          items: files.map(file => ({
            text: extractTitle(path.join(seriesDir, file)),
            link: toDocLink(series.dir, file)
          }))
        }
      ]
    }
  }

  return sidebar
}

// 自动生成导航栏（按系列分组为 dropdown）
function generateNav() {
  const nav: any[] = []

  for (const series of SERIES_CONFIG) {
    const seriesDir = path.join(docsDir, series.dir)
    const items = series.mode === 'directories'
      ? getSeriesDirectories(seriesDir).map(item => ({
        text: series.navText(item),
        link: `/${series.dir}/${item}/`
      }))
      : getSeriesMarkdownFiles(seriesDir).map(file => ({
        text: extractTitle(path.join(seriesDir, file)),
        link: toDocLink(series.dir, file)
      }))

    if (fs.existsSync(path.join(seriesDir, 'index.md'))) {
      items.unshift({
        text: '系列总览',
        link: `/${series.dir}/`
      })
    }

    if (items.length > 0) {
      nav.push({
        text: series.label,
        items
      })
    }
  }

  return nav
}

export default defineConfig({
  title: '新知',
  description: '一个持续生长的个人知识系统，收录研习、拆解与礼记。',

  cleanUrls: true,
  lastUpdated: true,

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    ['meta', { property: 'og:title', content: '新知' }],
    ['meta', { property: 'og:description', content: '一个持续生长的个人知识系统，收录研习、拆解与礼记。' }],
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
      label: '目录'
    },

    search: {
      provider: 'local'
    },

    timeline: generateTimeline(),

    docFooter: {
      prev: '上一篇',
      next: '下一篇'
    },

  }
})
