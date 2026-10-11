import { defineStore } from 'pinia'
import { ref } from 'vue'


export const usePreferencesStore = defineStore('preferences', () => {

  const renderMarkdown = ref(localStorage.getItem('render_markdown') !== 'false')

  const setRenderMarkdown = (value: boolean) => {
    renderMarkdown.value = value
    localStorage.setItem('render_markdown', String(value))
  }

  return { renderMarkdown, setRenderMarkdown }
})
