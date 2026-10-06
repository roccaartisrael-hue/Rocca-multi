#!/usr/bin/env python3
"""Builds the SEO guide pages (guides.html + guide-*.html) in ROCCA's own design.

Reuses the head/styles/WhatsApp button/footer of guide-backlit-stone-walls.html (the template page).
Usage: python3 tools/make_guides.py
"""
import json, re
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
tpl = (ROOT / "guide-backlit-stone-walls.html").read_text()
FONTS = re.search(r'<link rel="preconnect" href="https://fonts.googleapis.com">.*?rel="stylesheet">', tpl, re.S).group(0)
STYLE = re.search(r"<style>.*?</style>", tpl, re.S).group(0)
WA = re.search(r'<a class="whatsapp-float".*?</a>', tpl, re.S).group(0)
FOOTER = re.search(r"<footer>.*?</footer>", tpl, re.S).group(0)
WA_LINK = "https://wa.me/19093443250?text=%D7%94%D7%99%D7%99%2C%20%D7%90%D7%A0%D7%99%20%D7%9E%D7%AA%D7%A2%D7%A0%D7%99%D7%99%D7%9F%20%D7%91%D7%90%D7%91%D7%9F%20%D7%98%D7%91%D7%A2%D7%99%D7%AA"

def img(path, alt, eager=False):
    w, h = Image.open(ROOT / path).size
    lazy = "" if eager else ' loading="lazy"'
    return f'<img src="{path}" width="{w}" height="{h}" alt="{alt}"{lazy}>'

