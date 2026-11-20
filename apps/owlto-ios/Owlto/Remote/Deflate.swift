import Compression
import Foundation

/// Raw deflate (RFC 1951), as Node's `deflateRawSync` / `inflateRawSync` write and read it.
/// Apple's `COMPRESSION_ZLIB` is raw deflate with no zlib header, so the two interoperate.
enum Deflate {
  /// The most an inflated message may grow to, as `MAX_INFLATED_BYTES` in `handshake.ts`.
  static let maxInflatedBytes = 64 * 1024 * 1024

  static func compress(_ data: Data) throws -> Data {
    try run(COMPRESSION_STREAM_ENCODE, data, limit: Int.max)
  }

  static func inflate(_ data: Data, limit: Int = maxInflatedBytes) throws -> Data {
    try run(COMPRESSION_STREAM_DECODE, data, limit: limit)
  }

  private static func run(_ operation: compression_stream_operation, _ input: Data, limit: Int) throws -> Data {
    let stream = UnsafeMutablePointer<compression_stream>.allocate(capacity: 1)
    defer { stream.deallocate() }
    guard compression_stream_init(stream, operation, COMPRESSION_ZLIB) == COMPRESSION_STATUS_OK else {
      throw RemoteError.protocolViolation("deflate init")
    }
    defer { compression_stream_destroy(stream) }
    let bufferSize = 64 * 1024
    let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: bufferSize)
    defer { buffer.deallocate() }
    var output = Data()
    return try input.withUnsafeBytes { (raw: UnsafeRawBufferPointer) -> Data in
      stream.pointee.src_ptr = raw.bindMemory(to: UInt8.self).baseAddress ?? UnsafePointer(buffer)
      stream.pointee.src_size = input.count
      while true {
        stream.pointee.dst_ptr = buffer
        stream.pointee.dst_size = bufferSize
        let status = compression_stream_process(stream, Int32(COMPRESSION_STREAM_FINALIZE.rawValue))
        let produced = bufferSize - stream.pointee.dst_size
        if produced > 0 {
          if output.count + produced > limit { throw RemoteError.protocolViolation("inflated message too large") }
          output.append(buffer, count: produced)
        }
        switch status {
        case COMPRESSION_STATUS_END: return output
        case COMPRESSION_STATUS_OK:
          // Input used up with nothing more coming out: a truncated stream.
          if produced == 0 && stream.pointee.src_size == 0 { throw RemoteError.protocolViolation("deflate truncated") }
        default: throw RemoteError.protocolViolation("deflate")
        }
      }
    }
  }
}
