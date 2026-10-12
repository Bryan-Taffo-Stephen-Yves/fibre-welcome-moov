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
// Défauts qu'une IA peut signaler sur une photo de pièce (fonction fw-ia), avec leurs mots pour la conseillère et pour le client.
export const PHOTO_ISSUES = ['floue', 'sombre', 'reflet', 'coupee', 'trop_petite', 'mauvaise_piece', 'pas_un_document', 'specimen'];
export const ISSUE_LABEL = { floue: 'floue', sombre: 'trop sombre', reflet: 'reflet', coupee: 'pièce coupée', trop_petite: 'trop petite', mauvaise_piece: 'pas la bonne pièce', pas_un_document: 'pas une pièce', specimen: 'spécimen de démo' };
// Motif envoyé au client si la conseillère suit l'avis : des mots simples, jamais la note libre de l'IA.
export const ISSUE_REASON = {
  floue: 'Photo floue, merci de la reprendre',
  sombre: 'Photo trop sombre, merci de la reprendre à la lumière',
  reflet: 'Photo avec un reflet, merci de la reprendre sans éclairage direct',
  coupee: 'Pièce coupée sur la photo, merci de la reprendre en entier',
  trop_petite: 'Photo trop petite, merci de la reprendre de plus près',
  mauvaise_piece: 'Ce n’est pas la pièce demandée, merci d’envoyer la bonne',
  pas_un_document: 'La photo ne montre pas la pièce demandée, merci de la reprendre',
};

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
  { id: 'presence', label: 'Une personne majeure sera présente pendant tout le créneau', need: true, ask: 'quelqu’un est bien présent' },
  { id: 'acces', label: 'Le technicien pourra entrer (gardien, portail, badge)', need: true, ask: 'le gardien ou le portail est prévenu' },
  { id: 'prise', label: 'Une prise électrique est libre près de l’emplacement de la box', need: true, ask: 'une prise est libre près de la box' },
  { id: 'passage', label: 'Le propriétaire ou le syndic autorise le passage du câble', need: false, when: 'immeuble' },
  { id: 'animaux', label: 'Les chiens et autres animaux seront enfermés pendant la visite', need: false, ask: 'les chiens sont enfermés' },
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

