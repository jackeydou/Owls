import AVFoundation
import SwiftUI

/// The camera, looking for the pairing QR code a Mac shows in Settings → Devices. Calls
/// `onCode` once with the first QR code's text.
struct QRScannerView: View {
  var onCode: (String) -> Void
  @Environment(\.dismiss) private var dismiss
  @State private var denied = false

  var body: some View {
    ZStack {
      Color.black.ignoresSafeArea()
      if denied {
        VStack(spacing: 12) {
          Image(systemName: "camera.fill").font(.largeTitle)
          Text("Owlto may not use the camera. Allow it in Settings, or type the code instead.")
            .multilineTextAlignment(.center)
          Button("Open Settings") {
            if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
          }
          .buttonStyle(.borderedProminent)
        }
        .foregroundStyle(.white)
        .padding(32)
      } else {
        CameraPreview(onCode: { code in
          onCode(code)
          dismiss()
        })
        .ignoresSafeArea()
        RoundedRectangle(cornerRadius: 20, style: .continuous)
          .stroke(.white.opacity(0.9), lineWidth: 3)
          .frame(width: 240, height: 240)
          .accessibilityHidden(true)
        VStack {
          Spacer()
          Text("Point the camera at the QR code in Owlto → Settings → Devices on your Mac.")
            .font(.footnote)
            .foregroundStyle(.white)
            .multilineTextAlignment(.center)
            .padding(16)
            .background(.black.opacity(0.5), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .padding(24)
        }
      }
    }
    .toolbar {
      ToolbarItem(placement: .cancellationAction) {
        Button("Cancel") { dismiss() }
      }
    }
    .task {
      switch AVCaptureDevice.authorizationStatus(for: .video) {
      case .authorized: denied = false
      case .notDetermined: denied = !(await AVCaptureDevice.requestAccess(for: .video))
      default: denied = true
      }
    }
  }
}

private struct CameraPreview: UIViewRepresentable {
  var onCode: (String) -> Void

  func makeCoordinator() -> Coordinator { Coordinator(onCode: onCode) }

  func makeUIView(context: Context) -> PreviewView {
    let view = PreviewView()
    let session = context.coordinator.session
    view.previewLayer.session = session
    view.previewLayer.videoGravity = .resizeAspectFill
    guard let device = AVCaptureDevice.default(for: .video),
          let input = try? AVCaptureDeviceInput(device: device),
          session.canAddInput(input)
    else { return view }
    session.addInput(input)
    let output = AVCaptureMetadataOutput()
    guard session.canAddOutput(output) else { return view }
    session.addOutput(output)
    output.setMetadataObjectsDelegate(context.coordinator, queue: .main)
    output.metadataObjectTypes = [.qr]
    DispatchQueue.global(qos: .userInitiated).async { session.startRunning() }
    return view
  }

  func updateUIView(_ uiView: PreviewView, context: Context) {}

  static func dismantleUIView(_ uiView: PreviewView, coordinator: Coordinator) {
    let session = coordinator.session
    DispatchQueue.global(qos: .userInitiated).async { session.stopRunning() }
  }

  final class Coordinator: NSObject, AVCaptureMetadataOutputObjectsDelegate {
    let session = AVCaptureSession()
    private let onCode: (String) -> Void
    private var done = false

    init(onCode: @escaping (String) -> Void) {
      self.onCode = onCode
    }

    func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject], from connection: AVCaptureConnection) {
      guard !done, let code = metadataObjects.compactMap({ ($0 as? AVMetadataMachineReadableCodeObject)?.stringValue }).first else { return }
      done = true
      UINotificationFeedbackGenerator().notificationOccurred(.success)
      onCode(code)
    }
  }

  final class PreviewView: UIView {
    override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
    var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
  }
}
