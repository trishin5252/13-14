const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const express = require('express');
const socketIo = require('socket.io');
const webpush = require('web-push');
const bodyParser = require('body-parser');
const cors = require('cors');

// ===== VAPID КЛЮЧИ =====
const vapidKeys = {
    publicKey: 'BFDXq8vQvHR-_AZz25CYHMTKwxMafwkMLsE4B5Pl2xwpmyiafTkn4ZRtHxxcr5uGr2Gs5aI1fpJMNm-4ViQ7G60',
    privateKey: 'fzMZmkQnPKXGdaWnLYk0TXxrDhy2pTjU9m8sLIaNbQY'
};

webpush.setVapidDetails(
    'mailto:your-email@example.com',
    vapidKeys.publicKey,
    vapidKeys.privateKey
);

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, './')));

// ===== ХРАНИЛИЩЕ ПОДПИСОК =====
const subscriptions = new Map();

// ===== ЧТЕНИЕ HTTPS СЕРТИФИКАТОВ =====
const httpsOptions = {
    key: fs.readFileSync(path.join(__dirname, 'localhost+2-key.pem')),
    cert: fs.readFileSync(path.join(__dirname, 'localhost+2.pem'))
};

// ===== HTTPS СЕРВЕР + SOCKET.IO =====
const httpsServer = https.createServer(httpsOptions, app);
const io = socketIo(httpsServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// ===== WebSocket подключения =====
io.on('connection', (socket) => {
    console.log('🔗 Клиент подключён:', socket.id);

    socket.on('newTask', (task) => {
        console.log('📝 Новая задача:', task);

        // Рассылаем всем клиентам через WebSocket
        io.emit('taskAdded', task);

        // Отправляем Push-уведомление всем подписчикам
        const payload = JSON.stringify({
            title: '📝 Новая задача',
            body: task.text || 'Добавлена новая заметка',
            icon: '/icons/icon-192x192.png',
            badge: '/icons/icon-192x192.png',
            tag: 'new-task',
            requireInteraction: false
        });

        for (const [endpoint, subscription] of subscriptions) {
            webpush.sendNotification(subscription, payload)
                .then(() => {
                    console.log('✅ Push отправлен:', endpoint);
                })
                .catch(err => {
                    console.error('❌ Push error:', err.message);
                    if (err.statusCode === 410 || err.statusCode === 404) {
                        console.log('🗑️ Удаляем недействительную подписку:', endpoint);
                        subscriptions.delete(endpoint);
                    }
                });
        }
    });

    socket.on('disconnect', () => {
        console.log('❌ Клиент отключён:', socket.id);
    });
});

// ===== ЭНДПОИНТЫ =====

// Подписка на push-уведомления
app.post('/subscribe', (req, res) => {
    try {
        const subscription = req.body;
        
        if (!subscription || !subscription.endpoint) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid subscription data' 
            });
        }
        
        const endpoint = subscription.endpoint;
        
        if (subscriptions.has(endpoint)) {
            console.log('ℹ️ Подписка уже существует:', endpoint);
            return res.status(200).json({ 
                success: true, 
                message: 'Подписка уже активна' 
            });
        }
        
        subscriptions.set(endpoint, subscription);
        
        console.log('✅ Новая подписка. Всего:', subscriptions.size);
        console.log('   Endpoint:', endpoint);
        
        res.status(201).json({ 
            success: true, 
            message: 'Подписка сохранена',
            count: subscriptions.size
        });
        
    } catch (error) {
        console.error('❌ Ошибка подписки:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Отписка от push-уведомлений
app.post('/unsubscribe', (req, res) => {
    try {
        const { endpoint } = req.body;
        
        if (!endpoint) {
            return res.status(400).json({ 
                success: false, 
                error: 'Endpoint is required' 
            });
        }
        
        const wasDeleted = subscriptions.delete(endpoint);
        
        if (wasDeleted) {
            console.log('✅ Подписка удалена:', endpoint);
            console.log('   Осталось подписок:', subscriptions.size);
            
            res.status(200).json({ 
                success: true, 
                message: 'Подписка удалена',
                count: subscriptions.size
            });
        } else {
            console.log('⚠️ Подписка не найдена:', endpoint);
            
            res.status(200).json({ 
                success: true, 
                message: 'Подписка не найдена (уже удалена?)',
                count: subscriptions.size
            });
        }
        
    } catch (error) {
        console.error('❌ Ошибка отписки:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Получение публичного VAPID ключа
app.get('/vapid-public-key', (req, res) => {
    res.json({ 
        success: true,
        publicKey: vapidKeys.publicKey 
    });
});

// Тестовый эндпоинт для проверки push
app.post('/test-push', (req, res) => {
    const { message } = req.body || {};
    const title = message?.title || '🔔 Тестовое уведомление';
    const body = message?.body || 'Это тестовое push-уведомление';
    
    const payload = JSON.stringify({
        title: title,
        body: body,
        icon: '/icons/icon-192x192.png',
        badge: '/icons/icon-192x192.png'
    });
    
    let sent = 0;
    let failed = 0;
    
    for (const [endpoint, subscription] of subscriptions) {
        webpush.sendNotification(subscription, payload)
            .then(() => sent++)
            .catch(err => {
                failed++;
                console.error('❌ Push error:', err.message);
                if (err.statusCode === 410 || err.statusCode === 404) {
                    subscriptions.delete(endpoint);
                }
            });
    }
    
    res.json({
        success: true,
        message: `Отправка запущена: ${subscriptions.size} подписок`,
        sent: sent,
        failed: failed
    });
});

// Статус сервера
app.get('/api/status', (req, res) => {
    res.json({
        success: true,
        server: 'running',
        uptime: process.uptime(),
        subscriptions: subscriptions.size,
        connectedClients: io.engine.clientsCount
    });
});

// Обработка неизвестных маршрутов
app.use((req, res) => {
    res.status(404).json({ 
        success: false, 
        error: 'Endpoint not found' 
    });
});

// Обработка ошибок
app.use((err, req, res, next) => {
    console.error('❌ Server error:', err);
    res.status(500).json({ 
        success: false, 
        error: err.message 
    });
});

// ===== ЗАПУСК HTTPS СЕРВЕРА =====
const PORT = 3000;
httpsServer.listen(PORT, () => {
    console.log('\n' + '='.repeat(50));
    console.log('🔒 HTTPS Server запущен');
    console.log('📡 Порт:', PORT);
    console.log('🌐 URL: https://localhost:' + PORT);
    console.log('🔔 Push-уведомления: ВКЛЮЧЕНЫ');
    console.log('📊 Подписок:', subscriptions.size);
    console.log('='.repeat(50) + '\n');
});

// Обработка завершения работы
process.on('SIGINT', () => {
    console.log('\n🛑 Завершение работы сервера...');
    console.log('💾 Сохранено подписок:', subscriptions.size);
    httpsServer.close(() => {
        console.log('✅ Сервер остановлен');
        process.exit(0);
    });
});