<template>
  <div
    v-if="isRich"
    class="message-content markdown-body"
    v-html="html"
    @click="onContentClick"
  ></div>
  <div v-else class="message-content message-content-plain">{{ content }}</div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  renderMessage,
  neededModules,
  ensureModules,
  setToolbarLabels,
  highlightJsonHtml
} from '@/utils/markdown'
import { usePreferencesStore } from '@/stores/preferences'

const props = defineProps<{
  content: string
}>()

const { t, locale } = useI18n()
const prefs = usePreferencesStore()

const isRich = ref(false)
const html = ref('')
const copyLabels = ref({ copy: '', copied: '' })

const render = () => {
  copyLabels.value = { copy: t('messages.codeCopy'), copied: t('messages.copied') }
  setToolbarLabels({ copy: t('messages.codeCopy'), format: t('messages.codeFormat') })
  if (!prefs.renderMarkdown) {
    isRich.value = false
    html.value = ''
    return
  }
  const result = renderMessage(props.content)
  isRich.value = result.mode === 'rich'
  html.value = result.mode === 'rich' ? result.html : ''
  const needed = neededModules(props.content)
  if (result.mode === 'rich' && needed.length > 0) {

    void ensureModules(needed)
      .then((fresh) => {
        if (fresh) render()
      })
      .catch(() => {})
  }
}

watch(
  [() => props.content, () => prefs.renderMarkdown, locale],
  render,
  { immediate: true }
)


const onContentClick = (e: MouseEvent) => {
  const target = e.target as HTMLElement

  if ((e.target as HTMLElement).closest('a')) e.stopPropagation()
  const btn = target.closest('button')
  if (!btn) return
  const block = btn.closest('.code-block') as HTMLElement | null
  if (!block) return
  const codeEl = block.querySelector('code')
  if (!codeEl) return
  if (btn.classList.contains('code-copy')) {

    const text = (codeEl.textContent ?? '').replace(/\n$/, '')
    navigator.clipboard?.writeText(text).catch(() => {})
    const original = btn.textContent
    btn.textContent = copyLabels.value.copied || 'Copied'
    setTimeout(() => {
      btn.textContent = original
    }, 1500)
  } else if (btn.classList.contains('code-format')) {
    try {
      const pretty = JSON.stringify(JSON.parse(codeEl.textContent ?? ''), null, 2)
      codeEl.innerHTML = highlightJsonHtml(pretty)
      btn.remove()
    } catch {

    }
  }
}
</script>

<style scoped>
.message-content-plain {
  white-space: pre-wrap;
  word-break: break-word;
}



.markdown-body.markdown-body {
  white-space: normal;
}


.message-content-display.markdown-body.markdown-body {
  background: transparent;
  padding: 0;
  max-height: none;
}
</style>
