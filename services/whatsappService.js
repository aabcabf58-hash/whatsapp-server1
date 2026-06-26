const path = require("path");
const { Client, LocalAuth } = require("whatsapp-web.js");

/*
 * جميع جلسات WhatsApp.
 *
 * المفتاح:
 * رقم حساب WhatsApp المربوط.
 *
 * القيمة:
 * client + status + pairingCode...
 */
const whatsappSessions = new Map();

/*
 * تنظيف وتحويل الرقم اللبناني.
 *
 * 70123456       => 96170123456
 * 03712345       => 9613712345
 * +96170123456   => 96170123456
 * 0096170123456  => 96170123456
 */
function cleanPhoneNumber(value) {
  let number = String(value || "").replace(/\D/g, "");

  if (number.startsWith("00")) {
    number = number.substring(2);
  }

  if (number.startsWith("0")) {
    number = `961${number.substring(1)}`;
  }

  /*
   * رقم لبناني من 8 أرقام بدون 0 وبدون 961.
   */
  if (number.length === 8) {
    number = `961${number}`;
  }

  return number;
}

function validatePhoneNumber(numberphone) {
  return /^\d{8,15}$/.test(numberphone);
}

function createHttpError(message, statusCode = 500) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function isHeadlessMode() {
  return (
    String(process.env.HEADLESS || "true").toLowerCase() !==
    "false"
  );
}

function formatPairingCode(code) {
  if (!code) {
    return null;
  }

  const cleanCode = String(code).replace(/-/g, "");

  if (cleanCode.length !== 8) {
    return cleanCode;
  }

  return `${cleanCode.slice(0, 4)}-${cleanCode.slice(4)}`;
}

function getPublicSessionData(session) {
  return {
    numberphone: session.numberphone,
    exists: true,
    status: session.status,
    pairingCode: session.pairingCode,
    pairingCodeFormatted: formatPairingCode(
      session.pairingCode
    ),
    connectedNumber:
      session.client?.info?.wid?.user ||
      session.connectedNumber ||
      null,
    loadingPercent: session.loadingPercent || 0,
    error: session.error || null,
  };
}

async function destroySessionSafely(session) {
  if (!session?.client) {
    return;
  }

  try {
    await session.client.destroy();
  } catch (error) {
    console.error(
      "WhatsApp destroy warning:",
      error.message
    );
  }
}

/*
 * بدء ربط حساب WhatsApp برقم الهاتف.
 */
