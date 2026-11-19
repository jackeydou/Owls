import SwiftUI

/// Who is speaking: the Router itself, the agent running a worker, the user, or Dreaming.
enum OwlSpeaker: Equatable {
  case router, claudeCode, codex, cursor, user, dreaming

  init(_ provider: AgentProvider?) {
    switch provider {
    case .claudeCode: self = .claudeCode
    case .codex: self = .codex
    case .cursor: self = .cursor
    default: self = .router
    }
  }
}

/// The owls from `apps/owlto-client/resources/owl-avatars`, drawn from the same SVG paths.
/// A working owl types on a laptop: it bobs, reads left to right, taps its wings, and blinks,
/// as `owl-avatars/working/*.svg` animate. Motion stops when Reduce Motion is on.
struct OwlAvatar: View {
  var speaker: OwlSpeaker
  var working = false
  var size: CGFloat = 28
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(\.skin) private var skin

  private var animated: Bool { (working && speaker != .user && speaker != .dreaming) || speaker == .dreaming }

  var body: some View {
    TimelineView(.animation(minimumInterval: 1 / 30, paused: !animated || reduceMotion)) { timeline in
      let time = reduceMotion ? 0 : timeline.date.timeIntervalSinceReferenceDate
      Canvas { context, canvasSize in
        OwlDrawing(speaker: speaker, working: working && speaker != .user && speaker != .dreaming, time: time)
          .draw(in: &context, size: canvasSize)
      }
    }
    .frame(width: size, height: size)
    .overlay {
      // Doodle rings every owl in ink, as the website's avatars are.
      if skin == .doodle {
        Circle().strokeBorder(Theme.border, lineWidth: size < 26 ? 1.5 : 2)
      }
    }
    .accessibilityHidden(true)
  }
}

private struct OwlDrawing {
  let speaker: OwlSpeaker
  let working: Bool
  let time: TimeInterval

  private static let ink = Color(UIColor(hex: 0x151515))
  private static let shapes = OwlShapes.shared

  private var background: Color {
    switch speaker {
    case .router: return Color(UIColor(hex: 0x8E96A3))
    case .claudeCode: return Color(UIColor(hex: 0xE8785A))
    case .codex: return Color(UIColor(hex: 0x2A2D33))
    case .cursor: return Color(UIColor(hex: 0x7C8CFF))
    case .user: return Color(UIColor(hex: 0xF2B544))
    case .dreaming: return Color(UIColor(hex: 0x1F2A44))
    }
  }

  private var beak: Color {
    switch speaker {
    case .router, .dreaming: return Color(UIColor(hex: 0xFFB000))
    case .claudeCode: return Color(UIColor(hex: 0xE8785A))
    case .codex: return Self.ink
    case .cursor: return Color(UIColor(hex: 0x7C8CFF))
    case .user: return Color(UIColor(hex: 0xF2B544))
    }
  }

  private func phase(_ period: Double, offset: Double = 0) -> Double {
    let value = (time + offset).truncatingRemainder(dividingBy: period) / period
    return value < 0 ? value + 1 : value
  }

  /// Ease-in-out between 0 and 1 and back over one period, like the SVGs' alternate keyframes.
  private func wave(_ period: Double, offset: Double = 0) -> Double {
    (1 - cos(2 * .pi * phase(period, offset: offset))) / 2
  }

  func draw(in context: inout GraphicsContext, size: CGSize) {
    let scale = min(size.width, size.height) / 512
    context.scaleBy(x: scale, y: scale)
    context.clip(to: Path(ellipseIn: CGRect(x: 0, y: 0, width: 512, height: 512)))
    context.fill(Path(CGRect(x: 0, y: 0, width: 512, height: 512)), with: .color(background))
    if speaker == .dreaming {
      drawDreaming(&context)
      return
    }
    var body = context
    if working { body.translateBy(x: 0, y: 10 * wave(0.72)) }
    body.translateBy(x: 256, y: 304)
    body.scaleBy(x: 1.16, y: 1.16)
    body.translateBy(x: -256, y: -270)
    drawBody(&body)
    if working { drawLaptop(&context) }
  }

  private func stroke(_ context: inout GraphicsContext, _ path: Path, width: CGFloat, color: Color = ink) {
    context.stroke(path, with: .color(color), style: StrokeStyle(lineWidth: width, lineCap: .round, lineJoin: .round))
  }

  private func filled(_ context: inout GraphicsContext, _ path: Path, fill: Color, width: CGFloat) {
    context.fill(path, with: .color(fill))
    stroke(&context, path, width: width)
  }

