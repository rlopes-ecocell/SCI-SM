const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const JWT_SECRET = process.env.JWT_SECRET || 'sci-sm-2026-secret-key';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('ERRO: variáveis SUPABASE_URL e SUPABASE_KEY são obrigatórias');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// ── MIDDLEWARE ──
function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ erro: 'Não autorizado' });
  try {
    req.user = jwt.verify(auth.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ erro: 'Token inválido ou expirado' });
  }
}

function adminOnly(req, res, next) {
  authMiddleware(req, res, () => {
    if (req.user.perfil !== 'direcao') return res.status(403).json({ erro: 'Acesso restrito à direção' });
    next();
  });
}

// ── LOGIN ──
app.post('/api/login', async (req, res) => {
  const { login, senha } = req.body || {};
  if (!login || !senha) return res.status(400).json({ erro: 'Login e senha obrigatórios' });

  const { data: u, error } = await supabase
    .from('usuarios')
    .select('*')
    .eq('login', login.trim().toLowerCase())
    .eq('ativo', true)
    .single();

  if (error || !u) return res.status(401).json({ erro: 'Usuário não encontrado ou inativo' });

  const ok = await bcrypt.compare(senha, u.senha_hash);
  if (!ok) return res.status(401).json({ erro: 'Senha incorreta' });

  await supabase.from('usuarios')
    .update({ ultimo_acesso: new Date().toISOString() })
    .eq('id', u.id);

  const token = jwt.sign(
    { id: u.id, nome: u.nome, unidade: u.unidade, perfil: u.perfil },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.json({ token, usuario: { id: u.id, nome: u.nome, unidade: u.unidade, perfil: u.perfil } });
});

app.get('/api/me', authMiddleware, (req, res) => res.json(req.user));

// ── SETUP (cria primeiro admin se banco vazio) ──
app.post('/api/setup', async (req, res) => {
  const { data } = await supabase.from('usuarios').select('id').limit(1);
  if (data?.length > 0) return res.status(400).json({ erro: 'Sistema já configurado' });

  const { nome, login, senha } = req.body || {};
  if (!nome || !login || !senha) return res.status(400).json({ erro: 'Preencha todos os campos' });

  const senha_hash = await bcrypt.hash(senha, 10);
  const { data: u, error } = await supabase.from('usuarios')
    .insert({ nome, login: login.trim().toLowerCase(), senha_hash, unidade: 'Centro', perfil: 'direcao' })
    .select().single();

  if (error) return res.status(500).json({ erro: error.message });
  res.json({ ok: true, usuario: u });
});

// ── ADMIN: USUÁRIOS ──
app.get('/api/admin/usuarios', adminOnly, async (req, res) => {
  const { data, error } = await supabase
    .from('usuarios')
    .select('id,nome,login,unidade,perfil,ativo,criado_em,ultimo_acesso')
    .order('nome');
  if (error) return res.status(500).json({ erro: error.message });
  res.json(data);
});

app.post('/api/admin/usuarios', adminOnly, async (req, res) => {
  const { nome, login, senha, unidade, perfil } = req.body || {};
  if (!nome || !login || !senha || !unidade || !perfil)
    return res.status(400).json({ erro: 'Todos os campos são obrigatórios' });

  const senha_hash = await bcrypt.hash(senha, 10);
  const { data, error } = await supabase.from('usuarios')
    .insert({ nome, login: login.trim().toLowerCase(), senha_hash, unidade, perfil })
    .select().single();

  if (error) return res.status(400).json({ erro: error.code === '23505' ? 'Login já cadastrado' : error.message });
  res.json(data);
});

app.put('/api/admin/usuarios/:id', adminOnly, async (req, res) => {
  const { nome, unidade, perfil, ativo, senha } = req.body || {};
  const updates = {};
  if (nome !== undefined) updates.nome = nome;
  if (unidade !== undefined) updates.unidade = unidade;
  if (perfil !== undefined) updates.perfil = perfil;
  if (ativo !== undefined) updates.ativo = ativo;
  if (senha) updates.senha_hash = await bcrypt.hash(senha, 10);

  const { data, error } = await supabase.from('usuarios')
    .update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ erro: error.message });
  res.json(data);
});

// ── HISTÓRICO ──
app.get('/api/admin/mensagens', adminOnly, async (req, res) => {
  const { para_id } = req.query;
  let q = supabase.from('mensagens').select('*').order('criada_em', { ascending: false }).limit(100);
  if (para_id) q = q.eq('para_id', para_id);
  const { data, error } = await q;
  if (error) return res.status(500).json({ erro: error.message });
  res.json(data);
});

app.get('/api/admin/chamados', adminOnly, async (req, res) => {
  const { data, error } = await supabase.from('chamados')
    .select('*').order('criado_em', { ascending: false }).limit(100);
  if (error) return res.status(500).json({ erro: error.message });
  res.json(data);
});

