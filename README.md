# 📡 SCI — Sistema de Comunicação Interno
### Escola Santa Mônica

Sistema de comunicação interno via Wi-Fi com rádio push-to-talk (PTT), chat, chamados rápidos e transcrição de voz em tempo real. Funciona no navegador de qualquer dispositivo — sem instalar nada.

---

## 🏫 Unidades

| Unidade | Canais |
|---|---|
| Centro | Geral · Direção · Professores · Funcionários |
| Corujinha | Geral · Direção · Professores · Funcionários |
| Altos do Laranjal | Geral · Direção · Professores · Funcionários |

---

## 👥 Perfis de acesso

| Perfil | PTT | Chamados | Canais |
|---|---|---|---|
| **Professor** | ✅ | Envia | Professores · Geral |
| **Monitor** | ✅ | Recebe (acompanhamento) | Geral · Funcionários |
| **Manutenção** | ✅ | Recebe (técnicos) | Geral · Funcionários |
| **Funcionário** | ✅ | — | Geral · Funcionários |
| **Direção** | ✅ | Recebe tudo | Todos |

---

## 🚀 Deploy na Square Cloud

### Pré-requisitos
- Conta ativa na [Square Cloud](https://squarecloud.app) com plano pago
- Node.js 18+ instalado localmente para desenvolvimento

### Estrutura do projeto

```
sci-santamonica/
├── squarecloud.app   ← configuração da Square Cloud (obrigatório na raiz)
├── server.js         ← servidor Node.js com WebSocket
├── package.json      ← dependências
├── public/
│   └── index.html    ← interface do app
└── README.md
```

### Passo a passo para subir na Square Cloud

**1. Instalar dependências localmente (para testar)**
```bash
npm install
```

**2. Testar localmente**
```bash
node server.js
# Acesse: http://localhost:3000
```

**3. Criar o arquivo .zip para deploy**

> ⚠️ Não inclua a pasta `node_modules` nem o `package-lock.json` no zip.

```bash
# No terminal (Linux/Mac)
zip -r sci-deploy.zip . -x "node_modules/*" -x "package-lock.json" -x ".git/*"
```

No Windows: selecione todos os arquivos **exceto** `node_modules`, clique com botão direito → Compactar.

**4. Fazer o deploy**
- Acesse [squarecloud.app/dashboard](https://squarecloud.app/dashboard)
- Clique em **"New Application"**
- Faça upload do arquivo `sci-deploy.zip`
- A Square Cloud detecta o `squarecloud.app` automaticamente
- Clique em **Deploy**

**5. Acessar o sistema**

Após o deploy, o sistema estará disponível em:
```
https://sci-santamonica.squareweb.app
```
> O subdomínio pode ser configurado no painel da Square Cloud.

---

## ⚙️ Configuração (`squarecloud.app`)

```ini
MAIN=server.js
MEMORY=512
VERSION=recommended
DISPLAY_NAME=SCI - Escola Santa Mônica
DESCRIPTION=Sistema de Comunicação Interno via Wi-Fi
START=node server.js
```

| Campo | Valor | Descrição |
|---|---|---|
| `MAIN` | `server.js` | Arquivo principal |
| `MEMORY` | `512` | RAM em MB (mínimo para websites) |
| `VERSION` | `recommended` | Versão do Node.js |
| `START` | `node server.js` | Comando de inicialização |

---

## 📦 Dependências (`package.json`)

```json
{
  "name": "sci-santamonica",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "ws": "^8.16.0",
    "uuid": "^9.0.0"
  }
}
```

---

## 🏗️ Arquitetura

```
Celular/PC (navegador)
       │
       │ WebSocket (áudio PTT)
       │ HTTP (chat, chamados)
       ▼
  Square Cloud
  Node.js + Express + ws
       │
       ├── /public         → Interface web
       ├── WebSocket Server → PTT em tempo real
       └── REST API         → Chamados, mensagens, histórico
```

---

## 📋 Funcionalidades implementadas

- [x] Login por perfil (Professor, Monitor, Manutenção, Funcionário, Direção)
- [x] Seleção de unidade (Centro, Corujinha, Laranjal)
- [x] Rádio PTT por canal
- [x] Transcrição em tempo real (Web Speech API + Whisper)
- [x] Chamados rápidos (professor → monitor/manutenção)
- [x] Fila de chamados com aceitar/recusar
- [x] Chat direto com mensagens de texto e áudio
- [x] Recados para quem não está online
- [x] Histórico de transmissões com transcrição
- [ ] Notificações push (próxima fase)
- [ ] Autenticação com senha por unidade (próxima fase)
- [ ] Gravação de áudio para quem perdeu a transmissão (próxima fase)

---

## 🔧 Desenvolvimento local

```bash
# Clonar / baixar o projeto
cd sci-santamonica

# Instalar dependências
npm install

# Iniciar servidor de desenvolvimento
node server.js

# Acessar no navegador
http://localhost:3000
```

---

## 🌐 Domínio personalizado

Para usar `sci.escolasantamonica.com.br` em vez do subdomínio padrão da Square Cloud:

1. Registre o domínio em [registro.br](https://registro.br) (~R$ 50/ano)
2. No painel da Square Cloud, vá em **Domains → Add Custom Domain**
3. Aponte o DNS para os servidores da Square Cloud conforme instruções do painel
4. O certificado SSL é gerado automaticamente

---

## 📞 Suporte

Para dúvidas sobre a Square Cloud: [docs.squarecloud.app](https://docs.squarecloud.app)

---

*Desenvolvido para a Escola Santa Mônica — Pelotas, RS*
