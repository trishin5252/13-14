const CACHE_NAME = 'notes-cache-v2';
const DYNAMIC_CACHE_NAME = 'dynamic-content-v1';

const ASSETS = [
    '/', '/index.html', '/app.js', '/manifest.json',
    '/icons/icon-192x192.png', '/icons/icon-256x256.png', '/icons/icon-512x512.png'
];

// ===== INSTALL =====
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(ASSETS))
            .then(() => self.skipWaiting())
    );
});

// ===== ACTIVATE =====
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(
                keys.filter(key => key !== CACHE_NAME && key !== DYNAMIC_CACHE_NAME)
                    .map(key => caches.delete(key))
            );
        }).then(() => self.clients.claim())
    );
});

// ===== FETCH =====
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    if (url.origin !== location.origin) return;
    
    if (url.pathname.startsWith('/content/')) {
        event.respondWith(
            fetch(event.request)
                .then(networkRes => {
                    const resClone = networkRes.clone();
                    caches.open(DYNAMIC_CACHE_NAME).then(cache => {
                        cache.put(event.request, resClone);
                    });
                    return networkRes;
                })
                .catch(() => caches.match(event.request))
        );
    }
});

// ===== PUSH УВЕДОМЛЕНИЯ =====
self.addEventListener('push', event => {
    console.log('Push получен');
    
    const data = event.data ? event.data.json() : {};
    
    const options = {
        body: data.body || '',
        icon: '/icons/icon-192x192.png',
        badge: '/icons/icon-192x192.png',
        tag: 'notes-notification',
        data: { reminderId: data.reminderId }
    };
    
    // Добавляем кнопку "Отложить" только для напоминаний
    if (data.reminderId) {
        options.actions = [
            { action: 'snooze', title: 'Отложить на 5 минут' }
        ];
    }
    
    event.waitUntil(
        self.registration.showNotification(data.title || 'Новое уведомление', options)
    );
});

// ===== ОБРАБОТКА КЛИКА ПО УВЕДОМЛЕНИЮ =====
self.addEventListener('notificationclick', event => {
    const notification = event.notification;
    const action = event.action;
    
    notification.close();
    
    if (action === 'snooze') {
        // Обработка кнопки "Отложить"
        const reminderId = notification.data?.reminderId;
        
        if (reminderId) {
            event.waitUntil(
                fetch(`/snooze?reminderId=${reminderId}`, { method: 'POST' })
                    .then(() => {
                        console.log('Напоминание отложено');
                        return self.registration.showNotification('Напоминание отложено', {
                            body: 'Напоминание перенесено на 5 минут',
                            icon: '/icons/icon-192x192.png'
                        });
                    })
                    .catch(err => console.error('Snooze failed:', err))
            );
        }
    } else {
        // Обычный клик — открываем приложение
        event.waitUntil(clients.openWindow('/'));
    }
});