package org.tilecast.player.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.tilecast.player.reliability.CommissioningStatus
import org.tilecast.player.reliability.CommissioningStep
import org.tilecast.player.ui.theme.SignalBlue
import org.tilecast.player.ui.theme.SignalButton
import org.tilecast.player.ui.theme.SignalMuted
import org.tilecast.player.ui.theme.SignalOutlinedButton
import org.tilecast.player.ui.theme.SignalText
import org.tilecast.player.ui.theme.SignalWarning

@Composable
fun CommissioningScreen(
    state: CommissioningStatus,
    setPin: (CharArray) -> Unit,
    openAccessibility: () -> Unit,
    openInstallPermission: () -> Unit,
    refresh: () -> Unit,
    advance: () -> Unit,
    runSelfTest: () -> Unit,
    finish: () -> Unit,
) {
    val activeSteps = CommissioningStep.activeEntries
    val stepNumber = activeSteps.indexOf(state.step).coerceAtLeast(0) + 1
    Column(
        Modifier.fillMaxSize().padding(horizontal = 80.dp, vertical = 54.dp),
        verticalArrangement = Arrangement.SpaceBetween,
    ) {
        Column(Modifier.fillMaxWidth(.82f)) {
            Text("Подготовка плеера к работе без присмотра", color = SignalText, fontSize = 42.sp, fontWeight = FontWeight.SemiBold)
            Text("Мастер проверяет возможности Android, которые нужны для работы без присмотра.", color = SignalMuted, fontSize = 20.sp)
            Spacer(Modifier.height(28.dp))
            Text("Шаг $stepNumber из ${activeSteps.size}", color = SignalBlue, fontSize = 16.sp)
            Spacer(Modifier.height(12.dp))
            CommissioningStepBody(state, setPin, openAccessibility, openInstallPermission, refresh, advance, runSelfTest)
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.CenterVertically) {
            when (state.step) {
                CommissioningStep.RESULT -> SignalButton(onClick = finish) { Text("Завершить настройку") }
                CommissioningStep.ADMIN_PIN -> Unit
                CommissioningStep.ACCESSIBILITY -> SignalButton(onClick = advance, enabled = !state.accessibilitySupported || state.accessibilityEnabled) { Text("Продолжить") }
                CommissioningStep.INSTALL_PERMISSION -> SignalButton(onClick = advance, enabled = state.installPermissionGranted) { Text("Продолжить") }
                CommissioningStep.BOOT_RECOVERY -> SignalButton(onClick = advance, enabled = state.bootLaunchVerified) { Text("Продолжить") }
                CommissioningStep.PRESENTATION -> SignalButton(
                    onClick = advance,
                    enabled = !state.presentationVerificationRequired || (state.immersiveVerified && state.keepAwakeVerified),
                ) { Text(if (state.presentationVerificationRequired) "Продолжить" else "Продолжить с предупреждением") }
                CommissioningStep.SELF_TEST -> SignalButton(onClick = advance, enabled = state.selfTestResult != null) { Text("Показать результат") }
                CommissioningStep.CACHED_FALLBACK -> Unit
            }
        }
    }
}

