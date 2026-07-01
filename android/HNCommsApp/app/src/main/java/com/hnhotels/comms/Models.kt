package com.hnhotels.comms

data class CommsThread(
    val threadId: String,
    val brand: String,
    val brandLabel: String,
    val phone: String,
    val displayName: String,
    val leadStatus: String,
    val leadSource: String,
    val assignedTo: String,
    val status: String,
    val lastMessageAt: String,
    val lastBody: String,
    val lastDirection: String,
    val lastMsgType: String,
    val unreadCount: Int,
    val serviceWindowExpiresAt: String,
    val serviceWindowOpen: Boolean,
    val serviceWindowMinutesRemaining: Int,
    val leadContext: LeadContext,
) {
    val title: String get() = displayName.ifBlank { phone.replaceFirst("91", "+91 ") }
    val laneLabel: String get() = when (leadSource) {
        "hiring" -> "Hiring"
        "darbar_staff" -> "From Darbar"
        "" -> "Customer"
        else -> leadSource.replace('_', ' ').replaceFirstChar { it.uppercase() }
    }
}

data class LeadContext(
    val source: String = "",
    val campaignName: String = "",
    val campaignRole: String = "",
    val candidateName: String = "",
    val staffName: String = "",
    val staffBrand: String = "",
    val staffRole: String = "",
) {
    val primary: String get() = listOf(campaignRole, staffRole, source).firstOrNull { it.isNotBlank() }.orEmpty()
    val secondary: String get() = listOf(candidateName, campaignName, staffName, staffBrand).filter { it.isNotBlank() }.joinToString(" · ")
}

data class CommsMessage(
    val id: Int,
    val threadId: String,
    val brand: String,
    val phone: String,
    val direction: String,
    val msgType: String,
    val body: String,
    val templateName: String,
    val wamid: String,
    val status: String,
    val errorText: String,
    val mediaId: String,
    val actor: String,
    val createdAt: String,
) {
    val outbound: Boolean get() = direction == "outbound"
    val hasMedia: Boolean get() = mediaId.isNotBlank() || msgType in listOf("image", "video", "audio", "document", "sticker")
    val mediaTitle: String get() {
        val cleaned = body.replace(Regex("^\\[[^]]+]\\s*"), "")
        return cleaned.ifBlank { msgType.replaceFirstChar { it.uppercase() } }
    }
}

data class QuickReply(
    val id: Int,
    val brand: String,
    val title: String,
    val body: String,
)

data class WabaTemplate(
    val id: String,
    val name: String,
    val status: String,
    val category: String,
    val language: String,
    val components: List<TemplateComponent>,
) {
    val bodyText: String get() = components.firstOrNull { it.type.equals("BODY", ignoreCase = true) }?.text.orEmpty()
    val variableCount: Int get() = (1..20).count { bodyText.contains("{{$it}}") }
}

data class TemplateComponent(
    val type: String,
    val text: String,
    val format: String,
)

data class StaffMember(
    val id: Int,
    val name: String,
    val phone: String,
    val e164: String,
    val brand: String,
    val role: String,
    val wabaStatus: String,
)

data class CampaignTemplate(
    val id: String,
    val name: String,
    val status: String,
    val category: String,
    val language: String,
    val bodyText: String,
    val varCount: Int,
)
