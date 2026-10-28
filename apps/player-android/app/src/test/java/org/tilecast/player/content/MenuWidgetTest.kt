package org.tilecast.player.content

import org.junit.Assert.assertEquals
import org.junit.Test

class MenuWidgetTest {
    @Test fun humanizesCommonLunchFields() {
        assertEquals("Основное блюдо", menuFieldLabel("option_1"))
        assertEquals("Другой вариант", menuFieldLabel("option_2"))
        assertEquals("Side Dish", menuFieldLabel("side_dish"))
    }
}
