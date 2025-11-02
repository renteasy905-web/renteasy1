const express = require("express");
const mongoose = require("mongoose");
const multer = require("multer");
const dotenv = require("dotenv");
const cors = require("cors");
const { v2: cloudinary } = require("cloudinary");
const fs = require("fs");
const path = require("path");
const User = require("./models/user.cjs"); // ✅ User model

dotenv.config();
const app = express();
const PORT = process.env.PORT || 5000;

// ✅ Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ Serve static frontend directly from root folder
app.use(express.static(__dirname));

// ✅ Cloudinary Config
const cloudinaryUrl = new URL(process.env.CLOUDINARY_URL);
const [api_key, api_secret] = [cloudinaryUrl.username, cloudinaryUrl.password];
const cloud_name = cloudinaryUrl.hostname;
cloudinary.config({ cloud_name, api_key, api_secret });

// ✅ MongoDB Connection
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ Connected to MongoDB Atlas"))
  .catch((err) => console.error("❌ MongoDB Connection Error:", err));

/* ========================================================
   👤 OWNER MODEL
======================================================== */
const ownerSchema = new mongoose.Schema({
  phone: { type: String, required: true, unique: true },
  password: { type: String, required: true },
});
const Owner = mongoose.model("Owner", ownerSchema);

/* ========================================================
   🏠 PROPERTY MODEL (Supports multiple images)
======================================================== */
const propertySchema = new mongoose.Schema({
  type: { type: String, required: true },
  ownerName: String,
  mobile: String,
  location: String,
  floor: String,
  kitchen: String,
  bedroom: String,
  hall: String,
  garden: String,
  waterSupply: String,
  price: Number,
  rent: Number,
  description: String,
  imageUrl: [String],
  mapLink: String,
  date: { type: Date, default: Date.now },
});
const Property = mongoose.model("Property", propertySchema);

const upload = multer({ dest: "uploads/" });

/* ========================================================
   👤 OWNER AUTH
======================================================== */
app.post("/api/owner/signup", async (req, res) => {
  try {
    const { phone, password } = req.body;
    if (!phone || !password)
      return res.status(400).json({ success: false, message: "Phone and password required" });

    const existing = await Owner.findOne({ phone });
    if (existing)
      return res.status(400).json({ success: false, message: "Owner already exists" });

    const newOwner = new Owner({ phone, password });
    await newOwner.save();
    res.json({ success: true, message: "✅ Owner registered successfully" });
  } catch (err) {
    console.error("Signup Error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

app.post("/api/owner/login", async (req, res) => {
  try {
    const { phone, password } = req.body;
    const owner = await Owner.findOne({ phone });
    if (!owner) return res.status(404).json({ success: false, message: "❌ Owner not found" });
    if (owner.password !== password)
      return res.status(401).json({ success: false, message: "❌ Incorrect password" });

    res.json({ success: true, message: "✅ Login successful", owner });
  } catch (err) {
    console.error("Login Error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/* ========================================================
   👥 USER AUTH
======================================================== */
app.post("/api/user/signup", async (req, res) => {
  try {
    const { name, phone, password } = req.body;
    if (!name || !phone || !password)
      return res.status(400).json({ success: false, message: "All fields required" });

    const existing = await User.findOne({ phone });
    if (existing)
      return res.status(400).json({ success: false, message: "User already exists" });

    const newUser = new User({ name, phone, password });
    await newUser.save();
    res.json({ success: true, message: "✅ User registered successfully" });
  } catch (err) {
    console.error("User Signup Error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

app.post("/api/user/login", async (req, res) => {
  try {
    const { phone, password } = req.body;
    const user = await User.findOne({ phone });
    if (!user) return res.status(404).json({ success: false, message: "❌ User not found" });
    if (user.password !== password)
      return res.status(401).json({ success: false, message: "❌ Incorrect password" });

    res.json({ success: true, message: "✅ Login successful", user });
  } catch (err) {
    console.error("User Login Error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/* ========================================================
   🏡 PROPERTY UPLOAD / FETCH / DELETE
======================================================== */
app.post("/api/upload", upload.array("photos", 5), async (req, res) => {
  try {
    const {
      type,
      ownerName,
      mobile,
      location,
      price,
      rent,
      description,
      floor,
      kitchen,
      bedroom,
      hall,
      garden,
      waterSupply,
    } = req.body;

    if (!type)
      return res.status(400).json({ success: false, message: "Property type missing" });
    if (!req.files || req.files.length === 0)
      return res.status(400).json({ success: false, message: "No images uploaded" });

    const imageUrls = [];
    for (const file of req.files) {
      const uploadResult = await cloudinary.uploader.upload(file.path, { folder: "renteasy" });
      fs.unlinkSync(file.path);
      imageUrls.push(uploadResult.secure_url);
    }

    let mapLink = "";
    const match = location.match(/Lat:\s*([\d.-]+),\s*Lng:\s*([\d.-]+)/);
    if (match) {
      const [_, lat, lng] = match;
      mapLink = `https://www.google.com/maps?q=${lat},${lng}`;
    }

    const newProperty = new Property({
      type,
      ownerName,
      mobile,
      location,
      price,
      rent,
      description,
      floor,
      kitchen,
      bedroom,
      hall,
      garden,
      waterSupply,
      imageUrl: imageUrls,
      mapLink,
    });

    await newProperty.save();
    res.json({ success: true, message: "✅ Property uploaded successfully!", property: newProperty });
  } catch (err) {
    console.error("Upload Error:", err);
    res.status(500).json({ success: false, message: "Failed to upload property" });
  }
});

app.get("/api/houses", async (req, res) => {
  try {
    const houses = await Property.find({ type: "house" }).sort({ date: -1 });
    res.json({ success: true, houses });
  } catch (err) {
    console.error("Fetch Error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch houses" });
  }
});

app.delete("/api/property/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await Property.findByIdAndDelete(id);
    if (!deleted)
      return res.status(404).json({ success: false, message: "Property not found" });

    res.json({ success: true, message: "🗑️ Property deleted successfully" });
  } catch (err) {
    console.error("Delete Error:", err);
    res.status(500).json({ success: false, message: "Failed to delete property" });
  }
});

/* ========================================================
   🌐 SERVE FRONTEND FILES (directly from root)
======================================================== */
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

/* ========================================================
   🚀 START SERVER
======================================================== */
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
