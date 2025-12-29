// config.js
const { Low, JSONFile } = require('lowdb');
const path = require('path');

const DB_FILE = path.join(__dirname, 'db.json');
const adapter = new JSONFile(DB_FILE);
const db = new Low(adapter);

const SANDO_VERSION = "1.8.3 preview";

// Default user config
const defaultUserConfig = {
    currentModel: "gemini-1.5-flash",
    searchOnInternet: false,
    instructionNextGenerate: "",
    currentSessionId: null,
    attachedFiles: [],
    aiKnowledge: [],
    jailbreakPrompt: null,
};

// Global bot config
const botConfig = {
    apiKeys: [],
    currentApiKeyIndex: 0,
};

// Init DB
async function initDB() {
    await db.read();
    db.data = db.data || { users: {}, sessions: {}, apiKeys: [], currentApiKeyIndex: 0 };
    await db.write();
}
initDB();

// --- User Functions ---
async function getUserData(userId) {
    await db.read();
    if (!db.data.users[userId]) {
        db.data.users[userId] = { ...defaultUserConfig };
        await db.write();
    }
    return db.data.users[userId];
}

async function updateUserData(userId, data) {
    db.data.users[userId] = data;
    await db.write();
}

// --- Session Functions ---
async function getOrCreateSession(userId, sessionId = null) {
    await db.read();
    let session;
    if (sessionId && db.data.sessions[sessionId]) {
        session = db.data.sessions[sessionId];
    }
    if (!session) {
        sessionId = `session_${Date.now()}_${userId}`;
        session = { id: sessionId, title: "New Conversation", timestamp: Date.now(), messages: [], lastMessagePreview: "" };
        db.data.sessions[sessionId] = session;
        if (!db.data.users[userId]) db.data.users[userId] = { ...defaultUserConfig };
        db.data.users[userId].currentSessionId = sessionId;
        await db.write();
    }
    return session;
}

async function updateSession(session) {
    db.data.sessions[session.id] = session;
    await db.write();
}

async function getAllUserSessions(userId) {
    await db.read();
    return Object.values(db.data.sessions).filter(s => s.messages.some(m => m.userId === userId))
        .sort((a,b) => b.timestamp - a.timestamp);
}

async function deleteSession(sessionId) {
    delete db.data.sessions[sessionId];
    await db.write();
}

// --- API Key Functions ---
async function loadApiKeys() {
    await db.read();
    botConfig.apiKeys = db.data.apiKeys || [];
    botConfig.currentApiKeyIndex = db.data.currentApiKeyIndex || 0;
}

async function saveApiKeys() {
    db.data.apiKeys = botConfig.apiKeys;
    db.data.currentApiKeyIndex = botConfig.currentApiKeyIndex;
    await db.write();
}

function getCurrentApiKey() {
    if (botConfig.apiKeys.length === 0) throw new Error("No API keys available. Use /addkey.");
    return botConfig.apiKeys[botConfig.currentApiKeyIndex];
}

function rotateApiKey() {
    if (botConfig.apiKeys.length <= 1) return false;
    botConfig.currentApiKeyIndex = (botConfig.currentApiKeyIndex + 1) % botConfig.apiKeys.length;
    return true;
}

// --- AI Knowledge ---
async function loadAiKnowledge(userId) {
    const user = await getUserData(userId);
    return user.aiKnowledge || [];
}

async function saveAiKnowledge(userId, knowledge) {
    const user = await getUserData(userId);
    user.aiKnowledge = knowledge;
    await updateUserData(userId, user);
}

module.exports = {
    db,
    SANDO_VERSION,
    defaultUserConfig,
    botConfig,
    getUserData,
    updateUserData,
    getOrCreateSession,
    updateSession,
    getAllUserSessions,
    deleteSession,
    loadApiKeys,
    saveApiKeys,
    getCurrentApiKey,
    rotateApiKey,
    loadAiKnowledge,
    saveAiKnowledge,
};
