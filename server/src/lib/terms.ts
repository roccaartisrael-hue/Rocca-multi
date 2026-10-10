/**
 * Customer terms of service + consent, in 5 languages. Single source of truth for the in-person onboarding screen,
 * the printable A4 copy (/terms/print) and the signed copy sent to the customer.
 * DRAFT: the bracketed [ ] fields must be filled in and a lawyer must approve the wording before real use.
 */
export const TERMS_VERSION = "2026-10-10-v1";
export const TERMS_LANGS = ["he", "en", "es", "ar", "ru"] as const;
export type TermsLang = (typeof TERMS_LANGS)[number];

export interface TermsSection { h: string; intro?: string; items: string[] }
export interface TermsDoc {
  lang: TermsLang;
  dir: "rtl" | "ltr";
  flag: string;
  name: string;
  title: string;
  version: string;
  sections: TermsSection[];
  checks: string[]; // exactly 5, all required
  ui: { signHere: string; clear: string; submit: string; signedBy: string; date: string; businessId: string; printNote: string; checksTitle: string };
}

const he: TermsDoc = {
  lang: "he", dir: "rtl", flag: "🇮🇱", name: "עברית",
  title: "הסכם תנאי שימוש והסכמת לקוח – BOOL AI",
  version: `גרסה: ${TERMS_VERSION} | טיוטה לבדיקת עורך דין`,
  sections: [
    { h: "סעיף 1 - הצדדים והגדרת השירות", items: [
      `1.1. הסכם זה נערך בין [שם החברה המפעילה], ח.פ./ע.מ. [מספר מזהה], שכתובתה [כתובת החברה] (להלן: "BOOL"), לבין הלקוח המצטרף כמפורט בפרטי הרישום (להלן: "הלקוח").`,
      `1.2. חברת BOOL מעמידה לרשות הלקוח פלטפורמה מבוססת תוכנה ואוטומציה לניהול שיווק דיגיטלי, הכוללת: יצירת תכנים, תזמון ופרסום ברשתות חברתיות, עמוד נחיתה/אתר ודומיין, אסיסטנט אישי מבוסס בינה מלאכותית (באפליקציה ובוואטסאפ), ודוחות ביצועים (להלן: "השירות").`,
      `1.3. תנאי המסלול, התעריפים ומחזורי החיוב הם כמפורט בעמוד המנוי ומהווים חלק בלתי נפרד מהסכם זה.`,
      `1.4. השירות מופעל ומנוהל באופן אוטומטי ללא התערבות נציג אנושי בזמן אמת. תקלות טכניות ידווחו דרך טופס "דיווח על תקלה" באפליקציה ויטופלו בהתאם לנהלי השירות.`,
    ] },
    { h: "סעיף 2 - הרשאות ופרסום בשם הלקוח", intro: "הלקוח מעניק בזאת ל-BOOL הרשאה מפורשת לפעול בשמו ומטעמו במהלך תקופת המנוי בלבד:", items: [
      `2.1. חיבור חשבונות: לחבר לשירות את חשבונות הרשתות החברתיות (Meta - פייסבוק ואינסטגרם, TikTok, WhatsApp וכו') שהלקוח חיבר ביוזמתו באמצעות מנגנוני ההרשאה הרשמיים (OAuth/APIs).`,
      `2.2. פרסום תכנים: להעלות ולפרסם בשם הלקוח תכנים שנוצרו במערכת, בהתאם למדיניות האישור שהוגדרה (אישור ידני מוקדם או פרסום אוטומטי מתוזמן).`,
      `2.3. איסוף נתוני ביצועים: לגשת לנתוני ביצועים של החשבונות המחוברים לצורך הפקת דוחות ושיפור מודלי יצירת התוכן של הלקוח בלבד.`,
      `2.4. הודעות תפעוליות בוואטסאפ: לשלוח ללקוח עדכונים, תדריכי בוקר והתראות לוואטסאפ שאומת. ניתן לבטל בכל עת בשליחת המילה "עצור".`,
      `2.5. הלקוח רשאי לנתק חשבונות ולבטל את ההרשאות בכל עת דרך האפליקציה. BOOL מתחייבת שלא לעשות כל שימוש בהרשאות אלו שלא לצורך אספקת השירות.`,
    ] },
    { h: "סעיף 3 - בינה מלאכותית (AI), אחריות לתוכן ופרטיות", items: [
      `3.1. טכנולוגיית AI: התכנים, השיחות וההמלצות נוצרים באמצעות מודלים של בינה מלאכותית ועלולים להכיל אי-דיוקים. האסיסטנט הינו כלי ממוחשב ואינו גורם אנושי או ייעוץ מקצועי מוסמך.`,
      `3.2. אחריות הלקוח לתוכן: הלקוח נושא באחריות המלאה לבדיקת אמינות התוכן, דיוקו והתאמתו לכל דין בטרם פרסומו (לרבות הגנת הצרכן, לשון הרע וזכויות יוצרים). מומלץ לאשר ידנית תוכן בתחומים מפוקחים (רפואה, פיננסים, משפט).`,
      `3.3. שחרור מאחריות: BOOL לא תישא באחריות לתוכן שפורסם באישור הלקוח או במסגרת פרסום אוטומטי שהופעל על ידו, ככל שהדבר מותר בדין.`,
      `3.4. היעדר התחייבות לתוצאות: השירות מסופק AS-IS. BOOL אינה מתחייבת לגידול במכירות, לידים או תוצאות עסקיות כלשהן.`,
      `3.5. פרטיות: עיבוד המידע נעשה בהתאם למדיניות הפרטיות ולחוק הגנת הפרטיות. המידע שהוזן שייך ללקוח, וניתן לעורכו או לבקש את מחיקתו בכל עת.`,
    ] },
    { h: "סעיף 4 - תשלומים, ביטול, הגבלת אחריות וסמכות שיפוט", items: [
      `4.1. תשלום: דמי המנוי נגבים מראש באמצעות ספק סליקה מאובטח [שם הספק]. פרטי האשראי אינם נשמרים בשרתי BOOL.`,
      `4.2. הוצאות צד שלישי: תקציבי קמפיינים ממומנים משולמים ישירות לפלטפורמות המדיה ואינם נכללים בדמי המנוי.`,
      `4.3. ביטול: הלקוח רשאי לבטל את המנוי בכל עת באפליקציה. הביטול ייכנס לתוקף בסיום תקופת החיוב ששולמה מראש, בכפוף לדיני הגנת הצרכן.`,
      `4.4. הגבלת אחריות: סך אחריותה של BOOL לא יעלה על הסכום ששולם בפועל על ידי הלקוח ב-12 החודשים שקדמו לאירוע. BOOL לא תהיה אחראית לנזק עקיף או השעיית חשבונות על ידי פלטפורמות צד שלישי.`,
      `4.5. שינויים בתנאים: על שינוי מהותי לרעת הלקוח תימסר הודעה של 30 ימים מראש שתאפשר ביטול ללא קנס.`,
      `4.6. דין וסמכות שיפוט: דיני מדינת ישראל. סמכות ייחודית לבתי המשפט המוסמכים במחוז [תל אביב-יפו / חיפה].`,
    ] },
  ],
  checks: [
    "קראתי, הבנתי ואני מסכים לתנאי השימוש ולמדיניות הפרטיות של BOOL AI.",
    "אני מעניק ל-BOOL הרשאה לנהל ולפרסם תכנים בשמי בחשבונות שחיברתי (סעיף 2).",
    "ידוע לי כי התכנים מופקים על ידי AI ואני אחראי לבדיקתם ואישורם טרם הפרסום (סעיף 3).",
    "אני מאשר קבלת עדכונים והודעות תפעוליות בוואטסאפ למספר שחיברתי למערכת.",
    "קראתי ואני מאשר את תנאי התשלום, מדיניות הביטול והגבלת האחריות (סעיף 4).",
  ],
  ui: { signHere: "חתימת הלקוח (באצבע או בסטיילוס)", clear: "נקה חתימה", submit: "השלם הצטרפות וחתום", signedBy: "שם החותם", date: "תאריך", businessId: "ח.פ. / ע.מ. / ת.ז.", printNote: "לחתימה ידנית בעט", checksTitle: "אישורים והסכמות" },
};

