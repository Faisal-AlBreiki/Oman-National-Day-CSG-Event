/* الأسئلة الرسمية لفعالية «من يعرف عُمان أكثر؟».
 * correct_option يبدأ من صفر، وهذا الملف يُحمّل في وضع Demo المحلي فقط.
 * في التشغيل الفعلي تُقرأ الأسئلة من Supabase ولا تُرسل الإجابات الصحيحة للمتصفح.
 */
window.DEMO_QUESTIONS = [
  { id: 1, prompt: "في أي عيد وطني أعلن السلطان قابوس – طيب الله ثراه – وضع حجر الأساس لجامعة السلطان قابوس؟", card_image: "assets/images/card-oman-emblem.png", display_order: 1, correct_option: 1, options: [{text:"١١"}, {text:"١٢"}, {text:"١٣"}, {text:"١٤"}] },
  { id: 2, prompt: "ما اسم أول جريدة صدرت في سلطنة عُمان؟", card_image: "assets/images/card-oman-emblem.png", display_order: 2, correct_option: 1, options: [{text:"جريدة عُمان"}, {text:"جريدة الوطن"}, {text:"جريدة الشبيبة"}, {text:"جريدة الرؤية"}] },
  { id: 3, prompt: "في أي عام تأسست دولة البوسعيد في عُمان؟", card_image: "assets/images/card-oman-emblem.png", display_order: 3, correct_option: 3, options: [{text:"1741م"}, {text:"1742م"}, {text:"1743م"}, {text:"1744م"}] },
  { id: 4, prompt: "في أي عام أُقيم أول احتفال باليوم الوطني العُماني؟", card_image: "assets/images/card-oman-emblem.png", display_order: 4, correct_option: 1, options: [{text:"1970م"}, {text:"1971م"}, {text:"1974م"}, {text:"1975م"}] },
  { id: 5, prompt: "من هو أول عُماني اعتنق الإسلام؟", card_image: "assets/images/card-oman-emblem.png", display_order: 5, correct_option: 1, options: [{text:"الإمام أحمد بن سعيد"}, {text:"مازن بن غضوبة السعدي"}, {text:"لقيط بن مالك الأزدي"}, {text:"مالك بن فهم"}] },
  { id: 6, prompt: "ما المدينة التي اتخذها الإمام أحمد بن سعيد عاصمةً لحكمه؟", card_image: "assets/images/card-oman-emblem.png", display_order: 6, correct_option: 2, options: [{text:"نزوى"}, {text:"مسقط"}, {text:"الرستاق"}, {text:"صحار"}] },
  { id: 7, prompt: "في أي عام تولّى السلطان قابوس بن سعيد الحكم في عُمان؟", card_image: "assets/images/card-oman-emblem.png", display_order: 7, correct_option: 1, options: [{text:"1968م"}, {text:"1970م"}, {text:"1971م"}, {text:"1975م"}] },
  { id: 8, prompt: "من مؤسس الدولة البوسعيدية في عُمان؟", card_image: "assets/images/card-oman-emblem.png", display_order: 8, correct_option: 0, options: [{text:"أحمد بن سعيد البوسعيدي"}, {text:"سلطان بن أحمد البوسعيدي"}, {text:"سعيد بن سلطان البوسعيدي"}, {text:"حمد بن سعيد البوسعيدي"}] },
  { id: 9, prompt: "تتبع جزيرة مصيرة إداريًا أي محافظة؟", card_image: "assets/images/card-oman-emblem.png", display_order: 9, correct_option: 2, options: [{text:"محافظة ظفار"}, {text:"محافظة الوسطى"}, {text:"محافظة جنوب الشرقية"}, {text:"محافظة شمال الشرقية"}] }
];
