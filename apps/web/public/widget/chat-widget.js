// Code Clinic — Sarah chat widget
// Embed: <script src="https://codeclinicemr.com/widget/chat-widget.js"></script>
(function () {
  'use strict';

  var API      = 'https://api.codeclinicemr.com';
  var AVATAR   = 'https://codeclinicemr.com/sarah.jpg';
  var BTN_SIZE = 64;
  var PANEL_W  = 320;
  var PANEL_H  = 420;
  var PAD      = 20;
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

    // Floating button
    '#ccb{width:64px;height:64px;border-radius:50%;background:#0d9488;border:0;',
    'cursor:pointer;padding:0;box-shadow:0 4px 22px rgba(0,0,0,.3);position:relative;',
    'overflow:hidden;touch-action:none;animation:ccbo 2s ease-in-out infinite;',
    'transition:box-shadow .15s}',
    '#ccb:hover{box-shadow:0 6px 28px rgba(0,0,0,.36)}',
    '#ccb.drag{animation:none!important;cursor:grabbing;box-shadow:0 8px 36px rgba(0,0,0,.4)}',
    '@keyframes ccbo{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}',
    '#ccbimg{width:100%;height:100%;object-fit:cover;border-radius:50%;display:block}',
    '#ccbfb{display:none;width:100%;height:100%;align-items:center;',
    'justify-content:center;font:700 26px sans-serif;color:#fff}',

    // Online dot on button
    '#ccdot{position:absolute;bottom:3px;right:3px;width:12px;height:12px;border-radius:50%;',
    'background:#22c55e;border:2.5px solid #fff;pointer-events:none;',
    'animation:ccpu 2s ease-in-out infinite}',
    '@keyframes ccpu{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.6;transform:scale(1.35)}}',

    // Tooltip
    '#cctp{position:absolute;bottom:72px;left:50%;transform:translateX(-50%);',
    'white-space:nowrap;background:rgba(15,23,42,.78);color:#fff;',
    'font:12px/1 -apple-system,sans-serif;padding:5px 10px;border-radius:6px;',
    'opacity:0;transition:opacity .18s;pointer-events:none}',
    '#ccw:hover #cctp{opacity:1}',

    // Unread badge on button
    '#ccbdg{position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;',
    'border-radius:9px;background:#ef4444;border:2px solid #fff;color:#fff;',
    'font:700 10px/14px sans-serif;text-align:center;padding:0 3px;display:none}',

    // Panel
    '#ccp{position:fixed;z-index:2147483646;width:320px;height:420px;',
    'background:#fff;border-radius:16px;box-shadow:0 12px 48px rgba(0,0,0,.22);',
    'display:none;flex-direction:column;overflow:hidden;animation:ccsi .25s ease}',
    '@keyframes ccsi{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}',

    // Panel header
    '#ccph{background:#0d9488;padding:12px 14px;display:flex;align-items:center;',
    'gap:10px;flex-shrink:0}',
    '#ccpav{width:38px;height:38px;border-radius:50%;overflow:hidden;',
    'background:rgba(255,255,255,.25);display:flex;align-items:center;',
    'justify-content:center;flex-shrink:0}',
    '#ccpav img{width:100%;height:100%;object-fit:cover;display:block}',
    '#ccpav .ccpf{display:none;font:700 16px sans-serif;color:#fff}',
    '#ccpinfo{flex:1}',
    '#ccpname{font:700 15px sans-serif;color:#fff}',
    '#ccpsub{font:12px sans-serif;color:rgba(255,255,255,.82)}',
    '.cchd{width:9px;height:9px;border-radius:50%;background:#4ade80;flex-shrink:0}',
    '#ccpx{background:0;border:0;color:rgba(255,255,255,.82);font-size:24px;',
    'cursor:pointer;line-height:1;padding:0 2px;flex-shrink:0}',
    '#ccpx:hover{color:#fff}',

    // Messages area
    '#ccms{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;',
    'gap:8px;background:#f0fdf9}',
    '.ccbl{max-width:84%;padding:9px 12px;border-radius:12px;',
    'font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;',
    'word-break:break-word}',
    '.ccs{background:#fff;align-self:flex-start;border-radius:4px 12px 12px 12px;',
    'box-shadow:0 1px 4px rgba(0,0,0,.1);color:#1e293b}',
    '.ccu{background:#0d9488;align-self:flex-end;',
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
    '#ccir{padding:10px 12px;border-top:1px solid #e2e8f0;display:flex;',
    'align-items:center;gap:8px;background:#fff;flex-shrink:0}',
    '#cci{flex:1;padding:9px 14px;border:1.5px solid #e2e8f0;border-radius:22px;',
    'outline:0;font:14px sans-serif;background:#f8fafc;transition:border-color .15s}',
    '#cci:focus{border-color:#0d9488;background:#fff}',
    '#ccs{width:38px;height:38px;border-radius:50%;background:#0d9488;border:0;',
    'cursor:pointer;display:flex;align-items:center;justify-content:center;',
    'flex-shrink:0;transition:background .15s}',
    '#ccs:hover:not(:disabled){background:#0f766e}',
    '#ccs:disabled{background:#cbd5e1;cursor:default}',
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
    '<button id="ccb" aria-label="Chat with Sarah">' +
    '  <img id="ccbimg" src="' + AVATAR + '" alt="" />' +
    '  <div id="ccbfb"><span>S</span></div>' +
    '  <div id="ccdot"></div>' +
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
    '    <div id="ccpsub">Code Clinic</div>' +
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

  function snapEdge(cx, cy) {
    var tx = (cx + BTN_SIZE / 2) < window.innerWidth / 2
      ? PAD
      : window.innerWidth - BTN_SIZE - PAD;
    var ty = clamp(cy, PAD, window.innerHeight - BTN_SIZE - PAD);
    setPos(tx, ty, true);
    try { localStorage.setItem(PK, JSON.stringify({ x: tx, y: ty })); } catch (e) {}
  }

  // Load saved position or default bottom-right
  (function () {
    try {
      var sp = JSON.parse(localStorage.getItem(PK) || 'null');
      if (sp && typeof sp.x === 'number' && typeof sp.y === 'number') {
        setPos(
          clamp(sp.x, 0, window.innerWidth  - BTN_SIZE),
          clamp(sp.y, 0, window.innerHeight - BTN_SIZE),
          false
        );
        return;
      }
    } catch (e) {}
    setPos(window.innerWidth - BTN_SIZE - PAD, window.innerHeight - BTN_SIZE - PAD, false);
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
      snapEdge(bx, by);
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
    var onRight = (bx + BTN_SIZE / 2) > window.innerWidth / 2;
    var py = by - PANEL_H - 10;
    if (py < 8) py = by + BTN_SIZE + 10;
    var px = onRight ? bx + BTN_SIZE - PANEL_W : bx;
    px = clamp(px, 8, window.innerWidth - PANEL_W - 8);
    panEl.style.left   = px + 'px';
    panEl.style.top    = py + 'px';
    panEl.style.right  = 'auto';
    panEl.style.bottom = 'auto';
  }

  function openPanel() {
    placePanel();
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
      } else if (d.messages && d.messages.length) {
        for (var i = 0; i < d.messages.length; i++) {
          var m = d.messages[i];
          if (m.role === 'AGENT')     addBubble(m.content, 'sarah');
          else if (m.role === 'USER') addBubble(m.content, 'user');
        }
      } else {
        addBubble(FALLBACK, 'sarah');
      }
      // Don't badge the greeting — visitor just opened the panel
      unread = 0; badge.style.display = 'none';
    })
    .catch(function () {
      hideType();
      addBubble(FALLBACK, 'sarah');
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
