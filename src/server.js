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

// Sistema prompt (definido en servidor, no viaja por red)
const SYSTEM_PROMPT = `Eres Gemini, un asistente conversacional.
Responde exactamente a lo que el usuario pide en máximo 100 palabras.
- Sé claro, directo y conciso.
- No agregues información extra ni comentarios personales.
- Mantén coherencia y buena gramática.
- Termina la respuesta siempre con una oración completa.`;

wss.on('connection', (ws) => {
  console.log('🔌 Cliente conectado');

  ws.on('message', async (data) => {
    try {
      const { transcript, lang } = JSON.parse(data.toString());
      console.log(`📝 Transcripción recibida (${lang}):`, transcript);

      // Construir prompt completo en el servidor
      const fullPrompt = `${SYSTEM_PROMPT}\n\nUsuario: "${transcript}"\nRespuesta:`;

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