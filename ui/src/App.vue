<template>
  <main class="app" :class="{ 'privacy-page': page === 'privacy', 'scan-page': page === 'scan' }">
    <header class="top">
      <div>
        <svg class="logo" viewBox="0 0 108 28" width="108" height="28" aria-label="EVCITY">
          <text x="0" y="20" fill="#f5c400" font-size="22" font-weight="700" font-family="sans-serif">EVCITY</text>
          <rect x="0" y="25" width="28" height="2" fill="#f5c400"/>
        </svg>
        <p class="sub">{{ t(pageTitle) }}</p>
        <p v-if="page !== 'scan' && faultText" class="fault on">{{ t(faultText) }}</p>
      </div>
      <button v-if="page === 'scan'" class="lang" @click="openLang">{{ currentLangName }}</button>
      <div v-else-if="page === 'charge'" class="top-actions">
        <button class="lang" @click="openLang">{{ currentLangName }}</button>
        <button class="gear" aria-label="充电桩配置" @click="openMenu">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path fill="currentColor" d="M19.4 13.4a7.8 7.8 0 0 0 .1-1.4 7.8 7.8 0 0 0-.1-1.4l2-1.6-2-3.4-2.4 1a7.2 7.2 0 0 0-1.2-.7L15.2 3h-6.4L8.2 6a7.2 7.2 0 0 0-1.2.7l-2.4-1-2 3.4 2 1.6a7.8 7.8 0 0 0 0 2.8l-2 1.6 2 3.4 2.4-1a7.2 7.2 0 0 0 1.2.7L8.8 21h6.4l.6-2.9a7.2 7.2 0 0 0 1.2-.7l2.4 1 2-3.4-2-1.6zM12 15.2A3.2 3.2 0 1 1 12 8.8a3.2 3.2 0 0 1 0 6.4z"/>
          </svg>
        </button>
      </div>
      <button v-else class="text" @click="back">{{ t('返回') }}</button>
    </header>

    <section v-if="page === 'scan'" class="body scan">
      <p class="note">{{ t(note) }}</p>
      <div class="scan-list">
        <button v-for="item in devices" :key="item.addr" class="card device pile" @click="connect(item)">
          <svg class="pile-mark" viewBox="0 0 240 320" aria-hidden="true">
            <g fill="none" stroke="currentColor" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round">
              <rect x="54" y="22" width="132" height="248" rx="32"/>
              <rect x="97" y="48" width="46" height="14" rx="7" fill="#f5c400" stroke="none"/>
              <circle cx="120" cy="148" r="30"/>
              <circle cx="120" cy="148" r="16" stroke-width="4.5"/>
              <circle cx="120" cy="142" r="2.2" fill="currentColor" stroke="none"/>
              <circle cx="112" cy="152" r="2.2" fill="currentColor" stroke="none"/>
              <circle cx="128" cy="152" r="2.2" fill="currentColor" stroke="none"/>
              <path d="M98 174 h44 v42 c0 14 -9 20 -22 20 s-22 -6 -22 -20 z"/>
              <path d="M111 198 h18" stroke-width="4.5"/>
              <path d="M111 236 v34"/>
              <path d="M129 236 v34"/>
            </g>
          </svg>
          <span>
            <strong>{{ item.name }}</strong>
            <small>{{ item.addr }}</small>
          </span>
          <em>{{ item.rssi }}</em>
        </button>
        <p v-if="!devices.length" class="empty">{{ t('附近还没有名为 EVC 的充电桩') }}</p>
      </div>
      <div class="scan-dock">
        <button class="go" @click="scan">{{ scanning ? t('停止扫描') : t('扫描充电桩') }}</button>
        <button class="ghost" @click="restartApp">{{ t('没搜到，关闭重试') }}</button>
        <button class="privacy-link" @click="page = 'privacy'">{{ t('隐私协议') }}</button>
      </div>
    </section>

    <section v-else-if="page === 'charge'" class="body">
      <p class="state">{{ t(stateText) }}</p>
      <p class="fault" :class="{ on: faultText }">{{ faultText ? t(faultText) : t('无故障') }}</p>
      <div class="times three">
        <div>
          <small>{{ t('已充电') }}</small>
          <strong>{{ duration }}</strong>
        </div>
        <div>
          <small>{{ t('充电功率') }}</small>
          <strong>{{ power }}</strong>
        </div>
        <div>
          <small>{{ t('电量') }}</small>
          <strong>{{ energy }}</strong>
        </div>
      </div>
      <div class="grid">
        <div v-for="(name, i) in phases" :key="name" class="cell">
          <b>{{ name }}</b>
          <strong>{{ volts[i] }}</strong>
          <small>V</small>
          <strong>{{ amps[i] }}</strong>
          <small>A</small>
        </div>
      </div>
      <div class="clockbox">
        <small>{{ t('系统时间') }}</small>
        <b>{{ t(clock) }}</b>
      </div>
      <div class="pair">
        <button class="go" @click="send('START')">{{ t('启动') }}</button>
        <button class="ghost" @click="send('STOP')">{{ t('停止') }}</button>
      </div>
      <div class="linkbox">
        <small>{{ lteHome ? t('4G 网络') : t('已配置热点') }}</small>
        <strong>{{ lteHome ? (lteHome.oper || '--') : t(wifiSaved) }}</strong>
        <span>{{ lteHome ? lteHomeLine : t(wifi) }}</span>
        <span class="ocpp" :class="ocppKind">{{ t(ocppText) }}</span>
      </div>
      <p class="note">{{ t(note) }}</p>
      <button class="text alone" @click="disconnect">{{ t('断开蓝牙') }}</button>
    </section>

    <section v-else-if="page === 'gate'" class="body">
      <p class="note">{{ t('连接这台充电桩需要屏幕上的管理员密码。通过一次后，这台手机会记住，下次连接自动核对。') }}</p>
      <input v-model="gateInput" class="field" type="password" inputmode="numeric" maxlength="6" :placeholder="t('6 位数字')">
      <label class="row">
        <span>
          <strong>{{ t('保存密码') }}</strong>
          <small>{{ t('保存在这台手机上，下次自动连接') }}</small>
        </span>
        <input v-model="gateSave" type="checkbox">
      </label>
      <p class="note">{{ t(gateNote) }}</p>
      <button class="go" @click="submitGate">{{ t('连接') }}</button>
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

    <section v-else-if="page === 'menu'" class="body">
      <button class="card device" @click="openImax">
        <span><strong>{{ t('最大电流') }}</strong><small>{{ t('方波按这个电流发，充电中立即生效') }}</small></span>
        <em>{{ imax }} A</em>
      </button>
      <button class="card device" @click="page = 'plug'">
        <span><strong>{{ t('即插即充') }}</strong><small>{{ plugDip ? t('拨码2 强制打开') : t('插枪后自动开始') }}</small></span>
        <em>{{ plugDip ? t('拨码开') : (plug ? t('开') : t('关')) }}</em>
      </button>
      <button class="card device" @click="openCards">
        <span><strong>{{ t('本地IC卡') }}</strong><small>{{ t('白名单里的卡直接刷卡启动和停止') }}</small></span>
        <em>›</em>
      </button>
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
      <button class="card device" @click="openSched">
        <span><strong>{{ t('预约充电') }}</strong><small>{{ t('按充电桩时区的钟点启动') }}</small></span>
        <em>{{ schedLabel }}</em>
      </button>
      <button class="card device" @click="openTz">
        <span><strong>{{ t('时区设置') }}</strong><small>{{ t('屏幕、充电记录和预约的钟点按这个时区') }}</small></span>
        <em class="ver">{{ tzBrief }}</em>
      </button>
      <button class="card device" @click="openQr">
        <span><strong>{{ t('屏幕二维码') }}</strong><small>{{ t('未充电时显示在首页右侧') }}</small></span>
        <em>{{ qrOn ? t('开') : t('关') }}</em>
      </button>
      <button class="card device" @click="openOcfw">
        <span><strong>{{ t('OCPP上报版本号') }}</strong><small>{{ ocfwText || t('跟固件版本相同') }}</small></span>
        <em>{{ ocfwOn ? t('开') : t('关') }}</em>
      </button>
      <button class="card device" @click="openOrders">
        <span><strong>{{ t('充电记录') }}</strong><small>{{ t('最近 10 次，存在充电桩里') }}</small></span>
        <em>›</em>
      </button>
      <button class="card device" @click="openTelemetry">
        <span><strong>{{ t('遥测') }}</strong><small>{{ t('遥测串口每秒发送状态') }}</small></span>
        <em>{{ telemetry ? t('开') : t('关') }}</em>
      </button>
      <button class="card device" @click="openNetStop">
        <span><strong>{{ t('断网停充') }}</strong><small>{{ t('OCPP 掉线超时后停止充电') }}</small></span>
        <em>{{ netStopOn ? (t('开') + ' ' + netStopSec + ' s') : t('关') }}</em>
      </button>
      <button class="card device" @click="openCfg">
        <span><strong>{{ t('保护设置') }}</strong><small>{{ t('过压、欠压、CP、接地、漏电') }}</small></span>
        <em>›</em>
      </button>
      <button class="card device" @click="openReboot">
        <span><strong>{{ t('重启') }}</strong><small>{{ t('正在充电会先停止，然后复位') }}</small></span>
        <em>›</em>
      </button>
      <button class="card device" @click="openProfiles">
        <span><strong>{{ t('一键配置') }}</strong><small>{{ t('保存在手机上，可下发到任意一台同型号充电桩') }}</small></span>
        <em>{{ profiles.length ? profiles.length : '›' }}</em>
      </button>
      <button class="card device" @click="openModver">
        <span><strong>{{ t('蓝牙WiFi版本') }}</strong><small>{{ t('蓝牙/WiFi 模组的版本号和固件版本号') }}</small></span>
        <em class="ver">{{ modverBrief }}</em>
      </button>
      <button class="card device" @click="openOta">
        <span><strong>{{ t('固件升级') }}</strong><small>{{ t('选择本机上的应用固件，校验后发给充电桩') }}</small></span>
        <em>{{ fw }}</em>
      </button>
    </section>

    <section v-else-if="page === 'profiles'" class="body">
      <p class="note">{{ t('这份配置存在这台手机上，不绑定某一台桩。连上同型号的充电桩后，都可以下发。') }}</p>
      <button class="go" @click="beginSaveProfile">{{ t('从当前充电桩保存') }}</button>
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
          <small>{{ t('打开后，OCPP 曾经在线又掉线，持续这么多秒仍未重新在线，并且当时正在充电，就停止。默认关闭。') }}</small>
        </span>
        <input type="checkbox" v-model="netStopOn">
      </label>
      <p class="label">{{ t('断网时长 (秒)') }}</p>
      <input v-model="netStopSec" class="field" inputmode="numeric" maxlength="3">
      <p class="note">{{ t('允许 10 到 600 秒，默认 60') }}</p>
      <p class="note">{{ t(netStopNote) }}</p>
      <button class="go" @click="saveNetStop">{{ t('保存') }}</button>
    </section>

    <section v-else-if="page === 'reboot'" class="body">
      <p class="note">{{ t('正在充电会先停止，然后复位充电桩。') }}</p>
      <p class="note">{{ t(rebootNote) }}</p>
      <div v-if="rebootAsk" class="links">
        <button class="go" @click="confirmReboot">{{ t('确认重启') }}</button>
        <button @click="rebootAsk = false">{{ t('取消') }}</button>
      </div>
      <button v-else class="go" @click="rebootAsk = true">{{ t('重启') }}</button>
    </section>

    <section v-else-if="page === 'orders'" class="body">
      <p v-if="!orders.length" class="empty">{{ t('还没有充电记录') }}</p>
      <article v-for="(item, index) in orders" :key="index" class="card">
        <strong>{{ t('启动渠道') }} {{ t(orderStart(item.via)) }}</strong>
        <p class="note">{{ t('订单号') }} {{ item.id || '—' }}</p>
        <p class="note">User {{ item.user || '—' }}</p>
        <p class="note">{{ t('开始') }} {{ t(fmtUnix(item.start)) }}</p>
        <p class="note">{{ t('结束') }} {{ !item.end && (!item.stop || item.stop === 'NONE') ? t('未结束') : t(fmtUnix(item.end)) }}</p>
        <p class="note">{{ t('时长') }} {{ fmtDur(item.dur) }}</p>
        <p class="note">{{ t('电量') }} {{ (item.wh / 1000).toFixed(3) }} kWh</p>
        <p class="note">{{ t('最大电流记录') }} {{ (item.ca / 100).toFixed(2) }} A</p>
        <p class="note">{{ t('停止原因') }} {{ t(orderStop(item.stop)) }}</p>
      </article>
    </section>

    <section v-else-if="page === 'sched'" class="body">
      <p class="note">{{ t(schedNote) }}</p>
      <div class="card">
        <small class="verkey">{{ t('充电桩时区') }}</small>
        <strong class="verval">{{ tzBrief }}</strong>
        <small class="verkey">{{ t('在配置菜单的“时区设置”里修改') }}</small>
      </div>
      <div class="links">
        <button :class="{ go: schedMode === 0 }" @click="schedMode = 0">{{ t('关闭') }}</button>
        <button :class="{ go: schedMode === 1 }" @click="schedMode = 1">{{ t('一次性') }}</button>
        <button :class="{ go: schedMode === 2 }" @click="schedMode = 2">{{ t('每天') }}</button>
      </div>
      <p class="label">{{ t('开始时间') }}</p>
      <div class="pair">
        <input v-model="schedHour" class="field" inputmode="numeric" maxlength="2" :placeholder="t('时')">
        <input v-model="schedMinute" class="field" inputmode="numeric" maxlength="2" :placeholder="t('分')">
      </div>
      <button class="go" @click="saveSched">{{ t('保存') }}</button>
    </section>

    <section v-else-if="page === 'imax'" class="body">
      <p class="label">{{ t('最大电流 (A)') }}</p>
      <input v-model="imaxInput" class="field" inputmode="numeric" maxlength="2">
      <p class="note">{{ t(imaxNote) }}</p>
      <button class="go" @click="saveImax">{{ t('保存') }}</button>
    </section>

    <section v-else-if="page === 'plug'" class="body">
      <p v-if="plugDip" class="note">{{ t('拨码2 在 ON，即插即充强制打开。下面的开关要等拨码拨到 OFF 才生效。') }}</p>
      <p v-else class="note">{{ t('拨码2 在 OFF，由下面的开关决定。拨码拨到 ON 时会强制打开。') }}</p>
      <label class="row">
        <span>
          <strong>{{ plugDip ? t('App 开关') : t('即插即充') }}</strong>
          <small>{{ plugDip ? t('先记住。拨码2 拨到 OFF 后，按这个开关执行，断电后仍然有效') : t('打开后插枪即充电，断电后仍然有效。拨码2 拨到 ON 时强制打开') }}</small>
        </span>
        <input type="checkbox" :checked="plug" @change="setPlug($event.target.checked)">
      </label>
      <p class="note">{{ t(note) }}</p>
    </section>

    <section v-else-if="page === 'wifi'" class="body">
      <label class="row">
        <span>
          <strong>{{ t('开启 WiFi') }}</strong>
          <small>{{ t('关闭后不再连接热点，已保存的热点还在。OCPP 若开着会一起关掉。重新打开 WiFi 不会自动打开 OCPP') }}</small>
        </span>
        <input type="checkbox" :checked="wifiOn" @change="setWifiOn($event.target.checked)">
      </label>
      <p v-if="lteMaybe" class="note">{{ t('打开 WiFi 会关闭 4G') }}</p>
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
      <button class="go" :disabled="wifiJoining" @click="joinWifi">{{ t('连接并保存') }}</button>
    </section>

    <section v-else-if="page === 'cards'" class="body">
      <p class="note">{{ t(cardNote) }}</p>
      <button v-for="(item, index) in shownCards" :key="index" class="card device" @click="openCard(index)">
        <span><strong>{{ t('第 {n} 张', { n: index + 1 }) }}</strong></span>
        <em>{{ item || t('空') }}</em>
      </button>
    </section>

    <section v-else-if="page === 'cardedit'" class="body">
      <p class="label">{{ t('第 {n} 张', { n: cardIndex + 1 }) }}</p>
      <input v-model="cardInput" class="field" maxlength="10" :placeholder="t('卡号')">
      <p class="note">{{ t('最长 10 位，留空再保存就是删除这张卡') }}</p>
      <p class="note">{{ t(cardNote) }}</p>
      <button class="go" @click="saveCard">{{ t('保存') }}</button>
    </section>

    <section v-else-if="page === 'ocpp'" class="body">
      <label class="row">
        <span>
          <strong>{{ t('开启 OCPP') }}</strong>
          <small>{{ t('关闭后不再连接服务器，已保存的地址还在') }}</small>
        </span>
        <input type="checkbox" :checked="ocppOn" @change="setOcppOn($event.target.checked)">
      </label>
      <p class="label">{{ t('OCPP 地址') }}</p>
      <input v-model="ocppUrl" class="field" :placeholder="t('ws(s)://主机/路径')">
      <p class="note">{{ t(ocppNote) }}</p>
      <button class="go" @click="saveOcpp">{{ t('保存') }}</button>
    </section>

    <section v-else-if="page === 'cfg'" class="body">
      <div class="times">
        <div>
          <small>{{ t('接地电压') }}</small>
          <strong>{{ earthLive }} V</strong>
        </div>
        <div>
          <small>{{ t('CP 电压') }}</small>
          <strong>{{ cpLive }} V</strong>
        </div>
      </div>
      <p class="note">{{ t(cfgNote) }}</p>
      <label class="label">{{ t('过压停止 (V)') }}</label>
      <input v-model="cfg.over" class="field" inputmode="decimal">
      <label class="label">{{ t('欠压停止 (V)') }}</label>
      <input v-model="cfg.under" class="field" inputmode="decimal">
      <p class="note">{{ t('A、B、C 三相分别判断，任一相高于过压值或低于欠压值就暂停充电。默认 253 和 207。欠压不低于 100，过压不超过 320，过压至少比欠压高 10。') }}</p>
      <label class="label">{{ t('接地故障 (V)') }}</label>
      <input v-model="cfg.earthMin" class="field" inputmode="decimal">
      <p class="note">{{ t('低于这个电压才记为接地故障。允许 50 到 250 V，默认 150。屏蔽接地后不判断。') }}</p>
      <label class="label">CP 12V/9V</label>
      <input v-model="cfg.ab" class="field" inputmode="decimal">
      <label class="label">CP 9V/6V</label>
      <input v-model="cfg.bc" class="field" inputmode="decimal">
      <label class="label">CP 6V/3V</label>
      <input v-model="cfg.cd" class="field" inputmode="decimal">
      <label class="label">CP 0V/-12V</label>
      <input v-model="cfg.ef" class="field" inputmode="decimal">
      <p v-if="maskDip" class="note">{{ t('印刷拨码1 上电为 ON，接地和漏电已强制屏蔽。下面的开关先记住，拨到 OFF 并重新上电后才生效。') }}</p>
      <p v-else class="note">{{ t('印刷拨码1 上电为 OFF。接地和漏电由下面的开关决定。拨到 ON 后要重新上电，才会强制屏蔽。') }}</p>
      <label class="row">
        <span>
          <strong>{{ t('屏蔽接地故障') }}</strong>
          <small>{{ t('拨码1 为 OFF 时生效。打开后不再判断接地，断电后仍然有效') }}</small>
        </span>
        <input v-model="cfg.earth" type="checkbox">
      </label>
      <label class="row">
        <span>
          <strong>{{ t('屏蔽漏电保护') }}</strong>
          <small>{{ t('拨码1 为 OFF 时生效。打开后漏电不再停止充电，断电后仍然有效') }}</small>
        </span>
        <input v-model="cfg.leak" type="checkbox">
      </label>
      <button class="go" @click="saveCfg">{{ t('保存') }}</button>
    </section>

    <section v-else-if="page === 'qr'" class="body">
      <p class="note">{{ t('打开后，还没开始充电时，首页右侧显示这个二维码。开始充电后恢复电压、电流、功率、电量和时长。关闭则不显示。断电后仍然有效。') }}</p>
      <label class="row">
        <span>
          <strong>{{ t('开启屏幕二维码') }}</strong>
          <small>{{ t('内容为空时即使打开也不显示') }}</small>
        </span>
        <input v-model="qrOn" type="checkbox">
      </label>
      <p class="label">{{ t('二维码内容') }}</p>
      <input v-model="qrText" class="field" maxlength="47" :placeholder="t('最长 47 个字符')">
      <p class="note">{{ t(qrNote) }}</p>
      <button class="go" @click="saveQr">{{ t('保存') }}</button>
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
      <input v-model="ocfwText" class="field" maxlength="20" :placeholder="t('例如 2.4.1')">
      <p class="note">{{ t(ocfwNote) }}</p>
      <button class="go" @click="saveOcfw">{{ t('保存') }}</button>
    </section>

    <section v-else-if="page === 'tz'" class="body">
      <div class="card clk">
        <small class="verkey">{{ t('充电桩当前时间') }}</small>
        <strong class="verval clkval">{{ clkShown.kind === 'notime' ? t('时间未同步') : clkShown.text }}</strong>
        <small v-if="clkOld && clkShown.kind === 'phone'" class="verkey">{{ t('充电桩固件低于 2.6.15，这里显示的是手机校给充电桩的时间。') }}</small>
        <small v-else-if="clkOld && clkShown.kind === 'none'" class="verkey">{{ t('充电桩固件低于 2.6.15，读不到充电桩的时间。') }}</small>
      </div>
      <p class="note">{{ t('点一个时区，直接保存到充电桩，断电后仍然有效。只改时区，不改充电桩的时间。') }}</p>
      <div class="card">
        <small class="verkey">{{ t('充电桩当前时区') }}</small>
        <strong class="verval">{{ tzBrief }}</strong>
        <small v-if="tzKnown && !tzListed" class="verkey">{{ t('当前时区不在列表里') }}</small>
      </div>
      <p v-if="tzNote" class="note">{{ t(tzNote) }}</p>
      <div class="zones">
        <button v-for="zone in TZ_ZONES" :key="zone" class="zone"
                :class="{ on: tzKnown && zone === tzMin, busy: tzSaving && zone === tzPick }"
                :disabled="tzSaving" @click="pickZone(zone)">{{ tzLabel(zone) }}</button>
      </div>
      <p v-if="tzLegacy" class="note">{{ t('充电桩固件低于 2.6.14，时区和预约一起保存。') }}</p>
      <p v-if="tzFollowsPhone" class="note">{{ t('WiFi 和 OCPP 都关闭时，手机连着期间充电桩的时区会跟随手机的时区，这里选的会被改回去。') }}</p>
    </section>

    <section v-else-if="page === 'lte'" class="body">
      <p v-if="lteState === 'unsupported'" class="note">{{ t('充电桩固件不支持 4G，需要升级到 2.6.16 或更高') }}</p>
      <p v-else-if="lteState === 'silent'" class="note">{{ t('充电桩没有应答，请重新读取') }}</p>
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
      <p v-if="lteApnNote" class="note">{{ t(lteApnNote) }}</p>
      <button class="go" :disabled="!lteReady || lteBusy" @click="saveApn">{{ t('保存') }}</button>
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
    </section>

    <section v-else-if="page === 'ota'" class="body">
      <p class="note">{{ t('选择本机上的应用固件。发送前会先停充电，并在升级过程中暂停 WiFi 和 OCPP。整包 CRC 会先发给充电桩，收完再核对。重启后原来的配置还在。') }}</p>
      <input ref="firmwareInput" class="file" type="file" accept="*/*" @change="onFirmwareFile">
      <button class="ghost" @click="pickFirmware">{{ t('选择固件文件') }}</button>
      <div v-if="otaName" class="card">
        <strong>{{ otaName }}</strong>
        <p class="note">{{ t('大小') }} {{ otaSize }} {{ t('字节') }}</p>
        <p v-if="otaFileVer" class="note">{{ t('文件版本') }} {{ verLabel(otaFileVer) }}</p>
        <p class="note">{{ t('整包 CRC') }} {{ otaCrc }}</p>
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
      <p class="note">{{ t(otaNote, otaNoteVars) }}</p>
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
      <p v-if="lteMaybe" class="note">{{ t('打开遥测会关闭 4G') }}</p>
      <p class="note">{{ t(telemetryNote) }}</p>
    </section>
  </main>
