// Telegram bot implementation using CommonJS syntax
const { Telegraf } = require("telegraf")
const fs = require("fs")
const path = require("path")
const dotenv = require("dotenv")
const { v4: uuidv4 } = require("uuid")

// Load environment variables
dotenv.config()

// Create data directory if it doesn't exist
const dataDir = path.join(__dirname, "data")
try {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }
} catch (err) {
  console.error("Error creating data directory:", err)
}

// Database files
const USERS_FILE = path.join(dataDir, "users.json")
const VERIFICATION_FILE = path.join(dataDir, "verifications.json")
const NOTIFICATIONS_FILE = path.join(dataDir, "notifications.json")

// Helper functions for database operations
function readData(file) {
  try {
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, JSON.stringify([]))
      return []
    }
    const data = fs.readFileSync(file, "utf8")
    return JSON.parse(data)
  } catch (err) {
    console.error(`Error reading ${file}:`, err)
    return []
  }
}

function writeData(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2))
    return true
  } catch (err) {
    console.error(`Error writing to ${file}:`, err)
    return false
  }
}

/**
 * Initialize and configure the Telegram bot
 * @param {string} token - Telegram bot token
 * @returns {Object} Configured Telegram bot instance
 */
function initializeBot(token, mode = "polling") {
  if (!token) {
    console.warn("TELEGRAM_BOT_TOKEN not set. Bot functionality disabled.")
    return null
  }

  let bot

  try {
    // Create bot instance
    bot = new Telegraf(token)

    // Set up command handlers
    setupCommandHandlers(bot)

    // Start the bot based on mode
    if (mode === "webhook" && process.env.NODE_ENV === "production") {
      // For production, use webhooks
      const domain = process.env.RENDER_EXTERNAL_URL || process.env.API_BASE_URL
      const webhookUrl = `${domain}/bot${token}`
      bot.telegram.setWebhook(webhookUrl)
      console.log(`Telegram bot initialized with webhook mode for production at ${webhookUrl}`)
    } else {
      // For development, use polling
      bot
        .launch({
          dropPendingUpdates: true, // Important to avoid conflicts
        })
        .then(() => {
          console.log("Telegram bot initialized with polling mode for development")
          // Send pending notifications on startup
          sendPendingNotifications(bot)
        })
        .catch((err) => {
          console.error("Error launching bot:", err)
        })
    }

    // Enable graceful stop
    process.once("SIGINT", () => bot.stop("SIGINT"))
    process.once("SIGTERM", () => bot.stop("SIGTERM"))

    return bot
  } catch (error) {
    console.error("Error initializing Telegram bot:", error)
    console.warn("Telegram bot functionality disabled due to error.")
    return null
  }
}

/**
 * Set up command handlers for the bot
 * @param {Telegraf} bot - The Telegram bot instance
 */
function setupCommandHandlers(bot) {
  // Handle /start command
  bot.start(async (ctx) => {
    try {
      const chatId = ctx.chat.id
      const username = ctx.from.username

      if (!username) {
        return ctx.reply("Iltimos, Telegram profilingizda username o'rnating va qayta urinib ko'ring.")
      }

      // Save user to database
      const users = readData(USERS_FILE)

      const existingUser = users.find((user) => user.chatId === chatId || (username && user.username === username))

      if (!existingUser) {
        users.push({
          chatId,
          username,
          firstName: ctx.from.first_name,
          lastName: ctx.from.last_name,
          registeredAt: new Date().toISOString(),
        })

        writeData(USERS_FILE, users)
      } else if (existingUser.chatId !== chatId) {
        // Update chat ID if it has changed
        existingUser.chatId = chatId
        writeData(USERS_FILE, users)
      }

      ctx.reply(`Salom, ${ctx.from.first_name}! Test platformasi botiga xush kelibsiz. Bu bot orqali ro'yxatdan o'tish va test natijalarini olishingiz mumkin.

Mavjud buyruqlar:
/start - Botni ishga tushirish
/help - Yordam olish
/code - Tasdiqlash kodini olish
/results - Test natijalarini ko'rish`)

      // Check for pending verification codes
      checkPendingVerification(ctx, username)
    } catch (err) {
      console.error("Error in start command:", err)
      ctx.reply("Xatolik yuz berdi. Iltimos, keyinroq qayta urinib ko'ring.")
    }
  })

  // Help command
  bot.help((ctx) => {
    ctx.reply(`Test platformasi boti qo'llanmasi:

/start - Botni ishga tushirish
/help - Ushbu qo'llanmani ko'rish
/code - Tasdiqlash kodini olish
/results - Test natijalarini ko'rish`)
  })

  // Generate verification code
  bot.command("code", async (ctx) => {
    try {
      const chatId = ctx.chat.id
      const username = ctx.from.username

      if (!username) {
        return ctx.reply("Iltimos, Telegram profilingizda username o'rnating va qayta urinib ko'ring.")
      }

      // Check if there's a verification code for this user
      checkPendingVerification(ctx, username)
    } catch (err) {
      console.error("Error generating verification code:", err)
      ctx.reply("Xatolik yuz berdi. Iltimos, keyinroq qayta urinib ko'ring.")
    }
  })

  // Show test results
  bot.command("results", async (ctx) => {
    try {
      const username = ctx.from.username

      if (!username) {
        return ctx.reply("Iltimos, Telegram profilingizda username o'rnating va qayta urinib ko'ring.")
      }

      // Find user in the database
      const users = readData(USERS_FILE)
      const user = users.find((u) => u.username === username)

      if (!user) {
        return ctx.reply("Siz hali test platformasida ro'yxatdan o'tmagansiz.")
      }

      // Get user's results
      const results = readData(path.join(dataDir, "results.json"))
      const tests = readData(path.join(dataDir, "tests.json"))

      const userResults = results.filter((r) => r.userId === user.id)

      if (userResults.length === 0) {
        return ctx.reply("Siz hali birorta ham test topshirmagansiz.")
      }

      let message = "Sizning test natijalaringiz:\n\n"

      userResults.forEach((result, index) => {
        const test = tests.find((t) => t.id === result.testId) || { title: "Noma'lum test" }

        message += `${index + 1}. ${test.title}\n`
        message += `   Ball: ${result.correctCount}/${result.totalQuestions} (${result.score.toFixed(2)}%)\n`
        message += `   Sana: ${new Date(result.submittedAt).toLocaleString("uz-UZ")}\n\n`
      })

      ctx.reply(message)
    } catch (err) {
      console.error("Error showing results:", err)
      ctx.reply("Xatolik yuz berdi. Iltimos, keyinroq qayta urinib ko'ring.")
    }
  })

  // Handle text messages
  bot.on("text", async (ctx) => {
    try {
      const text = ctx.message.text
      const username = ctx.from.username

      // Check if the message is a verification code
      if (/^\d{6}$/.test(text)) {
        ctx.reply("Bu tasdiqlash kodi emas. Tasdiqlash kodini olish uchun /code buyrug'ini yuboring.")
      } else {
        // Check for pending verification
        checkPendingVerification(ctx, username)
      }
    } catch (err) {
      console.error("Error handling text message:", err)
    }
  })

  // Handle callback queries (button clicks)
  bot.on("callback_query", async (ctx) => {
    try {
      const data = ctx.callbackQuery.data
      const username = ctx.from.username

      if (data === "request_code") {
        checkPendingVerification(ctx, username)
      }

      // Answer the callback query to remove loading state
      ctx.answerCbQuery()
    } catch (err) {
      console.error("Error handling callback query:", err)
      ctx.answerCbQuery("Xatolik yuz berdi")
    }
  })
}

