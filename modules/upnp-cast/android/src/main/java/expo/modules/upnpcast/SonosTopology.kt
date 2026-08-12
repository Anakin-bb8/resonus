package expo.modules.upnpcast

import android.util.Log
import android.util.Xml
import org.xmlpull.v1.XmlPullParser
import java.io.StringReader

object SonosTopology {
  data class CoordinatorTarget(val controlUrl: String, val uid: String)
  data class DeviceView(
    val groupId: String,
    val coordinatorId: String,
    val name: String?
  )

  suspend fun describe(description: DeviceDescription): DeviceView? {
    if (!description.isSonos) return null
    val ownUuid = description.udn?.let(::normalizeUuid) ?: return null
    val topology = description.controlUrl(Services.ZONE_GROUP_TOPOLOGY) ?: return null
    val response = Soap.call(topology, Services.ZONE_GROUP_TOPOLOGY, "GetZoneGroupState")
    val state = Soap.argument(response.body, "ZoneGroupState") ?: return null

    val group = groupContaining(state, ownUuid) ?: return null
    val ownName = group.members.firstOrNull { it.uuid == ownUuid }?.zoneName?.trim()?.takeIf(String::isNotEmpty)
      ?: description.displayName()
    return DeviceView(
      groupId = group.id,
      coordinatorId = group.coordinator,
      name = ownName
    )
  }

  suspend fun coordinatorTarget(description: DeviceDescription): CoordinatorTarget? {
    if (!description.isSonos) return null
    val ownUuid = description.udn?.let(::normalizeUuid) ?: return null
    val topology = description.controlUrl(Services.ZONE_GROUP_TOPOLOGY) ?: return null

    val response = Soap.call(topology, Services.ZONE_GROUP_TOPOLOGY, "GetZoneGroupState")
    val state = Soap.argument(response.body, "ZoneGroupState") ?: return null

    val group = groupContaining(state, ownUuid) ?: return null
    if (group.coordinator == ownUuid) {
      return CoordinatorTarget(
        controlUrl = description.controlUrl(Services.AV_TRANSPORT) ?: return null,
        uid = ownUuid
      )
    }
    val location = group.members.firstOrNull { it.uuid == group.coordinator }?.location ?: return null

    Log.w(Soap.TAG, "${description.friendlyName} is not its group's coordinator; using $location")
    val coordinator = Soap.fetch(location)?.let { DeviceDescription.parse(it, location) } ?: return null
    val uid = coordinator.udn?.let(::normalizeUuid) ?: return null
    return CoordinatorTarget(
      controlUrl = coordinator.controlUrl(Services.AV_TRANSPORT) ?: return null,
      uid = uid
    )
  }

  private data class GroupMember(val uuid: String, val location: String?, val zoneName: String?)

  private data class Group(val id: String, val coordinator: String, val members: List<GroupMember>)

  private fun groupContaining(state: String, uuid: String): Group? {
    try {
      val parser = Xml.newPullParser()
      parser.setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES, false)
      parser.setInput(StringReader(state))

      var groupId: String? = null
      var coordinator: String? = null
      var members = mutableListOf<GroupMember>()
      var holdsUuid = false
      var event = parser.eventType
      while (event != XmlPullParser.END_DOCUMENT) {
        when {
          event == XmlPullParser.START_TAG && parser.name.equals("ZoneGroup", true) -> {
            groupId = parser.getAttributeValue(null, "ID")?.trim()
            coordinator = parser.getAttributeValue(null, "Coordinator")?.let(::normalizeUuid)
            members = mutableListOf()
            holdsUuid = false
          }
          event == XmlPullParser.START_TAG && parser.name.equals("ZoneGroupMember", true) -> {
            val member = parser.getAttributeValue(null, "UUID")?.let(::normalizeUuid)
            val location = parser.getAttributeValue(null, "Location")
            val zoneName = parser.getAttributeValue(null, "ZoneName")
            if (member != null) {
              if (member == uuid) holdsUuid = true
              members.add(GroupMember(member, location?.let(Soap::unescape), zoneName))
            }
          }
          event == XmlPullParser.END_TAG && parser.name.equals("ZoneGroup", true) -> {
            if (holdsUuid && coordinator != null && groupId != null) return Group(groupId, coordinator, members)
          }
        }
        event = parser.next()
      }
    } catch (_: Exception) {
      return null
    }
    return null
  }

  private fun normalizeUuid(uuid: String): String =
    uuid.removePrefix("uuid:").trim().uppercase()
}