</template>

<script setup>
import { computed, nextTick, onMounted, reactive, ref, watch } from "vue";
import PrivacyPolicy from "./PrivacyPolicy.vue";
import { languageFromTag, languages, translate } from "./i18n.js";
import { OTA_CHUNK, otaWindowFor, parseDataAck, sendOtaChunks } from "./ota-window.js";
import { liveRssi, liveRssiPending, wifiStatusText } from "./wifi-rssi.js";
import { modverLabel, modverShort, parseModver, readModver } from "./modver.js";
import { LTE_PROTOS, apnCommand, apnError, lteCellText, lteExclusive, lteHomeText, lteRegLabel, lteSetCommand, lteSignalText, lteSimLabel, lteStateLabel, lteSupported, parseApn, parseLteAck, parseLteBrief, parseLteCell, parseLteStat, parseLteSwitch, pollLteStat, readApn, readLte, rereadSwitches, sendLteSet } from "./lte.js";
import { TZ_ZONES, parseSchedLine, parseTzAck, saveZone, tzIndex, tzLabel, tzSupported } from "./tz.js";
import { CLOCK_RESYNC_MS, CLOCK_RETRY_MS, chargerClock, parseTimeGet, readChargerTime, timeGetSupported } from "./charger-clock.js";
import { heartbeatCarriesTime, parseTimeAck, phoneTzMinutes, runTimeSync, zoneRereadDue } from "./time-sync.js";
import { CARD_SLOTS, DEFAULT_OVER_V, DEFAULT_UNDER_V, SECTIONS, blankBody, cardSlotsFor, cleanProfileName, ocppUrlOk, readPlan, sameSection, sectionSkip, splitCardLine, voltageLimitError, writePlan } from "./profile.js";

