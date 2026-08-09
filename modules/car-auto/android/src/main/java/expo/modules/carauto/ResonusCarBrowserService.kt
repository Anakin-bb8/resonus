// Adapted from wavio (github.com/Joel-Mercier/wavio, MIT) for Resonus.
package expo.modules.carauto

import android.os.Bundle
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaConstants
import androidx.media3.session.MediaLibraryService
import androidx.media3.session.MediaSession
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture

/**
 * The MediaLibraryService that shows Android Auto the BrowseTree built in JS.
 * The session's player is a `JsProxyPlayer` whose state is pushed from JS, so
 * the mini player and the car's "Now Playing" screen show what is really
 * playing. Tapping a browsable item goes through Media3's usual browse flow;
 * tapping a playable leaf hands the mediaId, along with the parent being
 * browsed at the time, to JS through `CarAutoModule.emitPlayEvent`, so that JS
 * can queue the whole collection and start on the track that was tapped.
 */
@OptIn(UnstableApi::class)
class ResonusCarBrowserService : MediaLibraryService() {
  private var session: MediaLibrarySession? = null
  private var jsPlayer: JsProxyPlayer? = null

  override fun onCreate() {
    super.onCreate()
    BrowseTreeCache.loadFromDiskIfNeeded(applicationContext)
    val player = JsProxyPlayer().also {
      jsPlayer = it
      activePlayer = it
    }
    session = MediaLibrarySession.Builder(this, player, LibraryCallback())
      .setId("ResonusCarBrowserSession")
      .build()
  }

  override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaLibrarySession? = session

  override fun onDestroy() {
    if (activePlayer === jsPlayer) activePlayer = null
    session?.run { player.release(); release() }
    session = null
    jsPlayer = null
    super.onDestroy()
  }

