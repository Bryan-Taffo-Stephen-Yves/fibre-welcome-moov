// Génération d'un espace de démonstration : données 100 % fictives, reproductibles par graine (CDC 7.3, 7.5).
import { rng } from './ai.js';
import { ZONES, FIRST_NAMES, LAST_NAMES, STREETS, LANDMARKS, SLOTS } from './model.js';

const H = 3600e3, DAY = 24 * H;
export const startOfDay = t => Math.floor(t / DAY) * DAY; // Abidjan = UTC+0

export function isWorkingDay(ws, t) {
  const d = new Date(t).getUTCDay();
  if (d === 0) return false; // dimanche fermé ; samedi ouvert (calendrier d'agence configurable)
  return !ws.config.holidays.includes(new Date(t).toISOString().slice(0, 10));
}

export function buildWorkspace({ id, name, seed, realNow, generation = 1, owner }) {
  const r = rng(seed);
  const pick = a => a[Math.floor(r() * a.length)];
  const clock = realNow;
  const ws = {
    id, name, seed, generation, env: 'demo', createdAt: realNow, expiresAt: realNow + 24 * H, owner,
    clock, lastReal: realNow, seq: 0, version: 1,
    users: [], invites: [], orders: [], events: [], blockers: [], appointments: [], holds: [], capacity: [], teams: [],
    workOrders: [], equipment: [], activations: [], documents: [], messages: [], callbacks: [], tickets: [], notifications: [],
    outbox: [], deliveries: [], jobs: [], audit: [], feedback: [], predictions: [], delegations: [], privacy: [], refunds: [],
    idem: {}, seenEvents: {}, backups: [], alerts: [],
    integrations: {
      prospect: { name: 'Moov Prospect (commandes)', up: true, lastSync: clock, mode: 'simulé', delayMs: 0 },
      money: { name: 'Moov Money (paiements)', up: true, lastSync: clock, mode: 'simulé' },
      activation: { name: 'Activation réseau', up: true, lastSync: clock, mode: 'émulateur' },
      sms: { name: 'SMS / WhatsApp', up: true, lastSync: clock, mode: 'boîte d’envoi simulée' },
      stock: { name: 'Inventaire matériel', up: true, lastSync: clock, mode: 'inventaire synthétique' },
    },
    sim: { failNextActivation: false, saturation: false, equipmentShortage: false, degraded: false },
    ports: {},
    config: {
      holdMinutes: 5, autoConfirm: false, policyEquipment: 'conditionnel', holidays: [],
      slaH: { DOSSIER_RECU: 24, PAIEMENT_CONFIRME: 12, PREPARATION: 72, PRET_A_PLANIFIER: 48, RDV_CONFIRME: 168, INTERVENTION_EN_COURS: 8, INSTALLATION_TERMINEE: 4, ACTIVATION_EN_ATTENTE: 24, SERVICE_ACTIF: 168 },
      contractDays: 10,
      templates: {
        rdv_confirme: 'Moov Fibre : votre installation est confirmée le {date} ({slot}). Préparez l’accès au logement.',
        rappel: 'Moov Fibre : rappel, le technicien passe demain ({slot}).',
        actif: 'Moov Fibre : votre ligne est active. Bienvenue !',
      },
      webhookSecret: 'demo-secret-' + Math.floor(r() * 1e6), // secret de démonstration, jamais un secret réel
    },
    models: [
      { version: 'baseline-1', kind: 'Médiane historique par zone et étape', active: false, trainedOn: 'synthétique, graine ' + seed, createdAt: realNow - 30 * DAY },
      { version: 'quantiles-2', kind: 'Quantiles par zone, étape, charge et complétude', active: true, trainedOn: 'synthétique, graine ' + seed, createdAt: realNow - 3 * DAY },
    ],
    docs: [
      { id: 'PR-01', title: 'Confirmation de paiement', version: '1.2', owner: 'Direction financière', expires: realNow + 90 * DAY, scope: 'public' },
      { id: 'PR-02', title: 'Étapes d’un raccordement fibre', version: '2.0', owner: 'Direction technique', expires: realNow + 120 * DAY, scope: 'public' },
      { id: 'PR-03', title: 'Préparer la visite du technicien', version: '1.4', owner: 'Service client', expires: realNow + 60 * DAY, scope: 'public' },
      { id: 'PR-04', title: 'Modifier ou annuler un rendez-vous', version: '1.1', owner: 'Planification', expires: realNow + 60 * DAY, scope: 'public' },
      { id: 'PR-05', title: 'Activation et premiers tests', version: '1.0', owner: 'Direction technique', expires: realNow + 60 * DAY, scope: 'public' },
      { id: 'PR-06', title: 'Annulation et remboursement', version: '1.3', owner: 'Direction financière', expires: realNow + 30 * DAY, scope: 'public' },
      { id: 'PR-07', title: 'Escalade d’un dossier bloqué', version: '1.0', owner: 'Supervision', expires: realNow + 5 * DAY, scope: 'interne' },
    ],
  };
  const person = () => pick(FIRST_NAMES) + ' ' + pick(LAST_NAMES);
  const phone = () => '+225 07 ' + String(10 + Math.floor(r() * 89)) + ' ' + String(10 + Math.floor(r() * 89)) + ' ' + String(10 + Math.floor(r() * 89));
  const allZones = ZONES.map(z => z.id);
  const U = (role, extra = {}) => { const u = { id: 'U' + (ws.users.length + 1), role, name: person(), phone: phone(), active: true, zones: allZones, prefs: { sms: true, whatsapp: false, push: false }, ...extra }; ws.users.push(u); return u; };
  const client = U('client', { name: 'Awa Kouassi' });
  const client2 = U('client', { name: 'Koffi Bamba' });
  const rep = U('representant', { name: 'Seydou Traoré' });
  U('conseiller', { name: 'Nadia Konan', agency: 'Service client Abidjan' });
  U('planificateur', { name: 'Hervé Ouattara', zones: ['cocody', 'bingerville', 'marcory', 'yopougon'], agency: 'Planification Sud' });
  const techs = [U('technicien', { name: 'Brice Yao' }), U('technicien', { name: 'Moussa Koné' }), U('technicien', { name: 'Didier Aka', contractor: 'FibreBat SARL' })];
  U('superviseur', { name: 'Salimata Diabaté' });
  U('admin', { name: 'Jean-Marc N’Guessan' });
  U('auditeur', { name: 'Fatou Touré' });

  ws.teams = [
    { id: 'T1', name: 'Équipe Cocody 1', techUserId: techs[0].id, zones: ['cocody', 'bingerville'], skills: ['pose', 'immeuble'], available: true, contractor: null, quality: 4.6 },
    { id: 'T2', name: 'Équipe Sud', techUserId: techs[1].id, zones: ['marcory', 'yopougon', 'cocody'], skills: ['pose'], available: true, contractor: null, quality: 4.3 },
    { id: 'T3', name: 'FibreBat (sous-traitant)', techUserId: techs[2].id, zones: ['abobo', 'yopougon', 'bingerville'], skills: ['pose', 'immeuble'], available: true, contractor: 'FibreBat SARL', quality: 3.9 },
  ];
  // Capacité : 14 jours ouvrés, 1 à 2 interventions par demi-journée et par équipe.
  const d0 = startOfDay(clock);
  for (let i = 1; i <= 16; i++) {
    const date = d0 + i * DAY;
    if (!isWorkingDay(ws, date)) continue;
    for (const t of ws.teams) for (const s of SLOTS) ws.capacity.push({ id: t.id + ':' + date + ':' + s.id, teamId: t.id, date, slot: s.id, cap: 1 + (r() > 0.5 ? 1 : 0), used: 0 });
  }
  for (const z of ZONES) ws.ports[z.id] = { free: 4 + Math.floor(r() * 6), reserved: 0 };
  for (let i = 0; i < 14; i++) ws.equipment.push({ serial: 'ZTE-F670-' + (48210 + i), model: 'ONT ZTE F670L', status: 'stock', orderId: null });
  for (let i = 0; i < 4; i++) ws.equipment.push({ serial: 'HW-HG8245-' + (77030 + i), model: 'ONT Huawei HG8245', status: 'stock', orderId: null });

  const mkOrder = (cust, zone, n) => {
    const street = pick(STREETS[zone]);
    return {
      id: 'O' + n, ref: 'FW-2026-' + String(100 + n).padStart(3, '0'), customerId: cust ? cust.id : null, claimed: !!cust,
      contactPhone: cust ? cust.phone : phone(), contactName: cust ? cust.name : person(),
      offer: pick(['Fibre 50 Mb/s', 'Fibre 100 Mb/s', 'Fibre 200 Mb/s']), equipmentModel: 'ONT ZTE F670L',
      zone, address: { commune: ZONES.find(z => z.id === zone).name, street, landmark: pick(LANDMARKS), building: r() > 0.6 ? 'immeuble' : 'maison', floor: '', lat: null, lng: null, accessNotes: '', verified: false },
      state: 'DOSSIER_RECU', stateSince: clock, version: 1, createdAt: clock, updatedAt: clock, source: 'Moov Prospect (simulé)',
      payment: { ref: 'MM-' + Math.floor(1e8 + r() * 9e8), amount: 25000, currency: 'XOF', status: 'en_attente' },
      apptId: null, woId: null, cancelled: false, prep: {}, scenario: null, linkedTo: null,
    };
  };
  const zonesSeq = ['cocody', 'yopougon', 'marcory', 'abobo', 'bingerville', 'cocody', 'yopougon'];
  ws._seedOrders = [];
  ws.orders.push(mkOrder(client, 'cocody', 1));
  ws.orders.push(mkOrder(client2, 'cocody', 2));
  // Dossier non encore rattaché, au numéro d'Awa : pour tester le rattachement sécurisé (CL-01).
  const o3 = mkOrder(null, 'bingerville', 3); o3.contactPhone = client.phone; o3.contactName = client.name; ws.orders.push(o3);
  for (let i = 4; i <= 11; i++) ws.orders.push(mkOrder(null, zonesSeq[i % zonesSeq.length], i));
  ws.delegations.push({ id: 'DL1', orderId: 'O1', clientId: client.id, delegateId: rep.id, scopes: ['rdv', 'messages'], from: clock, until: clock + 30 * DAY, revoked: false });
  return ws;
}

export { H, DAY };
