// Testing Platform API Server
const express = require("express")
const app = express()
const cors = require("cors")
const path = require("path")
const fs = require("fs")
const jwt = require("jsonwebtoken")
const bcrypt = require("bcryptjs")
const { v4: uuidv4 } = require("uuid")
const multer = require("multer")
const { parseTestFile, selectRandomQuestions } = require("./lib/testParser")
const { initializeBot } = require("./bot")

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
  // For production (Render), use webhooks, otherwise use polling
  const mode = process.env.NODE_ENV === "production" ? "webhook" : "polling"
  bot = initializeBot(process.env.TELEGRAM_BOT_TOKEN, mode)
} else {
  console.warn("TELEGRAM_BOT_TOKEN not set. Bot functionality disabled.")
}

// Multer konfiguratsiyasini tekshirish
// const multer = require("multer") // Removed redeclaration of multer

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Store uploaded files in the uploads directory
    cb(null, path.join(__dirname, "uploads"))
  },
  filename: (req, file, cb) => {
    // Generate unique filename
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9)
    cb(null, file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname))
  },
})

// Create upload middleware
const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    // Accept text files and images
    if (file.fieldname === "testFile") {
      if (file.mimetype === "text/plain") {
        cb(null, true)
      } else {
        cb(new Error("Only text files are allowed for test import"))
      }
    } else if (file.fieldname === "image") {
      if (file.mimetype.startsWith("image/")) {
        cb(null, true)
      } else {
        cb(new Error("Only image files are allowed for question images"))
      }
    } else {
      cb(null, false)
    }
  },
})

// Middleware
// CORS sozlamalarini o'zgartirish - frontend uchun
app.use(
  cors({
    origin: "*", // Barcha manzillardan so'rovlarni qabul qilish
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
)
app.use(express.json())

// Serve uploaded files
app.use("/uploads", express.static(path.join(__dirname, "uploads")))

// Serve static files from the public directory
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

// Update the send-code endpoint to fix verification code sending
app.post("/api/auth/send-code", (req, res) => {
  console.log("Send code endpoint called with body:", req.body)
  const { telegram, name, phone } = req.body

  if (!telegram) {
    return res.status(400).json({ error: "Telegram username kiritilishi shart" })
  }

  if (!name) {
    return res.status(400).json({ error: "To'liq ism kiritilishi shart" })
  }

  if (!phone) {
    return res.status(400).json({ error: "Telefon raqam kiritilishi shart" })
  }

  // Generate a random 6-digit code
  const code = Math.floor(100000 + Math.random() * 900000).toString()
  const userId = uuidv4()

  // Store verification code with expiration
  const verifications = readDataFile("verifications.json")

  // Remove @ symbol if present in the telegram username
  let cleanTelegram = telegram
  if (cleanTelegram.startsWith("@")) {
    cleanTelegram = cleanTelegram.substring(1)
  }

  // Expire any existing codes for this telegram username
  verifications.forEach((v) => {
    if (v.telegram.toLowerCase() === cleanTelegram.toLowerCase() && v.status === "pending") {
      v.status = "expired"
    }
  })

  // Add new verification code
  verifications.push({
    id: uuidv4(),
    userId,
    telegram: cleanTelegram,
    name,
    phone,
    code,
    status: "pending",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30 minutes expiration
  })

  writeDataFile("verifications.json", verifications)

  // Make this endpoint just store the verification code but not attempt to send it
  // The bot will send the code when the user interacts with it
  console.log(`Generated verification code ${code} for Telegram user ${cleanTelegram}. 
               User should receive it when interacting with the bot.`)

  res.json({
    message: "Tasdiqlash kodini olish uchun Telegram botga o'ting va /start buyrug'ini bosing",
    userId,
  })
})

// New endpoint for first step verification
app.post("/api/auth/verify-code-step1", (req, res) => {
  const { telegram, code, userId } = req.body

  if (!telegram || !code || !userId) {
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

  // Update verification status to step1-verified
  verification.status = "step1-verified"
  writeDataFile("verifications.json", verifications)

  res.json({ message: "Kod tasdiqlandi. Endi tizimga kirish ma'lumotlarini yarating." })
})

// New endpoint for completing registration
app.post("/api/auth/complete-registration", (req, res) => {
  const { userId, username, password, name, phone, telegram } = req.body

  if (!userId || !username || !password || !name || !phone || !telegram) {
    return res.status(400).json({ error: "Barcha ma'lumotlar kiritilishi shart" })
  }

  // Check if username already exists
  const users = readDataFile("users.json")
  if (users.some((u) => u.username === username)) {
    return res.status(400).json({ error: "Bu foydalanuvchi nomi allaqachon mavjud" })
  }

  // Find the verification record
  const verifications = readDataFile("verifications.json")
  const verification = verifications.find(
    (v) => v.userId === userId && v.status === "step1-verified" && new Date(v.expiresAt) > new Date(),
  )

  if (!verification) {
    return res.status(400).json({ error: "Yaroqsiz yoki muddati o'tgan ro'yxatdan o'tish jarayoni" })
  }

  // Create new user
  const hashedPassword = bcrypt.hashSync(password, 10)
  const newUser = {
    id: userId,
    username,
    password: hashedPassword,
    name,
    phone,
    role: "student",
    telegram,
    createdAt: new Date().toISOString(),
  }

  users.push(newUser)
  writeDataFile("users.json", users)

  // Update verification status
  verification.status = "completed"
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
    phone: user.phone || null,
    createdAt: user.createdAt,
  }))

  res.json(users)
})