/**
 * Check for pending verification codes for a user
 * @param {Object} ctx - Telegram context
 * @param {string} username - Telegram username
 */
function checkPendingVerification(ctx, username) {
  if (!username) return

  try {
    const verifications = readData(VERIFICATION_FILE)
    const pendingVerification = verifications.find(
      (v) =>
        (v.telegram.toLowerCase() === username.toLowerCase() ||
          v.telegram.toLowerCase() === "@" + username.toLowerCase()) &&
        v.status === "pending" &&
        new Date(v.expiresAt) > new Date(),
    )

    if (pendingVerification) {
      ctx.reply(
        `Sizning tasdiqlash kodingiz: ${pendingVerification.code}\n\nBu kodni test platformasida ro'yxatdan o'tish jarayonida kiriting.`,
      )

      // Log the notification
      logNotification(pendingVerification.userId, username, pendingVerification.code, ctx.chat.id)
      console.log(`Verification code ${pendingVerification.code} sent to ${username} via Telegram`)
    } else {
      ctx.reply(
        "Sizning uchun faol tasdiqlash kodi topilmadi. Iltimos, avval web saytdan ro'yxatdan o'tishni boshlang.",
      )
    }
  } catch (err) {
    console.error("Error checking verification:", err)
  }
}

/**
 * Log a notification in the notifications.json file
 */
function logNotification(userId, telegram, code, chatId) {
  try {
    const notifications = readData(NOTIFICATIONS_FILE)
    notifications.push({
      id: uuidv4(),
      userId,
      telegram,
      message: `Verification code sent: ${code}`,
      chatId,
      createdAt: new Date().toISOString(),
      sent: true,
      sentAt: new Date().toISOString(),
    })
    writeData(NOTIFICATIONS_FILE, notifications)
  } catch (err) {
    console.error("Error logging notification:", err)
  }
}

/**
 * Send pending notifications
 * @param {Telegraf} bot - The Telegram bot instance
 */
function sendPendingNotifications(bot) {
  try {
    const notifications = readData(NOTIFICATIONS_FILE)

    if (notifications.length === 0) {
      return
    }

    const pendingNotifications = notifications.filter((n) => !n.sent)

    for (const notification of pendingNotifications) {
      try {
        const username = notification.telegram.startsWith("@")
          ? notification.telegram.substring(1)
          : notification.telegram

        if (notification.chatId) {
          bot.telegram.sendMessage(notification.chatId, notification.message)
        } else {
          bot.telegram.sendMessage(username, notification.message)
        }

        // Mark as sent
        notification.sent = true
        notification.sentAt = new Date().toISOString()
      } catch (err) {
        console.error(`Error sending notification to ${notification.telegram}:`, err)
      }
    }

    writeData(NOTIFICATIONS_FILE, notifications)
  } catch (err) {
    console.error("Error sending pending notifications:", err)
  }
}

// Helper function to format time in MM:SS
function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}:${remainingSeconds < 10 ? "0" : ""}${remainingSeconds}`
}

// Export the bot initialization function
module.exports = {
  initializeBot,
}
