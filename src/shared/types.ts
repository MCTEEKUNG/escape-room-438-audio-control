export type ZoneStatus = 'connected' | 'disconnected' | 'permission-required' | 'unbound'
export type AudioCategory = 'background' | 'effect'
export type AudioBehavior = 'loop' | 'one-shot' | 'restart' | 'allow-overlap'

export interface Zone {
  id: string
  name: string
  outputLabel: string
  outputDeviceId?: string
  volume: number
  muted: boolean
  enabled: boolean
  status: ZoneStatus
}

export interface AudioAsset {
  id: string
  name: string
  filePath: string
  category: AudioCategory
  defaultZoneId: string
  behavior: AudioBehavior
  volume: number
  color: string
  shortcut?: string
  missing?: boolean
}

export interface AppConfig {
  roomName: string
  controlPin: string
  maxEffectVoicesPerZone: number
  zones: Zone[]
}

export interface OutputDevice {
  deviceId: string
  label: string
  groupId?: string
}

export interface PublicState {
  config: Omit<AppConfig, 'controlPin'>
  library: AudioAsset[]
  playbackOnline: boolean
  requiresPin: boolean
  serverTime: string
}

export type ControlCommand =
  | { type: 'play-background'; zoneId: string; assetId: string }
  | { type: 'stop-background'; zoneId: string }
  | { type: 'trigger-effect'; zoneId: string; assetId: string; overrideZoneId?: string }
  | { type: 'stop-zone'; zoneId: string }
  | { type: 'stop-all' }
  | { type: 'set-volume'; zoneId: string; volume: number }
  | { type: 'set-mute'; zoneId: string; muted: boolean }
  | { type: 'test-output'; zoneId: string }
  | { type: 'refresh-outputs' }

export type PlaybackEvent =
  | { type: 'outputs-updated'; outputs: OutputDevice[] }
  | { type: 'zone-status-changed'; zoneId: string; status: ZoneStatus }
  | { type: 'audio-started'; zoneId: string; assetId: string; voiceKind: 'background' | 'effect' }
  | { type: 'audio-ended'; zoneId: string; assetId: string; voiceKind: 'background' | 'effect' }
  | { type: 'audio-error'; zoneId: string; assetId: string; message: string }
  | { type: 'device-disconnected'; zoneId: string }
  | { type: 'playback-heartbeat' }

export type SocketEnvelope =
  | { channel: 'hello'; role: 'controller' | 'playback' }
  | { channel: 'command'; payload: ControlCommand }
  | { channel: 'playback-event'; payload: PlaybackEvent }
  | { channel: 'state'; payload: PublicState }
  | { channel: 'server-status'; playbackOnline: boolean }
  | { channel: 'error'; message: string }

export interface ActivityItem {
  id: string
  at: string
  tone: 'info' | 'success' | 'warning' | 'danger'
  message: string
}
