const http = require('http');
const express = require('express');
const socketIo = require('socket.io');
const webpush = require('web-push');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');

// ===== VAPID КЛЮЧИ =====
const vapidKeys = {
    publicKey: 'BFDXq8vQvHR-_AZz25CYHMTKwxMafwkMLsE4B5Pl2xwpmyiafTkn4ZRtHxxcr5uGr2Gs5aI1fpJMNm-4ViQ7G60',
    privateKey: 'fzMZmkQnPKXGdaWnLYk0TXxrDhy2pTjU9m8sLIaNbQY'
};

webpush.setVapidDetails('mailto:your-email@example.com', vapidKeys.publicKey, vapidKeys.privateKey);

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, './')));

// ===== ХРАНИЛИЩА =====
const subscriptions = new Map();
const reminders = new Map(); // { id: { timeoutId, text, reminderTime } }

// ===== HTTP СЕРВЕР + SOCKET.IO =====
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

// ===== WebSocket =====
io.on('connection', (socket) => {
    console.log('Клиент подключён:', socket.id);

    // Обычная задача
    socket.on('newTask', (task) => {
        console.log('Новая задача:', task);
        io.emit('taskAdded', task);

        const payload = JSON.stringify({
            title: 'Новая задача',
            body: task.text || 'Добавлена новая заметка',
            icon: '/icons/icon-192x192.png'
        });

        sendPushToAll(payload);
    });

    // Задача с напоминанием
    socket.on('newReminder', (reminder) => {
        const { id, text, reminderTime } = reminder;
        const delay = reminderTime - Date.now();
        
        if (delay <= 0) {
            // Напоминание уже просрочено — отправить сразу
            sendReminderPush(id, text);
            return;
        }

        console.log(`Напоминание #${id} запланировано через ${Math.round(delay/1000)} сек`);

        // Устанавливаем таймер
        const timeoutId = setTimeout(() => {
            sendReminderPush(id, text);
            reminders.delete(id);
        }, delay);

        // Сохраняем в хранилище
        reminders.set(id, { timeoutId, text, reminderTime });
    });

    socket.on('disconnect', () => {
        console.log('Клиент отключён:', socket.id);
    });
});

// ===== ОТПРАВКА PUSH ВСЕМ =====
function sendPushToAll(payload) {
    for (const [endpoint, subscription] of subscriptions) {
        webpush.sendNotification(subscription, payload)
            .then(() => console.log('Push отправлен:', endpoint))
            .catch(err => {
                console.error('Push error:', err.message);
                if (err.statusCode === 410 || err.statusCode === 404) {
                    subscriptions.delete(endpoint);
                }
            });
    }
}

// ===== ОТПРАВКА НАПОМИНАНИЯ =====
function sendReminderPush(reminderId, text) {
    const payload = JSON.stringify({
        title: 'Напоминание',
        body: text,
        reminderId: reminderId,
        icon: '/icons/icon-192x192.png'
    });
    
    io.emit('reminderAdded', { id: reminderId, text });
    sendPushToAll(payload);
}

// ===== ЭНДПОИНТЫ =====

app.post('/subscribe', (req, res) => {
    try {
        const subscription = req.body;
        if (!subscription || !subscription.endpoint) {
            return res.status(400).json({ success: false, error: 'Invalid subscription' });
        }
        subscriptions.set(subscription.endpoint, subscription);
        console.log('Новая подписка. Всего:', subscriptions.size);
        res.status(201).json({ success: true, message: 'Подписка сохранена' });
    } catch (error) {
        console.error('Ошибка подписки:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/unsubscribe', (req, res) => {
    try {
        const { endpoint } = req.body;
        if (!endpoint) return res.status(400).json({ success: false, error: 'Endpoint required' });
        
        const wasDeleted = subscriptions.delete(endpoint);
        console.log(`${wasDeleted ? 'Подписка удалена' : 'Отписка'}: ${endpoint}`);
        res.json({ success: true, message: wasDeleted ? 'Подписка удалена' : 'Не найдена' });
    } catch (error) {
        console.error('Ошибка отписки:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/vapid-public-key', (req, res) => {
    res.json({ success: true, publicKey: vapidKeys.publicKey });
});

// ===== SNOOZE ЭНДПОИНТ =====
app.post('/snooze', (req, res) => {
    const reminderId = parseInt(req.query.reminderId, 10);
    
    if (!reminderId || !reminders.has(reminderId)) {
        return res.status(404).json({ error: 'Reminder not found' });
    }
    
    const reminder = reminders.get(reminderId);
    
    // Отменяем старый таймер
    clearTimeout(reminder.timeoutId);
    
    // Устанавливаем новый через 5 минут (300000 мс)
    const newDelay = 5 * 60 * 1000;
    const newTimeoutId = setTimeout(() => {
        sendReminderPush(reminderId, reminder.text);
        reminders.delete(reminderId);
    }, newDelay);
    
    // Обновляем хранилище
    reminders.set(reminderId, {
        timeoutId: newTimeoutId,
        text: reminder.text,
        reminderTime: Date.now() + newDelay
    });
    
    console.log(`Напоминание #${reminderId} отложено на 5 минут`);
    res.status(200).json({ message: 'Reminder snoozed for 5 minutes' });
});

// ===== ЗАПУСК СЕРВЕРА =====
const PORT = 3001;
server.listen(PORT, () => {
    console.log('\n' + '='.repeat(50));
    console.log('HTTP Server запущен');
    console.log('Порт:', PORT);
    console.log('URL: http://localhost:' + PORT);
    console.log('Push-уведомления: ВКЛЮЧЕНЫ');
    console.log('Напоминания: АКТИВНЫ');
    console.log('='.repeat(50) + '\n');
});

process.on('SIGINT', () => {
    console.log('\nЗавершение работы...');
    // Очищаем все таймеры
    for (const [id, reminder] of reminders) {
        clearTimeout(reminder.timeoutId);
    }
    server.close(() => {
        console.log('Сервер остановлен');
        process.exit(0);
    });
});