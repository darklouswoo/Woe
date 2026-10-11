import { defineStore } from 'pinia'
import { ref } from 'vue'

export type ThemeMode = 'light' | 'dark' | 'auto'

export const useThemeStore = defineStore('theme', () => {

  const mode = ref<ThemeMode>('auto')

  const isDark = ref(false)





  const initTheme = () => {
    const savedMode = localStorage.getItem('theme') as ThemeMode | null
    if (savedMode && ['light', 'dark', 'auto'].includes(savedMode)) {
      mode.value = savedMode
    }
    updateTheme()
  }





  const updateTheme = () => {
    if (mode.value === 'auto') {

      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      isDark.value = prefersDark
    } else {
      isDark.value = mode.value === 'dark'
    }
    applyTheme()
  }





  const applyTheme = () => {
    const root = document.documentElement
    root.setAttribute('data-theme', isDark.value ? 'dark' : 'light')
  }





  const setTheme = (newMode: ThemeMode) => {
    mode.value = newMode
    localStorage.setItem('theme', newMode)
    updateTheme()
  }





  const toggleTheme = () => {
    const next: ThemeMode = mode.value === 'light' ? 'dark' : mode.value === 'dark' ? 'auto' : 'light'
    setTheme(next)
  }


  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  const handleSystemThemeChange = () => {
    if (mode.value === 'auto') {
      updateTheme()
    }
  }
  mediaQuery.addEventListener('change', handleSystemThemeChange)

  return {
    mode,
    isDark,
    initTheme,
    setTheme,
    toggleTheme
  }
})
