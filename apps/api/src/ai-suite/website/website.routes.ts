import { Router } from 'express'
import { PrismaClient } from '@prisma/client'
import { getAgentReply } from '../agent/agent.service'
import { isAgentEnabled } from '../takeover/takeover.service'

const router = Router()
const prisma = new PrismaClient()

// ── POST /ai-suite/website/message ────────────────────────────────────────────

router.post('/message', async (req, res) => {
  try {
    const { message, sessionId } = req.body as { message?: string; sessionId?: string }
    if (!message?.trim() || !sessionId?.trim()) {
      return res.status(400).json({ error: 'message and sessionId required' })
    }

    let conversation = await prisma.aiConversation.findFirst({
      where:   { phoneNumber: sessionId, channel: 'WEBSITE', status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    })
    if (!conversation) {
      conversation = await prisma.aiConversation.create({
        data: { channel: 'WEBSITE', phoneNumber: sessionId, status: 'ACTIVE', agentEnabled: true },
      })
    }

    await prisma.aiMessage.create({
      data: { conversationId: conversation.id, role: 'USER', content: message },
    })

    const agentOn = await isAgentEnabled(conversation.id)
    let reply: string

    if (!agentOn) {
      reply = 'Our team has taken over this conversation. A staff member will respond shortly.'
    } else {
      reply = await getAgentReply(conversation.id, sessionId, message)
      await prisma.aiMessage.create({
        data: { conversationId: conversation.id, role: 'AGENT', content: reply },
      })
    }

    res.json({ reply, sessionId, conversationId: conversation.id })
  } catch (err: any) {
    console.error('[Website] /message error:', err)
    res.status(500).json({ error: err.message })
  }
})

// ── GET /ai-suite/website/messages/:sessionId ─────────────────────────────────

router.get('/messages/:sessionId', async (req, res) => {
  try {
    const conversation = await prisma.aiConversation.findFirst({
      where:   { phoneNumber: req.params.sessionId, channel: 'WEBSITE' },
      orderBy: { createdAt: 'desc' },
    })
    if (!conversation) return res.json([])

    const messages = await prisma.aiMessage.findMany({
      where:   { conversationId: conversation.id },
      orderBy: { createdAt: 'asc' },
    })
    res.json(messages)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

export default router

// ── widget.js content (served from main.ts at GET /widget.js) ─────────────────

export const WIDGET_JS = `
(function () {
  var API_BASE = 'https://api-production-4c43.up.railway.app';
  var script   = document.currentScript;
  var clinicName = (script && script.getAttribute('data-clinic-name')) || 'Code Clinic';

  function sid() {
    var k = 'cc_ws_' + (script && script.getAttribute('data-clinic') || 'default');
    var v = localStorage.getItem(k);
    if (!v) { v = 'ws_' + Math.random().toString(36).slice(2) + '_' + Date.now(); localStorage.setItem(k, v); }
    return v;
  }

  var sessionId = sid();
  var sending = false;

  var css = \`
    #cc-w-b{position:fixed;bottom:24px;right:24px;z-index:2147483647}
    #cc-w-btn{width:60px;height:60px;border-radius:50%;background:#25D366;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 20px rgba(0,0,0,.25);border:none;cursor:pointer;transition:transform .2s}
    #cc-w-btn:hover{transform:scale(1.08)}
    #cc-w-p{position:fixed;bottom:96px;right:24px;width:350px;height:500px;background:#fff;border-radius:16px;box-shadow:0 8px 40px rgba(0,0,0,.2);display:none;flex-direction:column;overflow:hidden;z-index:2147483647;animation:ccsu .2s ease}
    @keyframes ccsu{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
    #cc-w-h{padding:14px 16px;background:#25D366;color:#fff;display:flex;align-items:center;gap:10px;flex-shrink:0}
    #cc-w-msgs{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:8px;background:#efeae2}
    .cc-m{max-width:80%;padding:8px 12px;border-radius:8px;font:14px/1.4 sans-serif;word-break:break-word}
    .cc-mu{background:#dcf8c6;margin-left:auto;border-radius:8px 0 8px 8px}
    .cc-ma{background:#fff;margin-right:auto;border-radius:0 8px 8px 8px;box-shadow:0 1px 2px rgba(0,0,0,.1)}
    .cc-sys{font-size:11px;color:#888;text-align:center;font-style:italic}
    #cc-w-inp-row{padding:10px;background:#fff;border-top:1px solid #e5e7eb;display:flex;gap:8px;flex-shrink:0}
    #cc-w-inp{flex:1;padding:8px 12px;border:1px solid #e5e7eb;border-radius:20px;outline:none;font:14px sans-serif}
    #cc-w-snd{width:36px;height:36px;border-radius:50%;background:#25D366;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0}
    #cc-w-snd:disabled{opacity:.5;cursor:default}
  \`;

  var s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);

  var bWrap = document.createElement('div'); bWrap.id = 'cc-w-b';
  bWrap.innerHTML = '<button id="cc-w-btn" aria-label="Chat with us"><svg width="26" height="26" viewBox="0 0 24 24" fill="white"><path d="M20 2H4C2.9 2 2 2.9 2 4v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg></button>';
  document.body.appendChild(bWrap);

  var panel = document.createElement('div'); panel.id = 'cc-w-p';
  panel.innerHTML = '<div id="cc-w-h"><div style="width:38px;height:38px;border-radius:50%;background:rgba(255,255,255,.3);display:flex;align-items:center;justify-content:center;font:700 15px sans-serif;color:#fff">CC</div><div style="flex:1"><div style="font:700 15px sans-serif">'+clinicName+'</div><div style="font-size:12px;opacity:.9">Ask us anything</div></div><button onclick="document.getElementById(\'cc-w-p\').style.display=\'none\'" style="background:none;border:none;color:#fff;cursor:pointer;font-size:22px;line-height:1;padding:0">&times;</button></div><div id="cc-w-msgs"><div class="cc-m cc-ma">Hi there! 😊 I\'m Sarah from '+clinicName+'. How can I help you today?</div></div><div id="cc-w-inp-row"><input id="cc-w-inp" placeholder="Type a message..." /><button id="cc-w-snd"><svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M2 21l21-9L2 3v7l15 2-15 2v7z"/></svg></button></div>';
  document.body.appendChild(panel);

  document.getElementById('cc-w-btn').addEventListener('click', function () {
    var p = document.getElementById('cc-w-p');
    if (p.style.display === 'flex') { p.style.display = 'none'; return; }
    p.style.display = 'flex'; p.style.flexDirection = 'column';
    document.getElementById('cc-w-inp').focus();
  });

  function addMsg(text, cls) {
    var d = document.createElement('div'); d.className = 'cc-m ' + cls; d.textContent = text;
    var box = document.getElementById('cc-w-msgs'); box.appendChild(d); box.scrollTop = box.scrollHeight;
    return d;
  }

  async function send() {
    if (sending) return;
    var inp = document.getElementById('cc-w-inp'); var t = inp.value.trim(); if (!t) return;
    inp.value = ''; sending = true;
    addMsg(t, 'cc-mu');
    var typing = addMsg('...', 'cc-ma cc-sys');
    document.getElementById('cc-w-snd').disabled = true;
    try {
      var r = await fetch(API_BASE + '/ai-suite/website/message', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: t, sessionId: sessionId }),
      });
      var d = await r.json();
      typing.remove();
      addMsg(d.reply || "I'm having trouble responding. Please try again!", 'cc-ma');
    } catch (e) { typing.remove(); addMsg("Connection error. Please try again!", 'cc-ma'); }
    finally { sending = false; document.getElementById('cc-w-snd').disabled = false; }
  }

  document.getElementById('cc-w-snd').addEventListener('click', send);
  document.getElementById('cc-w-inp').addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
})();
`
