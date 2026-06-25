const express = require("express");

const {
  pairWhatsApp,
  getWhatsAppStatus,
  logoutWhatsApp,
} = require("../controllers/whatsappController");

const router = express.Router();

// إنشاء كود ربط
router.post("/pair", pairWhatsApp);

// معرفة حالة الرقم
router.get("/status/:numberphone", getWhatsAppStatus);

// تسجيل خروج الرقم
router.post("/logout/:numberphone", logoutWhatsApp);

module.exports = router;