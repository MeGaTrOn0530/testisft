// Testing Platform API Server
const express = require("express")
const app = express()
const cors = require("cors")
const path = require("path")
const fs = require("fs")
const jwt = require("jsonwebtoken")
const bcrypt = require("bcryptjs")
const { v4: uuidv4 } = require("uuid")
const TelegramBot = require("node-telegram-bot-api")

// Load environment variables
require("dotenv").config()

// Create data directories if they don't exist
const dataDir = path.join(__dirname, "data")
const uploadsDir = path.join(__dirname, "uploads")

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir)
}

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir)
}

// Initialize data files if they don't exist
const dataFiles = ["users.json", "tests.json", "results.json", "verifications.json", "notifications.json"]

dataFiles.forEach((file) => {
  const filePath = path.join(dataDir, file)
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify([]))
  }
})

// Create admin user if it doesn't exist
const usersPath = path.join(dataDir, "users.json")
let users = []
try {
  const usersData = fs.readFileSync(usersPath, "utf8")
  users = JSON.parse(usersData)
} catch (err) {
  console.error("Error reading users file:", err)
  users = []
}

if (!users.some((user) => user.role === "admin")) {
  const adminPassword = bcrypt.hashSync("admin123", 10)
  users.push({
    id: uuidv4(),
    username: "admin",
    password: adminPassword,
    name: "Administrator",
    role: "admin",
    createdAt: new Date().toISOString(),
  })
  fs.writeFileSync(usersPath, JSON.stringify(users, null, 2))
  console.log("Admin user created")
}

// Initialize Telegram bot
let bot
if (process.env.TELEGRAM_BOT_TOKEN) {
  bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true })
  console.log("Telegram bot initialized")

  // Bot command handlers
  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id
    bot.sendMessage(
      chatId,
      "Salom! Testing platformasiga xush kelibsiz. Ro'yxatdan o'tish uchun telegram username ingizni kiriting.",
    )
  })

  // Handle verification codes
  bot.on("message", (msg) => {
    const chatId = msg.chat.id
    const verificationPath = path.join(dataDir, "verifications.json")
    const notificationsPath = path.join(dataDir, "notifications.json")

    try {
      const verifications = JSON.parse(fs.readFileSync(verificationPath, "utf8"))
      const pendingVerification = verifications.find(
        (v) => v.telegram === msg.from.username && v.status === "pending" && new Date(v.expiresAt) > new Date(),
      )

      if (pendingVerification) {
        bot.sendMessage(chatId, `Sizning tasdiqlash kodingiz: ${pendingVerification.code}`)

        // Log the notification
        const notifications = JSON.parse(fs.readFileSync(notificationsPath, "utf8"))
        notifications.push({
          id: uuidv4(),
          userId: pendingVerification.userId,
          telegram: msg.from.username,
          message: `Verification code sent: ${pendingVerification.code}`,
          createdAt: new Date().toISOString(),
        })
        fs.writeFileSync(notificationsPath, JSON.stringify(notifications, null, 2))
      }
    } catch (err) {
      console.error("Error handling telegram message:", err)
    }
  })
} else {
  console.warn("TELEGRAM_BOT_TOKEN not set. Bot functionality disabled.")
}

// Middleware
// CORS sozlamalarini o'zgartirish
app.use(
  cors({
    origin: "*", // Barcha manzillardan so'rovlarni qabul qilish
    credentials: true,
  }),
)
app.use(express.json())
app.use(express.static(path.join(__dirname, "public")))

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"]
  const token = authHeader && authHeader.split(" ")[1]

  if (!token) return res.status(401).json({ error: "Token taqdim etilmadi" })

  jwt.verify(token, process.env.JWT_SECRET || "your-secret-key", (err, user) => {
    if (err) return res.status(403).json({ error: "Token yaroqsiz" })
    req.user = user
    next()
  })
}

// Admin middleware
const adminOnly = (req, res, next) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Bu amal faqat adminlar uchun" })
  }
  next()
}

// Helper function to read/write data files
const readDataFile = (fileName) => {
  const filePath = path.join(dataDir, fileName)
  try {
    const data = fs.readFileSync(filePath, "utf8")
    return JSON.parse(data)
  } catch (err) {
    console.error(`Error reading ${fileName}:`, err)
    return []
  }
}