// Endpoint to get all questions for random test creation
app.get("/api/questions", authenticateToken, adminOnly, (req, res) => {
  const tests = readDataFile("tests.json")

  // Collect all questions from all tests
  const allQuestions = []
  tests.forEach((test) => {
    test.questions.forEach((question) => {
      allQuestions.push({
        id: question.id,
        text: question.text,
        type: question.type,
        options: question.options,
        image: question.image,
        correctAnswer: question.correctAnswer,
      })
    })
  })

  res.json(allQuestions)
})

// Test routes
// Add this route to your server.js file, near the other test routes
app.post("/api/tests/import", authenticateToken, adminOnly, upload.single("testFile"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Test file is required" })
    }

    // Read the uploaded file
    const fileContent = fs.readFileSync(req.file.path, "utf8")

    // Parse the file content
    const questions = parseTestFile(fileContent)

    if (questions.length === 0) {
      return res.status(400).json({ error: "No valid questions found in the file" })
    }

    // Return the parsed questions
    res.json({
      message: `Successfully parsed ${questions.length} questions`,
      questions: questions,
    })
  } catch (error) {
    console.error("Error importing test:", error)
    res.status(500).json({ error: "Failed to import test file" })
  }
})

// Add this route to handle question image uploads
app.post("/api/upload/image", authenticateToken, adminOnly, upload.single("image"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Image file is required" })
    }

    // Return the path to the uploaded image
    const imagePath = `/uploads/${req.file.filename}`
    res.json({
      message: "Image uploaded successfully",
      imagePath: imagePath,
    })
  } catch (error) {
    console.error("Error uploading image:", error)
    res.status(500).json({ error: "Failed to upload image" })
  }
})

// Add this route to create a test with random questions
app.post("/api/tests/random", authenticateToken, adminOnly, (req, res) => {
  try {
    const { title, description, duration, questionCount, allQuestions } = req.body

    if (!title || !duration || !questionCount || !allQuestions || !Array.isArray(allQuestions)) {
      return res.status(400).json({ error: "All required fields must be provided" })
    }

    // Select random questions
    const selectedQuestions = selectRandomQuestions(allQuestions, questionCount)

    // Create the test
    const newTest = {
      id: uuidv4(),
      title,
      description: description || "",
      duration,
      createdBy: req.user.id,
      createdAt: new Date().toISOString(),
      published: false,
      backgroundImage: req.body.backgroundImage || null,
      questions: selectedQuestions.map((q) => ({
        id: uuidv4(),
        ...q,
      })),
    }

    const tests = readDataFile("tests.json")
    tests.push(newTest)
    writeDataFile("tests.json", tests)

    res.status(201).json(newTest)
  } catch (error) {
    console.error("Error creating random test:", error)
    res.status(500).json({ error: "Failed to create test" })
  }
})

// Modify the existing test creation route to support background images
app.post("/api/tests", authenticateToken, adminOnly, (req, res) => {
  const { title, description, duration, questions, backgroundImage } = req.body

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
    backgroundImage: backgroundImage || null,
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
        image: q.image,
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
// Modify the results route to handle multiple correct answers
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
      } else if (question.type === "multiple-answer") {
        // For multiple-answer questions, all correct options must be selected
        // and no incorrect options should be selected
        if (answer.selectedOptions && Array.isArray(answer.selectedOptions)) {
          const correctOptions = question.options.filter((o) => o.correct).map((o) => o.id)
          const incorrectOptions = question.options.filter((o) => !o.correct).map((o) => o.id)

          // Check if all correct options are selected
          const allCorrectSelected = correctOptions.every((id) => answer.selectedOptions.includes(id))

          // Check if no incorrect options are selected
          const noIncorrectSelected = !answer.selectedOptions.some((id) => incorrectOptions.includes(id))

          correct = allCorrectSelected && noIncorrectSelected
        }
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

// Handle Telegram webhook if in production mode
if (process.env.NODE_ENV === "production" && bot) {
  app.post(`/bot${process.env.TELEGRAM_BOT_TOKEN}`, (req, res) => {
    bot.processUpdate(req.body)
    res.sendStatus(200)
  })
}

// Serve index.html for all other routes
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"))
})

// Start the server
const port = process.env.PORT || 10000
app.listen(port, () => {
  console.log(`Server listening on port ${port}`)
})
