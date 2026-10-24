import ARKit
import CoreImage
import RoomPlan
import SwiftUI
import UIKit

// SwiftUI wrapper around Apple's RoomCaptureView.
// onFinish gets the scanned room (nil if cancelled) and any photos taken during the scan.
struct RoomScanView: UIViewControllerRepresentable {
    let arSession: ARSession
    let roomName: String
    let onFinish: (CapturedRoom?, [Data]) -> Void

    func makeUIViewController(context: Context) -> RoomScanViewController {
        RoomScanViewController(arSession: arSession, roomName: roomName, onFinish: onFinish)
    }

    func updateUIViewController(_ controller: RoomScanViewController, context: Context) {}
}

// RoomPlan calls the view delegate on the main thread; @preconcurrency tells Swift 6 to trust that.
final class RoomScanViewController: UIViewController, @preconcurrency RoomCaptureViewDelegate, RoomCaptureSessionDelegate {
    private let arSession: ARSession
    private let roomName: String
    private let onFinish: (CapturedRoom?, [Data]) -> Void

    private var captureView: RoomCaptureView!
    private var finalRoom: CapturedRoom?
    private var photos: [Data] = []
    private let ciContext = CIContext()

    private let doneButton = UIButton(configuration: .filled())
    private let photoButton = UIButton(configuration: .filled())
    private let cancelButton = UIButton(configuration: .filled())
    private let hint = UILabel()

    // Same palette and type as the website (see Theme.swift).
    private static let amber = UIColor(Theme.glow)
    private static let walnut = UIColor(red: 26 / 255, green: 23 / 255, blue: 20 / 255, alpha: 0.82)
    private static let stone = UIColor(red: 235 / 255, green: 230 / 255, blue: 222 / 255, alpha: 1)

    init(arSession: ARSession, roomName: String, onFinish: @escaping (CapturedRoom?, [Data]) -> Void) {
        self.arSession = arSession
        self.roomName = roomName
        self.onFinish = onFinish
        super.init(nibName: nil, bundle: nil)
    }

    // RoomCaptureViewDelegate requires NSCoding; this controller is never restored from a storyboard.
    required init?(coder: NSCoder) { fatalError("Not used") }

    override func viewDidLoad() {
        super.viewDidLoad()
        // Sharing one ARSession across rooms keeps them in the same coordinate system (iOS 17+).
        captureView = RoomCaptureView(frame: view.bounds, arSession: arSession)
        captureView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        captureView.delegate = self
        captureView.captureSession.delegate = self
        view.addSubview(captureView)
        addButtons()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        captureView.captureSession.run(configuration: RoomCaptureSession.Configuration())
    }

    // MARK: Buttons

    private func style(_ button: UIButton, title: String?, image: String? = nil, fill: UIColor, text: UIColor) {
        var c = UIButton.Configuration.filled()
        c.baseBackgroundColor = fill
        c.baseForegroundColor = text
        c.cornerStyle = .capsule
        c.image = image.map { UIImage(systemName: $0, withConfiguration: UIImage.SymbolConfiguration(pointSize: 20, weight: .semibold)) } ?? nil
        c.imagePadding = 6
        c.contentInsets = NSDirectionalEdgeInsets(top: 14, leading: 20, bottom: 14, trailing: 20)
        if let title {
            var attrs = AttributeContainer()
            attrs.font = UIFont(name: "Geist-Medium", size: 16) ?? .systemFont(ofSize: 16, weight: .medium)
            c.attributedTitle = AttributedString(title, attributes: attrs)
        }
        button.configuration = c
    }

    private func setTitle(_ button: UIButton, _ title: String) {
        guard var c = button.configuration else { return }
        var attrs = AttributeContainer()
        attrs.font = UIFont(name: "Geist-Medium", size: 16) ?? .systemFont(ofSize: 16, weight: .medium)
        c.attributedTitle = AttributedString(title, attributes: attrs)
        button.configuration = c
    }

