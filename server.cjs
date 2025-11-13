// ==============================
// CHAT POINT – server.cjs (Render + Local + APK + Play Store)
// ==============================

require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const path = require("path");
const bodyParser = require("body-parser");

const app = express();
const PORT = process.env.PORT || 5000;

// ---------- MIDDLEWARE ----------
app.use(cors());
app.use(bodyParser.json({ limit: "10mb" }));
app.use(bodyParser.urlencoded({ extended: true }));

// FIX 415 ERROR: Accept binary uploads (APK, images, etc.)
app.use(bodyParser.raw({ type: "application/octet-stream", limit: "50mb" }));

// Log every request
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

// ---------- MONGODB ----------
const mongoURI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/chatpoint";
mongoose
  .connect(mongoURI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => {
    console.error("MongoDB error:", err);
    process.exit(1);
  });

// ---------- MODELS ----------
const User = mongoose.model("User", new mongoose.Schema({
  name: String,
  phone: { type: String, required: true, unique: true },
  password: String,
}));

const Shop = mongoose.model("Shop", new mongoose.Schema({
  type: { type: String, default: "shop" },
  ownerName: String,
  mobile: String,
  shopName: String,
  items: [{ name: String, price: Number, description: String, imageUrl: [String] }],
  date: { type: Date, default: Date.now },
}));

const Order = mongoose.model("Order", new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  user: { name: String, phone: String },
  shop: String,
  items: [{ name: String, price: Number, quantity: Number }],
  totalAmount: Number,
  deliveryCharge: Number,
  address: { name: String, phone: String, line1: String, line2: String },
  paymentMethod: { type: String, default: "cash" },
  status: { type: String, default: "pending" },
  date: { type: Date, default: Date.now },
}, { timestamps: true }));

// ==============================
// API ROUTES
// ==============================

app.post("/api/user/signup", async (req, res) => {
  try {
    const { name, phone, password } = req.body;
    if (!name || !phone || !password) return res.status(400).json({ success: false, message: "All fields required" });
    const exists = await User.findOne({ phone });
    if (exists) return res.status(400).json({ success: false, message: "Phone already registered" });
    const user = new User({ name, phone, password });
    await user.save();
    res.json({ success: true, message: "Signup successful" });
  } catch (e) {
    console.error("SIGNUP ERROR:", e.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

app.post("/api/user/login", async (req, res) => {
  try {
    const { phone, password } = req.body;
    const user = await User.findOne({ phone });
    if (!user || user.password !== password) return res.status(401).json({ success: false, message: "Invalid credentials" });
    res.json({ success: true, user: { _id: user._id, name: user.name, phone: user.phone } });
  } catch (e) {
    console.error("LOGIN ERROR:", e.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

app.post("/api/save-order", async (req, res) => {
  try {
    const { userId, name, phone, address1, address2, cart, itemsTotal, deliveryCharge = 30, grandTotal, paymentMode = "cash" } = req.body;
    if (!userId || !name || !phone || !address1 || !cart) return res.status(400).json({ success: false, message: "Missing data" });

    const items = [];
    let total = 0;
    for (const shop in cart) {
      for (const item in cart[shop]) {
        const { qty, price } = cart[shop][item];
        if (qty > 0) {
          items.push({ name: item, price, quantity: qty });
          total += qty * price;
        }
      }
    }
    if (items.length === 0) return res.status(400).json({ success: false, message: "Cart empty" });

    const order = new Order({
      userId,
      user: { name, phone },
      shop: Object.keys(cart)[0],
      items,
      totalAmount: grandTotal,
      deliveryCharge,
      address: { name, phone, line1: address1, line2: address2 },
      paymentMethod: paymentMode,
    });

    await order.save();
    res.json({ success: true, orderId: order._id, message: "Order saved!" });
  } catch (e) {
    console.error("SAVE ORDER ERROR:", e.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

app.get("/api/shops", async (req, res) => {
  try {
    const shops = await Shop.find({ type: "shop" }).sort({ date: -1 }).lean();
    res.json({ success: true, shops });
  } catch (e) {
    console.error("SHOPS ERROR:", e.message);
    res.status(500).json({ success: false, message: "Error" });
  }
});

// ==============================
// DELIVERY PORTAL APIs
// ==============================

app.get("/api/delivery-orders", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const orders = await Order.find({ status: "pending" })
      .sort({ date: -1 })
      .limit(limit)
      .lean();
    res.json({ success: true, orders });
  } catch (e) {
    console.error("DELIVERY ORDERS ERROR:", e.message);
    res.status(500).json({ success: false, message: "Error loading orders" });
  }
});

app.post("/api/update-order-status", async (req, res) => {
  try {
    const { orderId, status } = req.body;
    if (!orderId || !["delivered", "cancelled"].includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid data" });
    }

    const order = await Order.findByIdAndUpdate(
      orderId,
      { status },
      { new: true }
    ).lean();

    if (!order) return res.status(404).json({ success: false, message: "Order not found" });

    res.json({ success: true, order });
  } catch (e) {
    console.error("UPDATE STATUS ERROR:", e.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ==============================
// USER – MY ORDERS API
// ==============================

app.get("/api/my-orders", async (req, res) => {
  try {
    const userId = req.headers["x-user-id"];
    if (!userId) {
      return res.status(400).json({ success: false, message: "Missing x-user-id header" });
    }

    const orders = await Order.find({ userId })
      .sort({ date: -1 })
      .lean();

    res.json({ success: true, orders });
  } catch (e) {
    console.error("MY-ORDERS ERROR:", e.message);
    res.status(500).json({ success: false, message: "Error loading orders" });
  }
});

// ==============================
// FORCE CORRECT MIME TYPES (ICONS, IMAGES, AUDIO)
// ==============================

app.use((req, res, next) => {
  const ext = path.extname(req.path).toLowerCase();
  if (ext === ".png") res.setHeader("Content-Type", "image/png");
  else if (ext === ".jpg" || ext === ".jpeg") res.setHeader("Content-Type", "image/jpeg");
  else if (ext === ".webp") res.setHeader("Content-Type", "image/webp");
  else if (ext === ".mp3") res.setHeader("Content-Type", "audio/mpeg");
  next();
});

// ==============================
// SERVE STATIC FILES
// ==============================

app.use(express.static(path.join(__dirname)));

// Explicit HTML routes
["privacy", "delivery", "orders", "items", "cart", "payment", "login"].forEach(page => {
  app.get(`/${page}.html`, (req, res) => {
    res.sendFile(path.join(__dirname, `${page}.html`));
  });
});

// Catch-all: Serve index.html
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// ==============================
// START SERVER
// ==============================
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server LIVE on port ${PORT}`);
  console.log(`App: http://localhost:${PORT}`);
  console.log(`Privacy: http://localhost:${PORT}/privacy.html`);
  console.log(`Icons: http://localhost:${PORT}/icon-192.png`);
});
