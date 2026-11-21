<script setup>
import { computed } from "vue";
import { policyOf } from "./policy-extra.js";
const props = defineProps({ lang: { type: String, default: "en" } });
const extra = computed(() => policyOf(props.lang));
</script>

<template>
  <article v-if="lang === 'zh'" class="policy">
    <h1>EVCITY AC 隐私协议</h1>
    <p class="lead">说明安卓应用 EVCITY AC 如何处理信息。</p>
    <p class="meta">生效日期：2026 年 10 月 23 日</p>
    <p class="meta">最近更新：2026 年 10 月 23 日</p>
    <p class="meta">包名：com.evcity.acv2 · 运营者：EVCITY</p>
    <p>EVCITY（“我们”）运营安卓应用 EVCITY AC，包名 com.evcity.acv2（“本应用”）。本协议说明本应用处理哪些信息、为什么处理、保存多久，以及你如何行使权利。</p>
    <p>使用本应用前请阅读本协议。安装或使用即表示你已阅读并理解本协议。若不同意，请勿使用并卸载本应用。</p>
    <p>本协议提供中文和英文，两种文本含义相同。用词差异造成歧义时，中华人民共和国境内用户以中文为准，其他地区用户以英文为准。</p>
    <h2>摘要</h2>
    <ul>
      <li>EVCITY AC 是充电控制工具。它通过蓝牙或无线局域网搜索附近的充电设备，连接你选择的设备，启动或停止充电，并显示充电状态、电流和电压。</li>
      <li>这些功能在你的手机和充电设备之间本地完成。本版本不需要账号，不为该功能建立远程个人数据库，也不出售个人信息。</li>
      <li>本版本不集成第三方广告 SDK、第三方统计 SDK 或社交登录 SDK。</li>
      <li>在部分安卓版本上，搜索附近的蓝牙或无线局域网设备需要位置权限或“附近的 Wi-Fi 设备”权限。该权限只用于发现充电设备，不用于跟踪你的行动，本应用也不记录经纬度轨迹。</li>
      <li>你可以在系统设置中关闭相关权限，或清除本应用数据、卸载本应用，以删除保存在手机上的数据。</li>
      <li>隐私联系邮箱：xfj202309@gmail.com。</li>
    </ul>
    <h2>1. 适用范围</h2>
    <p>本协议适用于我们通过本应用提供的下列功能：蓝牙搜索附近充电设备；无线局域网搜索附近充电设备；连接你选择的充电设备，并在你要求时启动或停止充电；查看充电状态、电流、电压等运行数据。</p>
    <p>本协议不覆盖充电设备固件、场地运营方、应用商店、手机制造商或操作系统厂商、电子邮件服务商的独立处理。那些处理适用他们自己的说明或隐私政策。</p>
    <h2>2. 我们处理的信息</h2>
    <p>本应用是工具。除你主动给我们发邮件外，充电控制不需要你的姓名、电话号码或身份证件号码。</p>
    <h3>2.1 用于发现和连接充电设备的信息</h3>
    <p>当你搜索、连接或控制充电时，本应用在你的设备上处理完成该操作所需的信息：充电桩蓝牙数据（名称、地址、信号强度）；充电桩无线局域网数据（热点或本地网络标识、信号强度、本地网络地址）；充电测量值（状态、电流、电压）；你发起的启动和停止命令；当前连接的设备、链路是否接通，以及界面需要显示的数值。</p>
    <p>充电桩的蓝牙地址、网络标识、电流和电压是设备运行数据。这些数据在你的手机上时，可能与使用手机的人相关联。我们按本协议保护应用内保存的会话数据。我们不用它识别你的真实姓名，也不把它用于广告或画像。</p>
    <h3>2.2 仅用于搜索附近设备的位置相关权限</h3>
    <p>在部分版本上，安卓要求应用先获得位置权限或“附近的 Wi-Fi 设备”权限，才能扫描低功耗蓝牙或无线局域网设备。这是操作系统的限制，并不表示本应用需要知道你在哪里。</p>
    <ul>
      <li>只在你使用“搜索附近充电设备”时申请相应权限。</li>
      <li>不调用定位接口记录你的经纬度。</li>
      <li>不记录或上传行动轨迹或常去地点。</li>
      <li>不申请后台位置权限 ACCESS_BACKGROUND_LOCATION。</li>
      <li>不在你没有使用搜索时于后台持续扫描以跟踪位置。</li>
    </ul>
    <p>精确位置属于中华人民共和国法律下的敏感个人信息。本应用不收集精确位置。申请位置权限只是因为系统把附近设备扫描和该权限绑在一起，是否允许由你在系统对话框中决定。</p>
    <h3>2.3 你联系我们时提供的信息</h3>
    <p>如果你发邮件到 xfj202309@gmail.com，我们会收到你的邮箱地址、主题、正文，以及你选择附上的说明或截图。我们用这些信息理解问题、回复，并保留该请求的记录。</p>
    <h3>2.4 本版本不收集的信息</h3>
    <p>本版本没有用户注册，也不收集你的姓名、电话号码、身份证号、通讯录、短信、照片、日历、麦克风音频、摄像头图像、支付账户、银行卡号、广告标识画像、精确地理位置或位置轨迹。</p>
    <p>请不要通过电子邮件向我们发送身份证件、银行卡或密码。如果误发，请发邮件要求我们删除。</p>
    <h3>2.5 设备上的本地缓存</h3>
    <p>本应用可能在其私有存储中保留当前功能所需的缓存，例如你上次连接的充电设备标识，以及界面显示的会话数值。该缓存留在你的设备上，不上传到我们的服务器。清除应用数据或卸载应用即删除它。</p>
    <h2>3. 系统权限</h2>
    <p>本应用只申请与你正在使用的功能相关的权限。你安装的版本实际弹出的权限对话框为准。</p>
    <p><b>蓝牙。</b> BLUETOOTH、较旧安卓上的 BLUETOOTH_ADMIN、BLUETOOTH_SCAN、BLUETOOTH_CONNECT。用于通过蓝牙控制充电桩：搜索、连接、发送启动或停止，并读取状态、电流和电压。</p>
    <p><b>位置。</b> ACCESS_FINE_LOCATION、ACCESS_COARSE_LOCATION。仅在不授予位置权限就无法搜索附近设备的安卓版本上需要。只用于满足该系统限制，不用于定位或轨迹。</p>
    <p><b>附近的 Wi-Fi 设备。</b> NEARBY_WIFI_DEVICES。在适用的安卓版本上用于通过无线局域网发现设备，不用于推断你的地理位置。</p>
    <p><b>网络和无线局域网状态。</b> INTERNET、ACCESS_NETWORK_STATE、ACCESS_WIFI_STATE、CHANGE_WIFI_STATE。用于加入充电设备所在网络，并与该设备交换命令和运行数据。</p>
    <p>你可以拒绝某项权限，也可以稍后在安卓设置中撤回。拒绝或撤回后，依赖它的功能无法使用，不依赖它的功能仍然可用。</p>
    <p>如果系统在连接期间要求前台服务或常驻通知，该通知只用于维持与充电设备的链路并显示充电状态，不额外收集个人信息。</p>
    <h2>4. 我们如何使用信息</h2>
    <p>我们以合法、正当、必要和最小化的方式使用信息，且只用于：搜索、识别并列出附近充电设备；与你选择的设备建立蓝牙或无线局域网连接；在你指示时启动或停止充电；在应用中显示充电状态、电流和电压；在你使用期间维持连接和界面会话；作为普通连接处理的一部分判断设备是否仍在通信范围内；回复你的邮件并处理你提出的权利请求或投诉。</p>
    <p>我们不把这些信息用于自动营销，不用于评估你的信用或保险资格，也不出售给第三方。</p>
    <h2>5. 法律依据</h2>
    <ul>
      <li><b>你要求的步骤。</b> 搜索、连接、启动或停止充电，以及显示电流、电压和状态。</li>
      <li><b>你的同意。</b> 你在系统对话框中允许或拒绝蓝牙、位置或附近设备权限。你可以随时撤回同意。</li>
      <li><b>法律义务。</b> 法律规定，或主管机关通过合法程序提出的要求。</li>
    </ul>
    <h2>6. 信息存放在哪里、保存多久</h2>
    <p><b>搜索结果、连接状态、电流、电压和启动/停止命令</b>保存在你的设备上，以及你选择连接的充电设备上，保存期限为该次使用期间。清除应用数据或卸载应用时，本地缓存被删除。</p>
    <p><b>你发给我们的邮件</b>保存在邮箱 xfj202309@gmail.com 及相关邮件服务中，保存到答复你或处理投诉、争议所需的时间，并且无论如何不超过 3 年。之后我们删除或去标识化。只有法律要求时才保存更久。</p>
    <p>我们不为搜索、连接或查看充电数据运营远程个人数据库，也不把这些数据上传到我们的服务器。</p>
    <p>你连接的充电设备可能按其固件和场地运营方的规则保留该次会话记录。设备上的存储由该设备和其运营方控制，不受本协议约束。</p>
    <h2>7. 处理者、共享、转移和公开披露</h2>
    <p>我们不出售你的个人信息。除下列情形外，我们不与第三方共享：与你选择的充电设备通信；你另行同意；法律、诉讼、仲裁或主管机关的合法要求；为保护你、我们或其他人的生命、财产或其他重要合法权益且法律允许时合理必要。</p>
    <p>本版本不集成第三方广告 SDK、第三方统计 SDK 或社交登录 SDK。蓝牙、无线局域网和网络由安卓操作系统提供。</p>
    <p>发往 xfj202309@gmail.com 的邮件由电子邮件服务商传输和存储，适用该服务商的条款和隐私政策。</p>
    <p>如果我们发生合并、分立、资产转让或类似交易，我们将要求接收方继续受本协议约束。如果接收方改变处理目的或方式，我们将在法律要求时再次取得你的同意。</p>
    <p>除法律授权或你另行同意外，我们不公开披露你的个人信息。</p>
    <h2>8. 跨境传输</h2>
    <p>在本版本的日常使用中，我们不把搜索、连接、启动/停止或运行数据上传到你所在国家或地区以外的服务器。</p>
    <p>当你给我们发邮件时，邮件可能在电子邮件服务商的基础设施上处理，该基础设施可能位于你所在国家或地区以外。请同时阅读该服务商的隐私政策。</p>
    <p>如果以后需要向你所在国家或地区以外提供个人信息，我们将按法律要求告知，并在法律要求时取得你的单独同意，或完成安全评估、标准合同等法定机制。</p>
    <h2>9. 你的权利</h2>
    <p>在适用法律赋予这些权利时，你可以知情并访问我们处理的关于你的个人信息，获取副本，更正或补全不准确或不完整的信息，在法律允许时删除，通过关闭安卓中的蓝牙、位置、附近 Wi-Fi 设备或无线局域网权限撤回同意，要求解释本协议，在法律提供且技术可行时要求可携带，并向有管辖权的数据保护机构投诉。</p>
    <p>本应用没有账号体系。充电数据在你的设备和你连接的充电设备上。要行使权利或提问，请发邮件至 xfj202309@gmail.com，并写明应用名称 EVCITY AC 和包名 com.evcity.acv2。</p>
    <p>为防止他人冒用你的名义提出请求，我们可能要求提供合理所需的信息以核实请求。核实后我们将在 15 个工作日内回复。如果请求明显重复、技术上无法实现，或属于法律允许我们拒绝的情形，我们将说明原因。</p>
    <p>撤回同意或关闭权限，不会撤销此前基于你的同意已经完成的处理。相关功能会因此停止工作。</p>
    <h2>10. 儿童</h2>
    <p>本应用用于控制充电设备，面向具有相应民事行为能力的人。我们不以 14 周岁以下儿童为对象，也不会故意收集他们的个人信息。</p>
    <p>如果你是家长或监护人，并认为儿童在未经你同意的情况下向我们提供了个人信息，请发邮件至 xfj202309@gmail.com。核实后我们将删除该信息。</p>
    <h2>11. 安全</h2>
    <ul>
      <li>本地缓存保存在本应用的私有存储中，其他应用不能随意读取。</li>
      <li>本应用只申请功能所需的权限。</li>
      <li>我们不建立用于出售、广告或画像的个人信息库。</li>
      <li>支持邮箱仅在答复你时按需访问。</li>
    </ul>
    <p>请保管好设备锁屏。通过蓝牙或无线局域网控制充电设备前，请确认你有权操作该设备。没有任何传输或存储方式是绝对安全的。如果发生可能影响你权利的个人信息安全事件，我们将依法通知你并采取补救措施。</p>
    <h2>12. 本协议的变更</h2>
    <p>当本应用功能变化，或法律、应用商店规则变化时，我们可能更新本协议。更新后的文本会发布在本页、本应用内，或应用商店列出的隐私协议链接处，并修改文首日期。</p>
    <p>如果变更实质性减损你的权利、扩大我们收集的范围，或改变处理目的，我们将以合理方式另行通知，例如应用内提示。法律要求重新同意时，我们会征求同意。</p>
    <p>更新生效后你继续使用本应用，即表示你已阅读更新后的协议。若不同意，请停止使用并卸载。</p>
    <h2>13. 部分地区的补充说明</h2>
    <p><b>中华人民共和国。</b>我们依照《个人信息保护法》《网络安全法》《数据安全法》及其他适用规则处理个人信息。你可以向履行个人信息保护职责的部门投诉或举报。</p>
    <p><b>欧洲经济区和英国。</b>在那些法律适用时，你还有权访问、更正、删除、限制和携带个人数据，反对处理，并向监管机构投诉。执行你所要求的充电控制，依据是按你的要求采取步骤。权限授予依据你的同意，你可以随时撤回。</p>
    <p><b>加利福尼亚州及类似的美国州法。</b>我们不出售个人信息，也不为跨场景行为广告而共享。本版本处理的类别限于附近充电设备的设备和网络标识、你选择发给我们的邮件，以及仅为使系统允许搜索附近设备而使用的位置相关权限。我们不处理财务信息，也不记录精确位置轨迹。</p>
    <h2>14. 联系我们</h2>
    <ul>
      <li>运营者：EVCITY</li>
      <li>应用名称：EVCITY AC</li>
      <li>包名：com.evcity.acv2</li>
      <li>邮箱：xfj202309@gmail.com</li>
    </ul>
    <p>如果你对本协议或我们对个人信息的处理有问题、意见、投诉或权利请求，请按上述地址发邮件。请写明应用名称和包名，以便我们对应你的请求。</p>
    <p class="meta">EVCITY AC 隐私协议 · 2026 年 10 月 23 日生效 · com.evcity.acv2</p>
  </article>
  <article v-else-if="extra" class="policy">
    <h1>{{ extra.title }}</h1>
    <p class="lead">{{ extra.lead }}</p>
    <p v-for="(line, i) in extra.meta" :key="'m' + i" class="meta">{{ line }}</p>
    <p v-for="(line, i) in extra.intro" :key="'i' + i">{{ line }}</p>
    <section v-for="(section, si) in extra.sections" :key="si">
      <h2>{{ section.h }}</h2>
      <h3 v-if="section.h3">{{ section.h3 }}</h3>
      <p v-for="(line, pi) in section.ps" :key="si + '-' + pi">{{ line }}</p>
      <ul v-if="section.ul">
        <li v-for="(item, li) in section.ul" :key="si + 'l' + li">{{ item }}</li>
      </ul>
    </section>
  </article>
  <article v-else class="policy">
    <h1>EVCITY AC Privacy Policy</h1>
    <p class="lead">How the Android app EVCITY AC handles information.</p>
    <p class="meta">Effective date: October 23, 2026</p>
    <p class="meta">Last updated: October 23, 2026</p>
    <p class="meta">Package: com.evcity.acv2 · Operator: EVCITY</p>

    <p>EVCITY ("we", "us", or "our") operates the Android app EVCITY AC, package name com.evcity.acv2 (the "App"). This policy explains what information the App processes, why it is processed, how long it is kept, and how you can exercise your rights.</p>
    <p>Please read this policy before you use the App. By installing or using the App, you acknowledge that you have read and understood this policy. If you do not agree with it, do not use the App and uninstall it.</p>
    <p>This policy is provided in Chinese and English. Both versions have the same meaning. If a difference in wording creates ambiguity, the Chinese version prevails for users in the mainland of the People's Republic of China, and the English version prevails for users elsewhere.</p>

    <h2>Summary</h2>
    <ul>
      <li>EVCITY AC is a charger-control tool. It scans for nearby charging equipment over Bluetooth or WLAN, connects to the equipment you select, starts or stops charging, and shows charging status, current, and voltage.</li>
      <li>Those features run locally between your phone and the charging equipment. This version does not require an account, does not keep a remote personal database for this function, and does not sell personal information.</li>
      <li>This version does not integrate third-party advertising SDKs, third-party analytics SDKs, or social-login SDKs.</li>
      <li>On some Android versions, scanning for nearby Bluetooth or WLAN devices requires location permission or the "nearby Wi-Fi devices" permission. That permission is used only to discover charging equipment. It is not used to track your movements, and the App does not record a latitude/longitude trail.</li>
      <li>You can turn the related permissions off in system settings, or clear the App's data or uninstall it, to remove data stored on the phone.</li>
      <li>Privacy contact: xfj202309@gmail.com.</li>
    </ul>

    <h2>1. Scope</h2>
    <p>This policy applies to the following features we provide through the App:</p>
    <ol>
      <li>Scanning for nearby charging equipment over Bluetooth.</li>
      <li>Scanning for nearby charging equipment over WLAN.</li>
      <li>Connecting to the charging equipment you select, and starting or stopping charging when you ask the App to do so.</li>
      <li>Viewing operating data such as charging status, current, and voltage.</li>
    </ol>
    <p>This policy does not cover independent processing by charging-equipment firmware, site operators, app stores, handset or operating-system vendors, or email service providers. Their own notices or privacy policies apply to that processing.</p>

    <h2>2. Information we process</h2>
    <p>The App is a utility. Except when you email us, charging control does not require your name, phone number, or government identification number.</p>
    <h3>2.1 Information used to discover and connect to charging equipment</h3>
    <p>When you scan, connect, or control charging, the App processes on your device the information needed for that operation:</p>
    <p><b>Charger Bluetooth data.</b> Device name, Bluetooth address, signal strength. Used to discover, tell apart, and connect to nearby charging equipment.</p>
    <p><b>Charger WLAN data.</b> Hotspot or local-network identifier, signal strength, local network address. Used to discover charging equipment and communicate with it on the local network.</p>
    <p><b>Charging measurements.</b> Charging status, current, voltage. Used to show you the current charging session.</p>
    <p><b>Control commands.</b> Start and stop actions you initiate. Sent to the charging equipment you selected.</p>
    <p><b>Session data.</b> The equipment currently connected, whether the link is up, and values the screen needs to display. Used to keep the operation you started working.</p>
    <p>A charger's Bluetooth address, network identifier, current, and voltage are equipment operating data. When that data is on your phone, it can be associated with the person using the phone. We protect session data stored in the App under this policy. We do not use it to identify you by your real name, and we do not use it for advertising or profiling.</p>
    <h3>2.2 Location-related permission used only for nearby-device scanning</h3>
    <p>On some versions, Android requires an app to hold location permission, or the "nearby Wi-Fi devices" permission, before it can scan for Bluetooth Low Energy devices or WLAN devices. That is an operating-system restriction. It does not mean the App needs to know where you are.</p>
    <ul>
      <li>It requests the relevant permission only when you use "scan for nearby charging equipment".</li>
      <li>It does not call location APIs to record your latitude and longitude.</li>
      <li>It does not record or upload a movement trail or a list of places you frequent.</li>
      <li>It does not request background location (ACCESS_BACKGROUND_LOCATION).</li>
      <li>It does not keep scanning in the background to track your location while you are not using scan.</li>
    </ul>
    <p>Precise location is sensitive personal information under the laws of the People's Republic of China. The App does not collect precise location. Location permission is requested only because the system ties nearby-device scanning to that permission, and you decide whether to allow it in the system dialog.</p>
    <h3>2.3 Information you provide when you contact us</h3>
    <p>If you email xfj202309@gmail.com, we receive your email address, subject, message, and anything you choose to attach, such as a description or a screenshot. We use that information to understand the issue, reply, and keep a record of the request.</p>
    <h3>2.4 Information this version does not collect</h3>
    <p>This version has no user registration, and it does not collect your name, phone number, national identification number, contacts, SMS messages, photos, calendar, microphone audio, camera images, payment accounts, bank card numbers, advertising-identifier profiles, precise geolocation, or a location trail.</p>
    <p>Do not send us identification documents, bank cards, or passwords by email. If you sent them by mistake, email us and ask us to delete them.</p>
    <h3>2.5 Local cache on your device</h3>
    <p>The App may keep, in its private storage, a cache required for the feature you are using, such as the identifier of the charging equipment you last connected to and the session values the screen displays. That cache stays on your device. It is not uploaded to our servers. Clearing the App's data or uninstalling the App deletes it.</p>

    <h2>3. System permissions</h2>
    <p>The App requests only permissions related to the feature you are using. The permission dialogs shown by the version you installed control.</p>
    <p><b>Bluetooth.</b> BLUETOOTH, BLUETOOTH_ADMIN on older Android, BLUETOOTH_SCAN, and BLUETOOTH_CONNECT. Required to control a charger over Bluetooth: scan, connect, send start or stop, and read status, current, and voltage.</p>
    <p><b>Location.</b> ACCESS_FINE_LOCATION and ACCESS_COARSE_LOCATION. Required only on Android versions that will not scan for nearby devices until location is allowed. Used only to satisfy that system restriction, not for positioning or a location trail.</p>
    <p><b>Nearby Wi-Fi devices.</b> NEARBY_WIFI_DEVICES. Required on applicable Android versions to discover equipment over WLAN. Not used to infer your geographic location.</p>
    <p><b>Network and WLAN state.</b> INTERNET, ACCESS_NETWORK_STATE, ACCESS_WIFI_STATE, and CHANGE_WIFI_STATE. Required to join the network used by the charging equipment and exchange commands and operating data.</p>
    <p>You may deny a permission, and you may withdraw it later in Android settings. After you deny or withdraw it, features that depend on it will not work. Features that do not depend on it remain available.</p>
    <p>If the system requires a foreground service or an ongoing notification while a connection is active, that notification only keeps the link to the charging equipment and shows charging status. It does not collect additional personal information.</p>

    <h2>4. How we use information</h2>
    <p>We use information in a lawful, fair, necessary, and limited way, and only to scan for and list nearby charging equipment, open a Bluetooth or WLAN connection to the equipment you select, start or stop charging when you tell the App to do so, display charging status, current, and voltage, keep that session going, tell whether the equipment is still in range, and reply to your email or a rights request.</p>
    <p>We do not use this information for automated marketing. We do not use it to score your credit or insurance eligibility. We do not sell it to third parties.</p>

    <h2>5. Legal bases</h2>
    <ul>
      <li><b>Steps you request.</b> Scanning, connecting, starting or stopping a charge, and showing current, voltage, and status.</li>
      <li><b>Your consent.</b> You allow or deny Bluetooth, location, or nearby-device permission in the system dialog. You may withdraw consent at any time.</li>
      <li><b>Legal duty.</b> A requirement of law, or a request from a competent authority made through a lawful process.</li>
    </ul>

    <h2>6. Where information is stored and for how long</h2>
    <p><b>Scan results, connection state, current, voltage, and start/stop commands</b> stay on your device and on the charging equipment you chose to connect to, for that period of use. The local cache is deleted when you clear the App's data or uninstall the App.</p>
    <p><b>Email you send us</b> is kept in the mailbox xfj202309@gmail.com and the related email service for as long as needed to answer you or to handle a complaint or dispute, and in any event no longer than 3 years. We then delete it or de-identify it. A longer period applies only where the law requires one.</p>
    <p>We do not operate a remote personal database for scanning, connecting, or viewing charging data, and we do not upload that data to our servers.</p>
    <p>The charging equipment you connect to may keep a record of the session under its firmware and under the site operator's rules. Storage on the equipment is controlled by that equipment and its operator, not by this policy.</p>

    <h2>7. Processors, sharing, transfers, and public disclosure</h2>
    <p>We do not sell your personal information. We do not share it with third parties except to communicate with the charging equipment you select, with your separate consent, where the law requires it, or where reasonably necessary to protect life, property, or other important lawful interests and the law allows it.</p>
    <p>This version does not integrate third-party advertising SDKs, third-party analytics SDKs, or social-login SDKs. Bluetooth, WLAN, and networking are provided by the Android operating system.</p>
    <p>Email sent to xfj202309@gmail.com is transmitted and stored by the email service provider, under that provider's terms and privacy policy.</p>
    <p>If we are involved in a merger, division, asset transfer, or similar transaction, we will require the recipient to remain bound by this policy. If the recipient changes the purpose or the means of processing, we will obtain your consent again where the law requires it.</p>
    <p>We do not publicly disclose your personal information, except where the law authorizes it or you have given separate consent.</p>

    <h2>8. Cross-border transfers</h2>
    <p>In ordinary use of this version, we do not upload scan, connection, start/stop, or operating data to servers outside your country or region.</p>
    <p>When you email us, the message may be processed on the email provider's infrastructure, which may be outside your country or region. Please also read that provider's privacy policy.</p>
    <p>If we later need to provide personal information outside your country or region, we will give the notice the law requires and, where the law requires it, obtain your separate consent or complete a legally required mechanism such as a security assessment or standard contractual clauses.</p>

    <h2>9. Your rights</h2>
    <p>Where applicable law gives you these rights, you may be informed of and access personal information we process about you, receive a copy, correct or complete it, delete it where the law allows, withdraw consent by turning off the related Android permission, ask for an explanation of this policy, request portability where the law provides it, and complain to the data-protection authority that has jurisdiction.</p>
    <p>The App has no account system. Charging data resides on your device and on the charging equipment you connect to. To exercise a right or ask a question, email xfj202309@gmail.com and include the app name EVCITY AC and the package name com.evcity.acv2.</p>
    <p>To prevent someone else from making a request in your name, we may ask for information reasonably needed to confirm the request. We will reply within 15 business days after we have verified it. If a request is manifestly repetitive, technically impossible, or one the law allows us to decline, we will explain why.</p>
    <p>Withdrawing consent or turning off a permission does not undo processing that was already carried out on the basis of your consent. It does mean the related feature will stop working.</p>

    <h2>10. Children</h2>
    <p>The App controls charging equipment and is intended for people who have the legal capacity to use it. We do not direct the App to children under 14 years of age, and we do not knowingly collect personal information from them.</p>
    <p>If you are a parent or guardian and you believe a child has provided personal information to us without your consent, email xfj202309@gmail.com. After we verify the report, we will delete the information.</p>

    <h2>11. Security</h2>
    <ul>
      <li>Local cache is kept in the App's private storage, which other apps cannot freely read.</li>
      <li>The App requests only the permissions the feature needs.</li>
      <li>We do not build a personal-information store for sale, advertising, or profiling.</li>
      <li>Support email is accessed only as needed to answer you.</li>
    </ul>
    <p>Keep your device lock secure. Before you control charging equipment over Bluetooth or WLAN, confirm that you are allowed to operate that equipment. No method of transmission or storage is completely secure. If a personal-information security incident occurs that may affect your rights, we will notify you and take remedial steps as required by law.</p>

    <h2>12. Changes to this policy</h2>
    <p>We may update this policy when the App's features change, or when the law or an app-store rule changes. The updated text will be posted on this page, in the App, or at the privacy-policy link listed on the app store, and we will change the dates at the top.</p>
    <p>If a change materially reduces your rights, expands what we collect, or changes the purpose of processing, we will give you an additional notice by a reasonable means, such as an in-app notice. Where the law requires fresh consent, we will ask for it.</p>
    <p>If you keep using the App after the update takes effect, you have read the updated policy. If you do not agree with it, stop using the App and uninstall it.</p>

    <h2>13. Additional information for certain regions</h2>
    <p><b>People's Republic of China.</b> We process personal information in accordance with the Personal Information Protection Law, the Cybersecurity Law, the Data Security Law, and other applicable rules. You may complain or report to the authority that performs personal-information protection duties.</p>
    <p><b>European Economic Area and the United Kingdom.</b> Where those laws apply, you also have the right to access, rectify, erase, restrict, and port personal data, to object to processing, and to lodge a complaint with a supervisory authority. Processing that carries out the charging control you request is based on taking steps at your request. Permission grants are based on your consent, which you may withdraw at any time.</p>
    <p><b>California and similar U.S. state laws.</b> We do not sell personal information, and we do not share it for cross-context behavioral advertising. The categories this version processes are limited to device and network identifiers of nearby charging equipment, email you choose to send us, and access to a location-related permission solely so the system will allow a nearby-device scan. We do not process financial information, and we do not record a precise location trail.</p>

    <h2>14. Contact us</h2>
    <ul>
      <li>Operator: EVCITY</li>
      <li>App name: EVCITY AC</li>
      <li>Package name: com.evcity.acv2</li>
      <li>Email: xfj202309@gmail.com</li>
    </ul>
    <p>If you have a question, comment, complaint, or rights request about this policy or about our processing of personal information, email us at the address above. Please include the app name and package name so we can match your request.</p>
    <p class="meta">EVCITY AC Privacy Policy · Effective October 23, 2026 · com.evcity.acv2</p>
  </article>
</template>

<style scoped>
.policy { background: #f4f6f8; color: #1c2430; border-radius: 16px; padding: 18px 16px 28px; }
.policy h1 { margin: 0 0 8px; font-size: 26px; line-height: 1.25; }
.policy h2 { margin: 28px 0 8px; font-size: 18px; }
.policy h3 { margin: 18px 0 6px; font-size: 16px; }
.policy p, .policy li { font-size: 15px; line-height: 1.65; }
.lead { margin-top: 0; color: #5c6775; }
.meta { color: #5c6775; font-size: 13px; }
</style>
