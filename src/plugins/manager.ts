





import { parse } from 'yaml'
import { ExecutablePlugin, PluginContext, FilterConfig } from './types.ts'
import { register as reg, resolve as res } from './registry.ts'
import { createDisplayer } from './builtin/displayer.ts'
import { DrizzleDB } from '../drizzle/index.ts'
import { pluginConfigs, pluginLogs, userPluginPermissions, users } from '../models/index.ts'
import { eq, and, inArray } from 'drizzle-orm'
import { evaluateFilter } from './filter.ts'
import { PushOutboxService } from '../services/push/outboxService.ts'


reg('builtin/displayer', createDisplayer)


export type PluginEvent = 'message.create' | 'message.delete' | 'application.create' | 'client.create'


export class PluginManager {
  private cache: Map<number, ExecutablePlugin[]> = new Map()

  private filterCache: Map<number, FilterConfig | undefined> = new Map()

  constructor(private drizzle: DrizzleDB) {}

  private async isUserAdmin(userId: number): Promise<boolean> {
    try {
      const result = await this.drizzle
        .select({ admin: users.admin })
        .from(users)
        .where(and(eq(users.id, userId), eq(users.disabled, false)))
        .get()
      return result ? Boolean(result.admin) : false
    } catch {
      return false
    }
  }

  private async getUserPermittedPlugins(userId: number): Promise<Set<string>> {
    const permissions = await this.drizzle
      .select({ modulePath: userPluginPermissions.modulePath })
      .from(userPluginPermissions)
      .where(eq(userPluginPermissions.userId, userId))
    return new Set(permissions.map(p => p.modulePath))
  }

  async loadForUser(userId: number): Promise<ExecutablePlugin[]> {

    const userResult = await this.drizzle
      .select({ disabled: users.disabled })
      .from(users)
      .where(eq(users.id, userId))
      .get()

    if (!userResult || userResult.disabled) {

      return []
    }

    const cached = this.cache.get(userId)
    if (cached) return cached


    const isAdmin = await this.isUserAdmin(userId)


    const permittedPlugins = isAdmin ? null : await this.getUserPermittedPlugins(userId)

    const pluginConfigsResult = await this.drizzle
      .select({
        id: pluginConfigs.id,
        name: pluginConfigs.name,
        modulePath: pluginConfigs.modulePath,
        configYaml: pluginConfigs.configYaml
      })
      .from(pluginConfigs)
      .where(and(eq(pluginConfigs.userId, userId), eq(pluginConfigs.enabled, 1)))
      .all()

    const pushOutboxService = new PushOutboxService(this.drizzle)
    const plugins: ExecutablePlugin[] = []
    for (const row of pluginConfigsResult) {

      if (!isAdmin && permittedPlugins && !permittedPlugins.has(row.modulePath)) {
        continue
      }

      const p = res(row.modulePath, row.id, row.name)
      if (!p) continue


      let conf: Record<string, any> | undefined
      let parseError: string | null = null

      if (row.configYaml) {
        try {
          conf = parse(row.configYaml) as Record<string, any>
        } catch (error) {
          parseError = error instanceof Error ? error.message : 'YAML parse error'

        }
      }


      if (parseError) {
        try {
          await this.drizzle
            .insert(pluginLogs)
            .values({
              pluginId: p.id,
              userId,
              event: 'message.create',
              status: 0,
              durationMs: 0,
              error: `Config parse error: ${parseError}`
            })
        } catch {}
        continue
      }

      await p.init({
        config: conf,
        pushOutbox: {
          enqueueForUserDevices: (input) => pushOutboxService.enqueueForUserDevices(input)
        }
      })
      plugins.push(p)


      const filterConfig = conf?.filter as FilterConfig | undefined
      this.filterCache.set(p.id, filterConfig)
    }

    this.cache.set(userId, plugins)
    return plugins
  }

  invalidate(userId: number) {

    const plugins = this.cache.get(userId)
    if (plugins) {
      for (const p of plugins) {
        this.filterCache.delete(p.id)
      }
    }
    this.cache.delete(userId)
  }

  async emit(userId: number, event: PluginEvent, ctx: PluginContext): Promise<void> {
    const plugins = await this.loadForUser(userId)

    for (const p of plugins) {
      const start = Date.now()
      let status: 'ok' | 'error' | 'filtered' = 'ok'
      let errMsg = ''
      let handlerExecuted = false

      try {
        switch (event) {
          case 'message.create':
            if (p.onMessageCreate) {

              const filterConfig = this.filterCache.get(p.id)
              if (filterConfig) {
                const filterResult = evaluateFilter(filterConfig, ctx)

                if (!filterResult.allowed) {

                  if (filterResult.reason?.includes('Filter evaluation error')) {
                    status = 'error'
                    errMsg = filterResult.reason
                  } else {
                    status = 'filtered'
                    errMsg = `Filtered: ${filterResult.reason}`
                  }
                  break
                }
              }
              await p.onMessageCreate(ctx)
              handlerExecuted = true
            }
            break
          case 'message.delete':
            if (p.onMessageDelete) {

              const filterConfig = this.filterCache.get(p.id)
              if (filterConfig) {
                const filterResult = evaluateFilter(filterConfig, ctx)

                if (!filterResult.allowed) {

                  if (filterResult.reason?.includes('Filter evaluation error')) {
                    status = 'error'
                    errMsg = filterResult.reason
                  } else {
                    status = 'filtered'
                    errMsg = `Filtered: ${filterResult.reason}`
                  }
                  break
                }
              }
              await p.onMessageDelete(ctx)
              handlerExecuted = true
            }
            break
          case 'application.create':
            if (p.onApplicationCreate) {
              await p.onApplicationCreate(ctx)
              handlerExecuted = true
            }
            break
          case 'client.create':
            if (p.onClientCreate) {
              await p.onClientCreate(ctx)
              handlerExecuted = true
            }
            break
        }
      } catch (e) {
        status = 'error'
        errMsg = e instanceof Error ? e.message : 'unknown'
      }

      const duration = Date.now() - start


      if (status === 'filtered') {
        console.log(`[Plugin Filtered] plugin=${p.name} event=${event} reason=${errMsg}`)
        continue
      }


      if (status === 'error' && errMsg.includes('Filter evaluation error')) {
        console.error(`[Plugin Filter Error] plugin=${p.name} event=${event} error=${errMsg}`)
        continue
      }


      if (!handlerExecuted) continue


      const statusValue = status === 'ok' ? 1 : 0

      try {
        await this.drizzle
          .insert(pluginLogs)
          .values({
            pluginId: p.id,
            userId,
            event,
            status: statusValue,
            durationMs: duration,
            error: errMsg || null
          })
      } catch {}
    }
  }
}