  private func drawBody(_ context: inout GraphicsContext) {
    let s = Self.shapes
    switch speaker {
    case .router:
      filled(&context, s.roundBody, fill: Color(UIColor(hex: 0xE6E8EC)), width: 20)
    case .codex:
      filled(&context, s.roundBody, fill: .white, width: 20)
    case .claudeCode:
      filled(&context, s.earBody, fill: .white, width: 20)
      let tuft = Color(UIColor(hex: 0xE8785A))
      context.fill(s.earTuft, with: .color(tuft))
      context.stroke(s.earTuft, with: .color(tuft), style: StrokeStyle(lineWidth: 8, lineJoin: .round))
      var mirrored = context
      mirrored.translateBy(x: 512, y: 0)
      mirrored.scaleBy(x: -1, y: 1)
      mirrored.fill(s.earTuft, with: .color(tuft))
      mirrored.stroke(s.earTuft, with: .color(tuft), style: StrokeStyle(lineWidth: 8, lineJoin: .round))
    case .cursor, .user:
      filled(&context, s.catBody, fill: .white, width: 20)
    case .dreaming:
      break
    }
    stroke(&context, s.wings, width: 16)
    switch speaker {
    case .claudeCode, .user:
      stroke(&context, s.belly, width: 13)
    case .codex:
      stroke(&context, s.belly, width: 13)
      stroke(&context, s.codexBelly, width: 13)
      stroke(&context, s.codexHead, width: 11)
    case .cursor:
      filled(&context, s.cursorArrow, fill: Self.ink, width: 10)
    default:
      break
    }
    if speaker == .user {
      stroke(&context, s.glassesArms, width: 14)
      filled(&context, s.glasses, fill: Self.ink, width: 16)
      stroke(&context, s.glassesBridge, width: 14)
      stroke(&context, s.glassesShine, width: 10, color: .white.opacity(0.9))
      filled(&context, s.userBeak, fill: beak, width: 12)
      return
    }
    drawEyes(&context)
    filled(&context, s.beak, fill: beak, width: 12)
    if speaker == .router {
      filled(&context, s.bowtie, fill: .white, width: 13)
      context.fill(Path(ellipseIn: CGRect(x: 247, y: 403, width: 18, height: 18)), with: .color(Self.ink))
    }
  }

  private func drawEyes(_ context: inout GraphicsContext) {
    let blink: CGFloat
    if working {
      let p = phase(3.6)
      blink = p > 0.46 && p < 0.52 ? CGFloat(0.08 + 0.92 * abs(p - 0.49) / 0.03) : 1
    } else {
      blink = 1
    }
    let pupil: CGSize
    if working {
      let p = phase(1.32)
      pupil = CGSize(width: p < 1 / 3 ? -18 : (p < 2 / 3 ? 0 : 18), height: 30)
    } else {
      pupil = .zero
    }
    let radius: CGFloat = speaker == .router ? 20 : 24
    for (center, pupilX) in [(CGPoint(x: 180, y: 270), CGFloat(188)), (CGPoint(x: 332, y: 270), CGFloat(324))] {
      var eye = context
      eye.translateBy(x: center.x, y: center.y)
      eye.scaleBy(x: 1, y: blink)
      eye.translateBy(x: -center.x, y: -center.y)
      let white = Path(ellipseIn: CGRect(x: center.x - 72, y: center.y - 72, width: 144, height: 144))
      filled(&eye, white, fill: .white, width: 18)
      if speaker == .router {
        eye.stroke(Path(ellipseIn: CGRect(x: center.x - 43, y: center.y - 43, width: 86, height: 86)), with: .color(Color(UIColor(hex: 0xAEB5C0))), lineWidth: 7)
      }
      eye.fill(Path(ellipseIn: CGRect(x: pupilX + pupil.width - radius, y: 276 + pupil.height - radius, width: radius * 2, height: radius * 2)), with: .color(Self.ink))
    }
  }

  private func drawLaptop(_ context: inout GraphicsContext) {
    let tap = 22 * wave(0.36)
    let tapOther = 22 * wave(0.36, offset: 0.18)
    filled(&context, Path(ellipseIn: CGRect(x: 160, y: 378 - tap, width: 60, height: 40)), fill: .white, width: 14)
    filled(&context, Path(ellipseIn: CGRect(x: 292, y: 378 - tapOther, width: 60, height: 40)), fill: .white, width: 14)
    filled(&context, Path(roundedRect: CGRect(x: 128, y: 404, width: 256, height: 160), cornerRadius: 20), fill: Color(UIColor(hex: 0x3A3E46)), width: 16)
    let glow = 0.35 + 0.65 * wave(1.32)
    context.fill(Path(ellipseIn: CGRect(x: 240, y: 454, width: 32, height: 32)), with: .color(Color(UIColor(hex: 0x9FE3A8)).opacity(glow)))
  }