const writeDataFile = (fileName, data) => {
  const filePath = path.join(dataDir, fileName)
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
    return true
  } catch (err) {
    console.error(`Error writing ${fileName}:`, err)
    return false
  }
}

// API Routes

// Test endpoint to check if server is running
app.get("/api/test", (req, res) => {
  res.json({ message: "Server is running!" })
})

// Config endpoint
app.get("/api/config", (req, res) => {
  console.log("Config endpoint called")
  res.json({
    apiBaseUrl: process.env.API_BASE_URL || "",
    telegramBotUsername: process.env.TELEGRAM_BOT_USERNAME || "your_bot_username",
  })
})

// Auth routes
app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body

  if (!username || !password) {
    return res.status(400).json({ error: "Foydalanuvchi nomi va parol kiritilishi shart" })
  }

  const users = readDataFile("users.json")
  const user = users.find((u) => u.username === username)

  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: "Noto'g'ri foydalanuvchi nomi yoki parol" })
  }

  // Create token
  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    process.env.JWT_SECRET || "your-secret-key",
    { expiresIn: "24h" },
  )

  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
    },
  })
})

app.post("/api/auth/send-code", (req, res) => {
  console.log("Send code endpoint called with body:", req.body)
  const { telegram } = req.body

  if (!telegram) {
    return res.status(400).json({ error: "Telegram username kiritilishi shart" })
  }

  // Generate a random 6-digit code
  const code = Math.floor(100000 + Math.random() * 900000).toString()
  const userId = uuidv4()

  // Store verification code with expiration
  const verifications = readDataFile("verifications.json")

  // Expire any existing codes for this telegram username
  verifications.forEach((v) => {
    if (v.telegram === telegram && v.status === "pending") {
      v.status = "expired"
    }
  })

  // Add new verification code
  verifications.push({
    id: uuidv4(),
    userId,
    telegram,
    code,
    status: "pending",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30 minutes expiration
  })

  writeDataFile("verifications.json", verifications)

  // Send verification code via Telegram bot
  if (bot) {
    // The bot will send the code when the user interacts with it
    console.log(`Verification code ${code} ready for Telegram user ${telegram}`)
  } else {
    console.log(`Bot not available, but code ${code} generated for ${telegram}`)
  }

  res.json({ message: "Tasdiqlash kodi Telegram botga yuborildi", userId })
})

app.post("/api/auth/verify-code", (req, res) => {
  const { telegram, code, name, password, userId } = req.body

  if (!telegram || !code || !name || !password || !userId) {
    return res.status(400).json({ error: "Barcha ma'lumotlar kiritilishi shart" })
  }

  // Verify code
  const verifications = readDataFile("verifications.json")
  const verification = verifications.find(
    (v) =>
      v.telegram === telegram &&
      v.code === code &&
      v.status === "pending" &&
      v.userId === userId &&
      new Date(v.expiresAt) > new Date(),
  )

  if (!verification) {
    return res.status(400).json({ error: "Noto'g'ri yoki muddati o'tgan tasdiqlash kodi" })
  }

  // Check if username already exists
  const users = readDataFile("users.json")
  if (users.some((u) => u.username === telegram)) {
    return res.status(400).json({ error: "Bu foydalanuvchi nomi allaqachon mavjud" })
  }

  // Create new user
  const hashedPassword = bcrypt.hashSync(password, 10)
  const newUser = {
    id: userId,
    username: telegram,
    password: hashedPassword,
    name,
    role: "student",
    telegram,
    createdAt: new Date().toISOString(),
  }

  users.push(newUser)
  writeDataFile("users.json", users)

  // Update verification status
  verification.status = "verified"
  writeDataFile("verifications.json", verifications)

  // Create token
  const token = jwt.sign(
    { id: newUser.id, username: newUser.username, role: newUser.role },
    process.env.JWT_SECRET || "your-secret-key",
    { expiresIn: "24h" },
  )

  res.json({
    message: "Ro'yxatdan muvaffaqiyatli o'tdingiz",
    token,
    user: {
      id: newUser.id,
      username: newUser.username,
      name: newUser.name,
      role: newUser.role,
    },
  })
})

