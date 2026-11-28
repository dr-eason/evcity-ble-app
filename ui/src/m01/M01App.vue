<!-- M01 摩托车充电桩模块（合并进 AC06 App）。界面按 AC06 的样子重做：底部标签栏、分组设置、
     同一套颜色和按钮；协议和功能逻辑照 M01 App（APP/ui/src/App.vue）搬过来。
     由 /workspace/plans/m01_merge/gen/make_m01app.py 生成第一版，之后直接改这个文件。 -->
<template>
  <main class="app m01app" :class="{ 'privacy-page': page === 'privacy', tabbed: tabBarOn }">
    <header class="top">
      <div>
        <svg class="logo" viewBox="0 0 108 28" width="108" height="28" aria-label="EVCITY">
          <text x="0" y="20" fill="#f5c400" font-size="22" font-weight="700" font-family="sans-serif">EVCITY</text>
          <rect x="0" y="25" width="28" height="2" fill="#f5c400"/>
        </svg>
        <p class="sub">{{ t(pageTitle, pageTitleVars) }}</p>
        <p v-if="page !== 'charge' && page !== 'link' && faultText" class="fault on">{{ faultText }}</p>
      </div>
      <button v-if="isTabPage(page) || page === 'link'" class="lang" @click="openLang">{{ currentLangName }}</button>
      <button v-else class="text" @click="back">{{ t('返回') }}</button>
    </header>

    <section v-if="page === 'link'" class="body">
      <div class="card device kind-card">
        <span><strong>{{ linkName || 'M01' }}</strong><small>{{ t('摩托车充电桩 M01') }}</small></span>
        <em class="ver">{{ linkAddr }}</em>
      </div>
      <div class="wait">
        <span class="spin"></span>
        <p>{{ t(note, noteVars) }}</p>
      </div>
      <button class="ghost" @click="disconnect">{{ t('取消') }}</button>
    </section>

    <section v-else-if="page === 'charge'" class="body">
      <div class="station">
        <div class="station-head">
          <strong>{{ linkName || 'M01' }}</strong>
          <span class="fault" :class="{ on: faultText }">{{ faultText || t('无故障') }}</span>
        </div>
        <div class="station-grid">
          <p><small>{{ t('固件') }}</small><b>{{ fw === '—' ? '—' : verLabel(fw) }}</b></p>
          <p><small>{{ t('母线电压') }}</small><b>{{ sys.busV === null ? '—' : sys.busV.toFixed(1) + ' V' }}</b></p>
          <p><small>{{ t('板温') }}</small><b>{{ sys.tempC === null ? '—' : sys.tempC + ' ℃' }}</b></p>
          <p><small>{{ t('市电') }}</small><b :class="{ warn: sysSeen && !sys.mains }">{{ !sysSeen ? '—' : (sys.mains ? t('正常') : t('无市电')) }}</b></p>
        </div>
      </div>
      <div class="clockbox">
        <small>{{ t('充电桩时间') }}</small>
        <b>{{ clock ? clock : t('时间未同步') }}</b>
      </div>
      <div class="linkbox">
        <small>{{ lteHome ? t('4G 网络') : t('已配置热点') }}</small>
        <strong>{{ lteHome ? (lteHome.oper || '--') : t(wifiSaved) }}</strong>
        <span>{{ lteHome ? lteHomeLine : t(wifi) }}</span>
        <span class="ocpp" :class="ocppKind">{{ t(ocppText) }}</span>
      </div>
      <p class="label">{{ t('{n} 路输出', { n: portCards.length }) }} · {{ t('充电中 {n} 路', { n: summary.charging }) }} · {{ summary.stale ? '—' : fmtWatts(summary.watts) }}</p>
      <div class="ports">
        <div v-for="item in portCards" :key="item.port" class="port" :class="[item.kind, { sel: item.sel, aging: item.age === 'old', stale: item.age === 'stale' }]" role="button" tabindex="0" @click="openPort(item.port)" @keydown.enter="openPort(item.port)">
          <span class="port-top">
            <b>{{ item.port }}</b>
            <em>{{ t(item.label) }}</em>
          </span>
          <small v-if="item.age === 'old'" class="port-age">{{ t('{n} 秒前', { n: item.ageSec }) }}</small>
          <small v-else-if="item.age === 'stale'" class="port-age">{{ t('已过期') }}</small>
          <span class="port-nums">
            <strong>{{ item.watts }}</strong>
            <small>{{ item.time }}<template v-if="item.kwh"> · {{ item.kwh }}</template></small>
            <small>{{ item.va }}</small>
            <small v-if="item.bal">{{ t('余额') }} {{ item.bal }}</small>
          </span>
          <button v-if="item.live" class="port-btn stop" :disabled="portBusyCmd || toggleOff('STOP', item.port)" @click.stop="cardStop(item.port)">{{ t('停止') }}</button>
          <button v-else class="port-btn" :disabled="portBusyCmd || !item.ready || toggleOff('START', item.port)" @click.stop="cardStart(item.port)">{{ t('启动') }}</button>
        </div>
      </div>
      <p v-if="!portsSeen" class="note">{{ t('正在读取各路状态') }}</p>
      <p v-else-if="homeAge.level === 'old' || homeAge.level === 'stale'" class="note warn">{{ t('{n} 秒没有收到新数据，格子里是旧值', { n: homeAge.sec }) }}</p>
      <p class="note">{{ t(note, noteVars) }}</p>
      <p v-if="compatShown" class="note" :class="{ warn: compatShown.warn }">{{ t(compatShown) }}</p>
      <div v-if="stopAllAsk" class="pair">
        <button class="go" :disabled="portBusyCmd || toggleOff('STOP', 0)" @click="confirmStopAll">{{ t('确认全部停止') }}</button>
        <button @click="stopAllAsk = false">{{ t('取消') }}</button>
      </div>
      <button v-else class="ghost" :disabled="portBusyCmd || toggleOff('STOP', 0)" @click="stopAllAsk = true">{{ t('全部停止') }}</button>
      <button class="text alone" @click="disconnect">{{ t('断开蓝牙') }}</button>
    </section>

    <section v-else-if="page === 'port'" class="body">
      <div class="port-state" :class="portView.kind">
        <strong>{{ t(portView.label) }}</strong>
        <small>{{ portView.name }}</small>
      </div>
      <p v-if="portView.fault" class="fault on">{{ t(portView.fault) }}</p>
      <div class="times three">
        <div><small>{{ t('电压') }}</small><strong>{{ portView.v }}</strong></div>
        <div><small>{{ t('电流') }}</small><strong>{{ portView.a }}</strong></div>
        <div><small>{{ t('充电功率') }}</small><strong>{{ portView.w }}</strong></div>
      </div>
      <div class="times">
        <div><small>{{ t('已充电') }}</small><strong>{{ portView.time }}</strong></div>
        <div><small>{{ t('本次电量') }}</small><strong>{{ portView.kwh }}</strong></div>
      </div>
      <div class="pair">
        <button class="go" :disabled="portBusyCmd || toggleOff('START', portSel)" @click="startPort">{{ t('启动') }}</button>
        <button class="ghost" :disabled="portBusyCmd || toggleOff('STOP', portSel)" @click="stopPort">{{ t('停止') }}</button>
      </div>
      <p class="note">{{ t(portNote, portNoteVars) }}</p>
      <button v-if="selLeft > 0" class="go" :disabled="portBusyCmd" @click="selectPort(false)">{{ t('请刷卡，还剩 {s} 秒（点这里取消）', { s: selLeft }) }}</button>
      <button v-else class="ghost" :disabled="portBusyCmd" @click="selectPort(true)">{{ t('选这一路刷卡') }}</button>
      <p class="note">{{ t('刷卡板只有一个读头，10 路共用。先在这里选中这一路，再在 30 秒内刷卡：卡会用在这一路上，启动或停止它。') }}</p>
      <div class="card lte-stat">
        <p><small>{{ t('电表累计电量') }}</small><b>{{ portView.meter }}</b></p>
        <p><small>{{ t('功率上限') }}</small><b>{{ portView.limit }}</b></p>
        <p><small>{{ t('启动渠道') }}</small><b>{{ portView.source ? t(portView.source) : '—' }}</b></p>
        <p><small>User</small><b>{{ portView.user || '—' }}</b></p>
        <p><small>{{ t('最近停止原因') }}</small><b>{{ portView.lastStop ? t(portView.lastStop) : '—' }}</b></p>
        <p><small>{{ t('最近故障') }}</small><b>{{ portView.lastFault ? t(portView.lastFault) : t('无') }}</b></p>
        <p v-if="portView.fullLeft"><small>{{ t('充满自停倒计时') }}</small><b>{{ portView.fullLeft }}</b></p>
      </div>
      <div v-if="portView.payModel" class="card lte-stat">
        <p><small>{{ t('收费模型') }}</small><b>{{ t(portView.payModel) }}</b></p>
        <p><small>{{ t('余额') }}</small><b>{{ portView.balance }}</b></p>
        <p><small>{{ t('已用电费') }}</small><b>{{ portView.cost }}</b></p>
        <p><small>{{ t('单价') }}</small><b>{{ portView.rate }}</b></p>
      </div>
      <p class="label">{{ t('功率上限 (W)') }}</p>
      <input v-model="plimOne" class="field" inputmode="numeric" maxlength="5" :disabled="plimBusy" @input="plimOneDirty = true">
      <p class="note">{{ t('超过上限持续 3 秒就停这一路。允许 {min} 到 {max} W。充电中修改立即生效，断电后仍然有效。', { min: plimMin, max: plimMax }) }}</p>
      <p v-if="plimNote" class="note">{{ t(plimNote, plimNoteVars) }}</p>
      <button class="go save" :class="saveCls('plimOne')" :disabled="plimBusy || saveOff('plimOne')" @click="savePlimOne">{{ saveLbl('plimOne') }}</button>
      <p v-if="saveWhy('plimOne')" class="save-why" :class="saveTone('plimOne')">{{ saveWhy('plimOne') }}</p>
    </section>

    <section v-else-if="page === 'orders'" class="body">
      <p v-if="ordersNote" class="note">{{ t(ordersNote) }}</p>
      <p v-if="ordersDone && !orders.length" class="empty">{{ t('还没有充电记录') }}</p>
      <article v-for="item in orders" :key="item.index" class="card order">
        <strong>{{ t('第 {n} 路', { n: item.port }) }} · {{ fmtKwh(item.wh) }}</strong>
        <p class="note">{{ t('开始') }} {{ orderWhen(item.start) }}</p>
        <p class="note">{{ t('结束') }} {{ item.running ? t('未结束') : orderWhen(item.end) }}</p>
        <p class="note">{{ t('时长') }} {{ item.running ? t('未结束') : fmtDuration(item.dur) }}</p>
        <p class="note">{{ t('最大功率') }} {{ fmtWatts(item.maxW) }}</p>
        <p class="note">{{ t('停止原因') }} {{ item.running ? t('充电中') : orderReason(item.reason) }}</p>
        <p class="note">{{ t('启动渠道') }} {{ orderSource(item.source) }}</p>
        <p class="note">User {{ item.user || '—' }}</p>
        <p class="note">{{ t('订单号') }} {{ item.id || '—' }}</p>
        <p v-for="row in orderPayRows(item)" :key="row.label" class="note" :class="{ due: row.label === '待退费' }">{{ t(row.label) }} {{ row.milli === null ? (row.text ? t(row.text) : '') : fmtMoney(row.milli) }}</p>
      </article>
      <p v-if="ordersDone && ordersTotal !== null && orders.length" class="note">{{ t('共 {n} 条，已读取 {m} 条', { n: ordersTotal, m: orders.length }) }}</p>
      <button v-if="ordersMore" class="go" :disabled="ordersBusy" @click="loadMoreOrders">{{ t('读取更多') }}</button>
      <button class="ghost" :disabled="ordersBusy" @click="loadOrders">{{ t('重新读取') }}</button>
    </section>

    <section v-else-if="page === 'menu'" class="body settings">
      <p v-if="compatShown" class="note" :class="{ warn: compatShown.warn }">{{ t(compatShown) }}</p>
      <p class="group-title">{{ t('充电设置') }}</p>
      <div class="group">
        <button class="card device" @click="openPlim">
          <span><strong>{{ t('功率上限') }}</strong><small>{{ t('每一路单独设置，超限 3 秒停这一路') }}</small></span>
          <em>{{ plimBrief }}</em>
        </button>
        <button class="card device" @click="openPay">
          <span><strong>{{ t('充电规则') }}</strong><small>{{ t('离线收费模型、充满自停') }}</small></span>
          <em>{{ payBrief }}</em>
        </button>
        <button class="card device" @click="openPar">
          <span><strong>{{ t('并充') }}</strong><small>{{ t('把相邻几路并成一路，功率更大') }}</small></span>
          <em>{{ parBrief }}</em>
        </button>
        <button class="card device" @click="openNetStop">
          <span><strong>{{ t('断网停充') }}</strong><small>{{ t('OCPP 掉线超时后停止充电') }}</small></span>
          <em>{{ netStopOn ? (t('开') + ' ' + netStopSec + ' s') : t('关') }}</em>
        </button>
      </div>
      <p class="group-title">{{ t('网络与平台') }}</p>
      <div class="group">
        <button class="card device" @click="openWifi">
          <span><strong>{{ t('WiFi 配网') }}</strong><small>{{ t('热点') }}</small></span>
          <em>{{ wifiOn ? t('开') : t('关') }}</em>
        </button>
        <button class="card device" @click="openLte">
          <span><strong>{{ t('4G 设置') }}</strong><small>{{ t('移动网络和 APN') }}</small></span>
          <em>{{ lteBrief }}</em>
        </button>
        <button class="card device" @click="openOcpp">
          <span><strong>{{ t('OCPP 服务器') }}</strong><small>{{ t('平台地址') }}</small></span>
          <em>{{ ocppOn ? t('开') : t('关') }}</em>
        </button>
        <button class="card device" @click="openOcfw">
          <span><strong>{{ t('OCPP上报版本号') }}</strong><small>{{ ocfwText || t('跟固件版本相同') }}</small></span>
          <em>{{ ocfwOn ? t('开') : t('关') }}</em>
        </button>
      </div>
      <p class="group-title">{{ t('保护与时间') }}</p>
      <div class="group">
        <button class="card device" @click="openCfg">
          <span><strong>{{ t('保护设置') }}</strong><small>{{ t('母线过压、欠压') }}</small></span>
          <em>›</em>
        </button>
        <button class="card device" @click="openTz">
          <span><strong>{{ t('时区设置') }}</strong><small>{{ t('充电记录和首页的钟点按这个时区') }}</small></span>
          <em class="ver">{{ tzBrief }}</em>
        </button>
      </div>
      <p class="group-title">{{ t('维护') }}</p>
      <div class="group">
        <button class="card device" @click="openProfiles">
          <span><strong>{{ t('一键配置') }}</strong><small>{{ t('保存在手机上，可下发到任意一台同型号充电桩') }}</small></span>
          <em>{{ profiles.length ? profiles.length : '›' }}</em>
        </button>
        <button class="card device" @click="openOta">
          <span><strong>{{ t('固件升级') }}</strong><small>{{ t('选择本机上的应用固件，校验后发给充电桩') }}</small></span>
          <em>{{ fw }}</em>
        </button>
        <button class="card device" @click="openModver">
          <span><strong>{{ t('蓝牙WiFi版本') }}</strong><small>{{ t('蓝牙/WiFi 模组的版本号和固件版本号') }}</small></span>
          <em class="ver">{{ modverBrief }}</em>
        </button>
        <button class="card device" @click="openTelemetry">
          <span><strong>{{ t('遥测') }}</strong><small>{{ t('遥测串口每秒发送状态') }}</small></span>
          <em>{{ telemetry ? t('开') : t('关') }}</em>
        </button>
        <button class="card device" @click="openReboot">
          <span><strong>{{ t('重启') }}</strong><small>{{ t('正在充电的各路会先停止，然后复位') }}</small></span>
          <em>›</em>
        </button>
      </div>
      <p class="group-title">{{ t('关于') }}</p>
      <div class="group">
        <button class="card device" @click="openAuthInfo">
          <span><strong>{{ t('管理员密码') }}</strong><small>{{ t('连接时核对 6 位管理员密码') }}</small></span>
          <em>{{ gateRemembered ? t('已记住') : t('未记住') }}</em>
        </button>
        <button class="card device" @click="openPrivacy">
          <span><strong>{{ t('隐私协议') }}</strong></span>
          <em>›</em>
        </button>
        <div class="card device">
          <span><strong>{{ t('App 版本') }}</strong><small>{{ t('摩托车充电桩 M01') }} · {{ verLabel(M01_MODULE_VERSION) }}</small></span>
          <em class="ver"><bdi dir="ltr">{{ appVersion ? verLabel(appVersion) : '—' }}</bdi> <bdi dir="ltr">·</bdi> {{ t('热更新') }} <bdi dir="ltr">{{ h5RevText }}</bdi></em>
        </div>
      </div>
      <button class="text alone" @click="disconnect">{{ t('断开蓝牙') }}</button>
    </section>

    <section v-else-if="page === 'authinfo'" class="body">
      <p class="note">{{ gateRemembered ? t('这台手机已记住这台充电桩的管理员密码，下次连接自动核对。') : t('这台手机没有记住这台充电桩的管理员密码，下次连接要输入密码。') }}</p>
      <p v-if="authInfoNote" class="note">{{ t(authInfoNote) }}</p>
      <button class="ghost" :disabled="!gateRemembered" @click="clearRememberedGate">{{ t('清除记住的密码') }}</button>
    </section>

    <section v-else-if="page === 'plim'" class="body">
      <p class="note">{{ t('每一路的有功功率超过自己的上限并持续 3 秒，就停这一路。允许 {min} 到 {max} W。断电后仍然有效。', { min: plimMin, max: plimMax }) }}</p>
      <div class="plims">
        <label v-for="(value, index) in plimInputs" :key="index" class="plim">
          <b>{{ index + 1 }}</b>
          <input v-model="plimInputs[index]" class="field" inputmode="numeric" maxlength="5" :disabled="plimBusy || !plimKnown" @input="plimDirty = true">
        </label>
      </div>
      <p v-if="plimNote" class="note">{{ t(plimNote, plimNoteVars) }}</p>
      <button class="go save" :class="saveCls('plimList')" :disabled="plimBusy || !plimKnown || saveOff('plimList')" @click="savePlimList">{{ saveLbl('plimList') }}</button>
      <p v-if="saveWhy('plimList')" class="save-why" :class="saveTone('plimList')">{{ saveWhy('plimList') }}</p>
      <p class="label">{{ t('全部设为同一个值 (W)') }}</p>
      <input v-model="plimAll" class="field" inputmode="numeric" maxlength="5" :disabled="plimBusy || !plimKnown">
      <button class="ghost save" :class="saveCls('plimAll')" :disabled="plimBusy || !plimKnown || saveOff('plimAll')" @click="savePlimAll">{{ saveLbl('plimAll', t('应用到全部端口')) }}</button>
      <p v-if="saveWhy('plimAll')" class="save-why" :class="saveTone('plimAll')">{{ saveWhy('plimAll') }}</p>
    </section>

    <section v-else-if="page === 'pay'" class="body">
      <div class="card lte-stat">
        <p><small>{{ t('离线刷卡') }}</small><b>{{ !payKnown ? '—' : (pay.offline ? t('开') : t('关')) }}</b></p>
        <p><small>{{ t('联网') }}</small><b>{{ !payKnown ? '—' : (pay.net ? t('开') : t('关')) }}</b></p>
        <p><small>{{ t('绑定的运营商') }}</small><b class="ver">{{ !payKnown ? '—' : (pay.oper || t('未绑定')) }}</b></p>
      </div>
      <p class="note">{{ t('离线刷卡和联网由主板上的两个开关决定，改了开关要重新上电。运营商靠刷运营商卡绑定，刷另一家的运营商卡就换绑。') }}</p>
      <p class="label">{{ t('收费模型') }}</p>
      <button class="card device" :class="{ picked: payModel === 1 }" :disabled="payBusy || !payKnown" @click="payModel = 1">
        <span><strong>{{ t('不退费') }}</strong><small>{{ t('不退费：可以追加刷卡，剩下的钱不退') }}</small></span>
        <em>{{ payModel === 1 ? '✓' : '' }}</em>
      </button>
      <button class="card device" :class="{ picked: payModel === 2 }" :disabled="payBusy || !payKnown" @click="payModel = 2">
        <span><strong>{{ t('可退费') }}</strong><small>{{ t('可退费：结束后再刷同一张卡退回余额') }}</small></span>
        <em>{{ payModel === 2 ? '✓' : '' }}</em>
      </button>
      <p class="label">{{ t('低功率即将充满阈值 (W)') }}</p>
      <input v-model="payFullW" class="field" inputmode="numeric" maxlength="3" :disabled="payBusy || !payKnown">
      <p class="note">{{ t('功率低于这个值算即将充满。允许 {min} 到 {max} W。', { min: pay.min, max: pay.max }) }}</p>
      <p class="label">{{ t('低载多久停止 (秒)') }}</p>
      <input v-model="payHoldS" class="field" inputmode="numeric" maxlength="4" :disabled="payBusy || !payKnown || !!payHoldLack">
      <p v-if="payHoldLack" class="note warn">{{ t(payHoldLack) }}</p>
      <p v-else class="note">{{ t('功率连续低于阈值这么久就停这一路。默认 300 秒。允许 {min} 到 {max} 秒。', { min: pay.holdMin, max: pay.holdMax }) }}</p>
      <p v-if="payNote" class="note">{{ t(payNote) }}</p>
      <button class="go save" :class="saveCls('pay')" :disabled="payBusy || !payKnown || saveOff('pay')" @click="savePay">{{ saveLbl('pay') }}</button>
      <p v-if="saveWhy('pay')" class="save-why" :class="saveTone('pay')">{{ saveWhy('pay') }}</p>
    </section>

    <section v-else-if="page === 'par'" class="body">
      <button v-for="mode in parModes" :key="mode" class="card device" :class="{ picked: parPick === mode }" :disabled="parBusy || !parKnown" @click="parPick = mode">
        <span><strong>{{ t(parallelLabel(mode)) }}</strong></span>
        <em>{{ parPick === mode ? '✓' : '' }}</em>
      </button>
      <p class="note">{{ t('切换时先停止这台桩上全部的充电，各路都停下后自动切换。切换后充电桩会重启，请稍后重新连接。') }}</p>
      <p v-if="parNote" class="note" :class="{ warn: parWarn }">{{ t(parNote, parNoteVars) }}</p>
      <div v-if="parAsk" class="pair">
        <button class="go" @click="confirmPar">{{ t('停止全部充电并切换') }}</button>
        <button @click="cancelPar">{{ t('取消') }}</button>
      </div>
      <button v-else class="go save" :class="saveCls('par')" :disabled="parBusy || !parKnown || parPick === par.saved || saveOff('par')" @click="savePar">{{ saveLbl('par') }}</button>
      <p v-if="saveWhy('par')" class="save-why" :class="saveTone('par')">{{ saveWhy('par') }}</p>
    </section>

    <section v-else-if="page === 'gate'" class="body">
      <div class="card device kind-card">
        <span><strong>{{ linkName || 'M01' }}</strong><small>{{ t('摩托车充电桩 M01') }}</small></span>
        <em class="ver">{{ linkAddr }}</em>
      </div>
      <p class="note">{{ t('连接这台充电桩需要 6 位管理员密码。通过一次后，这台手机会记住，下次连接自动核对。') }}</p>
      <input v-model="gateInput" class="field" type="password" inputmode="numeric" maxlength="6" :placeholder="t('6 位数字')">
      <label class="row">
        <span>
          <strong>{{ t('保存密码') }}</strong>
          <small>{{ t('保存在这台手机上，下次自动连接') }}</small>
        </span>
        <input v-model="gateSave" type="checkbox">
      </label>
      <p class="note">{{ gateNoteShown }}</p>
      <button class="go" :disabled="gateLockLeft > 0" @click="submitGate">{{ gateLockLeft > 0 ? t('已锁定（{s} 秒）', { s: gateLockLeft }) : t('连接') }}</button>
    </section>

    <section v-else-if="page === 'lang'" class="body">
      <button v-for="item in languages" :key="item.id" class="card device" @click="setLang(item.id)">
        <span><strong>{{ item.name }}</strong></span>
        <em>{{ lang === item.id ? '✓' : '' }}</em>
      </button>
    </section>

    <section v-else-if="page === 'privacy'" class="body privacy-wrap">
      <PrivacyPolicy :lang="lang" />
    </section>

    <section v-else-if="page === 'profiles'" class="body">
      <p class="note">{{ t('这份配置存在这台手机上，不绑定某一台桩。连上同型号的充电桩后，都可以下发。') }}</p>
      <button class="go" @click="beginSaveProfile">{{ t('从当前充电桩保存') }}</button>
      <div class="pair">
        <button :disabled="!profiles.length" @click="askExport">{{ t('导出到文件') }}</button>
        <button @click="pickImport">{{ t('从文件导入') }}</button>
      </div>
      <input ref="importInput" class="file" type="file" accept="*/*" @change="onImportFile">
      <div v-if="exportAsk" class="card">
        <p class="note">{{ t('导出的文件里有明文的 WiFi 密码和 4G APN 密码，拿到文件的人都能看到。请只存到自己信任的地方，不要随便发给别人。') }}</p>
        <div class="pair">
          <button class="go" @click="confirmExport">{{ t('我知道了，导出') }}</button>
          <button @click="exportAsk = false">{{ t('取消') }}</button>
        </div>
      </div>
      <p v-if="profileFileNote" class="note">{{ profileFileText }}</p>
      <p v-if="!profiles.length" class="empty">{{ t('还没有一键配置') }}</p>
      <article v-for="item in profiles" :key="item.id" class="card">
        <strong>{{ item.name }}</strong>
        <p class="note">{{ profileWhen(item.savedAt) }}</p>
        <p v-if="profileAskId === item.id" class="note">{{ t('把「{name}」下发到当前连接的充电桩？', { name: item.name }) }}</p>
        <p v-if="profileDeleteId === item.id" class="note">{{ t('确认删除这份配置？') }}</p>
        <div v-if="profileAskId === item.id" class="pair">
          <button class="go" @click="startApply(item)">{{ t('确认下发') }}</button>
          <button @click="profileAskId = ''">{{ t('取消') }}</button>
        </div>
        <div v-else-if="profileDeleteId === item.id" class="pair">
          <button class="go" @click="removeProfile(item)">{{ t('确认删除') }}</button>
          <button @click="profileDeleteId = ''">{{ t('取消') }}</button>
        </div>
        <div v-else class="pair">
          <button @click="beginRename(item)">{{ t('重命名') }}</button>
          <button class="go" @click="askApply(item)">{{ t('下发到当前充电桩') }}</button>
        </div>
        <button v-if="profileAskId !== item.id && profileDeleteId !== item.id" class="text" @click="askDelete(item)">{{ t('删除') }}</button>
      </article>
    </section>

    <section v-else-if="page === 'profileName'" class="body">
      <p class="label">{{ t('配置名称') }}</p>
      <input v-model="profileNameInput" class="field" maxlength="32" :placeholder="t('例如 门店标准')">
      <p class="note">{{ t(profileNameNote) }}</p>
      <button class="go" @click="commitProfileName">{{ profileNaming === 'rename' ? t('保存名称') : t('开始读取') }}</button>
    </section>

    <section v-else-if="page === 'profileRun'" class="body">
      <p class="note">{{ profileMode === 'read' ? t('正在从当前充电桩读取') : t('正在下发到当前充电桩') }}</p>
      <p class="state small">{{ profileTitle }}</p>
      <div class="ota-progress">
        <div class="ota-track"><div class="ota-fill" :style="{ width: profilePercent + '%' }"></div></div>
        <p class="note">{{ t('{done} / {total}', { done: profileDone, total: profileTotal }) }}</p>
      </div>
      <div ref="profileLogBox" class="profile-log">
        <p v-for="(row, index) in profileLog" :key="index" :class="row.kind">{{ profileLogText(row) }}</p>
      </div>
      <p v-if="profileDoneNote" class="note">{{ t(profileDoneNote) }}</p>
      <button v-if="profileFinished" class="go" @click="back">{{ t('完成') }}</button>
    </section>

    <section v-else-if="page === 'netstop'" class="body">
      <label class="row">
        <span>
          <strong>{{ t('断网停充') }}</strong>
          <small>{{ t('打开后，OCPP 曾经在线又掉线，持续这么多秒仍未重新在线，就把正在充电的各路都停掉。默认关闭。') }}</small>
        </span>
        <input type="checkbox" v-model="netStopOn">
      </label>
      <p class="label">{{ t('断网时长 (秒)') }}</p>
      <input v-model="netStopSec" class="field" inputmode="numeric" maxlength="3">
      <p class="note">{{ t('允许 10 到 600 秒，默认 60') }}</p>
      <p class="note">{{ t(netStopNote) }}</p>
      <button class="go save" :class="saveCls('netstop')" :disabled="saveOff('netstop')" @click="saveNetStop">{{ saveLbl('netstop') }}</button>
      <p v-if="saveWhy('netstop')" class="save-why" :class="saveTone('netstop')">{{ saveWhy('netstop') }}</p>
    </section>

    <section v-else-if="page === 'reboot'" class="body">
      <p class="note">{{ t('正在充电的各路会先停止，然后复位充电桩。') }}</p>
      <p class="note">{{ t(rebootNote) }}</p>
      <div v-if="rebootAsk" class="pair">
        <button class="go" @click="confirmReboot">{{ t('确认重启') }}</button>
        <button @click="rebootAsk = false">{{ t('取消') }}</button>
      </div>
      <button v-else class="go" @click="rebootAsk = true">{{ t('重启') }}</button>
    </section>

    <section v-else-if="page === 'wifi'" class="body">
      <label class="row">
        <span>
          <strong>{{ t('开启 WiFi') }}</strong>
          <small>{{ t('关闭后不再连接热点，已保存的热点还在。OCPP 若开着会一起关掉。重新打开 WiFi 不会自动打开 OCPP') }}</small>
        </span>
        <input type="checkbox" :checked="wifiOn" @change="setWifiOn($event.target.checked, $event.target)">
      </label>
      <p class="note">{{ t('打开 WiFi 会关闭 4G') }}</p>
      <p class="label">{{ t('当前已配置') }}</p>
      <p class="wifi">{{ t(wifiSaved) }}</p>
      <p class="note">{{ t(wifi) }}</p>
      <p class="note">{{ t(wifiNote) }}</p>
      <button v-for="(ap, i) in aps" :key="i" class="card device" @click="pickAp(ap)">
        <strong>{{ ap.ssid || t('（无名称）') }}</strong>
        <em>{{ ap.rssi }}</em>
      </button>
      <button class="go" @click="scanWifi">{{ t('搜索热点') }}</button>
    </section>

    <section v-else-if="page === 'pass'" class="body">
      <p class="label">{{ t('热点') }}</p>
      <p class="state small">{{ picked }}</p>
      <div v-if="wifiJoining" class="wait">
        <span class="spin"></span>
        <p>{{ t('正在连接热点，请稍后') }}</p>
      </div>
      <input v-model="password" class="field" type="password" :placeholder="t('密码')" maxlength="32" :disabled="wifiJoining">
      <p v-if="!wifiJoining" class="note">{{ t(wifiNote) }}</p>
      <button class="go save" :class="saveCls('wifi')" :disabled="wifiJoining || saveOff('wifi')" @click="joinWifi">{{ saveLbl('wifi', t('连接并保存')) }}</button>
      <p v-if="saveWhy('wifi')" class="save-why" :class="saveTone('wifi')">{{ saveWhy('wifi') }}</p>
    </section>

    <section v-else-if="page === 'ocpp'" class="body">
      <label class="row">
        <span>
          <strong>{{ t('开启 OCPP') }}</strong>
          <small>{{ t('关闭后不再连接服务器，已保存的地址还在') }}</small>
        </span>
        <input type="checkbox" :checked="ocppOn" @change="setOcppOn($event.target.checked, $event.target)">
      </label>
      <p class="label">{{ t('OCPP 地址') }}</p>
      <input v-model="ocppUrl" class="field" :placeholder="t('ws(s)://主机/路径')">
      <p class="note">{{ t(ocppNote) }}</p>
      <button class="go save" :class="saveCls('ocpp')" :disabled="saveOff('ocpp')" @click="saveOcpp">{{ saveLbl('ocpp') }}</button>
      <p v-if="saveWhy('ocpp')" class="save-why" :class="saveTone('ocpp')">{{ saveWhy('ocpp') }}</p>
    </section>

    <section v-else-if="page === 'cfg'" class="body">
      <div class="times">
        <div>
          <small>{{ t('母线电压') }}</small>
          <strong>{{ sys.busV === null ? '—' : sys.busV.toFixed(1) + ' V' }}</strong>
        </div>
        <div>
          <small>{{ t('板温') }}</small>
          <strong>{{ sys.tempC === null ? '—' : sys.tempC + ' ℃' }}</strong>
        </div>
      </div>
      <p class="note">{{ t(cfgNote) }}</p>
      <label class="label">{{ t('过压停止 (V)') }}</label>
      <input v-model="cfg.over" class="field" inputmode="decimal">
      <label class="label">{{ t('欠压停止 (V)') }}</label>
      <input v-model="cfg.under" class="field" inputmode="decimal">
      <p class="note">{{ t('母线电压高于过压值或低于欠压值时，10 路全部停止，电压恢复后自动解除。默认 253 和 207。欠压不低于 100，过压不超过 320，过压至少比欠压高 10。') }}</p>
      <button class="go save" :class="saveCls('cfg')" :disabled="saveOff('cfg')" @click="saveCfg">{{ saveLbl('cfg') }}</button>
      <p v-if="saveWhy('cfg')" class="save-why" :class="saveTone('cfg')">{{ saveWhy('cfg') }}</p>
    </section>

    <section v-else-if="page === 'ocfw'" class="body">
      <p class="note">{{ t('打开后，连上 OCPP 平台时 BootNotification 使用下面手填的版本号。这不改充电桩自己的固件版本。手填值和固件版本相同，或者关掉，就上报固件版本。断电后仍然有效。') }}</p>
      <label class="row">
        <span>
          <strong>{{ t('开启上报版本号') }}</strong>
          <small>{{ t('关掉就始终上报固件版本') }}</small>
        </span>
        <input v-model="ocfwOn" type="checkbox">
      </label>
      <p class="label">{{ t('OCPP固件版本显示号') }}</p>
      <input v-model="ocfwText" class="field" maxlength="20" :placeholder="t('例如 1.0.0')">
      <p class="note">{{ t(ocfwNote) }}</p>
      <button class="go save" :class="saveCls('ocfw')" :disabled="saveOff('ocfw')" @click="saveOcfw">{{ saveLbl('ocfw') }}</button>
      <p v-if="saveWhy('ocfw')" class="save-why" :class="saveTone('ocfw')">{{ saveWhy('ocfw') }}</p>
    </section>

    <section v-else-if="page === 'tz'" class="body">
      <div class="card clk">
        <small class="verkey">{{ t('充电桩当前时间') }}</small>
        <strong class="verval clkval">{{ clkShown.kind === 'notime' ? t('时间未同步') : clkShown.text }}</strong>
      </div>
      <p class="note">{{ t('点一个时区，直接保存到充电桩，断电后仍然有效。只改时区，不改充电桩的时间。') }}</p>
      <div class="card">
        <small class="verkey">{{ t('充电桩当前时区') }}</small>
        <strong class="verval">{{ tzBrief }}</strong>
        <small v-if="tzKnown && !tzListed" class="verkey">{{ t('当前时区不在列表里') }}</small>
      </div>
      <p v-if="saveWhy('tz')" class="save-why" :class="saveTone('tz')">{{ saveWhy('tz') }}</p>
      <div class="zones">
        <button v-for="zone in TZ_ZONES" :key="zone" class="zone save"
                :class="[{ on: tzKnown && zone === tzMin, busy: tzSaving && zone === tzPick }, zone === tzPick ? saveCls('tz') : '']"
                :disabled="tzSaving || saveOff('tz')" @click="pickZone(zone)">{{ zone === tzPick ? saveLbl('tz', tzLabel(zone), true) : tzLabel(zone) }}</button>
      </div>
      <p v-if="tzFollowsPhone" class="note">{{ t('WiFi、OCPP 和 4G 都关闭时，手机连着期间充电桩的时区会跟随手机的时区，这里选的会被改回去。') }}</p>
    </section>

    <section v-else-if="page === 'lte'" class="body">
      <p v-if="lteState === 'silent'" class="note">{{ t('充电桩没有应答，请重新读取') }}</p>
      <p v-else-if="lteState !== 'ok'" class="note">{{ t('正在读取') }}</p>
      <label class="row">
        <span>
          <strong>{{ t('开启 4G') }}</strong>
          <small>{{ t('打开 4G 会关闭 WiFi 和遥测。4G、WiFi、遥测可以都关闭') }}</small>
        </span>
        <input type="checkbox" :checked="lteOn" :disabled="!lteReady || lteBusy" @change="setLteOn($event.target.checked)">
      </label>
      <p v-if="lteNote" class="note">{{ t(lteNote) }}</p>
      <p class="label">{{ t('APN 设置') }}</p>
      <div class="card lte-form">
        <small class="verkey">{{ t('协议') }}</small>
        <select v-model="lteApn.proto" class="field" :disabled="!lteReady || lteBusy" @change="lteApnDirty = true">
          <option v-for="item in LTE_PROTOS" :key="item.id" :value="String(item.id)">{{ item.name }}</option>
        </select>
        <small class="verkey">{{ t('APN 名称') }}</small>
        <input v-model="lteApn.apn" class="field" maxlength="32" autocapitalize="off" autocomplete="off" spellcheck="false" :disabled="!lteReady || lteBusy" @input="lteApnDirty = true">
        <small class="verkey">{{ t('账号') }}</small>
        <input v-model="lteApn.user" class="field" maxlength="32" autocapitalize="off" autocomplete="off" spellcheck="false" :disabled="!lteReady || lteBusy" @input="lteApnDirty = true">
        <small class="verkey">{{ t('密码') }}</small>
        <input v-model="lteApn.pass" class="field" :type="ltePassShow ? 'text' : 'password'" maxlength="32" autocapitalize="off" autocomplete="off" spellcheck="false" :disabled="!lteReady || lteBusy" @input="lteApnDirty = true">
        <label class="lte-show"><input v-model="ltePassShow" type="checkbox"><span>{{ t('显示密码') }}</span></label>
      </div>
      <button class="go save" :class="saveCls('apn')" :disabled="!lteReady || lteBusy || saveOff('apn')" @click="saveApn">{{ saveLbl('apn') }}</button>
      <p v-if="saveWhy('apn')" class="save-why" :class="saveTone('apn')">{{ saveWhy('apn') }}</p>
      <template v-if="lteReady">
        <p class="label">{{ t('状态信息') }}</p>
        <div class="card lte-stat">
          <p v-for="row in lteRows" :key="row.key"><small>{{ t(row.key) }}</small><b>{{ row.value }}</b></p>
        </div>
      </template>
      <button v-if="lteState === 'silent'" class="ghost" @click="startLtePage">{{ t('重新读取') }}</button>
    </section>

    <section v-else-if="page === 'modver'" class="body">
      <p class="note">{{ t('这是充电桩里的蓝牙/WiFi 模组自己报告的版本，充电桩上电时读出来保存着。') }}</p>
      <div v-for="item in modverItems" :key="item.key + item.value" class="card">
        <small class="verkey">{{ t(modverLabel(item.key)) }}</small>
        <strong class="verval">{{ item.value }}</strong>
      </div>
      <p class="note">{{ t(modverNote) }}</p>
      <button class="ghost" :disabled="modverState === 'asking'" @click="startModver(true)">{{ t('重新读取') }}</button>
      <p class="label">{{ t('蓝牙广播诊断') }}</p>
      <div v-if="advState === 'ok'" class="card">
        <p v-for="row in advList" :key="row.label" class="note">{{ t(row.label) }}: {{ row.value }}</p>
      </div>
      <p class="note">{{ t(advNote) }}</p>
      <button class="ghost" :disabled="advState === 'asking'" @click="startAdv">{{ t('重新读取') }}</button>
    </section>

    <section v-else-if="page === 'ota'" class="body">
      <p class="note">{{ t('选择本机上的应用固件。发送前 10 路都会先停充，并在升级过程中暂停 WiFi 和 OCPP。整包 CRC 会先发给充电桩，收完再核对。重启后原来的配置还在。') }}</p>
      <p class="note">{{ t('只能选摩托车充电桩 M01 的固件（文件里有 M01VER= 标记）') }}</p>
      <input ref="firmwareInput" class="file" type="file" accept="*/*" @change="onFirmwareFile">
      <CloudFw kind="m01" :disabled="otaBusy" :t="t" @loaded="onCloudFirmware">
        <button class="ghost" @click="pickFirmware">{{ t('选择固件文件') }}</button>
      </CloudFw>
      <div v-if="otaName" class="card">
        <strong>{{ otaName }}</strong>
        <p class="note">{{ t('大小') }} {{ otaSize }} {{ t('字节') }}</p>
        <p v-if="otaFileVer" class="note">{{ t('文件版本') }} {{ verLabel(otaFileVer) }}</p>
        <p v-if="otaCrc" class="note">{{ t('整包 CRC') }} {{ otaCrc }}</p>
      </div>
      <div v-if="otaPhase === 'preparing' || otaPhase === 'ready' || otaPhase === 'prepfail'" class="card">
        <p class="note">{{ chargeQuiet ? t('充电已停止') : t('充电还未停止') }}</p>
        <p class="note">{{ wifiQuiet ? t('WiFi 已关闭') : t('WiFi 还未关闭') }}</p>
        <p class="note">{{ ocppQuiet ? t('OCPP 已关闭') : t('OCPP 还未关闭') }}</p>
      </div>
      <div v-if="otaPhase === 'sending' || otaPhase === 'done' || otaPhase === 'error'" class="ota-progress">
        <div class="ota-track"><div class="ota-fill" :style="{ width: otaPercent + '%' }"></div></div>
        <p class="note">{{ t('已发送 {done} / {total}', { done: otaDone, total: otaTotal }) }}</p>
        <p class="ota-time">{{ t('{m}分{s}秒', { m: otaMinutes, s: otaSeconds }) }}</p>
      </div>
      <p class="note" :class="{ warn: otaTypeBad }">{{ t(otaNote, otaNoteVars) }}</p>
      <button v-if="otaPhase === 'downgrade'" class="go" @click="acceptDowngrade">{{ t('确认降级升级') }}</button>
      <button v-if="otaPhase === 'downgrade'" class="ghost" @click="cancelDowngrade">{{ t('取消') }}</button>
      <button v-if="otaPhase === 'file' || otaPhase === 'prepfail'" class="go" @click="beginUpgrade">{{ otaPhase === 'prepfail' ? t('重新检查') : t('开始升级') }}</button>
      <button v-if="otaPhase === 'ready'" class="go" @click="confirmUpgrade">{{ t('确认升级') }}</button>
    </section>

    <section v-else-if="page === 'telemetry'" class="body">
      <p class="note">{{ t('打开后，遥测串口每秒发送一帧遥测。关闭后，这路串口不再发送任何遥测数据。断电后仍然有效。') }}</p>
      <label class="row">
        <span>
          <strong>{{ t('开启遥测') }}</strong>
          <small>{{ t('关闭后上位机收不到状态') }}</small>
        </span>
        <input type="checkbox" :checked="telemetry" @change="setTelemetry($event.target.checked)">
      </label>
      <p class="note">{{ t('打开遥测会关闭 4G') }}</p>
      <p class="note">{{ t(telemetryNote) }}</p>
    </section>

    <nav v-if="tabBarOn" class="tabbar" role="tablist">
      <button v-for="item in TABS" :key="item.id" class="tab" :class="{ on: page === item.id }"
              role="tab" :aria-selected="page === item.id ? 'true' : 'false'" @click="goTab(item.id)">
        <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
          <path v-if="item.id === 'charge'" fill="currentColor" d="M13.2 2 4.5 13.4h6.2L9.8 22l8.7-11.4h-6.2L13.2 2z"/>
          <g v-else-if="item.id === 'orders'" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="4.5" y="3" width="15" height="18" rx="2.5"/>
            <path d="M8.5 8h7M8.5 12h7M8.5 16h4.5"/>
          </g>
          <path v-else fill="currentColor" d="M19.4 13.4a7.8 7.8 0 0 0 .1-1.4 7.8 7.8 0 0 0-.1-1.4l2-1.6-2-3.4-2.4 1a7.2 7.2 0 0 0-1.2-.7L15.2 3h-6.4L8.2 6a7.2 7.2 0 0 0-1.2.7l-2.4-1-2 3.4 2 1.6a7.8 7.8 0 0 0 0 2.8l-2 1.6 2 3.4 2.4-1a7.2 7.2 0 0 0 1.2.7L8.8 21h6.4l.6-2.9a7.2 7.2 0 0 0 1.2-.7l2.4 1 2-3.4-2-1.6zM12 15.2A3.2 3.2 0 1 1 12 8.8a3.2 3.2 0 0 1 0 6.4z"/>
        </svg>
        <span>{{ t(item.label) }}</span>
      </button>
    </nav>
  </main>
