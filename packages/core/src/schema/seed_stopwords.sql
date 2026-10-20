-- Semillas de palabras vacías (stop words) por idioma.
-- Idioma ISO 639-1. Claves primarias (language, word) — inserciones idempotentes.

INSERT OR IGNORE INTO stop_words (language, word) VALUES
-- Español
('es','de'),('es','la'),('es','que'),('es','el'),('es','en'),('es','y'),('es','a'),('es','los'),('es','del'),('es','se'),
('es','las'),('es','por'),('es','un'),('es','para'),('es','con'),('es','no'),('es','una'),('es','su'),('es','al'),('es','lo'),
('es','como'),('es','más'),('es','pero'),('es','sus'),('es','le'),('es','ya'),('es','o'),('es','este'),('es','sí'),('es','porque'),
('es','esta'),('es','entre'),('es','cuando'),('es','muy'),('es','sin'),('es','sobre'),('es','también'),('es','me'),('es','hasta'),('es','hay'),
('es','donde'),('es','quien'),('es','desde'),('es','todo'),('es','nos'),('es','durante'),('es','todos'),('es','uno'),('es','les'),('es','ni'),
('es','contra'),('es','otros'),('es','ese'),('es','eso'),('es','ante'),('es','ellos'),('es','e'),('es','esto'),('es','mí'),('es','antes'),
('es','algunos'),('es','qué'),('es','unos'),('es','yo'),('es','otro'),('es','otras'),('es','otra'),('es','él'),('es','tanto'),('es','esa'),
('es','estos'),('es','mucho'),('es','quienes'),('es','nada'),('es','poco'),('es','ella'),('es','estar'),('es','estas'),('es','algunas'),('es','algo'),
('es','nosotros'),('es','mi'),('es','mis'),('es','tú'),('es','te'),('es','ti'),('es','tu'),('es','tus'),('es','ellas'),('es','nosotras'),
('es','vosotros'),('es','vosotras'),('es','os'),('es','mío'),('es','mía'),('es','tuyo'),('es','tuya'),('es','suyo'),('es','suya'),('es','nuestro'),
('es','nuestra'),('es','vuestro'),('es','vuestra'),('es','cual'),('es','cuales'),('es','cuán'),('es','cuándo'),('es','cuánto'),('es','dónde'),('es','cómo'),
('es','por qué'),('es','pues'),('es','aunque'),('es','sino'),('es','mientras'),('es','según'),('es','mediante'),('es','excepto'),('es','salvo'),('es','incluso'),

-- Inglés
('en','the'),('en','be'),('en','to'),('en','of'),('en','and'),('en','a'),('en','in'),('en','that'),('en','have'),('en','i'),
('en','it'),('en','for'),('en','not'),('en','on'),('en','with'),('en','he'),('en','as'),('en','you'),('en','do'),('en','at'),
('en','this'),('en','but'),('en','his'),('en','by'),('en','from'),('en','they'),('en','we'),('en','say'),('en','her'),('en','she'),
('en','or'),('en','an'),('en','will'),('en','my'),('en','one'),('en','all'),('en','would'),('en','there'),('en','their'),('en','what'),
('en','so'),('en','up'),('en','out'),('en','if'),('en','about'),('en','who'),('en','get'),('en','which'),('en','go'),('en','me'),
('en','when'),('en','make'),('en','can'),('en','like'),('en','time'),('en','no'),('en','just'),('en','him'),('en','know'),('en','take'),
('en','people'),('en','into'),('en','year'),('en','your'),('en','good'),('en','some'),('en','could'),('en','them'),('en','see'),('en','other'),
('en','than'),('en','then'),('en','now'),('en','look'),('en','only'),('en','come'),('en','its'),('en','over'),('en','think'),('en','also'),
('en','back'),('en','after'),('en','use'),('en','two'),('en','how'),('en','our'),('en','work'),('en','first'),('en','well'),('en','way'),
('en','even'),('en','new'),('en','want'),('en','because'),('en','any'),('en','these'),('en','give'),('en','day'),('en','most'),('en','us'),

-- Portugués
('pt','de'),('pt','a'),('pt','o'),('pt','que'),('pt','e'),('pt','do'),('pt','da'),('pt','em'),('pt','um'),('pt','para'),
('pt','é'),('pt','com'),('pt','não'),('pt','uma'),('pt','os'),('pt','no'),('pt','se'),('pt','na'),('pt','por'),('pt','mais'),
('pt','as'),('pt','dos'),('pt','como'),('pt','mas'),('pt','foi'),('pt','ao'),('pt','ele'),('pt','das'),('pt','tem'),('pt','à'),
('pt','seu'),('pt','sua'),('pt','ou'),('pt','ser'),('pt','quando'),('pt','muito'),('pt','há'),('pt','nos'),('pt','já'),('pt','está'),
('pt','eu'),('pt','também'),('pt','só'),('pt','pelo'),('pt','pela'),('pt','até'),('pt','isso'),('pt','ela'),('pt','entre'),('pt','era'),
('pt','depois'),('pt','sem'),('pt','mesmo'),('pt','aos'),('pt','ter'),('pt','seus'),('pt','quem'),('pt','nas'),('pt','me'),('pt','esse'),
('pt','eles'),('pt','estão'),('pt','você'),('pt','tinha'),('pt','foram'),('pt','nessa'),('pt','tem'),('pt','num'),('pt','nem'),('pt','suas'),
('pt','meu'),('pt','às'),('pt','minha'),('pt','têm'),('pt','numa'),('pt','pelos'),('pt','elas'),('pt','havia'),('pt','seja'),('pt','qual'),

-- Francés
('fr','le'),('fr','la'),('fr','les'),('fr','de'),('fr','des'),('fr','un'),('fr','une'),('fr','du'),('fr','et'),('fr','à'),
('fr','en'),('fr','que'),('fr','qui'),('fr','est'),('fr','dans'),('fr','pour'),('fr','pas'),('fr','par'),('fr','sur'),('fr','il'),
('fr','elle'),('fr','ne'),('fr','ce'),('fr','cet'),('fr','cette'),('fr','ces'),('fr','au'),('fr','aux'),('fr','avec'),('fr','plus'),
('fr','comme'),('fr','mais'),('fr','ou'),('fr','son'),('fr','sa'),('fr','ses'),('fr','leur'),('fr','leurs'),('fr','nous'),('fr','vous'),
('fr','ils'),('fr','elles'),('fr','se'),('fr','sont'),('fr','été'),('fr','être'),('fr','avoir'),('fr','fait'),('fr','tout'),('fr','tous'),
('fr','toute'),('fr','toutes'),('fr','moi'),('fr','toi'),('fr','lui'),('fr','eux'),('fr','je'),('fr','tu'),('fr','on'),('fr','y'),
('fr','en'),('fr','si'),('fr','quand'),('fr','où'),('fr','comment'),('fr','pourquoi'),('fr','aussi'),('fr','très'),('fr','bien'),('fr','encore')
;