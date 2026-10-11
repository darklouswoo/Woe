import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, reactive, ref, type Component } from 'vue'
import ApplicationIcon from '@/components/ApplicationIcon.vue'
import PluginIcon from '@/components/PluginIcon.vue'
import UserAvatar from '@/components/UserAvatar.vue'
import EditableAvatar from '@/components/EditableAvatar.vue'
import i18n from '@/locales'
import { useAlertProvider } from '@/composables/useAlert'
import { useConfirmDialogProvider } from '@/composables/useConfirmDialog'




const CONFIGURED_BASE = 'https://media.example.test/api/v1'



const mountWithProviders = (component: Component, initialProps: Record<string, unknown>) => {
  const propsRef = ref({ ...initialProps })

  let dialogControls: ReturnType<typeof useConfirmDialogProvider> | null = null
  const Provider = defineComponent({
    setup() {
      dialogControls = useConfirmDialogProvider()
      useAlertProvider()
      return () => h(component, propsRef.value)
    }
  })
  const wrapper = mount(Provider, {
    global: {
      plugins: [i18n]
    }
  })
  return {
    wrapper,
    setProps: async (patch: Record<string, unknown>) => {
      propsRef.value = { ...propsRef.value, ...patch }
      await nextTick()
    },
    resolveConfirm: () => dialogControls?.handleConfirm(),
    resolveCancel: () => dialogControls?.handleCancel(),
    confirmMessage: () => dialogControls?.state.value.options.message
  }
}

const makeUser = (avatar?: string) =>
  reactive({
    id: 1,
    name: 'tester',
    nickname: 'Tester',
    email: 'tester@example.test',
    avatar,
    admin: false,
    disabled: false
  })

beforeEach(() => {

  window.history.pushState({}, '', '/application/7')
  vi.stubEnv('VITE_API_BASE_URL', CONFIGURED_BASE)

  i18n.global.locale.value = 'en-US'
})

afterEach(() => {
  vi.unstubAllEnvs()
  window.history.pushState({}, '', '/')
})

describe('ApplicationIcon 媒体解析', () => {
  it('旧 /api/v1/image/... 值按配置基址消重解析', () => {
    const { wrapper } = mountWithProviders(ApplicationIcon, {
      name: 'App',
      image: '/api/v1/image/app-images/a.png'
    })
    expect(wrapper.find('.icon-image').attributes('src')).toBe(
      `${CONFIGURED_BASE}/image/app-images/a.png`
    )
  })

  it('新契约 image/... 值按配置基址解析', () => {
    const { wrapper } = mountWithProviders(ApplicationIcon, {
      name: 'App',
      image: 'image/app-images/b.png'
    })
    expect(wrapper.find('.icon-image').attributes('src')).toBe(
      `${CONFIGURED_BASE}/image/app-images/b.png`
    )
  })

  it('图片字段更新后 img.src 跟随更新', async () => {
    const { wrapper, setProps } = mountWithProviders(ApplicationIcon, {
      name: 'App',
      image: '/api/v1/image/app-images/a.png'
    })
    await setProps({ image: 'image/app-images/c.png' })
    expect(wrapper.find('.icon-image').attributes('src')).toBe(
      `${CONFIGURED_BASE}/image/app-images/c.png`
    )
  })

  it('data URL 头像预览原样通过', () => {
    const { wrapper } = mountWithProviders(ApplicationIcon, {
      name: 'App',
      image: 'data:image/png;base64,AAAA'
    })
    expect(wrapper.find('.icon-image').attributes('src')).toBe('data:image/png;base64,AAAA')
  })
})

describe('ApplicationIcon 默认图删除判断(hasCustomApplicationImage)', () => {
  it('默认图 static/defaultapp.png 正常显示且可替换,但无删除按钮/事件', async () => {
    const { wrapper } = mountWithProviders(ApplicationIcon, {
      name: 'App',
      image: 'static/defaultapp.png',
      showUploadOverlay: true,
      showDeleteButton: true
    })


    expect(wrapper.find('.icon-image').attributes('src')).toBe(
      `${CONFIGURED_BASE}/static/defaultapp.png`
    )


    await wrapper.find('.icon-image').trigger('load')


    expect(wrapper.find('.delete-button').exists()).toBe(false)
    expect(wrapper.findComponent(ApplicationIcon).emitted('delete')).toBeUndefined()


    expect(wrapper.find('.upload-overlay').exists()).toBe(true)
  })

  it('真实上传图(新契约 image/...)加载后仍可删除:确认后恰一次 emit delete,弹窗用应用文案', async () => {
    const { wrapper, resolveConfirm, confirmMessage } = mountWithProviders(ApplicationIcon, {
      name: 'App',
      image: 'image/app-images/real.png',
      showDeleteButton: true
    })

    await wrapper.find('.icon-image').trigger('load')
    const button = wrapper.find('.delete-button')
    expect(button.exists()).toBe(true)

    await button.trigger('click')

    expect(confirmMessage()).toBe(i18n.global.t('applications.deleteIconConfirm'))
    expect(confirmMessage()).not.toBe(i18n.global.t('plugins.deleteIconConfirm'))

    resolveConfirm()
    await nextTick()
    await nextTick()
    expect(wrapper.findComponent(ApplicationIcon).emitted('delete')).toHaveLength(1)
  })

  it('取消删除确认时不 emit delete', async () => {
    const { wrapper, resolveCancel } = mountWithProviders(ApplicationIcon, {
      name: 'App',
      image: 'image/app-images/real.png',
      showDeleteButton: true
    })

    await wrapper.find('.icon-image').trigger('load')
    await wrapper.find('.delete-button').trigger('click')
    resolveCancel()
    await nextTick()
    await nextTick()
    expect(wrapper.findComponent(ApplicationIcon).emitted('delete')).toBeUndefined()
  })

  it('真实上传图(旧契约 /api/v1/image/...)加载后仍可删除', async () => {
    const { wrapper, resolveConfirm } = mountWithProviders(ApplicationIcon, {
      name: 'App',
      image: '/api/v1/image/app-images/legacy.png',
      showDeleteButton: true
    })

    await wrapper.find('.icon-image').trigger('load')
    expect(wrapper.find('.delete-button').exists()).toBe(true)

    await wrapper.find('.delete-button').trigger('click')
    resolveConfirm()
    await nextTick()
    await nextTick()
    expect(wrapper.findComponent(ApplicationIcon).emitted('delete')).toBeTruthy()
  })
})