GUIDES = [
    dict(
        slug="guide-onyx-vs-marble-granite-quartzite",
        title="אוניקס, שיש, גרניט וקוורציט: מה מתאים לאיזה חלל",
        desc="מדריך להשוואה בין אוניקס, שיש, גרניט וקוורציט: מה כל אבן נותנת, איפה היא מתאימה, ומה כדאי לדעת על תחזוקה, כדי לבחור נכון לפרויקט.",
        hero="images/designs/kitchen-island.webp", hero_alt="אי מטבח באבן טבעית",
        kicker="מדריך בחירה", h1="איזו אבן מתאימה לאיזה חלל",
        lede="אבן טבעית היא לא חומר אחד. לכל סוג יש אופי, חוזקות ונקודות שכדאי להכיר לפני שמחליטים. הנה סקירה קצרה שעוזרת להתחיל.",
        sections=[
            ("אוניקס: האבן שמעבירה אור", ["אוניקס בולט בצבעים ובעורקים שלו, וביכולת שלו להעביר אור. לכן הוא מתאים במיוחד לקירות מוארים, ברים, דלפקים ואלמנטים עיצוביים שרוצים שיהיו במרכז. הוא אבן עדינה יחסית, ולכן בדרך כלל בוחרים אותו לאלמנטים שיש בהם פחות שחיקה יומיומית. כל לוח ייחודי, ולכן בוחרים את הלוח עצמו."]),
            ("שיש: הקלאסיקה", ["שיש מוכר בזכות המראה העדין והעורקים הטבעיים. הוא מתאים לקירות, לחדרי רחצה, לרצפות ולמשטחים, והוא דורש טיפול בהתאם: אבן טבעית נקבובית, ולכן חשוב להגן עליה ולהתייעץ על ציפוי ותחזוקה. כדאי לדעת שחומרים חומציים עלולים להשאיר סימנים על שיש."]),
            ("גרניט: העמידות", ["גרניט ידוע בעמידות שלו, ולכן הוא בחירה נפוצה למשטחי עבודה במטבח ולמקומות עם שימוש אינטנסיבי. יש בו מגוון רחב של צבעים ודוגמאות, מגרניטים כהים ועד גוונים בהירים ושקופי עורקים."]),
            ("קוורציט: אבן טבעית קשה", ["קוורציט הוא אבן טבעית קשה ועמידה, שלעיתים נראית דומה לשיש בעורקים העדינים שלה. הוא נבחר הרבה למשטחים ולחלל עם שימוש רב, כשרוצים שילוב של יופי טבעי ועמידות. (שימו לב: קוורציט הוא אבן טבעית, ושונה מקוורץ מהונדס.)"]),
            ("איך מחליטים?", ["שואלים שלוש שאלות: מה תפקיד האבן בחלל (פונקציה או אלמנט עיצובי), כמה שימוש תקבל, ואיזה מראה רוצים לקבל. אחר כך מסתכלים על הלוח עצמו ולא רק על דוגמה. אנחנו כאן כדי לעזור לבחור, במיוחד כשעובדים עם מעצב או אדריכל."]),
        ],
        faq=[("איזו אבן הכי מתאימה למשטח מטבח?", "בדרך כלל בוחרים אבנים קשות ועמידות כמו גרניט או קוורציט. נשמח להמליץ לפי מה שחשוב לכם, כולל המראה והתחזוקה."),
             ("האם אפשר להשתמש באוניקס במטבח?", "אוניקס מתאים יותר לאלמנטים עיצוביים כמו קיר, בר או דלפק, בגלל העדינות שלו. אם רוצים אותו במטבח, כדאי לתכנן את השימוש בו ולהתייעץ איתנו."),
             ("האם שיש דורש תחזוקה מיוחדת?", "כן. שיש הוא אבן נקבובית, ולכן כדאי להגן עליו ולהימנע מחומרים חומציים. נשמח לייעץ על טיפול נכון.")],
        gallery=[("images/designs/dining-onyx-panels.webp", "קירות אוניקס בחדר אוכל"), ("images/designs/fireplace.webp", "אח מצופה אבן"), ("images/designs/kitchen-island.webp", "אי מטבח באבן טבעית")],
        cta_h="לא בטוחים איזו אבן לבחור?", cta_p="ספרו לנו על הפרויקט ונעזור לבחור אבן מתאימה, מהמעצב ועד לבעלי הבית.",
    ),
    dict(
        slug="guide-choosing-onyx-slab",
        title="איך בוחרים לוח אוניקס: מדריך לבעלי בתים ומעצבים",
        desc="איך בוחרים לוח אוניקס? מה לבדוק בלוח עצמו, איך האור משפיע על המראה, ומה כדאי לתכנן לפני החיתוך וההתקנה.",
        hero="images/onyx-mexico/slab-01.webp", hero_alt="לוח אוניקס מואר בגוונים של זהב",
        kicker="מדריך בחירה", h1="איך בוחרים לוח אוניקס",
        lede="באוניקס אין שני לוחות זהים. לכן הבחירה היא בחירה של לוח ספציפי, ולא של דוגמה מקטלוג. הנה מה שכדאי לבדוק.",
        sections=[
            ("1. מתחילים מהשימוש", ["קיר, בר, דלפק או אלמנט דקורטיבי? ואם הוא יואר מאחור או לא? התשובה משפיעה על הגוון, על העורקים ועל כמות האור שרוצים להעביר."]),
            ("2. מסתכלים על הלוח כולו", ["העורקים והגוונים משתנים לאורך הלוח. כדאי לראות את הלוח כולו ולא קטע ממנו, ולבדוק איפה העורקים בולטים ואיפה האבן שקטה יותר, כדי להחליט איזה חלק יבלוט בחלל."]),
            ("3. בודקים עם אור", ["אותו לוח נראה אחרת באור יום, באור חם ובתאורה מאחור. אם הלוח יואר, חשוב לראות או לקבל תמונה שלו מואר."]),
            ("4. מתכננים חיתוך ותפרים", ["כשצריך כמה לוחות, אפשר לשלב אותם כך שהעורקים יתחברו בצורה חלקה. זה נעשה בתכנון מראש, יחד עם מי שחותך ומתקין."]),
            ("5. חושבים על תחזוקה", ["אוניקס הוא אבן עדינה יחסית, ולכן חשוב לבחור את מקומו נכון ולטפל בו בהתאם. נשמח לייעץ בנושא."]),
            ("6. עובדים יחד", ["הכי טוב לשלב את המעצב, האדריכל והמתקין כבר בבחירה, כדי שהלוח, התאורה והחיתוך יתואמו מראש."]),
        ],
        faq=[("האם אפשר לבחור את הלוח עצמו?", "כן. אצלנו בוחרים את הלוח עצמו, כי כל לוח ייחודי."),
             ("מה ההבדל בין לוחות אוניקס?", "הגוון, העורקים והתבניות הטבעיות. אין שני לוחות זהים."),
             ("האם צריך לתכנן תאורה מראש?", "כן, אם הלוח יואר. כדאי לתכנן מראש את סוג התאורה, הפיזור והגישה לתחזוקה.")],
        gallery=[("images/onyx-mexico/slab-01.webp", "לוח אוניקס זהב"), ("images/onyx-mexico/slab-03.webp", "לוח אוניקס עם מעגלים טבעיים"), ("images/onyx-mexico/slab-04.webp", "לוח אוניקס בעורקים אלכסוניים")],
        cta_h="רוצים לראות לוחות אוניקס?", cta_p="מוזמנים לשלוח הודעה, ונשמח להראות לוחות ולעזור לבחור.",
    ),
    dict(
        slug="guide-stone-sinks",
        title="כיורים באבן טבעית: מוארים ולא מוארים",
        desc="כיור באבן טבעית: מה זה נותן לחדר רחצה ולמטבח, ההבדל בין כיור מואר ללא מואר, ומה כדאי לתכנן לפני ההזמנה.",
        hero="images/designs/reception-glow.webp", hero_alt="אלמנט אבן מואר",
        kicker="מדריך", h1="כיורים באבן טבעית",
        lede="כיור באבן הוא לא רק פונקציה: הוא הופך לפריט עיצוב. הנה מה שכדאי לדעת לפני שמזמינים.",
        sections=[
            ("למה כיור באבן?", ["כל כיור נחתך מאבן טבעית, ולכן יש בו גוון ועורקים שלא חוזרים על עצמם. מפעל חיתוך שעובד עם האבן יכול להתאים את המידות והצורה לחלל שלכם."]),
            ("כיור לא מואר", ["הבחירה הקלאסית לחדר רחצה ולמטבח. מתאים לשיש, גרניט ואבנים אחרות, לפי העמידות הנדרשת לשימוש."]),
            ("כיור מואר", ["כשהאבן מעבירה אור, אפשר להאיר את הכיור מבפנים או מתחתיו, והוא הופך לאלמנט מרכזי. זה דורש תכנון מראש של התאורה, החשמל והגישה לתחזוקה."]),
            ("מה לתכנן מראש", ["מידות ועומק הכיור, מיקום הברז והניקוז, סוג האבן ותחזוקתה, ואם הכיור יואר, גם את התאורה והחשמל. כדאי לשלב את המתקין והמעצב בתכנון."]),
        ],
        faq=[("אפשר לבחור כל אבן לכיור?", "לא כל אבן מתאימה לכל שימוש. נשמח לייעץ לפי החלל והשימוש בו."),
             ("האם כיור מואר דורש תחזוקה מיוחדת?", "צריך לתכנן גישה לתאורה ולחשמל מראש. נשמח להסביר בהתאם לפרויקט."),
             ("אפשר לראות לפני ההזמנה?", "כן, מוזמנים לבקר בשואו-רום או לשלוח הודעה.")],
        gallery=[("images/designs/reception-glow.webp", "אלמנט אבן מואר"), ("images/designs/bar-glow.webp", "בר מואר"), ("images/designs/kitchen-island.webp", "אי מטבח באבן")],
        cta_h="חושבים על כיור באבן?", cta_p="ספרו לנו על החלל ונעזור לבחור סוג אבן, גודל וסגנון.",
    ),
    dict(
        slug="guide-stone-kitchen-countertops",
        title="אבן טבעית למטבח: איך בוחרים משטח",
        desc="איך בוחרים משטח אבן טבעית למטבח: שיש, גרניט וקוורציט, מה חשוב לבדוק, ומה כדאי לתכנן יחד עם המעצב.",
        hero="images/designs/kitchen-island.webp", hero_alt="אי מטבח באבן טבעית",
        kicker="מדריך", h1="משטח אבן למטבח",
        lede="המטבח הוא החלל שבו האבן עובדת הכי קשה. הנה כמה שאלות שכדאי לשאול לפני שבוחרים.",
        sections=[
            ("כמה שימוש יהיה?", ["מטבח שמבשלים בו כל יום צריך אבן עמידה יותר ממטבח לשימוש מועט. נשמח לייעץ איזו אבן מתאימה לאורח החיים שלכם."]),
            ("איזה מראה אתם רוצים?", ["גוון, עורקים ויחס בין האבן לשאר החלל קובעים את האופי. כדאי לראות את הלוח עצמו ולא רק דוגמה קטנה."]),
            ("מה עם תחזוקה?", ["לכל אבן טבעית יש דרישות טיפול משלה. כדאי לשאול מראש איך מטפלים באבן שבחרתם ומה כדאי להימנע ממנו."]),
            ("תכנון משותף", ["מעצבים ואדריכלים מקצרים תהליכים כשמשלבים אותם כבר בבחירת האבן, יחד עם המתקין, כדי שהחיתוך, התפרים והכיור יתואמו."]),
        ],
        faq=[("איזו אבן הכי מתאימה למטבח?", "תלוי בשימוש ובמראה. נשמח להמליץ, למשל בין גרניט, קוורציט ושיש."),
             ("אפשר לראות את הלוח לפני ההזמנה?", "כן, בוחרים את הלוח עצמו."),
             ("מי חותך ומתקין?", "יש לנו מפעל חיתוך משלנו, ואנחנו מלווים גם את ההתקנה.")],
        gallery=[("images/designs/kitchen-island.webp", "אי מטבח באבן"), ("images/designs/dining-onyx-panels.webp", "קירות אוניקס בחדר אוכל"), ("images/designs/fireplace.webp", "אח מצופה אבן")],
        cta_h="מתכננים מטבח?", cta_p="ספרו לנו על המטבח ונעזור לבחור אבן ולתכנן את המשטח.",
    ),
    dict(
        slug="guide-stone-care",
        title="איך מטפלים באבן טבעית: מדריך קצר",
        desc="מדריך קצר לטיפול באבן טבעית בבית: ניקוי, הגנה ושמירה על המראה של אוניקס, שיש וגרניט.",
        hero="images/designs/living-wall.webp", hero_alt="קיר אבן בסלון",
        kicker="מדריך", h1="טיפול באבן טבעית",
        lede="אבן טבעית יכולה ללוות אתכם שנים, אם מטפלים בה נכון. הנה עקרונות כלליים. לכל אבן יש דרישות משלה, ונשמח לייעץ.",
        sections=[
            ("ניקוי יומיומי", ["ניקוי עדין במים וחומר ניקוי מתאים לאבן טבעית. כדאי לבדוק מראש איזה חומר מתאים לאבן שלכם, ולהימנע מחומרי ניקוי חזקים שעלולים לפגוע בה."]),
            ("להגן על האבן", ["לאבנים מסוימות, כמו שיש ואוניקס, כדאי לשאול על הגנה מתאימה ועל לכלוך וכתמים. ההמלצה תלויה באבן ובמקום שבו היא מותקנת."]),
            ("מה להימנע ממנו", ["חומרים חומציים וחזקים עלולים להשאיר סימנים על אבנים מסוימות. עדיף לנגב נוזלים שנשפכו בהקדם."]),
            ("קירות מוארים", ["בקירות ובכיורים מוארים כדאי להבין מראש איך מגיעים לתאורה לתחזוקה ולהחלפה."]),
        ],
        faq=[("איזה חומר ניקוי מתאים?", "תלוי בסוג האבן. נשמח להמליץ לפי האבן שבחרתם."),
             ("אפשר לטפל בכתם?", "תלוי בסוג הכתם ובאבן. כדאי לפנות אלינו לייעוץ.")],
        gallery=[("images/designs/living-wall.webp", "קיר אבן בסלון"), ("images/designs/wall-yellow-hall.webp", "קיר אבן מואר"), ("images/onyx-mexico/slab-01.webp", "לוח אוניקס")],
        cta_h="צריכים ייעוץ לטיפול באבן?", cta_p="שלחו הודעה ונשמח לעזור.",
    ),
]

