import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { authApi, clientApi } from '@/services/api'
import { authService } from '@/services/auth'
import { wsService } from '@/services/websocket'
import type { User } from '@/types'
import { getOrCreateDeviceUid, parseDeviceModel } from '@/utils/device'





export const WEB_CLIENT_INACTIVITY_SECONDS = 7 * 24 * 60 * 60








export type LogoutResult = 'confirmed' | 'already-unusable' | 'not-confirmed' | 'no-credential'


const extractStatus = (error: unknown): number | undefined => {
  const e = error as { response?: { status?: number }; statusCode?: number }
  return e?.response?.status ?? e?.statusCode ?? undefined
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null)
  const authenticated = ref(false)


  const elevatedUntil = ref<Date | null>(null)


  const isAuthenticated = computed(() => {
    return authenticated.value || authService.isTokenValid('client')
  })


  const token = computed(() => {
    const tokenInfo = authService.getToken('client')
    return tokenInfo?.token || null
  })

  const login = async (username: string, password: string) => {

    elevatedUntil.value = null
    try {

      const userResponse = await authApi.login(username, password)


      const clientRes = await clientApi.createClient({
        name: 'Web Client',
        platform: 'web',
        deviceUid: getOrCreateDeviceUid(),
        deviceModel: parseDeviceModel(),

        expiresAfterInactivitySeconds: WEB_CLIENT_INACTIVITY_SECONDS,
      }, { auth: { username, password } })


      authService.setToken('client', clientRes.data.token)


      authService.setClientId(clientRes.data.id)


      user.value = userResponse.data
      authenticated.value = true


      wsService.connect(clientRes.data.token)

      return true
    } catch (error) {
      console.error('Login failed:', error)
      return false
    }
  }


  const markElevated = (durationSeconds: number) => {
    elevatedUntil.value = new Date(Date.now() + durationSeconds * 1000)
  }





  const resetLocalAuth = () => {
    user.value = null
    authenticated.value = false

    elevatedUntil.value = null

    authService.clearAllAuth()

    wsService.disconnect()
  }









  const logout = (): Promise<LogoutResult> => {
    const capturedToken = authService.getClientCredentialForRevocation()


    resetLocalAuth()

    if (!capturedToken) {
      return Promise.resolve('no-credential')
    }

    return authApi.logout(capturedToken).then(
      () => 'confirmed' as const,
      (error: unknown) => {
        const status = extractStatus(error)
        if (status === 401) {

          return 'already-unusable' as const
        }

        return 'not-confirmed' as const
      }
    )
  }

  const checkAuth = async () => {

    if (!authService.isTokenValid('client')) {
      user.value = null
      authenticated.value = false
      return false
    }



    const startToken = authService.getClientCredentialForRevocation()

    try {
      const response = await authApi.getCurrentUser()
      if (authService.getClientCredentialForRevocation() !== startToken) {

        return false
      }
      user.value = response.data
      authenticated.value = true
      return true
    } catch (error) {
      const currentToken = authService.getClientCredentialForRevocation()


      if (currentToken !== null && currentToken !== startToken) {
        return false
      }

      const status = extractStatus(error)
      user.value = null
      authenticated.value = false
      if (status === 401) {


        resetLocalAuth()
      }


      return false
    }
  }

  return {
    user,
    token,
    authenticated,
    isAuthenticated,
    elevatedUntil,
    markElevated,
    login,
    logout,
    resetLocalAuth,
    checkAuth
  }
})
