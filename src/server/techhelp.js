// Aide du technicien sur le terrain : une petite base de réponses classées par mots-clés.
// Ce n'est PAS une IA : elle ne lit pas les images. Elle cherche des mots dans la question et répond avec des étapes courtes ;
// si elle ne trouve rien, ou si le sujet est risqué, elle conseille de transmettre au responsable. Pas de hasard : même question, même réponse.

export const TECH_TOPICS = [
  { id: 'puissance', title: 'Signal faible ou puissance hors plage', words: ['puissance', 'dbm', 'signal faible', 'attenuation', 'hors plage', 'mesure', 'pas de signal', 'perte'],
    steps: ['Nettoyez les connecteurs avec une lingette sèche, sans toucher l’embout.', 'Vérifiez que le câble n’est ni plié ni écrasé (rayon de courbure : pas de coude serré).', 'Refaites la mesure à la prise murale (PTO), puis sur un autre port si possible.', 'La plage attendue est entre −27 et −8 dBm. Si la mesure reste hors plage, transmettez au responsable avec une photo du raccordement.'], source: 'Guide technicien, mesures optiques', escalate: true },
  { id: 'pto', title: 'Prise optique (PTO) introuvable', words: ['pto', 'prise optique', 'introuvable', 'trouve pas', 'point de raccordement', 'boitier', 'colonne', 'palier'],
    steps: ['Demandez au client où arrive le câble : souvent près de l’entrée ou du compteur.', 'En immeuble, regardez le palier ou le local technique : demandez l’accès au gardien.', 'Prenez une photo de ce que vous voyez et décrivez le lieu : le responsable peut vérifier le plan du raccordement.'], source: 'Guide technicien, raccordement', escalate: true },
  { id: 'box', title: 'La box ne s’allume pas ou un voyant est rouge', words: ['box', 'voyant', 'led', 'allume pas', 'rouge', 'pon', 'los', 'ne demarre', 'eteinte'],
    steps: ['Vérifiez l’adaptateur secteur et essayez une autre prise.', 'Voyant « PON » vert fixe : la fibre est bien reçue. Voyant « LOS » rouge : la fibre n’arrive pas, revérifiez le connecteur.', 'Attendez deux minutes après le branchement, la box redémarre.', 'Si rien ne change, notez le numéro de série et transmettez au responsable : la box est peut-être à remplacer.'], source: 'Guide technicien, mise en service de la box', escalate: true },
  { id: 'cable', title: 'Câble abîmé, plié ou trop court', words: ['cable', 'coupe', 'casse', 'plie', 'denude', 'trop court', 'longueur', 'ecrase'],
    steps: ['Ne forcez jamais sur la fibre : elle casse. Un câble plié serré doit être remplacé.', 'Utilisez une rallonge de la bonne longueur prévue dans le kit, jamais un raccord improvisé.', 'Prenez une photo du câble abîmé avant de le toucher, pour le compte rendu.', 'Si le kit n’a pas la bonne longueur, signalez un matériel manquant.'], source: 'Guide technicien, câblage', escalate: false },
  { id: 'acces', title: 'Client absent ou accès impossible', words: ['absent', 'personne', 'acces', 'gardien', 'portail', 'porte', 'ferme', 'repond pas', 'badge'],
    steps: ['Rappelez le client, puis la conseillère si le client ne répond pas.', 'Attendez 15 minutes sur place avant de renoncer, et notez l’heure d’arrivée.', 'Si l’accès reste impossible, utilisez « Signaler un incident » : le client est prévenu et un nouveau créneau est proposé.'], source: 'Procédure terrain, accès', escalate: false },
  { id: 'syndic', title: 'Immeuble : accord du syndic ou du propriétaire', words: ['syndic', 'proprietaire', 'autorisation', 'immeuble', 'copropriete', 'refuse', 'interdit'],
    steps: ['Demandez à voir l’autorisation de passage, ou appelez la conseillère pour qu’elle la récupère.', 'Ne percez et ne passez aucun câble dans les parties communes sans accord.', 'Sans accord, arrêtez-vous et transmettez au responsable.'], source: 'Procédure terrain, immeubles', escalate: true },
  { id: 'wifi', title: 'Wi-Fi : placement de la box et réglages', words: ['wifi', 'wi-fi', 'portee', 'mot de passe', 'ssid', 'reseau sans fil', 'connexion lente', 'lent'],
    steps: ['Placez la box au centre du logement, en hauteur, loin des murs épais et du four à micro-ondes.', 'Le nom du réseau et le mot de passe sont sur l’étiquette sous la box.', 'Faites tester une page web au client avant de partir.'], source: 'Guide technicien, installation Wi-Fi', escalate: false },
  { id: 'serie', title: 'Numéro de série qui ne passe pas', words: ['serie', 'scan', 'code barre', 'numero', 'refuse', 'invalide', 'doublon', 'deja utilise'],
    steps: ['Vérifiez que le numéro est bien celui de l’étiquette sous la box (pas celui du carton).', 'Essayez la saisie à la main, sans espace.', 'Si le numéro est refusé comme déjà utilisé, ne branchez pas cette box : transmettez au responsable.'], source: 'Guide technicien, matériel', escalate: true },
  { id: 'securite', title: 'Chien, animal ou danger sur place', words: ['chien', 'animal', 'danger', 'electrique', 'echelle', 'peur', 'agressif', 'securite', 'menace', 'blesse'],
    steps: ['Ne travaillez pas tant que l’animal n’est pas enfermé : demandez-le au client.', 'Si vous sentez un danger (installation électrique abîmée, comportement agressif), partez et prévenez le responsable.', 'Votre sécurité passe avant la visite. Utilisez « Signaler un incident » pour le noter.'], source: 'Procédure terrain, sécurité', escalate: true },
];

// Retire accents, majuscules et ponctuation pour comparer des mots.
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\- ]+/g, ' ');

export function techAnswer(question) {
  const q = ' ' + norm(question).replace(/\s+/g, ' ') + ' ';
  const scored = TECH_TOPICS.map(t => ({ t, hits: t.words.filter(w => { const x = norm(w).trim(); return x.length <= 4 ? q.includes(' ' + x + ' ') : q.includes(x); }) })).filter(x => x.hits.length).sort((a, b) => b.hits.length - a.hits.length);
  if (!scored.length) return { topic: null, title: 'Pas de réponse sûre dans le guide', steps: ['Reformulez avec des mots simples (par exemple « box », « puissance », « câble », « accès »).', 'Ajoutez une photo et transmettez au responsable : il vous répond ici.'], source: null, escalate: true, matched: [] };
  const best = scored[0];
  return { topic: best.t.id, title: best.t.title, steps: best.t.steps, source: best.t.source, escalate: best.t.escalate, matched: best.hits };
}
