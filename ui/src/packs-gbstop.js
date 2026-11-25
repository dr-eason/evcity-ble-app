/* 「新国标6秒停充」用到的字符串，12 种语言放在一处（中文是键，不用翻）。i18n.js 把它们并进
 * 各语言的表里。键和 App.vue、profile.js 一致，test/gbstop.test.mjs 核对每种语言都齐。 */
const KEYS = [
  "新国标6秒停充",
  "停止时先通知车辆，最多等 6 秒再断开",
  "开启新国标6秒停充",
  "打开后，停止充电时充电桩先通知车辆，等车辆停止取电再断开继电器，最多等 6 秒；车辆提前停下来就提前断开。关闭时（默认）一停止就立即断开。出现安全故障或拔枪时始终立即断开。断电后仍然有效。",
  "等待车端关闭，请勿重复点击停止",
  "充电桩没有应答。充电桩固件可能还不支持这个设置，需要升级后再设置",
];

const TEXT = {
  en: [
    "GB 6-second stop",
    "On stop, signal the vehicle and wait up to 6 s before opening",
    "Enable GB 6-second stop",
    "When on, the charger first signals the vehicle to stop, waits for it to stop drawing power and then opens the relay, after 6 seconds at most; if the vehicle stops sooner, the relay opens sooner. When off (default), the relay opens as soon as charging is stopped. On a safety fault or when unplugged it always opens at once. Kept across power loss.",
    "Waiting for the vehicle to stop. Do not tap Stop again",
    "No reply from the charger. Its firmware may not support this setting yet. Update it, then try again",
  ],
  fr: [
    "Arrêt GB en 6 secondes",
    "À l’arrêt, prévenir le véhicule et attendre jusqu’à 6 s avant de couper",
    "Activer l’arrêt GB en 6 secondes",
    "Si activé, la borne prévient d’abord le véhicule, attend qu’il cesse de tirer du courant puis ouvre le relais, au bout de 6 secondes au plus ; si le véhicule s’arrête plus tôt, le relais s’ouvre plus tôt. Si désactivé (par défaut), le relais s’ouvre dès l’arrêt de la charge. En cas de défaut de sécurité ou de débranchement, il s’ouvre toujours immédiatement. Conservé après une coupure de courant.",
    "En attente de l’arrêt du véhicule. Ne touchez plus Arrêter",
    "Pas de réponse de la borne. Son micrologiciel ne gère peut-être pas encore ce réglage. Mettez-le à jour, puis réessayez",
  ],
  ja: [
    "新国標 6 秒停止",
    "停止時に車両へ通知し、最長 6 秒待ってから遮断します",
    "新国標 6 秒停止を有効にする",
    "オンにすると、充電停止時に充電器はまず車両へ通知し、車両が電力の取り出しをやめるのを待ってからリレーを開きます（最長 6 秒）。車両が早く止まれば、その時点で開きます。オフ（既定）では、停止するとすぐにリレーを開きます。安全異常やプラグを抜いた場合は常にすぐ開きます。電源を切っても残ります。",
    "車両側の停止を待っています。停止を繰り返しタップしないでください",
    "充電器から応答がありません。ファームウェアがこの設定にまだ対応していない可能性があります。アップデートしてから設定してください",
  ],
  de: [
    "GB-Stopp in 6 Sekunden",
    "Beim Stopp das Fahrzeug benachrichtigen und bis zu 6 s warten",
    "GB-Stopp in 6 Sekunden aktivieren",
    "Wenn eingeschaltet, signalisiert das Ladegerät beim Stoppen zuerst dem Fahrzeug, wartet, bis es keinen Strom mehr zieht, und öffnet dann das Relais, spätestens nach 6 Sekunden; stoppt das Fahrzeug früher, öffnet das Relais früher. Wenn ausgeschaltet (Standard), öffnet das Relais sofort beim Stoppen. Bei einem Sicherheitsfehler oder beim Abziehen öffnet es immer sofort. Bleibt nach Stromausfall erhalten.",
    "Warten, bis das Fahrzeug stoppt. Bitte nicht erneut auf Stopp tippen",
    "Keine Antwort vom Ladegerät. Die Firmware unterstützt diese Einstellung vielleicht noch nicht. Bitte aktualisieren und erneut versuchen",
  ],
  es: [
    "Parada GB en 6 segundos",
    "Al detener, avisar al vehículo y esperar hasta 6 s antes de cortar",
    "Activar la parada GB en 6 segundos",
    "Si está activado, al detener la carga el cargador avisa primero al vehículo, espera a que deje de consumir y luego abre el relé, como máximo a los 6 segundos; si el vehículo se detiene antes, el relé se abre antes. Si está desactivado (por defecto), el relé se abre en cuanto se detiene la carga. Ante un fallo de seguridad o al desenchufar, siempre se abre de inmediato. Se conserva tras un corte de corriente.",
    "Esperando a que el vehículo se detenga. No vuelva a tocar Detener",
    "El cargador no responde. Puede que su firmware aún no admita este ajuste. Actualícelo y vuelva a intentarlo",
  ],
  pt: [
    "Paragem GB em 6 segundos",
    "Ao parar, avisar o veículo e esperar até 6 s antes de cortar",
    "Ativar a paragem GB em 6 segundos",
    "Se ativado, ao parar o carregamento o carregador avisa primeiro o veículo, espera que deixe de consumir e só depois abre o relé, no máximo ao fim de 6 segundos; se o veículo parar antes, o relé abre antes. Se desativado (predefinição), o relé abre logo que o carregamento é parado. Em caso de falha de segurança ou ao desligar a ficha, abre sempre de imediato. Mantém-se após falta de energia.",
    "A aguardar que o veículo pare. Não toque em Parar novamente",
    "O carregador não responde. O firmware pode ainda não suportar esta definição. Atualize-o e tente novamente",
  ],
  ru: [
    "Остановка GB за 6 секунд",
    "При остановке уведомить автомобиль и ждать до 6 с перед отключением",
    "Включить остановку GB за 6 секунд",
    "Если включено, при остановке зарядки станция сначала подаёт сигнал автомобилю, ждёт, пока он перестанет потреблять ток, и затем размыкает реле — не позже чем через 6 секунд; если автомобиль остановится раньше, реле разомкнётся раньше. Если выключено (по умолчанию), реле размыкается сразу при остановке. При аварии безопасности или отключении разъёма реле всегда размыкается немедленно. Сохраняется после отключения питания.",
    "Ожидание остановки автомобиля. Не нажимайте «Стоп» повторно",
    "Станция не отвечает. Возможно, её прошивка ещё не поддерживает эту настройку. Обновите её и повторите попытку",
  ],
  hi: [
    "GB 6-सेकंड स्टॉप",
    "रोकते समय वाहन को सूचित करें और काटने से पहले 6 सेकंड तक प्रतीक्षा करें",
    "GB 6-सेकंड स्टॉप चालू करें",
    "चालू होने पर, चार्जिंग रोकते समय चार्जर पहले वाहन को संकेत देता है, उसके बिजली लेना बंद करने की प्रतीक्षा करता है और फिर रिले खोलता है, अधिकतम 6 सेकंड में; वाहन पहले रुक जाए तो रिले पहले खुल जाता है। बंद होने पर (डिफ़ॉल्ट), रोकते ही रिले तुरंत खुल जाता है। सुरक्षा दोष होने या प्लग निकालने पर यह हमेशा तुरंत खुलता है। बिजली जाने के बाद भी बना रहता है।",
    "वाहन के रुकने की प्रतीक्षा है। रोकें को दोबारा न दबाएँ",
    "चार्जर से कोई उत्तर नहीं मिला। हो सकता है इसका फ़र्मवेयर अभी इस सेटिंग का समर्थन न करता हो। इसे अपडेट करके फिर प्रयास करें",
  ],
  ar: [
    "إيقاف GB خلال 6 ثوانٍ",
    "عند الإيقاف، إشعار المركبة والانتظار حتى 6 ثوانٍ قبل الفصل",
    "تفعيل إيقاف GB خلال 6 ثوانٍ",
    "عند التفعيل، يُشعر الشاحن المركبة أولاً عند إيقاف الشحن، وينتظر حتى تتوقف عن سحب التيار ثم يفتح المرحّل، خلال 6 ثوانٍ على الأكثر؛ وإذا توقفت المركبة قبل ذلك يُفتح المرحّل قبل ذلك. عند الإيقاف (الافتراضي) يُفتح المرحّل فور إيقاف الشحن. عند حدوث عطل أمان أو نزع القابس يُفتح دائماً فوراً. يبقى محفوظاً بعد انقطاع الكهرباء.",
    "بانتظار توقف المركبة. لا تضغط على إيقاف مرة أخرى",
    "لا يوجد رد من الشاحن. قد لا يدعم برنامجه الثابت هذا الإعداد بعد. حدّثه ثم أعد المحاولة",
  ],
  bn: [
    "GB ৬-সেকেন্ড স্টপ",
    "থামানোর সময় গাড়িকে জানিয়ে বিচ্ছিন্ন করার আগে সর্বোচ্চ ৬ সেকেন্ড অপেক্ষা",
    "GB ৬-সেকেন্ড স্টপ চালু করুন",
    "চালু থাকলে, চার্জিং থামানোর সময় চার্জার আগে গাড়িকে সংকেত দেয়, গাড়ি বিদ্যুৎ নেওয়া বন্ধ করা পর্যন্ত অপেক্ষা করে এবং তারপর রিলে খোলে, সর্বোচ্চ ৬ সেকেন্ডে; গাড়ি আগে থামলে রিলে আগেই খোলে। বন্ধ থাকলে (ডিফল্ট), থামানোর সঙ্গে সঙ্গে রিলে খুলে যায়। নিরাপত্তা ত্রুটি হলে বা প্লাগ খুললে সবসময় সঙ্গে সঙ্গে খোলে। বিদ্যুৎ চলে গেলেও থাকে।",
    "গাড়ি থামার অপেক্ষায়। আবার থামান চাপবেন না",
    "চার্জার থেকে কোনো উত্তর নেই। এর ফার্মওয়্যার হয়তো এখনও এই সেটিং সমর্থন করে না। আপডেট করে আবার চেষ্টা করুন",
  ],
  id: [
    "Stop GB 6 detik",
    "Saat berhenti, beri tahu kendaraan dan tunggu hingga 6 detik sebelum memutus",
    "Aktifkan stop GB 6 detik",
    "Jika aktif, saat pengisian dihentikan pengisi daya lebih dulu memberi tahu kendaraan, menunggu sampai kendaraan berhenti menarik daya, lalu membuka relai, paling lama 6 detik; jika kendaraan berhenti lebih cepat, relai dibuka lebih cepat. Jika nonaktif (bawaan), relai langsung dibuka begitu pengisian dihentikan. Saat ada gangguan keselamatan atau steker dicabut, relai selalu langsung dibuka. Tetap tersimpan setelah listrik padam.",
    "Menunggu kendaraan berhenti. Jangan ketuk Berhenti lagi",
    "Tidak ada jawaban dari pengisi daya. Firmware-nya mungkin belum mendukung pengaturan ini. Perbarui, lalu coba lagi",
  ],
  ur: [
    "GB 6 سیکنڈ اسٹاپ",
    "روکتے وقت گاڑی کو اطلاع دیں اور منقطع کرنے سے پہلے 6 سیکنڈ تک انتظار کریں",
    "GB 6 سیکنڈ اسٹاپ فعال کریں",
    "فعال ہونے پر، چارجنگ روکتے وقت چارجر پہلے گاڑی کو اشارہ دیتا ہے، اس کے بجلی لینا بند کرنے کا انتظار کرتا ہے اور پھر ریلے کھولتا ہے، زیادہ سے زیادہ 6 سیکنڈ میں؛ گاڑی پہلے رک جائے تو ریلے پہلے کھل جاتا ہے۔ بند ہونے پر (پہلے سے طے شدہ) روکتے ہی ریلے فوراً کھل جاتا ہے۔ حفاظتی خرابی یا پلگ نکالنے پر یہ ہمیشہ فوراً کھلتا ہے۔ بجلی جانے کے بعد بھی برقرار رہتا ہے۔",
    "گاڑی کے رکنے کا انتظار ہے۔ روکیں کو دوبارہ نہ دبائیں",
    "چارجر سے کوئی جواب نہیں ملا۔ ممکن ہے اس کا فرم ویئر ابھی اس ترتیب کو سپورٹ نہ کرتا ہو۔ اسے اپ ڈیٹ کر کے دوبارہ کوشش کریں",
  ],
};

export const GB_STOP_KEYS = KEYS;
export const gbStopPacks = {};
Object.keys(TEXT).forEach((lang) => {
  gbStopPacks[lang] = {};
  KEYS.forEach((key, i) => { gbStopPacks[lang][key] = TEXT[lang][i]; });
});
