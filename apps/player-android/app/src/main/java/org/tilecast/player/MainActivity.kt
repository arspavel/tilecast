package org.tilecast.player

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Bundle
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.SystemClock
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import android.provider.Settings
import android.net.Uri
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.activity.compose.LocalActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.content.ContextCompat
import androidx.compose.animation.Crossfade
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter
import kotlinx.coroutines.delay
import org.tilecast.player.core.DiscoveredServer
import org.tilecast.player.core.PlayerState
import org.tilecast.player.content.FullscreenPlayback
import org.tilecast.player.content.WithPluginBars
import org.tilecast.player.content.BrandedFallbackKind
import org.tilecast.player.content.resolveBrandedFallbackKind
import org.tilecast.player.preview.LivePreviewCoordinator
import org.tilecast.player.preview.LiveStreamCoordinator
import org.tilecast.player.preview.PlayerWindowCapture
import org.tilecast.player.reliability.ReliabilityController
import org.tilecast.player.ui.theme.SignalBackground
import org.tilecast.player.ui.theme.SignalBlue
import org.tilecast.player.ui.theme.SignalDanger
import org.tilecast.player.ui.theme.SignalDimensions
import org.tilecast.player.ui.theme.SignalMuted
import org.tilecast.player.ui.theme.SignalOutlinedButton
import org.tilecast.player.ui.theme.SignalText
import org.tilecast.player.ui.theme.SignalWarning
import org.tilecast.player.ui.theme.SignalButton
import org.tilecast.player.ui.theme.TilecastSignalTheme
import org.tilecast.player.ui.CommissioningScreen
import org.tilecast.player.ui.OutsideActiveHoursScreen
import org.tilecast.player.reliability.BootRecovery
import java.time.Instant
import java.time.Duration

class MainActivity : ComponentActivity() {
    companion object {
        @Volatile private var activeInstance: MainActivity? = null

        fun applyRemoteBrightness(percent: Int) {
            activeInstance?.runOnUiThread {
                activeInstance?.applyBrightness(percent)
            }
        }
    }

