// ===== ЭЛЕМЕНТЫ DOM =====
const contentDiv = document.getElementById('app-content');
const homeBtn = document.getElementById('home-btn');
const aboutBtn = document.getElementById('about-btn');
const connectionStatus = document.getElementById('connection-status');
const enablePushBtn = document.getElementById('enable-push');
const disablePushBtn = document.getElementById('disable-push');

// ===== ПОДКЛЮЧЕНИЕ К SOCKET.IO =====
const socket = io('http://localhost:3001');

let publicKey = '';

// ===== НАВИГАЦИЯ =====
function setActiveButton(activeId) {
    [homeBtn, aboutBtn].forEach(btn => btn.classList.remove('active'));
    document.getElementById(activeId).classList.add('active');
}

async function loadContent(page) {
    try {
        const response = await fetch(`/content/${page}.html`);
        const html = await response.text();
        contentDiv.innerHTML = html;
        
        if (page === 'home') {
            initNotes();
        }
    } catch (err) {
        contentDiv.innerHTML = `<p class="is-center text-error">Ошибка загрузки страницы.</p>`;
        console.error(err);
    }
}

homeBtn.addEventListener('click', () => {
    setActiveButton('home-btn');
    loadContent('home');
});

aboutBtn.addEventListener('click', () => {
    setActiveButton('about-btn');
    loadContent('about');
});

// ===== ЗАГРУЗКА ПРИ СТАРТЕ =====
document.addEventListener('DOMContentLoaded', () => {
    loadContent('home');
    registerServiceWorker();
    updateConnectionStatus();
    getVapidPublicKey();
});

// ===== ПРОВЕРКА СОЕДИНЕНИЯ =====
function updateConnectionStatus() {
    if (connectionStatus) {
        if (navigator.onLine) {
            connectionStatus.textContent = '🟢 Онлайн';
            connectionStatus.className = 'tag is-success';
        } else {
            connectionStatus.textContent = '🟠 Офлайн (работаем из кэша)';
            connectionStatus.className = 'tag is-warning';
        }
    }
}

window.addEventListener('online', updateConnectionStatus);
window.addEventListener('offline', updateConnectionStatus);

// ===== ПОЛУЧЕНИЕ VAPID КЛЮЧА =====
async function getVapidPublicKey() {
    try {
        const response = await fetch('http://localhost:3001/vapid-public-key');
        const data = await response.json();
        publicKey = data.publicKey;
        console.log('VAPID Public Key получен:', publicKey);
    } catch (err) {
        console.error('Ошибка получения VAPID ключа:', err);
    }
}

// ===== РЕГИСТРАЦИЯ SERVICE WORKER =====
async function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        try {
            const registration = await navigator.serviceWorker.register('/sw.js', {
                scope: '/'
            });
            
            console.log('Service Worker зарегистрирован:', registration.scope);
            
            // Настраиваем кнопки push после регистрации SW
            setupPushButtons(registration);
            
        } catch (error) {
            console.error('Ошибка регистрации Service Worker:', error);
        }
    } else {
        console.warn('Service Worker не поддерживается');
    }
}

// ===== НАСТРОЙКА КНОПОК PUSH =====
async function setupPushButtons(registration) {
    if (!enablePushBtn || !disablePushBtn) return;
    
    // Проверяем текущую подписку
    const subscription = await registration.pushManager.getSubscription();
    
    if (subscription) {
        enablePushBtn.style.display = 'none';
        disablePushBtn.style.display = 'inline-block';
    } else {
        enablePushBtn.style.display = 'inline-block';
        disablePushBtn.style.display = 'none';
    }
    
    // Обработчик включения
    enablePushBtn.addEventListener('click', async () => {
        if (Notification.permission === 'denied') {
            alert('Уведомления запрещены. Разрешите их в настройках браузера.');
            return;
        }
        
        if (Notification.permission === 'default') {
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') {
                alert('Необходимо разрешить уведомления.');
                return;
            }
        }
        
        await subscribeToPush(registration);
        enablePushBtn.style.display = 'none';
        disablePushBtn.style.display = 'inline-block';
    });
    
    // Обработчик отключения
    disablePushBtn.addEventListener('click', async () => {
        await unsubscribeFromPush(registration);
        disablePushBtn.style.display = 'none';
        enablePushBtn.style.display = 'inline-block';
    });
}

