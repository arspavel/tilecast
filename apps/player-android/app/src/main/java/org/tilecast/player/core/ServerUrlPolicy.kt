package org.tilecast.player.core

import java.net.URI

data class NormalizedServerUrl(val value: String, val localInsecure: Boolean)

object ServerUrlPolicy {
    fun normalize(input: String): Result<NormalizedServerUrl> = runCatching {
        var candidate = input.trim()
        if (!candidate.contains("://")) candidate = "https://$candidate"
        val uri = URI(candidate)
        val scheme = uri.scheme?.lowercase() ?: error("Введите адрес сервера, начинающийся с http:// или https://")
        require(scheme == "http" || scheme == "https") { "Поддерживаются только адреса HTTP и HTTPS" }
        require(uri.host != null && uri.userInfo == null && uri.query == null && uri.fragment == null) { "Введите корректный адрес сервера" }
        require(uri.path.isNullOrEmpty() || uri.path == "/") { "Адрес сервера не должен содержать путь" }
        val host = uri.host.lowercase()
        val localHttp = scheme == "http" && isLocalHost(host)
        require(scheme == "https" || localHttp) { "Для серверов LSR signage в интернете нужен HTTPS" }
        val displayHost = if (host.contains(":")) "[$host]" else host
        val port = if (uri.port > 0) ":${uri.port}" else ""
        NormalizedServerUrl("$scheme://$displayHost$port", localHttp)
    }

    private fun isLocalHost(host: String): Boolean {
        if (host == "localhost" || host.endsWith(".local")) return true
        val parts = host.split('.').mapNotNull { it.toIntOrNull() }
        if (parts.size == 4 && parts.all { it in 0..255 }) {
            return parts[0] == 10 ||
                (parts[0] == 172 && parts[1] in 16..31) ||
                (parts[0] == 192 && parts[1] == 168) ||
                (parts[0] == 169 && parts[1] == 254) ||
                parts[0] == 127
        }
        return host == "::1" || host.startsWith("fe80:")
    }
}