</template>

<script setup>
import { computed, inject, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { SAVE_IDLE, SAVE_SILENT, SAVE_TEXT, createSaveBtns, saveClass, saveLabel, saveLocked } from "./save-btn.js";
import PrivacyPolicy from "../PrivacyPolicy.vue";
import CloudFw from "../CloudFw.vue";
import { languages } from "../i18n.js";
import { firmwareTypeError } from "../ota-guard.js";
import { m01Translate } from "./t.js";
import { h5Rev } from "../app-version.js";
import { h5RevLabel } from "../h5-update.js";
import { TABS, isTabPage, rootBack, subpageBack, tabBarShown } from "./tabs.js";
import { IMPORT_MAX_BYTES, PROFILE_KEY, exportFileName, exportText, importText, makeProfile, storedProfileOk } from "./profile-file.js";
import { createQueue } from "./ble-queue.js";
import { applyPushPorts, applyPushPortsX, applySnapPages, createSnapPoller, emptyBoard, freshness, newestAge } from "./port-board.js";
import { OTA_CHUNK, otaWindowFor, parseDataAck, sendOtaChunks } from "./ota-window.js";
import { wifiStatusText } from "./wifi-rssi.js";
import { NET_OFF_NOTE, SCAN_LIMIT_MS, createWifiScan, netSwitchOff, parseApLine, refusedNote } from "./wifi-setup.js";
import { modverLabel, modverShort, parseModver, readModver } from "./modver.js";
import { advRows, parseAdv, readAdv } from "./adv-diag.js";
import { LTE_PROTOS, apnCommand, apnError, lteCellText, lteExclusive, lteHomeText, lteRegLabel, lteSetCommand, lteSignalText, lteSimLabel, lteStateLabel, parseApn, parseLteAck, parseLteBrief, parseLteCell, parseLteStat, parseLteSwitch, pollLteStat, readApn, readLte, rereadSwitches, sendLteSet } from "./lte.js";
import { TZ_ZONES, parseTzAck, saveZone, tzIndex, tzLabel } from "./tz.js";
import { CLOCK_RESYNC_MS, CLOCK_RETRY_MS, chargerClock, parseTimeGet, readChargerTime } from "./charger-clock.js";
import { parseTimeAck, phoneTzMinutes, runTimeSync, zoneRereadDue } from "./time-sync.js";
import { AUTH_LOCK_SECONDS, authDecide, commandName, isOtaCommand, lockLeft, lockNote, parseAuthLine, pinOk, queueRefused, resendable } from "./auth.js";
import { DEFAULT_OVER_V, DEFAULT_UNDER_V, SECTIONS, blankBody, cleanProfileName, ocppUrlOk, profilePorts, profileWantsReboot, readPlan, sameSection, sectionSkip, voltageLimitError, writePlan } from "./profile.js";
import { PAR_SWITCH_TIMEOUT_MS, parSwitchStep, parSwitchText, runParSwitch } from "./par-switch.js";
import { APP_VERSION, FW_UNKNOWN, compatNotice, fwGiveUp, fwState, isDowngrade, lackNote, sectionLack, supports } from "./fw-compat.js";
import { TOGGLE_ALL, TOGGLE_GAP_MS, newToggleGuard, resetToggleGuard, toggleBlocked, toggleMark, toggleNextMs, toggleRelease, toggleTap } from "../charge-toggle-guard.js";
import { PARALLEL_MODES, PORT_COUNT, PORTSEL_SECONDS, faultLabel, fmtDuration, fmtIsoClock, fmtKwh, fmtMoney, fmtUnix, fmtWatts, orderCollector, orderPayRows, orderReasonLabel, ordersCommand, parallelLabel, parallelPorts, parseFlt, parseOrder, parseOrderSum, parsePar, parseParSet, parsePay, parsePaySet, parsePlim, parsePort, parsePortAck, parsePorts, parsePortsX, parseSys, payCommand, payModelLabel, pickSsid, plimCommand, plimValue, portAckText, portBusy, portStatus, portsSummary, sameSsid, selectLeft, startLabel, stopLabel } from "./ports.js";

/* 合并进 AC06 App 后：语言由外壳（App.vue）统一存在 ac06-lang 里，这里从 props 拿，
 * 在这里选了语言就告诉外壳（set-lang），外壳存下再传回来。 */
const props = defineProps({ lang: { type: String, default: "en" } });
const emit = defineEmits(["exit", "set-lang"]);
const lang = computed(() => props.lang);
const currentLangName = computed(() => {
  const found = languages.find((item) => item.id === lang.value);
  return found ? found.name : "English";
});
const langFrom = ref("charge");
function openLang() {
  langFrom.value = isTabPage(page.value) ? page.value : "link";
  if (page.value === "menu") menuPull++;
  page.value = "lang";
}
function leaveLang() {
  if (langFrom.value === "link") page.value = "link";
  else if (linkReady.value) goTab(langFrom.value);
  else page.value = "link";
}
function setLang(id) {
  emit("set-lang", id);
  leaveLang();
}
/* 提示可以是一句（中文是翻译的键）加占位符，也可以是 { text, vars }（fw-compat.js 的 lackNote
 * 这样给）。先查 M01 自己的表，没有的再查 AC06 的表（t.js）。 */
function t(text, vars) {
  return m01Translate(lang.value, text, vars);
}

const page = ref("link");
const note = ref("正在连接");
const noteVars = ref(null);
const linkName = ref("");
const ocppText = ref("OCPP 未连接");
const ocppKind = ref("off");
const fw = ref("—");
/* 这台桩的固件情况（fw-compat.js）：连上后从 ACK SYS 拿版本和能力位，换一台桩、断开时清掉。
 * 别的代码只问 can("能力名")，不自己比版本号。 */
const fwInfo = ref(FW_UNKNOWN);
function can(key) {
  return supports(fwInfo.value, key);
}
/* 首页和菜单顶上那一行：固件比 App 旧、新、太老、读不到版本。 */
const compatShown = computed(() => compatNotice(fwInfo.value, APP_VERSION));
/* 整桩（ACK SYS）、板级故障（FLT）、10 路概况（ACK PORTS）。 */
const sys = reactive({ busV: null, tempC: null, mains: false });
const sysSeen = ref(false);
const clockIso = ref("");
const fltNames = ref([]);
const ports = ref([]);
const portsSeen = ref(false);
let portsAt = 0;
const stopAllAsk = ref(false);
/* 单路详情页（ACK PORT，每秒问一次）。 */
const portSel = ref(0);
const portInfo = ref(null);
const portNote = ref("");
const portNoteVars = ref(null);
const portBusyCmd = ref(false);
/* 每路的电流和离线刷卡订单的余额（ACK SNAP，老固件是 ACK PORTX）。还不知道是 null。 */
const portsX = ref([]);
/* 每路取数时的母线电压、这一格最后一次更新的时刻（port-board.js）。格子按它标新旧。 */
const portsV = ref([]);
const portsTime = ref([]);
/* 充电规则（ACK PAY）和并充（ACK PAR）。 */
const pay = reactive({
  offline: false, net: false, model: 1, fullW: 10, min: 1, max: 100, oper: "",
  hold: 300, holdMin: 10, holdMax: 3600,
});
const payKnown = ref(false);
const payModel = ref(1);
const payFullW = ref("");
const payHoldS = ref("300");
const payNote = ref("");
const payBusy = ref(false);
const par = reactive({ mode: 1, ports: PORT_COUNT, saved: 1 });
const parKnown = ref(false);
const parPick = ref(1);
const parNote = ref("");
const parNoteVars = ref(null);
const parWarn = ref(false);
const parAsk = ref(false);
/* 切换并充的结果，蓝牙断开以后在选择充电桩页上留一行（扫描的提示会盖掉 note）。 */
const parLost = ref("");
/* 切换并充时蓝牙断开了（含切换成功后桩重启）：同一台桩重新连上以后读一次 PARGET 核对。 */
let parAfter = null;
let parRun = 0;
const parBusy = ref(false);
const parModes = PARALLEL_MODES;
/* 选枪刷卡：选的是哪一路、到什么时候为止、当时这一路是什么状态。 */
const selPort = ref(0);
const selUntil = ref(0);
let selLetter = "";
let selArmAt = 0;
const nowTick = ref(Date.now());
/* 功率上限（ACK PLIM）。 */
const plimKnown = ref(false);
const plimMin = ref(50);
const plimMax = ref(2000);
const plimLimits = ref([]);
const plimInputs = ref(Array(PORT_COUNT).fill(""));
const plimDirty = ref(false);
const plimAll = ref("");
const plimOne = ref("");
const plimOneDirty = ref(false);
const plimNote = ref("");
const plimNoteVars = ref(null);
const plimBusy = ref(false);
const wifi = ref("WiFi —");
const wifiSaved = ref("未配置热点");
const aps = ref([]);
const wifiNote = ref("");
const picked = ref("");
const password = ref("");
const ocppUrl = ref("");
const ocppNote = ref("");
const cfgNote = ref("");
const cfg = reactive({ over: String(DEFAULT_OVER_V), under: String(DEFAULT_UNDER_V) });
const tzMin = ref(480);
const tzKnown = ref(false);       /* 这次连接读到过桩的时区（ACK TZ、ACK TIME） */
const orders = ref([]);
const ordersDone = ref(false);
const ordersBusy = ref(false);
const ordersNote = ref("");
const ordersTotal = ref(null);
const ordersMore = ref(false);
const telemetry = ref(false);
const linkAddr = ref("");
const gateState = ref("unknown");
const gateInput = ref("");
const gateSave = ref(true);
const gateAuto = ref(false);
const gateNote = ref("");
const gatePass = ref("");
const gateEnter = ref(false);
/* 蓝牙鉴权（规则见 auth.js）。
 *   gateLockLeft    锁定还剩几秒，0 = 没有在倒计时。密码页的按钮和提示跟着它变。
 *   gateLockKnown   固件给了剩余秒数。没给就只说“稍后再试”，不倒计时。
 *   gateLockRetry   锁定结束后自动再试一次用的密码（锁定前没来得及核对的那一个）。
 *   gateReauth      正在悄悄重发 AUTH：桩那边把这条连接的鉴权作废了（蓝牙恢复流程、
 *                   模组换了连接），界面不动，通过后把被拒的命令补发。
 *   gateRefused     等着补发的命令；lastSent 是每个命令名最后发出去的那一条。 */
const gateLockLeft = ref(0);
const gateLockKnown = ref(false);
let gateLockUntil = 0;
let gateLockTimer = 0;
let gateLockRetry = "";
let gateReauth = false;
let gateReauthTries = 0;
let gateRefused = [];
const lastSent = {};
/* 密码页上那一行提示。倒计时走着的时候是“已锁定，N 秒后可以再试”；固件没给秒数时
 * gateNote 里就是“已锁定，请稍后再试”那一句。 */
const gateNoteShown = computed(() => {
  if (gateLockLeft.value > 0) {
    const shown = lockNote(gateLockLeft.value, true);
    return t(shown.text, shown.vars);
  }
  return t(gateNote.value);
});
const linkReady = ref(false);
const ocfwOn = ref(false);
const ocfwText = ref("");
const ocfwNote = ref("");

const telemetryNote = ref("");
const telemetryHold = ref(0);
const wifiOn = ref(false);
const wifiJoining = ref(false);
let wifiJoinTimer = 0;
let wifiJoinStart = 0;
let wifiJoinWanted = "";
const ocppOn = ref(false);
const wifiSwHold = ref(0);
const ocppSwHold = ref(0);
const netStopOn = ref(false);
const netStopSec = ref("60");
const netStopNote = ref("");
const netStopHold = ref(0);
const rebootAsk = ref(false);
const rebootNote = ref("");
const profiles = ref([]);
const profileAskId = ref("");
const profileDeleteId = ref("");
const profileNaming = ref("save");
const profileEditId = ref("");
const profileNameInput = ref("");
const profileNameNote = ref("");
const profileMode = ref("read");
const profileTitle = ref("");
const profileLog = ref([]);
const profileLogBox = ref(null);
const profileDone = ref(0);
const profileTotal = ref(0);
const profilePercent = ref(0);
const profileFinished = ref(false);
const profileDoneNote = ref("");
let profileRunId = 0;
let wifiClosedOcpp = false;
/* 这次打开 WiFi（"wifi"）或遥测（"tel"）顺带关掉了 4G，保存成功的提示里要写上。 */
let lteClosedBy = "";

const pageTitle = computed(() => {
  if (page.value === "link") return "摩托车充电桩 M01";
  if (page.value === "authinfo") return "管理员密码";
  if (page.value === "menu") return "充电桩配置";
  if (page.value === "port") return "第 {n} 路";
  if (page.value === "plim") return "功率上限";
  if (page.value === "pay") return "充电规则";
  if (page.value === "par") return "并充";
  if (page.value === "wifi") return "WiFi 配网";
  if (page.value === "lte") return "4G 设置";
  if (page.value === "pass") return "填写密码";
  if (page.value === "ocpp") return "OCPP 服务器";
  if (page.value === "cfg") return "保护设置";
  if (page.value === "telemetry") return "遥测";
  if (page.value === "ocfw") return "OCPP上报版本号";
  if (page.value === "gate") return "管理员密码";
  if (page.value === "privacy") return "隐私协议";
  if (page.value === "lang") return "语言";
  if (page.value === "orders") return "充电记录";
  if (page.value === "ota") return "固件升级";
  if (page.value === "modver") return "蓝牙WiFi版本";
  if (page.value === "tz") return "时区设置";
  if (page.value === "netstop") return "断网停充";
  if (page.value === "reboot") return "重启";
  if (page.value === "profiles") return "一键配置";
  if (page.value === "profileName") return profileNaming.value === "rename" ? "重命名" : "保存配置";
  if (page.value === "profileRun") return profileMode.value === "read" ? "读取配置" : "下发配置";
  return "10 路充电桩";
});
const pageTitleVars = computed(() => (page.value === "port" ? { n: portSel.value } : null));

/* 板级故障那一行：名字翻译好，几个故障用 " · " 连起来。 */
const faultText = computed(() => fltNames.value.map((name) => t(faultLabel(name))).join(" · "));
/* 桩时间：ACK SYS 里的 UTC 加上桩的时区。 */
const clock = computed(() => fmtIsoClock(clockIso.value, tzMin.value));
/* 汇总只算没过期的格子；有过期的，总功率不写数。 */
const summary = computed(() => {
  const live = ports.value.filter((item, i) => freshness(portsTime.value[i] || 0, nowTick.value).level !== "stale");
  return { ...portsSummary(live), stale: live.length < ports.value.length };
});
/* 全部格子里最新的那一格多旧了：超过 5 秒在首页写一行提示。 */
const homeAge = computed(() => newestAge({ at: portsTime.value }, nowTick.value));
const selLeft = computed(() => (selPort.value && selPort.value === portSel.value
  ? selectLeft(selUntil.value, nowTick.value) : 0));
/* 首页的格子，一路一格（并充时少于 10 路）。还没收到数时先按端口数画空格子。
 * 每格：路号、状态、功率、时长和电量、电压和电流、离线刷卡的余额、启动或停止按钮。
 * 每格各自记着更新时刻：超过 5 秒写"几秒前"，超过 15 秒算过期，数不再显示。 */
const portCards = computed(() => {
  const count = parKnown.value ? par.ports : PORT_COUNT;
  const list = ports.value.length ? ports.value
    : Array.from({ length: count }, (_, index) => ({ port: index + 1, s: "", w: 0, wh: 0, sec: 0 }));
  return list.map((item) => {
    const st = item.s ? portStatus(item.s) : { name: "—", label: "…", kind: "off" };
    const live = portBusy(item.s);
    const age = freshness(portsTime.value[item.port - 1] || 0, nowTick.value);
    const show = live && age.level !== "stale";
    const extra = portsX.value[item.port - 1] || null;
    const v = portsV.value[item.port - 1];
    const volts = typeof v === "number" ? v.toFixed(1) + " V" : "—";
    return {
      port: item.port,
      kind: st.kind,
      label: st.label,
      name: st.name,
      sel: selPort.value === item.port && selectLeft(selUntil.value, nowTick.value) > 0,
      live,
      ready: item.s === "P" || item.s === "R",
      age: age.level,
      ageSec: age.sec,
      watts: show ? fmtWatts(item.w) : "—",
      kwh: show ? fmtKwh(item.wh) : "",
      time: show ? fmtDuration(item.sec) : "",
      /* 电压各路量的是同一个母线电压（取这一格数的那一刻的）；电流是这一路自己的。 */
      va: show ? volts + " · " + (extra ? extra.a.toFixed(2) + " A" : "— A") : "",
      bal: show && extra && extra.bal !== null ? fmtMoney(extra.bal) : "",
    };
  });
});
/* 详情页。ACK PORT 还没到时先用首页那一行里有的。 */
const portView = computed(() => {
  const info = portInfo.value && portInfo.value.port === portSel.value ? portInfo.value : null;
  const brief = ports.value[portSel.value - 1] || null;
  const letter = info ? info.s : (brief ? brief.s : "");
  const st = letter ? portStatus(letter) : { name: "—", label: "正在读取", kind: "off" };
  const src = info || brief;
  return {
    kind: st.kind,
    label: st.label,
    name: st.name,
    fault: info ? faultLabel(info.fault) : "",
    v: info ? info.v.toFixed(1) + " V" : "—",
    a: info ? info.a.toFixed(2) + " A" : "—",
    w: src ? fmtWatts(src.w) : "—",
    time: src ? fmtDuration(src.sec) : "--:--:--",
    kwh: src ? fmtKwh(src.wh) : "—",
    meter: info ? fmtKwh(info.meterWh) : "—",
    limit: info ? info.limitW + " W" : "—",
    source: info ? startLabel(info.source) : "",
    user: info ? info.user : "",
    lastStop: info ? stopLabel(info.lastStop) : "",
    lastFault: info ? faultLabel(info.lastFault) : "",
    fullLeft: info && info.fullLeft ? fmtDuration(info.fullLeft) : "",
    payModel: info && info.payModel ? payModelLabel(info.payModel) : "",
    balance: info ? fmtMoney(info.balance) : "—",
    cost: info ? fmtMoney(info.cost) : "—",
    rate: info ? fmtMoney(info.rate) + " / kWh" : "—",
  };
});
/* 菜单上那一行。固件没有这项（fw-compat.js）写"需升级固件"。 */
const payBrief = computed(() => {
  if (!can("payRules")) return t("需升级固件");
  return payKnown.value ? t(payModelLabel(pay.model)) : "…";
});
const parBrief = computed(() => {
  if (!can("parallel")) return t("需升级固件");
  return parKnown.value ? String(par.ports) : "…";
});
/* 充电规则页：老固件的持续秒数是固定的，不能改（PAYSET 只认两个参数）。 */
const payHoldLack = computed(() => lackNote(fwInfo.value, "payHold", "hold", { s: pay.hold }));
const plimBrief = computed(() => {
  const list = plimLimits.value;
  if (!plimKnown.value || !list.length) return "…";
  const low = Math.min.apply(null, list);
  const high = Math.max.apply(null, list);
  return low === high ? low + " W" : low + "–" + high + " W";
});

function bridge() {
  return window.EVC || null;
}
function send(text) {
  const api = bridge();
  if (!api || gone) return;
  /* 记下每个命令名最后发出去的那一条：桩回 "ACK <命令名> AUTH" 时知道该补发哪一条。 */
  if (resendable(text)) lastSent[commandName(text)] = String(text);
  api.send(text);
}
onMounted(() => {
  profiles.value = loadProfiles();
});
/* 外壳把点了的那台交过来（已经 setProfile("m01")）。opts.pin：先按 AC06 连、在 AC06 的密码页
 * 输过密码、连上才认出是 M01 时，外壳把那个密码带过来，不用再输一次。 */
function connect(item, opts) {
  linkAddr.value = item.addr || "";
  linkName.value = item.name || "";
  resetGateSession();
  stopGateLock();
  gateState.value = "need";
  gatePass.value = "";
  gateEnter.value = true;
  gateInput.value = "";
  gateSave.value = true;
  resetCharge();
  const carried = opts && pinOk(opts.pin) ? String(opts.pin) : "";
  if (carried) {
    gateAuto.value = false;
    gatePass.value = carried;
    gateSave.value = opts.save !== false;
    gateNote.value = "正在连接并核对";
    page.value = "gate";
    bridge().connect(item.addr);
    return;
  }
  const saved = savedGate();
  if (/^\d{6}$/.test(saved)) {
    gateAuto.value = true;
    gatePass.value = saved;
    note.value = "正在连接并核对已保存的密码";
    noteVars.value = null;
    page.value = "link";
    bridge().connect(item.addr);
    return;
  }
  gateAuto.value = false;
  page.value = "gate";
  gateNote.value = "请输入充电桩的 6 位管理员密码";
}
function gateKey() {
  return "m01-gate:" + linkAddr.value;
}
function savedGate() {
  if (!linkAddr.value) return "";
  const api = bridge();
  if (api && api.loadGate) {
    try {
      const pin = api.loadGate(linkAddr.value) || "";
      if (/^\d{6}$/.test(pin)) return pin;
    } catch (e) {}
  }
  try {
    return localStorage.getItem(gateKey()) || "";
  } catch (e) {
    return "";
  }
}
function rememberGate(pass) {
  if (!linkAddr.value || !/^\d{6}$/.test(pass)) return;
  const api = bridge();
  if (api && api.saveGate) {
    try { api.saveGate(linkAddr.value, pass); } catch (e) {}
  }
  try { localStorage.setItem(gateKey(), pass); } catch (e) {}
}
function forgetGate() {
  if (!linkAddr.value) return;
  const api = bridge();
  if (api && api.saveGate) {
    try { api.saveGate(linkAddr.value, ""); } catch (e) {}
  }
  try { localStorage.removeItem(gateKey()); } catch (e) {}
}
/* ---- 锁定倒计时、恢复后悄悄重新核对（auth.js，固件 1.3.0 起每条连接要先 AUTH） ---- */
function stopGateLock() {
  if (gateLockTimer) clearInterval(gateLockTimer);
  gateLockTimer = 0;
  gateLockUntil = 0;
  gateLockLeft.value = 0;
  gateLockKnown.value = false;
  gateLockRetry = "";
}
function gateLockTick() {
  gateLockLeft.value = gateLockKnown.value ? lockLeft(gateLockUntil, Date.now()) : 0;
  if (Date.now() < gateLockUntil) return;
  /* 到点了。锁定前没来得及核对的密码自动再试一次；没有就请用户重新输入。 */
  const retry = gateLockRetry;
  stopGateLock();
  if (page.value !== "gate" || gateState.value === "ok") return;
  if (pinOk(retry) && linkReady.value) {
    gateNote.value = "锁定已解除，正在核对密码";
    sendAuth(retry, true);
  } else {
    gateNote.value = "锁定已解除，请重新输入密码";
  }
}
function startGateLock(seconds, retryPass) {
  stopGateLock();
  gateLockKnown.value = seconds !== null;
  gateLockUntil = Date.now() + (seconds === null ? AUTH_LOCK_SECONDS : seconds) * 1000;
  gateLockRetry = pinOk(retryPass) ? String(retryPass) : "";
  gateLockLeft.value = gateLockKnown.value ? lockLeft(gateLockUntil, Date.now()) : 0;
  gateLockTimer = setInterval(gateLockTick, 250);
}
function resetGateSession() {
  /* 换了一条连接（或者断开了）：上一条连接上的重发次数、补发清单都不带过来。 */
  gateReauth = false;
  gateReauthTries = 0;
  gateRefused = [];
  Object.keys(lastSent).forEach((name) => { delete lastSent[name]; });
}
/* 一行是不是鉴权应答；是的话在这里办完，返回 true。放在 applyLine 最前面：
 * "ACK TIMESET AUTH"、"ACK LTESET AUTH" 这些行后面各有各的解析，轮不到 applyAck。 */
function applyAuthLine(line) {
  const reply = parseAuthLine(line);
  if (!reply) return false;
  /* 核对密码的那条命令是从队列发的（sendAuth）：让它收下应答，队列好往下走。
   * "ACK <命令名> AUTH" 不交给队列：在等的那条命令留着，重新通过后补发的那一条的应答
   * 到了它照常收下。 */
  if (reply.kind !== "need") queue.feed(line);
  /* 重发过的 AUTH 会回两次：只有还在核对时才处理，不把已经进了别的页面的人拉回首页。 */
  if ((reply.kind === "ok" || reply.kind === "fail") && gateState.value !== "checking") return true;
  const step = authDecide(reply, {
    state: gateState.value,
    reauth: gateReauth,
    pass: gatePass.value,
    saved: savedGate(),
    tries: gateReauthTries,
  });
  if (step.action === "enter") {
    stopGateLock();
    gateState.value = "ok";
    gateAuto.value = false;
    if (gateSave.value) rememberGate(gatePass.value);
    else forgetGate();
    gateInput.value = "";
    gateEnter.value = false;
    page.value = "charge";
    note.value = "";
    enterHome();
    return true;
  }
  if (step.action === "resume") {
    /* 悄悄重发的那一次通过了：界面留在原来的页，把被拒的命令补发。 */
    const again = gateRefused;
    gateRefused = [];
    gateReauth = false;
    stopGateLock();
    gateState.value = "ok";
    gateEnter.value = false;
    if (note.value === "连接已恢复，正在重新核对密码") note.value = "";
    again.forEach((text) => send(text));
    startTimeSync();
    return true;
  }
  if (step.action === "reauth" || step.action === "wait") {
    /* 桩说这条连接还没通过 AUTH：这条命令没有执行。记下来，通过后补发。 */
    if (lastSent[step.cmd]) gateRefused = queueRefused(gateRefused, lastSent[step.cmd]);
    if (step.action === "reauth") {
      gateReauth = true;
      gateReauthTries++;
      if (page.value === "charge") note.value = "连接已恢复，正在重新核对密码";
      /* 不走队列：队列里在等的那条命令还没走完，排在它后面就要等它超时。 */
      gatePass.value = step.pass;
      gateEnter.value = false;
      gateState.value = "checking";
      send("AUTH\t" + step.pass);
    }
    /* 升级流程在等自己的应答：让它看到这一行，按发送失败处理。 */
    if (isOtaCommand(step.cmd) && typeof otaWait === "function") otaWait(line);
    return true;
  }
  if (step.action === "ask") {
    gateReauth = false;
    gateRefused = [];
    gateState.value = "need";
    gateAuto.value = false;
    gateEnter.value = false;
    if (page.value !== "gate") {
      /* 已经在密码页上就不动：用户可能正输到一半。 */
      gateInput.value = "";
      page.value = "gate";
      gateNote.value = "请输入充电桩的 6 位管理员密码";
    }
    return true;
  }
  if (step.action === "wrong") {
    gateReauth = false;
    gateRefused = [];
    stopGateLock();
    gateState.value = "need";
    gateAuto.value = false;
    forgetGate();
    gateEnter.value = false;
    gateInput.value = "";
    gateSave.value = true;
    page.value = "gate";
    gateNote.value = "密码不对。请重新输入管理员密码";
    return true;
  }
  if (step.action === "locked") {
    /* 已锁定：不是这个密码不对（锁着的时候输对了也是这一行），记住的密码不删。 */
    gateReauth = false;
    gateRefused = [];
    gateState.value = "need";
    gateAuto.value = false;
    gateEnter.value = false;
    page.value = "gate";
    gateNote.value = "输错次数太多，已锁定。请稍后再试";
    startGateLock(step.seconds, step.retry ? gatePass.value : "");
    return true;
  }
  return false;
}
function disconnect() {
  bridge().disconnect();
}
function back() {
  if (page.value === "pass") {
    stopWifiJoin("");
    wifiJoinWanted = "";
    page.value = "wifi";
    return;
  }
  if (wifiJoining.value) return;
  if (page.value === "privacy") goTab("menu");
  else if (page.value === "lang") leaveLang();
  else if (page.value === "gate") {
    gateEnter.value = false;
    bridge().disconnect();
  }
  else if (page.value === "link") bridge().disconnect();
  else if (page.value === "ota") {
    otaRun++;
    stopOtaClock();
    if (otaPhase.value === "preparing" || otaPhase.value === "ready" ||
        otaPhase.value === "prepfail" || otaPhase.value === "sending") {
      send("OTAABORT");
      /* 放弃了就回到“已选文件”：otaBusy 不能一直是真，不然首页和详情页不再刷新。 */
      otaPhase.value = otaImage ? "file" : "";
      otaNote.value = "发送过程中充电桩亮白灯快闪";
    }
    linkFast(false);
    goTab(subpageBack("ota", tab.value));
  }
  else if (page.value === "profileRun") {
    profileRunId++;
    profileFinished.value = false;
    page.value = "profiles";
    profiles.value = loadProfiles();
  }
  else if (page.value === "profileName") {
    page.value = "profiles";
  }
  else if (page.value === "port") {
    portSel.value = 0;
    goTab("charge");
  }
  else if (rootBack(page.value)) goTab(rootBack(page.value));
  else {
    profileAskId.value = "";
    profileDeleteId.value = "";
    goTab(subpageBack(page.value, tab.value));
  }
}
/* 手机侧滑和返回键（外壳的 window.evcTryBack 在 M01 模块时转到这里）。总是返回 true，不让
 * Android 退出应用：立即充电页和「断开蓝牙」一样 disconnect()，手机那一层报 page "scan" 后外壳
 * 回到扫描列表；连接中、密码页由 back() 断开；记录、设置两个标签回立即充电；其余回上一级。 */
function tryBack() {
  if (page.value === "charge") {
    disconnect();
    return true;
  }
  back();
  return true;
}
/* ---- 底部标签栏（规则见 tabs.js） ---- */
const tab = ref("charge");
watch(page, (now) => {
  if (isTabPage(now)) tab.value = now;
});
/* ---- 设置页的「保存」按钮（状态机见 save-btn.js，和 AC06 的 App.vue 同一种做法） ----
 * 保存的结果只写在按钮上：保存中… → 保存成功 / 保存成功，重启生效 / 保存失败：原因，2.5 秒后
 * 变回「保存」；这期间按钮不可点。长的原因写在按钮下面紧挨着的一行小字里（saveWhy），留到
 * 下一次点保存或离开这一页。等不到充电桩应答按「保存失败：充电桩没有应答」。换页回到「保存」，
 * 组件卸掉时清掉定时器。 */
const saveUi = reactive({});
const saveBtns = createSaveBtns({
  onChange: (id, state) => { saveUi[id] = state; },
  onDone: (id, kind) => saveShown(id, kind),
});
function saveSt(id) { return saveUi[id] || SAVE_IDLE; }
function saveLbl(id, idleText, brief) {
  return saveLabel(saveSt(id), idleText == null ? t(SAVE_TEXT.idle) : idleText, t, brief);
}
function saveCls(id) { return saveClass(saveSt(id)); }
function saveOff(id) { return saveLocked(saveSt(id)); }
function saveTone(id) { return saveSt(id).tone; }
function saveWhy(id) {
  const detail = saveSt(id).detail;
  return detail ? t(detail.text, detail.vars || undefined) : "";
}
/* 「保存成功」在按钮上显示完了：连热点回到首页（原来是一成功就跳走，按钮上的结果来不及看）。 */
function saveShown(id, kind) {
  if (kind === "ok" && id === "wifi" && page.value === "pass") {
    page.value = "charge";
    note.value = "已连接热点";
  }
}
/* ports.js / par-switch.js 给的 { ok, text, vars } → 按钮。短的一句直接当按钮上的原因；
 * 「没有保存。…」那种长的，按钮上写 why，整句放按钮下面。 */
function saveFromOut(id, out, why) {
  if (out.ok) return saveBtns.ok(id);
  if (out.text === SAVE_SILENT) return saveBtns.silent(id);
  if (why) return saveBtns.fail(id, why, { text: out.text, vars: out.vars });
  return saveBtns.fail(id, out.text === "充电桩没有接受" ? "充电桩不接受" : out.text);
}
watch(page, () => saveBtns.resetAll());
const typing = ref(false);
function typingTarget(el) {
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag !== "INPUT") return false;
  const kind = String(el.type || "text").toLowerCase();
  return kind !== "checkbox" && kind !== "radio" && kind !== "file" && kind !== "button";
}
function onFocusIn(event) { typing.value = typingTarget(event.target); }
function onFocusOut() { typing.value = false; }
onMounted(() => {
  document.addEventListener("focusin", onFocusIn);
  document.addEventListener("focusout", onFocusOut);
});
/* 外壳换模块（或断开）时把这个组件卸掉：每秒一拍、OTA 续期都停下，之后不再往蓝牙发任何东西
 * （等着的那几条命令的后续也不发）。不然换到 AC06 以后，这里还会对那条连接问 SNAPGET。 */
