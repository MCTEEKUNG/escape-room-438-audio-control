import type { AppConfig, AudioAsset, ControlCommand, PlaybackEvent, Zone } from '../shared/types'
import { clampVolume, resolveTargetZone } from '../shared/logic'

type Voice = { audio: HTMLAudioElement; assetId: string; startedAt: number }
type Emit = (event: PlaybackEvent) => void

export class PlaybackEngine {
  private backgrounds = new Map<string, Voice>()
  private effects = new Map<string, Voice[]>()
  private config: Omit<AppConfig, 'controlPin'>
  private library: AudioAsset[]
  private emit: Emit

  constructor(config: Omit<AppConfig, 'controlPin'>, library: AudioAsset[], emit: Emit) {
    this.config = config
    this.library = library
    this.emit = emit
  }

  update(config: Omit<AppConfig, 'controlPin'>, library: AudioAsset[]) {
    this.config = config
    this.library = library
    for (const zone of config.zones) this.applyZoneGain(zone)
  }

  async handle(command: ControlCommand) {
    if (command.type === 'play-background') return this.playBackground(command.zoneId, command.assetId)
    if (command.type === 'stop-background') return this.stopBackground(command.zoneId)
    if (command.type === 'trigger-effect') return this.playEffect(resolveTargetZone(command), command.assetId)
    if (command.type === 'stop-zone') return this.stopZone(command.zoneId)
    if (command.type === 'stop-all') return this.stopAll()
    if (command.type === 'set-volume' || command.type === 'set-mute') {
      const zone = this.config.zones.find((item) => item.id === command.zoneId)
      if (zone) {
        if (command.type === 'set-volume') zone.volume = clampVolume(command.volume)
        else zone.muted = command.muted
        this.applyZoneGain(zone)
      }
      return
    }
    if (command.type === 'test-output') return this.testOutput(command.zoneId)
  }

  private getZone(zoneId: string) {
    return this.config.zones.find((zone) => zone.id === zoneId)
  }

  private getAsset(assetId: string) {
    return this.library.find((asset) => asset.id === assetId)
  }

  private async prepareAudio(zone: Zone, asset: AudioAsset) {
    if (!zone.enabled || zone.status !== 'connected') throw new Error(`Zone ${zone.name} is unavailable`)
    if (asset.missing) throw new Error(`Audio file ${asset.name} is missing`)
    const audio = new Audio(`/audio/${encodeURIComponent(asset.filePath)}`)
    audio.preload = 'auto'
    audio.volume = zone.muted ? 0 : clampVolume(zone.volume * asset.volume)
    if (zone.outputDeviceId) {
      const setSinkId = audio.setSinkId?.bind(audio)
      if (!setSinkId) throw new Error('This browser cannot route audio to a selected output')
      await setSinkId(zone.outputDeviceId)
    }
    return audio
  }

  private bindEvents(voice: Voice, zone: Zone, kind: 'background' | 'effect') {
    voice.audio.onplay = () => this.emit({ type: 'audio-started', zoneId: zone.id, assetId: voice.assetId, voiceKind: kind })
    voice.audio.onended = () => {
      this.emit({ type: 'audio-ended', zoneId: zone.id, assetId: voice.assetId, voiceKind: kind })
      if (kind === 'effect') this.removeEffect(zone.id, voice)
    }
    voice.audio.onerror = () => {
      this.emit({ type: 'audio-error', zoneId: zone.id, assetId: voice.assetId, message: 'Browser could not play this audio file' })
      if (kind === 'effect') this.removeEffect(zone.id, voice)
    }
  }