// User routes
app.get("/api/users", authenticateToken, adminOnly, (req, res) => {
  const users = readDataFile("users.json").map((user) => ({
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    telegram: user.telegram,
    createdAt: user.createdAt,
  }))

  res.json(users)
})

// Test routes
app.post("/api/tests", authenticateToken, adminOnly, (req, res) => {
  const { title, description, duration, questions } = req.body

  if (!title || !duration || !questions || !Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({ error: "Barcha ma'lumotlar to'g'ri formatda kiritilishi shart" })
  }

  const newTest = {
    id: uuidv4(),
    title,
    description: description || "",
    duration, // minutes
    createdBy: req.user.id,
    createdAt: new Date().toISOString(),
    published: false,
    questions: questions.map((q) => ({
      id: uuidv4(),
      ...q,
    })),
  }

  const tests = readDataFile("tests.json")
  tests.push(newTest)
  writeDataFile("tests.json", tests)

  res.status(201).json(newTest)
})

app.get("/api/tests", authenticateToken, (req, res) => {
  const tests = readDataFile("tests.json")

  // Filter tests based on user role
  let filteredTests
  if (req.user.role === "admin") {
    filteredTests = tests.map((test) => ({
      id: test.id,
      title: test.title,
      description: test.description,
      duration: test.duration,
      createdAt: test.createdAt,
      published: test.published,
      questionCount: test.questions.length,
    }))
  } else {
    // For students, only show published tests and don't include questions
    filteredTests = tests
      .filter((test) => test.published)
      .map((test) => ({
        id: test.id,
        title: test.title,
        description: test.description,
        duration: test.duration,
        questionCount: test.questions.length,
      }))
  }

  res.json(filteredTests)
})

app.get("/api/tests/:id", authenticateToken, (req, res) => {
  const { id } = req.params
  const tests = readDataFile("tests.json")
  const test = tests.find((t) => t.id === id)

  if (!test) {
    return res.status(404).json({ error: "Test topilmadi" })
  }

  // Check if the test is published or the user is an admin
  if (!test.published && req.user.role !== "admin") {
    return res.status(403).json({ error: "Bu test hali e'lon qilinmagan" })
  }

  // For students, don't include correct answers
  if (req.user.role !== "admin") {
    const testForStudent = {
      ...test,
      questions: test.questions.map((q) => ({
        id: q.id,
        text: q.text,
        type: q.type,
        options: q.options ? q.options.map((o) => ({ id: o.id, text: o.text })) : undefined,
      })),
    }
    return res.json(testForStudent)
  }

  res.json(test)
})

app.put("/api/tests/:id", authenticateToken, adminOnly, (req, res) => {
  const { id } = req.params
  const updates = req.body

  const tests = readDataFile("tests.json")
  const testIndex = tests.findIndex((t) => t.id === id)

  if (testIndex === -1) {
    return res.status(404).json({ error: "Test topilmadi" })
  }

  tests[testIndex] = {
    ...tests[testIndex],
    ...updates,
    updatedAt: new Date().toISOString(),
  }

  writeDataFile("tests.json", tests)
  res.json(tests[testIndex])
})

app.delete("/api/tests/:id", authenticateToken, adminOnly, (req, res) => {
  const { id } = req.params

  const tests = readDataFile("tests.json")
  const filteredTests = tests.filter((t) => t.id !== id)

  if (filteredTests.length === tests.length) {
    return res.status(404).json({ error: "Test topilmadi" })
  }

  writeDataFile("tests.json", filteredTests)

  // Also delete related results
  const results = readDataFile("results.json")
  const filteredResults = results.filter((r) => r.testId !== id)
  writeDataFile("results.json", filteredResults)

  res.json({ message: "Test muvaffaqiyatli o'chirildi" })
})

app.put("/api/tests/:id/publish", authenticateToken, adminOnly, (req, res) => {
  const { id } = req.params
  const { published } = req.body

  const tests = readDataFile("tests.json")
  const testIndex = tests.findIndex((t) => t.id === id)

  if (testIndex === -1) {
    return res.status(404).json({ error: "Test topilmadi" })
  }

  tests[testIndex].published = published
  tests[testIndex].updatedAt = new Date().toISOString()

  writeDataFile("tests.json", tests)
  res.json({ message: published ? "Test e'lon qilindi" : "Test e'londan olindi" })
})