const en: TermsDoc = {
  lang: "en", dir: "ltr", flag: "🇺🇸", name: "English",
  title: "Terms of Service & Client Consent Agreement – BOOL AI",
  version: `Version: ${TERMS_VERSION} | Draft for Legal Review Only`,
  sections: [
    { h: "Section 1 - The Parties and the Service", items: [
      `1.1. This Agreement is entered into between [Operating Company Name], Reg./ID No. [Company ID], located at [Company Address] ("BOOL"), and the Client whose registration details are provided herein ("Client").`,
      `1.2. BOOL provides an automated digital marketing software platform including: content creation, social media scheduling and publishing, website/domain hosting, an AI personal assistant (in-app and WhatsApp), and performance analytics (the "Service").`,
      `1.3. Plan specifications, rates, and billing cycles are as detailed on the subscription page and constitute an integral part of this Agreement.`,
      `1.4. The Service operates automatically without continuous human intervention. Technical bugs may be submitted via the in-app "Report an Issue" form and handled per standard SLA.`,
    ] },
    { h: "Section 2 - Permissions and Publishing on Client's Behalf", intro: "Client grants BOOL express permission to act on its behalf solely during the active subscription:", items: [
      `2.1. Connecting Accounts: Connect social media accounts (Meta platforms - Facebook & Instagram, TikTok, WhatsApp, etc.) connected directly by the Client via official OAuth/APIs.`,
      `2.2. Publishing Content: Post content generated by the system based on chosen settings (manual approval or automated publishing).`,
      `2.3. Performance Metrics: Access analytics of connected channels strictly to compile reports and optimize Client's AI content models.`,
      `2.4. Operational WhatsApp Messaging: Send operational updates, briefings, and alerts to Client's verified WhatsApp number. Client may opt out anytime by replying "STOP".`,
      `2.5. Client may disconnect accounts and revoke permissions anytime in the app. BOOL will not use these permissions for any other purpose.`,
    ] },
    { h: "Section 3 - Artificial Intelligence (AI), Content Liability, and Privacy", items: [
      `3.1. AI Nature: Content, interactions, and suggestions are generated by AI models and may contain errors. The assistant is an automated program, not a human or certified advisor.`,
      `3.2. Client Responsibility: Client assumes full responsibility for checking the accuracy, legality, and compliance of all content prior to publication (consumer protection, copyright, libel). Manual approval is recommended for regulated fields (medical, financial, legal).`,
      `3.3. Disclaimer for Posts: BOOL disclaims liability for content published with Client approval or via Client-configured automated posting, as permitted by law.`,
      `3.4. No Guaranteed Outcomes: The Service is provided "AS IS". BOOL does not guarantee specific commercial gains, sales, or lead volume.`,
      `3.5. Privacy: Data is processed according to BOOL's Privacy Policy and data protection laws. Client data remains Client's property and may be edited or deleted upon request.`,
    ] },
    { h: "Section 4 - Payments, Cancellation, Liability, and Jurisdiction", items: [
      `4.1. Payment: Subscription fees are collected in advance via a secure PCI-DSS gateway [Gateway Name]. BOOL does not store credit card credentials.`,
      `4.2. Third-Party Costs: Paid advertising spend (Meta, Google, TikTok) is paid directly by Client to the advertising networks and is not part of BOOL subscription fees.`,
      `4.3. Cancellation: Client may cancel subscription anytime in the app. Cancellation takes effect at the end of the current billing cycle, subject to applicable statutory cancellation laws.`,
      `4.4. Limitation of Liability: Total liability of BOOL shall not exceed fees actually paid by Client in the preceding 12 months. BOOL is not liable for indirect damages or external platform suspensions.`,
      `4.5. Terms Updates: Material changes adverse to Client will be notified 30 days in advance, allowing penalty-free termination.`,
      `4.6. Law & Jurisdiction: Laws of the State of Israel. Exclusive jurisdiction to competent courts in [Tel Aviv-Yafo / Haifa].`,
    ] },
  ],
  checks: [
    "I have read, understood, and agree to the Terms of Service and Privacy Policy of BOOL AI.",
    "I authorize BOOL to manage and publish content on my connected accounts (Section 2).",
    "I acknowledge content is generated by AI and I am responsible for verifying it before publishing (Section 3).",
    "I agree to receive operational notifications on WhatsApp at my verified phone number.",
    "I approve the Payment, Cancellation, and Limitation of Liability terms (Section 4).",
  ],
  ui: { signHere: "Client signature (finger or stylus)", clear: "Clear signature", submit: "Complete sign-up & sign", signedBy: "Signatory name", date: "Date", businessId: "Tax / Business ID", printNote: "For handwritten signature", checksTitle: "Confirmations & consents" },
};

