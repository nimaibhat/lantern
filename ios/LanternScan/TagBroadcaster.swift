import CoreBluetooth
import UIKit

final class TagBroadcaster: NSObject, ObservableObject, CBPeripheralManagerDelegate {
    static let serviceUUID = CBUUID(string: "4C414E54-4552-4E00-A000-000000000001")
    @Published var status = "idle"
    @Published var isAdvertising = false
    private var manager: CBPeripheralManager?

    func start() {
        UIApplication.shared.isIdleTimerDisabled = true
        manager = CBPeripheralManager(delegate: self, queue: nil)
    }

    func stop() {
        manager?.stopAdvertising()
        isAdvertising = false
        UIApplication.shared.isIdleTimerDisabled = false
    }

    func peripheralManagerDidUpdateState(_ p: CBPeripheralManager) {
        status = "bluetooth state \(p.state.rawValue)"
        guard p.state == .poweredOn else { return }
        p.startAdvertising([
            CBAdvertisementDataServiceUUIDsKey: [Self.serviceUUID],
            CBAdvertisementDataLocalNameKey: "LanternTag"
        ])
    }

    func peripheralManagerDidStartAdvertising(_ p: CBPeripheralManager, error: Error?) {
        isAdvertising = (error == nil)
        status = error.map { "error: \($0.localizedDescription)" } ?? "advertising"
    }
}
