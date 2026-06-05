type DiagnosticPayload = Record<string, unknown>

declare global {
  interface Window {
    __LUNA_DIAGNOSTICS_READY__?: boolean
    __LUNA_LAST_CLOUD_CALL__?: DiagnosticPayload
    __LUNA_LAST_ROUTE_CALL__?: DiagnosticPayload
  }
}

function getRuntime(): any {
  if (typeof wx !== 'undefined') return wx
  return undefined
}

function getPagesSnapshot() {
  try {
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
    return pages.map((page: any) => ({
      route: page?.route || '',
      options: page?.options || {},
    }))
  } catch {
    return []
  }
}

function getGlobalBag(): Window {
  return globalThis as unknown as Window
}

function rememberRouteCall(payload: DiagnosticPayload) {
  getGlobalBag().__LUNA_LAST_ROUTE_CALL__ = {
    ...payload,
    at: new Date().toISOString(),
    pages: getPagesSnapshot(),
  }
}

function wrapRouteApi(runtime: any, method: 'navigateTo' | 'switchTab' | 'reLaunch' | 'redirectTo') {
  const original = runtime?.[method]
  if (typeof original !== 'function' || original.__lunaWrapped) return

  const wrapped = function wrappedRouteApi(options: any = {}) {
    const url = options?.url || ''
    const startedAt = Date.now()
    rememberRouteCall({method, url, status: 'start'})
    console.info('[Route] start', {method, url, pages: getPagesSnapshot()})

    return original.call(runtime, {
      ...options,
      success(res: any) {
        rememberRouteCall({method, url, status: 'success', duration: Date.now() - startedAt})
        console.info('[Route] success', {method, url, duration: Date.now() - startedAt})
        options?.success?.(res)
      },
      fail(err: any) {
        rememberRouteCall({method, url, status: 'fail', duration: Date.now() - startedAt, error: String(err?.errMsg || err)})
        console.error('[Route] fail', {method, url, duration: Date.now() - startedAt, err, pages: getPagesSnapshot()})
        options?.fail?.(err)
      },
      complete(res: any) {
        console.info('[Route] complete', {method, url, duration: Date.now() - startedAt})
        options?.complete?.(res)
      },
    })
  }
  wrapped.__lunaWrapped = true
  runtime[method] = wrapped
}

export function setLastCloudCall(payload: DiagnosticPayload) {
  getGlobalBag().__LUNA_LAST_CLOUD_CALL__ = {
    ...payload,
    at: new Date().toISOString(),
  }
}

export function initRuntimeDiagnostics() {
  const bag = getGlobalBag()
  if (bag.__LUNA_DIAGNOSTICS_READY__) return
  bag.__LUNA_DIAGNOSTICS_READY__ = true

  const runtime = getRuntime()
  if (!runtime) return

  runtime.onError?.((error: string) => {
    console.error('[Runtime] app error', {
      error,
      pages: getPagesSnapshot(),
      lastCloudCall: bag.__LUNA_LAST_CLOUD_CALL__ || null,
      lastRouteCall: bag.__LUNA_LAST_ROUTE_CALL__ || null,
    })
  })

  runtime.onUnhandledRejection?.((event: any) => {
    console.error('[Runtime] unhandled rejection', {
      reason: event?.reason || event,
      pages: getPagesSnapshot(),
      lastCloudCall: bag.__LUNA_LAST_CLOUD_CALL__ || null,
      lastRouteCall: bag.__LUNA_LAST_ROUTE_CALL__ || null,
    })
  })

  wrapRouteApi(runtime, 'navigateTo')
  wrapRouteApi(runtime, 'switchTab')
  wrapRouteApi(runtime, 'reLaunch')
  wrapRouteApi(runtime, 'redirectTo')
}
