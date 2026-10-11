


export interface WysiwygHandle {
  destroy: () => void
}

export async function mountWysiwygEditor(
  host: HTMLElement,
  initialMarkdown: string,
  onUpdate: (markdown: string) => void
): Promise<WysiwygHandle> {
  const [{ Editor, rootCtx, defaultValueCtx }, { commonmark }, { gfm }, { listener, listenerCtx }] =
    await Promise.all([
      import('@milkdown/kit/core'),
      import('@milkdown/kit/preset/commonmark'),
      import('@milkdown/kit/preset/gfm'),
      import('@milkdown/kit/plugin/listener')
  ])
  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, host)
      ctx.set(defaultValueCtx, initialMarkdown)
      ctx.get(listenerCtx).markdownUpdated((_, markdown) => onUpdate(markdown))
    })
    .use(commonmark)
    .use(gfm)
    .use(listener)
    .create()
  return {
    destroy: () => {
      editor.destroy().catch(() => {})
    }
  }
}