const langIds = languages.map((item) => item.id);
function savedLang() {
  try {
    const saved = localStorage.getItem("ac06-lang");
    return langIds.indexOf(saved) >= 0 ? saved : "";
  } catch (e) {
    return "";
  }
}
function phoneLang() {
  let tag = "";
  try {
    const evc = window.EVC;
    if (evc && typeof evc.locale === "function") tag = evc.locale() || "";
  } catch (e) {}
  if (!tag) {
    try { tag = (navigator.language || ""); } catch (e) {}
  }
  return languageFromTag(tag);
}
const lang = ref(savedLang() || phoneLang());
const rtlIds = { ar: true, ur: true };
function applyDocLang(id) {
  const root = document.documentElement;
  root.lang = id === "zh" ? "zh-CN" : id;
  root.dir = rtlIds[id] ? "rtl" : "ltr";
}
applyDocLang(lang.value);
const currentLangName = computed(() => {
  const found = languages.find((item) => item.id === lang.value);
  return found ? found.name : "English";
});
const langFrom = ref("scan");
function openLang() {
  langFrom.value = page.value === "charge" ? "charge" : "scan";
  page.value = "lang";
}
function setLang(id) {
  if (langIds.indexOf(id) < 0) return;
  lang.value = id;
  applyDocLang(id);
  try { localStorage.setItem("ac06-lang", id); } catch (e) {}
  page.value = langFrom.value === "charge" ? "charge" : "scan";
  if (page.value === "scan") startScan();
}
function t(text, vars) {
  return translate(lang.value, text, vars);
}

const phases = ["L1", "L2", "L3"];
const page = ref("scan");
const note = ref("准备扫描");
const scanning = ref(false);
const devices = ref([]);
const stateText = ref("正在连接");
const faultText = ref("");
const ocppText = ref("OCPP 未连接");
const ocppKind = ref("off");
const duration = ref("--:--:--");
const power = ref("—");
const energy = ref("0.000 kWh");
const fw = ref("—");
const earthLive = ref("—");
const cpLive = ref("—");
const clock = ref("时间未同步");
const volts = ref(["—", "—", "—"]);
const amps = ref(["—", "—", "—"]);
const wifi = ref("WiFi —");
const wifiSaved = ref("未配置热点");
const plug = ref(false);
const plugDip = ref(false);
const plugHold = ref(0);
const aps = ref([]);
const wifiNote = ref("");
const picked = ref("");
const password = ref("");
const ocppUrl = ref("");
const ocppNote = ref("");
const cfgNote = ref("");
const cfg = reactive({ over: String(DEFAULT_OVER_V), under: String(DEFAULT_UNDER_V), ab: "", bc: "", cd: "", ef: "", earthMin: "150", earth: false, leak: false });
const maskDip = ref(false);
const imax = ref("32");
const imaxInput = ref("32");
const imaxNote = ref("6 到 32 安，默认 32。充电中修改后，方波马上按新电流发。断电后仍然有效。");
const tzMin = ref(480);
const tzKnown = ref(false);       /* 这次连接读到过桩的时区（SCHED 行） */
const schedMode = ref(0);
const schedHour = ref("8");
const schedMinute = ref("0");
const schedArmed = ref(0);
const clockReady = ref(false);
const schedNote = ref("先连接 OCPP，等充电桩拿到服务器时间后才能预约。");
const orders = ref([]);
const telemetry = ref(false);
const linkAddr = ref("");
const gateState = ref("unknown");
const gateInput = ref("");
const gateSave = ref(true);
const gateAuto = ref(false);
const gateNote = ref("");
const gatePass = ref("");
const gateEnter = ref(false);
const linkReady = ref(false);
const qrOn = ref(false);
const qrText = ref("");
const qrNote = ref("");
const ocfwOn = ref(false);
const ocfwText = ref("");
const ocfwNote = ref("");
const cards = ref(Array(CARD_SLOTS).fill(""));
/* 这台桩有几格卡：固件 2.6.4 起 10 格，更早 5 格。CARD 行里带了 5 个以上字段也说明是 10 格。 */
const cardWide = ref(false);
const cardSlots = computed(() => (cardWide.value ? CARD_SLOTS : cardSlotsFor(fw.value)));
const shownCards = computed(() => cards.value.slice(0, cardSlots.value));
const cardIndex = ref(0);
const cardInput = ref("");
const cardNote = ref("");
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
const schedLabel = computed(() => {
  const hh = String(schedHour.value).padStart(2, "0");
  const mm = String(schedMinute.value).padStart(2, "0");
  if (schedMode.value === 2) return t("每天") + " " + hh + ":" + mm;
  if (schedMode.value === 1 && schedArmed.value) return t("一次性") + " " + hh + ":" + mm;
  if (schedMode.value === 1) return t("一次已执行");
  return t("未预约");
});

const pageTitle = computed(() => {
  if (page.value === "scan") return "选择充电桩";
  if (page.value === "menu") return "充电桩配置";
  if (page.value === "imax") return "最大电流";
  if (page.value === "plug") return "即插即充";
  if (page.value === "wifi") return "WiFi 配网";
  if (page.value === "lte") return "4G 设置";
  if (page.value === "pass") return "填写密码";
  if (page.value === "ocpp") return "OCPP 服务器";
  if (page.value === "cards" || page.value === "cardedit") return "本地IC卡";
  if (page.value === "cfg") return "保护设置";
  if (page.value === "telemetry") return "遥测";
  if (page.value === "qr") return "屏幕二维码";
  if (page.value === "ocfw") return "OCPP上报版本号";
  if (page.value === "gate") return "管理员密码";
  if (page.value === "privacy") return "隐私协议";
  if (page.value === "lang") return "语言";
  if (page.value === "sched") return "预约充电";
  if (page.value === "orders") return "充电记录";
  if (page.value === "ota") return "固件升级";
  if (page.value === "modver") return "蓝牙WiFi版本";
  if (page.value === "tz") return "时区设置";
  if (page.value === "netstop") return "断网停充";
  if (page.value === "reboot") return "重启";
  if (page.value === "profiles") return "一键配置";
  if (page.value === "profileName") return profileNaming.value === "rename" ? "重命名" : "保存配置";
  if (page.value === "profileRun") return profileMode.value === "read" ? "读取配置" : "下发配置";
  return "充电";
});

function bridge() {
  return window.EVC || null;
}
function send(text) {
  const api = bridge();
  if (api) api.send(text);
}
function startScan() {
  const api = bridge();
  if (!api || scanning.value) return;
  scanning.value = true;
  api.scan();
}
function scan() {
  const api = bridge();
  if (!api) {
    note.value = "请在手机 App 里打开";
    return;
  }
  scanning.value = !scanning.value;
  if (scanning.value) api.scan();
  else api.stopScan();
}
function restartApp() {
  const api = bridge();
  if (api && api.restart) api.restart();
}
onMounted(() => {
  profiles.value = loadProfiles();
  if (!savedLang()) lang.value = phoneLang();
  applyDocLang(lang.value);
  if (page.value === "scan") startScan();
});
function connect(item) {
  scanning.value = false;
  linkAddr.value = item.addr || "";
  gateState.value = "need";
  gatePass.value = "";
  gateEnter.value = true;
  gateInput.value = "";
  gateSave.value = true;
  resetCharge();
  const saved = savedGate();
  if (/^\d{6}$/.test(saved)) {
    gateAuto.value = true;
    gatePass.value = saved;
    note.value = "正在连接并核对已保存的密码";
    page.value = "scan";
    bridge().connect(item.addr);
    return;
  }
  gateAuto.value = false;
  page.value = "gate";
  gateNote.value = "请输入充电桩屏幕上的 6 位管理员密码";
}
function gateKey() {
  return "ac06-gate:" + linkAddr.value;
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
function sendAuth(pass, enterAfter) {
  gatePass.value = pass;
  gateEnter.value = !!enterAfter;
  gateState.value = "checking";
  send("AUTH\t" + pass);
}
function trySavedGate() {
  const saved = savedGate();
  if (!/^\d{6}$/.test(saved)) {
    gateState.value = "need";
    return;
  }
  sendAuth(saved, false);
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
  if (page.value === "privacy") {
    page.value = "scan";
    startScan();
  }
  else if (page.value === "lang") {
    page.value = langFrom.value === "charge" ? "charge" : "scan";
    if (page.value === "scan") startScan();
  }
  else if (page.value === "gate") {
    gateEnter.value = false;
    bridge().disconnect();
    page.value = "scan";
  }
  else if (page.value === "cardedit") page.value = "cards";
  else if (page.value === "ota") {
    otaRun++;
    stopOtaClock();
    if (otaPhase.value === "preparing" || otaPhase.value === "ready" ||
        otaPhase.value === "prepfail" || otaPhase.value === "sending") {
      send("OTAABORT");
    }
    linkFast(false);
    page.value = "menu";
  }
  else if (page.value === "profileRun") {
    profileRunId++;
    profileFinished.value = false;
    page.value = "profiles";
  }
  else if (page.value === "profileName") {
    page.value = "profiles";
  }
  else if (page.value === "profiles") {
    profileAskId.value = "";
    profileDeleteId.value = "";
    page.value = "menu";
    pullMenu();
  }
  else if (page.value === "menu") {
    menuPull++;
    page.value = "charge";
  }
  else {
    page.value = "menu";
    pullMenu();
  }
}
/* 手机侧滑和返回键。扫描页、充电页交给系统退出到桌面；其余页面与「返回」相同，回到上一级。 */
window.evcTryBack = function () {
  if (page.value === "scan" || page.value === "charge") return false;
  back();
  return true;
};
function submitGate() {
  const pass = String(gateInput.value || "");
  if (!/^\d{6}$/.test(pass)) {
    gateNote.value = "请输入 6 位数字";
    return;
  }
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
/* 手机自动授时（固件 2.6.6 起，规则和命令见 time-sync.js）。连上并通过密码后跑一次：
 * 先读 WiFi、OCPP 两个开关，有一个开着就不发；两个都关着才把手机当前时间和时区发给桩。
 * 旧固件不回 TIMESET，等不到就算了，界面上不提示。 */
let timeWait = null;
let timeSyncRun = 0;
function askTime(command, accept, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (timeWait === finish) timeWait = null;
      resolve(null);
    }, ms);
    function finish(line) {
      if (!accept(line)) return;
      clearTimeout(timer);
      timeWait = null;
      resolve(line);
    }
    timeWait = finish;
    send(command);
  });
}
function stopTimeSync() {
  timeSyncRun += 1;
  timeWait = null;
}
function startTimeSync() {
  const token = ++timeSyncRun;
  const alive = () => token === timeSyncRun && linkReady.value && gateState.value === "ok";
  /* 先让连上后那两条查询（SCHEDGET、TELGET）的应答回来，桩的蓝牙回复队列只有 4 格。 */
  setTimeout(async () => {
    if (!alive()) return;
    const result = await runTimeSync({
      ask: askTime,
      now: () => Date.now(),
      tz: () => phoneTzMinutes(),
      alive,
    });
    /* 桩的时区可能跟着手机变了，预约页和首页的钟点都按它算，重新读一次。 */
    if (result === "ok" && alive()) {
      timeFed.value = true;
      send("SCHEDGET");
      /* 桩的时间刚被手机改过：停在时区页上的话，那一行跟着重读。 */
      if (page.value === "tz") readClk();
    }
  }, 400);
}
let menuPull = 0;
const menuGot = { imax: false, sched: false, tel: false, qr: false, ocfw: false, wifi: false, ocpp: false, netstop: false };
/* 一次发出多条查询时，桩上的蓝牙回复队列只有 4 格，后面的回复会被丢掉，
 * 菜单就停在默认的「关」。这里等上一条回来再问下一条。 */
function pullMenu() {
  const token = ++menuPull;
  const steps = ["IMAXGET", "SCHEDGET", "TELGET", "QRGET", "OCFWGET", "WIFISWGET", "OCPPSWGET", "NETSTOPGET"];
  const keys = ["imax", "sched", "tel", "qr", "ocfw", "wifi", "ocpp", "netstop"];
  keys.forEach((key) => { menuGot[key] = false; });
  let index = 0;
  let wait = 0;
  let retried = false;
  const tick = () => {
    if (token !== menuPull || page.value !== "menu") return;
    if (index >= steps.length) {
      /* 菜单上的开关都读完了，再读 4G 开关和模组版本。排在最后：旧固件不回这两条，不拖住前面的。 */
      startLte().then(() => {
        if (token === menuPull && page.value === "menu") startModver(false);
      });
      return;
    }
    if (wait === 0) {
      send(steps[index]);
      wait = 1;
      setTimeout(tick, 120);
      return;
    }
    if (menuGot[keys[index]] || wait >= 8) {
      if (!menuGot[keys[index]] && !retried) {
        retried = true;
        wait = 0;
        setTimeout(tick, 80);
        return;
      }
      index += 1;
      wait = 0;
      retried = false;
      setTimeout(tick, 60);
      return;
    }
    wait += 1;
    setTimeout(tick, 120);
  };
  tick();
}
function openMenu() {
  profiles.value = loadProfiles();
  page.value = "menu";
  pullMenu();
}
/* 蓝牙/WiFi 模组版本（固件 2.6.12 起，命令和格式见 modver.js）。一次连接读到之后留着，
 * 菜单再打开不重读；没读到（旧固件、模组没回答）时每次打开菜单再试，版本页上可以手动重读。 */
