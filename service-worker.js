// ============================================================
// Service Worker de HolyPlanner
// ============================================================
// Stratégie :
//  - App shell (HTML/CSS/JS/icônes statiques)  -> cache-first, avec repli réseau
//  - Appels vers l'API cloud (/api/...)         -> JAMAIS mis en cache (réseau uniquement)
//
// Pourquoi ne jamais cacher l'API : les données (voyages, finances, jours)
// sont maintenant partagées entre plusieurs utilisateurs et changent en
// permanence. Les mettre en cache risquerait d'afficher des données périmées
// ou, pire, de resservir en hors-ligne les données lues par un autre compte
// sur le même appareil après une déconnexion/reconnexion.

const CACHE_NAME = 'holyplanner-static-v01.07.06'; // Incrémenté : force le renouvellement du cache chez les utilisateurs déjà installés

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
    './icons/icon-512.png'
];

// --- INSTALL : met en cache l'app shell ---
self.addEventListener('install', (event) => {
    console.log('Service Worker installé');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(STATIC_ASSETS))
            .then(() => self.skipWaiting()) // Active le nouveau SW immédiatement, sans attendre la fermeture de tous les onglets
    );
});

// --- ACTIVATE : supprime les anciens caches (ex: holyplanner-static-v0) ---
self.addEventListener('activate', (event) => {
    console.log('Service Worker activé');
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys.filter((key) => key !== CACHE_NAME)
                    .map((key) => caches.delete(key))
            ))
            .then(() => self.clients.claim()) // Prend le contrôle des onglets déjà ouverts sans avoir besoin de recharger
    );
});

// --- FETCH : répartit entre API (réseau uniquement) et app shell (cache-first) ---
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

    // 2. Tout le reste (app shell statique) : cache d'abord, réseau en repli.
    //    On ne traite que les requêtes GET : les autres méthodes (rares hors
    //    API) ne doivent pas être interceptées.
    if (request.method !== 'GET') {
        return; // Laisse la requête suivre son cours normalement (pas de respondWith)
    }

    event.respondWith(
        caches.match(request).then((cachedResponse) => {
            if (cachedResponse) {
                return cachedResponse;
            }
            return fetch(request).then((networkResponse) => {
                // Met en cache une copie pour la prochaine visite hors-ligne
                if (networkResponse && networkResponse.ok) {
                    const responseClone = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
                }
                return networkResponse;
            }).catch(() => {
                // Ni cache, ni réseau disponible (ex: 1ère visite hors-ligne) :
                // pas de fallback générique ici, adapte si tu veux une page "offline.html"
                console.warn('Ressource indisponible hors-ligne :', request.url);
            });
        })
    );
});
