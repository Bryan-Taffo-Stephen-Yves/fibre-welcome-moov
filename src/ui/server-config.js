// Serveur de démonstration (Supabase) qui partage un espace de test entre plusieurs appareils.
// La clé ci-dessous est une clé « publique » : elle n'ouvre que cinq fonctions (lire, écrire, prendre le bail,
// voir les versions, effacer les images d'un espace) et aucune ne permet de lister les espaces. Il faut connaître le code de salle.
// publicUrl : adresse publique de l'application, utilisée pour le lien et le code QR quand la page est ouverte
// depuis un fichier local.
export const SERVER = {
  url: 'https://jmjdtpyiwgwdiuettoqy.supabase.co',
  key: 'sb_publishable_HJjZVyrQSnJQHnWqfRamLQ_VwZwhmuH',
  publicUrl: 'https://bryan-taffo-stephen-yves.github.io/fibre-welcome-moov/',
};