let gone = false;
onBeforeUnmount(() => {
  gone = true;
  linkReady.value = false;
  clearInterval(tickTimer);
  clearInterval(otaLeaseTimer);
  clearTimeout(toggleTimer);
  menuPull++;
  otaRun++;
  profileRunId++;
  document.removeEventListener("focusin", onFocusIn);
  document.removeEventListener("focusout", onFocusOut);
  stopTimeSync();
  stopGateLock();
  stopClk();
  stopOtaClock();
  stopScanTimer();
  queue.reset();
  saveBtns.dispose();
});
const tabBarOn = computed(() => tabBarShown(page.value, linkReady.value, gateState.value === "ok", typing.value));
function scrollTop() {
  try { window.scrollTo(0, 0); } catch (e) {}
}
function goTab(id) {
  if (!isTabPage(id)) return;
  if (page.value === id) {
    scrollTop();
    return;
  }
  if (page.value === "menu") menuPull++;
  if (id === "menu") openMenu();
  else if (id === "orders") openOrders();
  else page.value = "charge";
  scrollTop();
}
/* 设置 → 关于 → 管理员密码：只看、只清这台手机上记住的那个，不发命令（照 AC06）。 */
const gateRemembered = ref(false);
const authInfoNote = ref("");
function openAuthInfo() {
  menuPull++;
  gateRemembered.value = /^\d{6}$/.test(savedGate());
  authInfoNote.value = "";
  page.value = "authinfo";
}
function clearRememberedGate() {
  forgetGate();
  gateRemembered.value = /^\d{6}$/.test(savedGate());
  authInfoNote.value = "已清除。下次连接这台充电桩要重新输入密码。";
}
function openPrivacy() {
  if (page.value === "menu") menuPull++;
  page.value = "privacy";
}
/* 设置 → 关于：App 版本（AndroidManifest.xml 的 versionName）和 M01 模块对应的固件版本
 * （fw-compat.js 的 APP_VERSION，“固件比 App 旧 / 新”拿它比，和 App 的版本号分开）。 */
