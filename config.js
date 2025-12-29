// config.js
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const path = require('path');

const DB_FILE = path.join(__dirname, 'db.json');
const adapter = new FileSync(DB_FILE);
const db = low(adapter);

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
db.defaults({ users: {}, sessions: {}, apiKeys: [], currentApiKeyIndex: 0 }).write();

// --- User Functions ---
function getUserData(userId) {
    let users = db.get('users');
    if (!users.has(userId).value()) {
        users.set(userId, { ...defaultUserConfig }).write();
    }
    return users.get(userId).value();
}

function updateUserData(userId, data) {
    db.set(`users.${userId}`, data).write();
}

// --- Session Functions ---
function getOrCreateSession(userId, sessionId = null) {
    let sessions = db.get('sessions');
    let session;
    if (sessionId && sessions.has(sessionId).value()) {
        session = sessions.get(sessionId).value();
    }
    if (!session) {
        sessionId = `session_${Date.now()}_${userId}`;
        session = { id: sessionId, title: "New Conversation", timestamp: Date.now(), messages: [], lastMessagePreview: "" };
        sessions.set(sessionId, session).write();

        let users = db.get('users');
        if (!users.has(userId).value()) users.set(userId, { ...defaultUserConfig }).write();
        users.get(userId).assign({ currentSessionId: sessionId }).write();
    }
    return session;
}

function updateSession(session) {
    db.set(`sessions.${session.id}`, session).write();
}

function getAllUserSessions(userId) {
    return Object.values(db.get('sessions').value())
        .filter(s => s.messages.some(m => m.userId === userId))
        .sort((a,b) => b.timestamp - a.timestamp);
}

function deleteSession(sessionId) {
    db.unset(`sessions.${sessionId}`).write();
}

// --- API Key Functions ---
function loadApiKeys() {
    const data = db.value();
    botConfig.apiKeys = data.apiKeys || [];
    botConfig.currentApiKeyIndex = data.currentApiKeyIndex || 0;
}

function saveApiKeys() {
    db.set('apiKeys', botConfig.apiKeys).write();
    db.set('currentApiKeyIndex', botConfig.currentApiKeyIndex).write();
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
function loadAiKnowledge(userId) {
    const user = getUserData(userId);
    return user.aiKnowledge || [];
}

function saveAiKnowledge(userId, knowledge) {
    const user = getUserData(userId);
    user.aiKnowledge = knowledge;
    updateUserData(userId, user);
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
