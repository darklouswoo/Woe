import { ref, inject, provide, readonly, type InjectionKey } from 'vue'
import { useI18n } from 'vue-i18n'




export type AlertType = 'success' | 'error' | 'warning' | 'info'




export interface AlertOptions {

  title?: string

  message: string

  confirmText?: string

  type?: AlertType

  closeOnOverlayClick?: boolean
}




interface AlertState {

  visible: boolean

  options: AlertOptions

  resolve: (() => void) | null
}




export interface AlertContext {





  alert: (options: AlertOptions | string) => Promise<void>





  success: (message: string, title?: string) => Promise<void>





  error: (message: string, title?: string) => Promise<void>





  warning: (message: string, title?: string) => Promise<void>





  info: (message: string, title?: string) => Promise<void>
}


const ALERT_KEY: InjectionKey<AlertContext> = Symbol('alert')






export function useAlertProvider() {
  const { t } = useI18n()

  const state = ref<AlertState>({
    visible: false,
    options: {
      message: ''
    },
    resolve: null
  })




  const alert = (options: AlertOptions | string): Promise<void> => {
    return new Promise((resolve) => {
      const opts: AlertOptions = typeof options === 'string'
        ? { message: options }
        : options

      state.value = {
        visible: true,
        options: {
          confirmText: t('common.alert.confirmButton'),
          closeOnOverlayClick: true,
          ...opts
        },
        resolve
      }
    })
  }




  const success = (message: string, title?: string): Promise<void> => {
    return alert({
      type: 'success',
      title,
      message
    })
  }




  const error = (message: string, title?: string): Promise<void> => {
    return alert({
      type: 'error',
      title,
      message
    })
  }




  const warning = (message: string, title?: string): Promise<void> => {
    return alert({
      type: 'warning',
      title,
      message
    })
  }




  const info = (message: string, title?: string): Promise<void> => {
    return alert({
      type: 'info',
      title,
      message
    })
  }




  const handleConfirm = () => {
    if (state.value.resolve) {
      state.value.resolve()
      state.value.visible = false
    }
  }

  const context: AlertContext = {
    alert,
    success,
    error,
    warning,
    info
  }

  provide(ALERT_KEY, context)

  return {
    state: readonly(state),
    handleConfirm
  }
}







export function useAlert(): AlertContext {
  const context = inject<AlertContext>(ALERT_KEY)

  if (!context) {
    throw new Error('useAlert must be used within a component that provides AlertContext')
  }

  return context
}
