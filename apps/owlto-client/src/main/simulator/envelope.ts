/**
 * serve-sim's addon hands each AVCC frame over wrapped for its own wire format
 * (StreamFormat.swift `AVCCEnvelope`): a 4-byte big-endian length of tag plus payload, a tag
 * byte, then the payload, an avcC record or length-prefixed H.264 samples.
 */
const HEADER = 5
const TAGS = { 1: 'description', 2: 'keyframe', 3: 'delta' } as const

export type AvccChunk = { kind: (typeof TAGS)[keyof typeof TAGS]; data: Uint8Array }

/** The chunk inside one envelope, or null for anything else, such as a JPEG seed. */
export function unwrapAvcc(envelope: Uint8Array): AvccChunk | null {
  if (envelope.byteLength <= HEADER) return null
  const length = new DataView(envelope.buffer, envelope.byteOffset, 4).getUint32(0)
  if (length !== envelope.byteLength - 4) return null
  const kind = TAGS[envelope[4] as keyof typeof TAGS]
  return kind ? { kind, data: envelope.slice(HEADER) } : null
}
