// ===== КОНФИГУРАЦИЯ КЭША =====
const CACHE_NAME = 'app-shell-v3';
const DYNAMIC_CACHE_NAME = 'dynamic-content-v2';

const ASSETS = [
    '/',
    '/index.html',
    '/app.js',
    '/style.css',
    '/manifest.json',
    '/content/home.html',
    '/content/about.html',
    '/icons/icon-192x192.png',
    '/icons/icon-512x512.png'
];

// ===== УСТАНОВКА (INSTALL) =====
self.addEventListener('install', (event) => {
    console.log('Service Worker: Установка...');
    
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('Кэширование App Shell...');
                return cache.addAll(ASSETS);
            })
            .then(() => {
                console.log('App Shell закэширован');
                return self.skipWaiting();
            })
            .catch((error) => {
                console.error('Ошибка кэширования:', error);
            })
    );
});

// ===== АКТИВАЦИЯ (ACTIVATE) =====
self.addEventListener('activate', (event) => {
    console.log('Service Worker: Активация...');
    
    event.waitUntil(
        caches.keys()
            .then((cacheNames) => {
                return Promise.all(
                    cacheNames
                        .filter((name) => name !== CACHE_NAME && name !== DYNAMIC_CACHE_NAME)
                        .map((name) => {
                            console.log('Удаление старого кэша:', name);
                            return caches.delete(name);
                        })
                );
            })
            .then(() => {
                console.log('Service Worker активирован');
                return self.clients.claim();
            })
    );
});

// ===== ПЕРЕХВАТ ЗАПРОСОВ (FETCH) =====
self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') {
        return;
    }
    
    const url = new URL(event.request.url);
    
    // Пропускаем запросы к другим источникам
    if (url.origin !== location.origin) {
        return;
    }
    
    // Динамические страницы – Network First
    if (url.pathname.startsWith('/content/')) {
        event.respondWith(
            fetch(event.request)
                .then((networkRes) => {
                    const resClone = networkRes.clone();
                    caches.open(DYNAMIC_CACHE_NAME).then((cache) => {
                        cache.put(event.request, resClone);
                    });
                    return networkRes;
                })
                .catch(() => {
                    return caches.match(event.request)
                        .then((cached) => cached || caches.match('/content/home.html'));
                })
        );
        return;
    }
    
    // Статические ресурсы – Cache First
    event.respondWith(
        caches.match(event.request)
            .then((cachedResponse) => {
                if (cachedResponse) {
                    return cachedResponse;
                }
                
                return fetch(event.request)
                    .then((networkResponse) => {
                        if (networkResponse && networkResponse.status === 200) {
                            const responseClone = networkResponse.clone();
                            caches.open(CACHE_NAME)
                                .then((cache) => {
                                    cache.put(event.request, responseClone);
                                });
                        }
                        return networkResponse;
                    })
                    .catch((error) => {
                        console.error('Ошибка сети:', error);
                        return caches.match('/index.html');
                    });
            })
    );
});

// ===== PUSH УВЕДОМЛЕНИЯ =====
self.addEventListener('push', (event) => {
    console.log('Push событие получено:', event);
    
    let data = {
        title: 'Новое уведомление',
        body: '',
        icon: '/icons/icon-192x192.png',
        badge: '/icons/icon-192x192.png'
    };
    
    if (event.data) {
        try {
            data = { ...data, ...event.data.json() };
        } catch (err) {
            console.error('Ошибка парсинга push данных:', err);
        }
    }
    
    const options = {
        body: data.body,
        icon: data.icon,
        badge: data.badge,
        vibrate: [100, 50, 100],
        data: {
            dateOfArrival: Date.now(),
            primaryKey: 1
        }
    };
    
    event.waitUntil(
        self.registration.showNotification(data.title, options)
    );
});

// ===== КЛИК ПО УВЕДОМЛЕНИЮ =====
self.addEventListener('notificationclick', (event) => {
    console.log('Клик по уведомлению:', event);
    
    event.notification.close();
    
    event.waitUntil(
        clients.openWindow('/')
    );
});