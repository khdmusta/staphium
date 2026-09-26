# portfolio

موقع المعرض مفكك من ملف Framer الأصلي إلى `index.html` + `assets/css` + `assets/js`
دون أي تغيير في المحتوى أو التصميم أو الأنيميشن.

```
├── index.html               ← نفس صفحة Framer (CSS/JS مربوطة خارجياً)
├── admin.html               ← لوحة التحكم (المشاريع / الآراء / المدونة / الإعدادات)
├── assets/css/              ← ملفات التنسيق المستخرجة حرفياً من الأصل
├── assets/js/               ← سكربتات الموقع + طبقة الداشبورد (cms-* / admin.js)
├── supabase/                ← schema.sql + migration-002 (نفذهما مرة واحدة)
└── docs/CMS-SETUP.md        ← دليل الإعداد والاستخدام (ابدأ منه)
```

التشغيل: سيرفر ستاتيك على هذا المجلد (`npx serve .`) ثم افتح `index.html`
ولوحة التحكم `admin.html`.
