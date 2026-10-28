package org.tilecast.player.diagnostics

import org.junit.Assert.*
import org.junit.Test
import org.tilecast.player.ui.infoLines
import java.time.Instant
import java.time.ZoneOffset

class PlayerDiagnosticsTest {
    @Test fun meterReportsRecentSpeedAndResetsOnANewDownload(){val meter=ThroughputMeter(5_000);meter.observe(0,0);meter.observe(1_000_000,1_000);assertEquals(1_000_000L,meter.lastBytesPerSecond);assertTrue(meter.active(2_000));assertFalse(meter.active(10_000));meter.observe(100,11_000);meter.observe(500_100,12_000);assertEquals(500_000L,meter.lastBytesPerSecond)}
    @Test fun formatsBytesSpeedAndDuration(){assertEquals("512 Б",DiagnosticsFormat.bytes(512));assertEquals("1.5 КБ",DiagnosticsFormat.bytes(1536));assertEquals("8.0 ГБ",DiagnosticsFormat.bytes(8L*1024*1024*1024));assertEquals("80.0 Мбит/с",DiagnosticsFormat.speed(10_000_000));assertEquals("800 Кбит/с",DiagnosticsFormat.speed(100_000));assertEquals("2 ч 5 мин",DiagnosticsFormat.duration(7_500_000));assertEquals("45 с",DiagnosticsFormat.duration(45_000))}
    @Test fun formatsTheNextChange(){val now=Instant.parse("2026-10-27T10:00:00Z");assertEquals("не запланирована",DiagnosticsFormat.nextChange(null,now,ZoneOffset.UTC));assertEquals("12:05 (через 2 ч 5 мин)",DiagnosticsFormat.nextChange(Instant.parse("2026-10-27T12:05:00Z"),now,ZoneOffset.UTC));assertEquals("28.10 09:00 (через 23 ч 0 мин)",DiagnosticsFormat.nextChange(Instant.parse("2026-10-28T09:00:00Z"),now,ZoneOffset.UTC))}
    @Test fun progressOnlyWhileDownloading(){assertNull(PlayerDiagnostics(syncRequiredBytes=100,syncDownloadedBytes=100).syncFraction);assertEquals(0.25f,PlayerDiagnostics(syncRequiredBytes=400,syncDownloadedBytes=100,syncQueueCount=3).syncFraction!!,0.001f)}
    @Test fun overlayLinesNameTheContentAndProgress(){val lines=infoLines(PlayerDiagnostics(screenName="Холл 1",serverHost="arspavel.ru",connected=true,connectedForMillis=65_000,latencyMillis=42,downloadBytesPerSecond=2_000_000,downloading=true,contentName="Утро",selectionSource="schedule",itemPosition=2,itemCount=5,syncQueueCount=2,syncDownloadedBytes=50,syncRequiredBytes=200,playerVersion="0.34.0"),Instant.now());assertTrue(lines.any{it=="Плейлист: Утро (элемент 2 из 5 · по расписанию)"});assertTrue(lines.any{it.startsWith("Соединение: задержка 42 мс · загрузка 16.0 Мбит/с")});assertTrue(lines.any{it.startsWith("Загрузка контента: 25%")});assertTrue(lines.any{it.contains("на связи 1 мин 5 с")})}
    @Test fun firstLineShowsTheInventoryNumberWhenSet(){
        assertEquals("Экран: LP1 · инв. № ИНВ-0042 · Tilecast 0.36.0",infoLines(PlayerDiagnostics(screenName="LP1",inventoryNumber="ИНВ-0042",playerVersion="0.36.0"),Instant.now()).first())
        assertEquals("Экран: LP1 · Tilecast 0.36.0",infoLines(PlayerDiagnostics(screenName="LP1",inventoryNumber=" ",playerVersion="0.36.0"),Instant.now()).first())
    }
}