    private val model:PlayerViewModel by viewModels()
	private lateinit var reliability:ReliabilityController
	private lateinit var livePreview:LivePreviewCoordinator
	private lateinit var liveStream:LiveStreamCoordinator
	private var adminPrompt by mutableStateOf(false)
	private var infoOverlay by mutableStateOf(false)
	private val hideInfoOverlay=Runnable{infoOverlay=false}
	private val escapeKeys=ArrayDeque<Int>()
	private val reliabilityHandler=Handler(Looper.getMainLooper())
	private var restoreKiosk:Runnable?=null
	private val escapeSequence=listOf(KeyEvent.KEYCODE_BACK,KeyEvent.KEYCODE_BACK,KeyEvent.KEYCODE_DPAD_UP,KeyEvent.KEYCODE_DPAD_DOWN,KeyEvent.KEYCODE_DPAD_CENTER)
    private val clockReceiver=object:BroadcastReceiver(){override fun onReceive(context:Context?,intent:Intent?){model.recalculateSchedule()}}
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
		reliability=ReliabilityController(this)
		val captureSource=PlayerWindowCapture(this)
		livePreview=LivePreviewCoordinator(this,::previewCaptureBlockReason,captureSource=captureSource)
		liveStream=LiveStreamCoordinator(this,::previewCaptureBlockReason,model::sendLiveStreamFrame,captureSource=captureSource)
		model.onLiveStreamSessionChanged=liveStream::sessionChanged
		getSharedPreferences("tilecast-reliability",MODE_PRIVATE).edit().putBoolean("update-active",model.update.value?.state in setOf("waiting_for_permission","waiting_for_user","installing")).putBoolean("update-relaunch-requested",false).putInt("update-relaunch-attempts",0).apply()
        enableEdgeToEdge()
		WindowCompat.getInsetsController(window,window.decorView).hide(WindowInsetsCompat.Type.systemBars())
        setContent { TilecastSignalTheme { Box(Modifier.fillMaxSize()) {
			TilecastPlayer(model,adminPrompt,{adminPrompt=false},reliability)
			if(infoOverlay&&!adminPrompt)org.tilecast.player.ui.PlayerInfoOverlay(model::diagnostics,model::measureLatency)
		} } }
    }
    override fun onStart(){super.onStart();livePreview.start();liveStream.start();getSharedPreferences("tilecast-reliability",MODE_PRIVATE).edit().putBoolean("foreground",true).apply();ContextCompat.registerReceiver(this,clockReceiver,IntentFilter().apply{addAction(Intent.ACTION_TIME_CHANGED);addAction(Intent.ACTION_TIMEZONE_CHANGED)},ContextCompat.RECEIVER_NOT_EXPORTED);model.recalculateSchedule();model.refreshUpdatePermission();model.resumeUpdateSchedule();model.playerConfig.value?.let{reliability.applyWindow(this,it,model.activeHours.value)};reliabilityHandler.postDelayed({BootRecovery.markForegroundHealthy(this);model.refreshCommissioning()},5000)}
    override fun onResume(){
        super.onResume()
        activeInstance=this
        applyBrightness(
            org.tilecast.player.reliability.AndroidDeviceControl
                .savedBrightness(this),
        )
        model.refreshCommissioning()
    }

    override fun onPause(){
        if(activeInstance===this)activeInstance=null
        super.onPause()
    }

    private fun applyBrightness(percent:Int){
        val attributes=window.attributes
        attributes.screenBrightness=percent.coerceIn(1,100)/100f
        window.attributes=attributes
    }
    override fun onStop(){livePreview.stop();liveStream.stop();getSharedPreferences("tilecast-reliability",MODE_PRIVATE).edit().putBoolean("foreground",false).putLong("last-foreground-exit",System.currentTimeMillis()).apply();unregisterReceiver(clockReceiver);super.onStop()}
    override fun onDestroy(){model.onLiveStreamSessionChanged=null;livePreview.close();liveStream.close();super.onDestroy()}
    override fun onWindowFocusChanged(hasFocus:Boolean){super.onWindowFocusChanged(hasFocus);if(hasFocus)model.playerConfig.value?.let{reliability.applyWindow(this,it,model.activeHours.value)}}
    override fun onKeyDown(keyCode:Int,event:KeyEvent?):Boolean {escapeKeys.addLast(keyCode);while(escapeKeys.size>escapeSequence.size)escapeKeys.removeFirst();if(escapeKeys.toList()==escapeSequence){escapeKeys.clear();infoOverlay=false;adminPrompt=true;return true};if(keyCode==KeyEvent.KEYCODE_DPAD_UP&&!adminPrompt){toggleInfoOverlay();return true};return if(keyCode==KeyEvent.KEYCODE_BACK)true else super.onKeyDown(keyCode,event)}
	/** Remote Up shows faint service information; it hides itself after 30 seconds. */
	private fun toggleInfoOverlay(){reliabilityHandler.removeCallbacks(hideInfoOverlay);infoOverlay=!infoOverlay;if(infoOverlay)reliabilityHandler.postDelayed(hideInfoOverlay,30_000)}
	fun openSystemSettings(action:String){val intent=Intent(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);if(action==Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)intent.data=Uri.parse("package:$packageName");runCatching{startActivity(intent)}}
	fun restartPlayer(){model.shutdownForRestart();startActivity(Intent(this,MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TASK or Intent.FLAG_ACTIVITY_NEW_TASK));finish()}
	fun installPlayerUpdate(){runCatching{stopLockTask()};getSharedPreferences("tilecast-reliability",MODE_PRIVATE).edit().putBoolean("update-active",true).apply();model.installUpdate()}
	fun applyReliability(config:org.tilecast.player.network.PlayerConfig,activeHours:Boolean){reliability.applyWindow(this,config,activeHours);restoreKiosk?.let(reliabilityHandler::removeCallbacks);reliability.maintenanceUntil()?.let{until->Runnable{reliability.applyWindow(this,config,activeHours)}.also{restoreKiosk=it;reliabilityHandler.postDelayed(it,Duration.between(Instant.now(),until).toMillis().coerceAtLeast(0)+100)}}}
	fun maintenanceChanged(){model.playerConfig.value?.let{applyReliability(it,model.activeHours.value)}}
	private fun previewCaptureBlockReason():String?=when{
		adminPrompt->"sensitive_admin"
		reliability.maintenanceUntil()!=null->"sensitive_maintenance"
		model.commissioning.value.required->"sensitive_commissioning"
		model.update.value?.state in setOf("waiting_for_permission","waiting_for_user","installing")->"sensitive_update"
		model.identify.value!=null->"sensitive_identify"
		model.state.value !is PlayerState.PairedIdle->"sensitive_pairing"
		else->null
	}
}

