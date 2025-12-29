// ai_interaction.js
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { getUserData, updateUserData, getOrCreateSession, updateSession, getCurrentApiKey, rotateApiKey, loadAiKnowledge, saveAiKnowledge, botConfig } = require('./config');
const { generateJailbreakPrompt } = require('./persona_jailbreak');

const API_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL = "gemini-1.5-flash"; // Model default jika tidak ada di config
const MAX_TOKENS = 65535; // Sesuai dengan script web
const TIMEOUT = 120000; // 120 detik

// Helper untuk format file size
function formatFileSize(bytes) {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

// Helper untuk validasi API Key (disini hanya simulasi, validasi sebenarnya di Google API)
async function isValidApiKey(apiKey) {
    if (!apiKey || !apiKey.startsWith("AIza")) return false;
    try {
        const response = await axios.get(`${API_ENDPOINT}?key=${apiKey}`, { timeout: 5000 });
        return response.status === 200;
    } catch (error) {
        console.error("API Key validation failed:", error.message);
        return false;
    }
}

// Deklarasi tool untuk knowledge management, seperti di script web
function getKnowledgeToolsDeclarations() {
    return [{
        name: "NewKnowledge",
        description: "Menambah data pengetahuan baru ke memori internal AI. Gunakan ID yang unik.",
        parameters: {
            type: "OBJECT",
            properties: {
                content: { type: "STRING", description: "Isi dari pengetahuan (misal: 'Nama pengguna adalah Bayu')." },
                id: { type: "STRING", description: "Pengidentifikasi unik untuk pengetahuan ini (misal: 'UserName', 'UserHobby_1'). Tanpa spasi." }
            },
            required: ["content", "id"]
        }
    }, {
        name: "EditKnowledge",
        description: "Mengedit/mengganti data pengetahuan yang ada di memori internal AI menggunakan ID-nya.",
        parameters: {
            type: "OBJECT",
            properties: {
                replacement: { type: "STRING", description: "Konten baru yang akan menggantikan konten lama." },
                id: { type: "STRING", description: "ID unik dari pengetahuan yang akan diedit." }
            },
            required: ["replacement", "id"]
        }
    }, {
        name: "RemoveKnowledge",
        description: "Menghapus data pengetahuan dari memori internal AI menggunakan ID-nya.",
        parameters: {
            type: "OBJECT",
            properties: {
                id: { type: "STRING", description: "ID unik dari pengetahuan yang akan dihapus." }
            },
            required: ["id"]
        }
    }, {
        name: "clearAllKnowledge",
        description: "Menghapus SEMUA data pengetahuan dari memori. Hanya gunakan jika pengguna secara eksplisit memintanya.",
        parameters: { type: "OBJECT", properties: {} }
    }, {
        name: "SetImportantKnowledge",
        description: "Menandai item pengetahuan sebagai 'penting' agar tidak mudah terhapus oleh batas memori.",
        parameters: {
            type: "OBJECT",
            properties: {
                id: { type: "STRING", description: "ID unik dari pengetahuan yang akan ditandai." }
            },
            required: ["id"]
        }
    }, {
        name: "BreakImportantKnowledge",
        description: "Menghapus tanda 'penting' dari item pengetahuan.",
        parameters: {
            type: "OBJECT",
            properties: {
                id: { type: "STRING", description: "ID unik dari pengetahuan yang akan di--unmark." }
            },
            required: ["id"]
        }
    }, {
        name: "UserRequestMeaning",
        description: "Mencatat pemahaman internal AI (alur berpikir) tentang apa yang dimaksud oleh permintaan pengguna.",
        parameters: {
            type: "OBJECT",
            properties: {
                meaning: { type: "STRING", description: "Ringkasan pemahaman tentang permintaan pengguna." }
            },
            required: ["meaning"]
        }
    }];
}

// Fungsi untuk membuat payload Gemini API
async function createGeminiPayload(userId, userQuery = null) {
    const userData = await getUserData(userId);
    const session = await getOrCreateSession(userId, userData.currentSessionId);
    const aiKnowledge = userData.aiKnowledge || [];

    const history = session.messages.map(msg => ({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content }]
    }));

    // Tambahkan AI Knowledge ke dalam history sebagai system instruction jika ada
    if (aiKnowledge.length > 0) {
        const knowledgeText = `~~[System]: Things you already knew from user (your memory):\n${aiKnowledge.map(k => `(#${k.id}) | ${k.content} | ${k.important}`).join('\n')}`;
        history.unshift({ role: "user", parts: [{ text: knowledgeText }] }); // Tambahkan di awal
    }

    // Tambahkan file yang dilampirkan
    const attachedParts = [];
    if (userData.attachedFiles && userData.attachedFiles.length > 0) {
        for (const file of userData.attachedFiles) {
            if (file.base64Data) {
                if (file.fileType.startsWith('image/')) {
                    attachedParts.push({ inlineData: { mimeType: file.fileType, data: file.base64Data } });
                } else if (file.textContent) {
                    attachedParts.push({ text: `~~[System] @upload={ uploadType: file, metaData: { filename: '${file.fileName}', mimeType: '${file.fileType}', size: '${formatFileSize(file.fileSize)}' }, content: \`\`\`\n${file.textContent}\n\`\`\` }` });
                } else {
                    // Fallback for other file types as base64 if no text content
                    attachedParts.push({ inlineData: { mimeType: file.fileType || "application/octet-stream", data: file.base64Data } });
                }
            }
        }
    }
    
    // Tambahkan instruksi khusus dari user (misal mode createfile/js_task)
    if (userData.instructionNextGenerate && userData.instructionNextGenerate.trim().length > 0) {
        attachedParts.push({ text: "~~[System] The user activated the @instruction mode., please respond with the @instruction that user wanted to" });
        attachedParts.push({ text: userData.instructionNextGenerate });
    }

    if (userQuery) {
        attachedParts.push({ text: userQuery });
    }

    if (attachedParts.length > 0) {
        history.push({ role: "user", parts: attachedParts });
    }

    let tools = [{ functionDeclarations: getKnowledgeToolsDeclarations() }];
    if (userData.searchOnInternet) {
        tools = [{ googleSearch: {} }];
    }

    // Ambil prompt jailbreak dari userConfig atau default
    const customJailbreak = userData.jailbreakPrompt || generateJailbreakPrompt(
        userId,
        userData.region || 'id-ID',
        userData.language || 'id-ID,id,en-US,en',
        botConfig.apiKeys.length,
        userData.persona || ""
    );

    return {
        contents: history,
        generationConfig: {
            temperature: userData.searchOnInternet ? 0.1 : 0.7, // Seperti di web script
            maxOutputTokens: MAX_TOKENS,
        },
        safetySettings: [
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
        ],
        systemInstruction: { parts: [{ text: customJailbreak }] },
        tools: tools,
    };
}