// ===== ПОДПИСКА НА PUSH =====
async function subscribeToPush(registration) {
    if (!('PushManager' in window)) {
        alert('Push notifications not supported');
        return;
    }
    
    try {
        const subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey)
        });
        
        // Отправляем подписку на сервер
        await fetch('http://localhost:3001/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(subscription)
        });
        
        console.log('Подписка на push отправлена');
        showNotification('Уведомления включены!', 'success');
    } catch (err) {
        console.error('Ошибка подписки на push:', err);
        showNotification('Ошибка включения уведомлений', 'error');
    }
}

// ===== ОТПИСКА ОТ PUSH =====
async function unsubscribeFromPush(registration) {
    try {
        const subscription = await registration.pushManager.getSubscription();
        
        if (subscription) {
            await fetch('http://localhost:3001/unsubscribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ endpoint: subscription.endpoint })
            });
            
            await subscription.unsubscribe();
            console.log('Отписка выполнена');
            showNotification('Уведомления отключены', 'success');
        }
    } catch (err) {
        console.error('Ошибка отписки:', err);
        showNotification('Ошибка отключения уведомлений', 'error');
    }
}

// ===== КОНВЕРТАЦИЯ VAPID КЛЮЧА =====
function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
        .replace(/\-/g, '+')
        .replace(/_/g, '/');
    
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    
    return outputArray;
}

// ===== ПОКАЗ УВЕДОМЛЕНИЯ НА СТРАНИЦЕ =====
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${type === 'success' ? '#27ae60' : type === 'error' ? '#e74c3c' : '#4285f4'};
        color: white;
        padding: 1rem 1.5rem;
        border-radius: 5px;
        z-index: 1000;
        animation: slideIn 0.3s ease;
    `;
    
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
}

// ===== ФУНКЦИОНАЛ ЗАМЕТОК =====
function initNotes() {
    const form = document.getElementById('note-form');
    const input = document.getElementById('note-input');
    const list = document.getElementById('notes-list');
    const swState = document.getElementById('sw-state');

    // Обновляем статус SW
    if ('serviceWorker' in navigator && swState) {
        navigator.serviceWorker.getRegistration().then(registration => {
            if (registration) {
                swState.textContent = `Активен (scope: ${registration.scope})`;
                swState.style.color = '#27ae60';
            }
        });
    }

    // Загрузка заметок
    function loadNotes() {
        const notes = JSON.parse(localStorage.getItem('notes') || '[]');
        
        if (notes.length === 0) {
            list.innerHTML = '<li class="is-center" style="padding: 2rem; color: #999;">Заметок пока нет. Добавьте первую!</li>';
        } else {
            list.innerHTML = notes.map((note, index) => `
                <li class="card" style="margin-bottom: 0.5rem; padding: 0.5rem; display: flex; justify-content: space-between; align-items: center;">
                    <span>${escapeHtml(note.text || note)}</span>
                    <button class="button is-small is-error" onclick="deleteNote(${index})">Удалить</button>
                </li>
            `).join('');
        }
    }

    // Экранирование HTML
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Добавление заметки
    function addNote(text) {
        const notes = JSON.parse(localStorage.getItem('notes') || '[]');
        const newNote = {
            id: Date.now(),
            text: text,
            timestamp: new Date().toLocaleString('ru-RU')
        };
        notes.push(newNote);
        localStorage.setItem('notes', JSON.stringify(notes));
        
        // Отправляем событие на сервер через WebSocket
        socket.emit('newTask', newNote);
        
        loadNotes();
    }

    // Удаление заметки
    window.deleteNote = function(index) {
        const notes = JSON.parse(localStorage.getItem('notes') || '[]');
        notes.splice(index, 1);
        localStorage.setItem('notes', JSON.stringify(notes));
        loadNotes();
    };

    // Обработка формы
    if (form) {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const text = input.value.trim();
            if (text) {
                addNote(text);
                input.value = '';
            }
        });
    }

    // Обработка событий от других клиентов
    socket.on('taskAdded', (task) => {
        console.log('Задача от другого клиента:', task);
        showNotification(`📝 Новая задача: ${task.text || task}`);
        loadNotes();
    });

    // Первоначальная загрузка
    loadNotes();
}