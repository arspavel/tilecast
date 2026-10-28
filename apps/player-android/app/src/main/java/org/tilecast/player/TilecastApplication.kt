package org.tilecast.player

import android.app.Application
import android.webkit.WebView
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import org.tilecast.player.reliability.PlayerRelaunch
import org.tilecast.player.work.HeartbeatWorker
import java.util.Locale
import java.util.concurrent.TimeUnit

class TilecastApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        // The player is shown to Russian-speaking guests whatever language the
        // device firmware ships with, so widget dates, weekdays and numbers
        // follow Russian conventions. Nothing sent to the server depends on it:
        // JSON, ISO timestamps and hex digests are locale-independent.
        Locale.setDefault(Locale.forLanguageTag("ru-RU"))
        PlayerRelaunch.installCrashHandler(this)
        WebView.setWebContentsDebuggingEnabled(false)
        val request = PeriodicWorkRequestBuilder<HeartbeatWorker>(15, TimeUnit.MINUTES)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        WorkManager.getInstance(this).enqueueUniquePeriodicWork("tilecast-heartbeat", ExistingPeriodicWorkPolicy.UPDATE, request)
    }
}
