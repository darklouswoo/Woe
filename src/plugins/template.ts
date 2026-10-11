import { PluginContext } from './types.ts'





















const VARIABLE_MAP: Record<string, (ctx: PluginContext) => any> = {

  'USER_ID': (ctx) => ctx.userId,
  'NOW': (ctx) => ctx.now,


  'MESSAGE': (ctx) => ctx.message?.content,
  'MESSAGE_ID': (ctx) => ctx.message?.id,
  'MESSAGE_TITLE': (ctx) => ctx.message?.title,
  'MESSAGE_PRIORITY': (ctx) => ctx.message?.priority,
  'APP_ID': (ctx) => ctx.message?.appId,
  'APP_NAME': (ctx) => ctx.application?.name,


  'CLIENT_ID': (ctx) => ctx.client?.id,
  'CLIENT_NAME': (ctx) => ctx.client?.name,
}

export function resolveVariables(value: any, ctx: PluginContext): any {

  if (typeof value === 'string') {
    return value.replace(/#\{([A-Z_]+)\}/g, (_, varName) => {
      const resolver = VARIABLE_MAP[varName]
      const resolved = resolver ? resolver(ctx) : undefined

      return resolved !== undefined ? String(resolved) : `#{${varName}}`
    })
  }


  if (Array.isArray(value)) {
    return value.map(item => resolveVariables(item, ctx))
  }


  if (value && typeof value === 'object') {
    const result: Record<string, any> = {}
    for (const [key, val] of Object.entries(value)) {
      result[key] = resolveVariables(val, ctx)
    }
    return result
  }

  return value
}
