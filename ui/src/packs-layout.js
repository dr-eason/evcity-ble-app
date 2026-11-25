/* 固件分区布局（3.0.0，fw-layout.js）用到的字符串，12 种语言放在一处（中文是键，不用翻）。
 * i18n.js 把它们并进各语言的表里。test/fw-layout.test.mjs 核对每种语言都齐。
 * "L1"、"L2" 是固件文件和桩上标的叫法，各语言照写。 */
export const layoutPacks = {
  en: {
    "固件分区": "Flash layout",
    "文件不能超过 240 KB": "The file must be 240 KB or smaller",
    "这个文件是新板（L2）固件，这台充电桩是老分区（L1），不能用它升级": "This file is firmware for new boards (L2). This charger uses the old layout (L1), so it cannot be updated with this file",
    "这个文件是老分区（L1）固件，这台充电桩是新板（L2），不能用它升级": "This file is firmware for the old layout (L1). This charger is a new board (L2), so it cannot be updated with this file",
  },
  fr: {
    "固件分区": "Partition flash",
    "文件不能超过 240 KB": "Le fichier ne doit pas dépasser 240 Ko",
    "这个文件是新板（L2）固件，这台充电桩是老分区（L1），不能用它升级": "Ce fichier est le micrologiciel des nouvelles cartes (L2). Cette borne utilise l’ancienne partition (L1) : impossible de la mettre à jour avec ce fichier",
    "这个文件是老分区（L1）固件，这台充电桩是新板（L2），不能用它升级": "Ce fichier est le micrologiciel de l’ancienne partition (L1). Cette borne est une nouvelle carte (L2) : impossible de la mettre à jour avec ce fichier",
  },
  ja: {
    "固件分区": "フラッシュ配置",
    "文件不能超过 240 KB": "ファイルは 240 KB 以下にしてください",
    "这个文件是新板（L2）固件，这台充电桩是老分区（L1），不能用它升级": "このファイルは新基板（L2）用のファームウェアです。この充電器は旧配置（L1）なので、このファイルでは更新できません",
    "这个文件是老分区（L1）固件，这台充电桩是新板（L2），不能用它升级": "このファイルは旧配置（L1）用のファームウェアです。この充電器は新基板（L2）なので、このファイルでは更新できません",
  },
  de: {
    "固件分区": "Flash-Aufteilung",
    "文件不能超过 240 KB": "Die Datei darf höchstens 240 KB groß sein",
    "这个文件是新板（L2）固件，这台充电桩是老分区（L1），不能用它升级": "Diese Datei ist Firmware für neue Platinen (L2). Diese Ladestation hat die alte Aufteilung (L1) und kann damit nicht aktualisiert werden",
    "这个文件是老分区（L1）固件，这台充电桩是新板（L2），不能用它升级": "Diese Datei ist Firmware für die alte Aufteilung (L1). Diese Ladestation ist eine neue Platine (L2) und kann damit nicht aktualisiert werden",
  },
  es: {
    "固件分区": "Partición de flash",
    "文件不能超过 240 KB": "El archivo no puede superar 240 KB",
    "这个文件是新板（L2）固件，这台充电桩是老分区（L1），不能用它升级": "Este archivo es firmware para placas nuevas (L2). Este cargador usa la partición antigua (L1), así que no se puede actualizar con este archivo",
    "这个文件是老分区（L1）固件，这台充电桩是新板（L2），不能用它升级": "Este archivo es firmware para la partición antigua (L1). Este cargador es una placa nueva (L2), así que no se puede actualizar con este archivo",
  },
  pt: {
    "固件分区": "Partição da flash",
    "文件不能超过 240 KB": "O arquivo não pode passar de 240 KB",
    "这个文件是新板（L2）固件，这台充电桩是老分区（L1），不能用它升级": "Este arquivo é firmware para placas novas (L2). Este carregador usa a partição antiga (L1), então não pode ser atualizado com este arquivo",
    "这个文件是老分区（L1）固件，这台充电桩是新板（L2），不能用它升级": "Este arquivo é firmware para a partição antiga (L1). Este carregador é uma placa nova (L2), então não pode ser atualizado com este arquivo",
  },
  ru: {
    "固件分区": "Разметка флеш-памяти",
    "文件不能超过 240 KB": "Файл должен быть не больше 240 КБ",
    "这个文件是新板（L2）固件，这台充电桩是老分区（L1），不能用它升级": "Это прошивка для новых плат (L2). У этой станции старая разметка (L1), обновить её этим файлом нельзя",
    "这个文件是老分区（L1）固件，这台充电桩是新板（L2），不能用它升级": "Это прошивка для старой разметки (L1). Эта станция — новая плата (L2), обновить её этим файлом нельзя",
  },
  hi: {
    "固件分区": "फ़्लैश लेआउट",
    "文件不能超过 240 KB": "फ़ाइल 240 KB से बड़ी नहीं हो सकती",
    "这个文件是新板（L2）固件，这台充电桩是老分区（L1），不能用它升级": "यह फ़ाइल नए बोर्ड (L2) का फ़र्मवेयर है। यह चार्जर पुराने लेआउट (L1) का है, इसलिए इस फ़ाइल से अपडेट नहीं हो सकता",
    "这个文件是老分区（L1）固件，这台充电桩是新板（L2），不能用它升级": "यह फ़ाइल पुराने लेआउट (L1) का फ़र्मवेयर है। यह चार्जर नया बोर्ड (L2) है, इसलिए इस फ़ाइल से अपडेट नहीं हो सकता",
  },
  id: {
    "固件分区": "Tata letak flash",
    "文件不能超过 240 KB": "Berkas tidak boleh lebih dari 240 KB",
    "这个文件是新板（L2）固件，这台充电桩是老分区（L1），不能用它升级": "Berkas ini firmware untuk papan baru (L2). Pengisi daya ini memakai tata letak lama (L1), jadi tidak bisa diperbarui dengan berkas ini",
    "这个文件是老分区（L1）固件，这台充电桩是新板（L2），不能用它升级": "Berkas ini firmware untuk tata letak lama (L1). Pengisi daya ini papan baru (L2), jadi tidak bisa diperbarui dengan berkas ini",
  },
  ar: {
    "固件分区": "تقسيم الذاكرة",
    "文件不能超过 240 KB": "يجب ألا يتجاوز الملف 240 KB",
    "这个文件是新板（L2）固件，这台充电桩是老分区（L1），不能用它升级": "هذا الملف برنامج ثابت للوحات الجديدة (L2). هذا الشاحن بالتقسيم القديم (L1)، فلا يمكن تحديثه بهذا الملف",
    "这个文件是老分区（L1）固件，这台充电桩是新板（L2），不能用它升级": "هذا الملف برنامج ثابت للتقسيم القديم (L1). هذا الشاحن لوحة جديدة (L2)، فلا يمكن تحديثه بهذا الملف",
  },
  bn: {
    "固件分区": "ফ্ল্যাশ লেআউট",
    "文件不能超过 240 KB": "ফাইল 240 KB-এর বেশি হতে পারবে না",
    "这个文件是新板（L2）固件，这台充电桩是老分区（L1），不能用它升级": "এই ফাইলটি নতুন বোর্ডের (L2) ফার্মওয়্যার। এই চার্জার পুরোনো লেআউটের (L1), তাই এই ফাইল দিয়ে আপডেট করা যাবে না",
    "这个文件是老分区（L1）固件，这台充电桩是新板（L2），不能用它升级": "এই ফাইলটি পুরোনো লেআউটের (L1) ফার্মওয়্যার। এই চার্জার নতুন বোর্ড (L2), তাই এই ফাইল দিয়ে আপডেট করা যাবে না",
  },
  ur: {
    "固件分区": "فلیش لے آؤٹ",
    "文件不能超过 240 KB": "فائل 240 KB سے بڑی نہیں ہو سکتی",
    "这个文件是新板（L2）固件，这台充电桩是老分区（L1），不能用它升级": "یہ فائل نئے بورڈ (L2) کا فرم ویئر ہے۔ یہ چارجر پرانے لے آؤٹ (L1) کا ہے، اس لیے اس فائل سے اپ ڈیٹ نہیں ہو سکتا",
    "这个文件是老分区（L1）固件，这台充电桩是新板（L2），不能用它升级": "یہ فائل پرانے لے آؤٹ (L1) کا فرم ویئر ہے۔ یہ چارجر نیا بورڈ (L2) ہے، اس لیے اس فائل سے اپ ڈیٹ نہیں ہو سکتا",
  },
};