const modverState = ref("idle");      /* idle / asking / ok / unsupported / empty */
const modverItems = ref([]);
let modverRun = 0;
let modverWait = null;
const modverBrief = computed(() => {
  if (modverState.value === "ok") return modverShort(modverItems.value) || t("未知");
  if (modverState.value === "unsupported") return t("固件不支持");
  if (modverState.value === "empty") return t("未知");
  return "…";
});
const modverNote = computed(() => {
  if (modverState.value === "ok") return "";
  if (modverState.value === "unsupported") return "充电桩固件不支持读取模组版本，需要升级到 2.6.12 或更高。";
  if (modverState.value === "empty") return "未知。充电桩还没有从模组读到版本，请稍后重新读取。";
  return "正在读取";
});
function askModver(command, accept, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (modverWait === finish) modverWait = null;
      resolve(null);
    }, ms);
    function finish(line) {
      if (!accept(line)) return;
      clearTimeout(timer);
      modverWait = null;
      resolve(line);
    }
    modverWait = finish;
    send(command);
  });
}
function resetModver() {
  modverRun += 1;
  modverWait = null;
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
  const result = await readModver({
    ask: askModver,
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    alive,
    fw: fw.value === "—" ? "" : fw.value,
  });
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
/* 4G（固件 2.6.16 起，命令、互斥规则和旧固件的退路见 lte.js）。开关、APN、状态都是问一条等
 * 一条；开关改完后把 WiFi、遥测、OCPP、4G 四个开关重读一遍，各页显示的以读回来的为准。 */
const lteState = ref("idle");         /* idle / asking / ok / unsupported / silent */
const lteOn = ref(false);
const lteHold = ref(0);
const lteBusy = ref(false);           /* 开关或 APN 正在保存 */
const lteNote = ref("");
const lteApn = reactive({ proto: "0", apn: "", user: "", pass: "" });
const lteApnDirty = ref(false);
const lteApnNote = ref("");
const lteStat = ref(null);            /* 最近一次 LTESTAT */
const lteCell = ref(null);            /* 最近一次 LTECELL（频段、RSRQ、SINR、小区、IMSI） */
const ltePassShow = ref(false);
const lteHome = ref(null);            /* 最近一行是 LTEB 时的 { state, dbm, oper }；又来 WCFG 就清掉 */
let lteRun = 0;
let lteWait = null;
const lteReady = computed(() => lteState.value === "ok");
/* 这台桩可能有 4G：读到过开关，或者版本够新还没来得及读。旧固件上 WiFi 页、遥测页不多出提示。 */
const lteMaybe = computed(() => lteState.value === "ok" ||
  (lteState.value !== "unsupported" && lteSupported(fw.value === "—" ? "" : fw.value) === true));
const lteBrief = computed(() => {
  if (lteState.value === "ok") return lteOn.value ? t("开") : t("关");
  if (lteState.value === "unsupported") return t("固件不支持");
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
function askLte(command, accept, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (lteWait === finish) lteWait = null;
      resolve(null);
    }, ms);
    function finish(line) {
      if (!accept(line)) return;
      clearTimeout(timer);
      lteWait = null;
      resolve(line);
    }
    lteWait = finish;
    send(command);
  });
}
function lteIo(token, pages) {
  return {
    ask: askLte,
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    alive: () => token === lteRun && linkReady.value && (!pages || pages.indexOf(page.value) >= 0),
    fw: fw.value === "—" ? "" : fw.value,
  };
}
function resetLte() {
  lteRun += 1;
  lteWait = null;
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
  lteApnNote.value = "";
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
/* 菜单上那一行：每次打开菜单读一次开关。旧固件（版本读得出）一条都不发。 */
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
  lteApnNote.value = "";
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
}
/* WiFi 页、遥测页把开关打开之后：桩可能顺带关了 4G，重读一遍。旧固件不做这一步。 */
function lteAfterOther() {
  if (!lteMaybe.value) return;
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
  else if (result === "fail") lteNote.value = "4G 开关没有保存";
  else lteNote.value = "充电桩没有应答，没有保存";
  startLtePage(true);
}
async function saveApn() {
  if (!lteReady.value || lteBusy.value) return;
  const cfg = { proto: lteApn.proto, apn: lteApn.apn, user: lteApn.user, pass: lteApn.pass };
  if (apnError(cfg)) {
    lteApnNote.value = "没有保存。APN 名称、账号、密码最长 32 个可见英文字符，不能有空格和双引号";
    return;
  }
  const token = ++lteRun;
  const io = lteIo(token, ["lte"]);
  lteBusy.value = true;
  lteApnNote.value = "正在保存";
  const result = await sendLteSet(io, apnCommand(cfg));
  if (token !== lteRun) {
    lteBusy.value = false;
    return;
  }
  if (result === "ok") {
    /* 读回来确认，输入框以桩里存的为准。 */
    const got = await readApn(io);
    if (token !== lteRun) {
      lteBusy.value = false;
      return;
    }
    if (got) fillApn(got);
  }
  lteBusy.value = false;
  if (result === "gone") return;
  if (result === "ok") lteApnNote.value = "已保存。4G 模块会重新启动，用新的设置联网";
  else if (result === "fail") lteApnNote.value = "没有保存。充电桩不接受这组 APN 设置";
  else lteApnNote.value = "充电桩没有应答，没有保存";
  startLtePage(true);
}
/* 时区设置（命令、旧固件的退路见 tz.js）。点一格就存：TZSET，再 TZGET 读回来确认；
 * 桩里的时区、菜单上的字、高亮都以读回来的为准。 */
const tzNote = ref("");
const tzSaving = ref(false);
const tzPick = ref(null);
let tzRun = 0;
let tzWait = null;
const tzBrief = computed(() => (tzKnown.value ? tzLabel(tzMin.value) : "…"));
const tzListed = computed(() => tzIndex(tzMin.value) >= 0);
const tzLegacy = computed(() => tzSupported(fw.value === "—" ? "" : fw.value) === false);
/* 2.6.8 起离线模式（WiFi、OCPP 都关）下手机的心跳带着手机的时区，桩跟着改。 */
const tzFollowsPhone = computed(() => heartbeatTimed.value && !wifiOn.value && !ocppOn.value);
function askTz(command, accept, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (tzWait === finish) tzWait = null;
      resolve(null);
    }, ms);
    function finish(line) {
      if (!accept(line)) return;
      clearTimeout(timer);
      tzWait = null;
      resolve(line);
    }
    tzWait = finish;
    send(command);
  });
}
function resetTz() {
  tzRun += 1;
  tzWait = null;
  tzSaving.value = false;
  tzPick.value = null;
  tzNote.value = "";
}
/* 时区页顶上的“充电桩当前时间”（命令、旧固件的退路见 charger-clock.js）。进页面读一次
 * TIMEGET，之后每秒按手机走过的时间往前推，字只在跨分时变；隔一阵再读一次校准。时区用
 * tzMin：点选的时区读回确认后这一行马上按新时区重算，再读一次 TIMEGET。 */
