import { useCallback, useEffect, useRef, useState } from 'react'
import { getPin } from './api'
import type { ControlCommand, PlaybackEvent, PublicState, SocketEnvelope } from '../shared/types'

type SocketHandlers = {
  onState?: (state: PublicState) => void
  onPlaybackEvent?: (event: PlaybackEvent) => void
  onCommand?: (command: ControlCommand) => void
  onServerStatus?: (online: boolean) => void
  onError?: (message: string) => void
}

export function useLabSocket(role: 'controller' | 'playback', handlers: SocketHandlers, reconnectKey = '') {
  const [connected, setConnected] = useState(false)
  const socketRef = useRef<WebSocket | null>(null)
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(() => {
    let stopped = false
    let retry: number | undefined

    const connect = () => {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
      const socket = new WebSocket(`${protocol}//${location.host}/ws?pin=${encodeURIComponent(getPin())}`)
      socketRef.current = socket
      socket.onopen = () => {
        setConnected(true)
        socket.send(JSON.stringify({ channel: 'hello', role } satisfies SocketEnvelope))
      }
      socket.onmessage = (message) => {
        const envelope = JSON.parse(message.data as string) as SocketEnvelope
        if (envelope.channel === 'state') handlersRef.current.onState?.(envelope.payload)
        if (envelope.channel === 'playback-event') handlersRef.current.onPlaybackEvent?.(envelope.payload)
        if (envelope.channel === 'command') handlersRef.current.onCommand?.(envelope.payload)
        if (envelope.channel === 'server-status') handlersRef.current.onServerStatus?.(envelope.playbackOnline)
        if (envelope.channel === 'error') handlersRef.current.onError?.(envelope.message)
      }
      socket.onclose = () => {
        setConnected(false)
        if (!stopped) retry = window.setTimeout(connect, 1500)
      }
      socket.onerror = () => socket.close()
    }
    connect()
    return () => {
      stopped = true
      if (retry) window.clearTimeout(retry)
      socketRef.current?.close()
    }
  }, [role, reconnectKey])

  const send = useCallback((envelope: SocketEnvelope) => {
    if (socketRef.current?.readyState !== WebSocket.OPEN) return false
    socketRef.current.send(JSON.stringify(envelope))
    return true
  }, [])

  const sendCommand = useCallback((payload: ControlCommand) => send({ channel: 'command', payload }), [send])
  const sendPlaybackEvent = useCallback((payload: PlaybackEvent) => send({ channel: 'playback-event', payload }), [send])

  return { connected, sendCommand, sendPlaybackEvent }
}