@Composable fun TilecastPlayer(model: PlayerViewModel,adminPrompt:Boolean=false,dismissAdmin:()->Unit={},reliability:ReliabilityController?=null) {
    val state by model.state.collectAsStateWithLifecycle()
	val content by model.content.collectAsStateWithLifecycle()
	val noContentKnown by model.noContentKnown.collectAsStateWithLifecycle()
	val unavailableKnown by model.unavailableKnown.collectAsStateWithLifecycle()
	val noContentLogoPath by model.noContentLogoPath.collectAsStateWithLifecycle()
	val disabled by model.playbackDisabled.collectAsStateWithLifecycle()
	val remoteSleep by model.remoteSleep.collectAsStateWithLifecycle()
	val identify by model.identify.collectAsStateWithLifecycle()
	val config by model.playerConfig.collectAsStateWithLifecycle()
	val update by model.update.collectAsStateWithLifecycle()
	val activeHours by model.activeHours.collectAsStateWithLifecycle()
	val safeMode by model.safeMode.collectAsStateWithLifecycle()
	val commissioning by model.commissioning.collectAsStateWithLifecycle()
	val brandedBackground=config?.branding?.backgroundColor?.let{runCatching{Color(android.graphics.Color.parseColor(it))}.getOrNull()}?:SignalBackground
	val brandedText=config?.branding?.textColor?.let{runCatching{Color(android.graphics.Color.parseColor(it))}.getOrNull()}?:SignalText
	val activity=LocalActivity.current as? MainActivity
	LaunchedEffect(config,activeHours){config?.let{activity?.applyReliability(it,activeHours)}}
	if(adminPrompt&&reliability!=null){AdministratorMaintenance(reliability,dismissAdmin);return}
	if(remoteSleep){Box(Modifier.fillMaxSize().background(Color.Black));return}
	if(commissioning.required){CommissioningScreen(commissioning,model::setCommissioningPin,{activity?.openSystemSettings(Settings.ACTION_ACCESSIBILITY_SETTINGS)},{activity?.openSystemSettings(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)},model::refreshCommissioning,model::advanceCommissioning,{model.runSelfTest(); Unit},model::completeCommissioning);return}
	if(identify!=null){Box(Modifier.fillMaxSize().background(Color.Black),contentAlignment=Alignment.Center){Text(identify!!,color=Color.White,style=MaterialTheme.typography.displayLarge)};return}
	if(update?.state in setOf("waiting_for_permission","waiting_for_user","installing")){UpdateApproval(update!!,model::openUpdatePermission,{activity?.installPlayerUpdate()?:model.installUpdate()});return}
	if(safeMode){Box(Modifier.fillMaxSize().background(brandedBackground),contentAlignment=Alignment.Center){Column(horizontalAlignment=Alignment.CenterHorizontally){TilecastBrand();Spacer(Modifier.height(28.dp));Text("Режим восстановления плеера",color=brandedText,style=MaterialTheme.typography.headlineLarge);Text("Плеер остаётся привязанным и на связи. Повторите попытку из Studio или из меню обслуживания на устройстве.",color=brandedText)}};return}
	if(!activeHours){OutsideActiveHoursScreen(config?.power,config?.branding,brandedText);return}
	val fallbackKind = resolveBrandedFallbackKind(content != null, disabled, noContentKnown, unavailableKnown, (state as? PlayerState.PairedIdle)?.connected == true)
	if (fallbackKind == BrandedFallbackKind.ASSIGNED_CONTENT && content != null) {
		// A bar rides above playback from the cached manifest, so a countdown keeps
		// appearing on schedule — and an alert ticker keeps its own expiry — even
		// while the server is unreachable.
		WithPluginBars(content!!.content.manifest.plugins, content!!.content.serverClockOffsetMillis) {
			FullscreenPlayback(content!!, model::playbackBoundary, model::playbackError,model::websitePlaybackStatus,model::widgetPlaybackStatus,model::playbackProgress)
		}
		return
	}
	if(fallbackKind == BrandedFallbackKind.DISABLED){BrandedStatusScreen(config?.branding, noContentLogoPath, config?.branding?.disabledTitle?:"Показ отключён", config?.branding?.disabledMessage?:"Экран остаётся на связи с Tilecast Studio.", "disabled", brandedBackground, brandedText);return}
	if(fallbackKind == BrandedFallbackKind.OFFLINE){BrandedStatusScreen(config?.branding, noContentLogoPath, "Нет связи с сервером", "Ожидание сервера Tilecast. Пока сервер недоступен, назначенный контент не меняется.", "offline", brandedBackground, brandedText);return}
	if(fallbackKind == BrandedFallbackKind.UNAVAILABLE){BrandedStatusScreen(config?.branding, noContentLogoPath, "Контент недоступен", "Назначенный контент сейчас недоступен.", "unavailable", brandedBackground, brandedText);return}
	if(fallbackKind == BrandedFallbackKind.NO_CONTENT){NoContentScreen(config?.branding,noContentLogoPath,brandedBackground,brandedText);return}
	val stateBackground = if (state is PlayerState.PairedIdle) brandedBackground else SignalBackground
	Box(Modifier.fillMaxSize().background(stateBackground).padding(horizontal = SignalDimensions.ScreenHorizontal, vertical = SignalDimensions.ScreenVertical)) {
        Column(Modifier.fillMaxSize()) {
            TilecastBrand()
            Spacer(Modifier.height(42.dp))
            Crossfade(state, label = "player-state") { current ->
                when (current) {
                    PlayerState.Unconfigured, PlayerState.Discovering -> LoadingState("Поиск серверов Tilecast…")
                    is PlayerState.ServerSelection -> ServerSelection(current.servers, model::chooseServer, model::showManualEntry, model::discover)
                    is PlayerState.ManualServerEntry -> ManualEntry(model::validateServer, model::discover, current.error)
                    is PlayerState.ValidatingServer -> LoadingState("Проверка ${current.serverUrl}…")
                    is PlayerState.ServerConfirmation -> ServerConfirmation(current, model::requestPairing, model::discover)
                    PlayerState.PairingRequest -> LoadingState("Получение кода привязки…")
                    is PlayerState.WaitingForApproval -> PairingState(current, model::cancelPairing)
                    PlayerState.Enrolling -> LoadingState("Защита подключения плеера…")
                    is PlayerState.PairedConnecting -> LoadingState("Подключение экрана «${current.screenName}»…")
                    is PlayerState.PairedIdle -> IdleState(current)
                    is PlayerState.CredentialRevoked -> RevokedState(current.screenName, model::reconnectAfterRevocation)
                    is PlayerState.ServerIdentityMismatch -> IdentityMismatch(current.expected, current.actual, model::resetServer)
                    is PlayerState.ConnectionError -> ErrorState(current.message, model::discover)
                }
            }
        }
    }
}