const appVersion = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "";
/* 界面热更新的修订号（../h5-update.js）：这一页编译时写进去的 __H5_REV__，接在 App 版本后面
 * （「V3.04 · 热更新 r0」）。这一行只显示，点了不检查更新。 */
const h5RevText = h5RevLabel(h5Rev(typeof __H5_REV__ === "number" ? __H5_REV__ : 0));
const M01_MODULE_VERSION = APP_VERSION;
function submitGate() {
  const pass = String(gateInput.value || "");
  if (gateLockLeft.value > 0) return;         /* 锁着：等倒计时走完 */
  if (!/^\d{6}$/.test(pass)) {
    gateNote.value = "请输入 6 位数字";
    return;
  }
  stopGateLock();                             /* 用户自己输了新的：不再自动重试旧的 */
  gatePass.value = pass;
  gateEnter.value = true;
  gateNote.value = "正在连接并核对";
  if (linkReady.value) {
    sendAuth(pass, true);
    return;
  }
  if (gateState.value === "checking") return;
  bridge().connect(linkAddr.value);
}
/* 一问一答的队列（ble-queue.js）：一次只有一条命令在路上，等到应答或超时再发下一条。
 * 读取、保存、每秒的单路详情都从这里走。心跳由 MainActivity 单独发；固件升级的数据片
 * （OTADATA）是多片在途，直接 send。 */
const queue = createQueue({ send });
function ask(command, accept, ms, opts) {
  return queue.ask(command, accept, ms, opts);
}
/* 首页 10 路的快照（port-board.js）：SNAPGET 一问一答，带请求号和校验。 */
const snapPoller = createSnapPoller({ ask, supported: () => can("snapshot") });
function head(text) {
  return (line) => typeof line === "string" && line.indexOf(text) === 0;
}
/* 读一行：应答由 applyLine 照常处理，这里只管排队和超时。 */
function fetchLine(command, prefix) {
  return ask(command, head(prefix), 2000);
}
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendAuth(pass, enterAfter) {
  gatePass.value = pass;
  gateEnter.value = !!enterAfter;
  gateState.value = "checking";
  for (let attempt = 0; attempt < 3; attempt++) {
    const line = await ask("AUTH\t" + pass, head("ACK AUTH"), 2500);
    if (line || gateState.value !== "checking" || !linkReady.value) return;
  }
  gateState.value = "need";
  gateAuto.value = false;
  page.value = "gate";
  gateNote.value = "充电桩没有应答，请再试一次";
}
/* 密码通过、进了首页之后：先确认固件版本（fw-compat.js），再读一遍时区（首页钟点和充电记录
 * 按它算）、功率上限，再授时。 */
async function enterHome() {
  await identifyFirmware();
  if (!linkReady.value) return;
  checkParAfter();
  refreshZone();
  readPlim();
  startTimeSync();
}
/* 连上后第一步拿固件版本：手机那一层连上就发 STATUS，桩回的 ACK SYS 第 1 个字段是版本
 * （通过 AUTH 之前也回），applySys() 收下。到这里还没有就再要三次；还没有就按最老支持的
 * 固件算（fwGiveUp），不再等。 */
const FW_ASK_TRIES = 3;
async function identifyFirmware() {
  for (let attempt = 0; attempt < FW_ASK_TRIES && !fwInfo.value.known; attempt++) {
    if (!linkReady.value) return;
    await ask("STATUS", (line) => parseSys(line) !== null, 1500);
  }
  if (!fwInfo.value.known && linkReady.value) fwInfo.value = fwGiveUp(fwInfo.value);
}

/* 手机自动授时（规则和命令见 time-sync.js）。连上并通过密码后跑一次：先读 WiFi、OCPP 两个
 * 开关，有一个开着就不发；都关着才把手机当前时间和时区发给桩。桩回 NET（有联网开关开着）
 * 或者不回，界面上都不提示。 */
let timeSyncRun = 0;
function stopTimeSync() {
  timeSyncRun += 1;
}
async function startTimeSync() {
  const token = ++timeSyncRun;
  const alive = () => token === timeSyncRun && linkReady.value && gateState.value === "ok";
  if (!alive()) return;
  const result = await runTimeSync({
    ask,
    now: () => Date.now(),
    tz: () => phoneTzMinutes(),
    alive,
  });
  /* 桩的时区可能跟着手机变了，首页和充电记录的钟点都按它算，重新读一次。 */
  if (result === "ok" && alive()) {
    refreshZone();
    /* 桩的时间刚被手机改过：停在时区页上的话，那一行跟着重读。 */
    if (page.value === "tz") readClk();
  }
}
function refreshZone() {
  return ask("TZGET", (line) => { const got = parseTzAck(line); return got !== null && got.kind === "get"; }, 2000);
}
let menuPull = 0;
/* 打开菜单时把上面显示的几个开关读一遍，一条一条来；没回的再问一次。 */
async function pullMenu() {
  const token = ++menuPull;
  const alive = () => token === menuPull && page.value === "menu" && linkReady.value;
  const steps = [
    ["TELGET", "TEL "], ["OCFWGET", "OCFW "], ["WIFISWGET", "WIFISW "],
    ["OCPPSWGET", "OCPPSW "], ["NETSTOPGET", "NETSTOP "],
  ];
  for (let i = 0; i < steps.length; i++) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!alive()) return;
      if (await fetchLine(steps[i][0], steps[i][1])) break;
    }
  }
  if (!alive()) return;
  if (!plimKnown.value) await readPlim();
  if (alive() && !payKnown.value && can("payRules")) await readPay();
  if (alive() && !parKnown.value && can("parallel")) await readPar();
  if (alive() && !tzKnown.value) await refreshZone();
  if (!alive()) return;
  await startLte();
  if (alive()) startModver(false);
}
function openMenu() {
  profiles.value = loadProfiles();
  gateRemembered.value = /^\d{6}$/.test(savedGate());
  page.value = "menu";
  pullMenu();
}
/* 蓝牙/WiFi 模组版本（命令和格式见 modver.js）。一次连接读到之后留着，菜单再打开不重读；
 * 没读到时每次打开菜单再试，版本页上可以手动重读。 */
const modverState = ref("idle");      /* idle / asking / ok / empty / silent */
const modverItems = ref([]);
let modverRun = 0;
const modverBrief = computed(() => {
  if (modverState.value === "ok") return modverShort(modverItems.value) || t("未知");
  if (modverState.value === "empty" || modverState.value === "silent") return t("未知");
  return "…";
});
const modverNote = computed(() => {
  if (modverState.value === "ok") return "";
  if (modverState.value === "empty") return "未知。充电桩还没有从模组读到版本，请稍后重新读取。";
  if (modverState.value === "silent") return "充电桩没有应答，请重新读取";
  return "正在读取";
});
function resetModver() {
  modverRun += 1;
  modverState.value = "idle";
  modverItems.value = [];
}
async function startModver(force) {
  if (modverState.value === "asking") return;
  if (modverState.value === "ok" && !force) return;
  const token = ++modverRun;
  const alive = () => token === modverRun && linkReady.value &&
    (page.value === "menu" || page.value === "modver");
  if (modverState.value !== "ok") modverItems.value = [];
  modverState.value = "asking";
  const result = await readModver({ ask, wait: delay, alive });
  if (token !== modverRun) return;
  if (result.state === "ok") {
    modverItems.value = result.items;
    modverState.value = "ok";
  } else if (result.state === "gone") {
    modverState.value = modverItems.value.length ? "ok" : "idle";
  } else {
    modverItems.value = [];
    modverState.value = result.state;
  }
}
/* 蓝牙广播看护的诊断计数（命令和格式见 adv-diag.js）。在模组版本页下面，打开那一页时读一次。
 * 手机有时搜不到充电桩时看这几个数：重开过几次、失败几次、串口丢没丢字节。 */
const advState = ref("idle");         /* idle / asking / ok / silent / lack（固件没有 ADVGET） */
const advDiag = ref(null);
let advRun = 0;
const advList = computed(() => advRows(advDiag.value));
const advNote = computed(() => {
  if (advState.value === "ok") return "这些计数从充电桩上电算起。手机有时搜不到充电桩时，把这一页截图发给售后。";
  if (advState.value === "lack") return lackNote(fwInfo.value, "advDiag");
  if (advState.value === "silent") return "充电桩没有应答，请重新读取";
  return "正在读取";
});
function resetAdv() {
  advRun += 1;
  advState.value = "idle";
  advDiag.value = null;
}
async function startAdv() {
  if (advState.value === "asking") return;
  if (!can("advDiag")) {
    advDiag.value = null;
    advState.value = "lack";
    return;
  }
  const token = ++advRun;
  const alive = () => token === advRun && linkReady.value && page.value === "modver";
  advState.value = "asking";
  const result = await readAdv({ ask, alive });
  if (token !== advRun) return;
  if (result.state === "ok") {
    advDiag.value = result.diag;
    advState.value = "ok";
  } else if (result.state === "gone") {
    advState.value = advDiag.value ? "ok" : "idle";
  } else {
    advDiag.value = null;
    advState.value = "silent";
  }
}
/* 4G（命令和互斥规则见 lte.js）。开关、APN、状态都是问一条等一条；开关改完后把 WiFi、遥测、
 * OCPP、4G 四个开关重读一遍，各页显示的以读回来的为准。 */
const lteState = ref("idle");         /* idle / asking / ok / silent */
const lteOn = ref(false);
const lteHold = ref(0);
const lteBusy = ref(false);           /* 开关或 APN 正在保存 */
const lteNote = ref("");
const lteApn = reactive({ proto: "0", apn: "", user: "", pass: "" });
const lteApnDirty = ref(false);
const lteStat = ref(null);            /* 最近一次 LTESTAT */
const lteCell = ref(null);            /* 最近一次 LTECELL（频段、RSRQ、SINR、小区、IMSI） */
const ltePassShow = ref(false);
const lteHome = ref(null);            /* 最近一行是 LTEB 时的 { state, dbm, oper }；又来 WCFG 就清掉 */
let lteRun = 0;
const lteReady = computed(() => lteState.value === "ok");
const lteBrief = computed(() => {
  if (lteState.value === "ok") return lteOn.value ? t("开") : t("关");
  if (lteState.value === "silent") return t("未知");
  return "…";
});
const lteHomeLine = computed(() => (lteHome.value
  ? lteHomeText(t(lteStateLabel(lteHome.value.state)), lteHome.value.state, lteHome.value.dbm)
  : ""));
const lteRows = computed(() => {
  const s = lteStat.value;
  const text = (value) => (value ? value : "--");
  if (!s) {
    return ["联网状态", "信号强度", "运营商", "网络制式", "频段", "注册状态", "小区信息", "SIM 卡状态", "IP 地址",
      "ICCID", "IMSI", "IMEI", "模块型号", "模块固件版本"].map((key) => ({ key, value: "…" }));
  }
  /* 4G 关着、或者不在 LTE 下时没有小区这几项。 */
  const c = s.on ? lteCell.value : null;
  const regName = lteRegLabel(s.reg);
  const simName = lteSimLabel(s.sim);
  return [
    { key: "联网状态", value: t(lteStateLabel(s.state)) },
    { key: "信号强度", value: lteSignalText(s.dbm, s.rsrp, c ? c.rsrq : null, c ? c.sinr : null) },
    { key: "运营商", value: text(s.oper) },
    { key: "网络制式", value: text(s.rat) },
    { key: "频段", value: text(c ? c.band : "") },
    { key: "注册状态", value: s.reg === null ? "--" : (regName ? s.reg + " · " + t(regName) : String(s.reg)) },
    { key: "小区信息", value: lteCellText(c) },
    { key: "SIM 卡状态", value: simName ? t(simName) : text(s.sim) },
    { key: "IP 地址", value: text(s.ip) },
    { key: "ICCID", value: text(s.iccid) },
    { key: "IMSI", value: text(c ? c.imsi : "") },
    { key: "IMEI", value: text(s.imei) },
    { key: "模块型号", value: text(s.model) },
    { key: "模块固件版本", value: text(s.fw) },
  ];
});
function lteIo(token, pages) {
  return {
    ask,
    wait: delay,
    alive: () => token === lteRun && linkReady.value && (!pages || pages.indexOf(page.value) >= 0),
  };
}
function resetLte() {
  lteRun += 1;
  lteState.value = "idle";
  lteOn.value = false;
  lteHold.value = 0;
  lteBusy.value = false;
  lteNote.value = "";
  lteApn.proto = "0";
  lteApn.apn = "";
  lteApn.user = "";
  lteApn.pass = "";
  lteApnDirty.value = false;
  lteStat.value = null;
  lteCell.value = null;
  ltePassShow.value = false;
  lteHome.value = null;
}
function applyLteRead(result) {
  if (result.state === "gone") {
    if (lteState.value === "asking") lteState.value = "idle";
    return false;
  }
  lteState.value = result.state;
  if (result.state === "ok" && Date.now() >= lteHold.value) lteOn.value = result.on;
  return result.state === "ok";
}
/* 菜单上那一行：每次打开菜单读一次开关。 */
async function startLte() {
  const token = ++lteRun;
  if (lteState.value !== "ok") lteState.value = "asking";
  const result = await readLte(lteIo(token, ["menu"]));
  if (token !== lteRun) return;
  applyLteRead(result);
}
function fillApn(got) {
  lteApn.proto = String(got.proto);
  lteApn.apn = got.apn;
  lteApn.user = got.user;
  lteApn.pass = got.pass;
  lteApnDirty.value = false;
}
/* 4G 页：读开关 → 读 APN → 每 3 秒读一次状态，离开页面为止。skipRead：开关刚读过。 */
async function startLtePage(skipRead) {
  const token = ++lteRun;
  const io = lteIo(token, ["lte"]);
  if (skipRead !== true) {
    if (lteState.value !== "ok") lteState.value = "asking";
    const result = await readLte(io);
    if (token !== lteRun) return;
    if (!applyLteRead(result)) return;
    if (!lteApnDirty.value) {
      const got = await readApn(io);
      if (token !== lteRun) return;
      if (got && !lteApnDirty.value) fillApn(got);
    }
  }
  await pollLteStat(io, (stat) => {
    lteStat.value = stat;
    if (!stat.on) lteCell.value = null;
  }, (cell) => { lteCell.value = cell; });
}
function openLte() {
  menuPull++;
  lteNote.value = "";
  lteApnDirty.value = false;
  lteStat.value = null;
  lteCell.value = null;
  ltePassShow.value = false;
  page.value = "lte";
  startLtePage();
}
/* 四个开关重读一遍。pages：只在这些页面上读（不传就不管在哪一页）。 */
async function lteResync(token, pages) {
  const got = await rereadSwitches(lteIo(token, pages));
  if (token !== lteRun) return;
  if (got.lte !== null) {
    lteState.value = "ok";
    lteOn.value = got.lte;
  }
  if (got.wifi !== null) wifiOn.value = got.wifi;
  if (got.tel !== null) telemetry.value = got.tel;
  if (got.ocpp !== null) ocppOn.value = got.ocpp;
}
/* WiFi 页、遥测页把开关打开之后：桩可能顺带关了 4G，重读一遍。 */
function lteAfterOther() {
  lteResync(++lteRun, null);
}
async function setLteOn(on) {
  if (!lteReady.value || lteBusy.value) return;
  const token = ++lteRun;
  const io = lteIo(token, ["lte"]);
  const next = lteExclusive({ wifi: wifiOn.value, lte: lteOn.value, tel: telemetry.value, ocpp: ocppOn.value }, "lte", on);
  lteOn.value = next.lte;
  wifiOn.value = next.wifi;
  telemetry.value = next.tel;
  ocppOn.value = next.ocpp;
  lteHold.value = Date.now() + 2500;
  lteBusy.value = true;
  lteNote.value = on ? "正在打开 4G" : "正在关闭 4G";
  const result = await sendLteSet(io, lteSetCommand(on));
  if (token !== lteRun) {
    lteBusy.value = false;
    return;
  }
  lteHold.value = 0;
  wifiSwHold.value = 0;
  ocppSwHold.value = 0;
  telemetryHold.value = 0;
  if (result !== "gone") await lteResync(token, ["lte"]);
  lteBusy.value = false;
  if (token !== lteRun || result === "gone") return;
  if (result === "ok") lteNote.value = on ? "4G 已打开，WiFi 和遥测已关闭。断电后仍然有效" : "4G 已关闭";
  else if (result === "fail") lteNote.value = refusedNote(netOff.value && on, "4G 开关没有保存");
  else lteNote.value = "充电桩没有应答，没有保存";
  startLtePage(true);
}
async function saveApn() {
  if (!lteReady.value || lteBusy.value) return;
  const cfg = { proto: lteApn.proto, apn: lteApn.apn, user: lteApn.user, pass: lteApn.pass };
  /* 发命令、读回各有自己的超时（lte.js）；看门狗只是兜底。 */
  if (!saveBtns.begin("apn", 20000)) return;
  if (apnError(cfg)) {
    saveBtns.fail("apn", "APN 设置不对", "没有保存。APN 名称、账号、密码最长 32 个可见英文字符，不能有空格和双引号");
    return;
  }
  const token = ++lteRun;
  const io = lteIo(token, ["lte"]);
  lteBusy.value = true;
  const result = await sendLteSet(io, apnCommand(cfg));
  if (token !== lteRun) {
    lteBusy.value = false;
    saveBtns.reset("apn");
    return;
  }
  if (result === "ok") {
    /* 读回来确认，输入框以桩里存的为准。 */
    const got = await readApn(io);
    if (token !== lteRun) {
      lteBusy.value = false;
      saveBtns.reset("apn");
      return;
    }
    if (got) fillApn(got);
  }
  lteBusy.value = false;
  if (result === "gone") {
    saveBtns.reset("apn");
    return;
  }
  /* 4G 模块自己重新启动，不用重启充电桩：按钮上是「保存成功」，下面一行说明。 */
  if (result === "ok") saveBtns.ok("apn", "已保存。4G 模块会重新启动，用新的设置联网");
  else if (result === "fail") saveBtns.fail("apn", "充电桩不接受", "没有保存。充电桩不接受这组 APN 设置");
  else saveBtns.silent("apn");
  startLtePage(true);
}
/* 时区设置（命令见 tz.js）。点一格就存：TZSET，再 TZGET 读回来确认；桩里的时区、菜单上的字、
 * 高亮都以读回来的为准。 */
