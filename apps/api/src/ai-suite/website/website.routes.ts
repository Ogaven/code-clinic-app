import { Router }   from 'express'
import multer        from 'multer'
import path          from 'path'
import fs            from 'fs'
import { getAgentReplyV2 } from '../agent/agent.service'
import { isAgentEnabled }       from '../takeover/takeover.service'
import { prisma }               from '../../lib/prisma'

function extractNameFromText(text: string): string | null {
  const m = text.match(/(?:my name is|i['']?m|i am|this is|call me)\s+([A-Z][a-z]{1,15}(?:\s+[A-Z][a-z]{1,15})?)/i)
  return m?.[1]?.trim() ?? null
}

const router = Router()

// ── Upload storage ─────────────────────────────────────────────────────────────

const UPLOAD_DIR = '/var/www/codeclinic/uploads/chat'
fs.mkdirSync(UPLOAD_DIR, { recursive: true })

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`)
  },
})

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
})

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
      reply = await getAgentReplyV2(conversation.id, sessionId, message, 'WEBSITE')
      await prisma.aiMessage.create({
        data: { conversationId: conversation.id, role: 'AGENT', content: reply },
      })
    }

    res.json({ reply, sessionId, conversationId: conversation.id })

    setImmediate(() => {
      const extractedName = extractNameFromText(message)
      prisma.lead.findFirst({
        where: { phone: sessionId, source: 'WEBSITE', status: { notIn: ['CONVERTED', 'LOST'] } },
      }).then(existing => {
        if (!existing) {
          return prisma.lead.create({
            data: { phone: sessionId, source: 'WEBSITE', status: 'NEW', stage: 'NEW', lastMessage: message, name: extractedName || null },
          })
        }
        const updateData: Record<string, unknown> = { lastMessage: message }
        if (extractedName && !existing.name) updateData.name = extractedName
        return prisma.lead.update({ where: { id: existing.id }, data: updateData })
      }).catch((e: any) => console.error('[Website] Lead upsert error:', e?.message))
    })
  } catch (err: any) {
    console.error('[Website] /message error:', err)
    res.status(500).json({ error: err.message })
  }
})

// ── POST /ai-suite/website/upload ─────────────────────────────────────────────

router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' })

    const { sessionId } = req.body as { sessionId?: string }

    const mime     = req.file.mimetype
    const fileType = mime.startsWith('image/') ? 'image'
                   : mime.startsWith('video/') ? 'video'
                   : mime.startsWith('audio/') ? 'voice'
                   : 'document'

    const publicUrl = `${process.env.API_URL || 'https://api.codeclinicemr.com'}/ai-suite/website/uploads/${req.file.filename}`

    // Log to conversation if sessionId provided
    if (sessionId?.trim()) {
      let conversation = await prisma.aiConversation.findFirst({
        where:   { phoneNumber: sessionId, channel: 'WEBSITE', status: 'ACTIVE' },
        orderBy: { createdAt: 'desc' },
      })
      if (!conversation) {
        conversation = await prisma.aiConversation.create({
          data: { channel: 'WEBSITE', phoneNumber: sessionId, status: 'ACTIVE', agentEnabled: true },
        })
      }
      const label = fileType === 'voice' ? '[Voice note]'
                  : fileType === 'image' ? `[Image: ${req.file.originalname}]`
                  : fileType === 'video' ? `[Video: ${req.file.originalname}]`
                  : `[Document: ${req.file.originalname}]`

      await prisma.aiMessage.create({ data: { conversationId: conversation.id, role: 'USER',  content: label     } })
      await prisma.aiMessage.create({ data: { conversationId: conversation.id, role: 'AGENT', content: `Got your ${fileType}! Our team will review it and get back to you. 😊` } })
    }

    console.log(`[Website] Upload: ${fileType} — ${req.file.filename} (${req.file.size} bytes)`)
    res.json({ url: publicUrl, type: fileType, filename: req.file.originalname })
  } catch (err: any) {
    console.error('[Website] /upload error:', err)
    res.status(500).json({ error: err.message })
  }
})

// ── GET /ai-suite/website/uploads/:filename ───────────────────────────────────

router.get('/uploads/:filename', (req, res) => {
  // Prevent path traversal
  const safe = path.basename(req.params.filename)
  const full = path.join(UPLOAD_DIR, safe)
  if (!fs.existsSync(full)) return res.status(404).json({ error: 'Not found' })
  res.sendFile(full)
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
  var API_BASE   = '${process.env.API_URL || 'https://api.codeclinicemr.com'}';
  var script     = document.currentScript;
  var clinicName = (script && script.getAttribute('data-clinic-name')) || 'Code Clinic';
  var clinicKey  = 'cc_ws_' + ((script && script.getAttribute('data-clinic')) || 'default');

  /* ── Session ID ─────────────────────────────────────────── */
  function sid() {
    var v = localStorage.getItem(clinicKey);
    if (!v) { v = 'ws_' + Math.random().toString(36).slice(2) + '_' + Date.now(); localStorage.setItem(clinicKey, v); }
    return v;
  }
  var sessionId = sid();
  var sending   = false;

  /* ── CSS ────────────────────────────────────────────────── */
  var css = \`
    #cc-w-b{position:fixed;bottom:24px;right:24px;z-index:2147483647}
    @keyframes ccbounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}
    @keyframes ccpulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.6;transform:scale(1.3)}}
    #cc-w-btn{width:60px;height:60px;border-radius:50%;background:#25D366;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 20px rgba(0,0,0,.25);border:none;cursor:pointer;animation:ccbounce 1.5s ease-in-out infinite}
    #cc-w-btn:hover{filter:brightness(1.1)}
    #cc-w-p{position:fixed;bottom:96px;right:24px;width:350px;height:500px;background:#fff;border-radius:16px;box-shadow:0 8px 40px rgba(0,0,0,.2);display:none;flex-direction:column;overflow:hidden;z-index:2147483647;animation:ccsu .25s ease}
    @keyframes ccsu{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
    #cc-w-h{padding:14px 16px;background:#25D366;color:#fff;display:flex;align-items:center;gap:10px;flex-shrink:0}
    #cc-w-msgs{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:8px;background:#efeae2}
    .cc-m{max-width:80%;padding:8px 12px;border-radius:8px;font:14px/1.4 sans-serif;word-break:break-word}
    .cc-mu{background:#dcf8c6;margin-left:auto;border-radius:8px 0 8px 8px}
    .cc-ma{background:#fff;margin-right:auto;border-radius:0 8px 8px 8px;box-shadow:0 1px 2px rgba(0,0,0,.1)}
    .cc-sys{font-size:11px;color:#888;text-align:center;font-style:italic}
    .cc-img{max-width:200px;max-height:180px;border-radius:6px;display:block;cursor:pointer;margin-top:4px}
    .cc-file{display:flex;align-items:center;gap:6px;font-size:13px}
    #cc-w-inp-row{padding:8px 10px;background:#fff;border-top:1px solid #e5e7eb;display:flex;align-items:center;gap:6px;flex-shrink:0}
    #cc-w-inp{flex:1;padding:8px 12px;border:1px solid #e5e7eb;border-radius:20px;outline:none;font:14px sans-serif}
    .cc-ic-btn{width:34px;height:34px;border-radius:50%;background:#f0f0f0;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;transition:background .15s}
    .cc-ic-btn:hover{background:#e0e0e0}
    .cc-ic-btn:disabled{opacity:.4;cursor:default}
    #cc-w-snd{width:36px;height:36px;border-radius:50%;background:#25D366;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0}
    #cc-w-snd:disabled{opacity:.5;cursor:default}
    #cc-att-menu{position:absolute;bottom:70px;right:60px;background:#fff;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,.15);padding:8px 0;z-index:2147483648;display:none;min-width:180px}
    .cc-att-opt{display:flex;align-items:center;gap:10px;padding:10px 16px;cursor:pointer;font:14px sans-serif;color:#333;transition:background .1s}
    .cc-att-opt:hover{background:#f5f5f5}
    #cc-rec-ind{position:absolute;bottom:76px;right:24px;background:#fff;border-radius:20px;padding:6px 14px;box-shadow:0 2px 10px rgba(0,0,0,.15);display:none;align-items:center;gap:8px;font:13px sans-serif;color:#e53e3e;z-index:2147483648}
    .cc-rec-dot{width:10px;height:10px;border-radius:50%;background:#e53e3e;animation:ccpulse 1s ease-in-out infinite}
  \`;
  var sEl = document.createElement('style'); sEl.textContent = css; document.head.appendChild(sEl);

  /* ── DOM ────────────────────────────────────────────────── */
  var bWrap = document.createElement('div'); bWrap.id = 'cc-w-b';
  bWrap.innerHTML = '<button id="cc-w-btn" aria-label="Chat with us">'
    + '<svg width="26" height="26" viewBox="0 0 24 24" fill="white"><path d="M20 2H4C2.9 2 2 2.9 2 4v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>'
    + '</button>';
  document.body.appendChild(bWrap);

  var panel = document.createElement('div'); panel.id = 'cc-w-p';
  panel.innerHTML =
    '<div id="cc-w-h">'
    + '<div style="width:38px;height:38px;border-radius:50%;background:rgba(255,255,255,.3);display:flex;align-items:center;justify-content:center;font:700 15px sans-serif;color:#fff">CC</div>'
    + '<div style="flex:1"><div style="font:700 15px sans-serif">' + clinicName + '</div><div style="font-size:12px;opacity:.9">Ask us anything</div></div>'
    + '<button onclick="document.getElementById(\'cc-w-p\').style.display=\'none\';sessionStorage.setItem(\'cc_dismissed\',\'1\')" style="background:none;border:none;color:#fff;cursor:pointer;font-size:22px;line-height:1;padding:0">&times;</button>'
    + '</div>'
    + '<div id="cc-w-msgs"><div class="cc-m cc-ma">Hi there! 😊 I\'m Sarah from ' + clinicName + ' — How may I help you today?</div></div>'
    + '<div id="cc-w-inp-row">'
    + '<input id="cc-w-inp" placeholder="Type a message…" />'
    + '<button class="cc-ic-btn" id="cc-w-att-btn" title="Attach file">📎</button>'
    + '<button class="cc-ic-btn" id="cc-w-mic-btn" title="Hold to record voice">🎤</button>'
    + '<button id="cc-w-snd"><svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M2 21l21-9L2 3v7l15 2-15 2v7z"/></svg></button>'
    + '</div>';
  document.body.appendChild(panel);

  /* Attachment menu */
  var attMenu = document.createElement('div'); attMenu.id = 'cc-att-menu';
  attMenu.innerHTML =
    '<div class="cc-att-opt" data-accept="image/*" data-type="image">📷 Photo / Image</div>'
    + '<div class="cc-att-opt" data-accept="video/*" data-type="video">🎥 Video</div>'
    + '<div class="cc-att-opt" data-accept=".pdf,.doc,.docx,.txt" data-type="document">📄 Document</div>';
  panel.style.position = 'fixed'; // ensure abs children place correctly
  document.body.appendChild(attMenu);

  /* Recording indicator */
  var recInd = document.createElement('div'); recInd.id = 'cc-rec-ind';
  recInd.innerHTML = '<div class="cc-rec-dot"></div><span>Recording… release to send</span>';
  document.body.appendChild(recInd);

  /* Hidden file input */
  var fileInput = document.createElement('input');
  fileInput.type = 'file'; fileInput.style.display = 'none';
  document.body.appendChild(fileInput);

  /* ── Helpers ────────────────────────────────────────────── */
  var box = document.getElementById('cc-w-msgs');

  function addMsg(html, cls) {
    var d = document.createElement('div');
    d.className = 'cc-m ' + cls;
    d.innerHTML = html;
    box.appendChild(d);
    box.scrollTop = box.scrollHeight;
    return d;
  }

  function escHtml(t) {
    return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function openPanel() {
    panel.style.display = 'flex';
    panel.style.flexDirection = 'column';
    document.getElementById('cc-w-inp').focus();
  }

  /* ── Auto-popup after 3 s (once per session) ─────────────── */
  if (!sessionStorage.getItem('cc_dismissed') && !sessionStorage.getItem('cc_opened')) {
    setTimeout(function () {
      if (!sessionStorage.getItem('cc_dismissed')) {
        openPanel();
        sessionStorage.setItem('cc_opened', '1');
      }
    }, 3000);
  }

  /* ── Bounce stops after first click ──────────────────────── */
  var btn = document.getElementById('cc-w-btn');
  btn.addEventListener('click', function () {
    btn.style.animation = 'none';
    sessionStorage.setItem('cc_clicked', '1');
    var p = document.getElementById('cc-w-p');
    if (p.style.display === 'flex') {
      p.style.display = 'none';
    } else {
      openPanel();
    }
  });
  if (sessionStorage.getItem('cc_clicked')) btn.style.animation = 'none';

  /* ── Send text ───────────────────────────────────────────── */
  async function send() {
    if (sending) return;
    var inp = document.getElementById('cc-w-inp');
    var t = inp.value.trim();
    if (!t) return;
    inp.value = ''; sending = true;
    addMsg(escHtml(t), 'cc-mu');
    var typing = addMsg('…', 'cc-ma cc-sys');
    document.getElementById('cc-w-snd').disabled = true;
    try {
      var r = await fetch(API_BASE + '/ai-suite/website/message', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: t, sessionId: sessionId }),
      });
      var d = await r.json();
      typing.remove();
      addMsg(escHtml(d.reply || "I'm having trouble responding. Please try again!"), 'cc-ma');
    } catch (e) {
      typing.remove();
      addMsg('Connection error. Please try again!', 'cc-ma');
    } finally {
      sending = false;
      document.getElementById('cc-w-snd').disabled = false;
    }
  }

  document.getElementById('cc-w-snd').addEventListener('click', send);
  document.getElementById('cc-w-inp').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });

  /* ── File / media upload ─────────────────────────────────── */
  async function uploadFile(file, label) {
    var previewHtml = '';
    if (file.type && file.type.startsWith('image/')) {
      var objUrl = URL.createObjectURL(file);
      previewHtml = '<img class="cc-img" src="' + objUrl + '" alt="image" />';
    } else {
      previewHtml = '<div class="cc-file">📄 <span>' + escHtml(label || file.name) + '</span></div>';
    }
    addMsg(previewHtml, 'cc-mu');

    var typing = addMsg('…', 'cc-ma cc-sys');
    try {
      var fd = new FormData();
      fd.append('file', file, label || file.name);
      fd.append('sessionId', sessionId);
      var r = await fetch(API_BASE + '/ai-suite/website/upload', { method: 'POST', body: fd });
      var d = await r.json();
      typing.remove();
      addMsg(escHtml('Got your ' + (d.type || 'file') + '! Our team will review it and get back to you. 😊'), 'cc-ma');
    } catch (e) {
      typing.remove();
      addMsg('Upload failed. Please try again.', 'cc-ma');
    }
  }

  /* Attachment menu toggle */
  var attBtn = document.getElementById('cc-w-att-btn');
  attBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    attMenu.style.display = attMenu.style.display === 'block' ? 'none' : 'block';
  });
  document.addEventListener('click', function () { attMenu.style.display = 'none'; });

  /* Attachment option clicked */
  attMenu.querySelectorAll('.cc-att-opt').forEach(function (opt) {
    opt.addEventListener('click', function () {
      attMenu.style.display = 'none';
      fileInput.accept = opt.getAttribute('data-accept');
      fileInput.value = '';
      fileInput.click();
    });
  });

  fileInput.addEventListener('change', function () {
    if (!fileInput.files || !fileInput.files[0]) return;
    uploadFile(fileInput.files[0], fileInput.files[0].name);
  });

  /* ── Voice note recording ────────────────────────────────── */
  var mediaRecorder = null, audioChunks = [];
  var micBtn = document.getElementById('cc-w-mic-btn');

  async function startRecording() {
    try {
      var stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunks = [];
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = function (e) { if (e.data.size > 0) audioChunks.push(e.data); };
      mediaRecorder.onstop = function () {
        stream.getTracks().forEach(function (t) { t.stop(); });
        var blob = new Blob(audioChunks, { type: 'audio/webm' });
        uploadFile(blob, 'voice-note.webm');
        audioChunks = [];
      };
      mediaRecorder.start();
      micBtn.style.background = '#fed7d7';
      recInd.style.display = 'flex';
    } catch (e) {
      addMsg('Microphone access denied. Please allow microphone in your browser settings.', 'cc-ma');
    }
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
    micBtn.style.background = '';
    recInd.style.display = 'none';
  }

  /* Hold to record on desktop; tap-to-toggle on mobile */
  var recording = false;
  micBtn.addEventListener('mousedown', function () { recording = true; startRecording(); });
  micBtn.addEventListener('mouseup',   function () { if (recording) { recording = false; stopRecording(); } });
  micBtn.addEventListener('mouseleave',function () { if (recording) { recording = false; stopRecording(); } });
  micBtn.addEventListener('touchstart', function (e) { e.preventDefault(); recording = true; startRecording(); }, { passive: false });
  micBtn.addEventListener('touchend',   function (e) { e.preventDefault(); if (recording) { recording = false; stopRecording(); } });

})();
`
