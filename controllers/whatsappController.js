const {
  startWhatsAppPairing,
  getWhatsAppSessionStatus,
  logoutWhatsAppSession,
} = require("../services/whatsappService");

// POST /api/whatsapp/pair
exports.pairWhatsApp = async (req, res) => {
  try {
    const { numberphone } = req.body;

    if (!numberphone) {
      return res.status(400).json({
        success: false,
        message: "رقم الهاتف مطلوب",
      });
    }

    const result = await startWhatsAppPairing(numberphone);

    return res.status(200).json({
      success: true,
      message:
        result.status === "READY"
          ? "واتساب متصل مسبقاً"
          : "تم إنشاء كود الربط",
      data: result,
    });
  } catch (error) {
    console.error("Pair WhatsApp controller error:", error);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "فشل إنشاء كود الربط",
    });
  }
};

// GET /api/whatsapp/status/:numberphone
exports.getWhatsAppStatus = async (req, res) => {
  try {
    const { numberphone } = req.params;

    const result = getWhatsAppSessionStatus(numberphone);

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("WhatsApp status controller error:", error);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "فشل قراءة حالة واتساب",
    });
  }
};

// POST /api/whatsapp/logout/:numberphone
exports.logoutWhatsApp = async (req, res) => {
  try {
    const { numberphone } = req.params;

    const result = await logoutWhatsAppSession(numberphone);

    return res.status(200).json({
      success: true,
      message: "تم تسجيل خروج واتساب",
      data: result,
    });
  } catch (error) {
    console.error("WhatsApp logout controller error:", error);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "فشل تسجيل خروج واتساب",
    });
  }
};