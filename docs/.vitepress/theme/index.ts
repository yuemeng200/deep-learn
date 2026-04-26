import DefaultTheme from 'vitepress/theme'
import HomeTimeline from './components/HomeTimeline.vue'
import CustomLayout from './Layout.vue'
import './style.css'

export default {
  extends: DefaultTheme,
  Layout: CustomLayout,
  enhanceApp({ app }) {
    app.component('HomeTimeline', HomeTimeline)
  }
}
