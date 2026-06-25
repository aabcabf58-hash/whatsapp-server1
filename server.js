require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const whatsappRouter = require("./routes/whatsappRouter.js");

const app = express();

const PORT = process.env.PORT || 3000;

// Middleware
app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);

app.use(cors());

app.use(express.json());

app.use(
  express.urlencoded({
    extended: true,
  })
);

// الصفحة الرئيسية
app.get("/", (req, res) => {
  return res.status(200).json({
    success: true,
    message: "WhatsApp Web Server is running 🚀",
  });
});

// WhatsApp routes
app.use("/api/whatsapp", whatsappRouter);

// Route غير موجود
app.use((req, res) => {
  return res.status(404).json({
    success: false,
    message: "Route غير موجود",
    path: req.originalUrl,
  });
});

// Error middleware
app.use((error, req, res, next) => {
  console.error("Global server error:", error);

  return res.status(error.statusCode || 500).json({
    success: false,
    message: error.message || "حدث خطأ داخل السيرفر",
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔗 http://localhost:${PORT}`);
});