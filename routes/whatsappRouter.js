const express = require("express");

const {
  pairWhatsApp,
  getWhatsAppStatus,
  logoutWhatsApp,
  sendWhatsAppMessage,
  startWhatsApp
} = require("../controllers/whatsappController");



const router = express.Router();

// إنشاء كود ربط
router.post("/pair", pairWhatsApp);
router.post("/send-message", sendWhatsAppMessage);
// معرفة حالة الرقم
router.get("/status/:numberphone", getWhatsAppStatus);

// تسجيل خروج الرقم
router.post("/logout/:numberphone", logoutWhatsApp);




module.exports = router;