import ExpoModulesCore
import UIKit

/// The radio icon, drawn once and written to disk: the seed's colour as the
/// background, up to three covers as overlapping circles (seed on top) and
/// the artist's name at the bottom - the shape Spotify gives its radios.
///
/// One JSON payload in, the file's uri back, so the JS side stays in charge
/// of what goes in it (see `src/lib/radioArt.ts`). Everything runs off the
/// main queue: three cover downloads and a 512 px render don't belong on it.
public class RadioArtModule: Module {
  private static let side: CGFloat = 512

  private struct GenerateError: Error, CustomStringConvertible {
    let message: String
    var description: String { message }
  }

  public func definition() -> ModuleDefinition {
    Name("RadioArt")

    AsyncFunction("generate") { (payload: String, promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          promise.resolve(try Self.generate(payload))
        } catch {
          promise.reject(
            NSError(
              domain: "RadioArt",
              code: 1,
              userInfo: [NSLocalizedDescriptionKey: String(describing: error)]
            )
          )
        }
      }
    }
  }

  private static func generate(_ payload: String) throws -> String {
    let data = Data(payload.utf8)
    let opts = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
    guard let outPath = opts["outPath"] as? String, !outPath.isEmpty else {
      throw GenerateError(message: "no outPath")
    }
    let background = parseHex(opts["backgroundColor"] as? String) ?? .darkGray
    let ink = parseHex(opts["textColor"] as? String) ?? .white
    let title = (opts["title"] as? String) ?? ""
    let images = (opts["images"] as? [String]) ?? []

    // The covers, in parallel and none of them fatal: a cover that fails or
    // never arrives leaves its circle as the shaded background colour.
    let urls = images.prefix(3).compactMap { URL(string: $0) }
    var downloaded = [UIImage?](repeating: nil, count: urls.count)
    let group = DispatchGroup()
    for (index, url) in urls.enumerated() {
      group.enter()
      URLSession.shared.dataTask(with: url) { body, _, _ in
        if let body { downloaded[index] = UIImage(data: body) }
        group.leave()
      }.resume()
    }
    group.wait()

    let size = CGSize(width: side, height: side)
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1 // a 512 px file, not a 512 pt one times the screen
    format.opaque = true // the background fills every pixel anyway
    let image = UIGraphicsImageRenderer(size: size, format: format).image { ctx in
      let c = ctx.cgContext
      background.setFill()
      c.fill(CGRect(origin: .zero, size: size))

      // Sides first, the seed's own cover above them: the order the card's
      // live collage paints in, so the file and the views are one picture.
      let sideR = size.width * 0.20
      let centerR = size.width * 0.30
      // A side with no artist behind it is left out, not drawn as an empty disc.
      if urls.count > 1 {
        drawCircle(context: c, cx: size.width * 0.10, cy: size.height * 0.54, r: sideR,
                   image: downloaded.count > 1 ? downloaded[1] : nil, background: background)
      }
      if urls.count > 2 {
        drawCircle(context: c, cx: size.width * 0.90, cy: size.height * 0.54, r: sideR,
                   image: downloaded.count > 2 ? downloaded[2] : nil, background: background)
      }
      drawCircle(context: c, cx: size.width * 0.50, cy: size.height * 0.46, r: centerR,
                 image: downloaded.first ?? nil, background: background)

      drawLabel("RADIO", at: CGPoint(x: size.width - 28, y: 30),
                font: .boldSystemFont(ofSize: 26), kern: 2.5, ink: ink,
                alignRight: true, maxWidth: size.width - 56)
      drawTitle(title, size: size, ink: ink)
    }

    guard let png = image.pngData() else { throw GenerateError(message: "no png") }
    let path = outPath.replacingOccurrences(of: "file://", with: "")
    try FileManager.default.createDirectory(
      atPath: (path as NSString).deletingLastPathComponent,
      withIntermediateDirectories: true
    )
    try png.write(to: URL(fileURLWithPath: path))
    return outPath
  }

  /// One circle: the picture aspect-filled inside the clip, or the shaded
  /// background where there is no picture to put there.
  private static func drawCircle(
    context c: CGContext, cx: CGFloat, cy: CGFloat, r: CGFloat,
    image: UIImage?, background: UIColor
  ) {
    let rect = CGRect(x: cx - r, y: cy - r, width: r * 2, height: r * 2)
    c.saveGState()
    c.addEllipse(in: rect)
    c.clip()
    if let image, image.size.width > 0, image.size.height > 1 {
      let scale = max(rect.width / image.size.width, rect.height / image.size.height)
      let dw = image.size.width * scale, dh = image.size.height * scale
      image.draw(in: CGRect(x: rect.midX - dw / 2, y: rect.midY - dh / 2, width: dw, height: dh))
    } else {
      shade(background).setFill()
      c.fill(rect)
    }
    c.restoreGState()
  }

  private static func drawLabel(
    _ text: String, at point: CGPoint, font: UIFont, kern: CGFloat, ink: UIColor,
    alignRight: Bool, maxWidth: CGFloat
  ) {
    let attrs: [NSAttributedString.Key: Any] = [
      .font: font,
      .foregroundColor: ink,
      .kern: kern,
      .shadow: shadow(ink),
    ]
    let bounds = (text as NSString).boundingRect(
      with: CGSize(width: maxWidth, height: side),
      options: [.usesLineFragmentOrigin],
      attributes: attrs,
      context: nil
    )
    let x = alignRight ? point.x - bounds.width : point.x
    (text as NSString).draw(at: CGPoint(x: x, y: point.y), withAttributes: attrs)
  }

  /// The artist's name, up to two lines, shrinking until it fits: a name is
  /// whatever length it is, and the icon has fixed edges to stay inside.
  private static func drawTitle(_ title: String, size: CGSize, ink: UIColor) {
    guard !title.isEmpty else { return }
    let maxWidth = size.width - 56
    var fontSize: CGFloat = 64
    var attrs: [NSAttributedString.Key: Any] = [
      .font: UIFont.systemFont(ofSize: fontSize, weight: .bold),
      .foregroundColor: ink,
      .kern: -1,
      .shadow: shadow(ink),
    ]
    var bounds = (title as NSString).boundingRect(
      with: CGSize(width: maxWidth, height: .greatestFiniteMagnitude),
      options: [.usesLineFragmentOrigin],
      attributes: attrs,
      context: nil
    )
    while (bounds.height > fontSize * 2.3 || bounds.width > maxWidth) && fontSize > 34 {
      fontSize -= 4
      attrs[.font] = UIFont.systemFont(ofSize: fontSize, weight: .bold)
      bounds = (title as NSString).boundingRect(
        with: CGSize(width: maxWidth, height: .greatestFiniteMagnitude),
        options: [.usesLineFragmentOrigin],
        attributes: attrs,
        context: nil
      )
    }
    let rect = CGRect(x: 28, y: size.height - 28 - bounds.height,
                      width: maxWidth, height: bounds.height)
    (title as NSString).draw(with: rect, options: [.usesLineFragmentOrigin],
                             attributes: attrs, context: nil)
  }

  /// The name sits over covers nobody chose: a shadow opposite to the ink, so
  /// it reads on whichever of them is bright.
  private static func shadow(_ ink: UIColor) -> NSShadow {
    let s = NSShadow()
    s.shadowOffset = CGSize(width: 0, height: 1)
    s.shadowBlurRadius = 3
    var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0
    ink.getRed(&r, green: &g, blue: &b, alpha: nil)
    s.shadowColor = (r + g + b) / 3 > 0.5 ? UIColor.black : UIColor.white
    return s
  }

  private static func shade(_ color: UIColor) -> UIColor {
    var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0
    color.getRed(&r, green: &g, blue: &b, alpha: nil)
    return UIColor(red: r * 0.8, green: g * 0.8, blue: b * 0.8, alpha: 1)
  }

  private static func parseHex(_ value: String?) -> UIColor? {
    guard var hex = value?.trimmingCharacters(in: .whitespacesAndNewlines) else { return nil }
    if hex.hasPrefix("#") { hex.removeFirst() }
    guard hex.count == 6, let n = UInt32(hex, radix: 16) else { return nil }
    return UIColor(
      red: CGFloat((n >> 16) & 0xFF) / 255,
      green: CGFloat((n >> 8) & 0xFF) / 255,
      blue: CGFloat(n & 0xFF) / 255,
      alpha: 1
    )
  }
}
