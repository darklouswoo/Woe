import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { AxiosError, type AxiosInstance, type InternalAxiosRequestConfig } from 'axios'
import CryptoJS from 'crypto-js'




vi.mock('@/services/websocket', () => ({
  wsService: {
    connect: vi.fn(),
    disconnect: vi.fn(),
  },
}))

import { wsService } from '@/services/websocket'
import api, { authApi, logoutHttpClient, userApi } from '@/services/api'
import { authService } from '@/services/auth'
import { useAuthStore } from '@/stores/auth'
import { UnauthorizedError } from '@/types'



interface CapturedRequest {
  config: InternalAxiosRequestConfig
  url: string
  method: string
  headers: Record<string, string>
  auth?: { username: string; password: string }
  data: any
  respond: (status: number, data?: unknown) => void
  fail: (error: AxiosError) => void
}

function installDeferredAdapter(instance: AxiosInstance): CapturedRequest[] {
  const queue: CapturedRequest[] = []
  instance.defaults.adapter = ((config: InternalAxiosRequestConfig) => {
    return new Promise((resolve, reject) => {
      queue.push({
        config,
        url: config.url ?? '',
        method: (config.method ?? 'get').toUpperCase(),
        headers: (config.headers ?? {}) as Record<string, string>,
        auth: config.auth,
        data: config.data,
        respond: (status: number, data: unknown = {}) => {
          const response = { data, status, statusText: String(status), headers: {}, config }
          if (status >= 200 && status < 300) {
            resolve(response as any)
          } else {
            reject(
              new AxiosError(
                `Request failed with status code ${status}`,
                status === 401 ? AxiosError.ERR_BAD_REQUEST : undefined,
                config,
                undefined,
                response as any
              )
            )
          }
        },
        fail: (error: AxiosError) => reject(error),
      })
    })
  }) as any
  return queue
}

const failWithNetwork = (req: CapturedRequest) =>
  req.fail(new AxiosError('Network Error', undefined, req.config))

const failWithTimeout = (req: CapturedRequest) =>
  req.fail(new AxiosError('timeout of 10000ms exceeded', AxiosError.ECONNABORTED, req.config))

const takeRequest = async (queue: CapturedRequest[]): Promise<CapturedRequest> => {
  for (let i = 0; i < 500 && queue.length === 0; i++) {
    await Promise.resolve()
  }
  const req = queue.shift()
  if (!req) throw new Error('expected a dispatched HTTP request but none was captured')
  return req
}

const expectNoRequest = async (queue: CapturedRequest[]) => {
  for (let i = 0; i < 500; i++) await Promise.resolve()
  expect(queue.length).toBe(0)
}

const installLocationStub = () => {
  const stub = {
    href: 'http://localhost/',
    origin: 'http://localhost',
    protocol: 'http:',
    host: 'localhost',
    pathname: '/',
    assign: vi.fn(),
    replace: vi.fn(),
  }
  Object.defineProperty(window, 'location', { configurable: true, writable: true, value: stub })
  return stub
}





const writeClientTokenStorage = (token: unknown) => {
  const payload = JSON.stringify({
    token,
    type: 'client',
    expires: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    lastUsed: new Date().toISOString(),
  })
  localStorage.setItem('woe_auth_client_token', CryptoJS.AES.encrypt(payload, 'woe-default-key').toString())
}



const userA = { id: 1, name: 'alice', nickname: 'Alice', email: 'a@x.test', admin: true, disabled: false }
const userB = { id: 2, name: 'bob', nickname: 'Bob', email: 'b@x.test', admin: false, disabled: false }
const clientA = { id: 11, token: 'client-token-A' }
const clientB = { id: 22, token: 'client-token-B' }

let apiQueue: CapturedRequest[]
let logoutQueue: CapturedRequest[]
let locationStub: ReturnType<typeof installLocationStub>

beforeAll(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  setActivePinia(createPinia())
  apiQueue = installDeferredAdapter(api)
  logoutQueue = installDeferredAdapter(logoutHttpClient)
  locationStub = installLocationStub()
})

