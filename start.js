#!/usr/bin/env node

// This script checks for required dependencies and starts the server
const fs = require("fs")
const path = require("path")
const { execSync } = require("child_process")

// Check if .env file exists
const envPath = path.join(__dirname, ".env")
if (!fs.existsSync(envPath)) {
  console.log("\x1b[33m%s\x1b[0m", "Warning: .env file not found. Creating a default one...")

  const defaultEnv = `# Server configuration
PORT=3000
API_BASE_URL=http://localhost:3000
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production

# Telegram bot configuration
TELEGRAM_BOT_TOKEN=your-telegram-bot-token
TELEGRAM_BOT_USERNAME=your_bot_username

# Environment
NODE_ENV=development`

  fs.writeFileSync(envPath, defaultEnv)
  console.log("\x1b[32m%s\x1b[0m", ".env file created. Please update with your actual configuration.")
}

// Check if node_modules exists
const nodeModulesPath = path.join(__dirname, "node_modules")
if (!fs.existsSync(nodeModulesPath)) {
  console.log("\x1b[33m%s\x1b[0m", "Installing dependencies...")

  try {
    execSync("npm install", { stdio: "inherit" })
    console.log("\x1b[32m%s\x1b[0m", "Dependencies installed successfully.")
  } catch (error) {
    console.error("\x1b[31m%s\x1b[0m", "Failed to install dependencies. Please run npm install manually.")
    process.exit(1)
  }
}

// Create data directory if it doesn't exist
const dataDir = path.join(__dirname, "data")
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir)
  console.log("\x1b[32m%s\x1b[0m", "Data directory created.")
}

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, "uploads")
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir)
  console.log("\x1b[32m%s\x1b[0m", "Uploads directory created.")
}

// Start the server
console.log("\x1b[36m%s\x1b[0m", "Starting the server...")
require("./server.js")