const es: TermsDoc = {
  lang: "es", dir: "ltr", flag: "🇪🇸", name: "Español",
  title: "Términos de Servicio y Acuerdo de Consentimiento del Cliente – BOOL AI",
  version: `Versión: ${TERMS_VERSION} | Borrador para revisión legal`,
  sections: [
    { h: "Sección 1 - Partes y Definición del Servicio", items: [
      `1.1. El presente Contrato se celebra entre [Nombre de la Empresa Operadora], NIF/CIF/ID [Número de Identificación], con domicilio en [Dirección de la Empresa] ("BOOL"), y el Cliente cuyos datos se facilitan en el formulario de registro ("Cliente").`,
      `1.2. BOOL proporciona una plataforma automatizada de marketing digital que incluye: generación de contenido con IA, programación y publicación en redes sociales, sitio web/dominio, asistente personal con IA (en la app y WhatsApp), e informes de rendimiento (el "Servicio").`,
      `1.3. Los planes, tarifas y ciclos de facturación son los detallados en la página de suscripción y forman parte integral de este Contrato.`,
      `1.4. El Servicio opera de manera automatizada sin intervención humana constante en tiempo real. Los problemas técnicos se reportan a través del formulario "Informar de un error" en la aplicación.`,
    ] },
    { h: "Sección 2 - Permisos y Publicación en Nombre del Cliente", intro: "El Cliente otorga a BOOL autorización expresa para actuar en su nombre únicamente durante el periodo de suscripción activa:", items: [
      `2.1. Conexión de cuentas: Conectar las cuentas de redes sociales (Meta - Facebook e Instagram, TikTok, WhatsApp, etc.) vinculadas directamente por el Cliente mediante mecanismos oficiales de autorización (OAuth/APIs).`,
      `2.2. Publicación de contenidos: Publicar en su nombre el contenido generado según el flujo seleccionado (aprobación manual previa o publicación programada automática).`,
      `2.3. Métricas de rendimiento: Acceder a las estadísticas de las cuentas vinculadas únicamente para generar informes y optimizar los modelos de contenido del Cliente.`,
      `2.4. Mensajes operativos en WhatsApp: Enviar actualizaciones y resúmenes diarios al número de WhatsApp verificado del Cliente. El Cliente puede cancelar la recepción en cualquier momento enviando la palabra "ALTO" (STOP).`,
      `2.5. El Cliente puede desvincular cuentas y revocar permisos en cualquier momento desde la app. BOOL no utilizará dichos permisos para ningún otro fin.`,
    ] },
    { h: "Sección 3 - Inteligencia Artificial (IA), Responsabilidad y Privacidad", items: [
      `3.1. Naturaleza de la IA: Los contenidos y sugerencias son generados por modelos de inteligencia artificial y pueden contener imprecisiones. El asistente es una herramienta de software y no constituye asesoramiento profesional humano.`,
      `3.2. Responsabilidad del Cliente: El Cliente es el único responsable de revisar la veracidad, legalidad y cumplimiento legal de todo contenido antes de su publicación (protección al consumidor, propiedad intelectual, publicidad veraz). Se recomienda la aprobación manual en sectores regulados (salud, legal, finanzas).`,
      `3.3. Exención de responsabilidad por publicaciones: BOOL no se hace responsable del contenido publicado con el consentimiento del Cliente o mediante publicaciones automatizadas configuradas por este, en la medida permitida por la ley.`,
      `3.4. Sin garantía de resultados comerciales: El Servicio se ofrece "TAL CUAL" (AS-IS). BOOL no garantiza resultados comerciales específicos ni incremento en ventas o clientes potenciales.`,
      `3.5. Privacidad de datos: El tratamiento de datos se rige por la Política de Privacidad de BOOL y las normativas aplicables. Los datos del Cliente son de su propiedad y pueden ser editados o eliminados a petición.`,
    ] },
    { h: "Sección 4 - Pagos, Cancelación, Responsabilidad y Jurisdicción", items: [
      `4.1. Pagos: La suscripción se factura por adelantado a través de una pasarela de pago segura certificada PCI-DSS [Nombre de la Pasarela]. BOOL no almacena datos de tarjetas de crédito.`,
      `4.2. Costes de terceros: La inversión publicitaria en campañas (Meta, Google, TikTok Ads) es abonada directamente por el Cliente a las plataformas publicitarias.`,
      `4.3. Cancelación: El Cliente puede cancelar la suscripción en cualquier momento desde la aplicación, teniendo efecto al finalizar el ciclo de facturación abonado, sin perjuicio de la normativa de consumo aplicable.`,
      `4.4. Limitación de responsabilidad: La responsabilidad total de BOOL se limita al importe abonado efectivamente por el Cliente en los últimos 12 meses. BOOL no será responsable por daños indirectos o bloqueos por parte de plataformas externas.`,
      `4.5. Cambios en los términos: Los cambios sustanciales en perjuicio del Cliente se notificarán con 30 días de antelación, permitiendo la cancelación sin penalización.`,
      `4.6. Ley aplicable y jurisdicción: Leyes del Estado de Israel. Jurisdicción exclusiva en los tribunales competentes de [Tel Aviv-Yafo / Haifa].`,
    ] },
  ],
  checks: [
    "He leído, comprendo y acepto los Términos de Servicio y la Política de Privacidad de BOOL AI.",
    "Autorizo a BOOL a gestionar y publicar contenido en mis cuentas vinculadas (Sección 2).",
    "Reconozco que el contenido es generado por IA y que soy responsable de revisarlo antes de su publicación (Sección 3).",
    "Acepto recibir notificaciones operativas en WhatsApp en mi número de teléfono verificado.",
    "Acepto los términos de Pago, Cancelación y Limitación de Responsabilidad (Sección 4).",
  ],
  ui: { signHere: "Firma del cliente (con el dedo o lápiz)", clear: "Borrar firma", submit: "Completar registro y firmar", signedBy: "Nombre del firmante", date: "Fecha", businessId: "NIF/CIF/ID", printNote: "Para firma manuscrita", checksTitle: "Confirmaciones y consentimientos" },
};

