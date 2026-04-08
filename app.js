// ===== ЭЛЕМЕНТЫ DOM =====
const contentDiv = document.getElementById('app-content');
const homeBtn = document.getElementById('home-btn');
const aboutBtn = document.getElementById('about-btn');
const enablePushBtn = document.getElementById('enable-push');
const disablePushBtn = document.getElementById('disable-push');

// ===== SOCKET.IO (HTTP для разработки) =====
const socket = io('http://localhost:3001');

let publicKey = '';
let pushSubscription = null;

// ===== НАВИГАЦИЯ =====
function setActiveButton(activeId) {
    [homeBtn, aboutBtn].forEach(btn => btn.classList.remove('active'));
    document.getElementById(activeId)?.classList.add('active');
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

if (homeBtn) homeBtn.addEventListener('click', () => {
    setActiveButton('home-btn');
    loadContent('home');
});

if (aboutBtn) aboutBtn.addEventListener('click', () => {
    setActiveButton('about-btn');
    loadContent('about');
});

// ===== ЗАГРУЗКА ПРИ СТАРТЕ =====
document.addEventListener('DOMContentLoaded', () => {
    loadContent('home');
    registerServiceWorker();
    getVapidPublicKey();
});

// ===== VAPID КЛЮЧ =====
async function getVapidPublicKey() {
    try {
        const response = await fetch('/vapid-public-key');
        const data = await response.json();
        publicKey = data.publicKey;
    } catch (err) {
        console.error('Ошибка получения VAPID ключа:', err);
    }
}

// ===== SERVICE WORKER =====
async function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        try {
            const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
            console.log('Service Worker зарегистрирован');
            await setupPushButtons(registration);
        } catch (error) {
            console.error('Ошибка регистрации Service Worker:', error);
        }
    }
}

// ===== PUSH КНОПКИ =====
async function setupPushButtons(registration) {
    if (!enablePushBtn || !disablePushBtn) return;
    
    const subscription = await registration.pushManager.getSubscription();
    
    if (subscription) {
        pushSubscription = subscription;
        enablePushBtn.style.display = 'none';
        disablePushBtn.style.display = 'inline-block';
    } else {
        enablePushBtn.style.display = 'inline-block';
        disablePushBtn.style.display = 'none';
    }
    
    enablePushBtn.addEventListener('click', async () => {
        if (Notification.permission === 'denied') {
            alert('Разрешите уведомления в настройках браузера');
            return;
        }
        if (Notification.permission === 'default') {
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') return;
        }
        await subscribeToPush(registration);
    });
    
    disablePushBtn.addEventListener('click', async () => {
        await unsubscribeFromPush(registration);
    });
}

async function subscribeToPush(registration) {
    try {
        const subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey)
        });
        
        await fetch('/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(subscription)
        });
        
        pushSubscription = subscription;
        showNotification('Уведомления включены!', 'success');
        enablePushBtn.style.display = 'none';
        disablePushBtn.style.display = 'inline-block';
    } catch (err) {
        console.error('Ошибка подписки:', err);
        showNotification('Ошибка включения уведомлений', 'error');
    }
}

async function unsubscribeFromPush(registration) {
    try {
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
            await subscription.unsubscribe();
            await fetch('/unsubscribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ endpoint: subscription.endpoint })
            });
            pushSubscription = null;
            showNotification('Уведомления отключены', 'success');
            enablePushBtn.style.display = 'inline-block';
            disablePushBtn.style.display = 'none';
        }
    } catch (err) {
        console.error('Ошибка отписки:', err);
    }
}

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

// ===== УВЕДОМЛЕНИЯ НА СТРАНИЦЕ (ИСПРАВЛЕНО!) =====
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
        max-width: 400px;
        word-wrap: break-word;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
        animation: slideIn 0.3s ease;
    `;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
}

// ===== ЗАМЕТКИ С НАПОМИНАНИЯМИ =====
function initNotes() {
    const form = document.getElementById('note-form');
    const input = document.getElementById('note-input');
    const reminderForm = document.getElementById('reminder-form');
    const reminderText = document.getElementById('reminder-text');
    const reminderDate = document.getElementById('reminder-date');
    const reminderTimeInput = document.getElementById('reminder-time-input');
    const list = document.getElementById('notes-list');

    // Устанавливаем минимальную дату (сегодня)
    if (reminderDate) {
        const today = new Date().toISOString().split('T')[0];
        reminderDate.min = today;
    }

    // Устанавливаем время по умолчанию (текущее + 1 минута)
    if (reminderTimeInput) {
        const now = new Date();
        now.setMinutes(now.getMinutes() + 1);
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        reminderTimeInput.value = `${hours}:${minutes}`;
    }

    function loadNotes() {
        const notes = JSON.parse(localStorage.getItem('notes') || '[]');
        
        if (notes.length === 0) {
            list.innerHTML = '<li class="is-center" style="padding: 2rem; color: #999;">Заметок пока нет</li>';
        } else {
            list.innerHTML = notes.map(note => {
                let reminderInfo = '';
                if (note.reminder) {
                    const date = new Date(note.reminder);
                    reminderInfo = `<br><small style="color: #e74c3c;">Напоминание: ${date.toLocaleString('ru-RU')}</small>`;
                }
                return `<li class="card" style="margin-bottom: 0.5rem; padding: 0.5rem; display: flex; justify-content: space-between; align-items: center;">
                    <span>${escapeHtml(note.text)}${reminderInfo}</span>
                    <button class="button is-small is-error" onclick="deleteNote(${note.id})">Удалить</button>
                </li>`;
            }).join('');
        }
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function addNote(text, reminderTimestamp = null) {
        const notes = JSON.parse(localStorage.getItem('notes') || '[]');
        const newNote = {
            id: Date.now(),
            text: text,
            reminder: reminderTimestamp
        };
        notes.push(newNote);
        localStorage.setItem('notes', JSON.stringify(notes));
        
        // Отправляем на сервер ТОЛЬКО если есть напоминание
        if (reminderTimestamp) {
            socket.emit('newReminder', {
                id: newNote.id,
                text: text,
                reminderTime: reminderTimestamp
            });
        } else {
            socket.emit('newTask', { text, timestamp: Date.now() });
        }
        
        loadNotes();
    }

    window.deleteNote = function(id) {
        let notes = JSON.parse(localStorage.getItem('notes') || '[]');
        notes = notes.filter(note => note.id !== id);
        localStorage.setItem('notes', JSON.stringify(notes));
        loadNotes();
    };

    // Обработка обычной заметки
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

    // Обработка заметки с напоминанием
    if (reminderForm) {
        reminderForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const text = reminderText.value.trim();
            const date = reminderDate.value;
            const time = reminderTimeInput.value;
            
            if (text && date && time) {
                // Объединяем дату и время
                const timestamp = new Date(`${date}T${time}`).getTime();
                
                if (timestamp > Date.now()) {
                    addNote(text, timestamp);
                    
                    // Очищаем поля
                    reminderText.value = '';
                    reminderDate.value = '';
                    reminderTimeInput.value = '';
                    
                    showNotification('Напоминание установлено!', 'success');
                } else {
                    alert('Дата/время должны быть в будущем');
                }
            } else {
                alert('Заполните все поля');
            }
        });
    }

    // Обработка событий от сервера
    socket.on('taskAdded', (task) => {
        console.log('Задача от другого клиента:', task);
        loadNotes();
    });

    socket.on('reminderAdded', (reminder) => {
        console.log('Напоминание установлено:', reminder);
        showNotification(`Напоминание: ${reminder.text}`, 'success');
        loadNotes();
    });

    loadNotes();
}