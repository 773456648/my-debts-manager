# اختيار نظام تشغيل يحتوي على Node.js (المحرك الأساسي)
FROM node:18

# تثبيت Java و wget (هذول هم العمال اللي بيرتبوا الملفات ويغلفوا التطبيق)
RUN apt-get update && apt-get install -y default-jdk wget

# تحميل وتثبيت أداة Apktool عشان تحول الكود لـ APK طوالي
RUN wget https://raw.githubusercontent.com/iBotPeaches/Apktool/master/scripts/linux/apktool -O /usr/local/bin/apktool
RUN chmod +x /usr/local/bin/apktool
RUN wget https://github.com/iBotPeaches/Apktool/releases/download/v2.9.3/apktool_2.9.3.jar -O /usr/local/bin/apktool.jar

# تحديد مجلد العمل (المجلد اللي في صورتك) داخل السيرفر
WORKDIR /app

# نسخ ملفات المنظومة (package.json و server.js) للسيرفر
COPY package*.json ./
RUN npm install
COPY . .

# تشغيل المنظومة عشان تبدأ تستقبل الأكواد منك
CMD ["node", "server.js"]