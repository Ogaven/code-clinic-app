(function () {
  'use strict';

  var API_BASE   = 'https://api-production-4c43.up.railway.app';
  var AVATAR_URL = 'https://codeclinic-production-73f628.up.railway.app/sarah.jpg';
  var cfg        = window.CodeClinicChatConfig || {};
  var PRIMARY    = cfg.primaryColor || '#29ABE2';
  var AVATAR     = cfg.avatarUrl    || AVATAR_URL;

  // ── Session ID ──────────────────────────────────────────────────────────────
  var SESSION_KEY = 'cc_wid_session';
  function getSessionId() {
    var v = localStorage.getItem(SESSION_KEY);
    if (!v) { v = 'ws_' + Math.random().toString(36).slice(2) + '_' + Date.now(); localStorage.setItem(SESSION_KEY, v); }
    return v;
  }
  var sessionId = getSessionId();

  // ── State ───────────────────────────────────────────────────────────────────
  var panelOpen    = false;
  var greetingDone = false;
  var unread       = false;
  var sending      = false;

  // ── CSS injection ───────────────────────────────────────────────────────────
  var css = '\
    #cc-widget-root{position:fixed;bottom:24px;right:24px;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}\
    \
    @keyframes cc-bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}\
    @keyframes cc-glow{0%,100%{box-shadow:0 0 10px rgba(41,171,226,0.4),0 0 20px rgba(41,171,226,0.2),0 4px 20px rgba(0,0,0,0.25)}50%{box-shadow:0 0 20px rgba(41,171,226,0.8),0 0 40px rgba(41,171,226,0.4),0 0 60px rgba(41,171,226,0.2),0 4px 20px rgba(0,0,0,0.25)}}\
    @keyframes cc-slide-up{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}\
    @keyframes cc-badge-pop{0%{transform:scale(0)}60%{transform:scale(1.3)}100%{transform:scale(1)}}\
    \
    #cc-btn-wrap{position:relative;cursor:pointer;width:64px;height:64px}\
    #cc-btn-avatar{width:64px;height:64px;border-radius:50%;object-fit:cover;object-position:center top;animation:cc-bounce 2.2s ease-in-out infinite,cc-glow 2.2s ease-in-out infinite;border:3px solid rgba(41,171,226,0.5);display:block}\
    #cc-badge{position:absolute;top:0;right:0;width:14px;height:14px;background:#EF4444;border-radius:50%;border:2px solid #fff;display:none;animation:cc-badge-pop 0.3s ease}\
    #cc-tooltip{position:absolute;right:74px;top:50%;transform:translateY(-50%);background:#111827;color:#fff;font-size:12px;font-weight:600;padding:7px 12px;border-radius:10px;white-space:nowrap;opacity:0;pointer-events:none;transition:opacity 0.15s;box-shadow:0 4px 12px rgba(0,0,0,0.3)}\
    #cc-tooltip:after{content:"";position:absolute;left:100%;top:50%;transform:translateY(-50%);border:5px solid transparent;border-left-color:#111827}\
    #cc-btn-wrap:hover #cc-tooltip{opacity:1}\
    \
    #cc-panel{position:fixed;bottom:104px;right:24px;width:360px;max-height:520px;background:#fff;border-radius:20px;box-shadow:0 12px 48px rgba(0,0,0,0.22);display:flex;flex-direction:column;overflow:hidden;animation:cc-slide-up 0.22s ease}\
    @media(max-width:480px){#cc-panel{width:calc(100vw - 24px);right:12px;bottom:96px}}\
    \
    #cc-head{padding:14px 16px;background:linear-gradient(135deg,#0c1e50,#29ABE2);display:flex;align-items:center;gap:10px;flex-shrink:0}\
    #cc-head-avatar{width:38px;height:38px;border-radius:50%;object-fit:cover;object-position:center top;border:2px solid rgba(255,255,255,0.4);flex-shrink:0}\
    #cc-head-info{flex:1}\
    #cc-head-name{font-size:15px;font-weight:700;color:#fff}\
    #cc-head-status{font-size:11px;color:rgba(255,255,255,0.85);display:flex;align-items:center;gap:4px;margin-top:1px}\
    #cc-head-dot{width:7px;height:7px;background:#4ADE80;border-radius:50%;display:inline-block}\
    #cc-close{background:none;border:none;color:rgba(255,255,255,0.8);cursor:pointer;font-size:22px;line-height:1;padding:0;margin-left:auto;flex-shrink:0}\
    #cc-close:hover{color:#fff}\
    \
    #cc-msgs{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:8px;background:#F8FAFF}\
    .cc-m{max-width:82%;padding:9px 13px;border-radius:12px;font-size:13px;line-height:1.45;word-break:break-word;white-space:pre-wrap}\
    .cc-agent{background:#fff;color:#1F2937;margin-right:auto;border-radius:4px 12px 12px 12px;box-shadow:0 1px 3px rgba(0,0,0,0.1)}\
    .cc-user{background:linear-gradient(135deg,#1A237E,#29ABE2);color:#fff;margin-left:auto;border-radius:12px 4px 12px 12px}\
    .cc-typing{display:flex;gap:4px;align-items:center;padding:10px 13px}\
    .cc-typing span{width:7px;height:7px;background:#CBD5E1;border-radius:50%;animation:cc-bounce 1.2s ease-in-out infinite}\
    .cc-typing span:nth-child(2){animation-delay:0.15s}\
    .cc-typing span:nth-child(3){animation-delay:0.3s}\
    \
    #cc-foot{padding:10px 12px;border-top:1px solid #E5E7EB;background:#fff;display:flex;gap:8px;align-items:center;flex-shrink:0}\
    #cc-inp{flex:1;padding:9px 14px;border:1.5px solid #E5E7EB;border-radius:22px;font-size:13px;outline:none;transition:border-color 0.15s;font-family:inherit}\
    #cc-inp:focus{border-color:' + PRIMARY + '}\
    #cc-send{width:36px;height:36px;border-radius:50%;background:' + PRIMARY + ';border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:opacity 0.15s}\
    #cc-send:disabled{opacity:0.5;cursor:default}\
  ';

  var styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  // ── Root wrapper ────────────────────────────────────────────────────────────
  var root = document.createElement('div');
  root.id = 'cc-widget-root';
  document.body.appendChild(root);

  // ── Launcher button ─────────────────────────────────────────────────────────
  var btnWrap = document.createElement('div');
  btnWrap.id = 'cc-btn-wrap';
  btnWrap.innerHTML =
    '<img id="cc-btn-avatar" src="' + AVATAR + '" alt="Chat with Sarah" />' +
    '<div id="cc-badge"></div>' +
    '<div id="cc-tooltip">Chat with us 💬</div>';
  root.appendChild(btnWrap);

  // ── Chat panel ──────────────────────────────────────────────────────────────
  var panel = document.createElement('div');
  panel.id = 'cc-panel';
  panel.style.display = 'none';
  panel.innerHTML =
    '<div id="cc-head">' +
      '<img id="cc-head-avatar" src="' + AVATAR + '" alt="Sarah" />' +
      '<div id="cc-head-info"><div id="cc-head-name">Sarah</div><div id="cc-head-status"><span id="cc-head-dot"></span>Code Clinic &bull; Online</div></div>' +
      '<button id="cc-close" aria-label="Close">&times;</button>' +
    '</div>' +
    '<div id="cc-msgs"></div>' +
    '<div id="cc-foot">' +
      '<input id="cc-inp" placeholder="Type a message..." autocomplete="off" />' +
      '<button id="cc-send" aria-label="Send"><svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M2 21l21-9L2 3v7l15 2-15 2v7z"/></svg></button>' +
    '</div>';
  root.appendChild(panel);

  // ── Helpers ─────────────────────────────────────────────────────────────────
  function msgsEl()  { return document.getElementById('cc-msgs'); }
  function inpEl()   { return document.getElementById('cc-inp'); }
  function sendBtn() { return document.getElementById('cc-send'); }
  function badge()   { return document.getElementById('cc-badge'); }

  function addMsg(text, cls) {
    var d = document.createElement('div');
    d.className = 'cc-m ' + cls;
    d.textContent = text;
    var box = msgsEl();
    box.appendChild(d);
    box.scrollTop = box.scrollHeight;
    return d;
  }

  function addTyping() {
    var d = document.createElement('div');
    d.className = 'cc-m cc-agent cc-typing';
    d.innerHTML = '<span></span><span></span><span></span>';
    msgsEl().appendChild(d);
    msgsEl().scrollTop = msgsEl().scrollHeight;
    return d;
  }

  function showBadge() {
    unread = true;
    var b = badge();
    b.style.display = 'block';
  }

  function hideBadge() {
    unread = false;
    var b = badge();
    b.style.display = 'none';
  }

  // ── Open / close ────────────────────────────────────────────────────────────
  function openPanel() {
    panelOpen = true;
    hideBadge();
    panel.style.display = 'flex';
    panel.style.flexDirection = 'column';
    setTimeout(function () { inpEl().focus(); }, 50);
    if (!greetingDone) {
      greetingDone = true;
      var greeting = cfg.greeting || 'Hi there! 👋 I\'m Sarah from Code Clinic 😊 How can I help you today?';
      setTimeout(function () { addMsg(greeting, 'cc-agent'); }, 300);
    }
  }

  function closePanel() {
    panelOpen = false;
    panel.style.display = 'none';
  }

  btnWrap.addEventListener('click', function () {
    if (panelOpen) { closePanel(); } else { openPanel(); }
  });
  document.getElementById('cc-close').addEventListener('click', function (e) {
    e.stopPropagation();
    closePanel();
  });

  // ── Send message ────────────────────────────────────────────────────────────
  async function sendMessage() {
    if (sending) return;
    var inp = inpEl();
    var text = inp.value.trim();
    if (!text) return;
    inp.value = '';
    sending = true;
    sendBtn().disabled = true;

    addMsg(text, 'cc-user');
    var typing = addTyping();

    try {
      var resp = await fetch(API_BASE + '/ai-suite/website/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, sessionId: sessionId }),
      });
      var data = await resp.json();
      typing.remove();
      var reply = (data && data.reply) ? data.reply : "I'm having trouble responding. Please try again!";
      addMsg(reply, 'cc-agent');
      if (!panelOpen) { showBadge(); }
    } catch (e) {
      typing.remove();
      addMsg('Connection error. Please try again!', 'cc-agent');
    } finally {
      sending = false;
      sendBtn().disabled = false;
      inpEl().focus();
    }
  }

  sendBtn().addEventListener('click', sendMessage);
  inpEl().addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
})();
