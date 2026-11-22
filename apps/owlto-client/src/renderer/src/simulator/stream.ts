import { useEffect, useRef, useState } from 'react'
import {
  SIMULATOR_STREAM_MESSAGE,
  type SimulatorInputMessage,
  type SimulatorStreamEnvelope,
  type SimulatorStreamMessage
} from '../../../shared/simulator'

export type StreamState = 'connecting' | 'live' | 'ended' | 'unsupported'

/** `avc1.PPCCLL` from an avcC record: profile, constraints, and level bytes. */
export function avcCodec(description: Uint8Array): string {
  const hex = (n: number | undefined) => (n ?? 0).toString(16).padStart(2, '0')
  return `avc1.${hex(description[1])}${hex(description[2])}${hex(description[3])}`
}

const isEnvelope = (data: unknown, udid: string): data is SimulatorStreamEnvelope =>
  Boolean(data) &&
  typeof data === 'object' &&
  (data as SimulatorStreamEnvelope).type === SIMULATOR_STREAM_MESSAGE &&
  (data as SimulatorStreamEnvelope).udid === udid

/**
 * Streams a device's screen into a canvas: H.264 from the simulator host, decoded with
 * WebCodecs. Returns the stream's state, the screen's pixel size, and `send` for the user's
 * touches and keys, which go back over the same port.
 */
export function useSimulatorStream(
  udid: string | null,
  canvas: React.RefObject<HTMLCanvasElement | null>,
  /** Bumping it opens the stream again. */
  generation: number
): {
  state: StreamState
  size: { width: number; height: number } | null
  send: (message: SimulatorInputMessage) => void
} {
  const [state, setState] = useState<StreamState>('connecting')
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const port = useRef<MessagePort | null>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new generation reopens the stream.
  useEffect(() => {
    if (!udid) return
    setState(typeof VideoDecoder === 'undefined' ? 'unsupported' : 'connecting')
    setSize(null)
    if (typeof VideoDecoder === 'undefined') return
    let decoder: VideoDecoder | null = null
    let needKey = true
    let stamp = 0
    let disposed = false
    const draw = (frame: VideoFrame) => {
      const target = canvas.current
      const context = target?.getContext('2d')
      if (target && context) {
        if (target.width !== frame.displayWidth) target.width = frame.displayWidth
        if (target.height !== frame.displayHeight) target.height = frame.displayHeight
        context.drawImage(frame, 0, 0)
      }
      frame.close()
    }
    const close = () => {
      if (decoder && decoder.state !== 'closed') decoder.close()
      decoder = null
    }
    const configure = (description: Uint8Array) => {
      close()
      decoder = new VideoDecoder({
        output: (frame) => {
          draw(frame)
          setState('live')
        },
        error: () => {
          // A broken decoder waits for the next description and keyframe.
          decoder = null
          needKey = true
        }
      })
      decoder.configure({ codec: avcCodec(description), description, optimizeForLatency: true })
      needKey = true
    }
    const onStream = (message: SimulatorStreamMessage) => {
      if (message.type === 'size') setSize({ width: message.width, height: message.height })
      else if (message.type === 'ended') setState('ended')
      else if (message.description) configure(message.data)
      else if (decoder && decoder.state === 'configured') {
        if (needKey && !message.keyframe) return
        needKey = false
        stamp += 16_667
        decoder.decode(
          new EncodedVideoChunk({
            type: message.keyframe ? 'key' : 'delta',
            timestamp: stamp,
            data: message.data
          })
        )
      }
    }
    const onWindow = (event: MessageEvent) => {
      if (event.source !== window || !isEnvelope(event.data, udid)) return
      const received = event.ports[0]
      if (!received || disposed) return received?.close()
      port.current?.close()
      port.current = received
      received.onmessage = (e) => onStream(e.data as SimulatorStreamMessage)
      received.start()
    }
    window.addEventListener('message', onWindow)
    void window.owlto.simulator.openStream(udid).then((reply) => {
      if (!reply.ok && !disposed) setState('ended')
    })
    return () => {
      disposed = true
      window.removeEventListener('message', onWindow)
      port.current?.close()
      port.current = null
      close()
    }
  }, [udid, canvas, generation])

  return {
    state,
    size,
    send: (message) => port.current?.postMessage(message)
  }
}
