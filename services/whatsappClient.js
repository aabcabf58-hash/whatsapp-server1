const { Client, LocalAuth } = require("whatsapp-web.js");

let whatsappReady = false;

const client = new Client({
  authStrategy: new LocalAuth({
    clientId: "whatsapp-main",
  }),

  puppeteer: {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-zygote",
    ],
  },
});

client.on("authenticated", () => {
  console.log("✅ تم تسجيل الدخول إلى WhatsApp");
});

client.on("ready", () => {
  whatsappReady = true;
  console.log("✅ WhatsApp جاهز لإرسال الرسائل");
});

client.on("auth_failure", (error) => {
  whatsappReady = false;
  console.error("❌ فشل تسجيل الدخول:", error);
});

client.on("disconnected", (reason) => {
  whatsappReady = false;
  console.log("⚠️ تم قطع اتصال WhatsApp:", reason);
});

client.initialize().catch((error) => {
  whatsappReady = false;
  console.error("❌ خطأ في تشغيل WhatsApp:", error);
});

function isWhatsAppReady() {
  return whatsappReady;
}

module.exports = {
  client,
  isWhatsAppReady,
};