  private func drawDreaming(_ context: inout GraphicsContext) {
    let s = Self.shapes
    let star = Color(UIColor(hex: 0xFFD66B))
    context.fill(s.starBig, with: .color(star.opacity(0.25 + 0.75 * wave(2.4))))
    context.fill(s.starSmall, with: .color(star.opacity(0.25 + 0.75 * wave(2.4, offset: 1.2))))
    var body = context
    let breathe = wave(4)
    body.translateBy(x: 212, y: 512)
    body.scaleBy(x: 1 + 0.025 * breathe, y: 1 - 0.035 * breathe)
    body.translateBy(x: -212, y: -512)
    body.translateBy(x: 212, y: 368)
    body.rotate(by: .degrees(-6))
    body.scaleBy(x: 0.92, y: 0.92)
    body.translateBy(x: -256, y: -270)
    filled(&body, s.roundBody, fill: Color(UIColor(hex: 0xCFC8F2)), width: 20)
    stroke(&body, s.wings, width: 16)
    stroke(&body, s.sleepBelly, width: 13)
    for center in [CGPoint(x: 180, y: 270), CGPoint(x: 332, y: 270)] {
      filled(&body, Path(ellipseIn: CGRect(x: center.x - 72, y: center.y - 72, width: 144, height: 144)), fill: .white, width: 18)
    }
    stroke(&body, s.closedEyes, width: 18)
    filled(&body, s.userBeak, fill: Color(UIColor(hex: 0xFFB000)), width: 12)
    for (index, z) in s.sleepZs.enumerated() {
      let p = phase(3.6, offset: -1.2 * Double(index))
      let opacity = p < 0.2 ? p / 0.2 : (p > 0.75 ? (1 - p) / 0.25 : 1)
      var drift = context
      drift.translateBy(x: -70 * (1 - p), y: 80 * (1 - p))
      drift.opacity = opacity
      drift.stroke(z.path, with: .color(.white), style: StrokeStyle(lineWidth: z.width, lineCap: .round, lineJoin: .round))
    }
  }
}

/// The owl paths, parsed once from the SVG path data the desktop's avatars use.
private final class OwlShapes {
  static let shared = OwlShapes()

  let roundBody = parseSVGPath("M72 620 L72 290 C72 160 156 100 256 100 C356 100 440 160 440 290 L440 620 Z")
  let earBody = parseSVGPath("M72 620 L72 300 C72 220 78 166 94 116 Q100 96 118 106 C162 128 208 138 256 138 C304 138 350 128 394 106 Q412 96 418 116 C434 166 440 220 440 300 L440 620 Z")
  let earTuft = parseSVGPath("M102 160 C104 144 108 130 114 118 C130 126 146 132 162 138 Z")
  let catBody = parseSVGPath("M72 620 L72 168 Q72 150 86 140 L138 104 Q150 96 160 106 L184 132 Q190 138 200 138 L312 138 Q322 138 328 132 L352 106 Q362 96 374 104 L426 140 Q440 150 440 168 L440 620 Z")
  let wings = parseSVGPath("M72 404 C112 424 134 476 134 620 M440 404 C400 424 378 476 378 620")
  let belly = parseSVGPath("M203 428 q15 16 30 0 M279 428 q15 16 30 0 M241 468 q15 16 30 0")
  let sleepBelly = parseSVGPath("M203 440 q15 16 30 0 M279 440 q15 16 30 0 M241 480 q15 16 30 0")
  let codexBelly = parseSVGPath("M165 468 q15 16 30 0 M317 468 q15 16 30 0")
  let codexHead = parseSVGPath("M213 150 q9 9 18 0 M247 134 q9 9 18 0 M281 150 q9 9 18 0")
  let cursorArrow = parseSVGPath("M240 382 L240 440 L253 428 L263 449 L276 443 L266 422 L285 421 Z")
  let beak = parseSVGPath("M234 320 Q256 308 278 320 Q274 354 256 366 Q238 354 234 320 Z")
  let userBeak = parseSVGPath("M234 330 Q256 318 278 330 Q274 364 256 376 Q238 364 234 330 Z")
  let bowtie = parseSVGPath("M256 412 L214 388 L214 436 Z M256 412 L298 388 L298 436 Z")
  let glassesArms = parseSVGPath("M78 236 L108 230 M404 230 L434 236")
  let glasses = parseSVGPath("M104 226 L238 226 Q246 226 245 236 Q238 300 176 304 Q118 304 106 248 Q102 226 104 226 Z M408 226 L274 226 Q266 226 267 236 Q274 300 336 304 Q394 304 406 248 Q410 226 408 226 Z")
  let glassesBridge = parseSVGPath("M238 236 Q256 222 274 236")
  let glassesShine = parseSVGPath("M134 246 L162 246 M134 262 L150 262 M298 246 L326 246 M298 262 L314 262")
  let closedEyes = parseSVGPath("M136 266 Q180 312 224 266 M288 266 Q332 312 376 266")
  let starBig = parseSVGPath("M92 92 L102 122 L132 132 L102 142 L92 172 L82 142 L52 132 L82 122 Z")
  let starSmall = parseSVGPath("M178 40 L184 58 L202 64 L184 70 L178 88 L172 70 L154 64 L172 58 Z")
  let sleepZs: [(path: Path, width: CGFloat)] = [
    (parseSVGPath("M372 206 H408 L372 242 H408"), 20),
    (parseSVGPath("M402 126 H450 L402 174 H450"), 24),
    (parseSVGPath("M326 50 H386 L326 110 H386"), 28)
  ]
}