@Composable private fun AdministratorMaintenance(reliability:ReliabilityController,dismiss:()->Unit){var pin by remember{mutableStateOf("")};var unlocked by remember{mutableStateOf(false)};var error by remember{mutableStateOf<String?>(null)};val activity=LocalActivity.current as? MainActivity ?: return;val model:PlayerViewModel=viewModel();Box(Modifier.fillMaxSize().background(SignalBackground).padding(72.dp),contentAlignment=Alignment.Center){if(!unlocked)Column(Modifier.fillMaxWidth(.6f),horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(16.dp)){Text(if(reliability.hasAdminPin())"Обслуживание" else "Задайте PIN администратора",color=SignalText,fontSize=36.sp);Text("PIN открывает только меню обслуживания Tilecast. После нескольких неверных попыток ввод временно блокируется.",color=SignalMuted,textAlign=TextAlign.Center);OutlinedTextField(value=pin,onValueChange={pin=it.filter(Char::isDigit).take(12)},label={Text("PIN")},visualTransformation=PasswordVisualTransformation(),keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.NumberPassword),singleLine=true);error?.let{Text(it,color=SignalDanger)};Row(horizontalArrangement=Arrangement.spacedBy(12.dp)){SignalOutlinedButton(onClick=dismiss){Text("Отмена")};SignalButton(onClick={val valid=if(reliability.hasAdminPin())reliability.verifyAdminPin(pin.toCharArray()) else runCatching{reliability.setAdminPin(pin.toCharArray());true}.getOrDefault(false);if(valid){reliability.beginMaintenance(15);unlocked=true;pin=""}else error="Неверный PIN или ввод временно заблокирован"},enabled=pin.length>=4){Text(if(reliability.hasAdminPin())"Открыть" else "Задать PIN")}}}else Column(Modifier.fillMaxWidth(.8f),verticalArrangement=Arrangement.spacedBy(12.dp)){Text("Обслуживание Tilecast",color=SignalText,fontSize=38.sp);Text("Сеанс завершится автоматически. Пока он открыт, автовозврат к показу и сон вне рабочих часов приостановлены.",color=SignalMuted);Row(horizontalArrangement=Arrangement.spacedBy(10.dp)){SignalButton(onClick={activity.openSystemSettings(Settings.ACTION_SETTINGS)}){Text("Настройки Android")};SignalButton(onClick={activity.openSystemSettings(Settings.ACTION_ACCESSIBILITY_SETTINGS)}){Text("Специальные возможности")};SignalButton(onClick={activity.openSystemSettings(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)}){Text("Разрешение на установку")}};Row(horizontalArrangement=Arrangement.spacedBy(10.dp)){SignalOutlinedButton(onClick={reliability.setSafeMode(false)}){Text("Выйти из безопасного режима")};SignalOutlinedButton(onClick={model.runSetupAgain();dismiss()}){Text("Настроить заново")};SignalOutlinedButton(onClick={activity.restartPlayer()}){Text("Перезапустить Tilecast")};SignalButton(onClick=dismiss){Text("Вернуться к показу")}}}}}