    private func addButtons() {
        style(cancelButton, title: "Cancel", fill: Self.walnut, text: Self.stone)
        cancelButton.addAction(UIAction { [weak self] _ in self?.cancel() }, for: .touchUpInside)

        // The camera is the round amber button in the middle; its title shows how many photos are taken.
        style(photoButton, title: nil, image: "camera.fill", fill: Self.amber, text: Self.walnut)
        photoButton.configuration?.contentInsets = NSDirectionalEdgeInsets(top: 20, leading: 20, bottom: 20, trailing: 20)
        photoButton.layer.shadowColor = Self.amber.cgColor
        photoButton.layer.shadowOpacity = 0.6
        photoButton.layer.shadowRadius = 16
        photoButton.layer.shadowOffset = .zero
        photoButton.accessibilityLabel = "Take a photo for the hazard check"
        photoButton.addAction(UIAction { [weak self] _ in self?.takePhoto() }, for: .touchUpInside)

        style(doneButton, title: "Done", fill: Self.stone, text: Self.walnut)
        doneButton.addAction(UIAction { [weak self] _ in self?.doneTapped() }, for: .touchUpInside)

        let bar = UIStackView(arrangedSubviews: [cancelButton, photoButton, doneButton])
        bar.axis = .horizontal
        bar.alignment = .center
        bar.distribution = .equalSpacing
        bar.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(bar)

        // A small card at the top: what to do, and which room this is.
        hint.text = "\(roomName.uppercased())  ·  Walk slowly along the walls. Tap the camera 2 to 4 times."
        hint.numberOfLines = 0
        hint.textAlignment = .center
        hint.textColor = Self.stone
        hint.font = UIFont(name: "Geist-Regular", size: 14) ?? .systemFont(ofSize: 14)
        let card = UIView()
        card.backgroundColor = Self.walnut
        card.layer.cornerRadius = 16
        card.translatesAutoresizingMaskIntoConstraints = false
        hint.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(hint)
        view.addSubview(card)

        NSLayoutConstraint.activate([
            bar.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 20),
            bar.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -20),
            bar.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -16),
            card.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 12),
            card.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 20),
            card.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -20),
            hint.topAnchor.constraint(equalTo: card.topAnchor, constant: 12),
            hint.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -12),
            hint.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 16),
            hint.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -16),
        ])
    }

    private func doneTapped() {
        if let room = finalRoom {
            onFinish(room, photos) // second tap: save the processed room
            return
        }
        // First tap: stop scanning but keep the AR session running for the next room.
        captureView.captureSession.stop(pauseARSession: false)
        doneButton.isEnabled = false
        setTitle(doneButton, "Processing...")
        photoButton.isHidden = true
        hint.text = "Building \(roomName)..."
    }

    private func cancel() {
        captureView.captureSession.stop(pauseARSession: false)
        onFinish(nil, [])
    }

    // Grabs the current camera frame from the AR session. Opening the normal camera would interrupt the scan.
    private func takePhoto() {
        guard photos.count < 6, let frame = arSession.currentFrame else { return }
        let image = CIImage(cvPixelBuffer: frame.capturedImage).oriented(.right)
        guard let cgImage = ciContext.createCGImage(image, from: image.extent),
              let jpeg = UIImage(cgImage: cgImage).jpegData(compressionQuality: 0.7) else { return }
        photos.append(jpeg)
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        setTitle(photoButton, "\(photos.count)")
    }

    // MARK: RoomCaptureViewDelegate

    func captureView(shouldPresent roomDataForProcessing: CapturedRoomData, error: Error?) -> Bool {
        true // let RoomPlan show its finished 3D model
    }

    func captureView(didPresent processedResult: CapturedRoom, error: Error?) {
        if let error {
            setTitle(doneButton, "Scan failed")
            print("RoomPlan error:", error.localizedDescription)
            return
        }
        finalRoom = processedResult
        doneButton.isEnabled = true
        style(doneButton, title: "Save \(roomName)", fill: Self.amber, text: Self.walnut)
        hint.text = "Check the model, then save \(roomName)."
    }
}