// Results routes
app.post("/api/results", authenticateToken, (req, res) => {
  const { testId, answers } = req.body
  const userId = req.user.id

  if (!testId || !answers || !Array.isArray(answers)) {
    return res.status(400).json({ error: "Barcha ma'lumotlar to'g'ri formatda kiritilishi shart" })
  }

  // Get the test
  const tests = readDataFile("tests.json")
  const test = tests.find((t) => t.id === testId)

  if (!test) {
    return res.status(404).json({ error: "Test topilmadi" })
  }

  // Calculate score
  let correctCount = 0
  const gradedAnswers = answers.map((answer) => {
    const question = test.questions.find((q) => q.id === answer.questionId)
    let correct = false

    if (question) {
      if (question.type === "multiple-choice") {
        const correctOption = question.options.find((o) => o.correct)
        correct = answer.optionId === correctOption.id
      } else if (question.type === "text") {
        // Simple text comparison - could be improved with more sophisticated matching
        correct = answer.text.trim().toLowerCase() === question.correctAnswer.trim().toLowerCase()
      }
    }

    if (correct) correctCount++

    return { ...answer, correct }
  })

  const score = (correctCount / test.questions.length) * 100

  // Save result
  const newResult = {
    id: uuidv4(),
    testId,
    userId,
    answers: gradedAnswers,
    score,
    correctCount,
    totalQuestions: test.questions.length,
    submittedAt: new Date().toISOString(),
  }

  const results = readDataFile("results.json")
  results.push(newResult)
  writeDataFile("results.json", results)

  res.status(201).json({
    id: newResult.id,
    score: newResult.score,
    correctCount: newResult.correctCount,
    totalQuestions: newResult.totalQuestions,
  })
})

app.get("/api/results", authenticateToken, (req, res) => {
  const results = readDataFile("results.json")
  const tests = readDataFile("tests.json")
  const users = readDataFile("users.json")

  // Filter and format results based on user role
  let filteredResults
  if (req.user.role === "admin") {
    filteredResults = results.map((result) => {
      const test = tests.find((t) => t.id === result.testId)
      const user = users.find((u) => u.id === result.userId)

      return {
        id: result.id,
        testId: result.testId,
        testTitle: test ? test.title : "Unknown Test",
        userId: result.userId,
        userName: user ? user.name : "Unknown User",
        score: result.score,
        correctCount: result.correctCount,
        totalQuestions: result.totalQuestions,
        submittedAt: result.submittedAt,
      }
    })
  } else {
    // For students, only show their own results
    filteredResults = results
      .filter((r) => r.userId === req.user.id)
      .map((result) => {
        const test = tests.find((t) => t.id === result.testId)

        return {
          id: result.id,
          testId: result.testId,
          testTitle: test ? test.title : "Unknown Test",
          score: result.score,
          correctCount: result.correctCount,
          totalQuestions: result.totalQuestions,
          submittedAt: result.submittedAt,
        }
      })
  }

  res.json(filteredResults)
})

app.get("/api/results/:id", authenticateToken, (req, res) => {
  const { id } = req.params
  const results = readDataFile("results.json")
  const result = results.find((r) => r.id === id)

  if (!result) {
    return res.status(404).json({ error: "Natija topilmadi" })
  }

  // Check if the user is authorized to view this result
  if (req.user.role !== "admin" && result.userId !== req.user.id) {
    return res.status(403).json({ error: "Siz bu natijani ko'rish huquqiga ega emassiz" })
  }

  // Get additional info
  const tests = readDataFile("tests.json")
  const users = readDataFile("users.json")
  const test = tests.find((t) => t.id === result.testId)
  const user = users.find((u) => u.id === result.userId)

  const formattedResult = {
    ...result,
    testTitle: test ? test.title : "Unknown Test",
    userName: user ? user.name : "Unknown User",
  }

  res.json(formattedResult)
})

// Fallback route for SPA
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"))
})

// Start the server
const port = process.env.PORT || 3000
app.listen(port, () => {
  console.log(`Server listening on port ${port}`)
})