@Composable private fun UpdateApproval(state:org.tilecast.player.content.UpdateUiState,permission:()->Unit,install:()->Unit){Box(Modifier.fillMaxSize().background(SignalBackground).padding(72.dp),contentAlignment=Alignment.Center){Column(horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(20.dp)){TilecastBrand();Text("Обновление Tilecast Player",color=SignalText,fontSize=44.sp,fontWeight=FontWeight.SemiBold);Text("${state.currentVersion} → ${state.newVersion}",color=SignalBlue,fontSize=28.sp);Text(state.message,color=SignalMuted,fontSize=21.sp);when{state.permissionRequired->SignalButton(onClick=permission){Text("Открыть разрешение на установку")};state.installReady->SignalButton(onClick=install){Text("Установить обновление")};else->CircularProgressIndicator()};Text("Tilecast обновляется сам, если Android это позволяет. На старых версиях Android установку может понадобиться подтвердить на устройстве.",color=SignalWarning,fontSize=16.sp)}}}

@Composable private fun TilecastBrand() { Image(painterResource(R.drawable.tilecast_wordmark), "Tilecast", Modifier.fillMaxWidth().height(44.dp), contentScale = ContentScale.Fit) }

@Composable private fun LoadingState(message: String) { Row(Modifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center) { CircularProgressIndicator(color = SignalBlue); Spacer(Modifier.width(20.dp)); Text(message, color = SignalText, fontSize = 25.sp) } }

