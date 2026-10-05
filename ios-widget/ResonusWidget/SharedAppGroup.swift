import Foundation

/// The App Group the app writes into and the widget reads from, worked out at
/// runtime rather than named in the source.
///
/// This repo ships an unsigned IPA: there are no entitlements until something
/// signs the build, and a sideload signs with its own provisioning profile.
/// The app group in that profile is whatever the certificate registered - a
/// name this repo can neither predict nor carry. The profile travels inside
/// the bundle as `embedded.mobileprovision`, so both halves read the group
/// names out of it and use whichever one iOS actually granted. The stock group
/// is offered too, because a build nothing has re-signed over the top of has
/// that one.
///
/// The widget is a separate binary that never links the app's module, so this
/// file is compiled into both targets: `modules/home-widget/ios/` for the app,
/// `ios-widget/ResonusWidget/` for the widget. The twins stay identical.
enum SharedAppGroup {
    /// The group of a build signed the ordinary way, by Xcode or TestFlight.
    static let stock = "group.com.juananzzz.resonus"

    /// The groups this process may actually use. Only iOS can say: a group the
    /// signed entitlements do not carry has no container, and asking for one
    /// is how the two halves agree on a name that appears nowhere in this
    /// source tree.
    static func granted() -> [String] {
        var offered = [stock]
        let own = Bundle.main.bundleIdentifier ?? ""
        if !own.isEmpty { offered.append("group.\(own)") }
        // The widget's id is the app's with the target's name on the end, so
        // the app's comes off its own with that taken away - which lands on
        // the certificate's id when a sideloader stamped that into both.
        let suffix = ".ResonusWidget"
        if own.hasSuffix(suffix) { offered.append("group.\(own.dropLast(suffix.count))") }
        offered.append(contentsOf: profile().groups)

        var seen = Set<String>()
        return offered.filter { seen.insert($0).inserted }.filter {
            FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: $0) != nil
        }
    }

    /// The profile the build was signed with: whether there is one in the
    /// bundle at all, and the groups it allows. A sideload cannot install
    /// without one, so `found` says the build was signed some other way (or
    /// not at all); `groups` empty says the certificate registered no app
    /// group, which is fixed by getting one registered, not here.
    static func profile() -> (found: Bool, groups: [String]) {
        var found = false
        var groups: [String] = []
        for bundle in profileBundles() {
            guard
                let path = bundle.path(forResource: "embedded", ofType: "mobileprovision"),
                let data = FileManager.default.contents(atPath: path)
            else { continue }
            found = true
            groups = readGroups(from: data)
            if !groups.isEmpty { break }
        }
        return (found, groups)
    }

    /// Where a profile can be: this binary's own bundle, and the app it sits
    /// inside. A widget is `App.app/PlugIns/Widget.appex` and the install's
    /// profile is in the app; for the app itself the second lookup runs past
    /// the bundle and finds nothing, which costs nothing.
    private static func profileBundles() -> [Bundle] {
        let parent = Bundle.main.bundleURL.deletingLastPathComponent().deletingLastPathComponent()
        var bundles = [Bundle.main]
        if let app = Bundle(path: parent.path), app != Bundle.main { bundles.append(app) }
        return bundles
    }

    /// The profile is a CMS blob with the plist sitting in the middle of it:
    /// the plist is found by its markers rather than unwrapped, which needs no
    /// crypto and no framework. Only the app groups are taken out - everything
    /// else in there belongs to the signer, not to this.
    private static func readGroups(from profile: Data) -> [String] {
        guard
            let start = profile.range(of: Data("<plist".utf8)),
            let end = profile.range(of: Data("</plist>".utf8)),
            start.lowerBound < end.upperBound,
            let plist = try? PropertyListSerialization.propertyList(
                from: profile.subdata(in: start.lowerBound..<end.upperBound),
                options: [],
                format: nil
            ) as? [String: Any],
            let entitlements = plist["Entitlements"] as? [String: Any],
            let groups = entitlements["com.apple.security.application-groups"] as? [String]
        else { return [] }
        return groups.filter { $0.hasPrefix("group.") }
    }
}
