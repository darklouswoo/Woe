import { readonly, ref } from 'vue'
import { clientApi } from '@/services/api'
import { authService } from '@/services/auth'
import { useAuthStore } from '@/stores/auth'
import { ForbiddenError } from '@/types'


export const ELEVATION_DURATION_SECONDS = 900


export const MAX_ELEVATION_ATTEMPTS = 3





export class ElevationCancelledError extends Error {
  constructor() {
    super('elevation-cancelled')
    this.name = 'ElevationCancelledError'
  }
}


export const isElevationCancelled = (e: unknown): e is ElevationCancelledError =>
  e instanceof ElevationCancelledError


export type ElevationModalError = 'wrongPassword' | 'requestFailed'


export type ElevationModalMode = 'password' | 'message'


export type ElevationMessageKey = 'elevate.relogin' | 'elevate.attemptsExhausted'


const isElevationModalOpen = ref(false)
const elevationModalMode = ref<ElevationModalMode>('password')
const elevationModalLoading = ref(false)
const elevationModalError = ref<ElevationModalError | null>(null)

const elevationModalMessageKey = ref<ElevationMessageKey>('elevate.relogin')


interface ElevationFlowCallbacks {

  resolvePassword: (password: string) => void

  cancel: () => void
}
let activeFlow: ElevationFlowCallbacks | null = null


let elevationInFlight: Promise<void> | null = null

function closeElevationModal(): void {
  activeFlow = null
  isElevationModalOpen.value = false
  elevationModalLoading.value = false
  elevationModalError.value = null
}





function promptForPassword(): Promise<string | null> {
  return new Promise((resolve) => {



    if (!(isElevationModalOpen.value && elevationModalMode.value === 'password')) {
      elevationModalError.value = null
    }
    elevationModalMode.value = 'password'
    elevationModalLoading.value = false
    isElevationModalOpen.value = true
    activeFlow = {
      resolvePassword: (password) => resolve(password),
      cancel: () => resolve(null)
    }
  })
}


function showElevationMessage(messageKey: ElevationMessageKey): void {
  activeFlow = null
  elevationModalError.value = null
  elevationModalLoading.value = false
  elevationModalMode.value = 'message'
  elevationModalMessageKey.value = messageKey
  isElevationModalOpen.value = true
}


function isSessionNotElevatedError(error: unknown): error is ForbiddenError {
  return error instanceof ForbiddenError && /session not elevated/i.test(error.message)
}






async function performElevation(): Promise<void> {
  const authStore = useAuthStore()
  const clientId = authService.getClientId()
  if (clientId === null) {

    showElevationMessage('elevate.relogin')
    throw new ElevationCancelledError()
  }

  for (let attempt = 1; attempt <= MAX_ELEVATION_ATTEMPTS; attempt++) {
    const password = await promptForPassword()
    if (password === null) {

      closeElevationModal()
      throw new ElevationCancelledError()
    }

    elevationModalLoading.value = true
    try {
      await clientApi.elevateClient(clientId, ELEVATION_DURATION_SECONDS, {
        username: authStore.user?.name ?? '',
        password
      })

      authStore.markElevated(ELEVATION_DURATION_SECONDS)
      closeElevationModal()
      return
    } catch (error) {
      elevationModalLoading.value = false

      elevationModalError.value = error instanceof ForbiddenError ? 'wrongPassword' : 'requestFailed'
      if (attempt >= MAX_ELEVATION_ATTEMPTS) {

        showElevationMessage('elevate.attemptsExhausted')
        throw new ElevationCancelledError()
      }
    }
  }

  throw new ElevationCancelledError()
}




function ensureElevated(): Promise<void> {
  if (!elevationInFlight) {
    elevationInFlight = performElevation().finally(() => {
      elevationInFlight = null
    })
  }
  return elevationInFlight
}















async function withElevation<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action()
  } catch (error) {
    if (!isSessionNotElevatedError(error)) {
      throw error
    }

    const authStore = useAuthStore()


    if (authStore.elevatedUntil && authStore.elevatedUntil.getTime() > Date.now()) {
      throw error
    }


    if (authService.getClientId() === null) {
      showElevationMessage('elevate.relogin')
      throw new ElevationCancelledError()
    }

    await ensureElevated()


    return await action()
  }
}


function handleElevationConfirm(password: string): void {
  if (!activeFlow || elevationModalLoading.value) return
  const flow = activeFlow
  activeFlow = null
  flow.resolvePassword(password)
}


function handleElevationCancel(): void {
  if (elevationModalLoading.value) return
  if (activeFlow) {
    const flow = activeFlow
    closeElevationModal()
    flow.cancel()
    return
  }

  isElevationModalOpen.value = false
}

export function useElevatedAction() {
  return {
    withElevation,
    isElevationModalOpen: readonly(isElevationModalOpen),
    elevationModalMode: readonly(elevationModalMode),
    elevationModalLoading: readonly(elevationModalLoading),
    elevationModalError: readonly(elevationModalError),
    elevationModalMessageKey: readonly(elevationModalMessageKey),
    handleElevationConfirm,
    handleElevationCancel
  }
}