@Composable private fun ServerSelection(servers: List<DiscoveredServer>, choose: (DiscoveredServer) -> Unit, manual: () -> Unit, refresh: () -> Unit) { Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(50.dp)) { Column(Modifier.weight(1f)) { Text("Подключение экрана", color = SignalText, fontSize = 42.sp, fontWeight = FontWeight.SemiBold); Spacer(Modifier.height(12.dp)); Text("Выберите сервер Tilecast в этой сети или введите его адрес.", color = SignalMuted, fontSize = 21.sp); Spacer(Modifier.height(30.dp)); Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) { SignalButton(onClick = manual) { Text("Ввести адрес сервера", fontSize = 18.sp) }; SignalOutlinedButton(onClick = refresh) { Text("Обновить", fontSize = 18.sp) } } }; Column(Modifier.weight(1f)) { Text("Серверы в сети", color = SignalMuted, fontSize = 17.sp); Spacer(Modifier.height(12.dp)); if (servers.isEmpty()) Text("Серверы не найдены. Возможно, в этой сети заблокирован поиск устройств (multicast).", color = SignalMuted, fontSize = 19.sp) else LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) { items(servers, key = { it.baseUrl }) { server -> SignalOutlinedButton(onClick = { choose(server) }, modifier = Modifier.fillMaxWidth().height(68.dp)) { Column(Modifier.fillMaxWidth()) { Text(server.name, fontSize = 19.sp); Text(server.baseUrl, color = SignalMuted, fontSize = 14.sp) } } } } } } }

@Composable private fun ManualEntry(connect: (String) -> Unit, back: () -> Unit, error: String?) { var address by remember { mutableStateOf("") }; Column(Modifier.fillMaxWidth(0.72f)) { Text("Введите адрес сервера Tilecast", color = SignalText, fontSize = 36.sp, fontWeight = FontWeight.SemiBold); Spacer(Modifier.height(10.dp)); Text("Например: https://signage.example.com или http://192.168.1.50:8080", color = SignalMuted, fontSize = 19.sp); Spacer(Modifier.height(25.dp)); OutlinedTextField(value = address, onValueChange = { address = it }, label = { Text("Адрес сервера") }, singleLine = true, modifier = Modifier.fillMaxWidth().height(72.dp), textStyle = MaterialTheme.typography.headlineSmall); error?.let { Text(it, color = SignalDanger, fontSize = 17.sp) }; Spacer(Modifier.height(22.dp)); Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) { SignalButton(onClick = { connect(address) }, enabled = address.isNotBlank()) { Text("Продолжить", fontSize = 18.sp) }; SignalOutlinedButton(onClick = back) { Text("Назад", fontSize = 18.sp) } } } }