const tzSaving = ref(false);
const tzPick = ref(null);
let tzRun = 0;
const tzBrief = computed(() => (tzKnown.value ? tzLabel(tzMin.value) : "…"));
const tzListed = computed(() => tzIndex(tzMin.value) >= 0);
/* 三个联网开关都关着时，手机的心跳带着手机的时区，桩跟着改。 */
const tzFollowsPhone = computed(() => heartbeatTimed.value && !wifiOn.value && !ocppOn.value && !lteOn.value);
function resetTz() {
  tzRun += 1;
  tzSaving.value = false;
  tzPick.value = null;
  saveBtns.reset("tz");
}
/* 时区页顶上的“充电桩当前时间”（命令见 charger-clock.js）。进页面读一次 TIMEGET，之后每秒按
 * 手机走过的时间往前推，字只在跨分时变；隔一阵再读一次校准。时区用 tzMin：点选的时区读回
 * 确认后这一行马上按新时区重算，再读一次 TIMEGET。 */
const clkBase = ref(null);        /* 最近一次读到的 { unix, at } */
const clkNoTime = ref(false);     /* 最近一次读到的是“桩还没有时间” */
const clkNow = ref(Date.now());
let clkRun = 0;
let clkTimer = 0;
let clkReadAt = 0;
let clkReading = false;
const clkShown = computed(() => chargerClock({
  base: clkBase.value,
  noTime: clkNoTime.value,
  tz: tzMin.value,
  tzKnown: tzKnown.value,
  nowMs: clkNow.value,
}));
async function readClk() {
  const token = ++clkRun;
  clkReadAt = Date.now();
  clkReading = true;
  const result = await readChargerTime({
    ask,
    alive: () => token === clkRun && linkReady.value && page.value === "tz",
  });
  if (token === clkRun) clkReading = false;
  if (token !== clkRun || result.state === "gone") return;
  clkNow.value = Date.now();
  clkBase.value = result.state === "ok" ? result.base : null;
  clkNoTime.value = result.state === "notime";
  if (Number.isInteger(result.tz) && !tzSaving.value) {
    tzMin.value = result.tz;
    tzKnown.value = true;
  }
}
function stopClk() {
  clkRun += 1;
  clkReading = false;
  if (clkTimer) clearInterval(clkTimer);
  clkTimer = 0;
}
function resetClk() {
  stopClk();
  clkBase.value = null;
  clkNoTime.value = false;
}
function startClk() {
  stopClk();
  clkNow.value = Date.now();
  readClk();
  clkTimer = setInterval(() => {
    if (page.value !== "tz") {
      stopClk();
      return;
    }
    clkNow.value = Date.now();
    /* 存时区的那几条命令在路上时不插进去。 */
    if (tzSaving.value || !linkReady.value || clkReading) return;
    if (clkNow.value - clkReadAt >= (clkBase.value ? CLOCK_RESYNC_MS : CLOCK_RETRY_MS)) readClk();
  }, 1000);
}
function openTz() {
  menuPull++;
  resetTz();
  page.value = "tz";
  startClk();
}
async function pickZone(zone) {
  if (tzSaving.value || saveOff("tz")) return;
  if (tzKnown.value && zone === tzMin.value) {
    saveBtns.reset("tz");
    return;
  }
  /* 点的那一格就是保存按钮：结果写在那一格上。saveZone 自己有超时，看门狗只是兜底。 */
  if (!saveBtns.begin("tz", 20000)) return;
  const token = ++tzRun;
  const alive = () => token === tzRun && linkReady.value && page.value === "tz";
  tzSaving.value = true;
  tzPick.value = zone;
  const result = await saveZone({ ask, alive, tz: zone });
  if (token !== tzRun) return;
  tzSaving.value = false;
  if (result.state === "gone") {
    saveBtns.reset("tz");
    return;
  }
  if (Number.isInteger(result.tz)) {
    tzMin.value = result.tz;
    tzKnown.value = true;
  }
  if (result.state === "ok") saveBtns.ok("tz");
  else if (result.state === "silent") saveBtns.silent("tz");
  else saveBtns.fail("tz");
  /* 顶上的时间已经按读回来的时区重算了；再从桩读一次。 */
  clkNow.value = Date.now();
  if (linkReady.value && page.value === "tz") readClk();
}
function openModver() {
  menuPull++;
  page.value = "modver";
  if (modverState.value !== "ok") startModver(false);
  startAdv();
}
function loadProfiles() {
  try {
    const raw = JSON.parse(localStorage.getItem(PROFILE_KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    return raw.filter(storedProfileOk);
  } catch (e) {
    return [];
  }
}
function storeProfiles(list) {
  profiles.value = list;
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(list)); } catch (e) {}
}
function profileWhen(ms) {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "";
  const p = (n) => (n < 10 ? "0" : "") + n;
  return date.getFullYear() + "-" + p(date.getMonth() + 1) + "-" + p(date.getDate()) +
    " " + p(date.getHours()) + ":" + p(date.getMinutes());
}
function defaultProfileName() {
  const date = new Date();
  const p = (n) => (n < 10 ? "0" : "") + n;
  return "配置 " + p(date.getMonth() + 1) + "-" + p(date.getDate()) + " " +
    p(date.getHours()) + ":" + p(date.getMinutes());
}
function newProfileId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function openProfiles() {
  profiles.value = loadProfiles();
  profileAskId.value = "";
  profileDeleteId.value = "";
  exportAsk.value = false;
  profileFileNote.value = "";
  profileFileVars.value = null;
  page.value = "profiles";
}
/* 导出 / 导入（合并时新加，做法和 AC06 一样；文件类型 evcity-m01-oneclick，导入只收 M01 的）。 */
const exportAsk = ref(false);
const importInput = ref(null);
const profileFileNote = ref("");
const profileFileVars = ref(null);
const profileFileText = computed(() => t(profileFileNote.value, profileFileVars.value || undefined));
function askExport() {
  profileAskId.value = "";
  profileDeleteId.value = "";
  profileFileNote.value = "";
  profileFileVars.value = null;
  exportAsk.value = profiles.value.length > 0;
}
function confirmExport() {
  exportAsk.value = false;
  profileFileVars.value = null;
  const now = Date.now();
  const text = exportText(loadProfiles(), now);
  const name = exportFileName(now);
  const api = bridge();
  if (api && typeof api.exportFile === "function") {
    profileFileNote.value = "正在打开保存窗口";
    try {
      api.exportFile(name, text);
    } catch (e) {
      profileFileNote.value = "导出失败";
    }
    return;
  }
  profileFileNote.value = "这个版本的手机 App 不能导出文件，请更新 App";
}
function exportDone(msg) {
  profileFileVars.value = null;
  if (msg && msg.ok) profileFileNote.value = "已导出。文件里有明文密码，请妥善保管";
  else if (msg && msg.s === "cancel") profileFileNote.value = "已取消导出";
  else profileFileNote.value = "导出失败";
}
function pickImport() {
  exportAsk.value = false;
  profileAskId.value = "";
  profileDeleteId.value = "";
  profileFileNote.value = "";
  profileFileVars.value = null;
  if (importInput.value) importInput.value.click();
}
function onImportFile(event) {
  const file = event.target.files && event.target.files[0];
  event.target.value = "";
  if (!file) return;
  profileFileVars.value = null;
  if (file.size > IMPORT_MAX_BYTES) {
    profileFileNote.value = "文件太大，不是一键配置文件";
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const got = importText(String(reader.result || ""), loadProfiles(), newProfileId);
    if (got.error) {
      profileFileVars.value = got.vars || null;
      profileFileNote.value = got.error;
      return;
    }
    if (got.list.length) storeProfiles(got.list.concat(loadProfiles()));
    profileFileVars.value = { n: got.list.length, same: got.same };
    if (!got.list.length) profileFileNote.value = "文件里的配置都已经在列表里，没有重复导入";
    else if (got.same) profileFileNote.value = "导入了 {n} 份配置，另有 {same} 份已经在列表里";
    else profileFileNote.value = "导入了 {n} 份配置";
  };
  reader.onerror = () => {
    profileFileNote.value = "读不了这个文件";
  };
  reader.readAsText(file);
}
function beginSaveProfile() {
  profileNaming.value = "save";
  profileEditId.value = "";
  profileNameInput.value = defaultProfileName();
  profileNameNote.value = "这个名称只存在手机上。读完后会出现在一键配置列表里。";
  page.value = "profileName";
}
function beginRename(item) {
  profileNaming.value = "rename";
  profileEditId.value = item.id;
  profileNameInput.value = item.name;
  profileNameNote.value = "改的是手机上的名称，不连充电桩";
  page.value = "profileName";
}
function askApply(item) {
  profileDeleteId.value = "";
  profileAskId.value = item.id;
}
function askDelete(item) {
  profileAskId.value = "";
  profileDeleteId.value = item.id;
}
function removeProfile(item) {
  storeProfiles(loadProfiles().filter((row) => row.id !== item.id));
  profileDeleteId.value = "";
}
function commitProfileName() {
  const name = cleanProfileName(profileNameInput.value);
  if (!name) {
    profileNameNote.value = "请填写名称，最长 32 个字";
    return;
  }
  if (profileNaming.value === "rename") {
    const list = loadProfiles();
    const item = list.find((row) => row.id === profileEditId.value);
    if (item) item.name = name;
    storeProfiles(list);
    page.value = "profiles";
    return;
  }
  runProfileJob("read", blankBody(), name);
}
function startApply(item) {
  if (!storedProfileOk(item)) return;
  profileAskId.value = "";
  runProfileJob("write", JSON.parse(JSON.stringify(item.body)), item.name);
}
function profileLogText(row) {
  const vars = Object.assign({}, row.vars || {});
  if (vars.name) vars.name = t(vars.name);
  if (vars.reason) vars.reason = t(vars.reason, vars.reasonVars);
  return t(row.text, vars);
}
async function pushProfileLog(text, kind, vars) {
  profileLog.value.push({ text, kind, vars: vars || null });
  await nextTick();
  const box = profileLogBox.value;
  if (box) box.scrollTop = box.scrollHeight;
}
/* 桩在 AT 模式下一次只发一行。状态推送会占满 4 格应答队列，挤掉这一拍才到的
 * 应答；每格还要等模组回 OK（最多 0.8 秒）。所以一次等 3.5 秒，没等到再问，一共 4 遍。
 * 下发后的读回可能赶上桩正在连刚保存的热点，那段时间它不发蓝牙，调用处再多等几遍。 */
const PROFILE_ASK_MS = 3500;
async function askLine(run, command, accept, tries) {
  let line = null;
  for (let attempt = 0; attempt < (tries || 4); attempt++) {
    if (run !== profileRunId || page.value !== "profileRun") return null;
    line = await ask(command, accept, PROFILE_ASK_MS, { consume: true });
    if (line || run !== profileRunId || page.value !== "profileRun") return line;
  }
  return line;
}
/* 下发完一项，马上把这一项读回来，和手机上存的那份比。 */
async function verifySection(run, key, body) {
  const plan = readPlan(key);
  const got = blankBody();
  if (!plan.list) return "这份配置里没有这一项";
  for (let i = 0; i < plan.list.length; i++) {
    const step = plan.list[i];
    const line = await askLine(run, step.command, step.accept, 5);
    if (run !== profileRunId || page.value !== "profileRun") return null;
    if (!line) return "写入后读回核对超时";
    if (!step.ok(line, got)) return "回复内容不能用";
  }
  return sameSection(key, body, got, can) ? "" : "读回的值和写入的不一样";
}
async function runProfileJob(mode, body, name) {
  const run = ++profileRunId;
  profileMode.value = mode;
  profileTitle.value = name;
  profileLog.value = [];
  profileDone.value = 0;
  profileTotal.value = SECTIONS.length;
  profilePercent.value = 0;
  profileFinished.value = false;
  profileDoneNote.value = "";
  page.value = "profileRun";
  let failed = 0;
  /* 下发前先问这台桩现在有几路（并充时是 5 / 3 / 2）：功率上限是按端口存的，对不上就不下发。
   * 没有并充的老固件（fw-compat.js 的 parallel）一直是 10 路，不问。 */
  let portsNow = null;
  if (mode === "write") {
    portsNow = can("parallel")
      ? profilePorts(await askLine(run, "PARGET", (line) => /^ACK PAR\t/.test(line)))
      : PORT_COUNT;
    if (run !== profileRunId || page.value !== "profileRun") return;
  }
  for (let i = 0; i < SECTIONS.length; i++) {
    if (run !== profileRunId || page.value !== "profileRun") return;
    const section = SECTIONS[i];
    /* 这台桩的固件没有这一项（fw-compat.js 的 SECTION_NEEDS）、这份备份里没有这一项（旧 App
     * 存的）、或者和这台桩现在的端口数对不上：跳过，不算失败。 */
    const lack = sectionLack(fwInfo.value, section.key);
    const skip = lack ? lack.text : sectionSkip(section, mode, body, portsNow);
    if (skip) {
      await pushProfileLog("{name}已跳过：{reason}", "run", {
        name: section.name, reason: skip, reasonVars: lack ? lack.vars : null,
      });
      if (run !== profileRunId || page.value !== "profileRun") return;
      profileDone.value = i + 1;
      profilePercent.value = Math.round(profileDone.value * 100 / SECTIONS.length);
      continue;
    }
    const plan = mode === "read" ? readPlan(section.key) : writePlan(section.key, body, can);
    await pushProfileLog(mode === "read" ? "正在读取{name}" : "正在设置{name}", "run", { name: section.name });
    if (run !== profileRunId || page.value !== "profileRun") return;
    profilePercent.value = Math.round(i * 100 / SECTIONS.length);
    if (!plan.list) {
      failed += 1;
      /* 固件缺某项能力（老固件不认 wss:// 地址）：说清楚要升级到哪一版。 */
      const why = plan.lack ? lackNote(fwInfo.value, plan.lack, plan.error) : null;
      await pushProfileLog("{name}设置失败：{reason}", "bad", {
        name: section.name,
        reason: why ? why.text : (plan.error || "这份配置里没有这一项"),
        reasonVars: why ? why.vars : null,
      });
      profileDone.value = i + 1;
      profilePercent.value = Math.round(profileDone.value * 100 / SECTIONS.length);
      continue;
    }
    let sectionOk = true;
    let reason = "回复超时";
    for (let stepIndex = 0; stepIndex < plan.list.length; stepIndex++) {
      if (run !== profileRunId || page.value !== "profileRun") return;
      const step = plan.list[stepIndex];
      profilePercent.value = Math.round((i + stepIndex / plan.list.length) * 100 / SECTIONS.length);
      const line = await askLine(run, step.command, step.accept);
      if (run !== profileRunId || page.value !== "profileRun") return;
      if (!line || !step.ok(line, body)) {
        sectionOk = false;
        reason = step.reason(line);
        break;
      }
    }
    if (sectionOk && mode === "write") {
      const bad = await verifySection(run, section.key, body);
      if (run !== profileRunId || page.value !== "profileRun") return;
      if (bad) {
        sectionOk = false;
        reason = bad;
      }
    }
    if (sectionOk) {
      await pushProfileLog(mode === "read" ? "{name}读取成功" : "{name}设置成功", "ok", { name: section.name });
    } else {
      failed += 1;
      await pushProfileLog(mode === "read" ? "{name}读取失败：{reason}" : "{name}设置失败：{reason}", "bad", {
        name: section.name,
        reason,
      });
    }
    profileDone.value = i + 1;
    profilePercent.value = Math.round(profileDone.value * 100 / SECTIONS.length);
  }
  if (run !== profileRunId || page.value !== "profileRun") return;
  if (mode === "write" && can("parallel")) {
    /* 并充模式改了：要重启才生效。全部写完、核对完了，现在让桩重启。 */
    const parLine = await askLine(run, "PARGET", (line) => /^ACK PAR\t/.test(line));
    if (run !== profileRunId || page.value !== "profileRun") return;
    if (profileWantsReboot(parLine)) {
      await pushProfileLog("并充模式已改，充电桩正在重启，请稍后重新连接", "run");
      await askLine(run, "REBOOT", (line) => line.indexOf("ACK REBOOT") === 0, 1);
    }
  }
  profileFinished.value = true;
  if (mode === "read") {
    if (failed) {
      profileDoneNote.value = "有项目没有读到，没有保存";
      return;
    }
    const list = loadProfiles();
    list.unshift(makeProfile(name, body, Date.now(), newProfileId()));
    storeProfiles(list);
    profileDoneNote.value = "已保存到一键配置";
    return;
  }
  profileDoneNote.value = failed ? "有项目没有写上" : "下发完成";
}
/* 发一条设置命令，应答由 applyAck 出字；等不到应答时在这里出字。 */
/* 「保存」按钮的看门狗：sendSet 的命令要在队列里排队（前面可能还有每秒的读取），再等 3 秒
 * 应答；正常都是 onSilent 先报「没有应答」，这个只是兜底（比如等的时候蓝牙断了）。 */
const SET_WATCH_MS = 12000;
async function sendSet(command, ackHead, onSilent) {
  const line = await ask(command, head(ackHead), 3000);
  if (line === null && linkReady.value && onSilent) onSilent();
  return line;
}
function openOcfw() {
  page.value = "ocfw";
  ocfwNote.value = "正在读取充电桩里的设置";
  fetchLine("OCFWGET", "OCFW ");
}
function saveOcfw() {
  const text = String(ocfwText.value || "");
  if (!saveBtns.begin("ocfw", SET_WATCH_MS)) return;
  if (text.length > 20 || (text.length > 0 && /[^\x21-\x7E]/.test(text))) {
    saveBtns.fail("ocfw", "版本号不对", "没有保存。版本号最长 20 位，只能是可见英文字符");
    return;
  }
  sendSet("OCFWSET\t" + (ocfwOn.value ? "1" : "0") + "\t" + text, "ACK OCFWSET", () => {
    saveBtns.silent("ocfw");
  });
}
function openTelemetry() {
  page.value = "telemetry";
  telemetryNote.value = "正在读取充电桩里的开关";
  fetchLine("TELGET", "TEL ");
}
function setTelemetry(on) {
  /* 4G 开着时打开遥测：桩会把 4G 关掉（WiFi 也关着的话 OCPP 一起关）。 */
  if (on && lteOn.value) {
    const next = lteExclusive({ wifi: wifiOn.value, lte: true, tel: telemetry.value, ocpp: ocppOn.value }, "tel", true);
    lteOn.value = next.lte;
    ocppOn.value = next.ocpp;
    lteClosedBy = "tel";
  }
  telemetry.value = on;
  telemetryHold.value = Date.now() + 2500;
  telemetryNote.value = on ? "正在打开遥测" : "正在关闭遥测";
  sendSet("TELSET\t" + (on ? "1" : "0"), "ACK TELSET", () => {
    telemetryHold.value = 0;
    lteClosedBy = "";
    telemetryNote.value = "充电桩没有应答，没有保存";
    lteResync(++lteRun, null);
  });
}

/* ------------------------------------------------------------------ 充电记录 */
/* ORDGET：每条订单一行 ACK ORD，新的在前，一批最多 32 条，然后一行 ACK ORDN（总数），最后一行
 * ORDDONE。桩里的订单历史有一千多条，后面的用 ORDGET\t<起始>\t<条数> 一页一页取（“读取更多”）。
 * 订单不走桩的回复队列，一拍发一行；刚连上的那几秒桩还在透传里，要等退回 AT 模式才开始发，
 * 所以等得久一些。 */
let ordersBox = orderCollector();
let ordersRun = 0;
async function fetchOrders(first) {
  const run = ++ordersRun;
  ordersDone.value = false;
  ordersBusy.value = true;
  ordersNote.value = "正在读取充电记录";
  let line = null;
  for (let attempt = 0; attempt < 2 && line === null; attempt++) {
    line = await ask(ordersCommand(first), (text) => text === "ORDDONE", 12000);
    if (run !== ordersRun) return;
    if (page.value !== "orders" || !linkReady.value) break;
  }
  ordersBusy.value = false;
  /* 老固件只在内存里留最近 32 条：读完了说一句，免得以为记录丢了。 */
  if (line !== null) ordersNote.value = lackNote(fwInfo.value, "orderPaging", "orders32") || "";
  else ordersNote.value = orders.value.length ? "充电记录没有读完，请重新读取" : "充电桩没有应答，请重新读取";
}
function loadOrders() {
  ordersBox = orderCollector();
  orders.value = [];
  ordersTotal.value = null;
  ordersMore.value = false;
  return fetchOrders(0);
}
function loadMoreOrders() {
  return fetchOrders(ordersBox.next());
}
function openOrders() {
  page.value = "orders";
  if (!tzKnown.value) refreshZone();
  loadOrders();
}
function orderWhen(unix) {
  return fmtUnix(unix, tzMin.value) || t("时间未同步");
}
function orderReason(token) {
  const label = orderReasonLabel(token);
  return label ? t(label) : "—";
}
function orderSource(token) {
  const label = startLabel(token);
  return label ? t(label) : "—";
}

