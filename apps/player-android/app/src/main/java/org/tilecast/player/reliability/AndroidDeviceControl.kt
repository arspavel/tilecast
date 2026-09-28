package org.tilecast.player.reliability

import android.content.Context
import android.media.AudioManager
import org.tilecast.player.MainActivity

class AndroidDeviceControl(private val context: Context) {
    private val audio =
        context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private val preferences =
        context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

    fun setVolume(percent: Int): Int {
        val requested = percent.coerceIn(0, 100)
        val maximum = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
            .coerceAtLeast(1)
        val value = ((requested / 100f) * maximum).toInt()
            .coerceIn(0, maximum)
        audio.setStreamVolume(AudioManager.STREAM_MUSIC, value, 0)
        return currentVolume()
    }

    fun currentVolume(): Int {
        val maximum = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
            .coerceAtLeast(1)
        return (
            audio.getStreamVolume(AudioManager.STREAM_MUSIC) * 100f / maximum
        ).toInt().coerceIn(0, 100)
    }

    fun mute(): Int {
        audio.adjustStreamVolume(
            AudioManager.STREAM_MUSIC,
            AudioManager.ADJUST_MUTE,
            0,
        )
        return 0
    }

    fun unmute(): Int {
        audio.adjustStreamVolume(
            AudioManager.STREAM_MUSIC,
            AudioManager.ADJUST_UNMUTE,
            0,
        )
        return currentVolume()
    }

    fun setBrightness(percent: Int): Int {
        val value = percent.coerceIn(1, 100)
        preferences.edit().putInt(KEY_BRIGHTNESS, value).apply()
        MainActivity.applyRemoteBrightness(value)
        return value
    }

    companion object {
        private const val PREFERENCES = "tilecast-device-control"
        private const val KEY_BRIGHTNESS = "brightness"

        fun savedBrightness(context: Context): Int =
            context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
                .getInt(KEY_BRIGHTNESS, 100)
                .coerceIn(1, 100)
    }
}
