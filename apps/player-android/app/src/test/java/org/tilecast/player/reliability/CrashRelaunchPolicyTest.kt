package org.tilecast.player.reliability

import org.junit.Assert.*
import org.junit.Test

class CrashRelaunchPolicyTest {
    private val window = 10 * 60_000L
    @Test fun relaunchesUntilTheLimitWithinTheWindow(){val policy=CrashRelaunchPolicy(3,window);var history=emptyList<Long>();val now=1_000_000L;repeat(3){assertTrue(policy.shouldRelaunch(history,now+it));history=policy.record(history,now+it)};assertFalse(policy.shouldRelaunch(history,now+10))}
    @Test fun oldCrashesLeaveTheWindow(){val policy=CrashRelaunchPolicy(3,window);val now=5_000_000L;val history=listOf(now-window-3,now-window-2,now-window-1);assertTrue(policy.shouldRelaunch(history,now));assertEquals(listOf(now),policy.record(history,now))}
    @Test fun historyStaysBounded(){val policy=CrashRelaunchPolicy(3,window);val now=9_000_000L;assertEquals(3,policy.record(listOf(now-4,now-3,now-2,now-1),now).size)}
}
