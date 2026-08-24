import { describe, expect, it } from 'vitest'
import { clampVolume, mergeScannedAssets, resolveTargetZone, safeFileName, zoneCanPlay } from './logic'

describe('audio control logic', () => {
  it('clamps unsafe volume values', () => {
    expect(clampVolume(-1)).toBe(0)
    expect(clampVolume(0.42)).toBe(0.42)
    expect(clampVolume(9)).toBe(1)
    expect(clampVolume(Number.NaN)).toBe(1)
  })

  it('uses an explicit override zone when provided', () => {
    expect(resolveTargetZone({ type: 'trigger-effect', zoneId: 'door', assetId: 'knock', overrideZoneId: 'desk' })).toBe('desk')
    expect(resolveTargetZone({ type: 'trigger-effect', zoneId: 'door', assetId: 'knock' })).toBe('door')
  })

  it('only enables connected zones', () => {
    expect(zoneCanPlay({ id: 'a', name: 'A', outputLabel: 'A', volume: 1, muted: false, enabled: true, status: 'connected' })).toBe(true)
    expect(zoneCanPlay({ id: 'b', name: 'B', outputLabel: 'B', volume: 1, muted: false, enabled: true, status: 'disconnected' })).toBe(false)
  })

  it('keeps metadata and marks removed files missing after a scan', () => {
    const current = [{ id: 'old', name: 'Door', filePath: 'door.wav', category: 'effect' as const, defaultZoneId: 'a', behavior: 'restart' as const, volume: .7, color: '#ffffff' }]
    const result = mergeScannedAssets(current, ['new.wav'], 'laptop')
    expect(result.find((item) => item.filePath === 'door.wav')?.missing).toBe(true)
    expect(result.find((item) => item.filePath === 'new.wav')?.defaultZoneId).toBe('laptop')
  })

  it('sanitizes uploaded file names', () => {
    expect(safeFileName('../door:slam?.wav')).toBe('.._door_slam_.wav')
  })
})
