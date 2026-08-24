import { createServer } from 'node:http'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import express, { type Request } from 'express'
import multer from 'multer'
import { WebSocket, WebSocketServer } from 'ws'
import { mergeScannedAssets, safeFileName, SUPPORTED_AUDIO_EXTENSIONS, clampVolume } from '../shared/logic.js'
import type { AppConfig, AudioAsset, ControlCommand, PublicState, SocketEnvelope, Zone } from '../shared/types.js'

const ROOT = process.cwd()
const AUDIO_DIR = path.join(ROOT, 'audio')
const DATA_DIR = path.join(ROOT, 'data')
const CONFIG_PATH = path.join(DATA_DIR, 'config.json')
const LIBRARY_PATH = path.join(DATA_DIR, 'library.json')
const DIST_DIR = path.join(ROOT, 'dist')
const PORT = Number(process.env.PORT || 5180)

const DEFAULT_CONFIG: AppConfig = {
  roomName: 'Escape Room 438',
  controlPin: process.env.CONTROL_PIN || '438438',
  maxEffectVoicesPerZone: 8,
  zones: [{
    id: 'laptop', name: 'Laptop Speaker', outputLabel: 'Default audio output', outputDeviceId: '',
    volume: 0.8, muted: false, enabled: true, status: 'connected',
  }],
}

let config: AppConfig = DEFAULT_CONFIG
let library: AudioAsset[] = []
let playbackClients = new Set<WebSocket>()
let playbackLastSeen = 0

async function ensureData() {
  await fs.mkdir(AUDIO_DIR, { recursive: true })
  await fs.mkdir(DATA_DIR, { recursive: true })
  config = await readJson(CONFIG_PATH, DEFAULT_CONFIG)
  library = await readJson(LIBRARY_PATH, [])
  await persistConfig()
  await persistLibrary()
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as T
  } catch {
    return fallback
  }
}

async function writeJson(filePath: string, value: unknown) {
  const temporary = `${filePath}.tmp`
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await fs.rename(temporary, filePath)
}

const persistConfig = () => writeJson(CONFIG_PATH, config)
const persistLibrary = () => writeJson(LIBRARY_PATH, library)

function isLoopback(address?: string) {
  return !address || address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function requestAddress(req: Request) {
  const forwarded = req.headers['x-forwarded-for']
  return typeof forwarded === 'string' ? forwarded.split(',')[0]?.trim() : req.socket.remoteAddress
}

function suppliedPin(req: Request) {
  return String(req.headers['x-control-pin'] || req.query.pin || '')
}

function isAuthorized(req: Request) {
  return isLoopback(requestAddress(req)) || suppliedPin(req) === config.controlPin
}

function publicState(req?: Request): PublicState {
  const { controlPin: _pin, ...publicConfig } = config
  return {
    config: publicConfig,
    library,
    playbackOnline: playbackClients.size > 0 && Date.now() - playbackLastSeen < 10_000,
    requiresPin: req ? !isLoopback(requestAddress(req)) : true,
    serverTime: new Date().toISOString(),
  }
}

function normalizeZone(zone: Zone): Zone {
  return {
    ...zone,
    id: safeFileName(zone.id || `zone-${Date.now()}`).toLowerCase(),
    name: String(zone.name || 'Unnamed zone').slice(0, 60),
    outputLabel: String(zone.outputLabel || 'Not bound').slice(0, 140),
    volume: clampVolume(zone.volume),
    muted: Boolean(zone.muted),
    enabled: Boolean(zone.enabled),
    status: ['connected', 'disconnected', 'permission-required', 'unbound'].includes(zone.status) ? zone.status : 'unbound',
  }
}

async function scanLibrary() {
  const entries = await fs.readdir(AUDIO_DIR, { withFileTypes: true })
  const names = entries
    .filter((entry) => entry.isFile() && SUPPORTED_AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))
  library = mergeScannedAssets(library, names, config.zones[0]?.id || 'laptop')
  await persistLibrary()
  return library
}

function updateZoneFromCommand(command: ControlCommand) {
  if (command.type !== 'set-volume' && command.type !== 'set-mute') return false
  const zone = config.zones.find((candidate) => candidate.id === command.zoneId)
  if (!zone) return false
  if (command.type === 'set-volume') zone.volume = clampVolume(command.volume)
  if (command.type === 'set-mute') zone.muted = Boolean(command.muted)
  void persistConfig()
  return true
}

const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '1mb' }))
app.use('/audio', express.static(AUDIO_DIR, { fallthrough: false, maxAge: '1h' }))

app.get('/api/state', (req, res) => res.json(publicState(req)))
app.post('/api/auth/check', (req, res) => {
  if (!isAuthorized(req)) return res.status(401).json({ ok: false })
  return res.json({ ok: true })
})

app.post('/api/config', async (req, res) => {
  if (!isAuthorized(req)) return res.status(401).json({ error: 'Invalid control PIN' })
  const next = req.body as Partial<AppConfig>
  if (!Array.isArray(next.zones) || !next.zones.length) return res.status(400).json({ error: 'At least one zone is required' })
  config = {
    ...config,
    roomName: String(next.roomName || config.roomName).slice(0, 80),
    maxEffectVoicesPerZone: Math.min(32, Math.max(1, Number(next.maxEffectVoicesPerZone || 8))),
    zones: next.zones.map(normalizeZone),
  }
  await persistConfig()
  broadcast({ channel: 'state', payload: publicState() })
  return res.json(publicState(req))
})

app.post('/api/library/scan', async (req, res) => {
  if (!isAuthorized(req)) return res.status(401).json({ error: 'Invalid control PIN' })
  await scanLibrary()
  broadcast({ channel: 'state', payload: publicState() })
  return res.json(library)
})

