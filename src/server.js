import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { authRoutes } from './routes/authRoutes.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Mantener auth como HTTP REST
app.use("/api/auth", authRoutes);

// Conectar a MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ Conectado a MongoDB Atlas"))
  .catch(err => console.error("❌ Error conectando a MongoDB:", err));

// Crear servidor HTTP y WebSocket
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws/chat' });

// Inicializar Gemini
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

// Sistema prompt multiidioma
const getSystemPrompt = (lang) => {
  const prompts = {
    'es-ES': `Eres Gemini, un asistente conversacional. Responde en ESPAÑOL en máximo 100 palabras. Sé claro, directo y conciso.`,
    'en-US': `You are Gemini, a conversational assistant. Answer in ENGLISH in maximum 100 words. Be clear, direct and concise.`,
    'fr-FR': `Tu es Gemini, un assistant conversationnel. Réponds en FRANÇAIS en maximum 100 mots. Sois clair, direct et concis.`,
    'de-DE': `Du bist Gemini, ein Konversationsassistent. Antworte auf DEUTSCH in maximal 100 Wörtern. Sei klar, direkt und präzise.`,
    'it-IT': `Sei Gemini, un assistente conversazionale. Rispondi in ITALIANO in massimo 100 parole. Sii chiaro, diretto e conciso.`,
    'pt-BR': `Você é Gemini, um assistente conversacional. Responda em PORTUGUÊS em no máximo 100 palavras. Seja claro, direto e conciso.`,
  };
  return prompts[lang] || prompts['en-US'];
};

wss.on('connection', (ws) => {
  console.log('🔌 Cliente conectado');

  ws.on('message', async (data) => {
    try {
      const { transcript, lang } = JSON.parse(data.toString());
      console.log(`📝 Transcripción recibida (${lang}):`, transcript);

      // Construir prompt en el idioma correcto
      const systemPrompt = getSystemPrompt(lang);
      const fullPrompt = `${systemPrompt}\n\nUser: "${transcript}"\nAnswer:`;

      // Generar respuesta con streaming
      const result = await model.generateContentStream(fullPrompt);

      let fullText = '';
      
      // Enviar chunks en tiempo real
      for await (const chunk of result.stream) {
        const chunkText = chunk.text();
        fullText += chunkText;
        
        // Enviar cada chunk al cliente
        ws.send(JSON.stringify({
          type: 'chunk',
          text: chunkText,
          fullText: fullText
        }));
      }

      // Señal de finalización
      ws.send(JSON.stringify({
        type: 'done',
        fullText: fullText
      }));

      console.log('✅ Respuesta completa enviada');

    } catch (error) {
      console.error('❌ Error en WebSocket:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: error.message
      }));
    }
  });

  ws.on('close', () => {
    console.log('🔌 Cliente desconectado');
  });

  ws.on('error', (error) => {
    console.error('❌ Error en WebSocket:', error);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Servidor HTTP en http://localhost:${PORT}`);
  console.log(`🔌 WebSocket en ws://localhost:${PORT}/ws/chat`);
});