describe('登出 A → 登录 B:迟到吊销响应隔离', () => {
  it.each([
    ['200', (req: CapturedRequest) => req.respond(200, {})],
    ['401', (req: CapturedRequest) => req.respond(401, { error: 'unauthorized' })],
    ['timeout', (req: CapturedRequest) => failWithTimeout(req)],
    ['500', (req: CapturedRequest) => req.respond(500, { error: 'Failed to logout' })],
  ])('A 的迟到 %s 响应均不影响 B 的存储、user、clientId、WS 与路由', async (_kind, respondLate) => {
    const store = useAuthStore()


    const loginA = store.login('alice', 'password')
    const userReqA = await takeRequest(apiQueue)
    userReqA.respond(200, userA)
    const clientReqA = await takeRequest(apiQueue)
    clientReqA.respond(200, clientA)
    await expect(loginA).resolves.toBe(true)


    const lateLogout = store.logout()


    const loginB = store.login('bob', 'password')
    const userReqB = await takeRequest(apiQueue)
    userReqB.respond(200, userB)
    const clientReqB = await takeRequest(apiQueue)
    clientReqB.respond(200, clientB)
    await expect(loginB).resolves.toBe(true)


    expect(authService.getToken('client')?.token).toBe('client-token-B')
    expect(store.user).toEqual(userB)
    expect(authService.getClientId()).toBe(22)
    expect(wsService.connect).toHaveBeenLastCalledWith('client-token-B')
    vi.mocked(wsService.disconnect).mockClear()
    const hrefBefore = locationStub.href


    const revokeReq = await takeRequest(logoutQueue)

    expect(revokeReq.headers['X-Gotify-Key']).toBe('client-token-A')
    respondLate(revokeReq)

    await expect(lateLogout).resolves.toBeDefined()


    expect(authService.getToken('client')?.token).toBe('client-token-B')
    expect(store.user).toEqual(userB)
    expect(authService.getClientId()).toBe(22)
    expect(wsService.disconnect).not.toHaveBeenCalled()
    expect(wsService.connect).toHaveBeenLastCalledWith('client-token-B')
    expect(locationStub.href).toBe(hrefBefore)
  })
})

describe('业务请求 401 会话守卫(真实拦截器 + adapter 打桩)', () => {
  it('当前会话业务 401:清凭据并跳转 /login(既有失效行为保留)', async () => {
    authService.setToken('client', 'client-token-B')
    const pending = userApi.getUsers()
    const req = await takeRequest(apiQueue)
    expect(req.url).toBe('/user')
    expect(req.headers['X-Gotify-Key']).toBe('client-token-B')

    expect(req.config.authSnapshot).toMatchObject({ clientToken: 'client-token-B' })

    req.respond(401, { error: 'unauthorized', errorDescription: 'bad token' })
    await expect(pending).rejects.toBeInstanceOf(UnauthorizedError)

    expect(authService.getToken('client')).toBeNull()
    expect(locationStub.href).toBe('/login')
  })

  it('结构损坏凭据(token 为对象)的当前会话 401:不再误判 stale,照常清理并跳转', async () => {




    writeClientTokenStorage({})
    const pending = userApi.getUsers()
    const req = await takeRequest(apiQueue)

    expect(req.config.authSnapshot?.clientToken).toBeNull()

    req.respond(401, { error: 'unauthorized', errorDescription: 'bad token' })
    await expect(pending).rejects.toBeInstanceOf(UnauthorizedError)


    expect(authService.getToken('client')).toBeNull()
    expect(localStorage.getItem('woe_auth_client_token')).toBeNull()
    expect(locationStub.href).toBe('/login')
  })

  it('旧会话业务请求迟到 401:不清新会话、不重定向', async () => {
    authService.setToken('client', 'client-token-A')
    const pending = userApi.getUsers()
    const req = await takeRequest(apiQueue)
    expect(req.config.authSnapshot).toMatchObject({ clientToken: 'client-token-A' })


    authService.setToken('client', 'client-token-B')

    req.respond(401, { error: 'unauthorized' })
    await expect(pending).rejects.toBeInstanceOf(UnauthorizedError)

    expect(authService.getToken('client')?.token).toBe('client-token-B')
    expect(locationStub.href).not.toBe('/login')
  })

  it('跨 tab 轮换(revision 不变、存储 token 已换):迟到 401 不清新会话', async () => {
    authService.setToken('client', 'client-token-A')
    const pending = userApi.getUsers()
    const req = await takeRequest(apiQueue)
    const revisionAtDispatch = authService.getSessionRevision()


    writeClientTokenStorage('client-token-other-tab')
    expect(authService.getSessionRevision()).toBe(revisionAtDispatch)

    req.respond(401, { error: 'unauthorized' })
    await expect(pending).rejects.toBeInstanceOf(UnauthorizedError)

    expect(authService.getClientCredentialForRevocation()).toBe('client-token-other-tab')
    expect(locationStub.href).not.toBe('/login')
  })

  it('旧 Basic 登录请求迟到 401:不清新会话', async () => {
    const pending = authApi.login('alice', 'wrong-password')
    const req = await takeRequest(apiQueue)
    expect(req.auth).toEqual({ username: 'alice', password: 'wrong-password' })
    expect(req.config.authSnapshot).toBeTruthy()


    authService.setToken('client', 'client-token-B')
    authService.setClientId(22)

    req.respond(401, { error: 'unauthorized' })
    await expect(pending).rejects.toBeInstanceOf(UnauthorizedError)

    expect(authService.getToken('client')?.token).toBe('client-token-B')
    expect(authService.getClientId()).toBe(22)
    expect(locationStub.href).not.toBe('/login')
  })
})

