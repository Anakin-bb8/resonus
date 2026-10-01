import SwiftUI
import UIKit
import WidgetKit

@main
struct ResonusWidgetBundle: WidgetBundle {
    var body: some Widget {
        TrackWidget()
    }
}

/// One look at the widget: when the app last wrote, and what it wrote.
struct TrackEntry: TimelineEntry {
    let date: Date
    let state: NowPlaying?
}

struct TrackProvider: TimelineProvider {
    func placeholder(in context: Context) -> TrackEntry {
        TrackEntry(date: Date(), state: .sample)
    }

    func getSnapshot(in context: Context, completion: @escaping (TrackEntry) -> Void) {
        completion(TrackEntry(date: Date(), state: WidgetStore.load() ?? .sample))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<TrackEntry>) -> Void) {
        let start = Date()
        let state = WidgetStore.load()
        var entries: [TrackEntry] = []
        if let state, state.playing, state.duration > 0 {
            // While a track is running the bar has to move: one entry every
            // twenty seconds, each one working out where the track has got to
            // by the time that entry is shown. Sixty of them is twenty minutes
            // of walking, and the next batch arrives from the app's own write.
            for step in 0..<60 {
                entries.append(TrackEntry(date: start.addingTimeInterval(Double(step) * 20), state: state))
            }
        } else {
            entries.append(TrackEntry(date: start, state: state))
        }
        completion(Timeline(entries: entries, policy: .after(start.addingTimeInterval(60 * 30))))
    }
}

struct TrackWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "ResonusNowPlaying", provider: TrackProvider()) { entry in
            TrackWidgetView(entry: entry)
        }
        .configurationDisplayName("Now playing")
        .description("The track you played last, and how far into it you are.")
        .supportedFamilies([.systemSmall])
    }
}

struct TrackWidgetView: View {
    let entry: TrackEntry

    private var state: NowPlaying? { entry.state }
    private var cover: UIImage? { state == nil ? nil : WidgetStore.artwork() }

    private var homeURL: URL { URL(string: "resonus://")! }
    private var toggleURL: URL { URL(string: "resonus://shortcut/playback-toggle")! }
    private var albumURL: URL {
        guard
            let id = state?.albumId,
            !id.isEmpty,
            let encoded = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed),
            let url = URL(string: "resonus://album/\(encoded)")
        else { return homeURL }
        return url
    }

    private var progress: Double {
        guard let state else { return 0 }
        return WidgetStore.progress(state, at: entry.date)
    }

    var body: some View {
        let tint = WidgetStore.background(state, artwork: cover)
        if #available(iOS 17.0, *) {
            canvas
                .containerBackground(for: .widget) { tint }
        } else {
            canvas
                .background(tint)
        }
    }

    private var canvas: some View {
        ZStack {
            if state?.isEmpty ?? true {
                emptyState
            } else {
                track
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
    }

    /// Everything but the play button, so that a tap anywhere on it opens the
    /// album: the button is its own link underneath this one.
    private var track: some View {
        ZStack(alignment: .bottomTrailing) {
            Link(destination: albumURL) {
                VStack(alignment: .leading, spacing: 0) {
                    HStack(alignment: .top, spacing: 10) {
                        artwork
                        Spacer(minLength: 8)
                        appIcon(size: 20).padding(.top, 2)
                    }
                    Spacer(minLength: 8)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(state?.title ?? "")
                            .font(.system(size: 15, weight: .bold))
                            .foregroundColor(.white)
                            .lineLimit(2)
                            .minimumScaleFactor(0.75)
                        Text(state?.artist ?? "")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundColor(.white.opacity(0.7))
                            .lineLimit(1)
                    }
                    // The play button holds this end of the line.
                    .padding(.trailing, 46)
                }
                .padding(.horizontal, 12)
                .padding(.top, 12)
                .padding(.bottom, 16)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)

            Link(destination: toggleURL) {
                ZStack {
                    Circle().fill(Color.white)
                    Image(systemName: (state?.playing ?? false) ? "pause.fill" : "play.fill")
                        .font(.system(size: 17, weight: .bold))
                        .foregroundColor(.black)
                }
                .frame(width: 44, height: 44)
            }
            .padding(.trailing, 12)
            .padding(.bottom, 22)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)

            progressBar
        }
    }

    private var progressBar: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.white.opacity(0.35))
                Capsule()
                    .fill(Color.white)
                    .frame(width: max(5, geo.size.width * CGFloat(progress)))
            }
        }
        .frame(height: 5)
        .padding(.horizontal, 10)
        .padding(.bottom, 8)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
    }

    private var artwork: some View {
        ZStack {
            if let cover {
                Image(uiImage: cover).resizable().scaledToFill()
            } else {
                Color.white.opacity(0.15)
            }
        }
        .frame(width: 74, height: 74)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    /// The app's own mark, white and on nothing: the top right corner, the way
    /// the music apps put theirs.
    private func appIcon(size: CGFloat) -> some View {
        Group {
            if let icon = UIImage(named: "widget-icon") {
                Image(uiImage: icon).renderingMode(.template).resizable()
            } else {
                Image(systemName: "music.note").resizable()
            }
        }
        .foregroundColor(.white)
        .frame(width: size, height: size)
    }

    private var emptyState: some View {
        ZStack {
            Link(destination: homeURL) {
                Color.clear
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            appIcon(size: 34)
                .opacity(0.75)
        }
    }
}