/// Parses the SVG path commands the owls use: M, L, H, V, C, Q, Z, and their relative forms.
func parseSVGPath(_ data: String) -> Path {
  var path = Path()
  var tokens: [String] = []
  var number = ""
  for character in data {
    if character.isLetter {
      if !number.isEmpty { tokens.append(number); number = "" }
      tokens.append(String(character))
    } else if character == " " || character == "," {
      if !number.isEmpty { tokens.append(number); number = "" }
    } else if character == "-" && !number.isEmpty {
      tokens.append(number)
      number = "-"
    } else {
      number.append(character)
    }
  }
  if !number.isEmpty { tokens.append(number) }

  var index = 0
  var command: Character = "M"
  var current = CGPoint.zero
  var start = CGPoint.zero
  func value() -> CGFloat {
    defer { index += 1 }
    return CGFloat(Double(tokens[index]) ?? 0)
  }
  while index < tokens.count {
    if let first = tokens[index].first, first.isLetter {
      command = first
      index += 1
      if command == "Z" || command == "z" {
        path.closeSubpath()
        current = start
        continue
      }
    }
    let relative = command.isLowercase
    let base = relative ? current : .zero
    switch command.uppercased() {
    case "M":
      current = CGPoint(x: base.x + value(), y: base.y + value())
      start = current
      path.move(to: current)
      command = relative ? "l" : "L"
    case "L":
      current = CGPoint(x: base.x + value(), y: base.y + value())
      path.addLine(to: current)
    case "H":
      current = CGPoint(x: (relative ? current.x : 0) + value(), y: current.y)
      path.addLine(to: current)
    case "V":
      current = CGPoint(x: current.x, y: (relative ? current.y : 0) + value())
      path.addLine(to: current)
    case "C":
      let c1 = CGPoint(x: base.x + value(), y: base.y + value())
      let c2 = CGPoint(x: base.x + value(), y: base.y + value())
      current = CGPoint(x: base.x + value(), y: base.y + value())
      path.addCurve(to: current, control1: c1, control2: c2)
    case "Q":
      let control = CGPoint(x: base.x + value(), y: base.y + value())
      current = CGPoint(x: base.x + value(), y: base.y + value())
      path.addQuadCurve(to: current, control: control)
    default:
      index += 1
    }
  }
  return path
}

#Preview {
  VStack(spacing: 16) {
    HStack {
      OwlAvatar(speaker: .router, size: 64)
      OwlAvatar(speaker: .claudeCode, size: 64)
      OwlAvatar(speaker: .codex, size: 64)
      OwlAvatar(speaker: .cursor, size: 64)
    }
    HStack {
      OwlAvatar(speaker: .router, working: true, size: 64)
      OwlAvatar(speaker: .claudeCode, working: true, size: 64)
      OwlAvatar(speaker: .user, size: 64)
      OwlAvatar(speaker: .dreaming, size: 64)
    }
  }
}
