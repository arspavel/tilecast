package org.tilecast.player.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.tilecast.player.diagnostics.DiagnosticsFormat
import org.tilecast.player.diagnostics.PlayerDiagnostics
import java.time.Instant

private const val OVERLAY_ALPHA = 0.42f
private val overlayText = TextStyle(
    color = Color.White,
    fontSize = 15.sp,
    lineHeight = 21.sp,
    fontFamily = FontFamily.SansSerif,
    shadow = Shadow(Color.Black, Offset(1f, 1f), 3f),
)

/**
 * Faint service information over whatever the screen shows. It refreshes
 * every second and measures the server round trip every five seconds while
 * it is visible.
 */
@Composable
fun PlayerInfoOverlay(snapshot: () -> PlayerDiagnostics, measureLatency: suspend () -> Unit) {
    var info by remember { mutableStateOf(snapshot()) }
    var now by remember { mutableStateOf(Instant.now()) }
    LaunchedEffect(Unit) {
        launch {
            while (true) {
                measureLatency()
                delay(5_000)
            }
        }
        while (true) {
            info = snapshot()
            now = Instant.now()
            delay(1_000)
        }
    }
    Box(Modifier.fillMaxSize().padding(start = 36.dp, bottom = 28.dp), contentAlignment = Alignment.BottomStart) {
        Column(Modifier.widthIn(max = 620.dp).alpha(OVERLAY_ALPHA)) {
            infoLines(info, now).forEach { Text(it, style = overlayText) }
            info.syncFraction?.let { fraction ->
                Spacer(Modifier.height(6.dp))
                Box(Modifier.width(320.dp).height(4.dp).background(Color.White.copy(alpha = 0.25f))) {
                    Box(Modifier.width(320.dp * fraction).height(4.dp).background(Color.White))
                }
            }
        }
    }
}

internal fun infoLines(info: PlayerDiagnostics, now: Instant): List<String> {
    val lines = mutableListOf<String>()
    val inventory = info.inventoryNumber?.takeIf { it.isNotBlank() }?.let { " · инв. № $it" }.orEmpty()
    lines += "Экран: ${info.screenName ?: "не привязан"}$inventory · LSR signage ${info.playerVersion}"
    val connection = if (info.connected) {
        "на связи ${DiagnosticsFormat.duration(info.connectedForMillis)}"
    } else {
        "нет связи"
    }
    lines += "Сервер: ${info.serverHost ?: "—"} · $connection"
    val latency = info.latencyMillis?.let { "задержка $it мс" } ?: info.latencyError?.let { "ошибка: $it" } ?: "задержка …"
    val speed = info.downloadBytesPerSecond?.let {
        (if (info.downloading) "загрузка " else "последняя загрузка ") + DiagnosticsFormat.speed(it)
    }
    lines += "Соединение: " + listOfNotNull(latency, speed).joinToString(" · ")
    val content = info.contentName?.let { name ->
        val position = if (info.itemPosition != null && info.itemCount != null) "элемент ${info.itemPosition} из ${info.itemCount}" else null
        val details = listOfNotNull(position, DiagnosticsFormat.source(info.selectionSource)).joinToString(" · ")
        "$name ($details)"
    } ?: "нет активного контента"
    lines += "Плейлист: $content"
    lines += "Следующая смена: ${DiagnosticsFormat.nextChange(info.nextTransition, now)}"
    lines += "Хранилище: ${DiagnosticsFormat.bytes(info.cacheUsedBytes)} из ${DiagnosticsFormat.bytes(info.cacheLimitBytes)} · свободно ${DiagnosticsFormat.bytes(info.freeBytes)}"
    info.syncFraction?.let {
        lines += "Загрузка контента: ${(it * 100).toInt()}% · ${DiagnosticsFormat.bytes(info.syncDownloadedBytes)} из ${DiagnosticsFormat.bytes(info.syncRequiredBytes)} · файлов в очереди ${info.syncQueueCount}"
    }
    info.syncError?.let { lines += "Ошибка синхронизации: $it" }
    info.manifestVersion?.let { lines += "Версия манифеста: $it" }
    return lines
}
