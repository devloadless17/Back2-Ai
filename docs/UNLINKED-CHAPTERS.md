# Chapters with no material behind them

88 chapter rows, 46 distinct topics.

Everything mechanically recoverable has been recovered. What is left needs
either a page number from the printed book or a decision to drop the entry.

| cause | topics | what fixes it |
| --- | --- | --- |
| placed, but the chunker produced nothing | 1 | a chunker bug, still open |
| title never located in the book body | 26 | a page number in scripts/corpus/toc-overrides/ |
| not in any book's contents at all | 19 | confirm the pages, or drop the entry |

The located ones were fixed by three changes to taxonomy.py: the chapter
cursor now tracks a position within a page rather than a page, the book’s own
contents page is excluded from the search, and a chapter must have 400
characters of text before the next one starts — which is what stops a unit’s
opening index being mistaken for its sections.

## Placed but empty

- **Sous-thème 1** — Francais (LH)

## Title not found in the body

- **الخاطرة والحكمة في شعر المتنبّي** — Arabe (LH)
- **الكتابة العروضيّة وتقطيع البيت الشعريّ** — Arabe (LH)
- **تعريف المقالة: أسعد نصر الله السكاف** — Arabe (LH)
- **ثريّا ملحس: البحث و تعريفه** — Arabe (GS, LS, SE)
- **مخطَّط بحث بين ابن الرومي و المتنبّي** — Arabe (GS, LS, SE)
- **موقف طاغور من المجتمع و الناس** — Arabe (GS, LS, SE)
- **نماذج من الرسائل** — Arabe (GS, LS, SE)
- **يوحنا قمير: هل في الكواكب إنسان؟** — Arabe (GS, LS, SE)
- **pH. Strong acid, strong base. pH-metric titration** — Chemistry (GS, LS)
- **Acides carboxyliques et dérivés** — Chimie (GS, LS)
- **Amines et acides alpha-aminés** — Chimie (GS, LS)
- **دالة الإنتاج ومروبة الإنتاج** — Economie (SE)
- **سياسة النهضة الاقتصادي** — Economie (SE)
- **الانتخابات البلدية والاختيارية، وانتخابات الجمعيات والنقابات والأحزاب** — Education civique (GS, LH, LS, SE)
- **خدمة العلم في لبنان** — Education civique (GS, LH, LS, SE)
- **Global Concepts** — English (LH)
- **Socio-economic Issues: Emigration, Employment, Production, Living Standards** — English (SE)
- **The Individual and the Environment** — English (LH)
- **A. Robbe-Grillet, Pour un nouveau roman** — Francais (GS, LS)
- **G. de Maupassant, Pierre et Jean. Préface "Le Roman"** — Francais (GS, LS)
- **L'URBANISME** — Francais (SE)
- **LE GENRE DRAMATIQUE** — Francais (LH)
- **Sous-thème I** — Francais (SE)
- **الفعل الإنساني** — Philosophie (GS, LS, SE)
- **الله والحرية الإنسانية (المعتزلة الغزالي)** — Philosophie (LH)
- **التفاوت والتدرج الاجتماعيان** — Sociologie (SE)

## Not in any book's contents

- **Amines and α-amino acids** — Chemistry (GS, LS)
- **Chapter 11: Water and Soil Pollution** — Chemistry (LH, SE)
- **Chapter 12: Solid and Hazardous Wastes** — Chemistry (LH, SE)
- **Chapter 3 Nutritional diseases : characteristics, causes and prevention** — Life Sciences (LH, SE)
- **Diseases of excessive food intake : cardiovascular diseases** — Life Sciences (LH, SE)
- **Food deficiency** — Life Sciences (LH, SE)
- **Qualitative needs : mineral requirements** — Life Sciences (LH, SE)
- **Qualitative needs : requirements in proteins** — Life Sciences (LH, SE)
- **Qualitative needs : requirements in vitamins** — Life Sciences (LH, SE)
- **Qualitative requirements : energetic needs** — Life Sciences (LH, SE)
- **Quantitative needs : energetic needs** — Life Sciences (LH, SE)
- **The fate of nutrients** — Life Sciences (LH, SE)
- **To make a balanced diet** — Life Sciences (LH, SE)
- **Chapitre 5 Drogues et toxicomanie** — Sciences de la vie (LH, SE)
- **Chapitre 6 Les rythmes biologiques** — Sciences de la vie (LH, SE)
- **La toxicomanie, un paradis artificiel** — Sciences de la vie (LH, SE)
- **La vie, une série de variations rythmiques** — Sciences de la vie (LH, SE)
- **Mode d'action des drogues** — Sciences de la vie (LH, SE)
- **Rythmes endogènes ou exogènes ?** — Sciences de la vie (LH, SE)