describe('PluginIcon 媒体解析', () => {
  it('icon 字段按配置基址解析(旧值消重)', () => {
    const { wrapper } = mountWithProviders(PluginIcon, {
      name: 'Plugin',
      icon: '/api/v1/image/plugin-icons/p.png'
    })
    expect(wrapper.find('.icon-image').attributes('src')).toBe(
      `${CONFIGURED_BASE}/image/plugin-icons/p.png`
    )
  })

  it('icon 字段更新后 img.src 跟随更新', async () => {
    const { wrapper, setProps } = mountWithProviders(PluginIcon, {
      name: 'Plugin',
      icon: '/api/v1/image/plugin-icons/p.png'
    })
    await setProps({ icon: 'image/plugin-icons/q.png' })
    expect(wrapper.find('.icon-image').attributes('src')).toBe(
      `${CONFIGURED_BASE}/image/plugin-icons/q.png`
    )
  })

  it('删除确认弹窗保留 plugins 文案:确认后恰一次 emit delete,取消不 emit', async () => {
    const { wrapper, resolveConfirm, resolveCancel, confirmMessage } = mountWithProviders(PluginIcon, {
      name: 'Plugin',
      icon: 'image/plugin-icons/p.png',
      showDeleteButton: true
    })

    await wrapper.find('.icon-image').trigger('load')
    const button = wrapper.find('.delete-button')
    expect(button.exists()).toBe(true)

    await button.trigger('click')
    expect(confirmMessage()).toBe(i18n.global.t('plugins.deleteIconConfirm'))
    resolveCancel()
    await nextTick()
    await nextTick()
    expect(wrapper.findComponent(PluginIcon).emitted('delete')).toBeUndefined()

    await button.trigger('click')
    resolveConfirm()
    await nextTick()
    await nextTick()
    expect(wrapper.findComponent(PluginIcon).emitted('delete')).toHaveLength(1)
  })
})

describe('UserAvatar 媒体解析', () => {
  it('avatar 字段按配置基址解析(旧值消重)', () => {
    const user = makeUser('/api/v1/image/avatars/u1.png')
    const wrapper = mount(UserAvatar, { props: { user } })
    expect(wrapper.find('.avatar-image').attributes('src')).toBe(
      `${CONFIGURED_BASE}/image/avatars/u1.png`
    )
  })

  it('avatar 字段更新后 img.src 跟随更新', async () => {
    const user = makeUser('/api/v1/image/avatars/u1.png')
    const wrapper = mount(UserAvatar, { props: { user } })
    user.avatar = 'image/avatars/u2.png'
    await nextTick()
    expect(wrapper.find('.avatar-image').attributes('src')).toBe(
      `${CONFIGURED_BASE}/image/avatars/u2.png`
    )
  })
})

describe('EditableAvatar 媒体解析', () => {
  it('avatar 字段按配置基址解析(旧值消重)', () => {
    const user = makeUser('/api/v1/image/avatars/e1.png')
    const { wrapper } = mountWithProviders(EditableAvatar, { user })
    expect(wrapper.find('.avatar-image').attributes('src')).toBe(
      `${CONFIGURED_BASE}/image/avatars/e1.png`
    )
  })

  it('avatar 字段更新后 img.src 跟随更新', async () => {
    const user = makeUser('/api/v1/image/avatars/e1.png')
    const { wrapper } = mountWithProviders(EditableAvatar, { user })
    user.avatar = 'image/avatars/e2.png'
    await nextTick()
    expect(wrapper.find('.avatar-image').attributes('src')).toBe(
      `${CONFIGURED_BASE}/image/avatars/e2.png`
    )
  })
})