@Composable private fun ServerConfirmation(state: PlayerState.ServerConfirmation, connect: () -> Unit, back: () -> Unit) { Column(Modifier.fillMaxWidth(0.75f)) { Text("Подключиться к «${state.identity.organizationName}»?", color = SignalText, fontSize = 38.sp, fontWeight = FontWeight.SemiBold); Spacer(Modifier.height(18.dp)); InfoRow("Сервер", state.serverUrl.value); InfoRow("Соединение", if (state.serverUrl.localInsecure) "Локальный HTTP — трафик не шифруется" else "Защищённый HTTPS"); if (state.serverUrl.localInsecure) { Spacer(Modifier.height(16.dp)); Text("Продолжайте, только если доверяете этой локальной сети. Tilecast никогда не переключает адрес HTTPS на HTTP без предупреждения.", color = SignalWarning, fontSize = 18.sp) }; Spacer(Modifier.height(28.dp)); Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) { SignalButton(onClick = connect) { Text("Подключить и привязать", fontSize = 18.sp) }; SignalOutlinedButton(onClick = back) { Text("Назад", fontSize = 18.sp) } } } }

@Composable private fun PairingState(state: PlayerState.WaitingForApproval, cancel: () -> Unit) { var remaining by remember { mutableLongStateOf(Duration.between(Instant.parse(state.pairing.serverTime), Instant.parse(state.pairing.expiresAt)).seconds) }; LaunchedEffect(state.pairing.id) { val initial = remaining; val started = SystemClock.elapsedRealtime(); while (true) { remaining = (initial - (SystemClock.elapsedRealtime() - started) / 1_000).coerceAtLeast(0); delay(1_000) } }; Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) { Column(Modifier.weight(1f)) { Text(state.organizationName, color = SignalMuted, fontSize = 20.sp); Text("Привязка экрана", color = SignalText, fontSize = 40.sp, fontWeight = FontWeight.SemiBold); Spacer(Modifier.height(20.dp)); Text(state.pairing.code.chunked(3).joinToString(" "), color = SignalBlue, fontSize = 72.sp, fontWeight = FontWeight.Bold, letterSpacing = 8.sp); Text("Введите этот код в Tilecast Studio", color = SignalText, fontSize = 22.sp); Spacer(Modifier.height(20.dp)); Text("Код действует ещё ${remaining / 60}:${(remaining % 60).toString().padStart(2, '0')}  ·  Сервер: ${state.serverUrl}", color = SignalMuted, fontSize = 17.sp); Spacer(Modifier.height(25.dp)); SignalOutlinedButton(onClick = cancel) { Text("Отменить или сменить сервер", fontSize = 17.sp) } }; Column(horizontalAlignment = Alignment.CenterHorizontally) { Image(qrCode(state.pairing.approvalUrl).asImageBitmap(), "QR-код для подтверждения привязки", Modifier.size(230.dp).background(Color.White).padding(12.dp)); Spacer(Modifier.height(10.dp)); Text("Отсканируйте, чтобы подтвердить", color = SignalMuted, fontSize = 17.sp) } } }

@Composable private fun IdleState(state: PlayerState.PairedIdle) { Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Column(horizontalAlignment = Alignment.CenterHorizontally) { Text(state.screenName, color = SignalMuted, fontSize = 20.sp); Spacer(Modifier.height(15.dp)); Text("Контент не назначен", color = SignalText, fontSize = 48.sp, fontWeight = FontWeight.SemiBold); Spacer(Modifier.height(10.dp)); Text(if (state.connected) "На связи с Tilecast · Ожидание назначения контента" else "Переподключение к Tilecast…", color = if (state.connected) SignalBlue else SignalWarning, fontSize = 20.sp); state.detail?.let { Text(it, color = SignalMuted, fontSize = 16.sp) } } } }
@Composable
private fun NoContentScreen(
    branding:org.tilecast.player.network.PlayerBranding?,
    logoPath:String?,
    background:Color,
    text:Color,
){
    val logo=remember(logoPath){
        logoPath?.let{
            runCatching{
                BitmapFactory.decodeFile(it)?.asImageBitmap()
            }.getOrNull()
        }
    }
    when(branding?.noContentMode?:"message"){
        "black"->Box(Modifier.fillMaxSize().background(Color.Black))
        "fullscreen_logo"->Box(
            Modifier.fillMaxSize().background(background),
            contentAlignment=Alignment.Center,
        ){
            if(logo!=null)Image(
                bitmap=logo,
                contentDescription="",
                modifier=Modifier.fillMaxSize(),
                contentScale=ContentScale.Crop,
            )
        }
        else->BrandedStatusScreen(
            branding,
            logoPath,
            branding?.noContentTitle?:"Контент не назначен",
            branding?.noContentMessage?:"Экран готов к показу контента.",
            "no_content",
            background,
            text,
        )
    }
}

