// Référentiels métier : états, rôles, motifs, zones (CDC 3.2, 2.2, 5.3 MO-05).
// Chaque libellé a une explication « en clair » pour un lecteur non spécialiste.

export const ORDER_STATES = [
  'DOSSIER_RECU', 'PAIEMENT_CONFIRME', 'PREPARATION', 'PRET_A_PLANIFIER', 'RDV_CONFIRME',
  'INTERVENTION_EN_COURS', 'INSTALLATION_TERMINEE', 'ACTIVATION_EN_ATTENTE', 'SERVICE_ACTIF', 'CLOTURE',
];

export const STATE_INFO = {
  DOSSIER_RECU: { label: 'Dossier reçu', client: 'Votre demande est arrivée chez Moov.', clear: 'La commande a été transmise par Moov Prospect (ou importée). Rien n’est encore vérifié.' },
  PAIEMENT_CONFIRME: { label: 'Paiement confirmé', client: 'Votre paiement est confirmé.', clear: 'Le serveur a rapproché la référence Moov Money avec le montant attendu. Une capture d’écran ne suffit pas.' },
  PREPARATION: { label: 'Vérification technique', client: 'Moov vérifie votre adresse et la possibilité de vous raccorder.', clear: 'Une équipe contrôle l’adresse, l’accès et la disponibilité d’un port fibre à proximité.' },
  PRET_A_PLANIFIER: { label: 'Prêt à planifier', client: 'Vous pouvez choisir un créneau d’installation.', clear: 'Tout est vérifié : on peut réserver une visite du technicien.' },
  RDV_CONFIRME: { label: 'Rendez-vous confirmé', client: 'Votre rendez-vous est confirmé et une équipe est affectée.', clear: 'Le planificateur a confirmé le créneau et désigné une équipe.' },
  INTERVENTION_EN_COURS: { label: 'Installation en cours', client: 'Le technicien travaille chez vous.', clear: 'Le technicien a démarré la mission depuis son téléphone.' },
  INSTALLATION_TERMINEE: { label: 'Installation terminée', client: 'Les travaux sont finis. L’activation de la ligne suit.', clear: 'Le matériel est posé. Cela ne veut pas encore dire qu’Internet fonctionne.' },
  ACTIVATION_EN_ATTENTE: { label: 'Activation en attente', client: 'Moov active votre ligne. Cela prend en général peu de temps.', clear: 'Une demande est envoyée au système d’activation de Moov. On attend sa réponse.' },
  SERVICE_ACTIF: { label: 'Service actif', client: 'Votre fibre est active.', clear: 'Le système d’activation a confirmé la bonne ligne avec le bon équipement.' },
  CLOTURE: { label: 'Clôturé', client: 'Votre dossier est terminé. Merci !', clear: 'Tous les contrôles sont faits et aucun incident n’est ouvert.' },
};

export const stateRank = s => ORDER_STATES.indexOf(s);