/* ------------------------------------------------------------------ 10 路：详情、起停、选枪 */
function setPortNote(out) {
  portNote.value = out.text;
  portNoteVars.value = out.vars;
}
function pollPort() {
  const port = portSel.value;
  if (!port) return null;
  return ask("PORTGET\t" + port, (line) => {
    const got = parsePort(line);
    return got !== null && got.port === port;
  }, 1500);
}
function openPort(port) {
  portSel.value = port;
  if (!portInfo.value || portInfo.value.port !== port) portInfo.value = null;
  portNote.value = "";
  portNoteVars.value = null;
  plimNote.value = "";
  plimOneDirty.value = false;
  plimOne.value = plimLimits.value[port - 1] ? String(plimLimits.value[port - 1]) : "";
  stopAllAsk.value = false;
  page.value = "port";
  pollPort();
  if (!plimKnown.value) readPlim();
}
/* 启动和停止之间至少隔 1 秒（../charge-toggle-guard.js），每一路各算各的：点了某一路的启动，
 * 1 秒内这一路的「停止」置灰、点了不算，反过来一样；别的路不受影响。「全部停止」是端口 0：
 * 算每一路都停了一次，任何一路刚启动不到 1 秒时它也置灰。从点下去的那一刻算；桩没应答或者
 * 没接受（不是 OK）就马上放开。断开、换设备时清掉。 */
const toggleGuard = newToggleGuard();
const toggleVer = ref(0);
let toggleTimer = 0;
function toggleOff(cmd, port) {
  return (toggleVer.value, toggleBlocked(toggleGuard, cmd, Date.now(), port));
}
/* 重新算一次按钮的样子；还有按钮在等，就在它放开的那一刻再来一次。 */
function toggleRefresh() {
  clearTimeout(toggleTimer);
  toggleTimer = 0;
  toggleVer.value += 1;
  const left = toggleNextMs(toggleGuard, Date.now());
  if (left > 0) toggleTimer = setTimeout(toggleRefresh, Math.min(left, TOGGLE_GAP_MS) + 15);
}
function resetToggle() {
  resetToggleGuard(toggleGuard);
  toggleRefresh();
}
/* START / STOP / PORTSEL：发一条，等它的 "ACK <命令>\t<端口>\t<结果>"。没等到返回 null；
 * 没有发（上一条还没回，或者启停间隔不到 1 秒）返回 undefined。 */
async function portCommand(cmd, port) {
  if (portBusyCmd.value) return undefined;
  const toggles = cmd === "START" || cmd === "STOP";
  if (toggles) {
    if (!toggleTap(toggleGuard, cmd, Date.now(), port)) return undefined;
    toggleRefresh();
  }
  portBusyCmd.value = true;
  const line = await ask(cmd + "\t" + port, (text) => {
    const ack = parsePortAck(text);
    return ack !== null && ack.cmd === cmd;
  }, 3000);
  portBusyCmd.value = false;
  const ack = line === null ? null : parsePortAck(line);
  if (toggles && (!ack || ack.result !== "OK")) {
    toggleRelease(toggleGuard, cmd, port);
    toggleRefresh();
  }
  return ack;
}
/* 桩先回 ACK START/STOP，状态行要等下一秒。先把这一格改掉，避免界面停在旧状态。
 * 只改指定的一路。全部停止不能把空闲的格子也画成 F，否则会一直显示「结束中」。 */
function paintPort(port, letter) {
  const touch = (item) => (item.port === port ? { ...item, s: letter } : item);
  ports.value = ports.value.map(touch);
  if (portInfo.value && portInfo.value.port === port) {
    portInfo.value = { ...portInfo.value, s: letter };
  }
}
/* 马上要一次各路状态：首页的格子以它为准，不把乐观绘制留在界面上。
 * 认 SNAPGET 的桩（fw-compat.js 的 snapshot）要快照；老固件要一组 ACK PORTS。 */
function refreshPorts() {
  if (can("snapshot")) {
    pollSnap();
    return;
  }
  ask("STATUS", (line) => parsePorts(line) !== null, 1500);
}
async function pollSnap() {
  const got = await snapPoller.poll();
  applySnap(got.pages);
}
async function startPort() {
  const port = portSel.value;
  const ack = await portCommand("START", port);
  if (ack === undefined) return;
  setPortNote(portAckText("START", ack));
  if (ack && ack.result === "OK") {
    selOwnChange(port);
    paintPort(ack.port || port, "C");
  }
  if (page.value === "port") pollPort();
}
async function stopPort() {
  const port = portSel.value;
  const ack = await portCommand("STOP", port);
  if (ack === undefined) return;
  setPortNote(portAckText("STOP", ack));
  if (ack && ack.result === "OK") {
    selOwnChange(port);
    paintPort(ack.port || port, "F");
  }
  if (page.value === "port") pollPort();
}
/* 首页格子上的启动 / 停止：不用进详情页。结果写在首页的提示行里。 */
async function cardCommand(cmd, port) {
  const ack = await portCommand(cmd, port);
  if (ack === undefined) return;
  const out = portAckText(cmd, ack);
  if (ack && ack.result === "OK") {
    selOwnChange(port);
    paintPort(ack.port || port, cmd === "START" ? "C" : "F");
  }
  note.value = out.text;
  noteVars.value = out.vars;
  refreshPorts();
}
function cardStart(port) {
  return cardCommand("START", port);
}
function cardStop(port) {
  return cardCommand("STOP", port);
}
/* 全部停止：只发一条 STOP⇥0，桩自己逐路停（每路隔 0.3 秒，10 路 3 秒内停完），App 不再
 * 一路一路地发。格子不乐观绘制：哪一路先停由桩决定，各路的状态以快照为准。 */
async function confirmStopAll() {
  stopAllAsk.value = false;
  const ack = await portCommand("STOP", 0);
  if (ack === undefined) return;
  const out = portAckText("STOP", ack);
  if (ack && ack.result === "OK") selOwnChange(0);
  note.value = out.text;
  noteVars.value = out.vars;
  refreshPorts();
}
/* 选这一路给接下来的刷卡用（30 秒内有效，刷一次就用掉）；on 为假是取消。 */
async function selectPort(on) {
  const port = on ? portSel.value : 0;
  const ack = await portCommand("PORTSEL", port);
  if (ack === undefined) return;
  setPortNote(portAckText("PORTSEL", ack));
  if (!ack || ack.result !== "OK") return;
  if (ack.port === 0) {
    selPort.value = 0;
    selUntil.value = 0;
    return;
  }
  const brief = ports.value[ack.port - 1];
  selPort.value = ack.port;
  selUntil.value = Date.now() + PORTSEL_SECONDS * 1000;
  selLetter = portInfo.value && portInfo.value.port === ack.port ? portInfo.value.s : (brief ? brief.s : "");
  nowTick.value = Date.now();
}
/* 选中的那一路状态变了（卡刷过了，起充或停充），倒计时收掉。充电 → 结束中 → 空闲 是同一次
 * 停充，第一次变化就收。 */
function selCheck(port, letter) {
  if (!selPort.value || selPort.value !== port) return;
  if (!selLetter) {
    if (Date.now() >= selArmAt) selLetter = letter;
    return;
  }
  if (letter === selLetter) return;
  selPort.value = 0;
  selUntil.value = 0;
  if (page.value === "port" && portSel.value === port) {
    portNote.value = "这一路的状态变了，选择已结束";
    portNoteVars.value = null;
  }
}
/* 选中的那一路是 App 自己起的、停的：这次状态变化不是刷卡造成的，桩里的选择还在，倒计时照走。
 * 等状态落定（2.5 秒）再重新记下来，之后的变化才算刷卡。 */
function selOwnChange(port) {
  if (port !== 0 && selPort.value !== port) return;
  selLetter = "";
  selArmAt = Date.now() + 2500;
}

/* ------------------------------------------------------------------ 充电规则、并充 */
function applyPay(got) {
  payKnown.value = true;
  Object.assign(pay, got);
  if (!payBusy.value && page.value !== "pay") {
    payModel.value = got.model;
    payFullW.value = String(got.fullW);
    payHoldS.value = String(got.hold);
  }
}
/* 固件没有 PAYGET（fw-compat.js 的 payRules，1.1.0 起）就不发，当没回。 */
function readPay() {
  if (!can("payRules")) return Promise.resolve(null);
  return ask("PAYGET", (line) => parsePay(line) !== null, 2500);
}
async function openPay() {
  menuPull++;
  payNote.value = "";
  page.value = "pay";
  if (!can("payRules")) {
    payNote.value = lackNote(fwInfo.value, "payRules");
    return;
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const line = await readPay();
    if (page.value !== "pay" || !linkReady.value) return;
    if (line !== null) {
      payModel.value = pay.model;
      payFullW.value = String(pay.fullW);
      payHoldS.value = String(pay.hold);
      return;
    }
  }
  payNote.value = "充电桩没有应答";
}
async function savePay() {
  if (!can("payRules")) return;
  const watts = plimValue(payFullW.value, pay.min, pay.max);
  /* 老固件（没有 payHold）PAYSET 带了持续秒数会回 FAIL：只发收费模型和门槛。 */
  const holdOk = can("payHold");
  const hold = holdOk ? plimValue(payHoldS.value, pay.holdMin, pay.holdMax) : undefined;
  if (!saveBtns.begin("pay", SET_WATCH_MS)) return;
  if (watts === null || hold === null) {
    saveBtns.fail("pay", "数值超出范围", "数值不在这台桩允许的范围内");
    return;
  }
  payBusy.value = true;
  payNote.value = "";
  const line = await ask(payCommand(payModel.value, watts, hold), (text) => parsePaySet(text) !== null, 3000);
  payBusy.value = false;
  if (line === null) saveBtns.silent("pay");
  else if (parsePaySet(line)) saveBtns.ok("pay");
  else saveBtns.fail("pay", "充电桩不接受");
  if (line !== null) await readPay();
}
function applyPar(got) {
  parKnown.value = true;
  Object.assign(par, got);
  if (!parBusy.value && page.value !== "par") parPick.value = got.saved;
}
/* 固件没有并充（fw-compat.js 的 parallel，1.2.0 起）就不发，当没回。 */
function readPar() {
  if (!can("parallel")) return Promise.resolve(null);
  return ask("PARGET", (line) => parsePar(line) !== null, 2500);
}
async function openPar() {
  menuPull++;
  page.value = "par";
  if (parBusy.value) return;                  /* 切换还在进行：进度照常显示 */
  parNote.value = "";
  parNoteVars.value = null;
  parWarn.value = false;
  parAsk.value = false;
  if (!can("parallel")) {
    const why = lackNote(fwInfo.value, "parallel");
    setParNote(why.text, why.vars, true);
    return;
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const line = await readPar();
    if (page.value !== "par" || !linkReady.value) return;
    if (line !== null) {
      parPick.value = par.saved;
      return;
    }
  }
  parNote.value = "充电桩没有应答";
}
function setParNote(text, vars, warn) {
  parNote.value = text;
  parNoteVars.value = vars || null;
  parWarn.value = !!warn;
}
/* 保存：先问一次。切换会停掉这台桩上全部的充电（包括别人正在充的）。 */
function savePar() {
  parAsk.value = true;
  setParNote("切换并充会停止这台桩上全部的充电，包括别人正在充的。确定吗？", null, true);
}
function cancelPar() {
  parAsk.value = false;
  setParNote("", null, false);
}
/* 切换没成：按钮上的短原因（整句在按钮下面）。 */
const PAR_FAIL_WHY = { timeout: "还有端口没停", link: "蓝牙断开了", rejected: "充电桩不接受", mismatch: "没有切换成功" };
/* 确认以后：STOP⇥0 → 等各路都停下 → PARSET → 读回核对（par-switch.js），最多 30 秒。 */
async function confirmPar() {
  if (!can("parallel")) return;
  /* 整个切换最多 30 秒（par-switch.js 自己算），看门狗放在它后面兜底。 */
  if (!saveBtns.begin("par", PAR_SWITCH_TIMEOUT_MS + 15000)) return;
  /* 切换的第一步是全部停止（STOP⇥0）：记一下，1 秒内各路的「启动」不能点。 */
  toggleMark(toggleGuard, "STOP", Date.now(), TOGGLE_ALL);
  toggleRefresh();
  const mode = parPick.value;
  const token = ++parRun;
  const addr = linkAddr.value;
  parAsk.value = false;
  parBusy.value = true;
  parLost.value = "";
  const out = await runParSwitch({
    ask,
    readPorts: readParPorts,
    alive: () => token === parRun && linkReady.value,
    progress: (step, vars) => {
      const shown = parSwitchStep(step, vars);
      setParNote(shown.text, shown.vars, false);
    },
  }, mode, { timeoutMs: PAR_SWITCH_TIMEOUT_MS });
  if (token !== parRun) {
    saveBtns.reset("par");
    return;
  }
  parBusy.value = false;
  const shown = parSwitchText(out);
  /* 进度那一行收掉；结果写在按钮上，整句放按钮下面。切换后桩自己重启、重启后才按新模式跑
   * → 「保存成功，重启生效」；模式和这次运行的一样（不用重启）→ 「保存成功」。 */
  setParNote("", null, false);
  const detail = { text: shown.text, vars: shown.vars };
  if (out.code === "done") {
    if (out.restart) saveBtns.restart("par", detail);
    else saveBtns.ok("par", detail);
  } else if (out.code === "noreply") saveBtns.silent("par");
  else saveBtns.fail("par", PAR_FAIL_WHY[out.code] || "", detail);
  if (out.code === "done") par.saved = mode;
  /* 桩要重启，或者蓝牙已经断了：断开以后在选择充电桩页上留一行，重新连上这台桩时再核对。 */
  if ((out.code === "done" && out.restart) || out.code === "link") {
    parLost.value = shown.text;
    parAfter = { addr, mode, sent: out.code === "done" || !!out.sent };
  }
  if (out.code !== "done" && out.code !== "link") refreshPorts();
}
/* 读一次各路状态 → ["P", "C", …]。认 SNAPGET 的桩要快照（两页都到才算读全）；
 * 老固件用 STATUS 里的 ACK PORTS。读到的同时写进首页的格子。 */
async function readParPorts() {
  if (can("snapshot")) {
    const got = await snapPoller.poll();
    applySnap(got.pages);
    const pages = got.pages;
    if (!pages.length) return null;
    const count = pages[0].count;
    const letters = [];
    pages.forEach((one) => one.ports.forEach((item) => { letters[item.port - 1] = item.s; }));
    for (let i = 0; i < count; i++) if (!letters[i]) return null;
    return letters.slice(0, count);
  }
  const line = await ask("STATUS", (text) => parsePorts(text) !== null, 2000);
  const got = line === null ? null : parsePorts(line);
  return got ? got.ports.map((item) => item.s) : null;
}
/* 切换并充时断开的那台桩重新连上：读一次 PARGET，结果写在首页。 */
async function checkParAfter() {
  const want = parAfter;
  if (!want || want.addr !== linkAddr.value || !can("parallel")) return;
  parAfter = null;
  parLost.value = "";
  let got = null;
  for (let attempt = 0; attempt < 2 && got === null; attempt++) {
    const line = await readPar();
    got = line === null ? null : parsePar(line);
    if (!linkReady.value) return;
  }
  if (got === null) return;
  const vars = { mode: t(parallelLabel(got.mode)) };
  if (got.mode === want.mode) note.value = "并充已切换并核对：{mode}";
  else if (want.sent) note.value = "并充没有切换成功，现在是：{mode}";
  else note.value = "上次切换并充没有完成，充电已停，模式没变：{mode}";
  noteVars.value = vars;
}

/* ------------------------------------------------------------------ 功率上限 */
function applyPlim(got) {
  plimKnown.value = true;
  plimMin.value = got.min;
  plimMax.value = got.max;
  plimLimits.value = got.limits.slice();
  if (!plimDirty.value) plimInputs.value = got.limits.map((w) => String(w));
  if (page.value === "port" && !plimOneDirty.value &&
      portSel.value >= 1 && portSel.value <= got.limits.length) {
    plimOne.value = String(got.limits[portSel.value - 1]);
  }
}
/* 这一路已经写进桩里。先把界面改成刚保存的数，不退回打开页面时的旧值。
 * 端口 0 是每一路都设成同一个数。 */
function noteSaved(port, watts) {
  const next = plimLimits.value.slice();
  const inputs = plimInputs.value.slice();
  const put = (index) => {
    next[index] = watts;
    inputs[index] = String(watts);
  };
  if (port === 0) {
    for (let i = 0; i < next.length; i++) put(i);
  } else if (port >= 1 && port <= next.length) {
    put(port - 1);
  }
  plimLimits.value = next;
  plimInputs.value = inputs;
  if (port === 0 || port === portSel.value) {
    plimOne.value = String(watts);
    plimOneDirty.value = false;
    if (portInfo.value && portInfo.value.port === portSel.value) {
      portInfo.value = { ...portInfo.value, limitW: watts };
    }
  }
}
/* 功率上限的看门狗：一路一条 PLIMSET，每条在队列里最多等 3 秒，10 路全改再加读回。 */
const PLIM_WATCH_MS = 60000;
function readPlim() {
  return ask("PLIMGET", (line) => parsePlim(line) !== null, 2500);
}
async function openPlim() {
  menuPull++;
  plimNote.value = "";
  plimDirty.value = false;
  plimAll.value = "";
  plimInputs.value = plimLimits.value.map((w) => String(w));
  page.value = "plim";
  for (let attempt = 0; attempt < 2; attempt++) {
    const line = await readPlim();
    if (line !== null || page.value !== "plim" || !linkReady.value) return;
  }
  if (!plimKnown.value) plimNote.value = "充电桩没有应答，请重新读取";
}
/* 发一条 PLIMSET，返回 portAckText 的结果。成功后桩还会再补一行 ACK PLIM。
 * 那一行占应答队列的一格，满了就被丢掉；丢掉时不能把界面退回保存前的旧值。 */
async function plimSend(port, watts) {
  const line = await ask(plimCommand(port, watts), (text) => {
    const ack = parsePortAck(text);
    return ack !== null && ack.cmd === "PLIMSET";
  }, 3000);
  return portAckText("PLIMSET", line === null ? null : parsePortAck(line), { min: plimMin.value, max: plimMax.value });
}
function plimBad(id, port) {
  saveBtns.fail(id, "功率上限不对", {
    text: port
      ? "没有保存。第 {n} 路的功率上限只能是 {min} 到 {max} W 的整数"
      : "没有保存。功率上限只能是 {min} 到 {max} W",
    vars: { n: port, min: plimMin.value, max: plimMax.value },
  });
}
/* PLIMSET 的结果 → 按钮。量程不对的那一句长，按钮上写「功率上限不对」。 */
function plimShown(id, out) {
  saveFromOut(id, out, out.text.indexOf("没有保存") === 0 || out.text === "数值不在这台桩允许的范围内" ? "功率上限不对" : "");
}
async function plimEnsure() {
  if (plimKnown.value) return true;
  plimNote.value = "正在读取";
  await readPlim();
  if (!plimKnown.value) plimNote.value = "充电桩没有应答，请重新读取";
  return plimKnown.value;
}
async function savePlimOne() {
  if (plimBusy.value || !saveBtns.begin("plimOne", PLIM_WATCH_MS)) return;
  const port = portSel.value;
  plimBusy.value = true;
  if (!(await plimEnsure())) {
    plimBusy.value = false;
    saveBtns.silent("plimOne");
    return;
  }
  const watts = plimValue(plimOne.value, plimMin.value, plimMax.value);
  if (watts === null) {
    plimBusy.value = false;
    plimBad("plimOne", 0);
    return;
  }
  plimNote.value = "";
  const out = await plimSend(port, watts);
  if (out.ok) {
    noteSaved(port, watts);
    plimOneDirty.value = false;
    await readPlim();
  }
  plimBusy.value = false;
  plimShown("plimOne", out);
  if (page.value === "port") pollPort();
}
async function savePlimList() {
  if (plimBusy.value || !plimKnown.value || !saveBtns.begin("plimList", PLIM_WATCH_MS)) return;
  const want = [];
  for (let i = 0; i < plimInputs.value.length; i++) {
    const watts = plimValue(plimInputs.value[i], plimMin.value, plimMax.value);
    if (watts === null) {
      plimBad("plimList", i + 1);
      return;
    }
    want.push(watts);
  }
  const changed = [];
  want.forEach((watts, index) => {
    if (watts !== plimLimits.value[index]) changed.push(index + 1);
  });
  if (!changed.length) {
    /* 填的和桩里的一样，什么都不用发：算保存成功，下面一行写「没有改动」。 */
    saveBtns.ok("plimList", "没有改动");
    return;
  }
  plimBusy.value = true;
  plimNote.value = "";
  let out = null;
  for (let i = 0; i < changed.length; i++) {
    const port = changed[i];
    out = await plimSend(port, want[port - 1]);
    if (out.ok) noteSaved(port, want[port - 1]);
    if (!out.ok || page.value !== "plim" || !linkReady.value) break;
  }
  if (out && out.ok) {
    plimDirty.value = false;
    plimOneDirty.value = false;
    await readPlim();
  }
  plimBusy.value = false;
  plimShown("plimList", out);
}
async function savePlimAll() {
  if (plimBusy.value || !plimKnown.value || !saveBtns.begin("plimAll", PLIM_WATCH_MS)) return;
  const watts = plimValue(plimAll.value, plimMin.value, plimMax.value);
  if (watts === null) {
    plimBad("plimAll", 0);
    return;
  }
  plimBusy.value = true;
  plimNote.value = "";
  const out = await plimSend(0, watts);
  if (out.ok) {
    noteSaved(0, watts);
    plimDirty.value = false;
    plimOneDirty.value = false;
    await readPlim();
  }
  plimBusy.value = false;
  plimShown("plimAll", out);
}

/* 每秒一拍：选枪倒计时；队列空着时，详情页问一次 PORTGET；首页每 1.5 秒以上要一次快照
 * （SNAPGET），上一次没回下一拍照样问。不认 SNAPGET 的老固件（fw-compat.js 的 snapshot）：
 * 首页超过 2.5 秒没收到推送（刚连上的那几秒桩不主动推），或者还有格子停在结束中，就要一次 STATUS。
 * 结束中在桩上只有大约 1 秒，停着不走就是乐观绘制没被后面的状态盖掉。队列里有别的命令时
 * 这一拍不问，不挤它们。 */
const tickTimer = setInterval(() => {
  nowTick.value = Date.now();
  if (selPort.value && nowTick.value >= selUntil.value) {
    selPort.value = 0;
    selUntil.value = 0;
  }
  if (!linkReady.value || gateState.value !== "ok" || otaBusy.value || !queue.idle()) return;
  if (page.value === "port") pollPort();
  else if (page.value === "charge") {
    if (snapPoller.due()) pollSnap();
    else if (snapPoller.mode === "off" &&
             (Date.now() - portsAt > 2500 || ports.value.some((item) => item.s === "F"))) {
      refreshPorts();
    }
  }
}, 1000);

function resetCharge() {
  queue.reset();
  ocppText.value = "OCPP 未连接";
  ocppKind.value = "off";
  fw.value = "—";
  fwInfo.value = FW_UNKNOWN;
  sys.busV = null;
  sys.tempC = null;
  sys.mains = false;
  sysSeen.value = false;
  clockIso.value = "";
  fltNames.value = [];
  snapPoller.reset();
  setBoard(emptyBoard(0));
  portsSeen.value = false;
  portsAt = 0;
  stopAllAsk.value = false;
  portSel.value = 0;
  portInfo.value = null;
  portNote.value = "";
  portBusyCmd.value = false;
  resetToggle();
  selPort.value = 0;
  selUntil.value = 0;
  plimKnown.value = false;
  plimLimits.value = [];
  plimInputs.value = Array(PORT_COUNT).fill("");
  plimDirty.value = false;
  plimNote.value = "";
  plimBusy.value = false;
  ordersRun += 1;
  orders.value = [];
  ordersTotal.value = null;
  ordersMore.value = false;
  ordersBusy.value = false;
  wifi.value = "WiFi —";
  wifiLinkNow = "";
  wifiSsidNow = "";
  wifiRssiNow = null;
  wcfgSsid = "";
  resetModver();
  resetAdv();
  resetLte();
  resetTz();
  resetClk();
  tzKnown.value = false;
  wifiSaved.value = "未配置热点";
  telemetry.value = false;
  telemetryNote.value = "";
  telemetryHold.value = 0;
  wifiOn.value = false;
  ocppOn.value = false;
  /* 换了一台桩：主板联网开关要重读，不然上一台"联网关着"会挡住这一台的 WiFi。 */
  payKnown.value = false;
  wifiScan.reset();
  stopScanTimer();
  wifiSwHold.value = 0;
  ocppSwHold.value = 0;
  wifiClosedOcpp = false;
  lteClosedBy = "";
  netStopOn.value = false;
  netStopSec.value = "60";
  netStopNote.value = "";
  netStopHold.value = 0;
  rebootAsk.value = false;
  rebootNote.value = "";
}

