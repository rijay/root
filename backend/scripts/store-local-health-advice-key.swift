import Darwin
import Foundation
import Security

let account = "myroot-v070-local-dev"
let service = "com.myroot.v070.cloudbase-ai"
let expectedAudience = "myroot-prod-d5gl3gzg7115f149a"

func fail(_ message: String, code: Int32 = 1) -> Never {
  FileHandle.standardError.write(Data("\(message)\n".utf8))
  exit(code)
}

func readSecret() -> String {
  let interactive = isatty(STDIN_FILENO) == 1
  var original = termios()
  var changed = false
  if interactive && tcgetattr(STDIN_FILENO, &original) == 0 {
    var hidden = original
    hidden.c_lflag &= ~tcflag_t(ECHO)
    changed = tcsetattr(STDIN_FILENO, TCSAFLUSH, &hidden) == 0
    FileHandle.standardError.write(Data("CloudBase API Key: ".utf8))
  }
  let value = readLine(strippingNewline: true) ?? ""
  if changed {
    _ = tcsetattr(STDIN_FILENO, TCSAFLUSH, &original)
    FileHandle.standardError.write(Data("\n".utf8))
  }
  return value.trimmingCharacters(in: .whitespacesAndNewlines)
}

func decodePayload(_ segment: String) -> [String: Any]? {
  var source = segment.replacingOccurrences(of: "-", with: "+")
    .replacingOccurrences(of: "_", with: "/")
  source += String(repeating: "=", count: (4 - source.count % 4) % 4)
  guard
    let data = Data(base64Encoded: source),
    let object = try? JSONSerialization.jsonObject(with: data),
    let payload = object as? [String: Any]
  else { return nil }
  return payload
}

let apiKey = readSecret()
let segments = apiKey.split(separator: ".", omittingEmptySubsequences: false)
guard segments.count == 3, apiKey.count > 128 else {
  fail("Refusing to store an incomplete CloudBase API Key.")
}
guard
  let payload = decodePayload(String(segments[1])),
  payload["aud"] as? String == expectedAudience,
  payload["project_id"] as? String == expectedAudience
else {
  fail("Refusing to store a key for a different CloudBase environment.")
}

let query: [CFString: Any] = [
  kSecClass: kSecClassGenericPassword,
  kSecAttrAccount: account,
  kSecAttrService: service,
]
let attributes: [CFString: Any] = [
  kSecValueData: Data(apiKey.utf8),
  kSecAttrLabel: "myRoot 0.7.0 CloudBase AI local dev",
  kSecAttrAccessible: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
]

var status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
if status == errSecItemNotFound {
  var item = query
  attributes.forEach { item[$0.key] = $0.value }
  status = SecItemAdd(item as CFDictionary, nil)
}
guard status == errSecSuccess else {
  fail("Keychain update failed with OSStatus \(status).")
}

print("CloudBase API Key stored in the dedicated local Keychain item.")
