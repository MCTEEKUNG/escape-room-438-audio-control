import type { AudioAsset, ControlCommand, Zone } from './types.js'

export const SUPPORTED_AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac'])

export function clampVolume(value: number) {
  if (!Number.isFinite(value)) return 1
  return Math.min(1, Math.max(0, value))
}

export function safeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._()\-\u0E00-\u0E7F ]/g, '_').replace(/\s+/g, '-').slice(0, 120)
}

export function resolveTargetZone(command: Extract<ControlCommand, { type: 'trigger-effect' }>) {
  return command.overrideZoneId || command.zoneId
}

export function zoneCanPlay(zone: Zone | undefined) {
  return Boolean(zone?.enabled && zone.status === 'connected')
}

export function assetDisplayName(fileName: string) {
  return fileName.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim()
}

export function mergeScannedAssets(current: AudioAsset[], fileNames: string[], defaultZoneId: string) {
  const byPath = new Map(current.map((asset) => [asset.filePath, asset]))
  const discovered = fileNames.map((filePath) => byPath.get(filePath) ?? ({
    id: `asset-${crypto.randomUUID()}`,
    name: assetDisplayName(filePath),
    filePath,
    category: 'effect' as const,
    defaultZoneId,
    behavior: 'allow-overlap' as const,
    volume: 1,
    color: '#2cc8b6',
  }))
  const discoveredPaths = new Set(fileNames)
  return [
    ...discovered,
    ...current.filter((asset) => !discoveredPaths.has(asset.filePath)).map((asset) => ({ ...asset, missing: true })),
  ]
}