const upload = multer({
  storage: multer.diskStorage({
    destination: AUDIO_DIR,
    filename: (_req, file, callback) => callback(null, `${Date.now()}-${safeFileName(file.originalname)}`),
  }),
  limits: { fileSize: 100 * 1024 * 1024, files: 20 },
  fileFilter: (_req, file, callback) => callback(null, SUPPORTED_AUDIO_EXTENSIONS.has(path.extname(file.originalname).toLowerCase())),
})

app.post('/api/library/upload', (req, res) => {
  if (!isAuthorized(req)) return res.status(401).json({ error: 'Invalid control PIN' })
  upload.array('audio', 20)(req, res, async (error) => {
    if (error) return res.status(400).json({ error: error instanceof Error ? error.message : 'Upload failed' })
    await scanLibrary()
    broadcast({ channel: 'state', payload: publicState() })
    return res.json(library)
  })
})

app.post('/api/library/:id', async (req, res) => {
  if (!isAuthorized(req)) return res.status(401).json({ error: 'Invalid control PIN' })
  const index = library.findIndex((asset) => asset.id === req.params.id)
  if (index < 0) return res.status(404).json({ error: 'Audio asset not found' })
  const current = library[index]!
  const patch = req.body as Partial<AudioAsset>
  library[index] = {
    ...current,
    name: String(patch.name ?? current.name).slice(0, 80),
    category: patch.category === 'background' ? 'background' : patch.category === 'effect' ? 'effect' : current.category,
    defaultZoneId: config.zones.some((zone) => zone.id === patch.defaultZoneId) ? patch.defaultZoneId! : current.defaultZoneId,
    behavior: ['loop', 'one-shot', 'restart', 'allow-overlap'].includes(String(patch.behavior)) ? patch.behavior! : current.behavior,
    volume: clampVolume(Number(patch.volume ?? current.volume)),
    color: /^#[0-9a-f]{6}$/i.test(String(patch.color)) ? String(patch.color) : current.color,
    shortcut: String(patch.shortcut || '').slice(0, 2) || undefined,
    source: patch.source === 'myinstants' || patch.source === 'upload' ? patch.source : current.source,
    subcategory: patch.subcategory ? String(patch.subcategory).slice(0, 40) : current.subcategory,
  }
  await persistLibrary()
  broadcast({ channel: 'state', payload: publicState() })
  return res.json(library[index])
})

app.post('/api/windows/bluetooth', (req, res) => {
  if (!isAuthorized(req)) return res.status(401).json({ error: 'Invalid control PIN' })
  if (process.platform !== 'win32') return res.status(400).json({ error: 'Windows only' })
  const child = spawn('powershell.exe', ['-NoProfile', '-Command', "Start-Process 'ms-settings:bluetooth'"], {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
  return res.json({ ok: true })
})

if (await exists(DIST_DIR)) {
  app.use(express.static(DIST_DIR))
  app.get('*path', (_req, res) => res.sendFile(path.join(DIST_DIR, 'index.html')))
}

async function exists(filePath: string) {
  try { await fs.access(filePath); return true } catch { return false }
}

const server = createServer(app)
const wss = new WebSocketServer({ server, path: '/ws' })

function send(socket: WebSocket, envelope: SocketEnvelope) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(envelope))
}

function broadcast(envelope: SocketEnvelope, excluded?: WebSocket) {
  for (const client of wss.clients) if (client !== excluded) send(client, envelope)
}

wss.on('connection', (socket, request) => {
  const forwarded = request.headers['x-forwarded-for']
  const remoteAddress = typeof forwarded === 'string' ? forwarded.split(',')[0]?.trim() : request.socket.remoteAddress
  const url = new URL(request.url || '/ws', `http://${request.headers.host || 'localhost'}`)
  const authorized = isLoopback(remoteAddress) || url.searchParams.get('pin') === config.controlPin
  if (!authorized) {
    send(socket, { channel: 'error', message: 'Invalid control PIN' })
    socket.close(4001, 'Unauthorized')
    return
  }

  let role: 'controller' | 'playback' | undefined
  send(socket, { channel: 'state', payload: publicState() })

  socket.on('message', (raw) => {
    try {
      const envelope = JSON.parse(raw.toString()) as SocketEnvelope
      if (envelope.channel === 'hello') {
        role = envelope.role
        if (role === 'playback') {
          playbackClients.add(socket)
          playbackLastSeen = Date.now()
          broadcast({ channel: 'server-status', playbackOnline: true })
        }
        return
      }
      if (envelope.channel === 'command' && role === 'controller') {
        if (updateZoneFromCommand(envelope.payload)) broadcast({ channel: 'state', payload: publicState() })
        for (const playback of playbackClients) send(playback, envelope)
        return
      }
      if (envelope.channel === 'playback-event' && role === 'playback') {
        playbackLastSeen = Date.now()
        broadcast(envelope, socket)
      }
    } catch {
      send(socket, { channel: 'error', message: 'Malformed WebSocket message' })
    }
  })

  socket.on('close', () => {
    if (role === 'playback') {
      playbackClients.delete(socket)
      broadcast({ channel: 'server-status', playbackOnline: playbackClients.size > 0 })
    }
  })
})

setInterval(() => {
  if (playbackClients.size && Date.now() - playbackLastSeen > 10_000) {
    broadcast({ channel: 'server-status', playbackOnline: false })
  }
}, 3_000).unref()

await ensureData()
server.listen(PORT, '0.0.0.0', () => {
  console.log(`LAB 438 Audio Control: http://localhost:${PORT}`)
  console.log(`Control PIN for LAN clients: ${config.controlPin}`)
})
