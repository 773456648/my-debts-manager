const express = require('express');
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const app = express();

const PORT = process.env.PORT || 3000;
const DB_PATH = './heiba_royal_db.json';

// إعدادات التلجرام
const TELEGRAM_TOKEN = '7543475859:AAENXZxHPQZafOlvBwFr6EatUFD31iYq-ks';
const MY_CHAT_ID = '5042495708';
const ADMIN_PASSWORD = '771232690'; 
const SERVER_URL = 'https://my-debts-manager-1-ff35.onrender.com/api/tg-webhook';

app.use(express.json());
app.use(express.static('public'));

let db = { users: [] };
if (fs.existsSync(DB_PATH)) {
    try { db = JSON.parse(fs.readFileSync(DB_PATH)); } catch (e) { db = { users: [] }; }
}

const saveDB = () => fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));

// دالة إرسال التنبيهات
async function sendToTelegram(message) {
    try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            chat_id: MY_CHAT_ID,
            text: message,
            parse_mode: 'Markdown'
        });
    } catch (e) { console.error("Telegram Error"); }
}

let lastBackupMessageId = null;

// دالة إرسال الملف (مع حذف القديم)
async function sendFileToTelegram(caption = "📦 نسخة احتياطية محدثة") {
    try {
        if (lastBackupMessageId) {
            try {
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/deleteMessage`, {
                    chat_id: MY_CHAT_ID,
                    message_id: lastBackupMessageId
                });
            } catch (e) {}
        }
        const form = new FormData();
        form.append('chat_id', MY_CHAT_ID);
        form.append('caption', caption);
        form.append('document', fs.createReadStream(DB_PATH));
        const response = await axios.post(`https://api.telegram.org/sendDocument`, form, {
            headers: form.getHeaders()
        });
        if (response.data && response.data.result) {
            lastBackupMessageId = response.data.result.message_id;
        }
    } catch (e) { console.error("Error sending backup file"); }
}

// --- التعامل مع الرسائل الواردة ---
app.post('/api/tg-webhook', async (req, res) => {
    const update = req.body;
    if (!update.message) return res.sendStatus(200);

    // ميزة الاستعادة اليدوية (لو أرسلت الملف بنفسك)
    if (update.message.document && update.message.document.file_name === 'heiba_royal_db.json') {
        try {
            const fileRes = await axios.get(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${update.message.document.file_id}`);
            const response = await axios.get(`https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${fileRes.data.result.file_path}`);
            db = response.data;
            saveDB();
            await sendToTelegram("✅ *تم استعادة البيانات يدوياً بنجاح!*");
        } catch (e) { await sendToTelegram("❌ فشل الاستعادة اليدوية."); }
    }
    res.sendStatus(200);
});

// --- APIs النظام (تسجيل ومزامنة) ---
app.post('/api/auth', (req, res) => {
    const { name, password, type, action } = req.body;
    const userIndex = db.users.findIndex(u => u.name.toLowerCase() === name.trim().toLowerCase() && u.type === type);
    if (action === 'reg') {
        if (userIndex !== -1) return res.status(400).json({ error: "مسجل مسبقاً" });
        const newUser = { id: "H" + Math.random().toString(36).substr(2, 7), name: name.trim(), password, type, myRecords: [], verified: false };
        db.users.push(newUser);
        saveDB();
        sendToTelegram(`✨ تسجيل جديد: ${newUser.name}`);
        return res.json(newUser);
    } else {
        const user = db.users[userIndex];
        if (!user || user.password !== password) return res.status(403).json({ error: "خطأ" });
        return res.json(user);
    }
});

app.post('/api/sync', (req, res) => {
    const { userId, myRecords } = req.body;
    const user = db.users.find(u => u.id === userId);
    if (user) { 
        user.myRecords = myRecords; 
        saveDB(); 
        sendFileToTelegram(`🔄 تحديث من [${user.name}]`);
        res.json({ success: true }); 
    } else res.status(404).send();
});

// --- الدالة السحرية: سحب النسخة تلقائياً عند الإقلاع ---
async function bootAndRecover() {
    console.log("⚙️ جاري بدء التشغيل وسحب البيانات من التلجرام...");
    try {
        // 1. تنظيف الـ Webhook للبحث
        await axios.get(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/deleteWebhook`);
        
        // 2. سحب آخر التحديثات
        const res = await axios.get(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates?limit=50&offset=-1`);
        const updates = res.data.result;
        
        let backupFileId = null;
        for (let i = updates.length - 1; i >= 0; i--) {
            const msg = updates[i].message || updates[i].channel_post;
            if (msg && msg.document && msg.document.file_name === 'heiba_royal_db.json') {
                backupFileId = msg.document.file_id;
                break;
            }
        }

        if (backupFileId) {
            const fileRes = await axios.get(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${backupFileId}`);
            const fileData = await axios.get(`https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${fileRes.data.result.file_path}`);
            db = fileData.data; 
            saveDB(); // كذا الملف رجع للسيرفر طوالي
            console.log("✅ تم استرجاع البيانات بنجاح.");
            await sendToTelegram("🚀 *السيرفر اشتغل واسترجع آخر نسخة تلقائياً!*");
        }
    } catch (e) {
        console.log("⚠️ لم يتم العثور على نسخة سابقة أو حدث خطأ.");
    } finally {
        // 3. إعادة تفعيل الـ Webhook وفتح السيرفر
        await axios.get(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/setWebhook?url=${SERVER_URL}`);
        app.listen(PORT, () => console.log(`✅ النظام جاهز الآن على منفذ ${PORT}`));
    }
}

// تشغيل النظام
bootAndRecover();