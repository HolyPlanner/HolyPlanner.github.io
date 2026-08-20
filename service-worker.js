// ============================================================
// Service Worker de HolyPlanner
// ============================================================
// Stratégie :
//  - App shell (HTML/CSS/JS/icônes statiques)  -> stale-while-revalidate (sert le
//    cache tout de suite, le rafraîchit en tâche de fond à CHAQUE requête)
//  - Appels vers l'API cloud (/api/...)         -> JAMAIS mis en cache (réseau uniquement)
//
// Pourquoi ne jamais cacher l'API : les données (voyages, finances, jours)
// sont maintenant partagées entre plusieurs utilisateurs et changent en
// permanence. Les mettre en cache risquerait d'afficher des données périmées
// ou, pire, de resservir en hors-ligne les données lues par un autre compte
// sur le même appareil après une déconnexion/reconnexion.

// Grâce au stale-while-revalidate (voir le handler 'fetch'), CACHE_NAME n'a PLUS
// besoin d'être incrémenté à chaque déploiement pour que les fichiers modifiés
// atteignent les utilisateurs déjà installés (ça se fait tout seul, en arrière-
// plan). Ne le change que pour un vrai reset (ex: purger des fichiers retirés de
// STATIC_ASSETS, qui resteraient sinon orphelins dans le cache indéfiniment).
const CACHE_NAME = 'holyplanner-static-v01.08.12';

// IMPORTANT : doit correspondre à la valeur de API_BASE_URL dans index.html
const API_BASE_URL = 'https://holyplanner-api.onrender.com';

// Fichiers de l'app shell à mettre en cache dès l'installation.
// ATTENTION : si UN SEUL de ces chemins est incorrect (faute de frappe,
// fichier inexistant), cache.addAll() échoue EN BLOC et empêche le Service
// Worker de s'activer -- ce qui bloque aussi l'installation complète de la
// PWA (WebAPK) côté Chrome Android. Vérifie chaque chemin après toute
// modification de cette liste, ex: https://holyplanner.github.io/CHEMIN
const STATIC_ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/icon-512-maskable.png',
    './icons/loading-logo.png',
    './icons/Logo_HolyPlanner.png',
    './icons/back-arrow.svg'
];

// --- INSTALL : met en cache l'app shell ---
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(STATIC_ASSETS))
            .then(() => self.skipWaiting()) // Active le nouveau SW immédiatement, sans attendre la fermeture de tous les onglets
    );
});

// --- ACTIVATE : supprime les anciens caches (ex: holyplanner-static-v0) ---
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys.filter((key) => key !== CACHE_NAME)
                    .map((key) => caches.delete(key))
            ))
            .then(() => self.clients.claim()) // Prend le contrôle des onglets déjà ouverts sans avoir besoin de recharger
    );
});

// --- FETCH : répartit entre API (réseau uniquement) et app shell (stale-while-revalidate) ---
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // 0. Ignore tout ce qui n'est pas http(s) (ex: chrome-extension://, générées
    //    par des extensions du navigateur qui interceptent aussi la page).
    //    L'API Cache ne sait mettre en cache QUE des requêtes http(s) -- sans ce
    //    filtre, cache.put() plantait sur ces requêtes avec "Request scheme
    //    'chrome-extension' is unsupported".
    if (!url.protocol.startsWith('http')) {
        return;
    }
    // 1. Appels vers l'API cloud : toujours le réseau, jamais le cache.
    if (url.href.startsWith(API_BASE_URL)) {
        event.respondWith(fetch(request));
        return;
    }

    // 2. Tout le reste (app shell statique) : "stale-while-revalidate", pas un
    //    simple cache-first. On ne traite que les requêtes GET : les autres
    //    méthodes (rares hors API) ne doivent pas être interceptées.
    if (request.method !== 'GET') {
        return; // Laisse la requête suivre son cours normalement (pas de respondWith)
    }

    event.respondWith(
        caches.open(CACHE_NAME).then(async (cache) => {
            const cachedResponse = await cache.match(request);

            // Lance TOUJOURS une requête réseau en parallèle pour rafraîchir le cache,
            // même si une version en cache existe déjà -- c'est ça, le "revalidate".
            // Avant, CACHE_NAME devait être incrémenté manuellement à chaque déploiement
            // pour que les utilisateurs déjà installés reçoivent les nouveaux fichiers
            // (oubli facile -> version obsolète servie indéfiniment). Avec cette
            // stratégie, un oubli de bump n'a plus d'impact durable : le cache se
            // corrige tout seul en arrière-plan, et la VISITE SUIVANTE profite déjà des
            // fichiers à jour -- sans jamais bloquer l'affichage de la visite en cours.
            const networkFetch = fetch(request).then((networkResponse) => {
                if (networkResponse && networkResponse.ok) {
                    cache.put(request, networkResponse.clone());
                }
                return networkResponse;
            }).catch(() => {
                // Pas de réseau : silencieux si on avait déjà servi le cache, sinon on
                // le signale (ex: 1ère visite hors-ligne, rien à servir du tout).
                if (!cachedResponse) {
                    console.warn('Ressource indisponible hors-ligne :', request.url);
                }
                return null;
            });

            // Sert le cache immédiatement s'il existe (rapide + fonctionne hors-ligne) ;
            // sinon on attend la réponse réseau (1er chargement, cache encore vide).
            return cachedResponse || networkFetch;
        })
    );
});
