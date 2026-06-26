const {
  startWhatsAppPairing,
  getWhatsAppSessionStatus,
  logoutWhatsAppSession,
  sendWhatsAppMessage: sendWhatsAppMessageService,
} = require("../services/whatsappService");

/*
 * POST /api/whatsapp/pair
 */
exports.pairWhatsApp = async (req, res) => {
  try {
    const { numberphone } = req.body;

    if (!numberphone) {
      return res.status(400).json({
        success: false,
        message: "رقم الهاتف مطلوب",
      });
    }

    const result =
      await startWhatsAppPairing(
        numberphone
      );

    return res.status(200).json({
      success: true,

      message:
        result.status === "READY"
          ? "واتساب متصل مسبقاً"
          : "تم إنشاء كود الربط",

      data: result,
    });
  } catch (error) {
    console.error(
      "Pair WhatsApp controller error:",
      error
    );

    return res
      .status(error.statusCode || 500)
      .json({
        success: false,
        message:
          error.message ||
          "فشل إنشاء كود الربط",
      });
  }
};

/*
 * GET /api/whatsapp/status/:numberphone
 */
exports.getWhatsAppStatus = async (
  req,
  res
) => {
  try {
    const { numberphone } = req.params;

    const result =
      await getWhatsAppSessionStatus(
        numberphone
      );

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error(
      "WhatsApp status controller error:",
      error
    );

    return res
      .status(error.statusCode || 500)
      .json({
        success: false,
        message:
          error.message ||
          "فشل قراءة حالة واتساب",
      });
  }
};

/*
 * POST /api/whatsapp/send
 *
 * body:
 * {
 *   "senderNumberphone": "96170111111",
 *   "recipientNumberphone": "96170222222",
 *   "message": "Hello"
 * }
 *
 * senderNumberphone اختياري إذا عندك حساب READY واحد.
 *
 * للتوافق مع الكود القديم:
 * يمكن استعمال numberphone بدلاً من recipientNumberphone.
 */
exports.sendWhatsAppMessage = async (
  req,
  res
) => {
  try {
    const {
      senderNumberphone,
      recipientNumberphone,
      numberphone,
      message,
    } = req.body;

    const recipient =
      recipientNumberphone ||
      numberphone;

    if (!recipient) {
      return res.status(400).json({
        success: false,
        message: "رقم المستلم مطلوب",
      });
    }

    if (
      !message ||
      !String(message).trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "نص الرسالة مطلوب",
      });
    }

    const result =
      await sendWhatsAppMessageService({
        senderNumberphone,
        recipientNumberphone: recipient,
        message,
      });

    return res.status(200).json({
      success: true,
      message:
        "تم إرسال الرسالة بنجاح",
      data: result,
    });
  } catch (error) {
    console.error(
      "❌ Send WhatsApp message error:",
      error
    );

    return res
      .status(error.statusCode || 500)
      .json({
        success: false,
        message:
          error.message ||
          "فشل إرسال رسالة WhatsApp",
      });
  }
};

/*
 * POST /api/whatsapp/logout/:numberphone
 */
exports.logoutWhatsApp = async (
  req,
  res
) => {
  try {
    const { numberphone } = req.params;

    const result =
      await logoutWhatsAppSession(
        numberphone
      );

    return res.status(200).json({
      success: true,
      message:
        "تم تسجيل خروج واتساب",
      data: result,
    });
  } catch (error) {
    console.error(
      "WhatsApp logout controller error:",
      error
    );

    return res
      .status(error.statusCode || 500)
      .json({
        success: false,
        message:
          error.message ||
          "فشل تسجيل خروج واتساب",
      });
  }
};