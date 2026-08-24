import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bluetooth, CheckCircle2, ExternalLink, MonitorSpeaker, RefreshCw, Radio, ShieldAlert, Volume2 } from 'lucide-react'
import { api } from './api'
import { PlaybackEngine } from './PlaybackEngine'
import { useLabSocket } from './useLabSocket'
import type { AppConfig, OutputDevice, PlaybackEvent, PublicState, Zone, ZoneStatus } from '../shared/types'

const isSupported = () => 'setSinkId' in HTMLMediaElement.prototype

export function PlaybackView() {
  const [state, setState] = useState<PublicState | null>(null)
  const [outputs, setOutputs] = useState<OutputDevice[]>([])
  const [notice, setNotice] = useState('กำลังเชื่อมต่อ Local Service…')
  const [busyZone, setBusyZone] = useState<string | null>(null)
  const engineRef = useRef<PlaybackEngine | null>(null)
  const sendEventRef = useRef<(event: PlaybackEvent) => boolean>(() => false)

  const handleState = useCallback((next: PublicState) => {
    setState(next)
    if (!engineRef.current) engineRef.current = new PlaybackEngine(next.config, next.library, (event) => sendEventRef.current(event))
    else engineRef.current.update(next.config, next.library)
  }, [])

  const { connected, sendPlaybackEvent } = useLabSocket('playback', {
    onState: handleState,
    onCommand: (command) => void engineRef.current?.handle(command),
    onError: setNotice,
  })
  sendEventRef.current = sendPlaybackEvent

  const publishStatuses = useCallback((devices: OutputDevice[], config?: Omit<AppConfig, 'controlPin'>) => {
    if (!config) return
    for (const zone of config.zones) {
      let status: ZoneStatus
      if (zone.id === 'laptop' && !zone.outputDeviceId) status = 'connected'
      else if (!zone.outputDeviceId) status = isSupported() ? 'unbound' : 'permission-required'
      else status = devices.some((output) => output.deviceId === zone.outputDeviceId) ? 'connected' : 'disconnected'
      sendPlaybackEvent({ type: 'zone-status-changed', zoneId: zone.id, status })
      if (status === 'disconnected') sendPlaybackEvent({ type: 'device-disconnected', zoneId: zone.id })
    }
  }, [sendPlaybackEvent])

  const refreshOutputs = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const next = devices
        .filter((device) => device.kind === 'audiooutput')
        .map((device) => ({ deviceId: device.deviceId, label: device.label || 'Audio output (permission required)', groupId: device.groupId }))
      setOutputs(next)
      sendPlaybackEvent({ type: 'outputs-updated', outputs: next })
      publishStatuses(next, state?.config)
      setNotice(next.length ? `พบ audio output ${next.length} รายการ` : 'ยังไม่พบ audio output')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'ไม่สามารถอ่านรายชื่อ audio output ได้')
    }
  }, [publishStatuses, sendPlaybackEvent, state?.config])

  useEffect(() => {
    void refreshOutputs()
    const onChange = () => void refreshOutputs()
    navigator.mediaDevices?.addEventListener('devicechange', onChange)
    return () => navigator.mediaDevices?.removeEventListener('devicechange', onChange)
  }, [refreshOutputs])

  useEffect(() => {
    const timer = window.setInterval(() => sendPlaybackEvent({ type: 'playback-heartbeat' }), 3000)
    return () => window.clearInterval(timer)
  }, [sendPlaybackEvent])

  const bindZone = async (zone: Zone) => {
    if (!navigator.mediaDevices.selectAudioOutput) {
      setNotice('Browser นี้ไม่มี selectAudioOutput — โปรดใช้ Chrome หรือ Edge รุ่นใหม่')
      return
    }
    setBusyZone(zone.id)
    try {
      const selected = await navigator.mediaDevices.selectAudioOutput(zone.outputDeviceId ? { deviceId: zone.outputDeviceId } : undefined)
      if (!state) return
      const zones = state.config.zones.map((item) => item.id === zone.id ? {
        ...item,
        outputDeviceId: selected.deviceId,
        outputLabel: selected.label || 'Selected audio output',
        status: 'connected' as const,
      } : item)
      const next = await api.saveConfig({ ...state.config, zones })
      handleState(next)
      await refreshOutputs()
      setNotice(`ผูก ${zone.name} กับ ${selected.label || 'audio output'} แล้ว`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'ยกเลิกการเลือก output')
    } finally {
      setBusyZone(null)
    }
  }

  const compatibility = useMemo(() => isSupported(), [])

  if (!state) return <main className="playback-shell"><div className="boot-card"><Radio className="spin" />กำลังเตรียม Playback Runtime…</div></main>

  return (
    <main className="playback-shell">
      <header className="playback-header">
        <div>
          <span className="eyebrow">LAB 438 · LOCAL RUNTIME</span>
          <h1>Playback Mode</h1>
          <p>เปิดหน้านี้ค้างไว้บนโน้ตบุ๊กที่ต่อลำโพง</p>
        </div>
        <div className={`runtime-badge ${connected ? 'online' : 'offline'}`}><i />{connected ? 'SERVICE ONLINE' : 'RECONNECTING'}</div>
      </header>

      {!compatibility && (
        <section className="compat-alert"><ShieldAlert /><div><strong>Browser ไม่รองรับ Audio Output Selection</strong><span>ใช้ Chrome หรือ Microsoft Edge รุ่นใหม่บน Windows 11</span></div></section>
      )}

      <section className="runtime-toolbar">
        <button onClick={() => void refreshOutputs()}><RefreshCw size={17} />Scan / Refresh</button>
        <button onClick={() => void api.openBluetooth()}><Bluetooth size={17} />เปิด Bluetooth Settings<ExternalLink size={13} /></button>
        <a href="/" target="_blank" rel="noreferrer"><MonitorSpeaker size={17} />เปิด Control Mode</a>
      </section>

      <section className="runtime-summary">
        <div><span>Audio outputs</span><strong>{outputs.length}</strong></div>
        <div><span>Zones</span><strong>{state.config.zones.length}</strong></div>
        <div><span>Audio files</span><strong>{state.library.length}</strong></div>
      </section>

      <section className="binding-panel">
        <div className="section-heading"><div><span className="eyebrow">OUTPUT PATCH</span><h2>ผูกลำโพงกับโซน</h2></div><p>Browser จะถามสิทธิ์ทุกครั้งที่เลือก output ใหม่</p></div>
        <div className="binding-grid">
          {state.config.zones.map((zone, index) => {
            const connected = zone.id === 'laptop' && !zone.outputDeviceId || outputs.some((output) => output.deviceId === zone.outputDeviceId)
            return (
              <article className="binding-card" key={zone.id}>
                <div className="zone-index">{String(index + 1).padStart(2, '0')}</div>
                <div className="binding-copy"><strong>{zone.name}</strong><span>{zone.outputLabel || 'Not bound'}</span></div>
                <div className={`binding-state ${connected ? 'connected' : 'unbound'}`}>{connected ? <CheckCircle2 /> : <Radio />}{connected ? 'READY' : 'BIND REQUIRED'}</div>
                <button disabled={!compatibility || busyZone === zone.id} onClick={() => void bindZone(zone)}>{busyZone === zone.id ? 'กำลังเลือก…' : zone.outputDeviceId ? 'Rebind' : 'Select output'}</button>
                <button className="test-button" disabled={!connected} onClick={() => void engineRef.current?.handle({ type: 'test-output', zoneId: zone.id })}><Volume2 />Test</button>
              </article>
            )
          })}
        </div>
      </section>

      <footer className="runtime-footer"><i />{notice}<span>Bluetooth ต่างแบรนด์อาจมี latency ไม่เท่ากัน</span></footer>
    </main>
  )
}