// ── WEBSOCKET ──
const clients = new Map();

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
  let authed = false;

  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      const client = clients.get(ws);
      if (!client?.pendingAudio) return;
      for (const [tw, tc] of clients) {
        if (tw !== ws && tw.readyState === 1 && tc.unit === client.unit && tc.channel === client.channel)
          tw.send(data);
      }
      client.pendingAudio = false;
      return;
    }

    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }

    if (!authed) {
      if (msg.type !== 'auth') return;
      try {
        const user = jwt.verify(msg.token, JWT_SECRET);
        const client = {
          id: user.id, ws,
          name: user.nome,
          unit: user.unidade,
          profile: user.perfil,
          channel: 'Canal Geral',
          pendingAudio: false,
        };
        clients.set(ws, client);
        authed = true;
        ws.send(JSON.stringify({
          type: 'welcome', id: user.id,
          users: getUsers(user.unidade),
          channelCounts: getChannelCounts(user.unidade),
          onlineCount: getUsers(user.unidade).length,
        }));
        broadcast({
          type: 'users_update',
          users: getUsers(user.unidade),
          channelCounts: getChannelCounts(user.unidade),
          onlineCount: getUsers(user.unidade).length,
        }, c => c.unit === user.unidade && c.id !== user.id);
      } catch {
        ws.send(JSON.stringify({ type: 'auth_error', erro: 'Sessão inválida' }));
        ws.close();
      }
      return;
    }

    const client = clients.get(ws);
    if (!client) return;

    switch (msg.type) {
      case 'channel_change':
        client.channel = msg.channel;
        broadcast({
          type: 'users_update',
          users: getUsers(client.unit),
          channelCounts: getChannelCounts(client.unit),
          onlineCount: getUsers(client.unit).length,
        }, c => c.unit === client.unit);
        break;

      case 'ptt_start':
        broadcast({
          type: 'ptt_start', userId: client.id, userName: client.name,
          userProfile: client.profile, channel: client.channel, mimeType: msg.mimeType,
        }, c => c.unit === client.unit && c.id !== client.id && c.channel === client.channel);
        break;

      case 'ptt_stop':
        client.pendingAudio = true;
        broadcast({
          type: 'ptt_stop', userId: client.id, userName: client.name,
          channel: client.channel, mimeType: msg.mimeType, transcription: msg.transcription || null,
        }, c => c.unit === client.unit && c.id !== client.id && c.channel === client.channel);
        if (msg.transcription) {
          supabase.from('transmissoes').insert({
            de_id: client.id, de_nome: client.name,
            unidade: client.unit, canal: client.channel, transcricao: msg.transcription,
          }).then(() => {});
        }
        break;

      case 'chat_send': {
        const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        const chatMsg = {
          type: 'chat_msg', id: uuidv4(),
          fromId: client.id, fromName: client.name, toId: msg.toId,
          msgType: msg.msgType || 'text', text: msg.text,
          audioBase64: msg.audioBase64 || null, mimeType: msg.mimeType || null,
          dur: msg.dur || null, hora,
        };
        for (const [tw, tc] of clients) {
          if (tw.readyState === 1 && (tc.id === msg.toId || tc.id === client.id))
            tw.send(JSON.stringify(chatMsg));
        }
        supabase.from('mensagens').insert({
          tipo: msg.msgType || 'chat',
          de_id: client.id, de_nome: client.name,
          para_id: msg.toId, conteudo: msg.text || '[áudio]',
        }).then(() => {});
        break;
      }

      case 'chamado_send': {
        const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        const chamadoId = uuidv4();
        broadcast({
          type: 'chamado_new', id: chamadoId,
          fromId: client.id, fromName: client.name,
          targetProfile: msg.targetProfile, icon: msg.icon,
          titulo: msg.titulo, descricao: msg.descricao, hora,
        }, c => c.unit === client.unit && c.id !== client.id &&
          (c.profile === msg.targetProfile || c.profile === 'direcao'));
        ws.send(JSON.stringify({ type: 'chamado_sent', chamadoId }));
        supabase.from('chamados').insert({
          id: chamadoId, de_id: client.id, de_nome: client.name,
          unidade: client.unit, target_profile: msg.targetProfile,
          icon: msg.icon, titulo: msg.titulo,
        }).then(() => {});
        break;
      }

      case 'chamado_accept':
        broadcast({
          type: 'chamado_accepted', chamadoId: msg.chamadoId,
          byId: client.id, byName: client.name,
        }, c => c.unit === client.unit);
        supabase.from('chamados').update({
          status: 'aceito', aceito_por_id: client.id, aceito_por_nome: client.name,
        }).eq('id', msg.chamadoId).then(() => {});
        break;

      case 'chamado_reject':
        broadcast({ type: 'chamado_rejected', chamadoId: msg.chamadoId }, c => c.unit === client.unit);
        supabase.from('chamados').update({ status: 'recusado' }).eq('id', msg.chamadoId).then(() => {});
        break;
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
