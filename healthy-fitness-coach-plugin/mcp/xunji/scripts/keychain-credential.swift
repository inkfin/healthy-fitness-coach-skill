#!/usr/bin/swift
import AppKit
import Security

// Keep these identifiers aligned with src/credentials.js. Never print the key.
let service = "HealthyFitnessCoach.Xunji"
let account = "xunji-api-key"
let query: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: service,
    kSecAttrAccount as String: account
]
func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}
let action = CommandLine.arguments.dropFirst().first ?? "set"
guard action == "set" || action == "remove" else { fail("Use set or remove.") }
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
app.activate(ignoringOtherApps: true)
let alert = NSAlert()
alert.messageText = action == "set" ? "连接训记" : "移除训记凭证"
alert.informativeText = action == "set"
    ? "输入训记 API Key，仅保存在本机登录钥匙串。不会发送到聊天或写入项目文件。"
    : "仅删除 HealthyFitnessCoach 保存的训记 API Key，不删除训练记录或缓存。"
alert.addButton(withTitle: action == "set" ? "保存到钥匙串" : "删除凭证")
alert.addButton(withTitle: "取消")
let input = NSSecureTextField(frame: NSRect(x: 0, y: 0, width: 360, height: 24))
if action == "set" {
    alert.accessoryView = input
    alert.window.initialFirstResponder = input
}
guard alert.runModal() == .alertFirstButtonReturn else { exit(2) }
if action == "remove" {
    let status = SecItemDelete(query as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else {
        fail("Could not remove credential (Keychain status \(status)).")
    }
    print("Xunji credential removed.")
} else {
    let key = input.stringValue
    input.stringValue = ""
    guard !key.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
          !key.contains("\n"), !key.contains("\r"), key.utf8.count <= 16384 else {
        fail("Credential must be non-empty and single-line (maximum 16384 bytes).")
    }
    let attributes: [String: Any] = [kSecValueData as String: Data(key.utf8)]
    var status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
    if status == errSecItemNotFound {
        var item = query
        item[kSecValueData as String] = Data(key.utf8)
        status = SecItemAdd(item as CFDictionary, nil)
    }
    guard status == errSecSuccess else { fail("Could not save credential (Keychain status \(status)).") }
    print("Xunji credential saved to macOS Keychain.")
}
