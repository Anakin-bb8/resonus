// Adapted from wavio (github.com/Joel-Mercier/wavio, MIT) for Resonus.
package expo.modules.carauto

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

data class BrowseNode(
  val id: String,
  val title: String,
  val subtitle: String?,
  val artworkUrl: String?,
  val playable: Boolean,
  val contentStyle: String?, // "list" | "grid" | null
)

object BrowseTreeCache {
  private const val SNAPSHOT_FILE = "carauto_tree.json"
  const val ROOT_ID = "root"

  @Volatile private var nodes: Map<String, List<BrowseNode>> = emptyMap()
  @Volatile private var loaded: Boolean = false
  // The last browsable parent opened in Android Auto. It travels with a play
  // event so JS can queue the whole collection (the album, the playlist, the
  // section of Home) rather than only the track that was tapped.
  @Volatile private var lastBrowsedParent: String? = null

  fun setFromJson(context: Context, json: String) {
    val parsed = parse(json) ?: return
    nodes = parsed
    runCatching {
      File(context.filesDir, SNAPSHOT_FILE).writeText(json)
    }
    loaded = true
  }

  // For when JS has not pushed a tree into this process yet, which is what
  // happens when Android Auto starts the service on its own.
  fun loadFromDiskIfNeeded(context: Context) {
    if (loaded) return
    loaded = true
    runCatching {
      val file = File(context.filesDir, SNAPSHOT_FILE)
      if (file.exists()) parse(file.readText())?.let { nodes = it }
    }
  }

  fun getChildren(parentId: String): List<BrowseNode> {
    val children = nodes[parentId] ?: emptyList()
    // The deepest parent that actually holds playable leaves is the collection
    // AA was browsing when a track was tapped, so that is the one worth keeping.
    if (children.any { it.playable }) lastBrowsedParent = parentId
    return children
  }

  fun lastBrowsedParent(): String? = lastBrowsedParent

  // Best effort: the id of the parent the tapped track lives in, when that
  // parent is known. Falls back to the last one browsed if the track cannot be
  // resolved from the cache, which is rare and only happens while it is warming
  // up. JS is the authority now (a track's mediaId carries its parent), so this
  // is only here for older ids that carry none.
  fun findParentOf(childId: String): String? {
    for ((pid, list) in nodes) {
      if (list.any { it.id == childId }) return pid
    }
    return lastBrowsedParent
  }

  fun debugSummary(): String {
    val root = nodes[ROOT_ID]?.size ?: 0
    return "root=$root totalParents=${nodes.size}"
  }

  private fun parse(json: String): Map<String, List<BrowseNode>>? = try {
    val root = JSONObject(json)
    val nodesObj = root.optJSONObject("nodes") ?: return null
    val map = HashMap<String, List<BrowseNode>>(nodesObj.length())
    val keys = nodesObj.keys()
    while (keys.hasNext()) {
      val k = keys.next()
      val arr = nodesObj.optJSONArray(k) ?: continue
      map[k] = parseList(arr)
    }
    map
  } catch (_: Throwable) {
    null
  }

  private fun parseList(arr: JSONArray): List<BrowseNode> {
    val out = ArrayList<BrowseNode>(arr.length())
    for (i in 0 until arr.length()) {
      val o = arr.optJSONObject(i) ?: continue
      out.add(
        BrowseNode(
          id = o.optString("id"),
          title = o.optString("title"),
          subtitle = o.optString("subtitle").takeIf { it.isNotEmpty() },
          artworkUrl = o.optString("artworkUrl").takeIf { it.isNotEmpty() },
          playable = o.optBoolean("playable", false),
          contentStyle = o.optString("contentStyle").takeIf { it.isNotEmpty() },
        )
      )
    }
    return out
  }
}