async function startWhatsAppPairing(numberphone) {
  const cleanNumber = cleanPhoneNumber(numberphone);

  if (!cleanNumber) {
    throw createHttpError("رقم الهاتف مطلوب", 400);
  }

  if (!validatePhoneNumber(cleanNumber)) {
    throw createHttpError(
      "رقم الهاتف غير صالح. أرسل الرقم بصيغة دولية",
      400
    );
  }

  const existingSession =
    whatsappSessions.get(cleanNumber);

  if (existingSession) {
    /*
     * إذا كانت الجلسة READY نتأكد أنها متصلة فعلاً.
     */
    if (existingSession.status === "READY") {
      let state = null;

      try {
        state =
          await existingSession.client.getState();
      } catch (error) {
        console.error(
          "Get existing client state error:",
          error.message
        );
      }

      if (state === "CONNECTED") {
        return getPublicSessionData(existingSession);
      }

      existingSession.status =
        state || "DISCONNECTED";
      existingSession.error =
        "جلسة WhatsApp غير متصلة";
    }

    /*
     * يوجد كود ربط جاهز.
     */
    if (
      existingSession.pairingCode &&
      [
        "PAIRING_CODE_READY",
        "AUTHENTICATED",
        "LOADING",
      ].includes(existingSession.status)
    ) {
      return getPublicSessionData(existingSession);
    }

    /*
     * Chrome ما زال يبدأ.
     */
    if (existingSession.startPromise) {
      return existingSession.startPromise;
    }

    /*
     * الجلسة القديمة فاشلة أو مقطوعة.
     * نغلقها قبل إنشاء جلسة جديدة.
     */
    await destroySessionSafely(existingSession);
    whatsappSessions.delete(cleanNumber);
  }

  console.log(
    `🚀 Starting WhatsApp client for: ${cleanNumber}`
  );

  const puppeteerOptions = {
    /*
     * Railway / Render:
     * HEADLESS=true
     *
     * الكمبيوتر المحلي وإظهار Chrome:
     * HEADLESS=false
     */
    headless: isHeadlessMode(),

    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--disable-gpu",
      "--no-first-run",
      "--no-zygote",
    ],
  };

  if (process.env.CHROME_PATH) {
    puppeteerOptions.executablePath =
      process.env.CHROME_PATH;
  }

  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: `phone-${cleanNumber}`,

      dataPath: path.resolve(
        process.env.WHATSAPP_AUTH_PATH ||
          "./.wwebjs_auth"
      ),

      rmMaxRetries: 5,
    }),

    pairWithPhoneNumber: {
      phoneNumber: cleanNumber,
      showNotification: true,
      intervalMs: 180000,
    },

    puppeteer: puppeteerOptions,

    authTimeoutMs: 120000,

    takeoverOnConflict: true,
    takeoverTimeoutMs: 10000,

    deviceName: "WhatsApp API Server",
    browserName: "Chrome",
  });

  const session = {
    numberphone: cleanNumber,
    client,
    status: "STARTING",
    pairingCode: null,
    connectedNumber: null,
    loadingPercent: 0,
    error: null,
    startPromise: null,
  };

  whatsappSessions.set(cleanNumber, session);

  session.startPromise = new Promise(
    (resolve, reject) => {
      let responseFinished = false;

      const timeout = setTimeout(async () => {
        if (responseFinished) {
          return;
        }

        responseFinished = true;
        session.startPromise = null;
        session.status = "TIMEOUT";
        session.error =
          "لم يظهر كود الربط خلال الوقت المحدد";

        await destroySessionSafely(session);

        reject(
          createHttpError(
            session.error,
            504
          )
        );
      }, 120000);

      function resolveOnce(data) {
        if (responseFinished) {
          return;
        }

        responseFinished = true;
        session.startPromise = null;

        clearTimeout(timeout);
        resolve(data);
      }

      function rejectOnce(error) {
        if (responseFinished) {
          return;
        }

        responseFinished = true;
        session.startPromise = null;

        clearTimeout(timeout);
        reject(error);
      }

      client.on(
        "loading_screen",
        (percent, message) => {
          session.status = "LOADING";
          session.loadingPercent =
            Number(percent) || 0;

          console.log(
            `⏳ WhatsApp loading ${cleanNumber}:`,
            percent,
            message
          );
        }
      );

      /*
       * كود الربط المكوّن من 8 أحرف.
       */
      client.on("code", (code) => {
        console.log(
          `🔑 Pairing code for ${cleanNumber}:`,
          code
        );

        session.status =
          "PAIRING_CODE_READY";
        session.pairingCode = code;
        session.error = null;

        resolveOnce(
          getPublicSessionData(session)
        );
      });

      client.on("authenticated", () => {
        console.log(
          `🔐 WhatsApp authenticated: ${cleanNumber}`
        );

        session.status = "AUTHENTICATED";
        session.error = null;
      });

      client.on("ready", () => {
        const connectedNumber =
          client.info?.wid?.user ||
          cleanNumber;

        console.log(
          `✅ WhatsApp ready: ${connectedNumber}`
        );

        session.status = "READY";
        session.pairingCode = null;
        session.connectedNumber =
          connectedNumber;
        session.loadingPercent = 100;
        session.error = null;

        resolveOnce(
          getPublicSessionData(session)
        );
      });

      client.on("auth_failure", (message) => {
        console.error(
          `❌ Authentication failure ${cleanNumber}:`,
          message
        );

        session.status = "AUTH_FAILURE";
        session.error =
          String(
            message ||
              "فشل تسجيل الدخول"
          );

        rejectOnce(
          createHttpError(
            session.error,
            401
          )
        );
      });

      client.on(
        "change_state",
        (state) => {
          console.log(
            `ℹ️ WhatsApp state ${cleanNumber}:`,
            state
          );
        }
      );

      client.on("disconnected", (reason) => {
        console.error(
          `⚠️ WhatsApp disconnected ${cleanNumber}:`,
          reason
        );

        session.status = "DISCONNECTED";
        session.error = String(
          reason ||
            "WhatsApp disconnected"
        );
        session.pairingCode = null;
        session.startPromise = null;
      });

      /*
       * هنا فقط يتم تشغيل WhatsApp Client.
       */
      client.initialize().catch((error) => {
        console.error(
          `❌ WhatsApp initialize error ${cleanNumber}:`,
          error
        );

        session.status = "ERROR";
        session.error =
          error.message ||
          String(error);

        rejectOnce(
          createHttpError(
            session.error,
            500
          )
        );
      });
    }
  );

  return session.startPromise;
}

/*
 * قراءة حالة جلسة WhatsApp.
 */
async function getWhatsAppSessionStatus(
  numberphone
) {
  const cleanNumber =
    cleanPhoneNumber(numberphone);

  if (!cleanNumber) {
    throw createHttpError(
      "رقم الهاتف مطلوب",
      400
    );
  }

  const session =
    whatsappSessions.get(cleanNumber);

  if (!session) {
    return {
      numberphone: cleanNumber,
      exists: false,
      status: "NOT_STARTED",
      pairingCode: null,
      pairingCodeFormatted: null,
      connectedNumber: null,
      loadingPercent: 0,
      error: null,
    };
  }

  /*
   * إذا كانت READY نتأكد من الاتصال الحقيقي.
   */
  if (session.status === "READY") {
    try {
      const state =
        await session.client.getState();

      if (state !== "CONNECTED") {
        session.status =
          state || "DISCONNECTED";

        session.error =
          "WhatsApp غير متصل حالياً";
      }
    } catch (error) {
      session.status = "DISCONNECTED";
      session.error = error.message;
    }
  }

  return getPublicSessionData(session);
}

