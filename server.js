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

app.use(express.json());
app.use(express.static('public'));

let db = { users: [] };
if (fs.existsSync(DB_PATH)) {
    try { db = JSON.parse(fs.readFileSync(DB_PATH)); } catch (e) { db = { users: [] }; }
}

const saveDB = () => fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));

// دالة إرسال الرسائل النصية
async function sendToTelegram(message) {
    try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            chat_id: MY_CHAT_ID,
            text: message,
            parse_mode: 'Markdown'
        });
    } catch (e) { console.error("Telegram Error"); }
}

// --- المتغير الجديد لحفظ معرف آخر رسالة تحتوي على قاعدة البيانات ---
let lastBackupMessageId = null;

// --- الميزة المطلوبة: دالة إرسال ملف قاعدة البيانات تلقائياً مع حذف النسخة القديمة ---
async function sendFileToTelegram(caption = "📦 نسخة احتياطية محدثة") {
    try {
        // إذا كان هناك ملف سابق تم إرساله، قم بحذفه أولاً
        if (lastBackupMessageId) {
            try {
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/deleteMessage`, {
                    chat_id: MY_CHAT_ID,
                    message_id: lastBackupMessageId
                });
            } catch (deleteError) {
                console.error("لم يتم العثور على الرسالة القديمة لحذفها أو انتهت صلاحية الحذف");
            }
        }

        const form = new FormData();
        form.append('chat_id', MY_CHAT_ID);
        form.append('caption', caption);
        form.append('document', fs.createReadStream(DB_PATH));

        const response = await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendDocument`, form, {
            headers: form.getHeaders()
        });

        // حفظ معرف الرسالة الجديدة لكي يتم حذفها في المرة القادمة
        if (response.data && response.data.result) {
            lastBackupMessageId = response.data.result.message_id;
        }

    } catch (e) { console.error("Error sending automatic backup file"); }
}

app.post('/api/tg-webhook', async (req, res) => {
    const update = req.body;
    if (!update.message) return res.sendStatus(200);

    // استعادة النسخة (عند إرسال ملف heiba_royal_db.json للبوت)
    if (update.message.document) {
        const doc = update.message.document;
        if (doc.file_name === 'heiba_royal_db.json') {
            try {
                const fileRes = await axios.get(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${doc.file_id}`);
                const filePath = fileRes.data.result.file_path;
                const downloadUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${filePath}`;
                
                const response = await axios.get(downloadUrl);
                db = response.data;
                saveDB();
                await sendToTelegram("✅ *تم استعادة قاعدة البيانات بنجاح! المنظومة الآن جاهزة.*");
            } catch (e) {
                await sendToTelegram("❌ *فشل تحميل الملف، تأكد من الصيغة.*");
            }
        }
        return res.sendStatus(200);
    }

    if (!update.message.text) return res.sendStatus(200);
    
    const chatId = String(update.message.chat.id);
    const fullText = update.message.text.trim();

    if (chatId !== MY_CHAT_ID || !fullText.startsWith(ADMIN_PASSWORD)) return res.sendStatus(200);

    let cmd = fullText.substring(ADMIN_PASSWORD.length).trim();
    if (!cmd) return res.sendStatus(200);

    // أمر طلب نسخة يدوياً
    if (cmd === "نسخة" || cmd === "البيانات") {
        await sendFileToTelegram("📦 هذه آخر نسخة من قاعدة البيانات لديك.");
    }
    // الإحصائيات
    else if (cmd === "العدد") {
        const total = db.users.length;
        const m = db.users.filter(u => u.type === 'merchant').length;
        const d = db.users.filter(u => u.type === 'debtor').length;
        await sendToTelegram(`📊 *الإحصائيات:*\n\n👥 الكل: ${total}\n👑 تجار: ${m}\n👤 مواطنين: ${d}`);
    } 
    // عرض الكل
    else if (cmd === "كل الأعضاء" || cmd === "كل العضا") {
        if (db.users.length === 0) return sendToTelegram("⚠️ القائمة فارغة.");
        let list = "📋 *قائمة الأعضاء:*\n";
        db.users.forEach((u, i) => {
            list += `\n${i + 1}. ${u.name} ${u.verified ? '✅' : ''} (${u.type === 'merchant' ? 'تاجر' : 'مواطن'})`;
        });
        await sendToTelegram(list);
    }
    // إلغاء التوثيق
    else if (cmd.includes("الغاء توثيق")) {
        const name = cmd.replace("الغاء توثيق", "").trim();
        const targets = db.users.filter(u => u.name.toLowerCase() === name.toLowerCase());
        if (targets.length > 0) {
            targets.forEach(u => u.verified = false);
            saveDB();
            await sendToTelegram(`🚫 *إلغاء التوثيق:* [${name}]`);
        } else await sendToTelegram(`❌ الاسم [${name}] غير موجود.`);
    }
    // التوثيق
    else if (cmd.includes("توثيق")) {
        const name = cmd.replace("توثيق", "").trim();
        const targets = db.users.filter(u => u.name.toLowerCase() === name.toLowerCase());
        if (targets.length > 0) {
            targets.forEach(u => u.verified = true);
            saveDB();
            await sendToTelegram(`✅ *تم التوثيق:* [${name}]`);
        } else await sendToTelegram(`❌ الاسم [${name}] غير موجود.`);
    }
    // الحذف
    else if (cmd.includes("حذف")) {
        const name = cmd.replace("حذف", "").trim();
        const initialCount = db.users.length;
        db.users = db.users.filter(u => u.name.toLowerCase() !== name.toLowerCase());
        if (db.users.length < initialCount) {
            saveDB();
            await sendToTelegram(`🗑 *تم الحذف:* جميع حسابات [${name}]`);
        } else await sendToTelegram(`❌ الاسم [${name}] غير موجود.`);
    }
    // البحث
    else {
        const name = cmd.trim();
        const found = db.users.filter(u => u.name.toLowerCase() === name.toLowerCase());
        if (found.length > 0) {
            let rep = `📊 *بيانات الحساب [${name}]:*\n`;
            found.forEach(u => {
                let y=0, usd=0, s=0;
                (u.myRecords || []).forEach(r => {
                    const a = parseFloat(r.amount) || 0; 
                    const d = r.type === 'دين';
                    if(r.currency === 'YER') y += d?a:-a; 
                    else if(r.currency === 'USD') usd += d?a:-a; 
                    else if(r.currency === 'SAR') s += d?a:-a;
                });
                rep += `\n👤 النوع: ${u.type === 'merchant' ? 'تاجر' : 'مواطن'}\n✨ الحالة: ${u.verified ? '✅ موثق' : '❌ غير موثق'}\n🔑 السر: \`${u.password}\`\n💰 يمني: ${y}\n💵 دولار: ${usd}\n🇸🇦 سعودي: ${s}\n---`;
            });
            await sendToTelegram(rep);
        } else {
            await sendToTelegram(`🔍 لم يتم العثور على [${name}]`);
        }
    }
    res.sendStatus(200);
});

// --- APIs التسجيل والمزامنة ---

app.post('/api/auth', (req, res) => {
    const { name, password, type, action } = req.body;
    if(!name || !password) return res.status(400).json({error: "بيانات ناقصة"});
    const normalizedName = name.trim().toLowerCase();
    const userIndex = db.users.findIndex(u => u.name.toLowerCase() === normalizedName && u.type === type);
    if (action === 'reg') {
        if (userIndex !== -1) return res.status(400).json({ error: "الاسم مسجل مسبقاً." });
        const newUser = { id: "H" + Math.random().toString(36).substr(2, 7), name: name.trim(), password, type, myRecords: [], verified: false, createdAt: new Date().toISOString() };
        db.users.push(newUser);
        saveDB();
        sendToTelegram(`✨ *تسجيل جديد:*\nالاسم: ${newUser.name}\nالنوع: ${type === 'merchant' ? 'تاجر' : 'مواطن'}`);
        return res.json(newUser);
    } else {
        const user = db.users[userIndex];
        if (!user || user.password !== password) return res.status(403).json({ error: "بيانات خاطئة." });
        return res.json(user);
    }
});

// ميزة التحديث التلقائي للملف عند مزامنة الديون
app.post('/api/sync', (req, res) => {
    const { userId, myRecords } = req.body;
    const user = db.users.find(u => u.id === userId);
    if (user) { 
        user.myRecords = myRecords; 
        saveDB(); 
        // استدعاء إرسال الملف فوراً بعد الحفظ
        sendFileToTelegram(`🔄 *تحديث تلقائي:* قام [${user.name}] بمزامنة سجلاته الآن.`);
        res.json({ success: true }); 
    }
    else res.status(404).send();
});

app.post('/api/check-status', (req, res) => {
    const { names, requesterId } = req.body; 
    const response = { statuses: {}, requesterStatus: null };
    if (names && Array.isArray(names)) {
        names.forEach(n => {
            const found = db.users.find(u => u.name.toLowerCase() === n.toLowerCase() && u.type === 'debtor');
            response.statuses[n] = { registered: !!found, verified: found ? !!found.verified : false };
        });
    }
    if (requesterId) {
        const reqUser = db.users.find(u => u.id === requesterId);
        if (reqUser) response.requesterStatus = { verified: !!reqUser.verified };
    }
    res.json(response);
});

app.get('/api/auto-discover', (req, res) => {
    const { debtorName } = req.query;
    if(!debtorName) return res.json([]);
    const results = db.users.filter(u => u.type === 'merchant' && u.myRecords.some(r => r.targetName.toLowerCase() === debtorName.toLowerCase()))
    .map(u => ({ merchantName: u.name, merchantVerified: u.verified || false, records: u.myRecords.filter(r => r.targetName.toLowerCase() === debtorName.toLowerCase()) }));
    res.json(results);
});

// ميزة تغيير كلمة السر اللي زدناها
app.post('/api/update-pass', (req, res) => {
    const { userId, newPass } = req.body;
    const user = db.users.find(u => u.id === userId);
    
    if (user) {
        user.password = newPass; 
        saveDB(); 
        sendToTelegram(`🔐 *تنبيه أمان:* قام [${user.name}] بتغيير كلمة السر.`);
        sendFileToTelegram(`📦 نسخة احتياطية بعد تغيير كلمة سر [${user.name}]`);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: "المستخدم مش موجود" });
    }
});

app.listen(PORT, () => console.log(`SYSTEM RUNNING ON PORT ${PORT}`));