import { ControlView } from './ControlView'
import { PlaybackView } from './PlaybackView'

export default function App() {
  const mode = new URLSearchParams(location.search).get('mode')
  return mode === 'playback' ? <PlaybackView /> : <ControlView />
}