describe('checkAuth:本地清理与迟到守卫', () => {
  it('401:走本地失效清理,不发吊销网络请求', async () => {
    authService.setToken('client', 'client-token-A')
    const store = useAuthStore()
    store.user = userA as any
    store.authenticated = true

    const pending = store.checkAuth()
    const req = await takeRequest(apiQueue)
    expect(req.url).toBe('/current/user')
    req.respond(401, { error: 'unauthorized' })
    await expect(pending).resolves.toBe(false)

    expect(authService.getToken('client')).toBeNull()
    expect(store.user).toBeNull()
    expect(store.authenticated).toBe(false)
    expect(wsService.disconnect).toHaveBeenCalled()

    await expectNoRequest(logoutQueue)
  })

  it.each([
    ['网络错误', (req: CapturedRequest) => failWithNetwork(req)],
    ['服务端 500', (req: CapturedRequest) => req.respond(500, { error: 'internal' })],
  ])('%s:不清凭据(token 保留),不发吊销请求,不跳转', async (_name, fail) => {
    authService.setToken('client', 'client-token-A')
    const store = useAuthStore()

    const pending = store.checkAuth()
    const req = await takeRequest(apiQueue)
    fail(req)
    await expect(pending).resolves.toBe(false)

    expect(authService.getToken('client')?.token).toBe('client-token-A')
    expect(store.user).toBeNull()
    expect(store.authenticated).toBe(false)
    expect(wsService.disconnect).not.toHaveBeenCalled()
    await expectNoRequest(logoutQueue)
    expect(locationStub.href).not.toBe('/login')
  })

  it('旧 checkAuth 迟到成功:不恢复 A、不覆盖 B', async () => {
    authService.setToken('client', 'client-token-A')
    const store = useAuthStore()
    const pending = store.checkAuth()
    const req = await takeRequest(apiQueue)


    authService.setToken('client', 'client-token-B')
    store.user = userB as any
    store.authenticated = true

    req.respond(200, userA)
    await expect(pending).resolves.toBe(false)

    expect(store.user).toEqual(userB)
    expect(authService.getToken('client')?.token).toBe('client-token-B')
  })

  it('旧 checkAuth 迟到 401(B 已登录):不清 B、不重定向、不断 B 的 WS', async () => {
    authService.setToken('client', 'client-token-A')
    const store = useAuthStore()
    const pending = store.checkAuth()
    const req = await takeRequest(apiQueue)

    authService.setToken('client', 'client-token-B')
    store.user = userB as any
    store.authenticated = true

    req.respond(401, { error: 'unauthorized' })
    await expect(pending).resolves.toBe(false)

    expect(authService.getToken('client')?.token).toBe('client-token-B')
    expect(store.user).toEqual(userB)
    expect(store.authenticated).toBe(true)
    expect(locationStub.href).not.toBe('/login')
    expect(wsService.disconnect).not.toHaveBeenCalled()
  })
})