/* 主板上的联网开关（PAYGET 读到的）关着：WiFi、OCPP、4G 都打不开，规则见 wifi-setup.js。 */
const netOff = computed(() => netSwitchOff(payKnown.value, pay));
/* 搜索热点：等 APDONE，等不到时 SCAN_LIMIT_MS 后说没收到结果，不一直写"正在搜索"。 */
const wifiScan = createWifiScan();
let wifiScanTimer = 0;
function stopScanTimer() {
  if (wifiScanTimer) clearTimeout(wifiScanTimer);
  wifiScanTimer = 0;
}
function openWifi() {
  page.value = "wifi";
  aps.value = [];
  wifiScan.reset();
  stopScanTimer();
  wifiNote.value = netOff.value ? NET_OFF_NOTE : "这是充电桩里保存的热点。要换热点再点搜索";
  fetchLine("WIFISWGET", "WIFISW ");
  fetchLine("WCFGGET", "WCFG ");
  if (!payKnown.value) {
    readPay().then(() => {
      if (page.value === "wifi" && netOff.value) wifiNote.value = NET_OFF_NOTE;
    });
  }
}
function scanWifi() {
  aps.value = [];
  if (netOff.value) {
    wifiNote.value = NET_OFF_NOTE;
    return;
  }
  /* 1.3.2 以前的固件 WiFi 开关关着时回 ACK WSCAN OK 却不扫（fw-compat.js 的 wscanAnytime）：
   * 不发，请用户先打开 WiFi 开关。 */
  if (!wifiOn.value && !can("wscanAnytime")) {
    wifiNote.value = lackNote(fwInfo.value, "wscanAnytime", "scanOff");
    return;
  }
  wifiNote.value = wifiScan.start(Date.now());
  stopScanTimer();
  wifiScanTimer = setTimeout(() => {
    wifiScanTimer = 0;
    const note = wifiScan.expired(Date.now());
    if (note) wifiNote.value = note;
  }, SCAN_LIMIT_MS + 100);
  /* 3 秒没等到 ACK 不出字：1.3.2 以前的固件扫完才回 ACK，结果可能还在路上。 */
  sendSet("WSCAN", "ACK WSCAN", null);
}
function setWifiOn(on, box) {
  if (on && netOff.value) {
    if (box) box.checked = false;
    wifiNote.value = NET_OFF_NOTE;
    return;
  }
  wifiClosedOcpp = !on && ocppOn.value;
  /* 4G 开着时打开 WiFi：桩会把 4G 关掉。 */
  if (on && lteOn.value) {
    lteOn.value = false;
    lteClosedBy = "wifi";
  }
  wifiOn.value = on;
  if (wifiClosedOcpp) ocppOn.value = false;
  wifiSwHold.value = Date.now() + 2500;
  wifiNote.value = on ? "正在打开 WiFi" : "正在关闭 WiFi";
  sendSet("WIFISWSET\t" + (on ? "1" : "0"), "ACK WIFISWSET", () => {
    wifiSwHold.value = 0;
    ocppSwHold.value = 0;
    wifiClosedOcpp = false;
    lteClosedBy = "";
    wifiNote.value = "充电桩没有应答，没有保存";
    lteResync(++lteRun, null);
  });
}
function pickAp(ap) {
  picked.value = ap.ssid;
  password.value = "";
  wifiNote.value = "输入密码后连接";
  page.value = "pass";
}
function stopWifiJoin(message) {
  wifiJoining.value = false;
  if (wifiJoinTimer) {
    clearTimeout(wifiJoinTimer);
    wifiJoinTimer = 0;
  }
  if (!message) {
    /* 取消、换页、换桩：还在「保存中…」的按钮回到原样。 */
    if (saveSt("wifi").kind === "busy") saveBtns.reset("wifi");
    return;
  }
  /* 没连上：写在「连接并保存」按钮上，完整的一句在按钮下面；不在这一页时还是写到提示里。 */
  const why = WIFI_JOIN_WHY[message] || "";
  if (!saveBtns.fail("wifi", why, why ? message : null)) wifiNote.value = message;
}
const WIFI_JOIN_WHY = {
  "连接超时，可以再输入密码并连接": "连接超时",
  "没有连上，可以再输入密码并连接": "没有连上",
  [NET_OFF_NOTE]: "联网开关关着",
};
function joinWifi() {
  if (wifiJoining.value) return;
  /* 连热点最长等 25 秒（下面的定时器），看门狗放在它后面兜底。 */
  if (!saveBtns.begin("wifi", 30000)) return;
  if (netOff.value) {
    saveBtns.fail("wifi", "联网开关关着", NET_OFF_NOTE);
    return;
  }
  const ssid = picked.value;
  const pass = password.value;
  const ssidBytes = new TextEncoder().encode(ssid).length;
  const passBytes = new TextEncoder().encode(pass).length;
  if (!ssidBytes || ssidBytes > 32 || passBytes > 32 || /[\t\n]/.test(ssid + pass)) {
    saveBtns.fail("wifi", "名称或密码不对", "名称或密码不能用，最长 32 字节");
    return;
  }
  wifiJoinWanted = ssid;
  wifiJoining.value = true;
  wifiJoinStart = Date.now();
  if (wifiJoinTimer) clearTimeout(wifiJoinTimer);
  wifiJoinTimer = setTimeout(() => {
    wifiJoinTimer = 0;
    if (!wifiJoining.value) return;
    stopWifiJoin("连接超时，可以再输入密码并连接");
  }, 25000);
  ask("WJOIN\t" + ssid + "\t" + pass, head("ACK WJOIN"), 3000);
}
function openOcpp() {
  page.value = "ocpp";
  ocppUrl.value = "";
  ocppNote.value = "正在读取充电桩里的地址";
  fetchLine("OCPPSWGET", "OCPPSW ");
  fetchLine("OCPPGET", "OCPP ");
}
function openNetStop() {
  page.value = "netstop";
  netStopNote.value = "正在读取充电桩里的设置";
  fetchLine("NETSTOPGET", "NETSTOP ");
}
function saveNetStop() {
  const sec = parseInt(String(netStopSec.value).trim(), 10);
  if (!saveBtns.begin("netstop", SET_WATCH_MS)) return;
  if (!Number.isFinite(sec) || sec < 10 || sec > 600) {
    saveBtns.fail("netstop", "时长不对", "没有保存。时长只能是 10 到 600 秒");
    return;
  }
  netStopHold.value = Date.now() + 2500;
  sendSet("NETSTOPSET\t" + (netStopOn.value ? "1" : "0") + "\t" + sec, "ACK NETSTOPSET", () => {
    netStopHold.value = 0;
    saveBtns.silent("netstop");
  });
}
function openReboot() {
  rebootAsk.value = false;
  rebootNote.value = "";
  page.value = "reboot";
}
function confirmReboot() {
  rebootAsk.value = false;
  rebootNote.value = "充电桩正在重启";
  sendSet("REBOOT", "ACK REBOOT", () => { rebootNote.value = "充电桩没有应答，请再试一次"; });
}
function setOcppOn(on, box) {
  if (on && netOff.value) {
    if (box) box.checked = false;
    ocppNote.value = NET_OFF_NOTE;
    return;
  }
  ocppOn.value = on;
  ocppSwHold.value = Date.now() + 2500;
  ocppNote.value = on ? "正在打开 OCPP" : "正在关闭 OCPP";
  sendSet("OCPPSWSET\t" + (on ? "1" : "0"), "ACK OCPPSWSET", () => {
    ocppSwHold.value = 0;
    ocppNote.value = "充电桩没有应答，没有保存";
    fetchLine("OCPPSWGET", "OCPPSW ");
  });
}
function saveOcpp() {
  const url = ocppUrl.value.trim();
  if (!saveBtns.begin("ocpp", SET_WATCH_MS)) return;
  if (!ocppUrlOk(url)) {
    saveBtns.fail("ocpp", "地址不对", "地址需要是 ws(s)://主机/路径，最长 127 字节");
    return;
  }
  /* 1.3.0 以前的固件不认 wss://（fw-compat.js 的 ocppWss），发了也是 FAIL。 */
  if (/^wss:/i.test(url) && !can("ocppWss")) {
    saveBtns.fail("ocpp", "固件太旧", lackNote(fwInfo.value, "ocppWss", "wss"));
    return;
  }
  sendSet("OCPPSET\t" + url, "ACK OCPPSET", () => { saveBtns.silent("ocpp"); });
}
function openCfg() {
  page.value = "cfg";
  cfgNote.value = "正在读取保护设置";
  fetchLine("CFGGET", "CFG ");
}
function saveCfg() {
  if (!saveBtns.begin("cfg", SET_WATCH_MS)) return;
  const limitError = voltageLimitError(cfg.over, cfg.under);
  if (limitError) {
    saveBtns.fail("cfg", "电压范围不对", limitError);
    return;
  }
  const over = Math.round(Number(String(cfg.over).trim()));
  const under = Math.round(Number(String(cfg.under).trim()));
  sendSet("CFGSET\t" + over + "\t" + under, "ACK CFGSET", () => { saveBtns.silent("cfg"); });
}

const wifiLinks = {
  UP: "WiFi 已连接",
  JOINING: "WiFi 连接中",
  FAIL: "WiFi 连接失败",
  DOWN: "WiFi 未连接",
};
function saneSsid(ssid) {
  if (ssid === "-") return "";
  if (!ssid || ssid.length > 32 || /[\u0000-\u001F\u007F�]/.test(ssid)) return null;
  return ssid;
}
function ocppLabel(token) {
  if (token === "ON") return { text: "OCPP 已连接", kind: "on" };
  if (token === "BUSY") return { text: "OCPP 正在连接", kind: "busy" };
  return { text: "OCPP 未连接", kind: "off" };
}
/* 首页「WiFi 已连接」那一行。连接状态、信号强度、保存的热点名都在每秒的 ACK SYS 里；
 * 4G 关着时桩还发一行 WCFG，里面的热点名是原样的（见 ports.js 的 pickSsid）。 */
let wifiLinkNow = "";
let wifiSsidNow = "";
let wifiRssiNow = null;
let wcfgSsid = "";
function showWifiStatus() {
  const label = wifiLinks[wifiLinkNow];
  if (label) wifi.value = wifiStatusText(label, wifiLinkNow, wifiSsidNow, wifiRssiNow);
}
function applyWifiConfig(link, ssid) {
  const saved = saneSsid(ssid);
  if (saved === null) return;
  wifiSaved.value = saved || "未配置热点";
  if (wifiLinks[link]) {
    wifiLinkNow = link;
    wifiSsidNow = saved;
    showWifiStatus();
  }
  if (wifiJoinWanted && sameSsid(saved, wifiJoinWanted) && link === "UP" && Date.now() - wifiJoinStart >= 800) {
    wifiJoinWanted = "";
    /* 「保存成功」先在按钮上显示完，再回首页（saveShown）。不是从这个按钮连的（没在保存中）
     * 就照旧马上回首页。 */
    const shown = saveBtns.ok("wifi");
    stopWifiJoin("");
    if (!shown) {
      page.value = "charge";
      note.value = "已连接热点";
    }
    return;
  }
  if (wifiJoining.value && sameSsid(saved, picked.value) && link === "FAIL") {
    stopWifiJoin("没有连上，可以再输入密码并连接");
  }
}
function applySys(got) {
  sysSeen.value = true;
  fw.value = got.fw;
  /* 固件版本和能力位（fw-compat.js）。每秒都来，变了才换，免得界面跟着重算。 */
  const known = fwInfo.value;
  if (!known.known || known.fw !== got.fw || known.bits !== fwState(got.fw, got.caps).bits) {
    fwInfo.value = fwState(got.fw, got.caps);
  }
  sys.busV = got.busV;
  sys.tempC = got.tempC;
  sys.mains = got.mains;
  clockIso.value = got.clock;
  const link = ocppLabel(got.ocpp);
  ocppText.value = link.text;
  ocppKind.value = link.kind;
  wifiRssiNow = got.rssi;
  applyWifiConfig(got.wifi, pickSsid(got.ssid, wcfgSsid) || "-");
  followZone();
}
function board() {
  return { ports: ports.value, x: portsX.value, v: portsV.value, at: portsTime.value };
}
function setBoard(next) {
  ports.value = next.ports;
  portsX.value = next.x;
  portsV.value = next.v;
  portsTime.value = next.at;
}
/* 每秒推送的 ACK PORTS。认 SNAPGET 的桩（fw-compat.js 的 snapshot）以快照为准，推送不往格子里写（推送和 ACK PORTX
 * 可能不是同一时刻的，半行也可能混进来）；快照连着没回（lagging）时推送照写，格子不停住。 */
function applyPorts(got) {
  if (snapPoller.mode === "on" && !snapPoller.lagging) return;
  setBoard(applyPushPorts(board(), got, Date.now(), sys.busV));
  portsSeen.value = true;
  portsAt = Date.now();
  got.ports.forEach((item) => selCheck(item.port, item.s));
}
/* 一次快照收到的几页（可能只有一页：另一行没等到）。只更新页里的那几路。 */
function applySnap(pages) {
  if (!pages.length) return;
  setBoard(applySnapPages(board(), pages, Date.now()));
  portsSeen.value = true;
  portsAt = Date.now();
  pages.forEach((one) => one.ports.forEach((item) => selCheck(item.port, item.s)));
}
function applyPortInfo(got) {
  if (got.error || got.port !== portSel.value) return;
  portInfo.value = got;
  selCheck(got.port, got.s);
  if (!plimOneDirty.value && !plimBusy.value) plimOne.value = String(got.limitW);
}

/* "ACK <名字> <其余>"（空格分开的老式应答）。带制表符的新应答（START、PORT、PLIM…）不走这里。 */
function applyAck(line) {
  const m = /^ACK ([A-Z]+)(?: (.*))?$/.exec(line);
  if (!m) return;
  const name = m[1];
  const ok = (m[2] || "").trim() === "OK";
  if (name === "WIFISWSET") {
    wifiSwHold.value = 0;
    if (ok) {
      wifiNote.value = wifiOn.value
        ? (lteClosedBy === "wifi" ? "WiFi 已打开，4G 已关闭。断电后仍然有效" : "WiFi 已打开。断电后仍然有效")
        : (wifiClosedOcpp
          ? "已关闭 WiFi 和 OCPP。已保存的热点还在"
          : "WiFi 已关闭。已保存的热点还在");
      wifiClosedOcpp = false;
      if (lteClosedBy === "wifi") lteClosedBy = "";
      if (wifiOn.value) lteAfterOther();
      return;
    }
    wifiOn.value = !wifiOn.value;
    if (wifiClosedOcpp) ocppOn.value = true;
    wifiClosedOcpp = false;
    wifiNote.value = refusedNote(netOff.value, "WiFi 开关没有保存");
    if (lteClosedBy === "wifi") {
      lteClosedBy = "";
      lteAfterOther();
    }
    return;
  }
  if (name === "NETSTOPSET") {
    netStopHold.value = 0;
    if (ok) {
      saveBtns.ok("netstop");
      return;
    }
    saveBtns.fail("netstop", "时长不对", "没有保存。时长只能是 10 到 600 秒");
    fetchLine("NETSTOPGET", "NETSTOP ");
    return;
  }
  if (name === "REBOOT") {
    rebootNote.value = ok ? "充电桩正在重启" : "重启没有发出";
    return;
  }
  if (name === "OCPPSWSET") {
    ocppSwHold.value = 0;
    if (ok) {
      ocppNote.value = ocppOn.value
        ? "OCPP 已打开。断电后仍然有效"
        : "OCPP 已关闭。已保存的地址还在";
      return;
    }
    ocppOn.value = !ocppOn.value;
    ocppNote.value = refusedNote(netOff.value && ocppOn.value === false, "OCPP 开关没有保存");
    return;
  }
  if (name === "TELSET") {
    telemetryHold.value = 0;
    if (ok) {
      telemetryNote.value = telemetry.value
        ? (lteClosedBy === "tel"
          ? "遥测已打开，4G 已关闭。遥测串口每秒发送状态，断电后仍然有效"
          : "遥测已打开。遥测串口每秒发送状态，断电后仍然有效")
        : "遥测已关闭。遥测串口不再发送遥测数据";
      if (lteClosedBy === "tel") lteClosedBy = "";
      if (telemetry.value) lteAfterOther();
      return;
    }
    telemetry.value = !telemetry.value;
    telemetryNote.value = "遥测开关没有保存";
    if (lteClosedBy === "tel") {
      lteClosedBy = "";
      lteAfterOther();
    }
    return;
  }
  if (name === "CFGSET") {
    if (ok) saveBtns.ok("cfg");
    else saveBtns.fail("cfg", "电压范围不对", "没有保存。过压不超过 320 V，欠压不低于 100 V，且比过压至少低 10 V");
    return;
  }
  /* AUTH 的应答和 "ACK <命令名> AUTH" 不在这里：applyLine 一开头就交给 applyAuthLine()
   * 了。按整行的格式认，"已锁定"和"这条连接还没通过鉴权"不会被当成密码不对。 */
  if (name === "OCFWSET") {
    if (ok) saveBtns.ok("ocfw");
    else saveBtns.fail("ocfw", "版本号不对", "没有保存。版本号最长 20 位，只能是可见英文字符");
    return;
  }
  if (name === "OCPPSET") {
    /* 桩自己重新连接平台，不用重启：「保存成功」，下面一行说明。 */
    if (ok) saveBtns.ok("ocpp", "已保存，正在重新连接");
    else saveBtns.fail("ocpp");
    return;
  }
  if (name === "WJOIN") {
    if (!ok) stopWifiJoin(refusedNote(netOff.value, "没有保存成功"));
    return;
  }
  if (name === "WSCAN") {
    const note = wifiScan.ack((m[2] || "").trim(), netOff.value);
    if (note) wifiNote.value = note;
    if (!wifiScan.waiting) stopScanTimer();
  }
}
function applyCfg(line) {
  const part = line.trim().split(/\s+/);
  if (part.length < 3 || !Number.isFinite(Number(part[1])) || !Number.isFinite(Number(part[2]))) {
    cfgNote.value = "保护设置读失败，再打开一次";
    return;
  }
  cfg.over = part[1];
  cfg.under = part[2];
  cfgNote.value = "这是充电桩里的保护设置，改完点保存";
}
const firmwareInput = ref(null);
const otaName = ref("");
const otaSize = ref(0);
const otaCrc = ref("");
const otaFileVer = ref("");
const otaNote = ref("发送过程中充电桩亮白灯快闪");
const otaNoteVars = ref(null);
/* 选的文件不是 M01 的固件（ota-guard.js）：提示标成警告色。 */
const otaTypeBad = ref(false);
const otaPhase = ref("");
const otaDone = ref(0);
const otaTotal = ref(0);
const otaElapsed = ref(0);
/* 心跳校时（说明见 time-sync.js）。连着、密码通过，就让 MainActivity 每秒的心跳带上手机
 * 时间；少一样就是纯 "HB"。固件升级从检查到发完这一段关掉：发送队列里排着固件数据，带的
 * 时间到桩已经旧了。一键配置读写期间也关掉：下发的时区不能被心跳里的手机时区顶回去。 */
const otaBusy = computed(() =>
  otaPhase.value === "preparing" || otaPhase.value === "ready" || otaPhase.value === "sending");
const heartbeatTimed = computed(() =>
  linkReady.value && gateState.value === "ok" && !otaBusy.value && page.value !== "profileRun");
let zoneState = {};
watch(heartbeatTimed, (on) => {
  const evc = bridge();
  if (evc && typeof evc.heartbeatTime === "function") evc.heartbeatTime(!!on);
  zoneState = {};
});
/* 每来一条 ACK SYS 看一次：心跳可能已经把桩的时区改成手机的了，重新读 TZGET 把它拿回来。 */
function followZone() {
  if (zoneRereadDue(zoneState, heartbeatTimed.value, tzMin.value, phoneTzMinutes(), Date.now())) {
    refreshZone();
  }
}
let otaClock = 0;
const otaPercent = computed(() => otaTotal.value ? Math.min(100, Math.round(otaDone.value * 100 / otaTotal.value)) : 0);
const otaMinutes = computed(() => Math.floor(otaElapsed.value / 60));
const otaSeconds = computed(() => String(otaElapsed.value % 60).padStart(2, "0"));
function stopOtaClock() {
  if (!otaClock) return;
  clearInterval(otaClock);
  otaClock = 0;
}
function startOtaClock() {
  stopOtaClock();
  otaElapsed.value = 0;
  otaClock = setInterval(() => { otaElapsed.value += 1; }, 1000);
}
const chargeQuiet = ref(false);
const wifiQuiet = ref(false);
const ocppQuiet = ref(false);
// 桩给蓝牙升级的锁有 60 秒租期：这么久没有任何 OTA 命令就自动解锁并恢复 WiFi。
// 停在“确认后开始发送”这一步时没有命令在发，每 20 秒问一次状态续期。
// 发送中每包都是 OTA 命令，不用另外续。
const otaLeaseTimer = setInterval(() => {
  if (page.value === "ota" && otaPhase.value === "ready" && queue.idle()) {
    roundTrip("OTACHECK", head("ACK OTACHECK "), 1500);
  }
}, 20000);
let otaImage = null;
let otaRun = 0;
let otaWait = null;
let downgradeAccepted = false;

function verLabel(text) {
  const raw = String(text || "").trim();
  if (!raw || raw === "—") return "";
  return raw.charAt(0) === "V" || raw.charAt(0) === "v" ? "V" + raw.slice(1) : "V" + raw;
}
function cStringAt(bytes, start) {
  let text = "";
  for (let i = start; i < bytes.length && text.length < 24; i++) {
    const c = bytes[i];
    if (c === 0) return text;
    if (c < 32 || c > 126) return "";
    text += String.fromCharCode(c);
  }
  return "";
}
function firmwareVersion(bytes) {
  const mark = "M01VER=";
  for (let i = 0; i + mark.length < bytes.length; i++) {
    let found = true;
    for (let j = 0; j < mark.length; j++) {
      if (bytes[i + j] !== mark.charCodeAt(j)) {
        found = false;
        break;
      }
    }
    if (!found) continue;
    const text = cStringAt(bytes, i + mark.length);
    if (/^\d+\.\d+(?:\.\d+)?$/.test(text)) return text;
  }
  const bare = {};
  const withV = {};
  for (let i = 0; i + 5 < bytes.length; i++) {
    if (bytes[i] !== 0) continue;
    const text = cStringAt(bytes, i + 1);
    if (/^\d+\.\d+\.\d+$/.test(text)) bare[text] = true;
    const labeled = text.match(/^V(\d+\.\d+\.\d+)$/);
    if (labeled) withV[labeled[1]] = true;
  }
  const both = Object.keys(bare).filter((key) => withV[key]);
  return both.length === 1 ? both[0] : "";
}

function openOta() {
  page.value = "ota";
  if (!otaName.value) otaPhase.value = "";
}
function pickFirmware() {
  if (firmwareInput.value) firmwareInput.value.click();
}
function readU32(bytes, offset) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}
function firmwareLooksValid(bytes) {
  if (bytes.length < 8) return false;
  const sp = readU32(bytes, 0);
  const reset = readU32(bytes, 4);
  const entry = reset & ~1;
  if (sp < 0x20000000 || sp > 0x20018000) return false;
  if ((reset & 1) === 0) return false;
  if (entry < 0x0800C000 || entry >= 0x0800C000 + 0x32000) return false;
  return true;
}
function crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & 1) ? ((crc >>> 1) ^ 0xEDB88320) : (crc >>> 1);
    }
  }
  return (~crc) >>> 0;
}
function crc16(bytes) {
  let crc = 0xFFFF;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & 1) ? ((crc >>> 1) ^ 0xA001) : (crc >>> 1);
    }
  }
  return crc & 0xFFFF;
}
function toHex(bytes) {
  let text = "";
  for (let i = 0; i < bytes.length; i++) text += bytes[i].toString(16).padStart(2, "0");
  return text;
}
/* 发送固件期间把蓝牙连接间隔调短（HIGH），发完、失败、取消后调回 BALANCED。
 * 手机或模组不接受也没关系，只是不提速。 */
