import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import MessageContent from '@/components/MessageContent.vue'
import { usePreferencesStore } from '@/stores/preferences'
import i18n from '@/locales'

const mountIt = (props: Record<string, unknown>) =>
  mount(MessageContent, {
    props,
    global: { plugins: [createPinia(), i18n] }
  })

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.removeItem('render_markdown')
})

describe('MessageContent', () => {
  it('默认渲染 Markdown 富文本', () => {
    const w = mountIt({ content: '**重点** 内容' })
    expect(w.find('.markdown-body').exists()).toBe(true)
    expect(w.html()).toContain('<strong>重点</strong>')
  })

  it('未命中模式保持纯文本并保留换行', () => {
    const w = mountIt({ content: '第一行\n第二行' })
    expect(w.find('.markdown-body').exists()).toBe(false)
    expect(w.find('.message-content-plain').exists()).toBe(true)
  })

  it('开关关闭后全部回退纯文本', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const prefs = usePreferencesStore(pinia)
    prefs.setRenderMarkdown(false)
    const w = mount(MessageContent, {
      props: { content: '**重点**' },
      global: { plugins: [pinia, i18n] }
    })
    await flushPromises()
    expect(w.find('.markdown-body').exists()).toBe(false)
    expect(w.text()).toContain('**重点**')
  })

  it('复制按钮经事件委托取 code 文本写入剪贴板', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    const w = mountIt({ content: '```json\n{"a":1}\n```' })
    await flushPromises()
    await vi.dynamicImportSettled()
    await flushPromises()
    const btn = w.find('button.code-copy')
    expect(btn.exists()).toBe(true)
    await btn.trigger('click')
    expect(writeText).toHaveBeenCalledWith('{"a":1}')
  })

  it('公式内容先显示原始 TeX，模块加载后升级为 KaTeX', async () => {
    const w = mountIt({ content: '质量 $$E=mc^2$$ 单位' })
    expect(w.html()).not.toContain('katex')
    await flushPromises()
    await vi.dynamicImportSettled()
    await flushPromises()
    expect(w.html()).toContain('katex')
  })
})
