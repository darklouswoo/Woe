import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, type Component } from 'vue'
import LoadingSpinner from '@/components/LoadingSpinner.vue'
import EmptyState from '@/components/EmptyState.vue'
import ApplicationIcon from '@/components/ApplicationIcon.vue'
import ConnectionStatus from '@/components/ConnectionStatus.vue'
import i18n from '@/locales'
import { useAlertProvider } from '@/composables/useAlert'
import { useConfirmDialogProvider } from '@/composables/useConfirmDialog'



const mountWithProviders = (component: Component, props: Record<string, unknown> = {}) => {
  const Provider = defineComponent({
    setup() {
      useConfirmDialogProvider()
      useAlertProvider()
      return () => h(component, props)
    }
  })
  return mount(Provider, {
    global: {
      plugins: [i18n]
    }
  })
}

describe('LoadingSpinner', () => {
  it('renders correctly with default props', () => {
    const wrapper = mount(LoadingSpinner)
    expect(wrapper.find('.loading-spinner').exists()).toBe(true)
    expect(wrapper.find('.spinner-circle').exists()).toBe(true)
  })

  it('renders with custom text', () => {
    const wrapper = mount(LoadingSpinner, {
      props: { text: 'Custom loading text' }
    })
    expect(wrapper.text()).toContain('Custom loading text')
  })

  it('renders different variants', () => {
    const wrapper = mount(LoadingSpinner, {
      props: { variant: 'dots' }
    })
    expect(wrapper.find('.spinner-dots').exists()).toBe(true)
    expect(wrapper.find('.spinner-circle').exists()).toBe(false)
  })
})

describe('EmptyState', () => {
  it('renders correctly with default props', () => {
    const wrapper = mount(EmptyState)
    expect(wrapper.find('.empty-state').exists()).toBe(true)

    expect(wrapper.find('.empty-state-title').exists()).toBe(true)
  })

  it('renders with custom title and description', () => {
    const wrapper = mount(EmptyState, {
      props: {
        title: 'Custom Title',
        description: 'Custom description'
      }
    })
    expect(wrapper.text()).toContain('Custom Title')
    expect(wrapper.text()).toContain('Custom description')
  })

  it('renders different types', () => {
    const wrapper = mount(EmptyState, {
      props: { type: 'messages' }
    })
    expect(wrapper.find('.empty-state').exists()).toBe(true)
  })
})

describe('ApplicationIcon', () => {
  it('renders placeholder when no image provided', () => {
    const wrapper = mountWithProviders(ApplicationIcon, {
      name: 'Test App'
    })
    expect(wrapper.find('.icon-placeholder').exists()).toBe(true)
    expect(wrapper.find('.icon-image').exists()).toBe(false)
  })

  it('renders image when provided', async () => {
    const wrapper = mountWithProviders(ApplicationIcon, {
      name: 'Test App',
      image: 'test-image.jpg'
    })
    expect(wrapper.find('.icon-image').exists()).toBe(true)

    await wrapper.find('.icon-image').trigger('load')
    expect(wrapper.find('.icon-placeholder').exists()).toBe(false)
  })

  it('shows upload overlay when enabled', () => {
    const wrapper = mountWithProviders(ApplicationIcon, {
      name: 'Test App',
      showUploadOverlay: true
    })
    expect(wrapper.find('.upload-overlay').exists()).toBe(true)
  })
})

describe('ConnectionStatus', () => {
  it('renders nothing when connected (connected state is not noise)', () => {
    const wrapper = mountWithProviders(ConnectionStatus, {
      connected: true
    })
    expect(wrapper.find('.connection-status').exists()).toBe(false)
  })

  it('renders disconnected state with a real reconnect button', () => {
    const wrapper = mountWithProviders(ConnectionStatus, {
      connected: false
    })
    expect(wrapper.find('.connection-status').exists()).toBe(true)
    expect(wrapper.find('.status-disconnected').exists()).toBe(true)
    expect(wrapper.text()).toContain('Disconnected')
    expect(wrapper.find('.reconnect-btn').exists()).toBe(true)
  })

  it('emits reconnect when the button is clicked', async () => {
    const wrapper = mountWithProviders(ConnectionStatus, {
      connected: false
    })
    const comp = wrapper.findComponent(ConnectionStatus)
    await comp.find('.reconnect-btn').trigger('click')
    expect(comp.emitted('reconnect')).toHaveLength(1)
  })

  it('renders connecting state without a reconnect button', () => {
    const wrapper = mountWithProviders(ConnectionStatus, {
      connected: false,
      connecting: true
    })
    expect(wrapper.find('.status-connecting').exists()).toBe(true)
    expect(wrapper.text()).toContain('Connecting')
    expect(wrapper.find('.reconnect-btn').exists()).toBe(false)
  })
})