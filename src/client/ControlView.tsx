import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity, Bluetooth, Check, CircleStop, FolderSync, Keyboard, Library, MonitorSpeaker, Music2, Pencil, Play, Plus,
  Radio, Save, Search, Settings2, ShieldCheck, Speaker, Square, Upload, Volume2, VolumeX, X,
} from 'lucide-react'
import { api, getPin, setPin } from './api'
import { useLabSocket } from './useLabSocket'
import type { ActivityItem, AppConfig, AudioAsset, ControlCommand, PlaybackEvent, PublicState, ZoneStatus } from '../shared/types'

function activity(message: string, tone: ActivityItem['tone'] = 'info'): ActivityItem {
  return { id: crypto.randomUUID(), at: new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' }), tone, message }
}

const CATEGORY_TABS = [
  { id: 'all', label: 'ทั้งหมด', icon: '✨' },
  { id: 'upload', label: 'ไฟล์ที่อัปโหลด', icon: '📁' },
  { id: 'Trending TH', label: 'Trending TH', icon: '🔥' },
  { id: 'Anime & Manga', label: 'Anime & Manga', icon: '🎌' },
  { id: 'TikTok Trends', label: 'TikTok Trends', icon: '📱' },
  { id: 'Viral', label: 'Viral', icon: '⚡' },
]

const demoZones = [
  { id: 'demo-laptop', name: 'Laptop Speaker', outputLabel: 'Realtek(R) Audio', outputDeviceId: 'demo-1', volume: .72, muted: false, enabled: true, status: 'connected' as const },
  { id: 'demo-hall', name: 'Speaker A · Entrance', outputLabel: 'JBL Flip 6', outputDeviceId: 'demo-2', volume: .84, muted: false, enabled: true, status: 'connected' as const },
  { id: 'demo-lab', name: 'Speaker B · Lab', outputLabel: 'Sony SRS-XB23', outputDeviceId: 'demo-3', volume: .65, muted: false, enabled: true, status: 'connected' as const },
]
const demoAssets: AudioAsset[] = [
  { id: 'demo-door', name: 'ประตูเหล็กปิด', filePath: 'door.mp3', category: 'effect', defaultZoneId: 'demo-hall', behavior: 'allow-overlap', volume: 1, color: '#43ddbd', shortcut: '1', source: 'upload', subcategory: 'Uploaded' },
  { id: 'demo-alarm', name: 'สัญญาณเตือน', filePath: 'alarm.mp3', category: 'effect', defaultZoneId: 'demo-hall', behavior: 'allow-overlap', volume: 1, color: '#f05c62', shortcut: '2', source: 'upload', subcategory: 'Uploaded' },
  { id: 'demo-tueg', name: 'ตึงโป๊ะๆ', filePath: 'myinstants-tuengopa.mp3', category: 'effect', defaultZoneId: 'demo-hall', behavior: 'allow-overlap', volume: 1, color: '#ffb800', shortcut: '3', source: 'myinstants', subcategory: 'Trending TH' },
  { id: 'demo-wow', name: 'Anime Wow', filePath: 'myinstants-anime-wow.mp3', category: 'effect', defaultZoneId: 'demo-hall', behavior: 'allow-overlap', volume: 1, color: '#a855f7', shortcut: '4', source: 'myinstants', subcategory: 'Anime & Manga' },
  { id: 'demo-tiktok', name: 'TU TU TU DU MAX VERSTAPPEN', filePath: 'myinstants-tu-tu.mp3', category: 'effect', defaultZoneId: 'demo-hall', behavior: 'allow-overlap', volume: 1, color: '#00f2fe', shortcut: '5', source: 'myinstants', subcategory: 'TikTok Trends' },
  { id: 'demo-vine', name: 'VINE BOOM SOUND', filePath: 'myinstants-vine-boom.mp3', category: 'effect', defaultZoneId: 'demo-hall', behavior: 'allow-overlap', volume: 1, color: '#ff3366', shortcut: '6', source: 'myinstants', subcategory: 'Viral' },
]
demoAssets.push({ id: 'demo-bg', name: 'Dark Laboratory Ambience', filePath: 'bg.mp3', category: 'background', defaultZoneId: 'demo-laptop', behavior: 'loop', volume: .65, color: '#43ddbd', source: 'upload', subcategory: 'Uploaded' })

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
  const [showKeybinds, setShowKeybinds] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [renamingAssetId, setRenamingAssetId] = useState('')
  const [renameValue, setRenameValue] = useState('')
  const [renamingZoneId, setRenamingZoneId] = useState('')
  const [zoneRenameValue, setZoneRenameValue] = useState('')
  const [uploadingEffect, setUploadingEffect] = useState(false)
  const [listeningAssetId, setListeningAssetId] = useState<string | null>(null)
  const [selectedCategoryTab, setSelectedCategoryTab] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')

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
      } else if (payload.type === 'stop-effect') {
        const target = payload.zoneId
        setActive((current) => ({ ...current, [target]: (current[target] || []).filter((id) => id !== payload.assetId) }))
        const assetName = state?.library.find((item) => item.id === payload.assetId)?.name || payload.assetId
        addActivity(activity(`DEMO · หยุดเสียง ${assetName}`, 'warning'))
      } else if (payload.type === 'play-background') {
        setActive((current) => ({ ...current, [payload.zoneId]: [...(current[payload.zoneId] || []), payload.assetId] }))
        const assetName = state?.library.find((item) => item.id === payload.assetId)?.name || payload.assetId
        addActivity(activity(`DEMO · เล่นเพลง ${assetName} (Loop)`, 'success'))
      } else if (payload.type === 'stop-background') {
        const bgIds = state?.library.filter((item) => item.category === 'background').map((item) => item.id) || []
        setActive((current) => ({ ...current, [payload.zoneId]: (current[payload.zoneId] || []).filter((id) => !bgIds.includes(id)) }))
        addActivity(activity(`DEMO · หยุดเพลงพื้นหลัง`, 'warning'))
      } else if (payload.type === 'stop-zone') {
        setActive((current) => ({ ...current, [payload.zoneId]: [] }))
        addActivity(activity(`DEMO · หยุดเสียงทั้งหมดในโซน`, 'warning'))
      } else if (payload.type === 'stop-all') {
        setActive({})
        addActivity(activity(`DEMO · หยุดเสียงทั้งหมด (STOP ALL)`, 'danger'))
      } else {
        addActivity(activity(`DEMO · ${payload.type}`, 'info'))
      }
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

  const zoneReady = useCallback((zoneId: string) => (
    playbackOnline && (zoneStatuses[zoneId] || state?.config.zones.find((zone) => zone.id === zoneId)?.status) === 'connected'
  ), [playbackOnline, state?.config.zones, zoneStatuses])

  const readyZones = useMemo(() => state?.config.zones.filter((zone) => zoneReady(zone.id)) || [], [state?.config.zones, zoneReady])

  const triggerEffect = useCallback((asset: AudioAsset) => {
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
  }, [addActivity, command, readyZones, selectedEffectZone, zoneReady])

  const stopEffectAudio = useCallback((asset: AudioAsset) => {
    const target = selectedEffectZone || (zoneReady(asset.defaultZoneId) ? asset.defaultZoneId : readyZones[0]?.id || '')
    if (!target) return
    command({ type: 'stop-effect', zoneId: target, assetId: asset.id })
    addActivity(activity(`หยุดเสียง “${asset.name}”`, 'warning'))
  }, [addActivity, command, readyZones, selectedEffectZone, zoneReady])

  const saveKeybind = useCallback(async (asset: AudioAsset, key: string) => {
    const shortcut = key.trim().slice(0, 2)
    const updated = { ...asset, shortcut: shortcut || undefined }
    try {
      if (!demoMode) await api.updateAsset(updated)
      setState((current) => current ? { ...current, library: current.library.map((item) => item.id === asset.id ? updated : item) } : current)
      addActivity(activity(`เปลี่ยนปุ่มลัด ${asset.name} เป็น [${shortcut ? shortcut.toUpperCase() : 'ไม่มี'}]`, 'success'))
      setListeningAssetId(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to update keybind')
    }
  }, [addActivity, demoMode])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // If user is currently typing in an input/textarea
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement) return
      
      // If listening for new keybind
      if (listeningAssetId) {
        event.preventDefault()
        const asset = state?.library.find((item) => item.id === listeningAssetId)
        if (asset) {
          if (event.key === 'Escape' || event.key === 'Backspace') {
            void saveKeybind(asset, '')
          } else {
            void saveKeybind(asset, event.key)
          }
        }
        return
      }

      // Global Stop All (Space or Escape)
      if (event.code === 'Space' || event.key === 'Escape') {
        event.preventDefault()
        command({ type: 'stop-all' })
        addActivity(activity('คีย์ลัด [SPACE]: หยุดเสียงทั้งหมด (STOP ALL)', 'danger'))
        return
      }

      // Background music toggle shortcut ('b' or 'B')
      if (event.key.toLowerCase() === 'b') {
        event.preventDefault()
        const bgAssets = state?.library.filter((item) => item.category === 'background') || []
        if (bgAssets.length) {
          const readyZone = readyZones[0] || state?.config.zones[0]
          const zoneId = readyZone?.id || 'laptop'
          const playingBg = bgAssets.find((a) => active[zoneId]?.includes(a.id))
          if (playingBg) {
            command({ type: 'stop-background', zoneId })
            addActivity(activity(`คีย์ลัด [B]: หยุดเพลง ${playingBg.name}`, 'warning'))
          } else {
            command({ type: 'play-background', zoneId, assetId: bgAssets[0].id })
            addActivity(activity(`คีย์ลัด [B]: เล่นเพลง ${bgAssets[0].name}`, 'success'))
          }
        }
        return
      }

      // Sound Effect cues matching shortcut
      const asset = state?.library.find((item) => item.shortcut?.toLowerCase() === event.key.toLowerCase() && item.category === 'effect')
      if (!asset) return
      event.preventDefault()
      const target = selectedEffectZone || (zoneReady(asset.defaultZoneId) ? asset.defaultZoneId : readyZones[0]?.id || '')
      const isPlaying = Boolean(target && active[target]?.includes(asset.id))
      
      if (isPlaying) {
        // Pressing shortcut while playing -> STOP it!
        stopEffectAudio(asset)
      } else {
        // Pressing shortcut while idle -> PLAY it!
        triggerEffect(asset)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, command, listeningAssetId, readyZones, saveKeybind, selectedEffectZone, state?.config.zones, state?.library, stopEffectAudio, triggerEffect, zoneReady, addActivity])

  useEffect(() => {
    if (!state || !playbackOnline) {
      if (selectedEffectZone) setSelectedEffectZone('')
      return
    }
    const connectedZones = state.config.zones.filter((zone) => (zoneStatuses[zone.id] || zone.status) === 'connected')
    if (!connectedZones.some((zone) => zone.id === selectedEffectZone)) setSelectedEffectZone(connectedZones[0]?.id || '')
  }, [playbackOnline, selectedEffectZone, state, zoneStatuses])

  const categoryCounts = useMemo(() => {
    if (!state) return {} as Record<string, number>
    const counts: Record<string, number> = { all: 0, upload: 0 }
    for (const asset of state.library) {
      if (asset.category !== 'effect') continue
      counts.all = (counts.all || 0) + 1
      if (asset.source === 'upload' || !asset.filePath.startsWith('myinstants-')) {
        counts.upload = (counts.upload || 0) + 1
      }
      if (asset.subcategory) {
        counts[asset.subcategory] = (counts[asset.subcategory] || 0) + 1
      }
    }
    return counts
  }, [state])

  const effects = useMemo(() => {
    if (!state) return []
    return state.library.filter((asset) => {
      if (asset.category !== 'effect') return false
      if (selectedCategoryTab === 'upload') {
        if (asset.source !== 'upload' && asset.filePath.startsWith('myinstants-')) return false
      } else if (selectedCategoryTab !== 'all') {
        if (asset.subcategory !== selectedCategoryTab) return false
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim()
        const matchName = asset.name.toLowerCase().includes(q)
        const matchSub = (asset.subcategory || '').toLowerCase().includes(q)
        const matchKey = (asset.shortcut || '').toLowerCase() === q
        if (!matchName && !matchSub && !matchKey) return false
      }
      return true
    })
  }, [state, selectedCategoryTab, searchQuery])

  if (!pinReady) return <PinGate onUnlock={() => setPinReady(true)} error={pinError} setError={setPinError} />
  if (!state) return <main className="control-shell"><div className="boot-card"><Radio className="spin" />กำลังเชื่อมต่อ LAB 438…</div></main>

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
        <div className="brand-lockup">
          <div className="brand-symbol">
            <Activity />
          </div>
          <div>
            <span>🎛️ ESCAPE ROOM AUDIO</span>
            <strong>LAB 438 STUDIO</strong>
          </div>
        </div>
        <div className="header-status">
          <div className={`status-chip ${connected ? 'ok' : 'bad'}`}>
            <i />{connected ? '🟢 แผงควบคุม ONLINE' : '🔴 แผงควบคุม OFFLINE'}
          </div>
          <div className={`status-chip ${playbackOnline ? 'ok' : 'bad'}`}>
            <i />{playbackOnline ? '🔊 ลำโพงพร้อมใช้งาน' : '⚠️ รอเปิด PLAYBACK'}
          </div>
        </div>
        <div className="header-actions">
          <button onClick={() => setShowKeybinds(true)} title="ตั้งค่าและดูปุ่มลัดคีย์บอร์ด">
            <Keyboard />⌨️ ปุ่มลัด (Keybinds)
          </button>
          <a href="/?mode=playback" target="_blank" rel="noreferrer" title="เปิดหน้าเปิดเสียงลำโพง">
            <MonitorSpeaker />🔊 Playback
          </a>
          <button onClick={() => setShowLibrary(true)} title="จัดการคลังไฟล์เสียง">
            <Library />📁 คลังเสียง
          </button>
          <button onClick={() => setShowSetup(true)} title="ตั้งค่าโซนลำโพง">
            <Settings2 />⚙️ ตั้งค่า
          </button>
          <button className="emergency-stop" onClick={() => command({ type: 'stop-all' })} title="หยุดเสียงทั้งหมดทันที (Shortcut: SPACE)">
            <CircleStop />🛑 STOP ALL
          </button>
        </div>
      </header>

      {demoMode && (
        <section className="demo-banner">
          <Radio />
          <div>
            <strong>✨ UX DEMO MODE (โหมดทดลองเล่น)</strong>
            <span>ลำโพงและเสียงทั้งหมดเป็นข้อมูลจำลอง สามารถกดเล่นและทดสอบอนิเมชันได้เต็มที่ · <a href="/">กลับหน้าควบคุมจริง</a></span>
          </div>
        </section>
      )}
      {!playbackOnline && (
        <section className="offline-banner">
          <Radio />
          <div>
            <strong>⚠️ Playback Mode ยังไม่ออนไลน์</strong>
            <span>เปิดหน้า <a href="/?mode=playback" target="_blank" rel="noreferrer">🔊 Playback Mode</a> บนเครื่องที่ต่อลำโพงก่อนเริ่มเล่น เพื่อส่งเสียงออกจริง</span>
          </div>
        </section>
      )}
      {error && (
        <section className="error-banner">
          <span>🐾 แจ้งเตือน: {error}</span>
          <button onClick={() => setError('')} aria-label="ปิดแจ้งเตือน"><X /></button>
        </section>
      )}

      <div className="dashboard-grid">
        <section className="main-console">
          <div className="section-heading">
            <div>
              <span className="eyebrow">✨ SOUNDBOARD DESK</span>
              <h1>เสียงประกอบ & มีม (Sound Effects)</h1>
            </div>
            <span>{effects.length} เสียงพร้อมกด</span>
          </div>

          <section className="output-picker" aria-label="เลือกลำโพงสำหรับ Sound Effect">
            <div className="output-picker-copy">
              <Speaker />
              <div>
                <span>🔊 เสียงจะออกที่ลำโพง:</span>
                <strong>{readyZones.find((zone) => zone.id === selectedEffectZone)?.name || 'ยังไม่ได้เลือกลำโพง'}</strong>
              </div>
            </div>
            <div className="output-options" role="radiogroup">
              {readyZones.map((zone, index) => (
                <article className={`output-card ${selectedEffectZone === zone.id ? 'selected' : ''}`} key={zone.id}>
                  {renamingZoneId === zone.id ? (
                    <div className="speaker-rename-editor">
                      <input
                        autoFocus
                        aria-label="ชื่อ Speaker zone ใหม่"
                        value={zoneRenameValue}
                        onChange={(event) => setZoneRenameValue(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') void saveZoneRename(zone.id)
                          if (event.key === 'Escape') setRenamingZoneId('')
                        }}
                      />
                      <button aria-label="บันทึกชื่อ Speaker" onClick={() => void saveZoneRename(zone.id)}>
                        <Check />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={selectedEffectZone === zone.id}
                      className="output-option"
                      onClick={() => setSelectedEffectZone(zone.id)}
                    >
                      <span>{index + 1}</span>
                      <div>
                        <strong>{zone.name}</strong>
                        <small>{zone.outputLabel}</small>
                      </div>
                      <i />
                    </button>
                  )}
                  <button
                    className="output-rename"
                    aria-label={renamingZoneId === zone.id ? 'ยกเลิกเปลี่ยนชื่อ' : `เปลี่ยนชื่อ ${zone.name}`}
                    title="Rename zone"
                    onClick={() => (renamingZoneId === zone.id ? setRenamingZoneId('') : startZoneRename(zone.id, zone.name))}
                  >
                    {renamingZoneId === zone.id ? <X /> : <Pencil />}
                  </button>
                </article>
              ))}
              {!readyZones.length && (
                <a className="output-empty" href="/?mode=playback" target="_blank" rel="noreferrer">
                  ✨ เปิด Playback Mode เพื่อเชื่อมต่อลำโพง
                </a>
              )}
            </div>
          </section>

          {/* Category Tabs & Search Filter */}
          <div className="cue-filter-toolbar">
            <div className="cue-filter-row">
              <div className="cue-category-tabs" role="tablist">
                {CATEGORY_TABS.map((tab) => {
                  const count = tab.id === 'all' ? categoryCounts.all : tab.id === 'upload' ? categoryCounts.upload : (categoryCounts[tab.id] || 0)
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={selectedCategoryTab === tab.id}
                      className={`cue-tab ${selectedCategoryTab === tab.id ? 'active' : ''}`}
                      onClick={() => setSelectedCategoryTab(tab.id)}
                    >
                      <span>{tab.icon}</span>
                      <span>{tab.label}</span>
                      <span className="tab-count">{count ?? 0}</span>
                    </button>
                  )
                })}
              </div>
              <div className="cue-search-box">
                <Search />
                <input
                  type="text"
                  placeholder="🔍 พิมพ์ค้นหาชื่อเสียง หรือปุ่มลัด..."
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                />
                {searchQuery && (
                  <button className="cue-search-clear" onClick={() => setSearchQuery('')} aria-label="ล้างการค้นหา">
                    <X size={13} />
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="effects-grid">
            {effects.map((asset, index) => {
              const target = selectedEffectZone || (zoneReady(asset.defaultZoneId) ? asset.defaultZoneId : readyZones[0]?.id || '')
              const isPlaying = Boolean(target && active[target]?.includes(asset.id))
              const isListening = listeningAssetId === asset.id
              const isUpload = asset.source === 'upload' || !asset.filePath.startsWith('myinstants-')
              const sub = asset.subcategory || 'Trending TH'
              const iconEmoji = isUpload ? '📁' : sub === 'Trending TH' ? '🔥' : sub === 'Anime & Manga' ? '🎌' : sub === 'TikTok Trends' ? '📱' : sub === 'Viral' ? '⚡' : '🎵'

              return (
                <article
                  className={`effect-pad ${zoneReady(target) && !asset.missing ? '' : 'disabled'} ${isPlaying ? 'playing' : ''}`}
                  style={{ '--cue': asset.color } as React.CSSProperties}
                  key={asset.id}
                >
                  <button
                    className="rename-cue"
                    aria-label={renamingAssetId === asset.id ? 'บันทึกชื่อ' : `เปลี่ยนชื่อ ${asset.name}`}
                    title={renamingAssetId === asset.id ? 'Save name' : 'Rename'}
                    onClick={() => (renamingAssetId === asset.id ? void saveRename(asset) : startRename(asset))}
                  >
                    {renamingAssetId === asset.id ? <Check /> : <Pencil />}
                  </button>
                  {renamingAssetId === asset.id ? (
                    <div className="effect-trigger rename-mode">
                      <span className="cue-number">CUE #{String(index + 1).padStart(2, '0')}</span>
                      <div className="effect-icon-box">
                        <span style={{ fontSize: '20px' }}>{iconEmoji}</span>
                      </div>
                      <input
                        autoFocus
                        aria-label="ชื่อ Sound Effect ใหม่"
                        value={renameValue}
                        onChange={(event) => setRenameValue(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') void saveRename(asset)
                          if (event.key === 'Escape') setRenamingAssetId('')
                        }}
                      />
                      <span className="rename-hint">⏎ ENTER เพื่อบันทึก · ESC เพื่อยกเลิก</span>
                    </div>
                  ) : (
                    <button
                      className="effect-trigger"
                      disabled={!zoneReady(target) || asset.missing}
                      onClick={() => (isPlaying ? stopEffectAudio(asset) : triggerEffect(asset))}
                    >
                      <div className="effect-top-row">
                        <span className="cue-number">#{String(index + 1).padStart(2, '0')}</span>
                        <span
                          className={`keybind-chip ${isListening ? 'editing' : ''}`}
                          title={isListening ? 'กดปุ่มคีย์บอร์ดที่ต้องการ หรือ ESC เพื่อยกเลิก' : 'คลิกเพื่อตั้งปุ่มลัด'}
                          onClick={(event) => {
                            event.stopPropagation()
                            setListeningAssetId(isListening ? null : asset.id)
                          }}
                        >
                          {isListening ? '...' : asset.shortcut ? asset.shortcut.toUpperCase() : '+KEY'}
                        </span>
                      </div>
                      <div className="effect-icon-box">
                        <span style={{ fontSize: '20px' }}>{iconEmoji}</span>
                      </div>
                      <div className="effect-info">
                        <strong>{asset.name}</strong>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
                          <span className="cue-target">
                            🔊 {state.config.zones.find((zone) => zone.id === target)?.name || 'ไม่มีลำโพง'}
                          </span>
                          {isUpload ? (
                            <span className="cue-category-tag tag-upload">📁 Upload</span>
                          ) : sub === 'Trending TH' ? (
                            <span className="cue-category-tag tag-trending">🔥 Trending</span>
                          ) : sub === 'Anime & Manga' ? (
                            <span className="cue-category-tag tag-anime">🎌 Anime</span>
                          ) : sub === 'TikTok Trends' ? (
                            <span className="cue-category-tag tag-tiktok">📱 TikTok</span>
                          ) : sub === 'Viral' ? (
                            <span className="cue-category-tag tag-viral">⚡ Viral</span>
                          ) : (
                            <span className="cue-category-tag">{sub}</span>
                          )}
                        </div>
                        {isPlaying && (
                          <div className="cue-wave-bars" aria-label="Playing audio">
                            <span /><span /><span /><span /><span />
                          </div>
                        )}
                      </div>
                    </button>
                  )}
                  <div className="cue-action-bar">
                    {isPlaying ? (
                      <button className="cue-stop-btn" onClick={() => stopEffectAudio(asset)} title="หยุดเสียงนี้">
                        <Square />หยุดเสียง
                      </button>
                    ) : (
                      <button
                        className="cue-play-btn"
                        disabled={!zoneReady(target) || asset.missing}
                        onClick={() => triggerEffect(asset)}
                        title="เล่นเสียงนี้"
                      >
                        <Play />เล่นเสียง
                      </button>
                    )}
                    {asset.shortcut && <span className="cue-target" style={{ margin: 0, fontWeight: 700 }}>[{asset.shortcut.toUpperCase()}]</span>}
                  </div>
                </article>
              )
            })}
            <label className={`add-effect-card ${uploadingEffect ? 'uploading' : ''}`}>
              <input
                type="file"
                accept="audio/*,.flac"
                multiple
                disabled={uploadingEffect}
                onChange={(event) => {
                  if (event.target.files) void addSoundEffects(event.target.files)
                  event.currentTarget.value = ''
                }}
              />
              <Plus />
              <strong>{uploadingEffect ? 'กำลังอัปโหลด…' : '✨ เพิ่มเสียงของคุณเอง'}</strong>
              <span>MP3 · WAV · OGG · M4A · AAC · FLAC</span>
            </label>
          </div>

          <div className="section-heading speaker-controls-heading">
            <div>
              <span className="eyebrow">🔊 CONNECTED OUTPUTS</span>
              <h2>โซนลำโพงในห้อง (Speaker Controls)</h2>
            </div>
            <span>{readyZones.length} ลำโพงออนไลน์</span>
          </div>
          <div className="zone-grid">
            {readyZones.map((zone, index) => {
              const status = zoneStatuses[zone.id] || zone.status
              const isZoneActive = Boolean(active[zone.id]?.length)
              return (
                <article className="zone-card ready" key={zone.id}>
                  <div className="zone-card-top">
                    <div className="zone-number">ZONE {String(index + 1).padStart(2, '0')}</div>
                    <div className={`device-state ${status}`}><i />{status === 'connected' ? 'ONLINE' : status.toUpperCase()}</div>
                  </div>
                  <div className="zone-identity">
                    <Speaker />
                    <div>
                      <strong>{zone.name}</strong>
                      <span>{zone.outputLabel}</span>
                    </div>
                  </div>
                  <div className="zone-meter" title={isZoneActive ? 'Playing audio' : 'Idle'}>
                    <span className={isZoneActive ? 'active' : ''} />
                    <span className={isZoneActive ? 'active' : ''} />
                    <span className={isZoneActive ? 'active' : ''} />
                    <span className={isZoneActive ? 'active' : ''} />
                    <span className={isZoneActive ? 'active' : ''} />
                    <span className={isZoneActive ? 'active' : ''} />
                  </div>
                  <div className="volume-row">
                    <button aria-label={zone.muted ? 'เปิดเสียง' : 'ปิดเสียง'} onClick={() => command({ type: 'set-mute', zoneId: zone.id, muted: !zone.muted })}>
                      {zone.muted ? <VolumeX /> : <Volume2 />}
                    </button>
                    <input type="range" min="0" max="1" step="0.01" value={zone.volume} onChange={(event) => command({ type: 'set-volume', zoneId: zone.id, volume: Number(event.target.value) })} />
                    <b>{Math.round(zone.volume * 100)}%</b>
                  </div>
                  <div className="zone-controls">
                    <button onClick={() => command({ type: 'test-output', zoneId: zone.id })}>🔊 TEST BEEP</button>
                    <button onClick={() => command({ type: 'stop-zone', zoneId: zone.id })}>⏹️ STOP ZONE</button>
                  </div>
                </article>
              )
            })}
          </div>
        </section>

        <aside className="side-console">
          <BackgroundPanel state={state} readyZoneIds={readyZones.map((zone) => zone.id)} zoneReady={zoneReady} command={command} active={active} />
          <section className="activity-panel">
            <div className="panel-title">
              <div><Activity /><span>📋 ประวัติการทำงาน (LOG)</span></div>
              <button onClick={() => setActivities([])}>ล้างรายการ</button>
            </div>
            <div className="activity-list">
              {activities.length ? (
                activities.map((item) => (
                  <div className={`activity-line ${item.tone}`} key={item.id}>
                    <time>{item.at}</time>
                    <i />
                    <p>{item.message}</p>
                  </div>
                ))
              ) : (
                <p className="quiet">🐾 ยังไม่มีรายการ</p>
              )}
            </div>
          </section>
        </aside>
      </div>

      {showKeybinds && <KeybindsDrawer state={state} onClose={() => setShowKeybinds(false)} onSaveKeybind={saveKeybind} />}
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

function BackgroundPanel({ state, readyZoneIds, zoneReady, command, active }: { state: PublicState; readyZoneIds: string[]; zoneReady: (id: string) => boolean; command: (payload: ControlCommand) => boolean; active: Record<string, string[]> }) {
  const backgrounds = useMemo(() => state.library.filter((asset) => asset.category === 'background'), [state.library])
  const [assetId, setAssetId] = useState(backgrounds[0]?.id || '')
  const availableZones = state.config.zones.filter((zone) => readyZoneIds.includes(zone.id))
  const [zoneId, setZoneId] = useState(availableZones[0]?.id || '')
  
  useEffect(() => {
    if (!availableZones.some((zone) => zone.id === zoneId)) setZoneId(availableZones[0]?.id || '')
  }, [availableZones, zoneId])

  const isPlayingBg = Boolean(zoneId && assetId && active[zoneId]?.includes(assetId))

  return (
    <section className="background-panel">
      <div className="panel-title">
        <div><Music2 /><span>🎶 เพลงบรรยากาศ (BGM)</span></div>
        <span className="loop-label">{isPlayingBg ? '✨ PLAYING' : '🔁 LOOP'}</span>
      </div>
      <div className="bg-now">
        <div className={`album-mark ${isPlayingBg ? 'spinning' : ''}`}><Music2 /></div>
        <div>
          <span>เพลงที่เลือกเล่น:</span>
          <strong>{backgrounds.find((asset) => asset.id === assetId)?.name || 'ยังไม่มีเพลงพื้นหลัง'}</strong>
        </div>
      </div>
      <label>
        🎵 เลือกเพลงพื้นหลัง
        <select value={assetId} onChange={(event) => setAssetId(event.target.value)}>
          <option value="">เลือกเพลง…</option>
          {backgrounds.map((asset) => <option value={asset.id} key={asset.id}>{asset.name}</option>)}
        </select>
      </label>
      <label>
        🔊 ส่งเสียงออกที่ลำโพงโซน
        <select value={zoneId} onChange={(event) => setZoneId(event.target.value)}>
          <option value="">เลือกลำโพงที่เชื่อมต่อ…</option>
          {availableZones.map((zone) => <option value={zone.id} key={zone.id}>{zone.name}</option>)}
        </select>
      </label>
      <div className="bg-actions">
        <button disabled={!assetId || !zoneId || !zoneReady(zoneId)} onClick={() => command({ type: 'play-background', zoneId, assetId })}>
          <Play size={14} />▶️ เล่น Loop (คีย์ B)
        </button>
        <button disabled={!zoneId} onClick={() => command({ type: 'stop-background', zoneId })}>
          <Square size={14} />⏹️ หยุด
        </button>
      </div>
    </section>
  )
}

function KeybindsDrawer({ state, onClose, onSaveKeybind }: { state: PublicState; onClose: () => void; onSaveKeybind: (asset: AudioAsset, key: string) => Promise<void> }) {
  const [listeningId, setListeningId] = useState<string | null>(null)
  const [keybindCategoryTab, setKeybindCategoryTab] = useState('all')
  const [keybindSearch, setKeybindSearch] = useState('')

  useEffect(() => {
    if (!listeningId) return
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault()
      const asset = state.library.find((item) => item.id === listeningId)
      if (asset) {
        if (event.key === 'Escape' || event.key === 'Backspace') {
          void onSaveKeybind(asset, '')
        } else {
          void onSaveKeybind(asset, event.key)
        }
      }
      setListeningId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [listeningId, onSaveKeybind, state.library])

  const filteredEffects = useMemo(() => {
    return state.library.filter((asset) => {
      if (asset.category !== 'effect') return false
      if (keybindCategoryTab === 'upload') {
        if (asset.source !== 'upload' && asset.filePath.startsWith('myinstants-')) return false
      } else if (keybindCategoryTab !== 'all') {
        if (asset.subcategory !== keybindCategoryTab) return false
      }
      if (keybindSearch.trim()) {
        const q = keybindSearch.toLowerCase().trim()
        const matchName = asset.name.toLowerCase().includes(q)
        const matchKey = (asset.shortcut || '').toLowerCase() === q
        if (!matchName && !matchKey) return false
      }
      return true
    })
  }, [state.library, keybindCategoryTab, keybindSearch])

  return (
    <div className="drawer-backdrop" onMouseDown={onClose}>
      <aside className="drawer" onMouseDown={(event) => event.stopPropagation()}>
        <div className="drawer-header">
          <div>
            <span className="eyebrow">KEYBOARD SHORTCUTS</span>
            <h2>ปุ่มลัด & Keybinds</h2>
          </div>
          <button onClick={onClose}><X /></button>
        </div>

        <p className="drawer-note">
          คลิกที่ปุ่มลัดด้านขวาแล้วกดปุ่มบนคีย์บอร์ดเพื่อเปลี่ยนปุ่มลัด หรือกด <strong>SPACEBAR</strong> เพื่อหยุดเสียงทั้งหมดทันที
        </p>

        <h3 style={{ fontSize: '13px', color: 'var(--cyan)', margin: '18px 0 8px', fontFamily: 'var(--font-mono)' }}>คำสั่งระบบ (SYSTEM KEYS)</h3>
        <div className="keybind-list">
          <div className="keybind-row">
            <div className="keybind-info">
              <strong>Emergency Stop All (หยุดเสียงทั้งหมด)</strong>
              <span>หยุดเพลงพื้นหลังและ Sound Effects ทั้งหมดทันที</span>
            </div>
            <span className="keybind-shortcut-btn">SPACE / ESC</span>
          </div>
          <div className="keybind-row">
            <div className="keybind-info">
              <strong>Toggle Background Music (เปิด/ปิดเพลงพื้นหลัง)</strong>
              <span>สลับเล่นหรือหยุดเพลง Loop อัตโนมัติ</span>
            </div>
            <span className="keybind-shortcut-btn">B</span>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 24, marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
          <h3 style={{ fontSize: '13px', color: 'var(--mint)', margin: 0, fontFamily: 'var(--font-mono)' }}>
            Sound Effects ({filteredEffects.length} เสียง)
          </h3>
          <div style={{ width: '100%', maxWidth: 220 }}>
            <input
              type="text"
              placeholder="ค้นหาชื่อเสียง..."
              value={keybindSearch}
              onChange={(e) => setKeybindSearch(e.target.value)}
              style={{
                width: '100%',
                padding: '6px 12px',
                borderRadius: '16px',
                border: '1px solid var(--panel-border)',
                background: 'rgba(5, 14, 18, 0.9)',
                color: '#ffffff',
                fontSize: '11px'
              }}
            />
          </div>
        </div>

        <div className="cue-category-tabs" style={{ marginBottom: 12 }}>
          {CATEGORY_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`cue-tab ${keybindCategoryTab === tab.id ? 'active' : ''}`}
              style={{ padding: '4px 10px', fontSize: '10px' }}
              onClick={() => setKeybindCategoryTab(tab.id)}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        <div className="keybind-list">
          {filteredEffects.map((asset) => {
            const isListening = listeningId === asset.id
            const isUpload = asset.source === 'upload' || !asset.filePath.startsWith('myinstants-')
            return (
              <div className="keybind-row" key={asset.id}>
                <div className="keybind-info">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <strong>{asset.name}</strong>
                    <span className={`cue-category-tag ${isUpload ? 'tag-upload' : 'tag-trending'}`} style={{ margin: 0, fontSize: '7px' }}>
                      {isUpload ? 'Upload' : (asset.subcategory || 'Instant')}
                    </span>
                  </div>
                  <span>{asset.behavior} · โซน: {state.config.zones.find((z) => z.id === asset.defaultZoneId)?.name || asset.defaultZoneId}</span>
                </div>
                <button
                  className={`keybind-shortcut-btn ${isListening ? 'listening' : ''}`}
                  onClick={() => setListeningId(isListening ? null : asset.id)}
                  title="คลิกแล้วกดปุ่มบนคีย์บอร์ด"
                >
                  {isListening ? 'กดปุ่ม...' : (asset.shortcut ? asset.shortcut.toUpperCase() : '+ ตั้งปุ่ม')}
                </button>
              </div>
            )
          })}
          {!filteredEffects.length && <p className="quiet">ไม่พบ Sound Effect ในหมวดหมู่นี้</p>}
        </div>

        <div className="drawer-actions">
          <button className="primary" onClick={onClose}><Check />เรียบร้อย</button>
        </div>
      </aside>
    </div>
  )
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