def page(g):
    sections = "".join(f"<h2>{h}</h2>" + "".join(f"<p>{p}</p>" for p in ps) for h, ps in g["sections"])
    gal = "".join(f'<figure class="gal">{img(p, a)}<figcaption>{a}</figcaption></figure>' for p, a in g["gallery"])
    faq = "".join(f"<details><summary>{q}</summary><p>{a}</p></details>" for q, a in g["faq"])
    art = json.dumps({"@context": "https://schema.org", "@type": "Article", "headline": g["title"], "inLanguage": "he",
                      "author": {"@type": "Organization", "name": "ROCCA"}, "publisher": {"@type": "Organization", "name": "ROCCA", "url": "https://rocca.co.il/"},
                      "mainEntityOfPage": f"https://rocca.co.il/{g['slug']}.html", "image": f"https://rocca.co.il/{g['hero']}"}, ensure_ascii=False)
    faqld = json.dumps({"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in g["faq"]]}, ensure_ascii=False)
    return f"""<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{g['title']} | ROCCA רוקה</title>
<link rel="canonical" href="https://rocca.co.il/{g['slug']}.html">
<meta name="description" content="{g['desc']}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="ROCCA">
<meta property="og:title" content="{g['title']} | ROCCA">
<meta property="og:description" content="{g['desc']}">
<meta property="og:image" content="https://rocca.co.il/{g['hero']}">
<meta property="og:locale" content="he_IL">
{FONTS}
{STYLE}
<script type="application/ld+json">{art}</script>
<script type="application/ld+json">{faqld}</script>
</head>
<body>
<header class="site"><div class="nav"><a class="brand" href="index.html"><span class="brand-word">ROCCA</span><span class="brand-heb">רוקה</span></a><a class="back" href="guides.html">→ כל המדריכים</a></div></header>
{WA}
<section class="hero">
  {img(g['hero'], g['hero_alt'], eager=True).replace('<img ', '<img ', 1)}
  <div class="hero-inner"><p class="hero-kicker">{g['kicker']}</p><h1>{g['h1']}</h1><p>{g['lede']}</p>
  <div class="actions"><a class="btn-primary" href="{WA_LINK}">שיחה בוואטסאפ</a><a class="btn-ghost" href="collection.html">לקטלוג האבנים</a></div></div>
</section>
<section class="section"><div class="article">
{sections}
<div class="gallery">{gal}</div>
<h2>שאלות נפוצות</h2><div class="faq">{faq}</div>
<div class="related"><a href="guides.html">כל המדריכים</a><a href="collection.html">קטלוג אבנים</a><a href="onyx-mexico.html">אוניקס ממקסיקו</a><a href="designs.html">קטלוג עיצובים</a></div>
</div></section>
<section class="cta-band"><div class="wrap"><h2>{g['cta_h']}</h2><p>{g['cta_p']}</p>
<div class="actions"><a class="btn-primary" href="{WA_LINK}">שיחה בוואטסאפ</a><a class="btn-ghost" href="tel:0536761717">053-676-1717</a></div></div></section>
{FOOTER}
</body></html>"""

ALL = [("guide-backlit-stone-walls", "קירות אבן מוארים: מדריך תכנון", "מה כדאי להחליט לפני שבונים קיר שהאבן שלו זוהרת."),
       ("guide-onyx-vs-marble-granite-quartzite", GUIDES[0]["title"], "סקירה קצרה: מה כל אבן נותנת ואיפה היא מתאימה."),
       ("guide-choosing-onyx-slab", GUIDES[1]["title"], "מה לבדוק בלוח עצמו לפני שבוחרים."),
       ("guide-stone-sinks", GUIDES[2]["title"], "מה לדעת לפני שמזמינים כיור באבן."),
       ("guide-stone-kitchen-countertops", GUIDES[3]["title"], "שאלות שכדאי לשאול לפני שבוחרים משטח."),
       ("guide-stone-care", GUIDES[4]["title"], "עקרונות כלליים לטיפול נכון.")]

def hub():
    cards = "".join(f'<a class="gcard" href="{s}.html"><h3>{t}</h3><p>{d}</p><span>לקריאה ←</span></a>' for s, t, d in ALL)
    extra = STYLE.replace("</style>", ".gcards{display:grid;gap:16px;margin:30px 0;} .gcard{display:block;border:1px solid var(--line);padding:22px;border-radius:4px;background:var(--panel);} .gcard:hover{border-color:var(--gold);} .gcard h3{margin:0 0 8px;font-family:var(--serif);font-size:22px;font-weight:800;} .gcard p{margin:0 0 10px;color:var(--ink-soft);font-size:16px;} .gcard span{font-weight:700;color:var(--gold-deep);}</style>")
    return f"""<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>מדריכים: אבן טבעית, אוניקס וקירות מוארים | ROCCA רוקה</title>
<link rel="canonical" href="https://rocca.co.il/guides.html">
<meta name="description" content="מדריכים קצרים לבחירה ותכנון עם אבן טבעית: אוניקס, שיש, גרניט וקוורציט, וקירות אבן מוארים.">
<meta property="og:type" content="website"><meta property="og:site_name" content="ROCCA"><meta property="og:locale" content="he_IL">
<meta property="og:title" content="מדריכים | ROCCA"><meta property="og:image" content="https://rocca.co.il/images/og-image.jpg">
{FONTS}
{extra}
</head>
<body>
<header class="site"><div class="nav"><a class="brand" href="index.html"><span class="brand-word">ROCCA</span><span class="brand-heb">רוקה</span></a><a class="back" href="index.html">→ חזרה לאתר</a></div></header>
{WA}
<section class="section"><div class="article"><p class="kicker">מדריכים</p><h1 style="font-family:var(--serif);font-size:clamp(32px,5vw,50px);margin:0 0 14px">מדריכים לבחירה ולתכנון</h1>
<p>קצר, מעשי, ובלי מילים גדולות. מה כדאי לדעת לפני שבוחרים אבן טבעית לפרויקט.</p>
<div class="gcards">{cards}</div></div></section>
{FOOTER}
</body></html>"""

for g in GUIDES:
    (ROOT / f"{g['slug']}.html").write_text(page(g))
(ROOT / "guides.html").write_text(hub())
sm = (ROOT / "sitemap.xml").read_text()
for slug in ["guides"] + [g["slug"] for g in GUIDES]:
    if f"/{slug}.html" not in sm:
        sm = sm.replace("</urlset>", f"  <url><loc>https://rocca.co.il/{slug}.html</loc><priority>0.7</priority></url>\n</urlset>")
(ROOT / "sitemap.xml").write_text(sm)
print("built", [g["slug"] for g in GUIDES] + ["guides"])
