import { createI18n } from 'vue-i18n'
import zhCN from './zh-CN'
import enUS from './en-US'


const savedLocale = localStorage.getItem('locale')
const browserLocale = navigator.language.toLowerCase()
const defaultLocale = savedLocale || (browserLocale.startsWith('zh') ? 'zh-CN' : 'en-US')

const i18n = createI18n({
  legacy: false,
  locale: defaultLocale,
  fallbackLocale: 'en-US',
  messages: {
    'zh-CN': zhCN,
    'en-US': enUS
  }
})

export default i18n
