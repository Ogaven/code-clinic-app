// Code Clinic — Sarah chat widget
// Embed: <script src="https://codeclinicemr.com/widget/chat-widget.js"></script>
(function () {
  'use strict';

  var API      = 'https://api.codeclinicemr.com';
  var AVATAR   = 'https://codeclinicemr.com/sarah.jpg';
  var BTN_SIZE = 112;
  var PANEL_W  = 390;
  var PANEL_H  = 600;
  var PAD      = 32;
  var SK       = 'cc_wgt_sid';
  var PK       = 'cc_wgt_pos';

  // ── Session ID ──────────────────────────────────────────────────────────────
  var sid = (function () {
    try {
      var v = localStorage.getItem(SK);
      if (!v) {
        v = 'ws_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2);
        localStorage.setItem(SK, v);
      }
      return v;
    } catch (e) {
      return 'ws_' + Date.now().toString(36);
    }
  })();

  // ── Styles ──────────────────────────────────────────────────────────────────
  var css = [
    // Wrapper
    '#ccw{position:fixed;z-index:2147483647;user-select:none;-webkit-user-select:none}',

    // Compact floating launcher: greeting and portrait are siblings so neither can distort the other.
    '#ccb{width:112px;height:112px;border:0;background:transparent;cursor:pointer;padding:0;position:relative;',
    'overflow:visible;touch-action:none;animation:ccfloat 3s ease-in-out infinite;transition:transform .2s}',
    '#ccb:hover{transform:scale(1.04)}',
    '#ccb.drag{animation:none!important;cursor:grabbing}',
    '#ccring1,#ccring2,#ccring3{position:absolute;border-radius:50%;pointer-events:none;box-sizing:border-box;animation:ccring 2.8s ease-in-out infinite}',
    '#ccring1{inset:-7px;border:5px solid rgba(41,171,226,.24)}',
    '#ccring2{inset:-15px;border:6px solid rgba(41,171,226,.14);animation-delay:-.9s}',
    '#ccring3{inset:-23px;border:7px solid rgba(26,35,126,.09);animation-delay:-1.8s}',
    '#ccportrait{position:absolute;inset:0;border-radius:50%;overflow:hidden;background:#fff;border:3px solid #29ABE2;box-shadow:0 10px 34px rgba(12,30,80,.20);box-sizing:border-box;padding:6px}',
    '#ccportraitclip{width:100%;height:100%;border-radius:50%;overflow:hidden;background:#fff;position:relative}',
    '@keyframes ccfloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}',
    '@keyframes ccring{0%,100%{transform:scale(.96);opacity:.58}50%{transform:scale(1.05);opacity:1}}',
    '#ccbimg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center 18%;border-radius:50%;display:block;background:#fff}',
    '#ccbfb{display:none;position:absolute;inset:0;align-items:center;justify-content:center;font:700 26px sans-serif;color:#fff;background:linear-gradient(135deg,#1A237E,#29ABE2)}',
    '#ccdot{position:absolute;bottom:5px;right:4px;width:12px;height:12px;border-radius:50%;background:#22c55e;border:2.5px solid #fff;pointer-events:none;animation:ccpu 2s ease-in-out infinite}',
    '@keyframes ccpu{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.6;transform:scale(1.35)}}',
    '#cctp{display:none}',
    '#ccbdg{position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;border-radius:9px;background:#ef4444;border:2px solid #fff;color:#fff;font:700 10px/14px sans-serif;text-align:center;padding:0 3px;display:none;z-index:2}',
    '#ccgreet{position:absolute;right:-4px;bottom:142px;width:300px;box-sizing:border-box;background:#fff;color:#1f2937;border:1px solid rgba(41,171,226,.20);border-radius:20px;padding:16px 42px 16px 18px;box-shadow:0 14px 38px rgba(12,30,80,.14);font:600 16px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;pointer-events:auto;text-align:left}',
    '#ccgreetx{position:absolute;right:12px;top:9px;border:0;background:transparent;color:#64748b;font-size:23px;line-height:1;cursor:pointer;padding:2px}',
    '#ccgreet.hide{display:none}',

    // Panel
    '#ccp{position:fixed;z-index:2147483646;width:390px;height:600px;max-height:calc(100vh - 24px);',
    'background:#fff;border:1px solid rgba(15,23,42,.08);border-radius:24px;box-shadow:0 24px 80px rgba(12,30,80,.24);',
    'display:none;flex-direction:column;overflow:hidden;transform-origin:bottom right;animation:ccsi .28s cubic-bezier(.2,.8,.2,1)}',
    '@keyframes ccsi{from{opacity:0;transform:translateY(18px) scale(.96)}to{opacity:1;transform:translateY(0) scale(1)}}',

    // Panel header
    '#ccph{background:linear-gradient(135deg,#0c1e50 0%,#123b78 58%,#29ABE2 100%);padding:16px 16px;display:flex;align-items:center;',
    'gap:10px;flex-shrink:0}',
    '#ccpav{width:44px;height:44px;border-radius:50%;overflow:hidden;border:2px solid rgba(255,255,255,.78);',
    'background:rgba(255,255,255,.25);display:flex;align-items:center;',
    'justify-content:center;flex-shrink:0}',
    '#ccpav img{width:100%;height:100%;object-fit:contain;object-position:center bottom;display:block;background:#fff}',
    '#ccpav .ccpf{display:none;font:700 16px sans-serif;color:#fff}',
    '#ccpinfo{flex:1}',
    '#ccpname{font:800 16px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#fff;letter-spacing:-.01em}',
    '#ccpsub{font:12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:rgba(255,255,255,.82);margin-top:2px}',
    '.cchd{width:9px;height:9px;border-radius:50%;background:#4ade80;flex-shrink:0}',
    '#ccpx{background:0;border:0;color:rgba(255,255,255,.82);font-size:24px;',
    'cursor:pointer;line-height:1;padding:0 2px;flex-shrink:0}',
    '#ccpx:hover{color:#fff}',

    // Messages area
    '#ccms{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;',
    'gap:9px;background:linear-gradient(180deg,#f8fbff 0%,#f4f8fc 100%)}',
    '.ccbl{max-width:84%;padding:9px 12px;border-radius:12px;',
    'font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;',
    'word-break:break-word}',
    '.ccs{background:#fff;align-self:flex-start;border-radius:6px 16px 16px 16px;',
    'box-shadow:0 3px 12px rgba(12,30,80,.08);border:1px solid rgba(15,23,42,.05);color:#1e293b}',
    '.ccu{background:linear-gradient(135deg,#1A237E,#29ABE2);align-self:flex-end;',
    'border-radius:12px 12px 4px 12px;color:#fff}',

    // Typing indicator
    '#cctd{display:none;align-items:center;gap:5px;padding:9px 12px;background:#fff;',
    'align-self:flex-start;border-radius:4px 12px 12px 12px;',
    'box-shadow:0 1px 4px rgba(0,0,0,.1)}',
    '.cctdd{width:7px;height:7px;border-radius:50%;background:#94a3b8;',
    'animation:ccty 1.4s infinite}',
    '.cctdd:nth-child(2){animation-delay:.22s}.cctdd:nth-child(3){animation-delay:.44s}',
    '@keyframes ccty{0%,80%,100%{opacity:.25;transform:scale(.9)}',
    '40%{opacity:1;transform:scale(1.2)}}',

    // Input row
    '#ccir{padding:12px 12px 8px;border-top:1px solid #e8eef5;display:flex;',
    'align-items:center;gap:8px;background:#fff;flex-shrink:0}',
    '#cci{flex:1;padding:9px 14px;border:1.5px solid #e2e8f0;border-radius:22px;',
    'outline:0;font:14px sans-serif;background:#f8fafc;transition:border-color .15s}',
    '#cci:focus{border-color:#29ABE2;background:#fff;box-shadow:0 0 0 3px rgba(41,171,226,.10)}',
    '#ccs{width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#1A237E,#29ABE2);border:0;',
    'cursor:pointer;display:flex;align-items:center;justify-content:center;',
    'flex-shrink:0;transition:background .15s}',
    '#ccs:hover:not(:disabled){filter:brightness(1.06);transform:translateY(-1px)}',
    '#ccs:disabled{background:#cbd5e1;cursor:default}',
    '#ccbrand{padding:0 12px 10px;background:#fff;text-align:center;font:10px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#94a3b8}',
    '.ccqa{display:flex;flex-wrap:wrap;gap:7px;align-self:flex-start;max-width:95%;margin:2px 0 4px}',
    '.ccq{border:1px solid rgba(41,171,226,.28);background:#fff;color:#17658a;border-radius:999px;padding:7px 10px;cursor:pointer;font:600 11px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 2px 7px rgba(12,30,80,.05)}',
    '.ccq:hover{background:#eef9fe;border-color:#29ABE2}',
    '@media(max-width:520px){#ccp{width:calc(100vw - 20px);height:min(640px,calc(100dvh - 88px));max-height:calc(100dvh - 88px);border-radius:22px}#ccph{padding:14px}#ccms{padding:12px}.ccbl{font-size:14px;max-width:88%}}',
  ].join('');

  var se = document.createElement('style');
  se.textContent = css;
  document.head.appendChild(se);

  // ── Button DOM ──────────────────────────────────────────────────────────────
  var wrap = document.createElement('div');
  wrap.id = 'ccw';
  wrap.innerHTML =
    '<div id="cctp">Chat with Sarah</div>' +
    '<div id="ccbdg"></div>' +
    '<div id="ccgreet">Hi! 😊 How may I brighten your smile today?<button id="ccgreetx" aria-label="Dismiss greeting">&times;</button></div>' +
    '<button id="ccb" aria-label="Chat with Sarah">' +
    '  <span id="ccring1"></span><span id="ccring2"></span><span id="ccring3"></span>' +
    '  <span id="ccportrait"><span id="ccportraitclip">' +
    '    <img id="ccbimg" src="' + AVATAR + '" alt="Sarah from Code Clinic" />' +
    '    <span id="ccbfb"><span>S</span></span>' +
    '  </span></span>' +
    '  <span id="ccdot"></span>' +
    '</button>';
  document.body.appendChild(wrap);

  // ── Panel DOM ───────────────────────────────────────────────────────────────
  var panEl = document.createElement('div');
  panEl.id = 'ccp';
  panEl.innerHTML =
    '<div id="ccph">' +
    '  <div id="ccpav">' +
    '    <img id="ccpimg" src="' + AVATAR + '" alt="" />' +
    '    <span class="ccpf">S</span>' +
    '  </div>' +
    '  <div id="ccpinfo">' +
    '    <div id="ccpname">Sarah</div>' +
    '    <div id="ccpsub">Code Clinic · Online now</div>' +
    '  </div>' +
    '  <div class="cchd"></div>' +
    '  <button id="ccpx" aria-label="Close">&times;</button>' +
    '</div>' +
    '<div id="ccms">' +
    '  <div id="cctd">' +
    '    <div class="cctdd"></div><div class="cctdd"></div><div class="cctdd"></div>' +
    '  </div>' +
    '</div>' +
    '<div id="ccir">' +
    '  <input id="cci" type="text" placeholder="Type a message..." autocomplete="off" />' +
    '  <button id="ccs" aria-label="Send">' +
    '    <svg width="18" height="18" viewBox="0 0 24 24" fill="white">' +
    '      <path d="M2 21l21-9L2 3v7l15 2-15 2v7z"/>' +
    '    </svg>' +
    '  </button>' +
    '</div>';
  document.body.appendChild(panEl);

  // ── Element refs ────────────────────────────────────────────────────────────
  var btn    = document.getElementById('ccb');
  var badge  = document.getElementById('ccbdg');
  var msgs   = document.getElementById('ccms');
  var typing = document.getElementById('cctd');
  var inp    = document.getElementById('cci');
  var sndBtn = document.getElementById('ccs');
  var closeX = document.getElementById('ccpx');
  var greet = document.getElementById('ccgreet');
  var greetX = document.getElementById('ccgreetx');
  if (greetX) greetX.addEventListener('click', function (e) { e.stopPropagation(); if (greet) greet.classList.add('hide'); });

  // ── Avatar fallback ─────────────────────────────────────────────────────────
  document.getElementById('ccbimg').addEventListener('error', function () {
    this.style.display = 'none';
    document.getElementById('ccbfb').style.display = 'flex';
  });
  document.getElementById('ccpimg').addEventListener('error', function () {
    this.style.display = 'none';
    var f = panEl.querySelector('.ccpf');
    if (f) { f.style.display = 'flex'; f.style.alignItems = 'center'; }
  });

  // ── Drag & drop ─────────────────────────────────────────────────────────────
  var bx = 0, by = 0;
  var dragging = false, moved = false, blockClick = false;
  var dox = 0, doy = 0, pendX = 0, pendY = 0, raf = null;

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function setPos(x, y, anim) {
    bx = x; by = y;
    wrap.style.transition = anim ? 'left .22s ease,top .22s ease' : 'none';
    wrap.style.left = x + 'px';
    wrap.style.top  = y + 'px';
    wrap.style.right  = 'auto';
    wrap.style.bottom = 'auto';
  }

  function savePos(x, y) {
    var tx = clamp(x, PAD, window.innerWidth - BTN_SIZE - PAD);
    var ty = clamp(y, PAD, window.innerHeight - BTN_SIZE - PAD);
    setPos(tx, ty, true);
    try { localStorage.setItem(PK, JSON.stringify({ x: tx, y: ty })); } catch (e) {}
  }

  // Load saved position or default bottom-right
  (function () {
    try {
      var sp = JSON.parse(localStorage.getItem(PK) || 'null');
      if (sp && typeof sp.x === 'number' && typeof sp.y === 'number') {
        setPos(
          clamp(sp.x, PAD, window.innerWidth  - BTN_SIZE - PAD),
          clamp(sp.y, PAD, window.innerHeight - BTN_SIZE - PAD),
          false
        );
        return;
      }
    } catch (e) {}
    setPos(window.innerWidth - 112 - 72, window.innerHeight - 112 - 72, false);
  })();

  function startDrag(ex, ey) {
    dragging = true; moved = false;
    dox = ex - bx; doy = ey - by;
    btn.classList.add('drag');
  }

  function moveDrag(ex, ey) {
    if (Math.abs(ex - bx - dox) > 3 || Math.abs(ey - by - doy) > 3) moved = true;
    pendX = clamp(ex - dox, 0, window.innerWidth  - BTN_SIZE);
    pendY = clamp(ey - doy, 0, window.innerHeight - BTN_SIZE);
    if (!raf) {
      raf = requestAnimationFrame(function () {
        raf = null;
        setPos(pendX, pendY, false);
        if (open) placePanel();
      });
    }
  }

  function endDrag() {
    dragging = false;
    btn.classList.remove('drag');
    if (moved) {
      blockClick = true;
      setTimeout(function () { blockClick = false; }, 80);
      savePos(bx, by);
      if (open) placePanel();
    }
  }

  // Mouse drag
  btn.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return;
    e.preventDefault();
    startDrag(e.clientX, e.clientY);
    function mm(e) { moveDrag(e.clientX, e.clientY); }
    function mu() {
      document.removeEventListener('mousemove', mm);
      document.removeEventListener('mouseup', mu);
      endDrag();
    }
    document.addEventListener('mousemove', mm);
    document.addEventListener('mouseup', mu);
  });

  // Touch drag
  btn.addEventListener('touchstart', function (e) {
    e.preventDefault();
    var t = e.touches[0];
    startDrag(t.clientX, t.clientY);
  }, { passive: false });
  btn.addEventListener('touchmove', function (e) {
    e.preventDefault();
    var t = e.touches[0];
    moveDrag(t.clientX, t.clientY);
  }, { passive: false });
  btn.addEventListener('touchend', function (e) {
    e.preventDefault();
    endDrag();
    if (!moved) toggle();
  }, { passive: false });

  // Click (mouse only — touch handled in touchend)
  btn.addEventListener('click', function () {
    if (!blockClick && !moved) toggle();
  });

  // ── Panel placement ─────────────────────────────────────────────────────────
  var open   = false;
  var inited = false;
  var unread = 0;

  function placePanel() {
    var mobile = window.innerWidth <= 520;
    var pw = mobile ? Math.min(PANEL_W, window.innerWidth - 20) : PANEL_W;
    var ph = mobile ? Math.min(640, window.innerHeight - 88) : Math.min(PANEL_H, window.innerHeight - 24);
    // Float the panel above the page instead of attaching it to the launcher.
    // Keep a comfortable inset from the viewport edges and animate it as a popup.
    var px = clamp(window.innerWidth - pw - 42, 10, window.innerWidth - pw - 10);
    var py = clamp(window.innerHeight - ph - 42, 10, window.innerHeight - ph - 10);
    panEl.style.left   = px + 'px';
    panEl.style.top    = py + 'px';
    panEl.style.right  = 'auto';
    panEl.style.bottom = 'auto';
  }

  function openPanel() {
    placePanel();
    wrap.style.display = 'none';
    panEl.style.display = 'flex';
    open = true;
    unread = 0;
    badge.style.display = 'none';
    badge.textContent   = '';
    if (!inited) startSession();
    setTimeout(function () { inp.focus(); }, 80);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function closePanel() {
    panEl.style.display = 'none';
    wrap.style.display = 'block';
    open = false;
  }

  function toggle() {
    if (open) closePanel(); else openPanel();
  }

  closeX.addEventListener('click', function () {
    closePanel();
    try { sessionStorage.setItem('ccw_dis', '1'); } catch (e) {}
  });

  // ── Messages ────────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
  }

  function addQuickActions() {
    if (document.getElementById('ccqa')) return;
    var q = document.createElement('div'); q.id='ccqa'; q.className='ccqa';
    ['Book an appointment','Services & prices','Opening hours','Talk to reception'].forEach(function(label){
      var b=document.createElement('button'); b.type='button'; b.className='ccq'; b.textContent=label;
      b.addEventListener('click',function(){ q.remove(); inp.value=label; sendMsg(); }); q.appendChild(b);
    });
    msgs.insertBefore(q, typing); msgs.scrollTop=msgs.scrollHeight;
  }

  function addBubble(text, who) {
    var d = document.createElement('div');
    // who='sarah' → classes 'ccbl ccs'; who='user' → 'ccbl ccu'
    d.className = 'ccbl cc' + who[0];
    d.innerHTML = esc(text);
    msgs.insertBefore(d, typing);
    msgs.scrollTop = msgs.scrollHeight;
    if (who === 'sarah' && !open) {
      unread++;
      badge.textContent   = unread > 9 ? '9+' : String(unread);
      badge.style.display = 'block';
    }
  }

  function showType() { typing.style.display = 'flex'; msgs.scrollTop = msgs.scrollHeight; }
  function hideType() { typing.style.display = 'none'; }

  // ── Session init ────────────────────────────────────────────────────────────
  var FALLBACK = 'Hello! 😊 I\'m Sarah from Code Clinic. How may I brighten your smile today?';

  function startSession() {
    inited = true;
    showType();
    fetch(API + '/website-chat/session', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ sessionId: sid }),
    })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      hideType();
      if (d.isNew !== false) {
        addBubble(d.greeting || FALLBACK, 'sarah');
        addQuickActions();
      } else if (d.messages && d.messages.length) {
        for (var i = 0; i < d.messages.length; i++) {
          var m = d.messages[i];
          if (m.role === 'AGENT')     addBubble(m.content, 'sarah');
          else if (m.role === 'USER') addBubble(m.content, 'user');
        }
      } else {
        addBubble(FALLBACK, 'sarah');
        addQuickActions();
      }
      // Don't badge the greeting — visitor just opened the panel
      unread = 0; badge.style.display = 'none';
    })
    .catch(function () {
      hideType();
      addBubble(FALLBACK, 'sarah');
      addQuickActions();
      unread = 0; badge.style.display = 'none';
    });
  }

  // ── Send message ────────────────────────────────────────────────────────────
  var busy = false;

  function sendMsg() {
    if (busy) return;
    var t = inp.value.trim();
    if (!t) return;
    inp.value = ''; busy = true; sndBtn.disabled = true;
    addBubble(t, 'user');
    showType();
    fetch(API + '/website-chat/message', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ sessionId: sid, message: t }),
    })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      hideType();
      addBubble(d.reply || FALLBACK, 'sarah');
    })
    .catch(function () {
      hideType();
      addBubble(
        'I\'m having trouble connecting right now. Please WhatsApp us at +256 741 087 667 😊',
        'sarah'
      );
    })
    .finally(function () {
      busy = false;
      sndBtn.disabled = false;
      inp.focus();
    });
  }

  sndBtn.addEventListener('click', sendMsg);
  inp.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); }
  });

  // ── Auto-popup (4s, once per session) ───────────────────────────────────────
  try {
    if (!sessionStorage.getItem('ccw_dis')) {
      setTimeout(function () { if (!open) openPanel(); }, 4000);
    }
  } catch (e) {}

  // ── Resize handler ──────────────────────────────────────────────────────────
  window.addEventListener('resize', function () {
    var nx = clamp(bx, 0, window.innerWidth  - BTN_SIZE);
    var ny = clamp(by, 0, window.innerHeight - BTN_SIZE);
    if (nx !== bx || ny !== by) setPos(nx, ny, false);
    if (open) placePanel();
  });

})();
