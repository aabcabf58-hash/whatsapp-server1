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

const {
  client,
  isWhatsAppReady,
} = require("../services/whatsappClient");

/**
 * تنظيف رقم الهاتف.
 *
 * أمثلة:
 * 70123456    => 96170123456
 * 03712345    => 9613712345
 * +96170123456 => 96170123456
 * 0096170123456 => 96170123456
 */
function cleanPhoneNumber(numberphone) {
  let number = String(numberphone || "").replace(/\D/g, "");

  // حذف 00 من أول الرقم
  if (number.startsWith("00")) {
    number = number.substring(2);
  }

  // تحويل الرقم اللبناني المحلي إلى دولي
  if (number.startsWith("0")) {
    number = `961${number.substring(1)}`;
  }

  // إذا أرسل المستخدم 8 أرقام لبنانية من دون الصفر
  if (number.length === 8) {
    number = `961${number}`;
  }

  return number;
}

exports.sendWhatsAppMessage = async (req, res) => {
  try {
    const { numberphone, message } = req.body;

    if (!numberphone) {
      return res.status(400).json({
        success: false,
        message: "رقم الهاتف مطلوب",
      });
    }

    if (!message || !String(message).trim()) {
      return res.status(400).json({
        success: false,
        message: "نص الرسالة مطلوب",
      });
    }

    // if (!isWhatsAppReady()) {
    //   return res.status(503).json({
    //     success: false,
    //     message: "WhatsApp غير جاهز بعد أو غير متصل",
    //   });
    // }

    const cleanNumber = cleanPhoneNumber(numberphone);

    if (!cleanNumber || cleanNumber.length < 8) {
      return res.status(400).json({
        success: false,
        message: "رقم الهاتف غير صحيح",
      });
    }

    /*
     * getNumberId يتأكد أن الرقم موجود على WhatsApp.
     */
    const numberId = await client.getNumberId(cleanNumber);

    if (!numberId) {
      return res.status(404).json({
        success: false,
        message: "هذا الرقم غير مسجّل على WhatsApp",
        numberphone: cleanNumber,
      });
    }

    const chatId = numberId._serialized;

    const sentMessage = await client.sendMessage(
      chatId,
      String(message).trim()
    );

    return res.status(200).json({
      success: true,
      message: "تم إرسال الرسالة بنجاح",
      data: {
        numberphone: cleanNumber,
        chatId,
        messageId: sentMessage.id?._serialized || null,
        text: sentMessage.body,
        timestamp: sentMessage.timestamp,
      },
    });
  } catch (error) {
    console.error("❌ Send WhatsApp message error:", error);

    return res.status(500).json({
      success: false,
      message: "فشل إرسال رسالة WhatsApp",
      error: error.message,
    });
  }
};