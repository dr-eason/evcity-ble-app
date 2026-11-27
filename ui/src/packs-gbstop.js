/* 「严格模式」（原来叫「新国标6秒停充」，命令还是 GBSTOPGET / GBSTOPSET）用到的字符串，12 种语言放在一处
 * （中文是键，不用翻）。i18n.js 把它们并进各语言的表里。键和 App.vue、profile.js 一致，
 * test/gbstop.test.mjs 核对每种语言都齐。 */
const KEYS = [
  "严格模式",
  "按 GB/T 18487.1-2023 的停止和故障时序",
  "开启严格模式",
  "打开后，充电桩按 GB/T 18487.1-2023 的停止和故障时序工作：停止充电时先把 CP 切到 +12 V，等车辆断开 S2 再断开接触器，最多等 6.5 秒；充电中 CP 异常或保护接地断开时，100 毫秒内断开接触器。关闭时（默认）一停止就立即断开接触器，CP 异常和保护接地断开按原来的时间断开（约 0.3 秒）。两种设置下，车辆暂停（CP 9 V）和拔枪都在 100 毫秒内断开，车辆再次请求时恢复充电。安全故障始终立即断开。断电后仍然有效。",
  "等待车端关闭，请勿重复点击停止",
  "充电桩没有应答。充电桩固件可能还不支持这个设置，需要升级后再设置",
];

