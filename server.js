const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const webpush = require('web-push');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');

// ===== VAPID КЛЮЧИ =====
// Сгенерируйте свои ключи командой: npx web-push generate-vapid-keys
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

// Хранилище подписок (в памяти)
let subscriptions = [];

const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// ===== WebSocket подключения =====
io.on('connection', (socket) => {
    console.log('Клиент подключён:', socket.id);

    // Обработка события 'newTask' от клиента
    socket.on('newTask', (task) => {
        console.log('Новая задача:', task);

        // Рассылаем событие всем подключённым клиентам
        io.emit('taskAdded', task);

        // Отправляем push-уведомление всем подписанным
        const payload = JSON.stringify({
            title: 'Новая задача',
            body: task.text || 'Добавлена новая заметка'
        });

        subscriptions.forEach(sub => {
            webpush.sendNotification(sub, payload)
                .catch(err => {
                    console.error('Push error:', err.message);
                    // Удаляем невалидную подписку
                    if (err.statusCode === 410) {
                        subscriptions = subscriptions.filter(s => s.endpoint !== sub.endpoint);
                    }
                });
        });
    });

    socket.on('disconnect', () => {
        console.log('Клиент отключён:', socket.id);
    });
});

// ===== Эндпоинты для push-подписок =====
app.post('/subscribe', (req, res) => {
    const subscription = req.body;
    
    // Проверяем, нет ли уже такой подписки
    const exists = subscriptions.some(s => s.endpoint === subscription.endpoint);
    if (!exists) {
        subscriptions.push(subscription);
        console.log('Новая подписка. Всего:', subscriptions.length);
    }
    
    res.status(201).json({ message: 'Подписка сохранена' });
});

app.post('/unsubscribe', (req, res) => {
    const { endpoint } = req.body;
    subscriptions = subscriptions.filter(sub => sub.endpoint !== endpoint);
    console.log('Подписка удалена. Осталось:', subscriptions.length);
    res.status(200).json({ message: 'Подписка удалена' });
});

// Получение публичного VAPID ключа для клиента
app.get('/vapid-public-key', (req, res) => {
    res.json({ publicKey: vapidKeys.publicKey });
});

const PORT = 3001;
server.listen(PORT, () => {
    console.log(`\n🚀 Сервер запущен на http://localhost:${PORT}`);
    console.log(`📡 WebSocket готов к подключениям\n`);
});