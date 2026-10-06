import { useEffect, useRef } from 'react'
import { AppState } from 'react-native'
import { NativeModule, requireOptionalNativeModule } from 'expo-modules-core'
import { useRpcClientContext } from '../transport/client-context'
import { loadHostCatalog } from '../transport/host-store'
import { WatchWorkspaceCatalog } from './watch-workspace-catalog'
import { deserializeWatchSnapshot, serializeWatchSnapshot } from './watch-workspace-snapshot'

type WatchEvents = { onRefreshRequested: () => void }
declare class WatchConnectivityModule extends NativeModule<WatchEvents> {
  isAvailable(): Promise<boolean>
  getWorkspaceSnapshot(): Promise<string>
  updateWorkspaceSnapshot(json: string): Promise<void>
}

const watch = requireOptionalNativeModule<WatchConnectivityModule>('OrcaWatchConnectivity')

export function WatchWorkspaceSync() {
  const context = useRpcClientContext()
  const catalogRef = useRef<WatchWorkspaceCatalog | null>(null)
  const bootstrapRef = useRef<Promise<void> | null>(null)
  useEffect(() => {
    if (!watch) {
      return
    }
    const catalog = (catalogRef.current ??= new WatchWorkspaceCatalog())
    let disposed = false
    let pending = false
    let rerun = false
    const refresh = async () => {
      if (pending) {
        rerun = true
        return
      }
      pending = true
      try {
        if (!(await watch.isAvailable()) || disposed) {
          return
        }
        // Restore display data before publishing a reconnecting host's first snapshot.
        bootstrapRef.current ??= Promise.resolve()
          .then(() => watch.getWorkspaceSnapshot())
          .then((json) => {
            const snapshot = deserializeWatchSnapshot(json)
            if (snapshot) {
              catalog.restore(snapshot.hosts)
            }
          })
          .catch(() => undefined)
        await bootstrapRef.current
        if (disposed) {
          return
        }
        const hosts = await loadHostCatalog()
        if (disposed) {
          return
        }
        catalog.setSources(hosts, context.getAllClients())
        // Publish disconnections and removals before waiting on any host RPC.
        await watch.updateWorkspaceSnapshot(serializeWatchSnapshot(catalog.snapshot()))
        await catalog.refresh()
        if (!disposed) {
          await watch.updateWorkspaceSnapshot(serializeWatchSnapshot(catalog.snapshot()))
        }
      } catch {
        // The native session retains the last delivered snapshot when transfer is unavailable.
      } finally {
        pending = false
        if (rerun && !disposed) {
          rerun = false
          void refresh()
        }
      }
    }
    const requestRefresh = () => {
      void refresh()
    }
    const watchSubscription = watch.addListener('onRefreshRequested', requestRefresh)
    const unsubscribeClients = context.subscribeAllHosts(requestRefresh)
    const appSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        requestRefresh()
      }
    })
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') {
        requestRefresh()
      }
    }, 15_000)
    requestRefresh()
    return () => {
      disposed = true
      clearInterval(timer)
      watchSubscription.remove()
      appSubscription.remove()
      unsubscribeClients()
    }
  }, [context])
  return null
}
