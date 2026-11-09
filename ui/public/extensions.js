/** Optional Studio panels. Providers keep their own kit, data scope and request handler. */
export function createExtensions () {
  const slots = new Map()
  return {
    provide (app, slot, render) {
      if (!/^[a-z0-9-]+$/.test(app) || !/^[a-z0-9-]+$/.test(slot) || typeof render !== 'function') throw new TypeError('Invalid Studio panel provider')
      if (!slots.has(slot)) slots.set(slot, new Map())
      const providers = slots.get(slot)
      if (providers.has(app)) throw new Error(`${app} already provides ${slot}`)
      providers.set(app, render)
    },
    async render (slot, context) {
      return Promise.all([...(slots.get(slot) || [])].map(async ([app, render]) => {
        try { return { app, content: await render(Object.freeze({ ...context })) } }
        catch (error) { return { app, error: error.message || String(error) } }
      }))
    }
  }
}
