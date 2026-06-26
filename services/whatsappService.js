const path = require("path");
const puppeteer = require("puppeteer");
const {
  Client,
  LocalAuth,
} = require("whatsapp-web.js");

// تخزين الجلسات المفتوحة داخل ذاكرة السيرفر
const whatsappSessions = new Map();

/*
  تنظيف رقم الهاتف.

  مثال:
  +961 70 123 456

  يصبح:
  96170123456
*/
function cleanPhoneNumber(value) {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value).replace(/\D/g, "");
}

/*
  إنشاء Error مع statusCode
*/
function createHttpError(message, statusCode = 500) {
  const error = new Error(message);
  error.statusCode = statusCode;

  return error;
}

/*
  تحديد إذا Chrome يعمل headless أو ظاهر.

  HEADLESS=false:
  Chrome ظاهر على الكمبيوتر.

  HEADLESS=true:
  Chrome مخفي، مناسب للسيرفر online.
*/
function isHeadlessMode() {
  return String(process.env.HEADLESS || "true").toLowerCase() !== "false";
}

/*
  تنسيق الكود:

  ABCDEFGH

  يصبح:

  ABCD-EFGH
*/
function formatPairingCode(code) {
  if (!code || code.length !== 8) {
    return code || null;
  }

  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/*
  بدء ربط حساب WhatsApp
*/
async function startWhatsAppPairing(numberphone) {
  const cleanNumber = cleanPhoneNumber(numberphone);

  if (!cleanNumber) {
    throw createHttpError("رقم الهاتف مطلوب", 400);
  }

  /*
    الحد التقريبي للأرقام الدولية:
    من 8 إلى 15 رقم
  */
  if (!/^\d{8,15}$/.test(cleanNumber)) {
    throw createHttpError(
      "رقم الهاتف غير صالح. أرسله بصيغة دولية من دون + أو فراغات",
      400
    );
  }

  /*
    التأكد إذا كان الرقم موجود مسبقاً
  */
  const existingSession = whatsappSessions.get(cleanNumber);

  if (existingSession) {
    // الرقم متصل
    if (existingSession.status === "READY") {
      return {
        numberphone: cleanNumber,
        status: existingSession.status,
        pairingCode: null,
        pairingCodeFormatted: null,
        connectedNumber:
          existingSession.client?.info?.wid?.user || cleanNumber,
      };
    }

    // يوجد كود ربط جاهز
    if (existingSession.pairingCode) {
      return {
        numberphone: cleanNumber,
        status: existingSession.status,
        pairingCode: existingSession.pairingCode,
        pairingCodeFormatted: formatPairingCode(
          existingSession.pairingCode
        ),
        connectedNumber: null,
      };
    }

    // Chrome ما زال يعمل وينتظر الكود
    if (existingSession.startPromise) {
      return existingSession.startPromise;
    }
  }

  console.log(`🚀 Starting WhatsApp client for: ${cleanNumber}`);

  const puppeteerOptions = {
    headless: true,

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

  /*
    استخدم CHROME_PATH فقط إذا كنت محدد مسار Chrome يدوياً.
  */
//   if (process.env.CHROME_PATH) {
//     puppeteerOptions.executablePath =
//       process.env.CHROME_PATH;
//   }

  const client = new Client({
    /*
      حفظ جلسة منفصلة لكل رقم.

      مثال:
      .wwebjs_auth/session-phone-96170123456
    */
    authStrategy: new LocalAuth({
      clientId: `phone-${cleanNumber}`,

      dataPath: path.resolve(
        process.env.WHATSAPP_AUTH_PATH ||
          "./.wwebjs_auth"
      ),

      rmMaxRetries: 5,
    }),

    /*
      هون الرقم فعلياً بينرسل إلى WhatsApp Web.
    */
    pairWithPhoneNumber: {
      phoneNumber: cleanNumber,

      // إرسال إشعار على الهاتف إذا كان مدعوماً
      showNotification: true,

      // إنشاء كود جديد كل 3 دقائق
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

      /*
        إذا لم يظهر الكود خلال دقيقتين،
        نرجع خطأ للـ API.
      */
      const timeout = setTimeout(() => {
        if (responseFinished) {
          return;
        }

        responseFinished = true;

        session.status = "TIMEOUT";
        session.error =
          "لم يظهر كود الربط خلال الوقت المحدد";

        reject(
          createHttpError(
            "لم يظهر كود الربط خلال الوقت المحدد",
            504
          )
        );
      }, 120000);

      function resolveOnce(data) {
        if (responseFinished) {
          return;
        }

        responseFinished = true;
        clearTimeout(timeout);
        resolve(data);
      }

      function rejectOnce(error) {
        if (responseFinished) {
          return;
        }

        responseFinished = true;
        clearTimeout(timeout);
        reject(error);
      }

      /*
        تقدم تحميل WhatsApp Web
      */
      client.on(
        "loading_screen",
        (percent, message) => {
          session.status = "LOADING";
          session.loadingPercent = Number(percent) || 0;

          console.log(
            `⏳ WhatsApp loading ${cleanNumber}:`,
            percent,
            message
          );
        }
      );

      /*
        الحدث الأهم.

        عندما يرجع WhatsApp الكود المكون
        من 8 أحرف، يصل إلى هنا.
      */
      client.on("code", (code) => {
        console.log(
          `🔑 Pairing code for ${cleanNumber}:`,
          code
        );

        session.status = "PAIRING_CODE_READY";
        session.pairingCode = code;
        session.error = null;

        resolveOnce({
          numberphone: cleanNumber,
          status: session.status,
          pairingCode: code,
          pairingCodeFormatted:
            formatPairingCode(code),
          connectedNumber: null,
        });
      });

      /*
        تم قبول كود الربط من الهاتف
      */
      client.on("authenticated", () => {
        console.log(
          `🔐 WhatsApp authenticated: ${cleanNumber}`
        );

        session.status = "AUTHENTICATED";
        session.error = null;
      });

      /*
        واتساب أصبح جاهزاً
      */
      client.on("ready", () => {
        const connectedNumber =
          client.info?.wid?.user || cleanNumber;

        console.log(
          `✅ WhatsApp ready: ${connectedNumber}`
        );

        session.status = "READY";
        session.pairingCode = null;
        session.connectedNumber = connectedNumber;
        session.error = null;

        /*
          هيدي الحالة بتصير إذا كانت الجلسة
          محفوظة مسبقاً وما عاد بحاجة إلى كود.
        */
        resolveOnce({
          numberphone: cleanNumber,
          status: "READY",
          pairingCode: null,
          pairingCodeFormatted: null,
          connectedNumber,
        });
      });

      /*
        فشل المصادقة
      */
      client.on("auth_failure", (message) => {
        console.error(
          `❌ Authentication failure ${cleanNumber}:`,
          message
        );

        session.status = "AUTH_FAILURE";
        session.error =
          message || "فشل تسجيل الدخول";

        rejectOnce(
          createHttpError(
            session.error,
            401
          )
        );
      });

      /*
        انقطاع الاتصال
      */
      client.on("disconnected", (reason) => {
        console.error(
          `⚠️ WhatsApp disconnected ${cleanNumber}:`,
          reason
        );

        session.status = "DISCONNECTED";
        session.error =
          String(reason || "WhatsApp disconnected");
        session.pairingCode = null;
      });

      /*
        بدء Chrome وWhatsApp Web
      */
      client.initialize().catch((error) => {
        console.error(
          `❌ WhatsApp initialize error ${cleanNumber}:`,
          error
        );

        session.status = "ERROR";
        session.error =
          error.message || String(error);

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
  قراءة حالة جلسة واتساب
*/
function getWhatsAppSessionStatus(numberphone) {
  const cleanNumber = cleanPhoneNumber(numberphone);

  if (!cleanNumber) {
    throw createHttpError("رقم الهاتف مطلوب", 400);
  }

  const session = whatsappSessions.get(cleanNumber);

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

  return {
    numberphone: cleanNumber,
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
    loadingPercent: session.loadingPercent,
    error: session.error,
  };
}

/*
  تسجيل خروج واتساب وحذف الجلسة
*/
async function logoutWhatsAppSession(numberphone) {
  const cleanNumber = cleanPhoneNumber(numberphone);

  if (!cleanNumber) {
    throw createHttpError("رقم الهاتف مطلوب", 400);
  }

  const session = whatsappSessions.get(cleanNumber);

  if (!session) {
    throw createHttpError(
      "لا توجد جلسة لهذا الرقم",
      404
    );
  }

  session.status = "LOGGING_OUT";

  /*
    logout:
    يسجل خروج الحساب ويحذف LocalAuth.

    destroy:
    يغلق Chrome.
  */
  try {
    await session.client.logout();
  } catch (error) {
    console.error(
      "WhatsApp logout warning:",
      error.message
    );
  }

  try {
    await session.client.destroy();
  } catch (error) {
    console.error(
      "WhatsApp destroy warning:",
      error.message
    );
  }

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
  logoutWhatsAppSession,
};

async function openBrowser() {
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-zygote",
    ],
  });

  const page = await browser.newPage();

  await page.goto("https://web.whatsapp.com", {
    waitUntil: "networkidle2",
    timeout: 120000,
  });

  return {
    browser,
    page,
  };
}

module.exports = {
  openBrowser,
};