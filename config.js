// config.js
const { JsonDB, Config } = require('json-db');

const DB_NAME = 'revmony-wormgpt-db';
const SANDO_VERSION = "1.8.3 preview"; // Sesuai dengan script web

// Inisialisasi JsonDB
const db = new JsonDB(new Config(DB_NAME, true, true, '/'));

// Konfigurasi default per pengguna
const defaultUserConfig = {
    currentModel: "gemini-1.5-flash", // Model default
    searchOnInternet: false,
    instructionNextGenerate: "", // Untuk instruksi @instruction(createfile) atau (js_task)
    currentSessionId: null,
    attachedFiles: [], // File yang dilampirkan pengguna untuk permintaan saat ini
    aiKnowledge: [], // Pengetahuan AI per pengguna
    jailbreakPrompt: null, // Prompt jailbreak kustom per pengguna
};

// Konfigurasi global bot
const botConfig = {
    apiKeys: [],
    currentApiKeyIndex: 0,
    availableModels: [], // Cache model yang tersedia dari Gemini API
};

// --- Fungsi untuk mengelola data pengguna ---
async function getUserData(userId) {
    const path = `/users/${userId}`;
    try {
        return await db.getObject(path);
    } catch (e) {
        // Jika data pengguna tidak ada, inisialisasi dengan default
        await db.push(path, defaultUserConfig);
        return defaultUserConfig;
    }
}

async function updateUserData(userId, data) {
    const path = `/users/${userId}`;
    await db.push(path, data, false); // false = tidak merge, overwrite
}

async function getOrCreateSession(userId, sessionId = null) {
    const userData = await getUserData(userId);
    let session;
    if (sessionId) {
        try {
            session = await db.getObject(`/sessions/${sessionId}`);
        } catch (e) {
            console.warn(`Session ${sessionId} not found for user ${userId}, creating new one.`);
            sessionId = null; // Fallback to create new if not found
        }
    }

    if (!session) {
        sessionId = `session_${Date.now()}_${userId}`;
        session = {
            id: sessionId,
            title: "New Conversation",
            timestamp: Date.now(),
            messages: [],
            lastMessagePreview: "",
        };
        await db.push(`/sessions/${sessionId}`, session);
        userData.currentSessionId = sessionId;
        await updateUserData(userId, userData);
    }
    return session;
}

async function updateSession(session) {
    await db.push(`/sessions/${session.id}`, session, false);
}

async function getAllUserSessions(userId) {
    const sessionIds = [];
    try {
        const allSessions = await db.getObject('/sessions');
        for (const sessionId in allSessions) {
            if (allSessions[sessionId].messages.some(msg => msg.userId === userId)) { // Cek apakah sesi ini milik user
                sessionIds.push(allSessions[sessionId]);
            }
        }
    } catch (e) {
        // No sessions yet
    }
    return sessionIds.sort((a, b) => b.timestamp - a.timestamp);
}

async function deleteSession(sessionId) {
    await db.delete(`/sessions/${sessionId}`);
}

// --- Fungsi untuk mengelola API Keys ---
async function loadApiKeys() {
    try {
        botConfig.apiKeys = await db.getObject('/apiKeys');
        botConfig.currentApiKeyIndex = await db.getObject('/currentApiKeyIndex');
    } catch (e) {
        botConfig.apiKeys = [];
        botConfig.currentApiKeyIndex = 0;
    }
}

async function saveApiKeys() {
    await db.push('/apiKeys', botConfig.apiKeys, false);
    await db.push('/currentApiKeyIndex', botConfig.currentApiKeyIndex, false);
}

function getCurrentApiKey() {
    if (botConfig.apiKeys.length === 0) {
        throw new Error("No API keys available. Please add one using /addkey.");
    }
    return botConfig.apiKeys[botConfig.currentApiKeyIndex];
}

function rotateApiKey() {
    if (botConfig.apiKeys.length <= 1) return false;
    botConfig.currentApiKeyIndex = (botConfig.currentApiKeyIndex + 1) % botConfig.apiKeys.length;
    return true;
}

// --- Fungsi untuk mengelola AI Knowledge ---
async function loadAiKnowledge(userId) {
    const userData = await getUserData(userId);
    return userData.aiKnowledge || [];
}

async function saveAiKnowledge(userId, knowledge) {
    const userData = await getUserData(userId);
    userData.aiKnowledge = knowledge;
    await updateUserData(userId, userData);
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