// États d'exception, modélisés à part : ils ne remplacent pas l'état principal (CDC 3.2).
export const BLOCKER_TYPES = {
  PIECE_MANQUANTE: { label: 'Pièce manquante', owner: 'client', action: 'Envoyer la pièce demandée', clientText: 'Il nous manque un document de votre part.', slaH: 48 },
  ADRESSE_AMBIGUE: { label: 'Adresse imprécise', owner: 'client', action: 'Préciser l’adresse avec un repère', clientText: 'Nous n’arrivons pas à localiser précisément votre logement.', slaH: 48 },
  CAPACITE_RESEAU: { label: 'Capacité réseau indisponible', owner: 'planificateur', action: 'Réserver une ressource réseau ou attendre l’extension', clientText: 'Le point de raccordement près de chez vous est plein pour le moment.', slaH: 120 },
  CLIENT_ABSENT: { label: 'Client absent', owner: 'conseiller', action: 'Recontacter le client et replanifier', clientText: 'Le technicien ne vous a pas trouvé au rendez-vous.', slaH: 24 },
  ACCES_IMPOSSIBLE: { label: 'Accès impossible', owner: 'conseiller', action: 'Obtenir l’autorisation d’accès et replanifier', clientText: 'Le technicien n’a pas pu accéder au logement.', slaH: 48 },
  MATERIEL_PANNE: { label: 'Matériel indisponible', owner: 'planificateur', action: 'Réapprovisionner l’équipement', clientText: 'Le matériel nécessaire n’est pas disponible pour le moment.', slaH: 72 },
  TECHNICIEN_ABSENT: { label: 'Technicien indisponible', owner: 'planificateur', action: 'Réaffecter la mission à une autre équipe', clientText: 'L’équipe prévue n’est pas disponible. Nous en cherchons une autre.', slaH: 12 },
  SOUS_TRAITANT: { label: 'Sous-traitant indisponible', owner: 'planificateur', action: 'Réaffecter à une équipe interne', clientText: 'L’équipe prévue n’est pas disponible.', slaH: 24 },
  ACTIVATION_ECHOUEE: { label: 'Activation échouée', owner: 'superviseur', action: 'Diagnostiquer et relancer l’activation', clientText: 'L’activation de votre ligne a échoué. Une équipe s’en occupe.', slaH: 24 },
  PAIEMENT_NON_RAPPROCHE: { label: 'Paiement à rapprocher', owner: 'conseiller', action: 'Rapprocher la référence de paiement', clientText: 'Nous vérifions votre paiement.', slaH: 24 },
  ANNULATION: { label: 'Annulation demandée', owner: 'superviseur', action: 'Valider l’annulation et le remboursement', clientText: 'Votre demande d’annulation est en cours de traitement.', slaH: 72 },
  SERVICE_KO: { label: 'Pas d’Internet après activation', owner: 'superviseur', action: 'Ouvrir un diagnostic ligne', clientText: 'Vous nous avez signalé que la connexion ne marche pas.', slaH: 24 },
  ANOMALIE_ACTIVATION: { label: 'Confirmation d’activation incohérente', owner: 'superviseur', action: 'Vérifier la correspondance commande / équipement', clientText: 'Nous vérifions la confirmation d’activation.', slaH: 24 },
};

export const APPT_STATES = { propose: 'Proposé', tenu: 'Réservé temporairement', reserve: 'Réservé', confirme: 'Confirmé', en_cours: 'En cours', realise: 'Réalisé', non_honore: 'Non honoré', annule: 'Annulé', remplace: 'Remplacé' };
export const PAYMENT_STATES = { en_attente: 'En attente de rapprochement', confirme: 'Confirmé', rembourse_demande: 'Remboursement demandé', rembourse_valide: 'Remboursement validé', rembourse: 'Remboursé (simulé)', rejete: 'Rejeté' };

export const ROLES = {
  client: { label: 'Client', clear: 'La personne qui a payé l’installation. Elle suit son dossier et prend rendez-vous.' },
  representant: { label: 'Représentant', clear: 'Une personne à qui le client a délégué certaines actions (par exemple un gardien).' },
  conseiller: { label: 'Conseiller', clear: 'Le service client Moov. Répond aux questions, relance, débloque.' },
  planificateur: { label: 'Planificateur', clear: 'Organise les équipes, les créneaux et les affectations.' },
  technicien: { label: 'Technicien', clear: 'Se déplace chez le client pour installer la fibre.' },
  superviseur: { label: 'Superviseur', clear: 'Suit les délais, traite les escalades et valide les exceptions.' },
  admin: { label: 'Administrateur', clear: 'Gère les comptes, les réglages et les connexions aux systèmes Moov.' },
  auditeur: { label: 'Auditeur', clear: 'Lit les journaux et exports. Ne peut rien modifier.' },
};

export const STAFF = ['conseiller', 'planificateur', 'technicien', 'superviseur', 'admin', 'auditeur'];

export const ZONES = [
  { id: 'cocody', name: 'Cocody', agency: 'Agence Cocody' },
  { id: 'yopougon', name: 'Yopougon', agency: 'Agence Yopougon' },
  { id: 'marcory', name: 'Marcory', agency: 'Agence Sud' },
  { id: 'abobo', name: 'Abobo', agency: 'Agence Nord' },
  { id: 'bingerville', name: 'Bingerville', agency: 'Agence Cocody' },
];

