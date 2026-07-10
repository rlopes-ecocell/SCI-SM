const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static('public'));

const clients = new Map(); // ws → {id, name, unit, profile, channel, pendingAudio}

function getUsers(unit) {
  return Array.from(clients.values())
    .filter(c => c.unit === unit)
    .map(c => ({ id: c.id, name: c.name, profile: c.profile, channel: c.channel }));
}

function getChannelCounts(unit) {
  const counts = {};
  for (const [, c] of clients) {
    if (c.unit === unit) counts[c.channel] = (counts[c.channel] || 0) + 1;
  }
  return counts;
}

function broadcast(data, filter) {
  const msg = JSON.stringify(data);
  for (const [ws, c] of clients) {
    if (ws.readyState === 1 && filter(c)) ws.send(msg);
  }
}

wss.on('connection', (ws) => {
  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      const client = clients.get(ws);
      if (!client || !client.pendingAudio) return;
      const { channel, unit } = client;
      // Broadcast audio to same unit + same channel listeners
      for (const [tw, tc] of clients) {
        if (tw !== ws && tw.readyState === 1 && tc.unit === unit && tc.channel === channel) {
          tw.send(data);
        }
      }
      client.pendingAudio = false;
      return;
    }

    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }

    switch (msg.type) {
      case 'login': {
        const id = uuidv4();
        const client = {
          id, ws,
          name: msg.name,
          unit: msg.unit,
          profile: msg.profile,
          channel: 'Geral',
          pendingAudio: false,
        };
        clients.set(ws, client);
        ws.send(JSON.stringify({
          type: 'welcome', id,
          users: getUsers(msg.unit),
          channelCounts: getChannelCounts(msg.unit),
          onlineCount: getUsers(msg.unit).length,
        }));
        broadcast({
          type: 'users_update',
          users: getUsers(msg.unit),
          channelCounts: getChannelCounts(msg.unit),
          onlineCount: getUsers(msg.unit).length,
        }, c => c.unit === msg.unit && c.id !== id);
        break;
      }

      case 'channel_change': {
        const client = clients.get(ws);
        if (!client) return;
        client.channel = msg.channel;
        broadcast({
          type: 'users_update',
          users: getUsers(client.unit),
          channelCounts: getChannelCounts(client.unit),
          onlineCount: getUsers(client.unit).length,
        }, c => c.unit === client.unit);
        break;
      }

      case 'ptt_start': {
        const client = clients.get(ws);
        if (!client) return;
        broadcast({
          type: 'ptt_start',
          userId: client.id,
          userName: client.name,
          userProfile: client.profile,
          channel: client.channel,
          mimeType: msg.mimeType,
        }, c => c.unit === client.unit && c.id !== client.id && c.channel === client.channel);
        break;
      }

      case 'ptt_stop': {
        const client = clients.get(ws);
        if (!client) return;
        client.pendingAudio = true;
        broadcast({
          type: 'ptt_stop',
          userId: client.id,
          userName: client.name,
          channel: client.channel,
          mimeType: msg.mimeType,
          transcription: msg.transcription || null,
        }, c => c.unit === client.unit && c.id !== client.id && c.channel === client.channel);
        break;
      }

      case 'chat_send': {
        const client = clients.get(ws);
        if (!client) return;
        const now = new Date();
        const hora = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
        const chatMsg = {
          type: 'chat_msg',
          id: uuidv4(),
          fromId: client.id,
          fromName: client.name,
          toId: msg.toId,
          msgType: msg.msgType || 'text',
          text: msg.text,
          audioBase64: msg.audioBase64 || null,
          mimeType: msg.mimeType || null,
          dur: msg.dur || null,
          hora,
        };
        for (const [tw, tc] of clients) {
          if (tw.readyState === 1 && (tc.id === msg.toId || tc.id === client.id)) {
            tw.send(JSON.stringify(chatMsg));
          }
        }
        break;
      }

      case 'chamado_send': {
        const client = clients.get(ws);
        if (!client) return;
        const now = new Date();
        const hora = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
        const chamadoId = uuidv4();
        const chamado = {
          type: 'chamado_new',
          id: chamadoId,
          fromId: client.id,
          fromName: client.name,
          targetProfile: msg.targetProfile,
          icon: msg.icon,
          titulo: msg.titulo,
          descricao: msg.descricao,
          hora,
        };
        broadcast(chamado, c =>
          c.unit === client.unit &&
          c.id !== client.id &&
          (c.profile === msg.targetProfile || c.profile === 'direcao')
        );
        ws.send(JSON.stringify({ type: 'chamado_sent', chamadoId }));
        break;
      }

      case 'chamado_accept': {
        const client = clients.get(ws);
        if (!client) return;
        broadcast({
          type: 'chamado_accepted',
          chamadoId: msg.chamadoId,
          byId: client.id,
          byName: client.name,
        }, c => c.unit === client.unit);
        break;
      }

      case 'chamado_reject': {
        const client = clients.get(ws);
        if (!client) return;
        broadcast({
          type: 'chamado_rejected',
          chamadoId: msg.chamadoId,
        }, c => c.unit === client.unit);
        break;
      }
    }
  });

  ws.on('close', () => {
    const client = clients.get(ws);
    if (!client) return;
    clients.delete(ws);
    broadcast({
      type: 'users_update',
      users: getUsers(client.unit),
      channelCounts: getChannelCounts(client.unit),
      onlineCount: getUsers(client.unit).length,
    }, c => c.unit === client.unit);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`SCI rodando na porta ${PORT}`));
