import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity, Bluetooth, Check, CircleStop, FolderSync, Library, MonitorSpeaker, Music2, Pencil, Plus,
  Radio, Save, Settings2, ShieldCheck, Speaker, Upload, Volume2, VolumeX, X,
} from 'lucide-react'
import { api, getPin, setPin } from './api'
import { useLabSocket } from './useLabSocket'
import type { ActivityItem, AppConfig, AudioAsset, ControlCommand, PlaybackEvent, PublicState, ZoneStatus } from '../shared/types'

function activity(message: string, tone: ActivityItem['tone'] = 'info'): ActivityItem {
  return { id: crypto.randomUUID(), at: new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' }), tone, message }
}

const demoZones = [
  { id: 'demo-laptop', name: 'Laptop Speaker', outputLabel: 'Realtek(R) Audio', outputDeviceId: 'demo-1', volume: .72, muted: false, enabled: true, status: 'connected' as const },
  { id: 'demo-hall', name: 'Speaker A · Entrance', outputLabel: 'JBL Flip 6', outputDeviceId: 'demo-2', volume: .84, muted: false, enabled: true, status: 'connected' as const },
  { id: 'demo-lab', name: 'Speaker B · Lab', outputLabel: 'Sony SRS-XB23', outputDeviceId: 'demo-3', volume: .65, muted: false, enabled: true, status: 'connected' as const },
]
const demoAssets: AudioAsset[] = [
  ['door', 'ประตูเหล็กปิด', '#43ddbd', '1'], ['alarm', 'สัญญาณเตือน', '#f05c62', '2'], ['whisper', 'เสียงกระซิบ', '#a784ff', '3'],
  ['thunder', 'ฟ้าผ่า', '#4bc9e2', '4'], ['footsteps', 'เสียงฝีเท้า', '#f2b650', '5'], ['success', 'ปลดล็อกสำเร็จ', '#55e27f', '6'],
].map(([id, name, color, shortcut]) => ({ id: `demo-${id}`, name, filePath: '', category: 'effect', defaultZoneId: 'demo-hall', behavior: 'allow-overlap', volume: 1, color, shortcut }))
demoAssets.push({ id: 'demo-bg', name: 'Dark Laboratory Ambience', filePath: '', category: 'background', defaultZoneId: 'demo-laptop', behavior: 'loop', volume: .65, color: '#43ddbd' })

function withDemoState(next: PublicState): PublicState {
  return { ...next, playbackOnline: true, config: { ...next.config, zones: demoZones }, library: demoAssets }
}

export function ControlView() {
  const demoMode = new URLSearchParams(location.search).get('demo') === '1'
  const remote = !['localhost', '127.0.0.1'].includes(location.hostname)
  const [pinReady, setPinReady] = useState(!remote || Boolean(getPin()))
  const [pinError, setPinError] = useState('')
  const [state, setState] = useState<PublicState | null>(null)
  const [playbackOnline, setPlaybackOnline] = useState(false)
  const [zoneStatuses, setZoneStatuses] = useState<Record<string, ZoneStatus>>({})
  const [selectedEffectZone, setSelectedEffectZone] = useState('')
  const [active, setActive] = useState<Record<string, string[]>>({})
  const [activities, setActivities] = useState<ActivityItem[]>([activity('พร้อมรับคำสั่งจาก Control UI')])
  const [showSetup, setShowSetup] = useState(false)
  const [showLibrary, setShowLibrary] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [renamingAssetId, setRenamingAssetId] = useState('')
  const [renameValue, setRenameValue] = useState('')
  const [renamingZoneId, setRenamingZoneId] = useState('')
  const [zoneRenameValue, setZoneRenameValue] = useState('')
  const [uploadingEffect, setUploadingEffect] = useState(false)

  const addActivity = useCallback((item: ActivityItem) => setActivities((items) => [item, ...items].slice(0, 80)), [])
  const handleState = useCallback((next: PublicState) => {
    const displayed = demoMode ? withDemoState(next) : next
    setState(displayed)
    setPlaybackOnline(displayed.playbackOnline)
    setZoneStatuses((current) => Object.fromEntries(displayed.config.zones.map((zone) => [zone.id, current[zone.id] || zone.status])))
  }, [demoMode])

  const handlePlaybackEvent = useCallback((event: PlaybackEvent) => {
    if (event.type === 'zone-status-changed') {
      setZoneStatuses((current) => ({ ...current, [event.zoneId]: event.status }))
      return
    }
    if (event.type === 'device-disconnected') {
      addActivity(activity(`ลำโพงโซน ${event.zoneId} หลุด — ปิดการยิงเสียงโซนนี้`, 'danger'))
      return
    }
    if (event.type === 'audio-started') {
      setActive((current) => ({ ...current, [event.zoneId]: [...(current[event.zoneId] || []), event.assetId] }))
      const asset = state?.library.find((item) => item.id === event.assetId)
      const zone = state?.config.zones.find((item) => item.id === event.zoneId)
      addActivity(activity(`เล่น ${asset?.name || event.assetId} → ${zone?.name || event.zoneId}`, 'success'))
      return
    }
    if (event.type === 'audio-ended') {
      setActive((current) => ({ ...current, [event.zoneId]: (current[event.zoneId] || []).filter((id) => id !== event.assetId) }))
      return
    }
    if (event.type === 'audio-error') {
      addActivity(activity(`ERROR · ${event.message}`, 'danger'))
      setError(event.message)
    }
  }, [addActivity, state])

  const { connected, sendCommand } = useLabSocket('controller', {
    onState: handleState,
    onPlaybackEvent: handlePlaybackEvent,
    onServerStatus: setPlaybackOnline,
    onError: setError,
  }, pinReady ? getPin() : 'locked')

  useEffect(() => {
    if (!pinReady) return
    void api.state().then(handleState).catch((reason: Error) => setError(reason.message))
  }, [handleState, pinReady])

  const command = useCallback((payload: ControlCommand) => {
    if (demoMode) {
      if (payload.type === 'trigger-effect') {
        const target = payload.overrideZoneId || payload.zoneId
        setActive((current) => ({ ...current, [target]: [...(current[target] || []), payload.assetId] }))
        const assetName = state?.library.find((item) => item.id === payload.assetId)?.name || payload.assetId
        const zoneName = state?.config.zones.find((item) => item.id === target)?.name || target
        addActivity(activity(`DEMO · เล่น ${assetName} → ${zoneName}`, 'success'))
        window.setTimeout(() => setActive((current) => ({ ...current, [target]: (current[target] || []).filter((id) => id !== payload.assetId) })), 900)
      } else addActivity(activity(`DEMO · ${payload.type}`, 'info'))
      return true
    }
    if (!playbackOnline) {
      addActivity(activity('Playback Mode offline — ไม่ส่งคำสั่งค้างไว้', 'warning'))
      return false
    }
    if (!sendCommand(payload)) {
      addActivity(activity('WebSocket disconnected', 'danger'))
      return false
    }
    return true
  }, [addActivity, demoMode, playbackOnline, sendCommand, state?.config.zones, state?.library])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement) return
      const asset = state?.library.find((item) => item.shortcut?.toLowerCase() === event.key.toLowerCase() && item.category === 'effect')
      if (!asset) return
      event.preventDefault()
      command({ type: 'trigger-effect', zoneId: asset.defaultZoneId, assetId: asset.id, overrideZoneId: selectedEffectZone || undefined })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [command, selectedEffectZone, state?.library])

  useEffect(() => {
    if (!state || !playbackOnline) {
      if (selectedEffectZone) setSelectedEffectZone('')
      return
    }
    const connectedZones = state.config.zones.filter((zone) => (zoneStatuses[zone.id] || zone.status) === 'connected')
    if (!connectedZones.some((zone) => zone.id === selectedEffectZone)) setSelectedEffectZone(connectedZones[0]?.id || '')
  }, [playbackOnline, selectedEffectZone, state, zoneStatuses])

  if (!pinReady) return <PinGate onUnlock={() => setPinReady(true)} error={pinError} setError={setPinError} />
  if (!state) return <main className="control-shell"><div className="boot-card"><Radio className="spin" />กำลังเชื่อมต่อ LAB 438…</div></main>

  const effects = state.library.filter((asset) => asset.category === 'effect')

  const zoneReady = (zoneId: string) => playbackOnline && (zoneStatuses[zoneId] || state.config.zones.find((zone) => zone.id === zoneId)?.status) === 'connected'
  const readyZones = state.config.zones.filter((zone) => zoneReady(zone.id))
  const triggerEffect = (asset: AudioAsset) => {
    const target = selectedEffectZone || (zoneReady(asset.defaultZoneId) ? asset.defaultZoneId : readyZones[0]?.id)
    if (!target) {
      addActivity(activity('ยังไม่มีลำโพงที่พร้อมสำหรับ Sound Effect', 'warning'))
      return
    }
    if (!zoneReady(target)) {
      addActivity(activity(`โซน ${target} ยังไม่พร้อมใช้งาน`, 'warning'))
      return
    }
    command({ type: 'trigger-effect', zoneId: asset.defaultZoneId, assetId: asset.id, overrideZoneId: target })
  }
  const startRename = (asset: AudioAsset) => {
    setRenamingAssetId(asset.id)
    setRenameValue(asset.name)
  }
  const saveRename = async (asset: AudioAsset) => {
    const name = renameValue.trim()
    if (!name) return
    const updated = { ...asset, name }
    try {
      if (!demoMode) await api.updateAsset(updated)
      setState((current) => current ? { ...current, library: current.library.map((item) => item.id === asset.id ? updated : item) } : current)
      addActivity(activity(`เปลี่ยนชื่อ Sound Effect เป็น “${name}”`, 'success'))
      setRenamingAssetId('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Rename failed')
    }
  }
  const startZoneRename = (zoneId: string, name: string) => {
    setRenamingZoneId(zoneId)
    setZoneRenameValue(name)
  }
  const saveZoneRename = async (zoneId: string) => {
    const name = zoneRenameValue.trim()
    if (!name || !state) return
    const config = { ...state.config, zones: state.config.zones.map((zone) => zone.id === zoneId ? { ...zone, name } : zone) }
    try {
      if (demoMode) setState({ ...state, config })
      else handleState(await api.saveConfig(config))
      addActivity(activity(`ตั้งชื่อ Speaker zone เป็น “${name}”`, 'success'))
      setRenamingZoneId('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Speaker rename failed')
    }
  }
  const addSoundEffects = async (files: FileList) => {
    if (!files.length) return
    if (demoMode) {
      setShowLibrary(true)
      return
    }
    setUploadingEffect(true)
    try {
      const library = await api.upload(files)
      setState((current) => current ? { ...current, library } : current)
      addActivity(activity(`เพิ่ม Sound Effect ${files.length} ไฟล์แล้ว`, 'success'))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Upload failed')
    } finally {
      setUploadingEffect(false)
    }
  }

  return (
    <main className="control-shell">
      <header className="control-header">
        <div className="brand-lockup"><div className="brand-symbol"><Activity /></div><div><span>ESCAPE ROOM AUDIO SYSTEM</span><strong>LAB 438</strong></div></div>
        <div className="header-status">
          <div className={`status-chip ${connected ? 'ok' : 'bad'}`}><i />CONTROL {connected ? 'ONLINE' : 'OFFLINE'}</div>
          <div className={`status-chip ${playbackOnline ? 'ok' : 'bad'}`}><i />PLAYBACK {playbackOnline ? 'READY' : 'OFFLINE'}</div>
        </div>
        <div className="header-actions">
          <a href="/?mode=playback" target="_blank" rel="noreferrer"><MonitorSpeaker />Playback</a>
          <button onClick={() => setShowLibrary(true)}><Library />Library</button>
          <button onClick={() => setShowSetup(true)}><Settings2 />Setup</button>
          <button className="emergency-stop" onClick={() => command({ type: 'stop-all' })}><CircleStop />STOP ALL</button>
        </div>
      </header>

      {demoMode && <section className="demo-banner"><Radio /><div><strong>UX DEMO MODE</strong><span>ลำโพงและเสียงทั้งหมดเป็นข้อมูลจำลอง ไม่มีเสียงออกจริง · <a href="/">กลับหน้าควบคุมจริง</a></span></div></section>}
      {!playbackOnline && <section className="offline-banner"><Radio /><div><strong>Playback Mode ยังไม่ออนไลน์</strong><span>เปิด <a href="/?mode=playback" target="_blank" rel="noreferrer">Playback Mode</a> บนโน้ตบุ๊กก่อนเริ่มเกม คำสั่งระหว่าง offline จะไม่ถูก queue</span></div></section>}
      {error && <section className="error-banner"><span>{error}</span><button onClick={() => setError('')}><X /></button></section>}

      <div className="dashboard-grid">
        <section className="main-console">
          <div className="section-heading"><div><span className="eyebrow">LIVE CUE DESK</span><h1>Sound effects</h1></div><span>{effects.length} CUES</span></div>
          <section className="output-picker" aria-label="เลือกลำโพงสำหรับ Sound Effect">
            <div className="output-picker-copy"><Speaker /><div><span>เสียงจะออกที่</span><strong>{readyZones.find((zone) => zone.id === selectedEffectZone)?.name || 'ยังไม่ได้เลือกลำโพง'}</strong></div></div>
            <div className="output-options" role="radiogroup">
              {readyZones.map((zone, index) => <article className={`output-card ${selectedEffectZone === zone.id ? 'selected' : ''}`} key={zone.id}>
                {renamingZoneId === zone.id ? <div className="speaker-rename-editor"><input autoFocus aria-label="ชื่อ Speaker zone ใหม่" value={zoneRenameValue} onChange={(event) => setZoneRenameValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void saveZoneRename(zone.id); if (event.key === 'Escape') setRenamingZoneId('') }} /><button aria-label="บันทึกชื่อ Speaker" onClick={() => void saveZoneRename(zone.id)}><Check /></button></div> : <button type="button" role="radio" aria-checked={selectedEffectZone === zone.id} className="output-option" onClick={() => setSelectedEffectZone(zone.id)}><span>{index + 1}</span><div><strong>{zone.name}</strong><small>{zone.outputLabel}</small></div><i /></button>}
                <button className="output-rename" aria-label={renamingZoneId === zone.id ? 'ยกเลิกเปลี่ยนชื่อ Speaker' : `เปลี่ยนชื่อ ${zone.name}`} title="Rename zone" onClick={() => renamingZoneId === zone.id ? setRenamingZoneId('') : startZoneRename(zone.id, zone.name)}>{renamingZoneId === zone.id ? <X /> : <Pencil />}</button>
              </article>)}
              {!readyZones.length && <a className="output-empty" href="/?mode=playback" target="_blank" rel="noreferrer">เปิด Playback Mode เพื่อเชื่อมต่อลำโพง</a>}
            </div>
          </section>
          <div className="effects-grid">{effects.map((asset, index) => {
            const target = selectedEffectZone || (zoneReady(asset.defaultZoneId) ? asset.defaultZoneId : readyZones[0]?.id || '')
            const isPlaying = Boolean(target && active[target]?.includes(asset.id))
            return (
              <article className={`effect-pad ${zoneReady(target) && !asset.missing ? '' : 'disabled'} ${isPlaying ? 'playing' : ''}`} style={{ '--cue': asset.color } as React.CSSProperties} key={asset.id}>
                <button className="rename-cue" aria-label={renamingAssetId === asset.id ? 'บันทึกชื่อ' : `เปลี่ยนชื่อ ${asset.name}`} title={renamingAssetId === asset.id ? 'Save name' : 'Rename'} onClick={() => renamingAssetId === asset.id ? void saveRename(asset) : startRename(asset)}>{renamingAssetId === asset.id ? <Check /> : <Pencil />}</button>
                {renamingAssetId === asset.id ? <div className="effect-trigger rename-mode"><span className="cue-number">CUE {String(index + 1).padStart(2, '0')}</span><Music2 /><input autoFocus aria-label="ชื่อ Sound Effect ใหม่" value={renameValue} onChange={(event) => setRenameValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void saveRename(asset); if (event.key === 'Escape') setRenamingAssetId('') }} /><span className="rename-hint">ENTER เพื่อบันทึก · ESC เพื่อยกเลิก</span></div> : <button className="effect-trigger" disabled={!zoneReady(target) || asset.missing} onClick={() => triggerEffect(asset)}><span className="cue-number">CUE {String(index + 1).padStart(2, '0')}</span><Music2 /><strong>{asset.name}</strong><span className="cue-target">เล่นที่ {state.config.zones.find((zone) => zone.id === target)?.name || 'ไม่มีลำโพง'}</span>{asset.shortcut && <kbd>{asset.shortcut.toUpperCase()}</kbd>}</button>}
              </article>
            )
          })}
            <label className={`add-effect-card ${uploadingEffect ? 'uploading' : ''}`}><input type="file" accept="audio/*,.flac" multiple disabled={uploadingEffect} onChange={(event) => { if (event.target.files) void addSoundEffects(event.target.files); event.currentTarget.value = '' }} /><Plus /><strong>{uploadingEffect ? 'กำลังอัปโหลด…' : 'เพิ่ม Sound Effect'}</strong><span>MP3 · WAV · OGG · M4A · AAC · FLAC</span></label>
          </div>

          <div className="section-heading speaker-controls-heading"><div><span className="eyebrow">CONNECTED OUTPUTS</span><h2>Speaker controls</h2></div><span>{readyZones.length} CONNECTED</span></div>
          <div className="zone-grid">
            {readyZones.map((zone, index) => {
              const status = zoneStatuses[zone.id] || zone.status
              return <article className="zone-card ready" key={zone.id}><div className="zone-card-top"><div className="zone-number">{String(index + 1).padStart(2, '0')}</div><div className={`device-state ${status}`}><i />{status.replace('-', ' ').toUpperCase()}</div></div><div className="zone-identity"><Speaker /><div><strong>{zone.name}</strong><span>{zone.outputLabel}</span></div></div><div className="zone-meter"><span className={active[zone.id]?.length ? 'active' : ''} /><span className={active[zone.id]?.length ? 'active' : ''} /><span className={active[zone.id]?.length ? 'active' : ''} /><span /></div><div className="volume-row"><button aria-label={zone.muted ? 'เปิดเสียง' : 'ปิดเสียง'} onClick={() => command({ type: 'set-mute', zoneId: zone.id, muted: !zone.muted })}>{zone.muted ? <VolumeX /> : <Volume2 />}</button><input type="range" min="0" max="1" step="0.01" value={zone.volume} onChange={(event) => command({ type: 'set-volume', zoneId: zone.id, volume: Number(event.target.value) })} /><b>{Math.round(zone.volume * 100)}</b></div><div className="zone-controls"><button onClick={() => command({ type: 'test-output', zoneId: zone.id })}>TEST</button><button onClick={() => command({ type: 'stop-zone', zoneId: zone.id })}>STOP ZONE</button></div></article>
            })}
          </div>
        </section>

        <aside className="side-console">
          <BackgroundPanel state={state} readyZoneIds={readyZones.map((zone) => zone.id)} zoneReady={zoneReady} command={command} />
          <section className="activity-panel">
            <div className="panel-title"><div><Activity /><span>ACTIVITY LOG</span></div><button onClick={() => setActivities([])}>CLEAR</button></div>
            <div className="activity-list">{activities.length ? activities.map((item) => <div className={`activity-line ${item.tone}`} key={item.id}><time>{item.at}</time><i /><p>{item.message}</p></div>) : <p className="quiet">ยังไม่มีรายการ</p>}</div>
          </section>
        </aside>
      </div>

      {showSetup && <SetupDrawer state={state} onClose={() => setShowSetup(false)} onSave={async (config) => { setSaving(true); try { handleState(await api.saveConfig(config)); addActivity(activity('บันทึก Zone configuration แล้ว', 'success')); setShowSetup(false) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Save failed') } finally { setSaving(false) } }} saving={saving} />}
      {showLibrary && <LibraryDrawer state={state} onClose={() => setShowLibrary(false)} onRefresh={handleState} onError={setError} />}
    </main>
  )
}

function PinGate({ onUnlock, error, setError }: { onUnlock: () => void; error: string; setError: (value: string) => void }) {
  const [value, setValue] = useState('')
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    try { await api.checkPin(value); setPin(value); onUnlock() } catch { setError('PIN ไม่ถูกต้อง') }
  }
  return <main className="pin-shell"><form onSubmit={submit}><ShieldCheck /><span className="eyebrow">PRIVATE CONTROL NETWORK</span><h1>LAB 438 Access</h1><p>ใส่ Control PIN ที่แสดงบน Local Service</p><input autoFocus inputMode="numeric" value={value} onChange={(event) => setValue(event.target.value)} placeholder="6-digit PIN" />{error && <span className="pin-error">{error}</span>}<button>เข้าสู่ Control UI</button></form></main>
}

function BackgroundPanel({ state, readyZoneIds, zoneReady, command }: { state: PublicState; readyZoneIds: string[]; zoneReady: (id: string) => boolean; command: (payload: ControlCommand) => boolean }) {
  const backgrounds = useMemo(() => state.library.filter((asset) => asset.category === 'background'), [state.library])
  const [assetId, setAssetId] = useState(backgrounds[0]?.id || '')
  const availableZones = state.config.zones.filter((zone) => readyZoneIds.includes(zone.id))
  const [zoneId, setZoneId] = useState(availableZones[0]?.id || '')
  useEffect(() => {
    if (!availableZones.some((zone) => zone.id === zoneId)) setZoneId(availableZones[0]?.id || '')
  }, [availableZones, zoneId])
  return <section className="background-panel"><div className="panel-title"><div><Music2 /><span>BACKGROUND</span></div><span className="loop-label">LOOP</span></div><div className="bg-now"><div className="album-mark"><Music2 /></div><div><span>Selected track</span><strong>{backgrounds.find((asset) => asset.id === assetId)?.name || 'No background track'}</strong></div></div><label>TRACK<select value={assetId} onChange={(event) => setAssetId(event.target.value)}><option value="">เลือกเพลง…</option>{backgrounds.map((asset) => <option value={asset.id} key={asset.id}>{asset.name}</option>)}</select></label><label>OUTPUT ZONE<select value={zoneId} onChange={(event) => setZoneId(event.target.value)}><option value="">เลือกลำโพงที่เชื่อมต่อ…</option>{availableZones.map((zone) => <option value={zone.id} key={zone.id}>{zone.name}</option>)}</select></label><div className="bg-actions"><button disabled={!assetId || !zoneId || !zoneReady(zoneId)} onClick={() => command({ type: 'play-background', zoneId, assetId })}>PLAY LOOP</button><button disabled={!zoneId} onClick={() => command({ type: 'stop-background', zoneId })}><CircleStop />STOP</button></div></section>
}

function SetupDrawer({ state, onClose, onSave, saving }: { state: PublicState; onClose: () => void; onSave: (config: Omit<AppConfig, 'controlPin'>) => void; saving: boolean }) {
  const [zones, setZones] = useState(state.config.zones)
  const addZone = () => setZones((items) => [...items, { id: `zone-${Date.now()}`, name: `Speaker ${items.length + 1}`, outputLabel: 'Not bound', volume: 0.8, muted: false, enabled: true, status: 'unbound' }])
  return <div className="drawer-backdrop" onMouseDown={onClose}><aside className="drawer" onMouseDown={(event) => event.stopPropagation()}><div className="drawer-header"><div><span className="eyebrow">SYSTEM SETUP</span><h2>Speaker zones</h2></div><button onClick={onClose}><X /></button></div><p className="drawer-note">สร้าง logical zone ที่นี่ แล้วเปิด Playback Mode เพื่อผูกกับ audio output จริง</p><div className="zone-editor-list">{zones.map((zone, index) => <div className="zone-editor" key={zone.id}><span>{String(index + 1).padStart(2, '0')}</span><input value={zone.name} onChange={(event) => setZones((items) => items.map((item) => item.id === zone.id ? { ...item, name: event.target.value } : item))} /><label><input type="checkbox" checked={zone.enabled} onChange={(event) => setZones((items) => items.map((item) => item.id === zone.id ? { ...item, enabled: event.target.checked } : item))} />Enabled</label>{zone.id !== 'laptop' && <button onClick={() => setZones((items) => items.filter((item) => item.id !== zone.id))}><X /></button>}</div>)}</div><button className="add-zone" onClick={addZone}><Plus />เพิ่ม Speaker zone</button><div className="drawer-actions"><button onClick={() => void api.openBluetooth()}><Bluetooth />Bluetooth Settings</button><button className="primary" disabled={saving} onClick={() => onSave({ ...state.config, zones })}><Save />{saving ? 'กำลังบันทึก…' : 'บันทึก Setup'}</button></div></aside></div>
}

function LibraryDrawer({ state, onClose, onRefresh, onError }: { state: PublicState; onClose: () => void; onRefresh: (state: PublicState) => void; onError: (message: string) => void }) {
  const [items, setItems] = useState(state.library)
  const refreshState = () => void api.state().then(onRefresh).catch((reason: Error) => onError(reason.message))
  const saveAsset = async (asset: AudioAsset) => { try { await api.updateAsset(asset); refreshState() } catch (reason) { onError(reason instanceof Error ? reason.message : 'Save failed') } }
  return <div className="drawer-backdrop" onMouseDown={onClose}><aside className="drawer library-drawer" onMouseDown={(event) => event.stopPropagation()}><div className="drawer-header"><div><span className="eyebrow">LOCAL AUDIO LIBRARY</span><h2>Background & Effects</h2></div><button onClick={onClose}><X /></button></div><div className="library-toolbar"><label className="upload-button"><Upload />Upload audio<input type="file" accept="audio/*,.flac" multiple onChange={(event) => { if (event.target.files?.length) void api.upload(event.target.files).then(() => { refreshState(); onClose() }).catch((reason: Error) => onError(reason.message)) }} /></label><button onClick={() => void api.scanLibrary().then((library) => { setItems(library); refreshState() }).catch((reason: Error) => onError(reason.message))}><FolderSync />Scan audio folder</button></div><p className="drawer-note">รองรับ MP3, WAV, OGG, M4A, AAC และ FLAC การรองรับ codec จริงขึ้นกับ Chrome/Edge</p><div className="asset-list">{items.map((asset) => <div className={`asset-row ${asset.missing ? 'missing' : ''}`} key={asset.id}><input value={asset.name} onChange={(event) => setItems((current) => current.map((item) => item.id === asset.id ? { ...item, name: event.target.value } : item))} /><select value={asset.category} onChange={(event) => setItems((current) => current.map((item) => item.id === asset.id ? { ...item, category: event.target.value as AudioAsset['category'] } : item))}><option value="effect">Effect</option><option value="background">Background</option></select><select value={asset.defaultZoneId} onChange={(event) => setItems((current) => current.map((item) => item.id === asset.id ? { ...item, defaultZoneId: event.target.value } : item))}>{state.config.zones.map((zone) => <option value={zone.id} key={zone.id}>{zone.name}</option>)}</select><select value={asset.behavior} onChange={(event) => setItems((current) => current.map((item) => item.id === asset.id ? { ...item, behavior: event.target.value as AudioAsset['behavior'] } : item))}><option value="allow-overlap">Allow overlap</option><option value="restart">Restart</option><option value="one-shot">One shot</option><option value="loop">Loop</option></select><input className="shortcut-input" maxLength={2} value={asset.shortcut || ''} placeholder="Key" onChange={(event) => setItems((current) => current.map((item) => item.id === asset.id ? { ...item, shortcut: event.target.value } : item))} /><button onClick={() => void saveAsset(asset)}><Save /></button></div>)}</div></aside></div>
}