export const SLOTS = [
  { id: 'm', label: '8 h – 12 h', start: 8, end: 12 },
  { id: 'a', label: '13 h – 17 h', start: 13, end: 17 },
];

export const DOC_TYPES = {
  cni: { label: 'Pièce d’identité', why: 'Pour vérifier que c’est bien vous le titulaire.' },
  justif_domicile: { label: 'Justificatif de domicile', why: 'Facture CIE/SODECI ou attestation, pour confirmer l’adresse.' },
  autorisation_syndic: { label: 'Autorisation du propriétaire ou du syndic', why: 'Demandée seulement si le passage du câble traverse des parties communes.' },
  // Pièces du dossier rempli après un achat en ligne (site des offres) : trois photos prises avec le téléphone.
  cni_recto: { label: 'Pièce d’identité (recto)', short: 'Recto', why: 'Le côté avec votre photo et votre nom.' },
  cni_verso: { label: 'Pièce d’identité (verso)', short: 'Verso', why: 'L’autre côté de la même pièce.' },
  selfie_cni: { label: 'Photo de vous avec la pièce', short: 'Selfie', why: 'Votre visage et la pièce dans la même photo : on vérifie que c’est bien vous.' },
};
export const DOSSIER_DOCS = ['cni_recto', 'cni_verso', 'selfie_cni'];
// Pièces que le technicien peut consulter pendant une mission ouverte (besoin d'en connaître).
export const TECH_DOCS = ['cni', 'cni_recto', 'autorisation_syndic'];

// Offres du site de démonstration. Tarifs inventés pour la démo : ce ne sont pas les prix de Moov.
export const OFFERS = [
  { id: 'essentiel', name: 'Fibre Essentiel', speed: '100 Mb/s', monthly: 15000, pay: 25000, perks: ['Wi-Fi pour toute la maison', 'Appels illimités vers les fixes', 'Installation comprise'] },
  { id: 'confort', name: 'Fibre Confort', speed: '300 Mb/s', monthly: 25000, pay: 35000, best: true, perks: ['Idéal pour le télétravail et la télé', 'Box Wi-Fi 6', 'Installation comprise'] },
  { id: 'premium', name: 'Fibre Premium', speed: '1 Gb/s', monthly: 45000, pay: 55000, perks: ['Le plus rapide pour toute la famille', 'Box Wi-Fi 6 + répéteur', 'Assistance prioritaire'] },
];
// Communes ouvertes à la vente en ligne (les autres sont annoncées « bientôt »).
export const SHOP_ZONES = ['cocody', 'yopougon', 'marcory', 'bingerville'];
// Heures de passage proposées au planificateur dans chaque demi-journée.
// « 09:00 » → « 9 h » : une seule façon d'écrire l'heure partout (écrans et notifications).
export const hourLabel = t => { const m = /^(\d{2}):(\d{2})$/.exec(t || ''); return m ? Number(m[1]) + ' h' + (m[2] !== '00' ? ' ' + m[2] : '') : t || ''; };
export const SLOT_HOURS = { m: ['08:00', '09:00', '10:00', '11:00'], a: ['13:00', '14:00', '15:00', '16:00'] };
// Point de départ des équipes (agence), pour la simulation du trajet.
export const TEAM_BASE = { T1: 'plateau', T2: 'treichville', T3: 'adjame' };
export const BASE_NAMES = { plateau: 'Agence du Plateau', treichville: 'Dépôt de Treichville', adjame: 'Dépôt d’Adjamé' };

export const REPORT_TYPES = {
  bloque: 'Mon dossier n’avance pas',
  tech_absent: 'Le technicien n’est pas venu',
  adresse: 'Mon adresse est fausse',
  pas_internet: 'L’installation ne fonctionne pas',
};

