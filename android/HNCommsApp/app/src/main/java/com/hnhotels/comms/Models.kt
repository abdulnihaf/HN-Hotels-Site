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
) {
    val title: String get() = displayName.ifBlank { phone.replaceFirst("91", "+91 ") }
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
    val actor: String,
    val createdAt: String,
) {
    val outbound: Boolean get() = direction == "outbound"
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
)