const clkBase = ref(null);        /* 最近一次读到的 { unix, at } */
const clkNoTime = ref(false);     /* 最近一次读到的是“桩还没有时间” */
const clkNow = ref(Date.now());
const timeFed = ref(false);       /* 这次连接里桩收下过手机的授时（ACK TIMESET OK） */
let clkRun = 0;
let clkWait = null;
let clkTimer = 0;
let clkReadAt = 0;
const clkOld = computed(() => timeGetSupported(fw.value === "—" ? "" : fw.value) === false);
const clkShown = computed(() => chargerClock({
  base: clkBase.value,
  noTime: clkNoTime.value,
  phoneFed: timeFed.value || (tzFollowsPhone.value && clockReady.value),
  tz: tzMin.value,
  tzKnown: tzKnown.value,
  nowMs: clkNow.value,
}));
function askClk(command, accept, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (clkWait === finish) clkWait = null;
      resolve(null);
    }, ms);
    function finish(line) {
      if (!accept(line)) return;
      clearTimeout(timer);
      clkWait = null;
      resolve(line);
    }
    clkWait = finish;
    send(command);
  });
}
async function readClk() {
  const token = ++clkRun;
  clkWait = null;
  clkReadAt = Date.now();
  const result = await readChargerTime({
    ask: askClk,
    alive: () => token === clkRun && linkReady.value && page.value === "tz",
    fw: fw.value === "—" ? "" : fw.value,
  });
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
  clkWait = null;
  if (clkTimer) clearInterval(clkTimer);
  clkTimer = 0;
}
function resetClk() {
  stopClk();
  clkBase.value = null;
  clkNoTime.value = false;
  timeFed.value = false;
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
    /* 存时区的那几条命令在路上时不插进去；固件升级排着数据时也不问。 */
    if (tzSaving.value || otaBusy.value || !linkReady.value || typeof clkWait === "function") return;
    if (clkNow.value - clkReadAt >= (clkBase.value ? CLOCK_RESYNC_MS : CLOCK_RETRY_MS)) readClk();
  }, 1000);
}
function openTz() {
  menuPull++;
  resetTz();
  page.value = "tz";
  send("SCHEDGET");
  startClk();
}
async function pickZone(zone) {
  if (tzSaving.value) return;
  if (tzKnown.value && zone === tzMin.value) {
    tzNote.value = "";
    return;
  }
  const token = ++tzRun;
  const alive = () => token === tzRun && linkReady.value && page.value === "tz";
  tzSaving.value = true;
  tzPick.value = zone;
  tzNote.value = "正在保存";
  const result = await saveZone({
    ask: askTz,
    alive,
    fw: fw.value === "—" ? "" : fw.value,
    tz: zone,
  });
  if (token !== tzRun) return;
  tzSaving.value = false;
  tzPick.value = null;
  if (result.state === "gone") {
    tzNote.value = "";
    return;
  }
  if (Number.isInteger(result.tz)) {
    tzMin.value = result.tz;
    tzKnown.value = true;
  }
  if (result.state === "ok") tzNote.value = "已保存，断电后仍然有效";
  else if (result.state === "time") tzNote.value = "没有保存。充电桩里有预约但还没有时间，请先关闭预约或等时间校对后再改。";
  else if (result.state === "silent") tzNote.value = "充电桩没有应答，没有保存";
  else tzNote.value = "没有保存";
  /* 预约页、充电记录的钟点都按桩的时区：整行再读一次。 */
  if (linkReady.value) send("SCHEDGET");
  /* 顶上的时间已经按读回来的时区重算了；再从桩读一次。 */
  clkNow.value = Date.now();
  if (linkReady.value && page.value === "tz") readClk();
}
function openModver() {
  menuPull++;
  page.value = "modver";
  if (modverState.value !== "ok") startModver(false);
}
const PROFILE_KEY = "ac06-oneclick";
function loadProfiles() {
  try {
    const raw = JSON.parse(localStorage.getItem(PROFILE_KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    return raw.filter((item) => item && item.id && item.name && item.body && item.model === "AC06");
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
  page.value = "profiles";
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
  if (!item || !item.body || item.model !== "AC06") return;
  profileAskId.value = "";
  runProfileJob("write", JSON.parse(JSON.stringify(item.body)), item.name);
}
function profileLogText(row) {
  const vars = Object.assign({}, row.vars || {});
  if (vars.name) vars.name = t(vars.name);
  if (vars.reason) vars.reason = t(vars.reason);
  return t(row.text, vars);
}
async function pushProfileLog(text, kind, vars) {
  profileLog.value.push({ text, kind, vars: vars || null });
  await nextTick();
  const box = profileLogBox.value;
  if (box) box.scrollTop = box.scrollHeight;
}
/* 桩在 AT 模式下一次只发一行，前面排着状态行时（最多 3 行，每行等模组回 OK，
 * 上限 0.8 秒）一条应答最慢要 2.4 秒左右，所以一次等 3 秒，没等到再问一遍。
 * 下发后的读回可能赶上桩正在连刚保存的热点，那段时间它不发蓝牙，多等几遍。 */
const PROFILE_ASK_MS = 3000;
async function askLine(run, command, accept, tries) {
  let line = null;
  for (let attempt = 0; attempt < (tries || 2); attempt++) {
    if (run !== profileRunId || page.value !== "profileRun") return null;
    line = await roundTrip(command, accept, PROFILE_ASK_MS);
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
  return sameSection(key, body, got) ? "" : "读回的值和写入的不一样";
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
  for (let i = 0; i < SECTIONS.length; i++) {
    if (run !== profileRunId || page.value !== "profileRun") return;
    const section = SECTIONS[i];
    /* 桩的固件不认识这一项（4G APN 是 2.6.16 起才有的），或者这份备份里没有它：跳过，不算
     * 失败。不然旧固件的桩永远存不了备份。 */
    const skip = sectionSkip(section, mode, fw.value === "—" ? "" : fw.value, body);
    if (skip) {
      await pushProfileLog("{name}已跳过：{reason}", "run", { name: section.name, reason: skip });
      if (run !== profileRunId || page.value !== "profileRun") return;
      profileDone.value = i + 1;
      profilePercent.value = Math.round(profileDone.value * 100 / SECTIONS.length);
      continue;
    }
    const plan = mode === "read" ? readPlan(section.key) : writePlan(section.key, body, { cardSlots: cardSlots.value });
    await pushProfileLog(mode === "read" ? "正在读取{name}" : "正在设置{name}", "run", { name: section.name });
    if (run !== profileRunId || page.value !== "profileRun") return;
    profilePercent.value = Math.round(i * 100 / SECTIONS.length);
    if (!plan.list) {
      failed += 1;
      await pushProfileLog("{name}设置失败：{reason}", "bad", { name: section.name, reason: plan.error || "这份配置里没有这一项" });
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
  profileFinished.value = true;
  if (mode === "read") {
    if (failed) {
      profileDoneNote.value = "有项目没有读到，没有保存";
      return;
    }
    const list = loadProfiles();
    list.unshift({ id: newProfileId(), name, savedAt: Date.now(), model: "AC06", body });
    storeProfiles(list);
    profileDoneNote.value = "已保存到一键配置";
    return;
  }
  profileDoneNote.value = failed ? "有项目没有写上" : "下发完成";
}
function openCards() {
  page.value = "cards";
  cardNote.value = "正在读取本地卡";
  send("CARDGET");
}
function openCard(index) {
  cardIndex.value = index;
  cardInput.value = cards.value[index] || "";
  cardNote.value = "最长 10 位，留空再保存就是删除这张卡";
  page.value = "cardedit";
}
function saveCard() {
  const text = String(cardInput.value || "");
  if (text.length > 10 || /[^\x21-\x7E]/.test(text)) {
    cardNote.value = "没有保存。卡号最长 10 位，只能是可见英文字符";
    return;
  }
  cardNote.value = "正在保存";
  send("CARDSET\t" + (cardIndex.value + 1) + "\t" + text);
}
function openQr() {
  page.value = "qr";
  qrNote.value = "正在读取充电桩里的设置";
  send("QRGET");
}
function openOcfw() {
  page.value = "ocfw";
  ocfwNote.value = "正在读取充电桩里的设置";
  send("OCFWGET");
}
function saveOcfw() {
  const text = String(ocfwText.value || "");
  if (text.length > 20 || (text.length > 0 && /[^\x21-\x7E]/.test(text))) {
    ocfwNote.value = "没有保存。版本号最长 20 位，只能是可见英文字符";
    return;
  }
  ocfwNote.value = "正在保存";
  send("OCFWSET\t" + (ocfwOn.value ? "1" : "0") + "\t" + text);
}
function saveQr() {
  const text = String(qrText.value || "");
  if (text.length > 47 || /[^\x20-\x7E]/.test(text)) {
    qrNote.value = "没有保存。内容最长 47 个英文字符";
    return;
  }
  qrNote.value = "正在保存";
  send("QRSET\t" + (qrOn.value ? "1" : "0") + "\t" + text);
}
function openTelemetry() {
  page.value = "telemetry";
  telemetryNote.value = "正在读取充电桩里的开关";
  send("TELGET");
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
  send("TELSET\t" + (on ? "1" : "0"));
}
function openOrders() {
  orders.value = [];
  page.value = "orders";
  send("SCHEDGET");
  send("ORDGET");
}
function pad2(n) {
  return (n < 10 ? "0" : "") + n;
}
function fmtUnix(unix) {
  if (!unix) return "时间未同步";
  const local = new Date(unix * 1000 + tzMin.value * 60000);
  return local.getUTCFullYear() + "-" + pad2(local.getUTCMonth() + 1) + "-" +
    pad2(local.getUTCDate()) + " " + pad2(local.getUTCHours()) + ":" +
    pad2(local.getUTCMinutes());
}
function orderStop(token) {
  if (!token || token === "NONE") return "未记录";
  return orderFaults[token] || stops[token] || token;
}
function orderStart(token) {
  return starts[token] || "未知";
}
function orderUser(token) {
  if (!token) return "";
  const kept = String(token).replace(/[^A-Za-z0-9]/g, "");
  return kept.slice(-8);
}
function fmtDur(sec) {
  if (sec == null || sec < 0 || sec >= 0xffffffff) return "未记录";
  let left = sec;
  const hour = Math.floor(left / 3600);
  left = left % 3600;
  const minute = Math.floor(left / 60);
  left = left % 60;
  return pad2(hour) + ":" + pad2(minute) + ":" + pad2(left);
}
function openSched() {
  page.value = "sched";
  schedNote.value = clockReady.value
    ? "时间已校对。预约钟点按充电桩的时区计算，保存后下次打开还能看到。"
    : "充电桩还没有时间，不能预约。";
  send("SCHEDGET");
}
/* 预约页不再改时区（2.6.14 起在“时区设置”里改）。SCHEDSET 这条命令仍然带时区，
 * 带的是刚从桩里读到的那个，所以保存预约不会动它。 */
function saveSched() {
  const tz = tzMin.value;
  const hour = parseInt(String(schedHour.value).trim(), 10);
  const minute = parseInt(String(schedMinute.value).trim(), 10);
  if (!tzKnown.value) {
    schedNote.value = "还没有读到充电桩的时区，请稍后再试";
    send("SCHEDGET");
    return;
  }
  if (!Number.isFinite(hour) || hour < 0 || hour > 23 ||
      !Number.isFinite(minute) || minute < 0 || minute > 59) {
    schedNote.value = "时间用 0 到 23 时、0 到 59 分";
    return;
  }
  if (schedMode.value !== 0 && !clockReady.value) {
    schedNote.value = "还没有服务器时间，请等 OCPP 心跳校对后再预约";
    return;
  }
  schedNote.value = "正在保存";
  send("SCHEDSET\t" + tz + "\t" + schedMode.value + "\t" + hour + "\t" + minute);
}
function openImax() {
  imaxInput.value = imax.value;
  imaxNote.value = "6 到 32 安，默认 32。充电中修改后，方波马上按新电流发。断电后仍然有效。";
  page.value = "imax";
  send("IMAXGET");
}
function saveImax() {
  const amp = parseInt(String(imaxInput.value).trim(), 10);
  if (!Number.isFinite(amp) || amp < 6 || amp > 32) {
    imaxNote.value = "请填 6 到 32 的整数";
    return;
  }
  imaxNote.value = "正在保存";
  send("IMAXSET\t" + amp);
}
function resetCharge() {
  stateText.value = "正在连接";
  faultText.value = "";
  ocppText.value = "OCPP 未连接";
  ocppKind.value = "off";
  duration.value = "--:--:--";
  power.value = "—";
  energy.value = "0.000 kWh";
  fw.value = "—";
  cardWide.value = false;
  earthLive.value = "—";
  cpLive.value = "—";
  clock.value = "时间未同步";
  volts.value = ["—", "—", "—"];
  amps.value = ["—", "—", "—"];
  wifi.value = "WiFi —";
  wifiLinkNow = "";
  wifiSsidNow = "";
  wifiRssiNow = null;
  wifiRssiPending = false;
  resetModver();
  resetLte();
  resetTz();
  resetClk();
  tzKnown.value = false;
  wifiSaved.value = "未配置热点";
  plug.value = false;
  plugDip.value = false;
  plugHold.value = 0;
  telemetry.value = false;
  telemetryNote.value = "";
  telemetryHold.value = 0;
  wifiOn.value = false;
  ocppOn.value = false;
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

function openWifi() {
  page.value = "wifi";
  aps.value = [];
  wifiNote.value = "这是充电桩里保存的热点。要换热点再点搜索";
  send("WIFISWGET");
  send("WCFGGET");
}
function scanWifi() {
  aps.value = [];
  wifiNote.value = "正在搜索热点";
  send("WSCAN");
}
function setWifiOn(on) {
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
  send("WIFISWSET\t" + (on ? "1" : "0"));
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
  if (message) wifiNote.value = message;
}
function joinWifi() {
  if (wifiJoining.value) return;
  const ssid = picked.value;
  const pass = password.value;
  const ssidBytes = new TextEncoder().encode(ssid).length;
  const passBytes = new TextEncoder().encode(pass).length;
  if (!ssidBytes || ssidBytes > 32 || passBytes > 32 || /[\t\n]/.test(ssid + pass)) {
    wifiNote.value = "名称或密码不能用，最长 32 字节";
    return;
  }
  wifiJoinWanted = ssid;
  wifiJoining.value = true;
  wifiJoinStart = Date.now();
  wifiNote.value = "正在连接热点，请稍后";
  if (wifiJoinTimer) clearTimeout(wifiJoinTimer);
  wifiJoinTimer = setTimeout(() => {
    wifiJoinTimer = 0;
    if (!wifiJoining.value) return;
    wifiJoining.value = false;
    wifiNote.value = "连接超时，可以再输入密码并连接";
  }, 25000);
  send("WJOIN\t" + ssid + "\t" + pass);
}
function openOcpp() {
  page.value = "ocpp";
  ocppUrl.value = "";
  ocppNote.value = "正在读取充电桩里的地址";
  send("OCPPSWGET");
  send("OCPPGET");
}
function openNetStop() {
  page.value = "netstop";
  netStopNote.value = "正在读取充电桩里的设置";
  send("NETSTOPGET");
}
function saveNetStop() {
  const sec = parseInt(String(netStopSec.value).trim(), 10);
  if (!Number.isFinite(sec) || sec < 10 || sec > 600) {
    netStopNote.value = "没有保存。时长只能是 10 到 600 秒";
    return;
  }
  netStopHold.value = Date.now() + 2500;
  netStopNote.value = "正在保存";
  send("NETSTOPSET\t" + (netStopOn.value ? "1" : "0") + "\t" + sec);
}
function openReboot() {
  rebootAsk.value = false;
  rebootNote.value = "";
  page.value = "reboot";
}
function confirmReboot() {
  rebootAsk.value = false;
  rebootNote.value = "充电桩正在重启";
  send("REBOOT");
}
function setOcppOn(on) {
  ocppOn.value = on;
  ocppSwHold.value = Date.now() + 2500;
  ocppNote.value = on ? "正在打开 OCPP" : "正在关闭 OCPP";
  send("OCPPSWSET\t" + (on ? "1" : "0"));
}
function saveOcpp() {
  const url = ocppUrl.value.trim();
  if (!ocppUrlOk(url)) {
    ocppNote.value = "地址需要是 ws(s)://主机/路径，最长 127 字节";
    return;
  }
  ocppNote.value = "正在保存";
  send("OCPPSET\t" + url);
}
function openCfg() {
  page.value = "cfg";
  cfgNote.value = "正在读取保护设置";
  send("CFGGET");
}
function saveCfg() {
  const nums = [cfg.over, cfg.under, cfg.ab, cfg.bc, cfg.cd, cfg.ef].map((v) => Number(String(v).trim()));
  const earthMin = Number(String(cfg.earthMin).trim());
  if (nums.some((n) => !Number.isFinite(n)) || !Number.isFinite(earthMin)) {
    cfgNote.value = "请把过压、欠压、接地阈值和四条 CP 分界都填成数字";
    return;
  }
  if (earthMin < 50 || earthMin > 250) {
    cfgNote.value = "没有保存。接地故障阈值只能是 50 到 250 V";
    return;
  }
  const limitError = voltageLimitError(cfg.over, cfg.under);
  if (limitError) {
    cfgNote.value = limitError;
    return;
  }
  cfgNote.value = "正在保存";
  send("CFGSET\t" + nums.map((n, i) => (i < 2 ? n.toFixed(0) : n.toFixed(2))).join("\t") + "\t" + (cfg.earth ? "1" : "0") + "\t" + (cfg.leak ? "1" : "0") + "\t" + earthMin.toFixed(0));
}
function setPlug(on) {
  plug.value = on;
  plugHold.value = Date.now() + 2500;
  note.value = on ? "正在打开即插即充" : "正在关闭即插即充";
  send("PLUGSET\t" + (on ? "1" : "0"));
}

const states = {
  SELFCHECK: "自检", AVAILABLE: "待机", STANDBY: "待机", CONNECTED: "已插枪",
  PLUGGED: "已插枪", PREPARING: "车辆暂停", SUSPENDED_EV: "车辆暂停",
  // 电网或电表短时异常，桩暂停输出，稳定后自动接着充。固件 2.5.6 之后的可靠性修复新增。
  SUSPENDED_EVSE: "电网异常，等待恢复",
  RELAY_PULL_IN: "继电器吸合", CHARGING: "充电中", FINISHED: "已停止",
  STOPPED: "已停止", BLOCKED: "故障",
};
const stops = {
  USER: "用户停止", SAFETY: "故障停止", CP_FAULT: "导引故障",
  VENTILATION_REQUIRED: "需要通风", DISCONNECTED: "枪已拔出", RELAY_REJECTED: "继电器异常",
  CARD: "刷卡停止", BLE: "蓝牙停止", REMOTE: "远程停止", SCREEN: "屏幕停止", DEBUG: "调试口停止",
  POWER: "掉电停止", OFFLINE: "断网停止",
};
const orderFaults = {
  ESTOP: "急停停止", LEAK: "漏电停止", EARTH: "接地停止", SENSOR: "漏保传感器停止",
  SELFTEST: "漏保自检停止", OVERTEMP: "枪温过高停止", NTC: "温度传感器停止", METER: "计量故障停止",
  RELAY: "接触器无法闭合", WELDED: "接触器粘连", OV: "过压停止", UV: "欠压停止", OC: "过流停止",
  SHORT: "短路停止", PHASE: "缺相停止", POWER: "掉电停止",
};
const starts = {
  PLUG: "插枪即充", PRIV: "特权卡", WHITE: "白名单卡", CARD: "平台刷卡",
  APP: "APP远程", BLE: "蓝牙", SCHED: "预约到点", DEBUG: "调试口",
};
const faults = {
  ESTOP: "急停按下", LEAK: "漏电故障", EARTH: "接地故障", SENSOR: "漏保传感器故障",
  SELFTEST: "漏保自检失败", OVERTEMP: "枪温过高", NTC: "温度传感器故障", METER: "计量故障",
  RELAY: "接触器无法闭合", WELDED: "接触器粘连", OV: "过压", UV: "欠压", OC: "过流",
  SHORT: "短路", PHASE: "缺相",
};

function faultLabel(token) {
  if (!token || token === "NONE") return "";
  const names = token.split("+").map((name) => faults[name]).filter(Boolean);
  return names.join("、");
}
const wifiLinks = {
  UP: "WiFi 已连接",
  JOINING: "WiFi 连接中",
  FAIL: "WiFi 连接失败",
  DOWN: "WiFi 未连接",
};
function saneSsid(ssid) {
  if (ssid === "-") return "";
  if (!ssid || ssid.length > 32 || /[\u0000-\u001F\u007F\uFFFD]/.test(ssid)) return null;
  return ssid;
}
function clockText(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(value || "");
  if (!m) return "时间未同步";
  const utc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  const local = new Date(utc + tzMin.value * 60000);
  const p = (n) => (n < 10 ? "0" : "") + n;
  return local.getUTCFullYear() + "-" + p(local.getUTCMonth() + 1) + "-" +
    p(local.getUTCDate()) + " " + p(local.getUTCHours()) + ":" +
    p(local.getUTCMinutes()) + ":" + p(local.getUTCSeconds());
}
function pad(n) {
  return (n < 10 ? "0" : "") + n;
}
function energyText(raw) {
  const wh = Math.max(0, parseInt(raw, 10) || 0);
  return (wh / 1000).toFixed(3) + " kWh";
}
function powerText(token) {
  if (!token || token === "PWN" || token === "PW") return "—";
  const watts = parseFloat(token.slice(2));
  if (!Number.isFinite(watts)) return "—";
  return (watts / 1000).toFixed(2) + " kW";
}
function durationText(raw) {
  const seconds = Math.max(0, parseInt(raw, 10) || 0);
  return pad(Math.floor(seconds / 3600)) + ":" + pad(Math.floor(seconds / 60) % 60) + ":" + pad(seconds % 60);
}
function ocppLabel(token) {
  if (token === "ON") return { text: "OCPP 已连接", kind: "on" };
  if (token === "BUSY") return { text: "OCPP 正在连接", kind: "busy" };
  return { text: "OCPP 未连接", kind: "off" };
}
/* 首页「WiFi 已连接」那一行。信号强度来自 LIVE 行（固件 2.6.5 起），只在已连接时显示；
 * 旧固件没有这个字段，这一行和以前一样。 */
let wifiLinkNow = "";
let wifiSsidNow = "";
let wifiRssiNow = null;
/* 桩的 LIVE 行有信号强度这个字段、但还没有数值：已连接时显示 (--)，和屏幕一样。 */
let wifiRssiPending = false;
function showWifiStatus() {
  const label = wifiLinks[wifiLinkNow];
  if (label) wifi.value = wifiStatusText(label, wifiLinkNow, wifiSsidNow, wifiRssiNow, wifiRssiPending);
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
  if (wifiJoinWanted && saved === wifiJoinWanted && link === "UP" && Date.now() - wifiJoinStart >= 800) {
    wifiJoinWanted = "";
    stopWifiJoin("");
    page.value = "charge";
    note.value = "已连接热点";
    return;
  }
  if (wifiJoining.value && saved === picked.value && link === "FAIL") {
    stopWifiJoin("没有连上，可以再输入密码并连接");
  }
}
function statSavedSsid(part) {
  for (let i = 0; i < part.length; i++) {
    const tok = part[i];
    if (!(tok === "PWN" || tok === "PW" || /^PW-?\d+(?:\.\d+)?$/.test(tok))) continue;
    const clockTok = part[i + 1] || "";
    if (clockTok !== "-" && !/^\d{4}-\d{2}-\d{2}T/.test(clockTok)) continue;
    return part.slice(i + 2).join(" ").trim();
  }
  return null;
}

function applyStat(line) {
  const part = line.split(" ");
  if (part.length < 10) return;
  const faultFirst = !/^\d+$/.test(part[2]);
  const base = faultFirst ? 3 : 2;
  let faultToken = faultFirst ? part[2] : "NONE";
  if (states[part[1]]) stateText.value = states[part[1]];
  duration.value = durationText(part[base]);
  power.value = "—";
  for (let i = 0; i < part.length; i++) {
    if (part[i].indexOf("PW") === 0) {
      power.value = powerText(part[i]);
      break;
    }
  }
  volts.value = [part[base + 1], part[base + 2], part[base + 3]];
  amps.value = [part[base + 4], part[base + 5], part[base + 6]];
  const stopAt = base + 7;
  const wifiAt = base + 8;
  let plugAt = base + 9;
  if (part.length > wifiAt + 1 &&
      (part[wifiAt + 1] === "OFF" || part[wifiAt + 1] === "BUSY" || part[wifiAt + 1] === "ON")) {
    const link = ocppLabel(part[wifiAt + 1]);
    ocppText.value = link.text;
    ocppKind.value = link.kind;
    plugAt = wifiAt + 2;
  }
  let clockAt = plugAt;
  let foundClock = false;
  let iso = "";
  const bit = (s) => s === "0" || s === "1";
  const versionToken = (s) => /^\d+\.\d+/.test(s || "") && s.indexOf("-") < 0 && s.indexOf("T") < 0;
  if (part.length > plugAt && bit(part[plugAt])) {
    let saved = part[plugAt] === "1";
    let dip = false;
    clockAt = plugAt + 1;
    if (part.length > plugAt + 2 && bit(part[plugAt + 1]) && bit(part[plugAt + 2])) {
      saved = part[plugAt + 1] === "1";
      dip = part[plugAt + 2] === "1";
      clockAt = plugAt + 3;
      if (/^\d+$/.test(part[clockAt] || "")) {
        energy.value = energyText(part[clockAt]);
        clockAt += 1;
      }
      if (versionToken(part[clockAt])) {
        fw.value = part[clockAt];
        clockAt += 1;
      }
      followZone();
    }
    plugDip.value = dip;
    if (Date.now() >= plugHold.value) plug.value = saved;
    if (!faultFirst && part.length > clockAt && part[clockAt].indexOf("T") < 0 && part[clockAt] !== "-") {
      faultToken = part[clockAt];
      clockAt += 1;
    }
    if (part.length > clockAt && part[clockAt].indexOf("T") > 0) {
      iso = part[clockAt];
      foundClock = true;
    } else if (part.length > clockAt && part[clockAt] === "-") {
      foundClock = true;
    }
  }
  if (!iso) {
    for (let i = 0; i < part.length; i++) {
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(part[i])) {
        iso = part[i];
        if (!foundClock) {
          clockAt = i;
          foundClock = true;
        }
        break;
      }
    }
  }
  if (iso) clock.value = clockText(iso);
  else if (foundClock) clock.value = "时间未同步";
  faultText.value = faultLabel(faultToken);
  const savedSsid = statSavedSsid(part);
  if (savedSsid !== null) applyWifiConfig(part[wifiAt], savedSsid === "" ? "-" : savedSsid);
  if (faultToken !== "NONE") {
    if (faultText.value) note.value = faultText.value;
  } else if (part.length > stopAt && stops[part[stopAt]]) note.value = stops[part[stopAt]];
  else if (page.value !== "plug" && note.value !== "已保存，正在连接" && note.value.indexOf("即插即充") !== 0 && note.value.indexOf("已记住") !== 0) note.value = "状态已更新";
}

function applyAck(line) {
  if (line.indexOf("SCHEDSET") >= 0 && line.indexOf("TIME") >= 0) {
    clockReady.value = false;
    schedNote.value = "还没有服务器时间，不能预约";
    return;
  }
  if (line.indexOf("SCHEDSET") >= 0 && line.indexOf("OK") >= 0) {
    schedNote.value = "已保存，断电后仍然有效";
    send("SCHEDGET");
    return;
  }
  if (line.indexOf("SCHEDSET") >= 0) {
    schedNote.value = "没有保存";
    return;
  }
  if (line.indexOf("IMAXSET") >= 0 && line.indexOf("OK") >= 0) {
    imax.value = String(parseInt(imaxInput.value, 10));
    imaxNote.value = "已保存。充电中方波已按新电流发出，断电后仍然有效";
    return;
  }
  if (line.indexOf("IMAXSET") >= 0) {
    imaxNote.value = "没有保存。电流只能是 6 到 32 安";
    return;
  }
  if (line.indexOf("PLUGSET") >= 0 && line.indexOf("SW") >= 0) {
    plugHold.value = 0;
    plugDip.value = true;
    note.value = plug.value
      ? "已记住打开。拨码2 仍在强制开启"
      : "已记住关闭。拨码2 仍在强制开启，拨到 OFF 后才会关闭";
    return;
  }
  if (line.indexOf("PLUGSET") >= 0 && line.indexOf("OK") >= 0) {
    plugHold.value = 0;
    note.value = plug.value ? "即插即充已打开，断电后仍然有效" : "即插即充已关闭";
    return;
  }
  if (line.indexOf("PLUGSET") >= 0) {
    plugHold.value = 0;
    plug.value = !plug.value;
    note.value = "即插即充没有保存";
    return;
  }
  if (line.indexOf("WIFISWSET") >= 0 && line.indexOf("OK") >= 0) {
    wifiSwHold.value = 0;
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
  if (line.indexOf("WIFISWSET") >= 0) {
    wifiSwHold.value = 0;
    wifiOn.value = !wifiOn.value;
    if (wifiClosedOcpp) ocppOn.value = true;
    wifiClosedOcpp = false;
    wifiNote.value = "WiFi 开关没有保存";
    if (lteClosedBy === "wifi") {
      lteClosedBy = "";
      lteAfterOther();
    }
    return;
  }
  if (line.indexOf("NETSTOPSET") >= 0 && line.indexOf("OK") >= 0) {
    netStopHold.value = 0;
    netStopNote.value = "已保存，断电后仍然有效";
    return;
  }
  if (line.indexOf("NETSTOPSET") >= 0) {
    netStopHold.value = 0;
    netStopNote.value = "没有保存。时长只能是 10 到 600 秒";
    send("NETSTOPGET");
    return;
  }
  if (line.indexOf("REBOOT") >= 0 && line.indexOf("OK") >= 0) {
    rebootNote.value = "充电桩正在重启";
    return;
  }
  if (line.indexOf("REBOOT") >= 0) {
    rebootNote.value = "重启没有发出";
    return;
  }
  if (line.indexOf("OCPPSWSET") >= 0 && line.indexOf("OK") >= 0) {
    ocppSwHold.value = 0;
    ocppNote.value = ocppOn.value
      ? "OCPP 已打开。断电后仍然有效"
      : "OCPP 已关闭。已保存的地址还在";
    return;
  }
  if (line.indexOf("OCPPSWSET") >= 0) {
    ocppSwHold.value = 0;
    ocppOn.value = !ocppOn.value;
    ocppNote.value = "OCPP 开关没有保存";
    return;
  }
  if (line.indexOf("TELSET") >= 0 && line.indexOf("OK") >= 0) {
    telemetryHold.value = 0;
    telemetryNote.value = telemetry.value
      ? (lteClosedBy === "tel"
        ? "遥测已打开，4G 已关闭。遥测串口每秒发送状态，断电后仍然有效"
        : "遥测已打开。遥测串口每秒发送状态，断电后仍然有效")
      : "遥测已关闭。遥测串口不再发送遥测数据";
    if (lteClosedBy === "tel") lteClosedBy = "";
    if (telemetry.value) lteAfterOther();
    return;
  }
  if (line.indexOf("TELSET") >= 0) {
    telemetryHold.value = 0;
    telemetry.value = !telemetry.value;
    telemetryNote.value = "遥测开关没有保存";
    if (lteClosedBy === "tel") {
      lteClosedBy = "";
      lteAfterOther();
    }
    return;
  }
  if (line.indexOf("CFGSET") >= 0 && line.indexOf("SW") >= 0) {
    maskDip.value = true;
    cfgNote.value = "已记住。印刷拨码1 仍强制屏蔽接地和漏电，拨到 OFF 后重新上电才按这个设置";
    return;
  }
  if (line.indexOf("CFGSET") >= 0 && line.indexOf("OK") >= 0) {
    cfgNote.value = "已保存，断电后仍然有效";
    return;
  }
  if (line.indexOf("CFGSET") >= 0 && line.indexOf("CPRELAY") >= 0) {
    cfgNote.value = "电压和接地已保存。接触器吸合时不能改 CP，先停止充电再保存";
    return;
  }
  if (line.indexOf("CFGSET") >= 0 && line.indexOf("EARTH") >= 0) {
    cfgNote.value = "没有保存。接地故障阈值只能是 50 到 250 V";
    return;
  }
  if (line.indexOf("CFGSET") >= 0) {
    cfgNote.value = "没有保存。过压不超过 320 V，欠压不低于 100 V，且比过压至少低 10 V";
    return;
  }
  if (line.indexOf("AUTH") >= 0 && line.indexOf("OK") >= 0) {
    gateState.value = "ok";
    gateAuto.value = false;
    if (gateSave.value) rememberGate(gatePass.value);
    else forgetGate();
    gateInput.value = "";
    gateEnter.value = false;
    page.value = "charge";
    send("SCHEDGET");
    send("TELGET");
    startTimeSync();
    return;
  }
  if (line.indexOf("AUTH") >= 0) {
    gateState.value = "need";
    gateAuto.value = false;
    forgetGate();
    gateEnter.value = false;
    gateInput.value = "";
    gateSave.value = true;
    page.value = "gate";
    gateNote.value = "密码不对。请输入屏幕上现在的管理员密码";
    return;
  }
  if (line.indexOf("CARDSET") >= 0 && line.indexOf("OK") >= 0) {
    cards.value[cardIndex.value] = String(cardInput.value || "");
    cardNote.value = "已保存，断电后仍然有效";
    page.value = "cards";
    return;
  }
  if (line.indexOf("CARDSET") >= 0) {
    cardNote.value = "没有保存。卡号最长 10 位，只能是可见英文字符";
    return;
  }
  if (line.indexOf("QRSET") >= 0 && line.indexOf("OK") >= 0) {
    qrNote.value = "已保存，断电后仍然有效";
    return;
  }
  if (line.indexOf("OCFWSET") >= 0 && line.indexOf("OK") >= 0) {
    ocfwNote.value = "已保存。连平台时按这个版本号上报，充电桩固件版本不变";
    return;
  }
  if (line.indexOf("OCFWSET") >= 0) {
    ocfwNote.value = "没有保存。版本号最长 20 位，只能是可见英文字符";
    return;
  }
  if (line.indexOf("QRSET") >= 0) {
    qrNote.value = "没有保存。内容最长 47 个英文字符";
    return;
  }
  if (line.indexOf("OCPPSET") >= 0 && line.indexOf("OK") >= 0) {
    ocppNote.value = "已保存，正在重新连接";
    return;
  }
  if (line.indexOf("OCPPSET") >= 0) {
    ocppNote.value = "没有保存";
    return;
  }
  if (line.indexOf("WJOIN") >= 0 && line.indexOf("OK") >= 0) {
    return;
  }
  if (line.indexOf("WJOIN") >= 0 && (line.indexOf("FAIL") >= 0 || line.indexOf("BUSY") >= 0)) {
    stopWifiJoin(ackText(line));
    return;
  }
  const text = ackText(line);
  if (!text) return;
  if (page.value === "wifi" || page.value === "pass") wifiNote.value = text;
  else if (page.value !== "cfg" && page.value !== "ocpp") note.value = text;
}
function ackText(line) {
  if (line.indexOf("OTA") >= 0) return "";
  if (line.indexOf("START") >= 0 && line.indexOf("REJECTED") >= 0) return "启动未被接受";
  if (line.indexOf("START") >= 0) return "已发出启动";
  if (line.indexOf("STOP") >= 0) return "已发出停止";
  if (line.indexOf("WSCAN") >= 0 && line.indexOf("FAIL") >= 0) return "搜索热点失败";
  if (line.indexOf("WSCAN") >= 0 && line.indexOf("BUSY") >= 0) return "正在搜索或连接，请稍等";
  if (line.indexOf("WSCAN") >= 0) return "正在搜索热点";
  if (line.indexOf("WJOIN") >= 0 && line.indexOf("FAIL") >= 0) return "没有保存成功";
  if (line.indexOf("WJOIN") >= 0 && line.indexOf("BUSY") >= 0) return "正在搜索或连接，请稍等";
  return "";
}
function applyCfg(line) {
  const part = line.trim().split(/\s+/);
  const nums = part.slice(1, 7).map((p) => Number(p));
  if (part.length < 7 || nums.some((n) => !Number.isFinite(n))) {
    if (part.length > 1 && Number.isFinite(Number(part[1]))) {
      cfgNote.value = "保护设置读失败，再打开一次";
    }
    return;
  }
  cfg.over = part[1];
  cfg.under = part[2];
  cfg.ab = part[3];
  cfg.bc = part[4];
  cfg.cd = part[5];
  cfg.ef = part[6];
  if (part.length >= 8) cfg.earth = part[7] === "1";
  if (part.length >= 9) cfg.leak = part[8] === "1";
  if (part.length >= 10) maskDip.value = part[9] === "1";
  if (part.length >= 11 && Number.isFinite(Number(part[10]))) cfg.earthMin = part[10];
  cfgNote.value = "这是充电桩里的保护设置，改完点保存";
}
const firmwareInput = ref(null);
const otaName = ref("");
const otaSize = ref(0);
const otaCrc = ref("");
const otaFileVer = ref("");
const otaNote = ref("发送过程中充电桩亮白灯快闪");
const otaNoteVars = ref(null);
const otaPhase = ref("");
const otaDone = ref(0);
const otaTotal = ref(0);
const otaElapsed = ref(0);
/* 心跳校时（固件 2.6.8 起，说明见 time-sync.js）。连着、密码通过、读到的固件版本不低于 2.6.8
 * 这三样齐了，才让 MainActivity 每秒的心跳带上手机时间；少一样就是纯 "HB"。
 * 旧固件带了时间不当心跳，所以版本没读到时不能开。旧壳子没有这个接口，跳过。
 * 固件升级从检查到发完这一段也关掉：发送队列里排着固件数据，带的时间到桩已经旧了，
 * 这一段也不另外发 SCHEDGET。 */
const otaBusy = computed(() =>
  otaPhase.value === "preparing" || otaPhase.value === "ready" || otaPhase.value === "sending");
const heartbeatTimed = computed(() =>
  linkReady.value && gateState.value === "ok" && !otaBusy.value && heartbeatCarriesTime(fw.value));
let zoneState = {};
watch(heartbeatTimed, (on) => {
  const evc = bridge();
  if (evc && typeof evc.heartbeatTime === "function") evc.heartbeatTime(!!on);
  zoneState = {};
});
/* 每来一条状态行看一次：心跳可能已经把桩的时区改成手机的了，重新读 SCHEDGET 把它拿回来。 */
function followZone() {
  if (zoneRereadDue(zoneState, heartbeatTimed.value, tzMin.value, phoneTzMinutes(), Date.now())) {
    send("SCHEDGET");
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
setInterval(() => {
  if (page.value === "ota" && otaPhase.value === "ready" && typeof otaWait !== "function") {
    send("OTACHECK");
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
function versionParts(text) {
  const m = String(text || "").replace(/^[Vv]/, "").match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : 0];
}
function isDowngrade(fileVer, pileVer) {
  const fileParts = versionParts(fileVer);
  const pileParts = versionParts(pileVer);
  if (!fileParts || !pileParts) return false;
  for (let i = 0; i < 3; i++) {
    if (fileParts[i] !== pileParts[i]) return fileParts[i] < pileParts[i];
  }
  return false;
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
  const mark = "AC06VER=";
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
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function waitBle(pred, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (otaWait === finish) otaWait = null;
      resolve(null);
    }, ms);
    function finish(line) {
      if (!pred(line)) return false;
      clearTimeout(timer);
      otaWait = null;
      resolve(line);
      return true;
    }
    otaWait = finish;
  });
}
/* 发送固件期间把蓝牙连接间隔调短（HIGH），发完、失败、取消后调回 BALANCED。
 * 旧安装包的壳没有这个接口，手机或模组不接受也没关系，只是不提速。 */
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
function roundTrip(command, pred, ms) {
  const pending = waitBle(pred, ms);
  send(command);
  return pending;
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
  reader.onload = () => {
    const raw = new Uint8Array(reader.result);
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
  };
  reader.readAsArrayBuffer(file);
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
  if (!otaImage) return;
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
  otaNote.value = "正在停充，并暂停 WiFi 和 OCPP。已保存的开关不会改。";
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
      otaNote.value = "充电已停，WiFi 和 OCPP 已暂停。确认后开始发送。重启后按原来的设置恢复，不用重新配置。";
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
  if (typeof otaWait === "function" && otaWait(line)) return;
  /* 授时在等的行（开关状态）照常往下走，界面上的开关也跟着更新。 */
  if (typeof timeWait === "function") timeWait(line);
  if (parseTimeAck(line) !== null) return;
  /* 4G 在等的行（四个开关、APN、状态、ACK）照常往下走，界面跟着更新。 */
  if (typeof lteWait === "function") lteWait(line);
  if (parseLteAck(line) !== null) return;
  if (parseLteSwitch(line) !== null) {
    /* LTEGET 的应答，或者桩因为 WiFi、遥测被打开把 4G 关掉后补的那一行。 */
    if (Date.now() >= lteHold.value) lteOn.value = parseLteSwitch(line);
    if (lteState.value === "idle" || lteState.value === "unsupported" || lteState.value === "silent") lteState.value = "ok";
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
  if (parseModver(line) !== null) {
    if (typeof modverWait === "function") modverWait(line);
    return;
  }
  if (parseTzAck(line) !== null) {
    if (typeof tzWait === "function") tzWait(line);
    return;
  }
  if (parseTimeGet(line) !== null) {
    if (typeof clkWait === "function") clkWait(line);
    return;
  }
  /* 旧固件存时区走 SCHEDGET / SCHEDSET：这两种行照常往下走，界面跟着更新。 */
  if (typeof tzWait === "function" &&
      (parseSchedLine(line) !== null || /^ACK\s+SCHEDSET(\s|$)/.test(line))) tzWait(line);
  if (line === "APDONE") {
    wifiNote.value = aps.value.length ? "点一个热点，再填密码" : "没有搜到热点";
    return;
  }
  if (line.indexOf("AP ") === 0) {
    const body = line.slice(3);
    const space = body.indexOf(" ");
    const rssi = space > 0 ? body.slice(0, space).trim() : "";
    const ssid = space > 0 ? saneSsid(body.slice(space + 1).trim()) : null;
    if (/^-?\d+$/.test(rssi) && ssid) aps.value.push({ rssi, ssid });
    wifiNote.value = "已找到 " + aps.value.length + " 个热点";
    return;
  }
  if (line.indexOf("LIVE ") === 0) {
    const part = line.trim().split(/\s+/);
    const earth = Number(part[1]);
    const cp = Number(part[2]);
    if (Number.isFinite(earth)) earthLive.value = earth.toFixed(1);
    if (Number.isFinite(cp)) cpLive.value = cp.toFixed(2);
    wifiRssiNow = liveRssi(line);
    wifiRssiPending = liveRssiPending(line);
    showWifiStatus();
    return;
  }
  if (line.indexOf("WCFG ") === 0) {
    const body = line.slice(5);
    const space = body.indexOf(" ");
    const link = space < 0 ? body.trim() : body.slice(0, space).trim();
    const ssid = space < 0 ? "" : body.slice(space + 1).trim();
    /* 4G 关着时桩每秒发的是 WCFG：首页那一块换回 WiFi。 */
    lteHome.value = null;
    applyWifiConfig(link, ssid);
    return;
  }
  if (line.indexOf("FLT ") === 0) {
    const token = line.slice(4).trim();
    faultText.value = !token || token === "NONE" ? "" : faultLabel(token);
    if (faultText.value) note.value = faultText.value;
    return;
  }
  if (line === "ORDDONE") {
    return;
  }
  if (line.indexOf("ORD ") === 0) {
    const part = line.split(" ");
    if (part.length >= 6) {
      orders.value.push({
        start: parseInt(part[2], 10) || 0,
        end: parseInt(part[3], 10) || 0,
        wh: parseInt(part[4], 10) || 0,
        ca: parseInt(part[5], 10) || 0,
        stop: part.length >= 7 ? part[6] : "NONE",
        dur: part.length >= 8 ? parseInt(part[7], 10) : null,
        via: part.length >= 9 ? part[8] : "",
        user: part.length >= 10 ? orderUser(part[9]) : "",
        id: part.length >= 11 && part[10] !== "-" ? part[10] : ""
      });
    }
    return;
  }
  if (line.indexOf("SCHED ") === 0) {
    const part = line.split(" ");
    if (part.length >= 7) {
      clockReady.value = part[1] === "1";
      tzMin.value = parseInt(part[2], 10) || 0;
      tzKnown.value = true;
      schedMode.value = parseInt(part[3], 10) || 0;
      schedHour.value = part[4];
      schedMinute.value = part[5];
      schedArmed.value = parseInt(part[6], 10) || 0;
      menuGot.sched = true;
      if (page.value === "sched") {
        schedNote.value = clockReady.value
          ? "这是充电桩里保存的预约。钟点按充电桩的时区。"
          : "充电桩还没有时间，不能预约。";
      }
    }
    return;
  }
  if (line.indexOf("CARD\t") === 0 || line === "CARD") {
    const got = splitCardLine(line);
    const next = got.cards;
    if (got.fields > 5) cardWide.value = true;
    cards.value = next;
    if (page.value === "cardedit") cardInput.value = next[cardIndex.value] || "";
    if (page.value === "cards" || page.value === "cardedit") {
      cardNote.value = "这是充电桩里保存的本地卡，点一张填写";
    }
    return;
  }
  if (line.indexOf("QR ") === 0) {
    const body = line.slice(3);
    const tab = body.indexOf("\t");
    const flag = (tab < 0 ? body : body.slice(0, tab)).trim();
    menuGot.qr = true;
    qrOn.value = flag === "1";
    qrText.value = tab < 0 ? "" : body.slice(tab + 1);
    if (page.value === "qr") {
      qrNote.value = "这是充电桩里保存的二维码，改完点保存";
    }
    return;
  }
  if (line.indexOf("OCFW ") === 0) {
    const body = line.slice(5);
    const tab = body.indexOf("\t");
    const flag = (tab < 0 ? body : body.slice(0, tab)).trim();
    menuGot.ocfw = true;
    ocfwOn.value = flag === "1";
    ocfwText.value = tab < 0 ? "" : body.slice(tab + 1);
    if (page.value === "ocfw") {
      ocfwNote.value = "这是上报给平台的版本号，改完点保存";
    }
    return;
  }
  if (line.indexOf("WIFISW ") === 0) {
    menuGot.wifi = true;
    const on = line.slice(7).trim() === "1";
    if (Date.now() >= wifiSwHold.value) {
      wifiOn.value = on;
    }
    return;
  }
  if (line.indexOf("OCPPSW ") === 0) {
    menuGot.ocpp = true;
    const on = line.slice(7).trim() === "1";
    if (Date.now() >= ocppSwHold.value) {
      ocppOn.value = on;
    }
    return;
  }
  if (line.indexOf("NETSTOP ") === 0) {
    const part = line.split(" ");
    menuGot.netstop = true;
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
    menuGot.tel = true;
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
  if (line.indexOf("IMAX ") === 0) {
    menuGot.imax = true;
    const amp = line.slice(5).trim();
    if (amp) {
      imax.value = amp;
      imaxInput.value = amp;
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
  if (line.indexOf("ACK ") === 0) {
    applyAck(line);
    return;
  }
  if (line.indexOf("STAT ") === 0) applyStat(line);
}

function handle(msg) {
  if (!msg || !msg.t) return;
  if (msg.t === "devs") {
    devices.value = (msg.list || []).slice().sort((a, b) => b.rssi - a.rssi);
    return;
  }
  if (msg.t === "note") {
    note.value = msg.s || "";
    return;
  }
  if (msg.t === "page") {
    page.value = msg.s || "scan";
    if (page.value === "scan") scanning.value = false;
    /* 新的一次连接：上一台桩的固件版本不能留着。心跳带不带时间按版本定（见 heartbeatTimed），
     * 这一台要是旧固件、状态行又不带版本，留着旧值就会对它发带时间的心跳，把连接弄断。 */
    if (msg.s === "charge" && !linkReady.value) fw.value = "—";
    if (msg.s === "charge") linkReady.value = true;
    if (msg.s === "charge" && gateState.value !== "ok") {
      const pass = /^\d{6}$/.test(gatePass.value) ? gatePass.value : savedGate();
      if (/^\d{6}$/.test(pass)) {
        if (gateAuto.value) {
          page.value = "scan";
          note.value = "正在连接并核对已保存的密码";
        } else {
          page.value = "gate";
          gateNote.value = "正在核对密码";
        }
        sendAuth(pass, true);
      } else {
        gateAuto.value = false;
        page.value = "gate";
        gateNote.value = "请输入充电桩屏幕上的 6 位管理员密码";
      }
      return;
    }
    if (page.value === "charge") {
      send("SCHEDGET");
      send("TELGET");
      if (gateState.value === "ok") startTimeSync();
    }
    if (page.value === "scan") {
      stopTimeSync();
      wifiJoinWanted = "";
      stopWifiJoin("");
      linkReady.value = false;
      fw.value = "—";
      if (!gateAuto.value) {
        gateState.value = "unknown";
        gateEnter.value = false;
      }
      startScan();
    }
    return;
  }
  if (msg.t === "scan") {
    scanning.value = !!msg.on;
    return;
  }
  if (msg.t === "line") applyLine(msg.s || "");
}

defineExpose({ handle });
</script>

<style>
* { box-sizing: border-box; }
html, body, #app { margin: 0; height: 100%; background: #000; color: #fff; }
body { font-family: sans-serif; }
button, input { font: inherit; color: inherit; }
.app { min-height: 100%; padding: 22px 20px 28px; background: #000; display: flex; flex-direction: column; }
.scan { flex: 1; display: flex; flex-direction: column; }
.app.scan-page { height: 100%; overflow: hidden; }
.app.scan-page .top { flex: 0 0 auto; }
.app.scan-page .scan { flex: 1 1 auto; min-height: 0; overflow: hidden; }
.scan-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; display: flex; flex-direction: column; gap: 12px; }
.scan-dock { flex: none; display: flex; flex-direction: column; gap: 12px; }
.privacy-link { margin-top: auto; background: none; border: 0; color: #f5c400; padding: 22px 0 4px; text-decoration: underline; }
.scan-dock .privacy-link { margin-top: 0; padding: 4px 0 0; }
.pile span { flex: 1; min-width: 0; }
.pile-mark { width: 48px; height: 64px; flex: none; color: #f2f2f2; }
.device.pile em { flex: none; color: #9a9a9a; font-size: 13px; font-weight: 500; }
.lang { background: none; border: 1px solid #f5c400; color: #f5c400; border-radius: 999px; padding: 6px 12px; }
.top-actions { display: flex; align-items: center; gap: 10px; flex: none; }
.wait { display: flex; align-items: center; gap: 12px; }
.wait p { margin: 0; }
.spin { width: 22px; height: 22px; flex: none; border: 3px solid #333; border-top-color: #f5c400; border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
button:disabled, input:disabled { opacity: 0.45; }
.privacy-wrap { color: #1c2430; }
.app.privacy-page { height: 100%; overflow: hidden; padding-bottom: 12px; }
.app.privacy-page .top { flex: 0 0 auto; }
.app.privacy-page .privacy-wrap { flex: 1 1 auto; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; }
.top { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 22px; }
.logo { display: block; }
.sub { margin: 4px 0 0; font-size: 22px; font-weight: 650; }
.gear { width: 44px; height: 44px; flex: none; display: grid; place-items: center; padding: 0; border-radius: 14px; border: 1px solid #2a2a2a; background: #111; color: #f5c400; }
.text { background: none; border: 0; color: #f5c400; padding: 8px 0; }
.alone { display: block; margin: 18px auto 0; }
.body { display: flex; flex-direction: column; gap: 12px; }
.note { margin: 0; color: #fff; opacity: 0.72; line-height: 1.45; }
.empty { color: #fff; opacity: 0.55; text-align: center; margin-top: 28px; }
.card { width: 100%; text-align: start; background: #111; border: 1px solid #2a2a2a; border-radius: 16px; padding: 16px; }
.device { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.device strong, .device small { display: block; }
.device small { margin-top: 4px; opacity: 0.55; }
.device em { color: #f5c400; font-style: normal; font-weight: 700; }
.device em.ver { flex: none; max-width: 55%; font-size: 14px; text-align: end; overflow-wrap: anywhere; direction: ltr; }
.verkey { display: block; opacity: 0.55; }
.clkval { font-size: 26px; font-variant-numeric: tabular-nums; }
.verval { display: block; margin-top: 6px; color: #f5c400; overflow-wrap: anywhere; direction: ltr; unicode-bidi: isolate; }
.state { margin: 8px 0 0; font-size: 48px; line-height: 1; font-weight: 720; letter-spacing: -0.03em; }
.state.small { font-size: 28px; }
.fault { margin: 0; align-self: flex-start; padding: 6px 10px; border-radius: 999px; border: 1px solid #fff; color: #fff; }
.fault.on { background: #f5c400; color: #000; border-color: #f5c400; font-weight: 700; }
.times { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.times.three { grid-template-columns: 1fr 1fr 1fr; }
.times div, .clockbox, .linkbox { background: #111; border-radius: 16px; padding: 14px 16px; }
.times.three div { padding: 14px 8px; }
.times small, .clockbox small, .linkbox small { display: block; color: #f5c400; font-size: 12px; letter-spacing: 0.08em; }
.times strong { display: block; margin-top: 6px; font-size: 22px; font-variant-numeric: tabular-nums; }
.times.three strong { font-size: 16px; }
.clockbox { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
.clockbox b { font-weight: 650; font-size: 15px; text-align: end; font-variant-numeric: tabular-nums; }
[dir="rtl"] .field { direction: ltr; text-align: end; }
[dir="rtl"] .device small { direction: ltr; unicode-bidi: isolate; }
.linkbox { display: flex; flex-direction: column; gap: 6px; }
.linkbox strong { font-size: 16px; }
.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.cell { background: #111; border-radius: 16px; padding: 12px 8px; text-align: center; }
.cell b { display: block; color: #f5c400; font-size: 12px; letter-spacing: 0.12em; }
.cell strong { display: block; margin-top: 8px; font-size: 22px; }
.cell small { opacity: 0.55; }
.ocpp { margin: 0; }
.ocpp.off { opacity: 0.55; }
.ocpp.busy, .ocpp.on { color: #f5c400; }
.ocpp.on { font-weight: 700; }
.row { display: flex; justify-content: space-between; align-items: center; gap: 12px; background: #111; border-radius: 16px; padding: 14px 16px; }
.row strong, .row small { display: block; }
.row small { margin-top: 4px; opacity: 0.55; }
.row input { width: 22px; height: 22px; accent-color: #f5c400; }
.lte-form { display: flex; flex-direction: column; gap: 8px; }
.lte-form .verkey { margin-top: 4px; }
.lte-show { display: flex; align-items: center; gap: 8px; font-size: 13px; opacity: 0.75; }
.lte-show input { width: 18px; height: 18px; accent-color: #f5c400; }
select.field { font: inherit; color: inherit; -webkit-appearance: none; appearance: none; padding-inline-end: 40px; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='8'%3E%3Cpath d='M1 1l6 6 6-6' fill='none' stroke='%23f5c400' stroke-width='2'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 14px center; }
[dir="rtl"] select.field { background-position: left 14px center; }
select.field option { background: #111; color: #fff; }
.lte-stat { display: flex; flex-direction: column; padding: 6px 16px; }
.lte-stat p { margin: 0; padding: 10px 0; display: flex; justify-content: space-between; align-items: baseline; gap: 16px; border-bottom: 1px solid #222; }
.lte-stat p:last-child { border-bottom: 0; }
.lte-stat small { flex: none; opacity: 0.55; }
.lte-stat b { color: #f5c400; font-weight: 650; text-align: end; overflow-wrap: anywhere; direction: ltr; unicode-bidi: isolate; }
.zones { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; direction: ltr; }
.zone { border-radius: 12px; padding: 12px 2px; border: 1px solid #555; background: #000; color: #fff; font-size: 15px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.zone.on { background: #f5c400; color: #000; border-color: #f5c400; font-weight: 700; }
.zone.busy { border-color: #f5c400; }
.zone:disabled { opacity: 0.6; }
.zone.on:disabled { opacity: 1; }
.pair, .links { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.links { grid-template-columns: repeat(3, 1fr); }
.go, .ghost, .links button, .pair button { border-radius: 14px; padding: 14px 8px; border: 1px solid #f5c400; }
.go { background: #f5c400; color: #000; font-weight: 750; }
.ghost, .links button, .pair button { background: #000; color: #fff; }
.links button.go, .pair button.go { background: #f5c400; color: #000; }
.label { margin: 4px 0 0; color: #f5c400; font-size: 13px; }
.field { width: 100%; background: #111; border: 1px solid #333; border-radius: 14px; padding: 14px; outline: none; }
.field:focus { border-color: #f5c400; }
.file { display: none; }
.ota-progress { display: flex; flex-direction: column; gap: 8px; }
.ota-track { height: 10px; background: #222; border-radius: 999px; overflow: hidden; }
.ota-fill { height: 100%; background: #f5c400; border-radius: 999px; transition: width 0.2s linear; }
.ota-time { margin: 0; color: #f5c400; font-size: 22px; font-weight: 700; font-variant-numeric: tabular-nums; }
.profile-log { max-height: 280px; overflow: auto; background: #111; border-radius: 16px; padding: 12px 14px; display: flex; flex-direction: column; gap: 6px; }
.profile-log p { margin: 0; line-height: 1.4; }
.profile-log .ok { color: #f5c400; }
.profile-log .bad { color: #fff; }
.profile-log .run { opacity: 0.72; }
</style>