/*
 * اختيار Client جاهز للإرسال.
 *
 * senderNumberphone اختياري:
 * إذا عندنا جلسة READY واحدة، يتم اختيارها تلقائياً.
 */
async function getReadySession(
  senderNumberphone
) {
  let session = null;

  if (senderNumberphone) {
    const cleanSender =
      cleanPhoneNumber(senderNumberphone);

    session =
      whatsappSessions.get(cleanSender);

    if (!session) {
      throw createHttpError(
        "لا توجد جلسة WhatsApp لرقم المرسل",
        404
      );
    }
  } else {
    const readySessions = [
      ...whatsappSessions.values(),
    ].filter(
      (item) => item.status === "READY"
    );

    if (readySessions.length === 0) {
      throw createHttpError(
        "لا توجد جلسة WhatsApp جاهزة",
        503
      );
    }

    if (readySessions.length > 1) {
      throw createHttpError(
        "يوجد أكثر من حساب جاهز. أرسل senderNumberphone لتحديد حساب المرسل",
        400
      );
    }

    session = readySessions[0];
  }

  if (session.status !== "READY") {
    throw createHttpError(
      `WhatsApp غير جاهز. الحالة الحالية: ${session.status}`,
      503
    );
  }

  let state;

  try {
    state = await session.client.getState();
  } catch (error) {
    session.status = "DISCONNECTED";
    session.error = error.message;

    throw createHttpError(
      "تعذر التأكد من اتصال WhatsApp",
      503
    );
  }

  if (state !== "CONNECTED") {
    session.status =
      state || "DISCONNECTED";

    throw createHttpError(
      `WhatsApp غير متصل. الحالة: ${state}`,
      503
    );
  }

  return session;
}

/*
 * إرسال رسالة من نفس Client الذي تم ربطه.
 */
async function sendWhatsAppMessage({
  senderNumberphone,
  recipientNumberphone,
  message,
}) {
  const cleanRecipient =
    cleanPhoneNumber(recipientNumberphone);

  if (!cleanRecipient) {
    throw createHttpError(
      "رقم المستلم مطلوب",
      400
    );
  }

  if (!validatePhoneNumber(cleanRecipient)) {
    throw createHttpError(
      "رقم المستلم غير صحيح",
      400
    );
  }

  if (!message || !String(message).trim()) {
    throw createHttpError(
      "نص الرسالة مطلوب",
      400
    );
  }

  const session =
    await getReadySession(
      senderNumberphone
    );

  let numberId;

  try {
    numberId =
      await session.client.getNumberId(
        cleanRecipient
      );
  } catch (error) {
    session.error = error.message;

    throw createHttpError(
      `فشل فحص رقم WhatsApp: ${error.message}`,
      500
    );
  }

  if (!numberId) {
    throw createHttpError(
      "هذا الرقم غير مسجّل على WhatsApp",
      404
    );
  }

  const chatId = numberId._serialized;

  try {
    const sentMessage =
      await session.client.sendMessage(
        chatId,
        String(message).trim()
      );

    return {
      senderNumberphone:
        session.client?.info?.wid?.user ||
        session.numberphone,

      recipientNumberphone:
        cleanRecipient,

      chatId,

      messageId:
        sentMessage.id?._serialized ||
        null,

      text:
        sentMessage.body ||
        String(message).trim(),

      timestamp:
        sentMessage.timestamp ||
        null,
    };
  } catch (error) {
    console.error(
      "❌ Client sendMessage error:",
      error
    );

    try {
      const currentState =
        await session.client.getState();

      if (currentState !== "CONNECTED") {
        session.status =
          currentState ||
          "DISCONNECTED";
      }
    } catch (_) {
      session.status = "DISCONNECTED";
    }

    throw createHttpError(
      `فشل إرسال رسالة WhatsApp: ${error.message}`,
      500
    );
  }
}

/*
 * تسجيل خروج وحذف الجلسة.
 */
async function logoutWhatsAppSession(
  numberphone
) {
  const cleanNumber =
    cleanPhoneNumber(numberphone);

  if (!cleanNumber) {
    throw createHttpError(
      "رقم الهاتف مطلوب",
      400
    );
  }

  const session =
    whatsappSessions.get(cleanNumber);

  if (!session) {
    throw createHttpError(
      "لا توجد جلسة لهذا الرقم",
      404
    );
  }

  session.status = "LOGGING_OUT";

  try {
    await session.client.logout();
  } catch (error) {
    console.error(
      "WhatsApp logout warning:",
      error.message
    );
  }

  await destroySessionSafely(session);

  whatsappSessions.delete(cleanNumber);

  return {
    numberphone: cleanNumber,
    status: "LOGGED_OUT",
  };
}

module.exports = {
  cleanPhoneNumber,
  startWhatsAppPairing,
  getWhatsAppSessionStatus,
  sendWhatsAppMessage,
  logoutWhatsAppSession,
};