const TEXT = {
  en: [
    "Strict Mode",
    "Follow the GB/T 18487.1-2023 stop and fault timing",
    "Enable Strict Mode",
    "When on, the charger follows the GB/T 18487.1-2023 stop and fault timing: on stop it first sets CP to +12 V and waits for the vehicle to open S2 before opening the contactor, 6.5 seconds at most; while charging, a CP fault or loss of protective earth opens the contactor within 100 ms. When off (default), the contactor opens as soon as charging is stopped, and a CP fault or loss of protective earth opens it with the earlier timing (about 0.3 s). With either setting, a vehicle pause (CP 9 V) or unplugging opens the contactor within 100 ms, and charging resumes when the vehicle requests it again. Safety faults always open it at once. Kept across power loss.",
    "Waiting for the vehicle to stop. Do not tap Stop again",
    "No reply from the charger. Its firmware may not support this setting yet. Update it, then try again",
  ],
  fr: [
    "Mode strict",
    "Suivre les délais d’arrêt et de défaut de la GB/T 18487.1-2023",
    "Activer le mode strict",
    "Si activé, la borne suit les délais d’arrêt et de défaut de la GB/T 18487.1-2023 : à l’arrêt, elle met d’abord le CP à +12 V et attend que le véhicule ouvre S2 avant d’ouvrir le contacteur, 6,5 secondes au plus ; pendant la charge, un défaut du CP ou la perte de la terre de protection ouvre le contacteur en moins de 100 ms. Si désactivé (par défaut), le contacteur s’ouvre dès l’arrêt de la charge, et un défaut du CP ou la perte de la terre de protection l’ouvre avec les délais précédents (environ 0,3 s). Dans les deux cas, une pause du véhicule (CP à 9 V) ou un débranchement ouvre le contacteur en moins de 100 ms, et la charge reprend quand le véhicule la redemande. Les défauts de sécurité l’ouvrent toujours immédiatement. Conservé après une coupure de courant.",
    "En attente de l’arrêt du véhicule. Ne touchez plus Arrêter",
    "Pas de réponse de la borne. Son micrologiciel ne gère peut-être pas encore ce réglage. Mettez-le à jour, puis réessayez",
  ],
  ja: [
    "厳格モード",
    "GB/T 18487.1-2023 の停止・異常時のタイミングに従います",
    "厳格モードを有効にする",
    "オンにすると、充電器は GB/T 18487.1-2023 の停止・異常時のタイミングに従います。充電停止時はまず CP を +12 V にし、車両が S2 を開くのを待ってからコンタクタを開きます（最長 6.5 秒）。充電中に CP 異常または保護接地の断線が起きると、100 ms 以内にコンタクタを開きます。オフ（既定）では、停止するとすぐにコンタクタを開き、CP 異常と保護接地の断線は従来のタイミング（約 0.3 秒）で開きます。どちらの設定でも、車両の一時停止（CP 9 V）とプラグを抜いた場合は 100 ms 以内に開き、車両が再び要求すると充電を再開します。安全異常の場合は常にすぐ開きます。電源を切っても残ります。",
    "車両側の停止を待っています。停止を繰り返しタップしないでください",
    "充電器から応答がありません。ファームウェアがこの設定にまだ対応していない可能性があります。アップデートしてから設定してください",
  ],
  de: [
    "Strenger Modus",
    "Stopp- und Fehlerzeiten nach GB/T 18487.1-2023",
    "Strengen Modus aktivieren",
    "Wenn eingeschaltet, hält das Ladegerät die Stopp- und Fehlerzeiten nach GB/T 18487.1-2023 ein: Beim Stoppen legt es zuerst CP auf +12 V und wartet, bis das Fahrzeug S2 öffnet, bevor es das Schütz öffnet, höchstens 6,5 Sekunden; während des Ladens öffnet ein CP-Fehler oder der Verlust des Schutzleiters das Schütz innerhalb von 100 ms. Wenn ausgeschaltet (Standard), öffnet das Schütz sofort beim Stoppen, und ein CP-Fehler oder der Verlust des Schutzleiters öffnet es mit den bisherigen Zeiten (etwa 0,3 s). In beiden Fällen öffnet eine Ladepause des Fahrzeugs (CP 9 V) oder das Abziehen das Schütz innerhalb von 100 ms, und das Laden wird fortgesetzt, wenn das Fahrzeug es wieder anfordert. Sicherheitsfehler öffnen es immer sofort. Bleibt nach Stromausfall erhalten.",
    "Warten, bis das Fahrzeug stoppt. Bitte nicht erneut auf Stopp tippen",
    "Keine Antwort vom Ladegerät. Die Firmware unterstützt diese Einstellung vielleicht noch nicht. Bitte aktualisieren und erneut versuchen",
  ],
  es: [
    "Modo estricto",
    "Seguir los tiempos de parada y de fallo de la GB/T 18487.1-2023",
    "Activar el modo estricto",
    "Si está activado, el cargador sigue los tiempos de parada y de fallo de la GB/T 18487.1-2023: al detener la carga pone primero el CP a +12 V y espera a que el vehículo abra S2 antes de abrir el contactor, 6,5 segundos como máximo; durante la carga, un fallo del CP o la pérdida de la tierra de protección abre el contactor en menos de 100 ms. Si está desactivado (por defecto), el contactor se abre en cuanto se detiene la carga, y un fallo del CP o la pérdida de la tierra de protección lo abre con los tiempos anteriores (unos 0,3 s). En ambos casos, una pausa del vehículo (CP a 9 V) o el desenchufado abre el contactor en menos de 100 ms, y la carga se reanuda cuando el vehículo vuelve a pedirla. Los fallos de seguridad siempre lo abren de inmediato. Se conserva tras un corte de corriente.",
    "Esperando a que el vehículo se detenga. No vuelva a tocar Detener",
    "El cargador no responde. Puede que su firmware aún no admita este ajuste. Actualícelo y vuelva a intentarlo",
  ],
  pt: [
    "Modo estrito",
    "Seguir os tempos de paragem e de falha da GB/T 18487.1-2023",
    "Ativar o modo estrito",
    "Se ativado, o carregador segue os tempos de paragem e de falha da GB/T 18487.1-2023: ao parar o carregamento, coloca primeiro o CP a +12 V e espera que o veículo abra S2 antes de abrir o contactor, no máximo 6,5 segundos; durante o carregamento, uma falha do CP ou a perda da terra de proteção abre o contactor em menos de 100 ms. Se desativado (predefinição), o contactor abre logo que o carregamento é parado, e uma falha do CP ou a perda da terra de proteção abre-o com os tempos anteriores (cerca de 0,3 s). Nos dois casos, uma pausa do veículo (CP a 9 V) ou o desligar da ficha abre o contactor em menos de 100 ms, e o carregamento é retomado quando o veículo o voltar a pedir. As falhas de segurança abrem-no sempre de imediato. Mantém-se após falta de energia.",
    "A aguardar que o veículo pare. Não toque em Parar novamente",
    "O carregador não responde. O firmware pode ainda não suportar esta definição. Atualize-o e tente novamente",
  ],
  ru: [
    "Строгий режим",
    "Время остановки и реакции на неисправности по GB/T 18487.1-2023",
    "Включить строгий режим",
    "Если включено, станция соблюдает время остановки и реакции на неисправности по GB/T 18487.1-2023: при остановке зарядки она сначала переводит CP на +12 В и ждёт, пока автомобиль разомкнёт S2, и только затем размыкает контактор — не позже чем через 6,5 секунды; во время зарядки при неисправности CP или обрыве защитного заземления контактор размыкается в течение 100 мс. Если выключено (по умолчанию), контактор размыкается сразу при остановке, а при неисправности CP или обрыве защитного заземления — с прежним временем (около 0,3 с). При любой настройке пауза по запросу автомобиля (CP 9 В) или отключение разъёма размыкает контактор в течение 100 мс, а зарядка возобновляется, когда автомобиль снова её запросит. При авариях безопасности контактор всегда размыкается немедленно. Сохраняется после отключения питания.",
    "Ожидание остановки автомобиля. Не нажимайте «Стоп» повторно",
    "Станция не отвечает. Возможно, её прошивка ещё не поддерживает эту настройку. Обновите её и повторите попытку",
  ],
  hi: [
    "सख्त मोड",
    "GB/T 18487.1-2023 के अनुसार रोकने और दोष का समय",
    "सख्त मोड चालू करें",
    "चालू होने पर, चार्जर GB/T 18487.1-2023 के रोकने और दोष के समय का पालन करता है: चार्जिंग रोकते समय यह पहले CP को +12 V पर करता है और वाहन के S2 खोलने की प्रतीक्षा करके कॉन्टैक्टर खोलता है, अधिकतम 6.5 सेकंड में; चार्जिंग के दौरान CP में दोष या सुरक्षा अर्थ टूटने पर कॉन्टैक्टर 100 ms के भीतर खुल जाता है। बंद होने पर (डिफ़ॉल्ट), रोकते ही कॉन्टैक्टर तुरंत खुल जाता है, और CP में दोष या सुरक्षा अर्थ टूटने पर यह पहले वाले समय (लगभग 0.3 सेकंड) में खुलता है। दोनों स्थितियों में, वाहन के विराम (CP 9 V) या प्लग निकालने पर कॉन्टैक्टर 100 ms के भीतर खुलता है, और वाहन के दोबारा माँगने पर चार्जिंग फिर शुरू होती है। सुरक्षा दोष होने पर यह हमेशा तुरंत खुलता है। बिजली जाने के बाद भी बना रहता है।",
    "वाहन के रुकने की प्रतीक्षा है। रोकें को दोबारा न दबाएँ",
    "चार्जर से कोई उत्तर नहीं मिला। हो सकता है इसका फ़र्मवेयर अभी इस सेटिंग का समर्थन न करता हो। इसे अपडेट करके फिर प्रयास करें",
  ],
  ar: [
    "الوضع الصارم",
    "اتباع توقيتات الإيقاف والأعطال وفق GB/T 18487.1-2023",
    "تفعيل الوضع الصارم",
    "عند التفعيل، يتبع الشاحن توقيتات الإيقاف والأعطال وفق GB/T 18487.1-2023: عند إيقاف الشحن يضبط أولاً CP على ‎+12 V وينتظر حتى تفتح المركبة S2 ثم يفتح الكونتاكتور، خلال 6.5 ثانية على الأكثر؛ وأثناء الشحن، عند حدوث خلل في CP أو انقطاع التأريض الوقائي يُفتح الكونتاكتور خلال 100 مللي ثانية. عند الإيقاف (الافتراضي) يُفتح الكونتاكتور فور إيقاف الشحن، وعند خلل CP أو انقطاع التأريض الوقائي يُفتح بالتوقيت السابق (نحو 0.3 ثانية). في الحالتين، عند توقف المركبة مؤقتاً (CP عند 9 V) أو نزع القابس يُفتح الكونتاكتور خلال 100 مللي ثانية، ويُستأنف الشحن عندما تطلبه المركبة من جديد. عند أعطال الأمان يُفتح دائماً فوراً. يبقى محفوظاً بعد انقطاع الكهرباء.",
    "بانتظار توقف المركبة. لا تضغط على إيقاف مرة أخرى",
    "لا يوجد رد من الشاحن. قد لا يدعم برنامجه الثابت هذا الإعداد بعد. حدّثه ثم أعد المحاولة",
  ],
  bn: [
    "কঠোর মোড",
    "GB/T 18487.1-2023 অনুযায়ী থামানো ও ত্রুটির সময়",
    "কঠোর মোড চালু করুন",
    "চালু থাকলে, চার্জার GB/T 18487.1-2023 অনুযায়ী থামানো ও ত্রুটির সময় মেনে চলে: চার্জিং থামানোর সময় এটি আগে CP-কে +12 V করে এবং গাড়ি S2 খোলা পর্যন্ত অপেক্ষা করে তারপর কন্টাক্টর খোলে, সর্বোচ্চ ৬.৫ সেকেন্ডে; চার্জিং চলাকালে CP ত্রুটি হলে বা সুরক্ষা আর্থ বিচ্ছিন্ন হলে কন্টাক্টর 100 ms-এর মধ্যে খোলে। বন্ধ থাকলে (ডিফল্ট), থামানোর সঙ্গে সঙ্গে কন্টাক্টর খুলে যায়, আর CP ত্রুটি বা সুরক্ষা আর্থ বিচ্ছিন্ন হলে আগের সময়ে (প্রায় 0.3 সেকেন্ড) খোলে। দুই ক্ষেত্রেই, গাড়ি বিরতি নিলে (CP 9 V) বা প্লাগ খুললে কন্টাক্টর 100 ms-এর মধ্যে খোলে, এবং গাড়ি আবার চাইলে চার্জিং আবার শুরু হয়। নিরাপত্তা ত্রুটি হলে সবসময় সঙ্গে সঙ্গে খোলে। বিদ্যুৎ চলে গেলেও থাকে।",
    "গাড়ি থামার অপেক্ষায়। আবার থামান চাপবেন না",
    "চার্জার থেকে কোনো উত্তর নেই। এর ফার্মওয়্যার হয়তো এখনও এই সেটিং সমর্থন করে না। আপডেট করে আবার চেষ্টা করুন",
  ],
  id: [
    "Mode Ketat",
    "Mengikuti waktu berhenti dan gangguan GB/T 18487.1-2023",
    "Aktifkan Mode Ketat",
    "Jika aktif, pengisi daya mengikuti waktu berhenti dan gangguan GB/T 18487.1-2023: saat pengisian dihentikan, CP lebih dulu dijadikan +12 V dan pengisi daya menunggu kendaraan membuka S2 sebelum membuka kontaktor, paling lama 6,5 detik; selama pengisian, gangguan CP atau putusnya pembumian pengaman membuka kontaktor dalam 100 ms. Jika nonaktif (bawaan), kontaktor langsung dibuka begitu pengisian dihentikan, dan gangguan CP atau putusnya pembumian pengaman membukanya dengan waktu sebelumnya (sekitar 0,3 detik). Pada kedua pengaturan, jeda dari kendaraan (CP 9 V) atau steker dicabut membuka kontaktor dalam 100 ms, dan pengisian dilanjutkan saat kendaraan memintanya lagi. Gangguan keselamatan selalu langsung membukanya. Tetap tersimpan setelah listrik padam.",
    "Menunggu kendaraan berhenti. Jangan ketuk Berhenti lagi",
    "Tidak ada jawaban dari pengisi daya. Firmware-nya mungkin belum mendukung pengaturan ini. Perbarui, lalu coba lagi",
  ],
  ur: [
    "سخت موڈ",
    "GB/T 18487.1-2023 کے مطابق روکنے اور خرابی کے اوقات",
    "سخت موڈ فعال کریں",
    "فعال ہونے پر، چارجر GB/T 18487.1-2023 کے روکنے اور خرابی کے اوقات کی پابندی کرتا ہے: چارجنگ روکتے وقت یہ پہلے CP کو ‎+12 V پر کرتا ہے اور گاڑی کے S2 کھولنے کا انتظار کر کے کنٹیکٹر کھولتا ہے، زیادہ سے زیادہ 6.5 سیکنڈ میں؛ چارجنگ کے دوران CP میں خرابی یا حفاظتی ارتھ منقطع ہونے پر کنٹیکٹر 100 ملی سیکنڈ کے اندر کھل جاتا ہے۔ بند ہونے پر (پہلے سے طے شدہ) روکتے ہی کنٹیکٹر فوراً کھل جاتا ہے، اور CP میں خرابی یا حفاظتی ارتھ منقطع ہونے پر یہ پہلے والے وقت (تقریباً 0.3 سیکنڈ) میں کھلتا ہے۔ دونوں صورتوں میں، گاڑی کے وقفے (CP 9 V) یا پلگ نکالنے پر کنٹیکٹر 100 ملی سیکنڈ کے اندر کھلتا ہے، اور گاڑی کے دوبارہ مانگنے پر چارجنگ پھر شروع ہو جاتی ہے۔ حفاظتی خرابی پر یہ ہمیشہ فوراً کھلتا ہے۔ بجلی جانے کے بعد بھی برقرار رہتا ہے۔",
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