const ar: TermsDoc = {
  lang: "ar", dir: "rtl", flag: "🇸🇦", name: "العربية",
  title: "اتفاقية شروط الاستخدام وموافقة العميل – BOOL AI",
  version: `الإصدار: ${TERMS_VERSION} | مسودة لمراجعة المحامي فقط`,
  sections: [
    { h: "القسم 1 - الأطراف وطبيعة الخدمة", items: [
      `1.1. تم إبرام هذه الاتفاقية بين [اسم الشركة المشغلة]، رقم السجل [رقم التسجيل]، وعنوانها [عنوان الشركة] (المشار إليها بـ: "BOOL")، والعميل المحدد في بيانات التسجيل (المشار إليه بـ: "العميل").`,
      `1.2. توفر شركة BOOL منصة برمجية مؤتمتة لإدارة التسويق الرقمي تشمل: إنشاء المحتوى، جدولة ونشر المنشورات على منصات التواصل، موقع/نطاق إلكتروني، مساعد شخصي ذكي (عبر التطبيق والواتساب)، وتقارير أداء (المشار إليها بـ: "الخدمة").`,
      `1.3. تفاصيل الباقة والأسعار محددة في صفحة الاشتراك وتعتبر جزءاً لا يتجزأ من هذا الاتفاق.`,
      `1.4. تعمل الخدمة تلقائياً دون تدخل بشري دائم. يتم الإبلاغ عن الأعطال عبر نموذج "الإبلاغ عن خلل" في التطبيق ومعالجتها وفق معايير الخدمة.`,
    ] },
    { h: "القسم 2 - الصلاحيات والنشر بالنيابة عن العميل", intro: "يمنح العميل شركة BOOL إذناً صريحاً خلال فترة الاشتراك النشطة فقط للقيام بما يلي:", items: [
      `2.1. ربط الحسابات: ربط حسابات التواصل الاجتماعي (Meta - فيسبوك وإنستغرام، تيك توك، واتساب) التي قام العميل بربطها عبر بروتوكولات التفويض الرسمية (OAuth/APIs).`,
      `2.2. نشر المحتوى: نشر المحتوى المُنشأ وفق إعدادات الموافقة المختارة (الموافقة اليدوية المسبقة أو النشر التلقائي).`,
      `2.3. بيانات الأداء: الوصول إلى إحصائيات الحسابات المرتبطة فقط لغرض إعداد التقارير وتحسين نماذج المحتوى الخاصة بالعميل.`,
      `2.4. رسائل الواتساب التشغيلية: إرسال تحديثات وإشعارات تشغيلية إلى رقم الواتساب المعتمد. يمكن الإلغاء في أي وقت بإرسال كلمة "قف" (STOP).`,
      `2.5. يحق للعميل إلغاء الصلاحيات وفصل الحسابات في أي وقت عبر التطبيق. تتعهد BOOL بعدم استخدام الصلاحيات لأي غرض آخر.`,
    ] },
    { h: "القسم 3 - الذكاء الاصطناعي (AI)، المسؤولية عن المحتوى والخصوصية", items: [
      `3.1. طبيعة الذكاء الاصطناعي: يتم إنشاء المحتوى والتوصيات بواسطة نماذج ذكاء اصطناعي وقد تحتوي على أخطاء. المساعد الذكي أداة حاسوبية وليس جهة بشرية أو مستشاراً مهنياً.`,
      `3.2. مسؤولية العميل: يتحمل العميل المسؤولية الكاملة عن تدقيق دقة المحتوى ومطابقته للقوانين قبل النشر (حماية المستهلك، حقوق النشر). يوصى بالموافقة اليدوية للمجالات الخاضعة للرقابة (الطب، القانون، المالية).`,
      `3.3. إخلاء المسؤولية عن النشر: لا تتحمل BOOL أي مسؤولية عن المحتوى المنشور بموافقة العميل أو عبر النشر التلقائي المفعل من قبله وفقاً للقانون.`,
      `3.4. عدم ضمان النتائج: تُقدم الخدمة "كما هي" (AS-IS). لا تضمن BOOL أي نتائج تجارية أو زيادة في المبيعات والعملاء المحتملين.`,
      `3.5. الخصوصية: تتم معالجة البيانات وفقاً لسياسة الخصوصية وقوانين حماية البيانات. بيانات العميل ملك له ويحق له تعديلها أو طلب حذفها في أي وقت.`,
    ] },
    { h: "القسم 4 - الدفع، الإلغاء، وتحديد المسؤولية", items: [
      `4.1. الدفع: تُدفع رسوم الاشتراك مسبقاً عبر مزود دفع آمن معتمد [اسم المزود]. لا يتم حفظ بيانات البطاقات في خوادم BOOL.`,
      `4.2. نفقات الطرف الثالث: تُدفع ميزانيات الحملات الإعلانية الممولة مباشرة لمنصات الإعلانات ولا تشملها رسوم اشتراك BOOL.`,
      `4.3. الإلغاء: يحق للعميل إلغاء الاشتراك في أي وقت عبر التطبيق، ويسري الإلغاء بنهاية فترة الفاتورة الحالية المدفوعة، مع مراعاة قوانين حماية المستهلك المعمول بها.`,
      `4.4. تحديد المسؤولية: تقتصر المسؤولية الإجمالية لـ BOOL على المبلغ المدفوع فعلياً من العميل خلال الـ 12 شهراً السابقة للحدث. لا تتحمل BOOL مسؤولية الأضرار غير المباشرة أو إغلاق الحسابات من قبل المنصات الخارجية.`,
      `4.5. التعديلات: سيتم إخطار العميل بأي تعديل جوهري قبل 30 يوماً مع إمكانية الإلغاء دون غرامة.`,
      `4.6. القانون المعمول به: قوانين دولة إسرائيل، ويكون الاختصاص القضائي لمحاكم [تل أبيب - يافا / حيفا].`,
    ] },
  ],
  checks: [
    "قرأت وفهمت وأوافق على شروط الاستخدام وسياسة الخصوصية الخاصة بـ BOOL AI.",
    "أمنح BOOL الإذن بإدارة ونشر المحتوى في حساباتي المرتبطة (القسم 2).",
    "أدرك أن المحتوى تم إنشاؤه بواسطة الذكاء الاصطناعي وأتحمل مسؤولية مراجعته قبل النشر (القسم 3).",
    "أوافق على استلام الإشعارات والتحديثات التشغيلية عبر الواتساب على رقمي المعتمد.",
    "أوافق على شروط الدفع، الإلغاء، وتحديد المسؤولية الموضحة (القسم 4).",
  ],
  ui: { signHere: "توقيع العميل (بالإصبع أو القلم)", clear: "مسح التوقيع", submit: "إكمال التسجيل والتوقيع", signedBy: "اسم الموقّع", date: "التاريخ", businessId: "رقم السجل / الهوية", printNote: "للتوقيع اليدوي بالقلم", checksTitle: "الإقرارات والموافقات" },
};

