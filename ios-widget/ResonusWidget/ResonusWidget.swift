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
        // iOS 17 puts a margin around widget content, and the progress bar
        // landed inside it: floating above the bottom edge and short of both
        // sides, however it was pinned from in here, because ignoresSafeArea
        // cannot cross a margin the system applies around the whole content.
        // Off, the content runs to the widget's own bounds and the bar sits
        // on the bottom, all the way across, the way the mini player's does.
        // The modifier does nothing before iOS 17, so no version check.
        .contentMarginsDisabled()
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
        let tint = WidgetStore.background(state)
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

    /// The artwork and the title are the album's link, the button is its own
    /// link beside the title, centred on the text block rather than on its
    /// first line. The two are siblings: a link inside a link would eat one
    /// of them. The icon and the button share one inset, so their right edges
    /// line up down the widget, and the icon sits level with the top of the
    /// cover beside it.
    private var track: some View {
        ZStack(alignment: .bottom) {
            GeometryReader { geo in
                // Three fifths of the width: the cover keeps its square, and
                // the height follows from it rather than from the widget's.
                let side = geo.size.width * 0.6
                VStack(alignment: .leading, spacing: 0) {
                    Link(destination: albumURL) {
                        HStack(alignment: .top, spacing: 10) {
                            artwork(side: side)
                            Spacer(minLength: 4)
                            appIcon(size: 20)
                                .padding(.trailing, 6)
                        }
                    }
                    // One flexible run above the text and one below it: the
                    // text centres itself in the gap between the cover and
                    // the progress bar whatever the widget's height is.
                    Spacer(minLength: 4)
                    HStack(alignment: .center, spacing: 8) {
                        Link(destination: albumURL) {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(state?.title ?? "")
                                    .font(.system(size: 13, weight: .bold))
                                    .foregroundColor(.white)
                                    .lineLimit(2)
                                    .minimumScaleFactor(0.75)
                                Text(state?.artist ?? "")
                                    .font(.system(size: 11, weight: .semibold))
                                    .foregroundColor(.white.opacity(0.7))
                                    .lineLimit(1)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        Link(destination: toggleURL) { playButton }
                            .padding(.trailing, 6)
                    }
                    Spacer(minLength: 4)
                }
                .padding(.horizontal, 12)
                .padding(.top, 8)
                .padding(.bottom, 10)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }

            progressBar
        }
    }

    private var playButton: some View {
        ZStack {
            Circle().fill(Color.white)
            Image(systemName: (state?.playing ?? false) ? "pause.fill" : "play.fill")
                .font(.system(size: 16, weight: .bold))
                .foregroundColor(.black)
        }
        .frame(width: 40, height: 40)
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
        // Full width, on the edge: the widget's own bottom, not a run inside
        // it. The safe area is ignored because a preview draws one and the
        // home screen does not, and the bar has to land the same way on both.
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
        .ignoresSafeArea(edges: .bottom)
    }

    private func artwork(side: CGFloat) -> some View {
        ZStack {
            if let cover {
                Image(uiImage: cover).resizable().scaledToFill()
            } else {
                Color.white.opacity(0.15)
            }
        }
        .frame(width: side, height: side)
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

    /// Just the mark when there is a track and nothing to say about it. When
    /// there is no track at all, the reason is under it: a widget that shows
    /// only its icon could be missing the shared container, missing the data,
    /// or holding data it cannot read, and those three are fixed in three
    /// different places.
    private var emptyState: some View {
        Link(destination: homeURL) {
            VStack(spacing: 7) {
                appIcon(size: 34)
                    .opacity(0.75)
                if state == nil, let why = WidgetStore.why() {
                    Text(why)
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundColor(.white.opacity(0.55))
                        .multilineTextAlignment(.center)
                        .lineLimit(2)
                        .padding(.horizontal, 12)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}