@Composable private fun BrandedStatusScreen(branding:org.tilecast.player.network.PlayerBranding?,logoPath:String?,title:String,message:String,status:String,background:Color,text:Color){val logo=remember(logoPath){logoPath?.let{runCatching{BitmapFactory.decodeFile(it)?.asImageBitmap()}.getOrNull()}};Box(Modifier.fillMaxSize().background(background).padding(72.dp),contentAlignment=Alignment.Center){Column(horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(16.dp)){if(logo!=null)Image(logo,"",Modifier.size(260.dp),contentScale=ContentScale.Fit)else TilecastBrand();Text(title,color=text,style=MaterialTheme.typography.headlineLarge,fontWeight=FontWeight.SemiBold);Text(message,color=text,textAlign=TextAlign.Center,fontSize=22.sp);Text(statusLabel(status),color=text.copy(alpha=.7f),fontSize=16.sp);branding?.footerText?.takeIf{it.isNotBlank()}?.let{Text(it,color=text.copy(alpha=.7f),fontSize=16.sp)}}}}
private fun statusLabel(status:String)=when(status){"disabled"->"отключён";"offline"->"нет связи";"unavailable"->"контент недоступен";"no_content"->"нет контента";else->status.replace('_',' ')}
@Composable private fun RevokedState(name: String?, reconnect: () -> Unit) { CenterMessage("Привязка отозвана", "${name?.let { "Экран «$it»" } ?: "Этот экран"} удалён или отозван в Tilecast Studio. Привяжите его заново, чтобы восстановить доступ.", "Привязать заново", reconnect) }
@Composable private fun IdentityMismatch(expected: String, actual: String, reset: () -> Unit) { CenterMessage("Сменился сервер", "По этому адресу теперь другая установка Tilecast. Сохранённые учётные данные не отправлялись. Ожидалась $expected, получена $actual.", "Сбросить подключение", reset) }
@Composable private fun ErrorState(message: String, retry: () -> Unit) { CenterMessage("Проблема с подключением", message, "Выбрать сервер", retry) }
@Composable private fun CenterMessage(title: String, message: String, action: String, onClick: () -> Unit) { Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Column(Modifier.fillMaxWidth(.7f), horizontalAlignment = Alignment.CenterHorizontally) { Text(title, color = SignalText, fontSize = 38.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center); Spacer(Modifier.height(12.dp)); Text(message, color = SignalMuted, fontSize = 20.sp, textAlign = TextAlign.Center); Spacer(Modifier.height(25.dp)); SignalButton(onClick = onClick) { Text(action, fontSize = 18.sp) } } } }
@Composable private fun InfoRow(label: String, value: String) { Row(Modifier.fillMaxWidth().padding(vertical = 9.dp)) { Text(label, color = SignalMuted, fontSize = 18.sp, modifier = Modifier.width(150.dp)); Text(value, color = SignalText, fontSize = 18.sp) } }

private fun qrCode(value: String): Bitmap { val matrix = QRCodeWriter().encode(value, BarcodeFormat.QR_CODE, 420, 420); return Bitmap.createBitmap(420, 420, Bitmap.Config.RGB_565).apply { for (x in 0 until 420) for (y in 0 until 420) setPixel(x, y, if (matrix[x, y]) android.graphics.Color.BLACK else android.graphics.Color.WHITE) } }
