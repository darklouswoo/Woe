import type { Message } from '@/types'
import router from '@/router'

export interface NotificationOptions {
  title: string
  body?: string
  icon?: string
  badge?: string
  image?: string
  tag?: string
  data?: any
  requireInteraction?: boolean
  silent?: boolean
  forceShow?: boolean
  onClick?: (event: Event) => void
  onClose?: (event: Event) => void
  onError?: (event: Event) => void
  onShow?: (event: Event) => void
}

export interface NotificationSettings {
  enabled: boolean
  sound: boolean
  requireInteraction: boolean
  showOnlyWhenPageHidden: boolean
  priority: 'all' | 'high' | 'emergency'
}

export class BrowserNotificationService {
  private static instance: BrowserNotificationService
  private isSupported: boolean = false
  private permission: NotificationPermission = 'default'
  private settings: NotificationSettings = {
    enabled: true,
    sound: true,
    requireInteraction: false,
    showOnlyWhenPageHidden: false,
    priority: 'all'
  }
  private activeNotifications: Map<string, Notification> = new Map()
  private pageVisibilityHandler: () => void

  private constructor() {
    this.isSupported = 'Notification' in window
    this.permission = this.isSupported ? Notification.permission : 'denied'
    this.pageVisibilityHandler = this.handleVisibilityChange.bind(this)


    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.pageVisibilityHandler)
    }


    this.loadSettings()
  }

  static getInstance(): BrowserNotificationService {
    if (!BrowserNotificationService.instance) {
      BrowserNotificationService.instance = new BrowserNotificationService()
    }
    return BrowserNotificationService.instance
  }




  isNotificationSupported(): boolean {
    return this.isSupported
  }




  getPermission(): NotificationPermission {
    return this.permission
  }




  async requestPermission(): Promise<NotificationPermission> {
    if (!this.isSupported) {
      return 'denied'
    }

    if (this.permission !== 'default') {
      return this.permission
    }

    try {
      this.permission = await Notification.requestPermission()
      return this.permission
    } catch (error) {
      console.error('Failed to request notification permission:', error)
      return 'denied'
    }
  }




  showNotification(options: NotificationOptions): boolean {
    if (!this.isSupported || this.permission !== 'granted') {
      return false
    }


    if (!this.settings.enabled) {
      return false
    }


    if (this.settings.showOnlyWhenPageHidden && !document.hidden && !options.forceShow) {
      return false
    }

    try {
      const notificationOptions: any = {
        body: options.body,
        icon: options.icon || '/favicon.ico',
        badge: options.badge || '/favicon.ico',
        tag: options.tag,
        data: options.data,
        requireInteraction: options.requireInteraction || this.settings.requireInteraction,
        silent: !this.settings.sound
      }


      if (options.image) {
        notificationOptions.image = options.image
      }

      const notification = new Notification(options.title, notificationOptions)


      if (options.onClick) {
        notification.onclick = options.onClick
      }

      if (options.onClose) {
        notification.onclose = options.onClose
      }

      if (options.onError) {
        notification.onerror = options.onError
      }

      if (options.onShow) {
        notification.onshow = options.onShow
      }


      const id = options.tag || `notification-${Date.now()}`
      this.activeNotifications.set(id, notification)


      notification.onclose = (event) => {
        this.activeNotifications.delete(id)
        if (options.onClose) {
          options.onClose(event)
        }
      }

      return true
    } catch (error) {
      console.error('Failed to show notification:', error)
      return false
    }
  }




  showMessageNotification(message: Message): boolean {

    const priority = message.priority ?? 1
    if (this.settings.priority === 'high' && priority < 2) {
      return false
    }
    if (this.settings.priority === 'emergency' && priority < 3) {
      return false
    }

    const title = message.title || 'New Message'
    const body = message.message || ''

    return this.showNotification({
      title,
      body,
      tag: `message-${message.id}`,
      data: { messageId: message.id, type: 'message' },
      requireInteraction: priority >= 2,
      onClick: () => {
        window.focus()

        void router.push(`/messages?messageId=${message.id}`)
      }
    })
  }




  closeNotification(tag: string): void {
    const notification = this.activeNotifications.get(tag)
    if (notification) {
      notification.close()
      this.activeNotifications.delete(tag)
    }
  }




  closeAllNotifications(): void {
    this.activeNotifications.forEach(notification => {
      notification.close()
    })
    this.activeNotifications.clear()
  }




  getSettings(): NotificationSettings {
    return { ...this.settings }
  }




  updateSettings(newSettings: Partial<NotificationSettings>): void {
    this.settings = { ...this.settings, ...newSettings }
    this.saveSettings()
  }




  private loadSettings(): void {
    try {
      const stored = localStorage.getItem('notification-settings')
      if (stored) {
        this.settings = { ...this.settings, ...JSON.parse(stored) }
      }
    } catch (error) {
      console.error('Failed to load notification settings:', error)
    }
  }




  private saveSettings(): void {
    try {
      localStorage.setItem('notification-settings', JSON.stringify(this.settings))
    } catch (error) {
      console.error('Failed to save notification settings:', error)
    }
  }




  private handleVisibilityChange(): void {

    if (!document.hidden) {
      this.activeNotifications.forEach((notification, tag) => {
        if (notification.requireInteraction) {
          notification.close()
          this.activeNotifications.delete(tag)
        }
      })
    }
  }




  destroy(): void {
    this.closeAllNotifications()
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.pageVisibilityHandler)
    }
  }
}


export const browserNotificationService = BrowserNotificationService.getInstance()