  private async playBackground(zoneId: string, assetId: string) {
    const zone = this.getZone(zoneId)
    const asset = this.getAsset(assetId)
    if (!zone || !asset) return this.emit({ type: 'audio-error', zoneId, assetId, message: 'Zone or audio asset not found' })
    try {
      this.stopBackground(zoneId)
      const audio = await this.prepareAudio(zone, asset)
      audio.loop = true
      const voice = { audio, assetId, startedAt: Date.now() }
      this.backgrounds.set(zoneId, voice)
      this.bindEvents(voice, zone, 'background')
      await audio.play()
    } catch (error) {
      this.emit({ type: 'audio-error', zoneId, assetId, message: error instanceof Error ? error.message : 'Playback failed' })
    }
  }

  private async playEffect(zoneId: string, assetId: string) {
    const zone = this.getZone(zoneId)
    const asset = this.getAsset(assetId)
    if (!zone || !asset) return this.emit({ type: 'audio-error', zoneId, assetId, message: 'Zone or audio asset not found' })
    try {
      const voices = this.effects.get(zoneId) || []
      if (asset.behavior === 'restart') {
        voices.filter((voice) => voice.assetId === assetId).forEach((voice) => { voice.audio.pause(); this.removeEffect(zoneId, voice) })
      }
      while (voices.length >= this.config.maxEffectVoicesPerZone) {
        const oldest = voices.shift()
        if (oldest) {
          oldest.audio.pause()
          this.emit({ type: 'audio-ended', zoneId, assetId: oldest.assetId, voiceKind: 'effect' })
        }
      }
      const audio = await this.prepareAudio(zone, asset)
      audio.loop = asset.behavior === 'loop'
      const voice = { audio, assetId, startedAt: Date.now() }
      voices.push(voice)
      this.effects.set(zoneId, voices)
      this.bindEvents(voice, zone, 'effect')
      await audio.play()
    } catch (error) {
      this.emit({ type: 'audio-error', zoneId, assetId, message: error instanceof Error ? error.message : 'Playback failed' })
    }
  }

  private stopBackground(zoneId: string) {
    const voice = this.backgrounds.get(zoneId)
    if (!voice) return
    voice.audio.pause()
    voice.audio.currentTime = 0
    this.backgrounds.delete(zoneId)
    this.emit({ type: 'audio-ended', zoneId, assetId: voice.assetId, voiceKind: 'background' })
  }

  private removeEffect(zoneId: string, voice: Voice) {
    this.effects.set(zoneId, (this.effects.get(zoneId) || []).filter((item) => item !== voice))
  }

  private stopZone(zoneId: string) {
    this.stopBackground(zoneId)
    for (const voice of this.effects.get(zoneId) || []) {
      voice.audio.pause()
      this.emit({ type: 'audio-ended', zoneId, assetId: voice.assetId, voiceKind: 'effect' })
    }
    this.effects.delete(zoneId)
  }

  private stopAll() {
    for (const zone of this.config.zones) this.stopZone(zone.id)
  }

  private applyZoneGain(zone: Zone) {
    const voices = [this.backgrounds.get(zone.id), ...(this.effects.get(zone.id) || [])].filter(Boolean) as Voice[]
    for (const voice of voices) {
      const asset = this.getAsset(voice.assetId)
      voice.audio.volume = zone.muted ? 0 : clampVolume(zone.volume * (asset?.volume ?? 1))
    }
  }

  private async testOutput(zoneId: string) {
    const zone = this.getZone(zoneId)
    if (!zone) return
    try {
      const context = new AudioContext()
      if (zone.outputDeviceId) {
        const setSinkId = context.setSinkId?.bind(context)
        if (!setSinkId) throw new Error('Audio output selection is not supported')
        await setSinkId(zone.outputDeviceId)
      }
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.frequency.value = 660
      gain.gain.setValueAtTime(0.0001, context.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.18, context.currentTime + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.45)
      oscillator.connect(gain).connect(context.destination)
      oscillator.start()
      oscillator.stop(context.currentTime + 0.48)
      oscillator.onended = () => void context.close()
    } catch (error) {
      this.emit({ type: 'audio-error', zoneId, assetId: 'test-tone', message: error instanceof Error ? error.message : 'Test failed' })
    }
  }
}