const ru: TermsDoc = {
  lang: "ru", dir: "ltr", flag: "🇷🇺", name: "Русский",
  title: "Пользовательское соглашение и согласие клиента – BOOL AI",
  version: `Версия: ${TERMS_VERSION} | Проект для проверки юристом`,
  sections: [
    { h: "Раздел 1 - Стороны и описание сервиса", items: [
      `1.1. Настоящее Соглашение заключено между [Наименование компании], рег. номер [Номер компании/ИП], адрес [Адрес компании] ("BOOL"), и Клиентом, указанным в регистрационных данных ("Клиент").`,
      `1.2. Компания BOOL предоставляет автоматизированную платформу цифрового маркетинга: создание контента, планирование и публикация в соцсетях, сайт/домен, персональный ИИ-ассистент (в приложении и WhatsApp) и аналитика (далее: "Сервис").`,
      `1.3. Условия тарифов и периоды оплаты указаны на странице подписки и являются неотъемлемой частью Соглашения.`,
      `1.4. Сервис работает автоматически без постоянного участия человека. Технические проблемы принимаются через форму «Сообщить о проблеме» в приложении.`,
    ] },
    { h: "Раздел 2 - Полномочия и публикации от имени Клиента", intro: "Клиент предоставляет BOOL право действовать от своего имени исключительно в период активной подписки:", items: [
      `2.1. Подключение аккаунтов: Подключать социальные сети (Meta - Facebook и Instagram, TikTok, WhatsApp и др.), добавленные Клиентом через официальные протоколы OAuth/API.`,
      `2.2. Публикация контента: Публиковать материалы согласно выбранному режиму (ручное согласование перед публикацией или автопостинг).`,
      `2.3. Сбор аналитики: Получать статистику подключенных аккаунтов исключительно для отчетов и оптимизации ИИ-моделей Клиента.`,
      `2.4. Сервисные уведомления в WhatsApp: Отправлять обновления и системные сводки на верифицированный WhatsApp Клиента. Отписаться можно в любое время командой «СТОП» (STOP).`,
      `2.5. Клиент может отозвать полномочия в любое время в приложении. BOOL обязуется не использовать полномочия в иных целях.`,
    ] },
    { h: "Раздел 3 - Искусственный интеллект (ИИ), ответственность за контент и конфиденциальность", items: [
      `3.1. Технология ИИ: Контент и ответы генерируются моделями ИИ и могут содержать неточности. Ассистент является программным алгоритмом и не заменяет человека или профессионального консультанта.`,
      `3.2. Ответственность за контент: Клиент несет полную ответственность за проверку достоверности и юридической чистоты материалов перед публикацией (защита прав потребителей, авторские права). Рекомендуется ручная проверка в регулируемых сферах (медицина, финансы, право).`,
      `3.3. Отказ от ответственности: BOOL не несет ответственности за контент, опубликованный с согласия Клиента или в настроенном им режиме автопостинга, в допускаемых законом пределах.`,
      `3.4. Отсутствие гарантий: Сервис предоставляется «КАК ЕСТЬ» (AS-IS). BOOL не гарантирует конкретных коммерческих результатов, продаж или лидов.`,
      `3.5. Конфиденциальность: Обработка данных регулируется Политикой конфиденциальности. Данные Клиента принадлежат ему и могут быть удалены по запросу.`,
    ] },
    { h: "Раздел 4 - Оплата, отмена, ответственность и подсудность", items: [
      `4.1. Оплата: Подписка оплачивается авансом через сертифицированный шлюз [Название шлюза]. BOOL не хранит данные карт.`,
      `4.2. Расходы третьих лиц: Рекламные бюджеты (Meta, Google, TikTok Ads) оплачиваются Клиентом напрямую рекламным сетям.`,
      `4.3. Отмена: Клиент вправе отменить подписку в любой момент в приложении с действием в конце оплаченного периода, с учетом применимых норм о защите прав потребителей.`,
      `4.4. Ограничение ответственности: Совокупная ответственность BOOL ограничена суммой, фактически уплаченной Клиентом за последние 12 месяцев. BOOL не несет ответственности за косвенные убытки или блокировку внешними сервисами.`,
      `4.5. Изменения условий: О существенных изменениях условий Клиент будет уведомлен за 30 дней с правом расторжения без штрафа.`,
      `4.6. Применимое право: Законодательство Государства Израиль. Исключительная подсудность судов г. [Тель-Авив — Яффо / Хайфа].`,
    ] },
  ],
  checks: [
    "Я прочитал(а), понял(а) и принимаю Условия использования и Политику конфиденциальности BOOL AI.",
    "Я разрешаю BOOL публиковать контент на моих подключенных аккаунтах (Раздел 2).",
    "Я понимаю, что контент создан ИИ, и несу ответственность за его проверку перед публикацией (Раздел 3).",
    "Я согласен(на) получать сервисные уведомления в WhatsApp на верифицированный номер.",
    "Я принимаю условия оплаты, отмены и ограничения ответственности (Раздел 4).",
  ],
  ui: { signHere: "Подпись клиента (пальцем или стилусом)", clear: "Очистить подпись", submit: "Завершить регистрацию и подписать", signedBy: "Имя подписанта", date: "Дата", businessId: "Рег. номер / ИНН", printNote: "Для подписи ручкой", checksTitle: "Подтверждения и согласия" },
};

