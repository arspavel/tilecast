package org.tilecast.player.reliability

import android.app.ActivityOptions
import android.app.AlarmManager
import android.app.PendingIntent
import android.app.admin.DeviceAdminReceiver
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.os.SystemClock
import org.tilecast.player.MainActivity

/**
 * Device-owner admin component. Provisioning is a deliberate local step:
 * `adb shell dpm set-device-owner org.tilecast.player/.reliability.TilecastDeviceAdminReceiver`
 * on a device without accounts. Tilecast never attempts it silently.
 */
class TilecastDeviceAdminReceiver : DeviceAdminReceiver() {
    override fun onEnabled(context: Context, intent: Intent) {
        ManagedKiosk.apply(context, ManagedKiosk.lastRequested(context), force = true)
    }
}

/**
 * Applies the Managed Kiosk platform state. As device owner, Tilecast allows
 * itself into lock task, becomes the persistent Home activity (Android then
 * relaunches it whenever its process dies), and disables keyguard and the
 * status bar. Without device owner, kiosk mode only offers Tilecast as a Home
 * app so an administrator can select it once in the Home chooser.
 */
object ManagedKiosk {
    private const val PREFERENCES = "tilecast-reliability"
    private const val HOME_ALIAS = "org.tilecast.player.KioskHome"

    fun admin(context: Context) = ComponentName(context, TilecastDeviceAdminReceiver::class.java)

    fun lastRequested(context: Context): Boolean =
        context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).getBoolean("kiosk-requested", false)

    fun apply(context: Context, requested: Boolean, force: Boolean = false) {
        val store = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
        val dpm = context.getSystemService(DevicePolicyManager::class.java)
        val owner = runCatching { dpm.isDeviceOwnerApp(context.packageName) }.getOrDefault(false)
        val signature = "$requested|$owner"
        if (!force && store.getString("kiosk-applied", null) == signature) return
        setHomeAliasEnabled(context, requested)
        if (owner) {
            val admin = admin(context)
            runCatching { dpm.setLockTaskPackages(admin, arrayOf(context.packageName)) }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                runCatching { dpm.setLockTaskFeatures(admin, DevicePolicyManager.LOCK_TASK_FEATURE_NONE) }
            }
            runCatching { dpm.setKeyguardDisabled(admin, requested) }
            runCatching { dpm.setStatusBarDisabled(admin, requested) }
            runCatching {
                if (requested) {
                    val home = IntentFilter(Intent.ACTION_MAIN).apply {
                        addCategory(Intent.CATEGORY_HOME)
                        addCategory(Intent.CATEGORY_DEFAULT)
                    }
                    dpm.addPersistentPreferredActivity(admin, home, ComponentName(context.packageName, HOME_ALIAS))
                } else {
                    dpm.clearPackagePersistentPreferredActivities(admin, context.packageName)
                }
            }
        }
        store.edit().putBoolean("kiosk-requested", requested).putString("kiosk-applied", signature).apply()
    }

    private fun setHomeAliasEnabled(context: Context, enabled: Boolean) {
        runCatching {
            context.packageManager.setComponentEnabledSetting(
                ComponentName(context.packageName, HOME_ALIAS),
                if (enabled) PackageManager.COMPONENT_ENABLED_STATE_ENABLED else PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                PackageManager.DONT_KILL_APP,
            )
        }
    }
}

/** Bounds automatic relaunches so a crash on startup cannot become a restart loop. */
class CrashRelaunchPolicy(private val maximumRelaunches: Int, private val windowMillis: Long) {
    fun shouldRelaunch(history: List<Long>, now: Long): Boolean =
        history.count { it > now - windowMillis } < maximumRelaunches

    fun record(history: List<Long>, now: Long): List<Long> =
        (history.filter { it > now - windowMillis } + now).takeLast(maximumRelaunches)
}

object PlayerRelaunch {
    private const val PREFERENCES = "tilecast-reliability"

    /** Schedules MainActivity to start again after the current process has gone. */
    fun schedule(context: Context, delayMillis: Long, requestCode: Int = 4040) {
        val alarm = context.getSystemService(AlarmManager::class.java)
        val intent = Intent()
            .setClass(context, MainActivity::class.java)
            .setPackage(context.packageName)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        val options = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            ActivityOptions.makeBasic()
                .setPendingIntentCreatorBackgroundActivityStartMode(ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED)
                .toBundle()
        } else {
            null
        }
        val pending = PendingIntent.getActivity(
            context,
            requestCode,
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            options,
        )
        // A short window avoids the exact-alarm permission that Android 12+ requires for setExact.
        alarm.setWindow(AlarmManager.ELAPSED_REALTIME_WAKEUP, SystemClock.elapsedRealtime() + delayMillis, 3_000, pending)
    }

    /**
     * Installs a process-wide handler that schedules a bounded relaunch before
     * the default handler terminates the process. Maintenance sessions and
     * player updates are never interrupted by a relaunch.
     */
    fun installCrashHandler(context: Context) {
        val app = context.applicationContext
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            runCatching { onCrash(app) }
            previous?.uncaughtException(thread, error)
        }
    }

    private fun onCrash(context: Context) {
        val store = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
        if (store.getLong("maintenance-until", 0) > System.currentTimeMillis()) return
        if (store.getBoolean("update-active", false)) return
        val now = System.currentTimeMillis()
        val history = store.getString("crash-relaunch-history", "").orEmpty()
            .split(',').mapNotNull { it.toLongOrNull() }
        val policy = CrashRelaunchPolicy(maximumRelaunches = 3, windowMillis = 10 * 60_000L)
        if (!policy.shouldRelaunch(history, now)) {
            store.edit().putString("crash-relaunch-state", "loop_prevented").commit()
            return
        }
        store.edit()
            .putString("crash-relaunch-history", policy.record(history, now).joinToString(","))
            .putString("crash-relaunch-state", "relaunch_scheduled")
            .putLong("last-crash-at", now)
            .commit()
        schedule(context, delayMillis = 2_000, requestCode = 4041)
    }
}