export const CHECKLIST_TECH = [
  { id: 'puissance', label: 'Puissance optique reçue', unit: 'dBm', min: -27, max: -8, required: true, help: 'Valeur lue au photomètre sur la prise. Entre −27 et −8 dBm, la ligne est bonne.' },
  { id: 'pto', label: 'Prise optique (PTO) posée et étiquetée', type: 'bool', required: true },
  { id: 'cheminement', label: 'Câble fixé sans pli serré', type: 'bool', required: true },
  { id: 'ont_led', label: 'Voyant PON de la box fixe', type: 'bool', required: true },
  { id: 'wifi', label: 'Wi-Fi configuré avec le client', type: 'bool', required: false },
];

export const PREP_CHECKLIST = [
  { id: 'presence', label: 'Une personne majeure sera présente pendant tout le créneau', need: true },
  { id: 'acces', label: 'Le technicien pourra entrer (gardien, portail, badge)', need: true },
  { id: 'prise', label: 'Une prise électrique est libre près de l’emplacement de la box', need: true },
  { id: 'passage', label: 'Le propriétaire ou le syndic autorise le passage du câble', need: false, when: 'immeuble' },
  { id: 'animaux', label: 'Les chiens et autres animaux seront enfermés pendant la visite', need: false },
];

export const GLOSSARY = [
  ['Fibre optique', 'Un câble en verre très fin qui transporte Internet par la lumière. Plus rapide et plus stable que l’ADSL.'],
  ['PTO', 'Prise Terminale Optique : la petite prise murale où arrive la fibre chez vous.'],
  ['Box / ONT', 'L’appareil qui transforme la lumière de la fibre en Internet (Wi-Fi et câble).'],
  ['Activation', 'L’opération faite par Moov, à distance, pour ouvrir le service sur votre ligne. Elle suit l’installation.'],
  ['Créneau', 'Une demi-journée pendant laquelle le technicien peut passer.'],
  ['Blocage', 'Quelque chose empêche le dossier d’avancer. Il a toujours un responsable et une action attendue.'],
  ['Estimation', 'Une prévision du délai restant, avec une fourchette. Ce n’est pas un engagement, contrairement à un rendez-vous confirmé.'],
  ['Rapprochement', 'Vérifier qu’un paiement reçu correspond bien à la bonne commande et au bon montant.'],
  ['Webhook', 'Un message automatique envoyé par un système (par exemple Moov Money) pour prévenir qu’un événement a eu lieu.'],
  ['Idempotence', 'Recevoir deux fois le même message ne produit qu’un seul effet.'],
  ['Espace de test', 'Votre bac à sable privé, rempli de données fictives. Rien ne touche les vrais systèmes Moov.'],
  ['Simulé', 'Ce système n’est pas encore branché : un imitateur produit des réponses réalistes à sa place.'],
];

// Prénoms des clients inventés : aucun ne reprend celui d'un personnage de la démo, pour éviter les confusions.
export const FIRST_NAMES = ['Kouamé', 'Affoué', 'Mariam', 'Yao', 'Aminata', 'Serge', 'Rokia', 'Sékou', 'Adjoua', 'Ibrahim', 'Clarisse', 'Estelle', 'Lassina', 'Ange', 'Aïcha', 'Prisca'];
export const LAST_NAMES = ['Kouassi', 'Traoré', 'Koné', 'Yao', 'Bamba', 'N’Guessan', 'Ouattara', 'Diabaté', 'Konan', 'Coulibaly', 'Touré', 'Aka'];
export const STREETS = {
  cocody: ['Rue des Jardins, Deux-Plateaux', 'Riviera Palmeraie, rue M12', 'Angré 8e tranche, rue L45'],
  yopougon: ['Niangon Sud, rue 24', 'Sicogi, bloc 17', 'Maroc, rue des Écoles'],
  marcory: ['Zone 4, rue Paul Langevin', 'Résidentiel, rue du Canal', 'Anoumabo, avenue 7'],
  abobo: ['Avocatier, rue 3', 'Belleville, carrefour Samaké', 'PK18, rue du Marché'],
  bingerville: ['Cité Feh Kessé, lot 42', 'Route de Bingerville, Akouai-Santai', 'Quartier Résidentiel, rue 9'],
};
export const LANDMARKS = ['en face de la pharmacie', 'derrière l’école primaire', 'à côté de la station Total', 'portail bleu après le maquis', 'près de la mosquée'];
