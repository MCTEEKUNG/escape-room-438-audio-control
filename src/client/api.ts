import type { AppConfig, AudioAsset, PublicState } from '../shared/types'

export function getPin() {
  return sessionStorage.getItem('lab438-pin') || ''
}

export function setPin(pin: string) {
  sessionStorage.setItem('lab438-pin', pin)
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { 'content-type': 'application/json' }),
      'x-control-pin': getPin(),
      ...init?.headers,
    },
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: response.statusText })) as { error?: string }
    throw new Error(payload.error || `Request failed (${response.status})`)
  }
  return response.json() as Promise<T>
}

export const api = {
  state: () => request<PublicState>('/api/state'),
  checkPin: (pin: string) => request<{ ok: boolean }>('/api/auth/check', { method: 'POST', headers: { 'x-control-pin': pin } }),
  saveConfig: (config: Omit<AppConfig, 'controlPin'>) => request<PublicState>('/api/config', { method: 'POST', body: JSON.stringify(config) }),
  scanLibrary: () => request<AudioAsset[]>('/api/library/scan', { method: 'POST' }),
  updateAsset: (asset: AudioAsset) => request<AudioAsset>(`/api/library/${encodeURIComponent(asset.id)}`, { method: 'POST', body: JSON.stringify(asset) }),
  upload: (files: FileList) => {
    const body = new FormData()
    Array.from(files).forEach((file) => body.append('audio', file))
    return request<AudioAsset[]>('/api/library/upload', { method: 'POST', body })
  },
  openBluetooth: () => request<{ ok: boolean }>('/api/windows/bluetooth', { method: 'POST' }),
}