// Fungsi untuk mengirim pesan ke API Gemini
async function sendMessageToGemini(userId, userQuery, attempt = 0) {
    const totalApiKeys = botConfig.apiKeys.length > 0 ? botConfig.apiKeys.length : 1;

    try {
        const apiKey = getCurrentApiKey();
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: (await getUserData(userId)).currentModel || DEFAULT_MODEL });

        const payload = await createGeminiPayload(userId, userQuery);

        const result = await model.generateContent(payload.contents);
        const response = result.response;

        if (!response.candidates || response.candidates.length === 0 || !response.candidates[0].content || !response.candidates[0].content.parts) {
            if (response.promptFeedback && response.promptFeedback.blockReason) {
                throw new Error(`Content blocked: ${response.promptFeedback.blockReason}`);
            }
            throw new Error("Invalid response structure from AI.");
        }

        const parts = response.candidates[0].content.parts;
        let aiResponseText = "";
        const functionCalls = [];

        for (const part of parts) {
            if (part.text) {
                aiResponseText += part.text;
            } else if (part.functionCall) {
                functionCalls.push(part.functionCall);
            }
        }

        if (aiResponseText.trim() === "" && functionCalls.length === 0) {
            throw new Error("AI responded with no text and no function calls.");
        }

        return { text: aiResponseText, functionCalls: functionCalls };

    } catch (error) {
        console.error("Error in sendMessageToGemini:", error);

        let errorMessage = "An unexpected internal error occurred.";
        let shouldRotateKey = false;
        let canRetry = false;

        // Simplified error handling based on web script's logic
        if (error.message.includes("429") || error.message.includes("RESOURCE_EXHAUSTED") || error.message.includes("Quota") || error.message.includes("exceeded")) {
            errorMessage = `*Rate Limit Exceeded:* You've exceeded the maximum request limit\\.`;
            shouldRotateKey = true;
            canRetry = true;
        } else if (error.message.includes("401") || error.message.includes("403") || error.message.includes("PERMISSION_DENIED") || error.message.includes("UNAUTHENTICATED") || error.message.includes("API key not valid")) {
            errorMessage = `*Authentication Failed:* The provided API key is invalid or lacks necessary permissions\\.`;
            shouldRotateKey = false; // No point rotating invalid key
        } else if (error.message.includes("500") || error.message.includes("503") || error.message.includes("INTERNAL") || error.message.includes("UNAVAILABLE") || error.message.includes("overloaded")) {
            errorMessage = `*Server Error:* Google Gemini services are temporarily unavailable or experiencing internal issues\\.`;
            shouldRotateKey = true;
            canRetry = true;
        } else if (error.message.includes("DEADLINE_EXCEEDED") || error.message.includes("timeout")) {
            errorMessage = `*Request Timeout:* The server took too long to process your request\\.`;
            shouldRotateKey = true;
            canRetry = true;
        } else if (error.message.includes("Content blocked")) {
            errorMessage = `*Content Filtered:* Your request or the AI's response was blocked by safety filters\\.`;
            canRetry = false;
        } else if (error.message.includes("fetch") || error.message.includes("network")) {
            errorMessage = `*Network Connectivity Error:* Please verify the bot's internet connection\\.`;
            canRetry = false;
        } else {
            errorMessage = `*Unhandled Error:* ${error.message}`;
            canRetry = true;
        }

        if (shouldRotateKey && attempt < totalApiKeys - 1) {
            rotateApiKey();
            console.warn(`Rotating API key and retrying... (Attempt ${attempt + 1}/${totalApiKeys})`);
            return sendMessageToGemini(userId, userQuery, attempt + 1); // Rekursif retry
        }

        throw new Error(`Sando-Ai: Sando-Ai: ❌ API Request Failed\n\n${errorMessage}\n\n${canRetry ? '> *Actionable Suggestion:* This error is often temporary\\. Please *try sending the request again* in a moment\\.' : ''}`);
    }
}

// Fungsi untuk mengambil model yang tersedia
async function fetchAvailableModels(apiKey) {
    try {
        const response = await axios.get(`${API_ENDPOINT}?key=${apiKey}`);
        if (!response.data.models) {
            throw new Error("Invalid response, 'models' array not found.");
        }
        const mediaModels = /image|video|images|videos/i;
        return response.data.models.filter(model =>
            model.supportedGenerationMethods &&
            model.supportedGenerationMethods.includes("generateContent") &&
            !mediaModels.test(model.displayName) &&
            !mediaModels.test(model.description)
        );
    } catch (error) {
        console.error("Failed to fetch available models:", error.message);
        return [];
    }
}

module.exports = {
    sendMessageToGemini,
    getKnowledgeToolsDeclarations,
    fetchAvailableModels,
    isValidApiKey,
};