function linkFast(on) {
  const api = bridge();
  try {
    if (api && typeof api.linkFast === "function") api.linkFast(!!on);
  } catch (e) {}
}
/* 协商到的 MTU。取不到按 23 算，也就是发一片等一片。 */
function linkMtu() {
  const api = bridge();
  try {
    if (api && typeof api.mtu === "function") return Number(api.mtu()) || 23;
  } catch (e) {}
  return 23;
}
/* 多片在途时，应答可能连着到。先全部收进队列，发送循环一条一条取，不会漏。 */
function otaAckQueue() {
  const acks = [];
  let wake = null;
  function collect(line) {
    const ack = parseDataAck(line);
    if (!ack) return false;
    acks.push(ack);
    if (wake) wake();
    return true;
  }
  otaWait = collect;
  return {
    wait(ms) {
      if (acks.length) return Promise.resolve(acks.shift());
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          wake = null;
          resolve(null);
        }, ms);
        wake = () => {
          clearTimeout(timer);
          wake = null;
          resolve(acks.shift());
        };
      });
    },
    close() {
      if (otaWait === collect) otaWait = null;
    },
  };
}
/* 升级前后的检查命令：排进队列，应答只给等它的人。 */
function roundTrip(command, pred, ms) {
  return ask(command, pred, ms, { consume: true });
}
function quietFrom(line) {
  const part = line.trim().split(/\s+/);
  const base = part[0] === "ACK" ? 2 : 1;
  chargeQuiet.value = part[base] === "1";
  wifiQuiet.value = part[base + 1] === "1";
  ocppQuiet.value = part[base + 2] === "1";
}
function onFirmwareFile(event) {
  const file = event.target.files && event.target.files[0];
  event.target.value = "";
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => loadFirmwareBytes(file.name, new Uint8Array(reader.result));
  reader.readAsArrayBuffer(file);
}
/* 云端固件（CloudFw.vue）下载、校验好的字节：和本机选的文件走同一条路。升级进行中不换文件。 */
function onCloudFirmware(got) {
  if (otaBusy.value || !got || !got.bytes) return;
  loadFirmwareBytes(got.name, got.bytes);
}
/* 选好的固件（本机文件或云端下载）：大小、类型、分区检查，通过后等「开始升级」。 */
function loadFirmwareBytes(fileName, raw) {
  {
    const file = { name: fileName };
    const size = (raw.length + 3) & ~3;
    if (size < 8 || size > 200 * 1024) {
      otaImage = null;
      otaName.value = "";
      otaPhase.value = "";
      otaNote.value = "文件不能超过 200 KB";
      return;
    }
    const image = new Uint8Array(size);
    image.set(raw);
    for (let i = raw.length; i < size; i++) image[i] = 0xFF;
    const typeError = firmwareTypeError("m01", image);
    otaTypeBad.value = !!typeError;
    if (typeError) {
      otaImage = null;
      otaName.value = file.name;
      otaSize.value = raw.length;
      otaCrc.value = "";
      otaFileVer.value = "";
      otaPhase.value = "";
      otaNoteVars.value = null;
      otaNote.value = typeError;
      return;
    }
    if (!firmwareLooksValid(image)) {
      otaImage = null;
      otaName.value = file.name;
      otaSize.value = raw.length;
      otaCrc.value = "";
      otaPhase.value = "";
      otaNote.value = "这个文件不是本充电桩的应用固件";
      return;
    }
    otaImage = image;
    otaName.value = file.name;
    otaSize.value = image.length;
    otaFileVer.value = firmwareVersion(image);
    otaCrc.value = crc32(image).toString(16).padStart(8, "0");
    otaPhase.value = "file";
    downgradeAccepted = false;
    otaNoteVars.value = null;
    otaDone.value = 0;
    otaTotal.value = 0;
    stopOtaClock();
    otaElapsed.value = 0;
    chargeQuiet.value = false;
    wifiQuiet.value = false;
    ocppQuiet.value = false;
    otaNote.value = "发送过程中充电桩亮白灯快闪";
  }
}
function acceptDowngrade() {
  downgradeAccepted = true;
  beginUpgrade();
}
function cancelDowngrade() {
  downgradeAccepted = false;
  otaNoteVars.value = null;
  otaPhase.value = "file";
  otaNote.value = "发送过程中充电桩亮白灯快闪";
}
async function beginUpgrade() {
  if (!otaImage || firmwareTypeError("m01", otaImage)) return;
  if (!downgradeAccepted && isDowngrade(otaFileVer.value, fw.value)) {
    otaNoteVars.value = { from: verLabel(fw.value), to: verLabel(otaFileVer.value) };
    otaNote.value = "版本从 {from} 降低到 {to}，是否确认降级升级？";
    otaPhase.value = "downgrade";
    return;
  }
  downgradeAccepted = false;
  otaNoteVars.value = null;
  const run = ++otaRun;
  otaPhase.value = "preparing";
  otaNote.value = "正在停掉 10 路充电，并暂停 WiFi 和 OCPP。已保存的开关不会改。";
  chargeQuiet.value = false;
  wifiQuiet.value = false;
  ocppQuiet.value = false;
  const deadline = Date.now() + 20000;
  let primed = false;
  while (Date.now() < deadline) {
    if (run !== otaRun) return;
    const line = await roundTrip(primed ? "OTACHECK" : "OTAPREP", (text) => {
      return text.indexOf("ACK OTAPREP ") === 0 || text.indexOf("ACK OTACHECK ") === 0;
    }, 1500);
    if (run !== otaRun) return;
    if (line) {
      primed = true;
      quietFrom(line);
    }
    if (chargeQuiet.value && wifiQuiet.value && ocppQuiet.value) {
      otaPhase.value = "ready";
      otaNote.value = "10 路都已停止，WiFi 和 OCPP 已暂停。确认后开始发送。重启后按原来的设置恢复，不用重新配置。";
      return;
    }
    await delay(400);
  }
  if (run !== otaRun) return;
  otaPhase.value = "prepfail";
  otaNote.value = "还有项目没有关掉，不能开始发送";
}
async function confirmUpgrade() {
  if (otaPhase.value !== "ready" || !otaImage) return;
  const run = ++otaRun;
  const image = otaImage;
  const chunk = OTA_CHUNK;
  const total = Math.ceil(image.length / chunk);
  otaPhase.value = "sending";
  otaDone.value = 0;
  otaTotal.value = total;
  otaNote.value = "正在发送固件";
  startOtaClock();
  let started = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    if (run !== otaRun) return;
    started = await roundTrip("OTASTART\t" + image.length + "\t" + otaCrc.value, (text) => {
      return text.indexOf("ACK OTASTART ") === 0;
    }, 8000);
    if (started && started.indexOf("OK") >= 0) break;
    if (started && started.indexOf("BUSY") >= 0) {
      await delay(500);
      continue;
    }
    break;
  }
  if (run !== otaRun) return;
  if (!started || started.indexOf("OK") < 0) {
    stopOtaClock();
    otaElapsed.value = 0;
    otaPhase.value = "ready";
    otaNote.value = "充电桩没有进入升级";
    return;
  }
  const ackQueue = otaAckQueue();
  let sent = "fail";
  linkFast(true);
  try {
    sent = await sendOtaChunks({
      total,
      window: otaWindowFor(linkMtu()),
      now: () => Date.now(),
      alive: () => run === otaRun,
      progress: (count) => { otaDone.value = count; },
      waitAck: (ms) => ackQueue.wait(ms),
      send(seq) {
        const offset = seq * chunk;
        const slice = image.subarray(offset, Math.min(offset + chunk, image.length));
        send("OTADATA\t" + seq + "\t" + offset + "\t" +
          crc16(slice).toString(16).padStart(4, "0") + "\t" + toHex(slice));
      },
    });
  } finally {
    ackQueue.close();
    /* 取消、失败、蓝牙断开都从这里走。发完也先调回去：OTAEND 之后桩马上重启。 */
    linkFast(false);
  }
  if (sent === "cancel" || run !== otaRun) return;
  if (sent !== "done") {
    send("OTAABORT");
    stopOtaClock();
    otaPhase.value = "error";
    otaNote.value = "传输文件错误，请靠近充电桩重试";
    return;
  }
  let ended = false;
  for (let attempt = 1; attempt <= 5; attempt++) {
    if (run !== otaRun) return;
    const line = await roundTrip("OTAEND", (text) => text.indexOf("ACK OTAEND ") === 0, 8000);
    if (line && line.indexOf("OK") >= 0) {
      ended = true;
      break;
    }
    if (line && (line.indexOf("CRC") >= 0 || line.indexOf("FAIL") >= 0 || line.indexOf("SHORT") >= 0)) {
      break;
    }
  }
  if (run !== otaRun) return;
  if (!ended) {
    send("OTAABORT");
    stopOtaClock();
    otaPhase.value = "error";
    otaNote.value = "传输文件错误，请靠近充电桩重试";
    return;
  }
  stopOtaClock();
  otaPhase.value = "done";
  otaNote.value = "文件已校验通过，充电桩正在升级并重启";
}
function applyLine(line) {
  if (applyAuthLine(line)) return;
  if (typeof otaWait === "function" && otaWait(line)) return;
  /* 在等这一行的那条命令先收下。consume 的（一键配置、固件升级的检查）到此为止；
   * 其余的照常往下走，界面跟着更新。 */
  if (queue.feed(line)) return;
  if (parseTimeAck(line) !== null) return;
  if (parseLteAck(line) !== null) return;
  if (parseLteSwitch(line) !== null) {
    /* LTEGET 的应答，或者桩因为 WiFi、遥测被打开把 4G 关掉后补的那一行。 */
    if (Date.now() >= lteHold.value) lteOn.value = parseLteSwitch(line);
    if (lteState.value === "idle" || lteState.value === "silent") lteState.value = "ok";
    if (!lteOn.value) lteHome.value = null;
    return;
  }
  if (parseLteBrief(line) !== null) {
    lteHome.value = parseLteBrief(line);
    return;
  }
  if (parseLteStat(line) !== null) {
    if (page.value === "lte") lteStat.value = parseLteStat(line);
    return;
  }
  if (parseLteCell(line) !== null) {
    if (page.value === "lte") lteCell.value = parseLteCell(line);
    return;
  }
  if (parseApn(line) !== null) {
    if (page.value === "lte" && !lteApnDirty.value && !lteBusy.value) fillApn(parseApn(line));
    return;
  }
  if (parseModver(line) !== null) return;
  if (parseAdv(line) !== null) return;
  if (parseTzAck(line) !== null) {
    const got = parseTzAck(line);
    if (got.kind === "get" && got.tz !== null && !tzSaving.value) {
      tzMin.value = got.tz;
      tzKnown.value = true;
    }
    return;
  }
  if (parseTimeGet(line) !== null) return;
  const sysLine = parseSys(line);
  if (sysLine) {
    applySys(sysLine);
    return;
  }
  const portsLine = parsePorts(line);
  if (portsLine) {
    applyPorts(portsLine);
    return;
  }
  const portsXLine = parsePortsX(line);
  if (portsXLine) {
    if (snapPoller.mode !== "on" || snapPoller.lagging) setBoard(applyPushPortsX(board(), portsXLine));
    return;
  }
  /* ACK SNAP 由等它的那一次快照收（port-board.js 按请求号核对）；晚到的、对不上号的扔掉。 */
  if (line.indexOf("ACK SNAP\t") === 0) return;
  const portLine = parsePort(line);
  if (portLine) {
    applyPortInfo(portLine);
    return;
  }
  const payLine = parsePay(line);
  if (payLine) {
    applyPay(payLine);
    return;
  }
  const parLine = parsePar(line);
  if (parLine) {
    applyPar(parLine);
    return;
  }
  if (parsePaySet(line) !== null || parseParSet(line) !== null) return;
  const plimLine = parsePlim(line);
  if (plimLine) {
    applyPlim(plimLine);
    return;
  }
  /* START、STOP、PORTSEL、PLIMSET 的应答由发命令的地方等着收。 */
  if (parsePortAck(line) !== null) return;
  if (line === "ORDDONE" || parseOrder(line) !== null || parseOrderSum(line) !== null) {
    ordersBox.feed(line);
    orders.value = ordersBox.list();
    ordersDone.value = ordersBox.done();
    ordersTotal.value = ordersBox.total();
    /* 翻页要 1.2.0 起的固件（fw-compat.js 的 orderPaging）；老固件没有 ACK ORDN，本来也翻不了。 */
    ordersMore.value = can("orderPaging") && ordersBox.more();
    return;
  }
  if (line === "APDONE") {
    stopScanTimer();
    wifiNote.value = wifiScan.done(aps.value.length);
    return;
  }
  if (line.indexOf("AP ") === 0) {
    /* 原样的名字和十六进制的名字两种写法，见 wifi-setup.js 的 parseApLine。 */
    const ap = parseApLine(line);
    if (ap) aps.value.push(ap);
    wifiNote.value = "已找到 " + aps.value.length + " 个热点";
    return;
  }
  if (line.indexOf("WCFG ") === 0) {
    const body = line.slice(5);
    const space = body.indexOf(" ");
    const link = space < 0 ? body.trim() : body.slice(0, space).trim();
    const ssid = space < 0 ? "" : body.slice(space + 1).trim();
    /* 4G 关着时桩每秒发的是 WCFG：首页那一块换回 WiFi。 */
    lteHome.value = null;
    wcfgSsid = ssid === "-" ? "" : ssid;
    applyWifiConfig(link, ssid);
    return;
  }
  const flt = parseFlt(line);
  if (flt) {
    fltNames.value = flt;
    return;
  }
  if (line.indexOf("OCFW ") === 0) {
    const body = line.slice(5);
    const tab = body.indexOf("\t");
    const flag = (tab < 0 ? body : body.slice(0, tab)).trim();
    ocfwOn.value = flag === "1";
    ocfwText.value = tab < 0 ? "" : body.slice(tab + 1);
    if (page.value === "ocfw") {
      ocfwNote.value = "这是上报给平台的版本号，改完点保存";
    }
    return;
  }
  if (line.indexOf("WIFISW ") === 0) {
    const on = line.slice(7).trim() === "1";
    if (Date.now() >= wifiSwHold.value) {
      wifiOn.value = on;
    }
    return;
  }
  if (line.indexOf("OCPPSW ") === 0) {
    const on = line.slice(7).trim() === "1";
    if (Date.now() >= ocppSwHold.value) {
      ocppOn.value = on;
    }
    return;
  }
  if (line.indexOf("NETSTOP ") === 0) {
    const part = line.split(" ");
    if (Date.now() >= netStopHold.value && part.length >= 3) {
      const sec = parseInt(part[2], 10);
      netStopOn.value = part[1] === "1";
      if (sec >= 10 && sec <= 600) netStopSec.value = String(sec);
    }
    if (page.value === "netstop") {
      netStopNote.value = "这是充电桩里保存的设置，改完点保存";
    }
    return;
  }
  if (line.indexOf("TEL ") === 0) {
    const on = line.slice(4).trim() === "1";
    if (Date.now() >= telemetryHold.value) {
      telemetry.value = on;
      if (page.value === "telemetry") {
        telemetryNote.value = on
          ? "遥测已打开。遥测串口每秒发送状态，断电后仍然有效"
          : "遥测已关闭。遥测串口不再发送遥测数据";
      }
    }
    return;
  }
  if (line.indexOf("OCPP ") === 0) {
    const url = line.slice(5).trim();
    if (url !== "-" && !/^wss?:\/\/\S+$/i.test(url)) return;
    ocppUrl.value = url === "-" ? "" : url;
    ocppNote.value = ocppUrl.value
      ? "这是充电桩里保存的地址，改完点保存"
      : "还没有地址。填好 ws(s):// 地址并保存后才会连接";
    return;
  }
  if (line.indexOf("CFG ") === 0) {
    applyCfg(line);
    return;
  }
  if (line.indexOf("ACK ") === 0) applyAck(line);
}

/* 断开了（手机那一层报 page "scan"）：收拾这一条连接，交回外壳的扫描页。 */
function leaveLink() {
  stopTimeSync();
  queue.reset();
  wifiJoinWanted = "";
  stopWifiJoin("");
  linkReady.value = false;
  fw.value = "—";
  fwInfo.value = FW_UNKNOWN;
  resetGateSession();
  stopGateLock();
  gateState.value = "unknown";
  gateEnter.value = false;
  emit("exit", { note: note.value, noteVars: noteVars.value, warn: parLost.value });
}
function handle(msg) {
  if (!msg || !msg.t) return;
  if (msg.t === "note") {
    note.value = msg.s || "";
    noteVars.value = null;
    return;
  }
  if (msg.t === "page") {
    if ((msg.s || "scan") === "scan") {
      leaveLink();
      return;
    }
    page.value = msg.s;
    /* 新的一次连接：上一台桩的固件版本不能留着。 */
    if (msg.s === "charge" && !linkReady.value) {
      fw.value = "—";
      fwInfo.value = FW_UNKNOWN;
      resetGateSession();
    }
    if (msg.s === "charge") linkReady.value = true;
    if (msg.s === "charge" && gateState.value !== "ok") {
      const pass = /^\d{6}$/.test(gatePass.value) ? gatePass.value : savedGate();
      if (/^\d{6}$/.test(pass)) {
        if (gateAuto.value) {
          page.value = "link";
          note.value = "正在连接并核对已保存的密码";
          noteVars.value = null;
        } else {
          page.value = "gate";
          gateNote.value = "正在核对密码";
        }
        sendAuth(pass, true);
      } else {
        gateAuto.value = false;
        page.value = "gate";
        gateNote.value = "请输入充电桩的 6 位管理员密码";
      }
      return;
    }
    if (page.value === "charge") enterHome();
    return;
  }
  if (msg.t === "export") {
    exportDone(msg);
    return;
  }
  if (msg.t === "line") applyLine(msg.s || "");
}

/* 是不是正在发固件、正在读写一键配置：界面热更新下载完以后，这时候不允许「立即切换」（重新加载
 * 页面会把升级打断）。报给 App.vue 算 linkState（它 provide 的 evcM01Busy；单独挂这个组件时没有，跳过）。 */
const reportBusy = inject("evcM01Busy", null);
watch(() => otaBusy.value || page.value === "profileRun", (on) => {
  if (typeof reportBusy === "function") reportBusy(!!on);
}, { immediate: true });
onBeforeUnmount(() => {
  if (typeof reportBusy === "function") reportBusy(false);
});

defineExpose({ handle, connect, tryBack });
</script>

<style>
/* M01 模块独有的样式（10 路格子、单路详情、功率上限表、订单）。颜色、字号和 AC06 的 App.vue
 * 一样；公共的（卡片、按钮、分组、标签栏）直接用 App.vue 里的全局样式。都挂在 .m01app 下，
 * 不影响 AC06 的页面。 */
.m01app .note.warn { color: #f0a020; opacity: 1; }
.m01app .kind-card small { color: #f5c400; }
.m01app .station { background: #111; border-radius: 16px; padding: 14px 16px; display: flex; flex-direction: column; gap: 8px; }
.m01app .station-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
.m01app .station-head strong { font-size: 18px; overflow-wrap: anywhere; direction: ltr; unicode-bidi: isolate; }
.m01app .station-head .fault { align-self: center; flex: none; max-width: 60%; font-size: 13px; padding: 4px 10px; }
.m01app .station-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
.m01app .station-grid p { margin: 0; min-width: 0; }
.m01app .station small { display: block; color: #f5c400; font-size: 11px; letter-spacing: 0.04em; overflow-wrap: anywhere; }
.m01app .station b { display: block; margin-top: 3px; font-size: 14px; font-weight: 650; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.m01app .station b.warn { color: #ff6b5e; }
.m01app .station-line { margin: 0; display: flex; justify-content: space-between; align-items: baseline; gap: 12px; font-size: 14px; }
.m01app .station-line small { flex: none; }
.m01app .station-line b { margin-top: 0; text-align: end; }
.m01app .ports { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.m01app .port { text-align: start; background: #111; border: 1px solid #2a2a2a; border-inline-start: 4px solid #555; border-radius: 14px; padding: 10px 12px; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.m01app .port-top { display: flex; justify-content: space-between; align-items: baseline; gap: 6px; }
.m01app .port-top b { font-size: 22px; font-weight: 750; font-variant-numeric: tabular-nums; }
.m01app .port-top em { font-style: normal; font-weight: 700; font-size: 14px; text-align: end; overflow-wrap: anywhere; }
.m01app .port-ocpp { opacity: 0.5; font-size: 11px; direction: ltr; unicode-bidi: isolate; }
.m01app .port-nums { display: flex; flex-direction: column; min-height: 50px; font-variant-numeric: tabular-nums; }
.m01app .port-nums strong { font-size: 16px; }
.m01app .port-nums small { opacity: 0.72; font-size: 12px; }
.m01app .port-btn { margin-top: 6px; border-radius: 10px; padding: 8px 4px; border: 1px solid #f5c400; background: #f5c400; color: #000; font-weight: 700; font-size: 14px; }
.m01app .port-btn.stop { background: #000; color: #fff; }
.m01app .port-btn:disabled { opacity: 0.35; }
.m01app .card.picked { border-color: #f5c400; }
.m01app .port.idle { border-inline-start-color: #3ecf6b; }
.m01app .port.idle em { color: #3ecf6b; }
.m01app .port.on { border-inline-start-color: #f5c400; background: #1c1803; }
.m01app .port.on em { color: #f5c400; }
.m01app .port.hold { border-inline-start-color: #4aa3ff; }
.m01app .port.hold em { color: #4aa3ff; }
.m01app .port.busy { border-inline-start-color: #c9a227; }
.m01app .port.busy em { color: #c9a227; }
.m01app .port.off em { color: #9a9a9a; }
.m01app .port.bad { border-inline-start-color: #ff5a4d; background: #200907; }
.m01app .port.bad em { color: #ff6b5e; }
.m01app .port.sel { border-color: #f5c400; }
.m01app .port-age { color: #f0a020; font-size: 11px; }
.m01app .port.aging .port-nums { opacity: 0.65; }
.m01app .port.stale .port-nums, .m01app .port.stale .port-top em { opacity: 0.4; }
.m01app .port-state { background: #111; border-radius: 16px; padding: 14px 16px; border-inline-start: 6px solid #555; }
.m01app .port-state strong { display: block; font-size: 34px; line-height: 1.1; font-weight: 720; }
.m01app .port-state small { display: block; margin-top: 4px; opacity: 0.55; direction: ltr; unicode-bidi: isolate; }
.m01app .port-state.idle { border-inline-start-color: #3ecf6b; }
.m01app .port-state.idle strong { color: #3ecf6b; }
.m01app .port-state.on { border-inline-start-color: #f5c400; }
.m01app .port-state.on strong { color: #f5c400; }
.m01app .port-state.hold { border-inline-start-color: #4aa3ff; }
.m01app .port-state.hold strong { color: #4aa3ff; }
.m01app .port-state.busy { border-inline-start-color: #c9a227; }
.m01app .port-state.bad { border-inline-start-color: #ff5a4d; }
.m01app .port-state.bad strong { color: #ff6b5e; }
.m01app .plims { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.m01app .plim { display: flex; align-items: center; gap: 8px; }
.m01app .plim b { flex: none; width: 22px; text-align: center; color: #f5c400; font-variant-numeric: tabular-nums; }
.m01app .plim .field { min-width: 0; padding: 12px 10px; direction: ltr; }
.m01app .order strong { display: block; margin-bottom: 6px; }
.m01app .order .due { color: #f5c400; opacity: 1; font-weight: 700; }
</style>
