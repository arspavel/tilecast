package org.tilecast.player.diagnostics

import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Service information for the on-screen overlay (remote Up key). */
data class PlayerDiagnostics(
    val screenName: String? = null,
    val serverHost: String? = null,
    val connected: Boolean = false,
    val connectedForMillis: Long = 0,
    val latencyMillis: Long? = null,
    val latencyError: String? = null,
    val downloadBytesPerSecond: Long? = null,
    val downloading: Boolean = false,
    val contentName: String? = null,
    val selectionSource: String = "none",
    val itemPosition: Int? = null,
    val itemCount: Int? = null,
    val nextTransition: Instant? = null,
    val cacheUsedBytes: Long = 0,
    val cacheLimitBytes: Long = 0,
    val freeBytes: Long = 0,
    val syncQueueCount: Int = 0,
    val syncDownloadedBytes: Long = 0,
    val syncRequiredBytes: Long = 0,
    val syncError: String? = null,
    val manifestVersion: Long? = null,
    val playerVersion: String = "",
) {
    /** Download progress 0..1 while a manifest is being prepared, otherwise null. */
    val syncFraction: Float?
        get() = if (syncRequiredBytes > 0 && (syncQueueCount > 0 || syncDownloadedBytes < syncRequiredBytes)) {
            (syncDownloadedBytes.toFloat() / syncRequiredBytes).coerceIn(0f, 1f)
        } else {
            null
        }
}

/**
 * Download speed from cumulative byte counts. Samples older than the window
 * are dropped; a smaller count than before means a new download and resets
 * the meter. The last measured speed stays available after a download ends.
 */
class ThroughputMeter(private val windowMillis: Long = 5_000) {
    private val samples = ArrayDeque<Pair<Long, Long>>()
    var lastBytesPerSecond: Long? = null
        private set
    var lastSampleAt: Long = 0
        private set

    fun observe(bytes: Long, nowMillis: Long) {
        if (samples.isNotEmpty() && bytes < samples.last().second) samples.clear()
        samples.addLast(nowMillis to bytes)
        while (samples.size > 2 && nowMillis - samples.first().first > windowMillis) samples.removeFirst()
        lastSampleAt = nowMillis
        val first = samples.first()
        val elapsed = nowMillis - first.first
        if (elapsed >= 500 && bytes > first.second) {
            lastBytesPerSecond = (bytes - first.second) * 1_000 / elapsed
        }
    }

    /** True when bytes arrived recently. */
    fun active(nowMillis: Long): Boolean = lastSampleAt > 0 && nowMillis - lastSampleAt < 3_000
}

object DiagnosticsFormat {
    private val units = listOf("Б", "КБ", "МБ", "ГБ", "ТБ")

    fun bytes(value: Long): String {
        if (value < 1024) return "$value Б"
        var size = value.toDouble()
        var unit = 0
        while (size >= 1024 && unit < units.lastIndex) {
            size /= 1024
            unit++
        }
        return String.format(Locale.US, if (size >= 100) "%.0f %s" else "%.1f %s", size, units[unit])
    }

    fun speed(bytesPerSecond: Long): String {
        val bits = bytesPerSecond * 8
        return if (bits >= 1_000_000) {
            String.format(Locale.US, "%.1f Мбит/с", bits / 1_000_000.0)
        } else {
            String.format(Locale.US, "%.0f Кбит/с", bits / 1_000.0)
        }
    }

    fun duration(millis: Long): String {
        val total = Duration.ofMillis(millis.coerceAtLeast(0))
        val days = total.toDays()
        val hours = total.toHours() % 24
        val minutes = total.toMinutes() % 60
        val seconds = total.seconds % 60
        return when {
            days > 0 -> "${days} д ${hours} ч"
            hours > 0 -> "${hours} ч ${minutes} мин"
            minutes > 0 -> "${minutes} мин ${seconds} с"
            else -> "${seconds} с"
        }
    }

    /** Local time of the next change and how long until it, e.g. "18:00 (через 2 ч 5 мин)". */
    fun nextChange(at: Instant?, now: Instant, zone: ZoneId = ZoneId.systemDefault()): String {
        if (at == null) return "не запланирована"
        val local = at.atZone(zone)
        val today = now.atZone(zone).toLocalDate()
        val pattern = if (local.toLocalDate() == today) "HH:mm" else "dd.MM HH:mm"
        val formatted = local.format(DateTimeFormatter.ofPattern(pattern))
        val left = Duration.between(now, at).toMillis()
        return if (left > 0) "$formatted (через ${duration(left)})" else formatted
    }

    fun source(value: String): String = when (value) {
        "schedule" -> "по расписанию"
        "takeover" -> "экстренный показ"
        "quick_present" -> "быстрый показ"
        "direct_fallback" -> "назначен экрану"
        "none", "" -> "нет"
        else -> value
    }
}