// Libellés lisibles du journal d'audit : le filtre de l'administrateur cherche dans ces mots-là (ceux qu'il voit à l'écran).
export const AUDIT_LABELS = {
  'sms.inbound': 'SMS reçu du client', 'ussd.step': 'Demande par USSD',
  'acces.refuse': 'Accès refusé', 'activation.relancer': 'Activation relancée', 'annulation.instruire': 'Annulation instruite', 'blocage.affecter': 'Blocage confié', 'blocage.ouvrir': 'Blocage ouvert', 'blocage.resoudre': 'Blocage levé',
  'capacite.modifier': 'Capacité modifiée', 'compte.activer': 'Compte réactivé', 'compte.desactiver': 'Compte coupé', 'compte.perimetre': 'Zones modifiées', 'config.modifier': 'Réglage modifié', 'continuite.mode_degrade': 'Mode dégradé',
  'dossier.cloturer': 'Dossier clôturé', 'dossier.consulter': 'Fiche consultée', 'dossier.avis': 'Avis automatique suivi', 'doublon.rapprocher': 'Doublon rapproché', 'doublon.separer': 'Doublon séparé', 'equipe.disponible': 'Équipe disponible', 'equipe.indisponible': 'Équipe indisponible',
  escalade: 'Escalade', 'espace.creer': 'Espace créé', 'espace.reinitialiser': 'Espace réinitialisé', 'export.dossiers': 'Export des dossiers', 'ia.assistant': 'Question à l’assistant', 'ia.photo': 'Avis de l’IA sur une photo', 'ia.generative.activer': 'IA générative activée', 'ia.generative.couper': 'IA générative coupée', 'ia.modele.activer': 'Modèle activé', 'ia.modele.desactiver': 'Estimations coupées', 'ia.resume.utilise': 'Résumé automatique utilisé',
  'integration.rejet': 'Événement rejeté', 'integration.rejouer': 'Échange rejoué', 'invitation.creer': 'Invitation créée', 'invitation.revoquer': 'Invitation révoquée', 'invitation.utiliser': 'Invitation utilisée', 'mission.reaffecter': 'Mission réaffectée', 'paiement.rapprochement_manuel.demande': 'Rapprochement demandé',
  'procedure.reviser': 'Procédure révisée', 'rattachement.demande': 'Rattachement demandé', 'rattachement.valide': 'Rattachement validé', 'rdv.annuler': 'Rendez-vous annulé', 'rdv.confirmer': 'Rendez-vous confirmé', 'rdv.reserver': 'Rendez-vous réservé', 'reseau.ports': 'Ports ajoutés',
  'user.setActive': 'Compte modifié', 'user.setZones': 'Zones modifiées', 'invite.create': 'Invitation', 'invite.revoke': 'Révocation d’invitation', 'config.set': 'Réglage', 'model.activate': 'Choix du modèle', 'kb.update': 'Révision de procédure',
  'integration.replay': 'Rejeu demandé', 'backup.create': 'Sauvegarde', 'degraded.set': 'Mode dégradé', 'order.open': 'Fiche ouverte', 'export.orders': 'Export des dossiers',
  'claim.start': 'Rattachement commencé', 'claim.verify': 'Rattachement vérifié', 'order.updateAddress': 'Adresse modifiée', 'doc.upload': 'Pièce envoyée', 'doc.request': 'Pièce demandée', 'doc.review': 'Pièce vérifiée',
  'appt.hold': 'Créneau gardé', 'appt.book': 'Rendez-vous pris', 'appt.cancel': 'Rendez-vous annulé', 'appt.confirm': 'Rendez-vous confirmé', 'appt.reassign': 'Rendez-vous réaffecté', 'prep.toggle': 'Préparation cochée',
  'msg.send': 'Message du client', 'msg.reply': 'Réponse envoyée', 'note.add': 'Note interne', 'assistant.handoff': 'Passage à un conseiller', 'callback.request': 'Rappel demandé', 'callback.update': 'Rappel mis à jour', 'report.create': 'Signalement',
  'prefs.set': 'Préférences', 'notif.read': 'Notification lue', 'activation.feedback': 'Retour sur l’activation', 'feedback.submit': 'Avis du client', 'cancel.request': 'Annulation demandée', 'cancel.instruct': 'Annulation instruite', 'privacy.request': 'Demande sur les données',
  'delegation.add': 'Délégation ajoutée', 'delegation.revoke': 'Délégation retirée', 'address.requestPrecision': 'Précision d’adresse demandée', 'order.markReady': 'Dossier prêt', 'blocker.assign': 'Blocage confié', 'blocker.resolve': 'Blocage levé', 'blocker.escalateCheck': 'Contrôle d’escalade',
  'network.addPorts': 'Ports ajoutés', 'ticket.close': 'Ticket fermé', 'team.setAvailable': 'Disponibilité d’équipe', 'capacity.set': 'Capacité modifiée', 'wo.action': 'Action du technicien', 'payment.manualRequest': 'Rapprochement demandé',
  'order.close': 'Dossier clôturé', 'activation.retry': 'Activation relancée', 'duplicate.link': 'Doublon rapproché', 'duplicate.unlink': 'Doublon séparé',
  'demo.scenario': 'Scénario lancé', 'demo.clock': 'Horloge avancée', 'demo.webhook': 'Événement simulé', 'demo.integration': 'Panne simulée', 'demo.flag': 'Réglage du simulateur', 'demo.createOrder': 'Commande fictive', 'demo.restore': 'Restauration',
  'sauvegarde.creer': 'Sauvegarde créée', 'sauvegarde.restaurer': 'Sauvegarde restaurée', 'piece.valide': 'Pièce validée', 'piece.refuse': 'Pièce refusée', 'piece.refusee': 'Pièce refusée',
  'validation.annulation.validee': 'Annulation validée', 'validation.annulation.refusee': 'Annulation refusée', 'validation.paiement.validee': 'Paiement manuel validé', 'validation.paiement.refusee': 'Paiement manuel refusé', 'boutique.achat': 'Achat en ligne (simulé)', 'call.start': 'Appel au service client', 'appel.decrocher': 'Appel décroché', 'approval.decide': 'Décision du superviseur',
  'tech.ask': 'Question d’aide du technicien', 'tech.escalate': 'Aide transmise au responsable', 'install.validate': 'Visite validée par le client', 'terrain.aide': 'Question d’aide du technicien', 'terrain.transmettre': 'Aide transmise au responsable',
};
// Réglages de l'administrateur, nommés comme à l'écran.
export const CONFIG_LABELS = {
  holdMinutes: 'Durée de garde du créneau (minutes)', autoConfirm: 'Confirmation automatique', policyEquipment: 'Si le matériel manque', contractDays: 'Délai de référence (jours)', dossierDeadlineH: 'Délai pour envoyer le dossier (heures)',
  autoValidateMin: 'Délai avant validation automatique (minutes)', travelMin: 'Durée du trajet simulé (minutes)', holidays: 'Jours fériés',
};