  private inner class LibraryCallback : MediaLibrarySession.Callback {
    override fun onGetLibraryRoot(
      session: MediaLibrarySession,
      browser: MediaSession.ControllerInfo,
      params: LibraryParams?,
    ): ListenableFuture<LibraryResult<MediaItem>> {
      val rootExtras = Bundle().apply {
        // Hints for Android Auto: the root's children are drawn as tabs
        // (category list items), and anything browsable below that as a list.
        putInt(
          MediaConstants.EXTRAS_KEY_CONTENT_STYLE_BROWSABLE,
          MediaConstants.EXTRAS_VALUE_CONTENT_STYLE_CATEGORY_LIST_ITEM,
        )
        putInt(
          MediaConstants.EXTRAS_KEY_CONTENT_STYLE_PLAYABLE,
          MediaConstants.EXTRAS_VALUE_CONTENT_STYLE_LIST_ITEM,
        )
      }
      val root = MediaItem.Builder()
        .setMediaId(BrowseTreeCache.ROOT_ID)
        .setMediaMetadata(
          MediaMetadata.Builder()
            .setIsBrowsable(true)
            .setIsPlayable(false)
            .setMediaType(MediaMetadata.MEDIA_TYPE_FOLDER_MIXED)
            .build(),
        )
        .build()
      // The hints ride in the params, not in the item: what reaches the car is
      // the bundle media3 builds out of `result.params.extras`, and anything
      // left on the root's own metadata is dropped on the way
      // (`MediaLibraryServiceLegacyStub.onGetRoot`). Put there, the tabs were
      // being drawn however Android Auto felt like. The ones passed in are the
      // browser's own request hints and are not ours to echo back.
      val rootParams = LibraryParams.Builder().setExtras(rootExtras).build()
      return Futures.immediateFuture(LibraryResult.ofItem(root, rootParams))
    }

    override fun onGetItem(
      session: MediaLibrarySession,
      browser: MediaSession.ControllerInfo,
      mediaId: String,
    ): ListenableFuture<LibraryResult<MediaItem>> {
      val node = findNode(mediaId)
        ?: return Futures.immediateFuture(LibraryResult.ofError(LibraryResult.RESULT_ERROR_BAD_VALUE))
      return Futures.immediateFuture(LibraryResult.ofItem(node.toMediaItem(), null))
    }

    override fun onGetChildren(
      session: MediaLibrarySession,
      browser: MediaSession.ControllerInfo,
      parentId: String,
      page: Int,
      pageSize: Int,
      params: LibraryParams?,
    ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> {
      // Paged, like the search results and for the same reason (see `pageOf`).
      return Futures.immediateFuture(pageOf(BrowseTreeCache.getChildren(parentId), page, pageSize, params))
    }

    /**
     * Answered from the cached tree, without asking JS: the car searches with
     * the screen off, and that is exactly when React Native stops running
     * timers and its requests stop coming back (#103). media3 announces to the
     * car that search exists on its own, from the session commands, so this is
     * the only thing that was missing.
     *
     * The work happens here and the results are kept, because the count
     * reported now and the items handed over in `onGetSearchResult` have to be
     * the same list.
     */
    override fun onSearch(
      session: MediaLibrarySession,
      browser: MediaSession.ControllerInfo,
      query: String,
      params: LibraryParams?,
    ): ListenableFuture<LibraryResult<Void>> {
      val results = resultsFor(query)
      CarAutoLog.d("search q=$query hits=${results.size}")
      session.notifySearchResultChanged(browser, query, results.size, params)
      return Futures.immediateFuture(LibraryResult.ofVoid(params))
    }

    override fun onGetSearchResult(
      session: MediaLibrarySession,
      browser: MediaSession.ControllerInfo,
      query: String,
      page: Int,
      pageSize: Int,
      params: LibraryParams?,
    ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> =
      Futures.immediateFuture(pageOf(resultsFor(query), page, pageSize, params))

    /**
     * The window the controller asked for, and nothing more. Every item can
     * carry its cover as bytes (scaled down), so answering a long list in one
     * go could run past the binder transaction limit. Android Auto pages with
     * a sensible pageSize and stops when it has enough.
     */
    private fun pageOf(
      all: List<BrowseNode>,
      page: Int,
      pageSize: Int,
      params: LibraryParams?,
    ): LibraryResult<ImmutableList<MediaItem>> {
      val from = page.toLong() * pageSize.toLong()
      if (from >= all.size) return LibraryResult.ofItemList(ImmutableList.of(), params)
      val start = from.toInt()
      val end = minOf(from + pageSize.toLong(), all.size.toLong()).toInt()
      return LibraryResult.ofItemList(
        ImmutableList.copyOf(all.subList(start, end).map { it.toMediaItem() }),
        params,
      )
    }

    override fun onAddMediaItems(
      mediaSession: MediaSession,
      controller: MediaSession.ControllerInfo,
      mediaItems: MutableList<MediaItem>,
    ): ListenableFuture<MutableList<MediaItem>> {
      val first = mediaItems.firstOrNull()
      val id = first?.mediaId
      if (id.isNullOrEmpty()) {
        val spoken = spokenPick(first) ?: return Futures.immediateFuture(mediaItems)
        return Futures.immediateFuture(mutableListOf(spoken.toMediaItem()))
      }
      return resolvePlayable(id, mediaItems)
    }

    override fun onSetMediaItems(
      mediaSession: MediaSession,
      controller: MediaSession.ControllerInfo,
      mediaItems: MutableList<MediaItem>,
      startIndex: Int,
      startPositionMs: Long,
    ): ListenableFuture<MediaSession.MediaItemsWithStartPosition> {
      val first = mediaItems.firstOrNull()
      val id = first?.mediaId
      // "Play <something>" arrives with no id at all and what was said in the
      // request's `searchQuery`, so the tree is searched for it. Left alone,
      // every spoken request was dropped here (#103).
      if (id.isNullOrEmpty()) {
        val spoken = spokenPick(first)
        return Futures.immediateFuture(
          if (spoken == null) {
            MediaSession.MediaItemsWithStartPosition(mediaItems, startIndex, startPositionMs)
          } else {
            MediaSession.MediaItemsWithStartPosition(mutableListOf(spoken.toMediaItem()), 0, 0L)
          },
        )
      }
      val node = findNode(id)
      if (node != null && node.playable) {
        jsPlayer?.applyTappedItem(node)
        emitPlay(id)
        return Futures.immediateFuture(
          MediaSession.MediaItemsWithStartPosition(
            mutableListOf(node.toMediaItem()),
            0,
            0L,
          ),
        )
      }
      return Futures.immediateFuture(
        MediaSession.MediaItemsWithStartPosition(mediaItems, startIndex, startPositionMs),
      )
    }

    override fun onPlaybackResumption(
      mediaSession: MediaSession,
      controller: MediaSession.ControllerInfo,
    ): ListenableFuture<MediaSession.MediaItemsWithStartPosition> =
      Futures.immediateFailedFuture(UnsupportedOperationException("no resumption state"))

    /**
     * What to start playing for a spoken request, already handed to JS.
     *
     * A track gets the optimistic metadata the car shows while JS resolves it,
     * the same as a tap. A collection does not: what it puts on is its first
     * song, and naming the album where the song goes would be a worse answer
     * than the spinner that is already there.
     */
    private fun spokenPick(item: MediaItem?): BrowseNode? {
      val query = item?.requestMetadata?.searchQuery
      val node = BrowseTreeCache.voicePick(query?.toString())
      CarAutoLog.d("voice q=$query pick=${node?.id}")
      if (node == null) return null
      if (node.playable) jsPlayer?.applyTappedItem(node)
      emitPlay(node.id)
      return node
    }

    private fun resolvePlayable(
      mediaId: String,
      original: MutableList<MediaItem>,
    ): ListenableFuture<MutableList<MediaItem>> {
      emitPlay(mediaId)
      val node = findNode(mediaId)
      if (node != null && node.playable) {
        jsPlayer?.applyTappedItem(node)
        return Futures.immediateFuture(mutableListOf(node.toMediaItem()))
      }
      return Futures.immediateFuture(original)
    }

    private fun emitPlay(mediaId: String) {
      val parentId = BrowseTreeCache.findParentOf(mediaId)
      CarAutoLog.d("emitPlay id=$mediaId parent=$parentId")
      CarAutoModule.instance?.emitPlayEvent(mediaId, parentId)
    }
  }

  /** The last query answered, kept so the count reported to the car and the
   *  items it then asks for cannot disagree. */
  @Volatile private var lastSearch: Pair<String, List<BrowseNode>>? = null

  private fun resultsFor(query: String): List<BrowseNode> {
    lastSearch?.let { (q, results) -> if (q == query) return results }
    val results = BrowseTreeCache.search(query)
    lastSearch = query to results
    return results
  }

  private fun findNode(mediaId: String): BrowseNode? {
    BrowseTreeCache.getChildren(BrowseTreeCache.ROOT_ID).firstOrNull { it.id == mediaId }?.let { return it }
    val seen = HashSet<String>()
    val stack = ArrayDeque<String>()
    stack.addLast(BrowseTreeCache.ROOT_ID)
    while (stack.isNotEmpty()) {
      val pid = stack.removeLast()
      if (!seen.add(pid)) continue
      for (c in BrowseTreeCache.getChildren(pid)) {
        if (c.id == mediaId) return c
        if (!c.playable) stack.addLast(c.id)
      }
    }
    return null
  }

  companion object {
    @Volatile var activePlayer: JsProxyPlayer? = null
      private set
  }
}

@OptIn(UnstableApi::class)
private fun BrowseNode.toMediaItem(): MediaItem {
  val extras = Bundle()
  // contentStyle on a browsable node tells AA how to draw *its children*.
  if (!playable) {
    val styleValue = when (contentStyle) {
      "grid" -> MediaConstants.EXTRAS_VALUE_CONTENT_STYLE_GRID_ITEM
      "list" -> MediaConstants.EXTRAS_VALUE_CONTENT_STYLE_LIST_ITEM
      else -> MediaConstants.EXTRAS_VALUE_CONTENT_STYLE_LIST_ITEM
    }
    extras.putInt(MediaConstants.EXTRAS_KEY_CONTENT_STYLE_BROWSABLE, styleValue)
    extras.putInt(MediaConstants.EXTRAS_KEY_CONTENT_STYLE_PLAYABLE, styleValue)
  }
  val builder = MediaMetadata.Builder()
    .setTitle(title)
    .setSubtitle(subtitle)
    .setIsBrowsable(!playable)
    .setIsPlayable(playable)
    .setMediaType(
      if (playable) MediaMetadata.MEDIA_TYPE_MUSIC
      else MediaMetadata.MEDIA_TYPE_FOLDER_MIXED,
    )
    .setExtras(extras)
  CarArtwork.apply(builder, artworkUrl)
  return MediaItem.Builder()
    .setMediaId(id)
    .setMediaMetadata(builder.build())
    .build()
}