export const TERMS: Record<TermsLang, TermsDoc> = { he, en, es, ar, ru };
export const isTermsLang = (l: unknown): l is TermsLang => typeof l === "string" && (TERMS_LANGS as readonly string[]).includes(l);

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export interface SignedCopy { businessName: string; signatory: string; taxId: string; email: string; phone: string; plan: string; acceptedAt: string; signaturePng?: string; checked: boolean[] }

/** A4 print page (blank signature lines) or the signed copy (filled fields + signature image). */
export function termsHtml(lang: TermsLang, signed?: SignedCopy): string {
  const d = TERMS[lang];
  const sections = d.sections.map((s) => `<h2>${esc(s.h)}</h2>${s.intro ? `<p class="intro">${esc(s.intro)}</p>` : ""}${s.items.map((i) => `<p>${esc(i)}</p>`).join("")}`).join("");
  const checks = d.checks.map((c, i) => `<li><span class="box">${signed ? (signed.checked[i] ? "☑" : "☐") : "☐"}</span> ${esc(c)}</li>`).join("");
  const line = (label: string, val?: string) => `<div class="f"><b>${esc(label)}:</b> ${val ? esc(val) : '<span class="ln"></span>'}</div>`;
  const sig = signed?.signaturePng && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(signed.signaturePng) ? `<img class="sig" alt="signature" src="${signed.signaturePng}">` : '<div class="sigbox"></div>';
  return `<!doctype html><html lang="${lang}" dir="${d.dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(d.title)}</title>
<style>
@page{size:A4;margin:18mm}
body{font:14px/1.6 system-ui,-apple-system,"Segoe UI",Arial,sans-serif;color:#111;max-width:780px;margin:0 auto;padding:20px;background:#fff}
h1{font-size:22px;margin:0 0 4px}.ver{color:#555;font-size:12px;margin:0 0 18px}
h2{font-size:16px;margin:20px 0 6px;border-bottom:1px solid #ccc;padding-bottom:3px;break-after:avoid}
p{margin:5px 0;text-align:justify}.intro{font-weight:600}
ul{list-style:none;padding:0;margin:8px 0}li{margin:6px 0}.box{font-size:18px;margin-inline-end:6px}
.f{margin:8px 0}.ln{display:inline-block;border-bottom:1px solid #000;min-width:260px}
.sigbox{height:90px;border:1px solid #000;margin-top:6px}.sig{height:90px;border:1px solid #999;margin-top:6px;background:#fff}
.bar{display:flex;gap:8px;margin-bottom:14px}.bar button{padding:8px 14px;font:inherit;cursor:pointer}
@media print{.bar{display:none}body{padding:0}}
</style></head><body>
<div class="bar"><button onclick="window.print()">🖨 Print / Save PDF</button></div>
<h1>${esc(d.title)}</h1><p class="ver">${esc(d.version)}</p>
${sections}
<h2>${esc(d.ui.checksTitle)}</h2><ul>${checks}</ul>
${line(d.ui.signedBy, signed?.signatory)}${line("BOOL / " + d.ui.businessId, signed ? `${signed.businessName} · ${signed.taxId}` : "")}${line(d.ui.date, signed ? signed.acceptedAt.slice(0, 10) : "")}
<div class="f"><b>${esc(d.ui.signHere)}:</b></div>${sig}
</body></html>`;
}