@Composable
private fun CommissioningStepBody(
    state: CommissioningStatus,
    setPin: (CharArray) -> Unit,
    openAccessibility: () -> Unit,
    openInstallPermission: () -> Unit,
    refresh: () -> Unit,
    advance: () -> Unit,
    runSelfTest: () -> Unit,
) {
    when (state.step) {
        CommissioningStep.ADMIN_PIN -> {
            var pin by remember { mutableStateOf("") }
            Text("Задайте PIN администратора", color = SignalText, fontSize = 30.sp)
            Text("PIN открывает только меню обслуживания LSR signage и хранится в виде защищённого хеша.", color = SignalMuted, fontSize = 18.sp)
            Spacer(Modifier.height(18.dp))
            OutlinedTextField(
                value = pin,
                onValueChange = { pin = it.filter(Char::isDigit).take(12) },
                label = { Text("PIN из 4–12 цифр") },
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                singleLine = true,
            )
            Spacer(Modifier.height(12.dp))
            SignalButton(
                onClick = {
                    setPin(pin.toCharArray())
                    pin = ""
                    advance()
                },
                enabled = pin.length >= 4,
            ) { Text(if (state.adminPinSet) "Сменить PIN" else "Задать PIN") }
        }
        CommissioningStep.ACCESSIBILITY -> {
            if (!state.accessibilitySupported) {
                Text("На Fire TV служба специальных возможностей необязательна", color = SignalText, fontSize = 30.sp)
                Text(
                    "В Fire OS нет стандартного экрана Android для включения службы специальных возможностей LSR signage. Можно продолжить без неё или включить её вручную через ADB командой, которая показана в LSR signage в карточке этого экрана.",
                    color = SignalMuted,
                    fontSize = 18.sp,
                )
                Spacer(Modifier.height(14.dp))
                if (state.accessibilityEnabled) {
                    StatusLine("Служба специальных возможностей (включена через ADB)", true)
                } else {
                    Text("Необязательно: включите отладку по ADB на Fire TV, выполните команду из Studio и нажмите «Проверить снова».", color = SignalWarning, fontSize = 17.sp)
                }
            } else {
                CapabilityStep(
                    "Включите службу специальных возможностей",
                    "LSR signage использует службу специальных возможностей только чтобы заметить постороннее приложение на экране, вернуться к показу и попросить Android заблокировать экран. Служба не может подтверждать диалоги или нажимать кнопки в настройках.",
                    state.accessibilityEnabled,
                    "Открыть специальные возможности",
                    openAccessibility,
                    refresh,
                )
            }
        }
        CommissioningStep.INSTALL_PERMISSION -> CapabilityStep(
            "Разрешите обновления плеера",
            "Выдайте это разрешение Android один раз, чтобы LSR signage мог устанавливать свои проверенные обновления. На Android 12 и новее обновление проходит без участия человека; на старых версиях установку может понадобиться подтвердить на устройстве.",
            state.installPermissionGranted,
            "Открыть разрешение на установку",
            openInstallPermission,
            refresh,
        )
        CommissioningStep.BOOT_RECOVERY -> CapabilityStep(
            "Проверьте запуск после включения",
            "Перезагрузите устройство один раз. LSR signage зафиксирует сигнал загрузки, попытки запуска и успешный выход на экран. Если прошивка блокирует автозапуск, шаг останется непроверенным.",
            state.bootLaunchVerified,
            "Проверить результат",
            refresh,
            refresh,
        )
        CommissioningStep.PRESENTATION -> {
            Text("Проверьте полноэкранный режим", color = SignalText, fontSize = 30.sp)
            StatusLine("Полноэкранный режим", state.immersiveVerified)
            StatusLine("Экран не гаснет", state.keepAwakeVerified)
            if (!state.presentationVerificationRequired && (!state.immersiveVerified || !state.keepAwakeVerified)) {
                Text(
                    "Устройство не определяется как Android TV. Некоторые прошивки для телефонов и планшетов не сообщают признаки ТВ-режима, поэтому можно продолжить и проверить полноэкранный показ на самом устройстве.",
                    color = SignalWarning,
                    fontSize = 17.sp,
                )
            }
            SignalOutlinedButton(onClick = refresh) { Text("Проверить снова") }
        }
        CommissioningStep.SELF_TEST -> {
            Text("Проверка готовности к работе без присмотра", color = SignalText, fontSize = 30.sp)
            Text("Тест проверяет PIN, защищённые разрешения Android, данные о загрузке и состояние восстановления, не меняя системных настроек.", color = SignalMuted, fontSize = 18.sp)
            state.selfTestResult?.let { Text(resultLabel(it), color = if (it == "passed") SignalBlue else SignalWarning, fontSize = 20.sp) }
            Spacer(Modifier.height(14.dp))
            SignalButton(onClick = runSelfTest) { Text("Запустить проверку") }
        }
        CommissioningStep.RESULT -> {
            Text("Готовность к работе без присмотра", color = SignalText, fontSize = 30.sp)
            Text(resultLabel(state.readiness), color = if (state.readiness == "ready") SignalBlue else SignalWarning, fontSize = 26.sp, fontWeight = FontWeight.SemiBold)
            Text("«Готов» означает, что пройдены все проверки, доступные на устройстве. Частичная готовность отмечается в Studio и не гарантирует восстановления после сбоев питания, сети, оборудования или подтверждений Android.", color = SignalMuted, fontSize = 18.sp)
        }
        CommissioningStep.CACHED_FALLBACK -> Unit
    }
}

@Composable
private fun CapabilityStep(title: String, description: String, verified: Boolean, action: String, open: () -> Unit, refresh: () -> Unit) {
    Text(title, color = SignalText, fontSize = 30.sp)
    Text(description, color = SignalMuted, fontSize = 18.sp)
    StatusLine("Проверка", verified)
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        SignalButton(onClick = open) { Text(action) }
        SignalOutlinedButton(onClick = refresh) { Text("Проверить снова") }
    }
}

private fun resultLabel(code: String) = when (code) {
    "passed" -> "Проверка пройдена"
    "completed_with_warnings" -> "Проверка завершена с предупреждениями"
    "ready" -> "Готов"
    "partially_ready" -> "Готов частично"
    "needs_setup" -> "Требуется настройка"
    else -> code.replace('_', ' ')
}

@Composable
private fun StatusLine(label: String, verified: Boolean) {
    Text("$label: ${if (verified) "проверено" else "не проверено"}", color = if (verified) SignalBlue else SignalWarning, fontSize = 19.sp, modifier = Modifier.padding(vertical = 12.dp))
}
