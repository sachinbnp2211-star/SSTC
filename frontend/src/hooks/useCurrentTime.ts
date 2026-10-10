import { useSyncExternalStore } from 'react'

const listeners = new Set<() => void>()
let timer: number | undefined
let currentTime = Date.now()

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (timer === undefined) {
    timer = window.setInterval(() => {
      currentTime = Date.now()
      listeners.forEach((notify) => notify())
    }, 60_000)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && timer !== undefined) {
      window.clearInterval(timer)
      timer = undefined
    }
  }
}

function getSnapshot() {
  return currentTime
}

export function useCurrentTime() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
