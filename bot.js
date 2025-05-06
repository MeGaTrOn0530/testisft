import { Telegraf } from 'telegraf';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Create data directory if it doesn't exist
const dataDir = join(__dirname, 'data');
try {
  await fs.mkdir(dataDir, { recursive: true });
} catch (err) {
  console.error('Error creating data directory:', err);
}

// Database files
const USERS_FILE = join(dataDir, 'users.json');
const VERIFICATION_FILE = join(dataDir, 'verification.json');
const NOTIFICATIONS_FILE = join(dataDir, 'notifications.json');

// Initialize bot
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// Helper functions for database operations
async function readData(file) {
  try {
    const data = await fs.readFile(file, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    if (err.code === 'ENOENT') {
      // File doesn't exist, create it with empty array
      await fs.writeFile(file, JSON.stringify([]));
      return [];
    }
    console.error(`Error reading ${file}:`, err);
    return [];
  }
}

async function writeData(file, data) {
  try {
    await fs.writeFile(file, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error(`Error writing to ${file}:`, err);
  }
}

// Bot commands
bot.start(async (ctx) => {
  try {
    const chatId = ctx.chat.id;
    const username = ctx.from.username;
    
    if (!username) {
      return ctx.reply('Iltimos, Telegram profilingizda username o\'rnating va qayta urinib ko\'ring.');
    }
    
    // Save user to database
    const users = await readData(USERS_FILE);
    
    const existingUser = users.find(user => 
      user.chatId === chatId || 
      (username && user.username === username)
    );
    
    if (!existingUser) {
      users.push({
        chatId,
        username,
        firstName: ctx.from.first_name,
        lastName: ctx.from.last_name,
        registeredAt: new Date().toISOString()
      });
      
      await writeData(USERS_FILE, users);
    } else if (existingUser.chatId !== chatId) {
      // Update chat ID if it has changed
      existingUser.chatId = chatId;
      await writeData(USERS_FILE, users);
    }
    
    ctx.reply(`Salom, ${ctx.from.first_name}! Test platformasi botiga xush kelibsiz. Bu bot orqali ro'yxatdan o'tish va test natijalarini olishingiz mumkin.

Mavjud buyruqlar:
/start - Botni ishga tushirish
/help - Yordam olish
/code - Tasdiqlash kodini olish
/results - Test natijalarini ko'rish`);
  } catch (err) {
    console.error('Error in start command:', err);
    ctx.reply('Xatolik yuz berdi. Iltimos, keyinroq qayta urinib ko\'ring.');
  }
});

bot.help((ctx) => {
  ctx.reply(`Test platformasi boti qo'llanmasi:

/start - Botni ishga tushirish
/help - Ushbu qo'llanmani ko'rish
/code - Tasdiqlash kodini olish
/results - Test natijalarini ko'rish`);
});

// Generate verification code
bot.command('code', async (ctx) => {
  try {
    const chatId = ctx.chat.id;
    const username = ctx.from.username;
    
    if (!username) {
      return ctx.reply('Iltimos, Telegram profilingizda username o\'rnating va qayta urinib ko\'ring.');
    }
    
    // Check if there's a verification code for this user
    const verifications = await readData(VERIFICATION_FILE);
    const verification = verifications.find(v => v.username === '@' + username);
    
    if (!verification) {
      return ctx.reply('Sizning tasdiqlash kodingiz topilmadi. Iltimos, avval test platformasida ro\'yxatdan o\'tishni boshlang.');
    }
    
    // Update the verification with chat ID
    verification.chatId = chatId;
    await writeData(VERIFICATION_FILE, verifications);
    
    ctx.reply(`Sizning tasdiqlash kodingiz: ${verification.code}\n\nBu kodni test platformasida ro'yxatdan o'tish jarayonida kiriting.`);
  } catch (err) {
    console.error('Error generating verification code:', err);
    ctx.reply('Xatolik yuz berdi. Iltimos, keyinroq qayta urinib ko\'ring.');
  }
});

// Show test results
bot.command('results', async (ctx) => {
  try {
    const username = ctx.from.username;
    
    if (!username) {
      return ctx.reply('Iltimos, Telegram profilingizda username o\'rnating va qayta urinib ko\'ring.');
    }
    
    // Find user in the database
    const users = await readData(join(dataDir, 'users.json'));
    const user = users.find(u => u.telegram === '@' + username);
    
    if (!user) {
      return ctx.reply('Siz hali test platformasida ro\'yxatdan o\'tmagansiz.');
    }
    
    // Get user's results
    const results = await readData(join(dataDir, 'results.json'));
    const tests = await readData(join(dataDir, 'tests.json'));
    
    const userResults = results.filter(r => r.userId === user.id);
    
    if (userResults.length === 0) {
      return ctx.reply('Siz hali birorta ham test topshirmagansiz.');
    }
    
    let message = 'Sizning test natijalaringiz:\n\n';
    
    userResults.forEach((result, index) => {
      const test = tests.find(t => t.id === result.testId) || { name: 'Noma\'lum test' };
      
      message += `${index + 1}. ${test.name}\n`;
      message += `   Ball: ${result.score}/${result.totalQuestions} (${result.scorePercentage.toFixed(2)}%)\n`;
      message += `   Vaqt: ${formatTime(result.timeSpent)}\n`;
      message += `   Sana: ${new Date(result.submittedAt).toLocaleString('uz-UZ')}\n\n`;
    });
    
    ctx.reply(message);
  } catch (err) {
    console.error('Error showing results:', err);
    ctx.reply('Xatolik yuz berdi. Iltimos, keyinroq qayta urinib ko\'ring.');
  }
});

// Handle text messages
bot.on('text', async (ctx) => {
  try {
    const text = ctx.message.text;
    
    // Check if the message is a verification code
    if (/^\d{6}$/.test(text)) {
      ctx.reply('Bu tasdiqlash kodi emas. Tasdiqlash kodini olish uchun /code buyrug\'ini yuboring.');
    } else {
      ctx.reply('Tushunarsiz buyruq. Yordam olish uchun /help buyrug\'ini yuboring.');
    }
  } catch (err) {
    console.error('Error handling text message:', err);
    ctx.reply('Xatolik yuz berdi. Iltimos, keyinroq qayta urinib ko\'ring.');
  }
});

// Helper function to format time in MM:SS
function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds < 10 ? '0' : ''}${remainingSeconds}`;
}

// Function to send pending notifications
async function sendPendingNotifications() {
  try {
    const notifications = await readData(NOTIFICATIONS_FILE).catch(() => []);
    
    if (notifications.length === 0) {
      return;
    }
    
    const pendingNotifications = notifications.filter(n => !n.sent);
    
    for (const notification of pendingNotifications) {
      try {
        const username = notification.telegram.startsWith('@') 
          ? notification.telegram.substring(1) 
          : notification.telegram;
        
        await bot.telegram.sendMessage(username, notification.message);
        
        // Mark as sent
        notification.sent = true;
        notification.sentAt = new Date().toISOString();
      } catch (err) {
        console.error(`Error sending notification to ${notification.telegram}:`, err);
      }
    }
    
    await writeData(NOTIFICATIONS_FILE, notifications);
  } catch (err) {
    console.error('Error sending pending notifications:', err);
  }
}

// Check for pending notifications every minute
setInterval(sendPendingNotifications, 60 * 1000);

// Start the bot
bot.launch()
  .then(() => {
    console.log('Bot started successfully');
    // Send pending notifications on startup
    sendPendingNotifications();
  })
  .catch((err) => {
    console.error('Error starting bot:', err);
  });

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));