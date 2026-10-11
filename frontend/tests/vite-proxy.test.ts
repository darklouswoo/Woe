import { describe, it, expect } from 'vitest'
import { createServer as createViteServer, type ViteDevServer } from 'vite'
import {
  createServer as createNodeServer,
  request as httpRequest,
  type IncomingMessage,
  type Server as HttpServer,
} from 'node:http'
import { resolve } from 'node:path'
import viteConfig from '../vite.config'





const frontendRoot = resolve(__dirname, '..')


const proxyTarget = (entry: unknown): string | undefined =>
  typeof entry === 'string' ? entry : (entry as { target?: string } | null | undefined)?.target

const readBody = (res: IncomingMessage): Promise<string> =>
  new Promise((resolveBody, rejectBody) => {
    let body = ''
    res.setEncoding('utf8')
    res.on('data', (chunk: string) => (body += chunk))
    res.on('end', () => resolveBody(body))
    res.on('error', rejectBody)
  })


const postJson = (url: URL): Promise<{ status: number; body: string }> =>
  new Promise((resolvePost, rejectPost) => {
    const req = httpRequest(
      {
        hostname: url.hostname,
        port: Number(url.port),
        path: url.pathname + url.search,
        method: 'POST',
      },
      async (res) => {
        resolvePost({ status: res.statusCode ?? 0, body: await readBody(res) })
      }
    )
    req.on('error', rejectPost)
    req.end()
  })


const closeUpstream = (upstream: HttpServer): Promise<void> =>
  new Promise((resolveClose) => {
    upstream.closeAllConnections()
    upstream.close(() => resolveClose())
  })



describe('vite dev 代理配置(/auth 遗漏回归)', () => {
  const proxy =
    (viteConfig as { server?: { proxy?: Record<string, unknown> } }).server?.proxy ?? {}

  it("server.proxy 含 '/auth' 条目且默认 target 指向 localhost:8787", () => {
    expect(proxyTarget(proxy['/auth'])).toBe('http://localhost:8787')
  })

  it('其余既有代理条目未丢失(默认仍指向 8787)', () => {
    const expected: Array<[string, string]> = [
      ['/api', 'http://localhost:8787'],
      ['/current', 'http://localhost:8787'],
      ['/health', 'http://localhost:8787'],
      ['/version', 'http://localhost:8787'],
      ['/user', 'http://localhost:8787'],
      ['/application', 'http://localhost:8787'],
      ['/client', 'http://localhost:8787'],
      ['/message', 'http://localhost:8787'],
      ['/plugin', 'http://localhost:8787'],
      ['/stream', 'ws://localhost:8787'],
    ]
    for (const [key, target] of expected) {
      expect(proxyTarget(proxy[key]), `proxy['${key}']`).toBe(target)
    }
  })
})



describe('vite dev /auth 转发冒烟', () => {
  it(
    'POST /auth/logout 经 vite 代理到达临时上游(而非 vite 自身 404)',
    async () => {

      const upstream = createNodeServer((req, res) => {
        if (req.method === 'POST' && req.url === '/auth/logout') {
          res.writeHead(401, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: 'mock-upstream-auth-logout' }))
          return
        }
        res.writeHead(404, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'mock-upstream-unexpected-path' }))
      })
      const listen = await new Promise<{ ok: boolean; code?: string; port?: number }>((resolveListen) => {
        upstream.once('error', (error: NodeJS.ErrnoException) =>
          resolveListen({ ok: false, code: error.code })
        )
        upstream.listen(0, '127.0.0.1', () => {
          const address = upstream.address()
          resolveListen({ ok: true, port: address && typeof address !== 'string' ? address.port : undefined })
        })
      })
      if (!listen.ok) {
        throw new Error(`mock 上游监听临时端口失败: ${listen.code}`)
      }
      if (!listen.port) throw new Error('mock 上游未返回临时端口')

      let vite: ViteDevServer | undefined
      try {


        vite = await createViteServer({
          root: frontendRoot,
          configFile: resolve(frontendRoot, 'vite.config.ts'),
          logLevel: 'silent',

          server: {
            host: '127.0.0.1',
            port: 0,
            strictPort: false,
            proxy: {
              '/auth': { target: `http://127.0.0.1:${listen.port}` },
            },
          },
        })
        await vite.listen()
        const address = vite.httpServer?.address()
        if (!address || typeof address === 'string') {
          throw new Error(`vite dev server 未正常监听: ${String(address)}`)
        }
        const vitePort = address.port

        const { status, body } = await postJson(new URL(`http://127.0.0.1:${vitePort}/auth/logout`))


        expect(status).toBe(401)
        expect(body).toContain('mock-upstream-auth-logout')
      } finally {
        if (vite) {
          await vite.close().catch(() => {})
        }
        await closeUpstream(upstream)
      }
    },
    120_000
  )
})
