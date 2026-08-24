interface MediaDevices {
  selectAudioOutput?(options?: { deviceId?: string }): Promise<MediaDeviceInfo>
}

interface HTMLMediaElement {
  setSinkId?(sinkId: string): Promise<void>
}

interface AudioContext {
  setSinkId?(sinkId: string): Promise<void>
}
