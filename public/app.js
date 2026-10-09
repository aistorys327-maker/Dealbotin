/**
 * public/app.js
 * Vanilla JavaScript application for the DealsBot India Admin Dashboard.
 * Works seamlessly on mobile touchscreens (380px+) and desktops.
 * Protects secrets: reads strictly from sessionStorage, communicates with Netlify Functions /api/*.
 */

(() => {
  // --- DOM Elements ---
  const loginScreen = document.getElementById('loginScreen');
  const dashboardScreen = document.getElementById('dashboardScreen');
  const topbarActions = document.getElementById('topbarActions');
  const loginForm = document.getElementById('loginForm');
  const adminPasswordInput = document.getElementById('adminPasswordInput');
  const loginError = document.getElementById('loginError');
  const btnLogin = document.getElementById('btnLogin');
  const btnLogout = document.getElementById('btnLogout');
  const btnRefresh = document.getElementById('btnRefresh');

  // Service pills
  const pillTelegram = document.getElementById('pillTelegram');
  const pillAmazon = document.getElementById('pillAmazon');
  const pillFlipkart = document.getElementById('pillFlipkart');
  const pillGemini = document.getElementById('pillGemini');
  const pillFacebook = document.getElementById('pillFacebook');

  // Quick actions
  const btnRunNow = document.getElementById('btnRunNow');
  const btnTestTelegram = document.getElementById('btnTestTelegram');

  // Metrics
  const metricLastRunStatus = document.getElementById('metricLastRunStatus');
  const metricLastRunTime = document.getElementById('metricLastRunTime');
  const metricTotalPosted = document.getElementById('metricTotalPosted');
  const metricLastPostTime = document.getElementById('metricLastPostTime');
  const metricMinDiscount = document.getElementById('metricMinDiscount');
  const metricQuietHours = document.getElementById('metricQuietHours');
  const metricCurrentIST = document.getElementById('metricCurrentIST');
  const countHistory = document.getElementById('countHistory');

  // Tabs
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabPanels = document.querySelectorAll('.tab-panel');

  // Settings
  const settingsForm = document.getElementById('settingsForm');
  const settingKeywords = document.getElementById('settingKeywords');
  const settingMinDiscount = document.getElementById('settingMinDiscount');
  const discountLabel = document.getElementById('discountLabel');
  const settingMaxPosts = document.getElementById('settingMaxPosts');
  const settingQuietEnabled = document.getElementById('settingQuietEnabled');
  const quietHoursInputs = document.getElementById('quietHoursInputs');
  const settingQuietStart = document.getElementById('settingQuietStart');
  const settingQuietEnd = document.getElementById('settingQuietEnd');
  const btnSaveSettings = document.getElementById('btnSaveSettings');

  // History & Logs
  const dealsContainer = document.getElementById('dealsContainer');
  const logsTerminal = document.getElementById('logsTerminal');
  const btnRefreshHistory = document.getElementById('btnRefreshHistory');
  const btnRefreshLogs = document.getElementById('btnRefreshLogs');

  // Modal & Toast
  const runModal = document.getElementById('runModal');
  const runModalTitle = document.getElementById('runModalTitle');
  const runModalDesc = document.getElementById('runModalDesc');
  const runModalContent = document.getElementById('runModalContent');
  const btnCloseModal = document.getElementById('btnCloseModal');
  const toast = document.getElementById('toast');

  // --- Session Storage State ---
  const STORAGE_KEY = 'deals_admin_password';

  function getPassword() {
    return sessionStorage.getItem(STORAGE_KEY) || '';
  }

  function setPassword(pwd) {
    sessionStorage.setItem(STORAGE_KEY, pwd);
  }

  function clearPassword() {
    sessionStorage.removeItem(STORAGE_KEY);
  }

  // --- Toast Helper ---
  let toastTimer = null;
  function showToast(message, type = 'info') {
    if (toastTimer) clearTimeout(toastTimer);
    toast.textContent = message;
    toast.className = `toast ${type}`;
    toast.style.display = 'flex';
    toastTimer = setTimeout(() => {
      toast.style.display = 'none';
    }, 3800);
  }

  // --- API Client ---
  async function apiFetch(endpoint, options = {}) {
    const pwd = getPassword();
    const headers = {
      'Content-Type': 'application/json',
      'x-admin-password': pwd,
      ...(options.headers || {})
    };

    try {
      const res = await fetch(`/api${endpoint}`, {
        ...options,
        headers
      });

      const data = await res.json().catch(() => ({}));

      if (res.status === 401) {
        clearPassword();
        showLogin();
        throw new Error(data.error || 'Invalid admin password. Please log in again.');
      }

      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}: ${res.statusText}`);
      }

      return data;
    } catch (err) {
      throw err;
    }
  }

  // --- Authentication Flow ---
  function showLogin(errorMsg = '') {
    loginScreen.style.display = 'flex';
    dashboardScreen.style.display = 'none';
    topbarActions.style.display = 'none';
    if (errorMsg) {
      loginError.textContent = errorMsg;
      loginError.style.display = 'block';
    } else {
      loginError.style.display = 'none';
    }
    adminPasswordInput.value = '';
    adminPasswordInput.focus();
  }

  function showDashboard() {
    loginScreen.style.display = 'none';
    dashboardScreen.style.display = 'block';
    topbarActions.style.display = 'flex';
    loadDashboardData();
  }

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pwd = adminPasswordInput.value.trim();
    if (!pwd) return;

    btnLogin.disabled = true;
    btnLogin.textContent = 'Verifying...';
    loginError.style.display = 'none';

    try {
      setPassword(pwd);
      const res = await apiFetch('/auth-check', { method: 'POST' });
      if (res.success) {
        showDashboard();
      }
    } catch (err) {
      clearPassword();
      loginError.textContent = err.message || 'Authentication failed';
      loginError.style.display = 'block';
    } finally {
      btnLogin.disabled = false;
      btnLogin.textContent = 'Unlock Dashboard';
    }
  });

  btnLogout.addEventListener('click', () => {
    clearPassword();
    showLogin('You have been logged out.');
  });

  btnRefresh.addEventListener('click', () => {
    loadDashboardData();
    showToast('Dashboard refreshed', 'success');
  });

  // --- Tab Switching ---
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabName = btn.dataset.tab;
      tabButtons.forEach(b => b.classList.toggle('active', b === btn));
      tabPanels.forEach(p => {
        p.classList.toggle('active', p.id === `tab${tabName.charAt(0).toUpperCase() + tabName.slice(1)}`);
      });

      if (tabName === 'history') loadHistory();
      if (tabName === 'logs') loadLogs();
    });
  });

  // --- Settings Form Slider Sync ---
  settingMinDiscount.addEventListener('input', (e) => {
    discountLabel.textContent = `${e.target.value}%`;
  });

  settingQuietEnabled.addEventListener('change', (e) => {
    quietHoursInputs.style.display = e.target.checked ? 'grid' : 'none';
  });

  settingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    btnSaveSettings.disabled = true;
    btnSaveSettings.textContent = 'Saving...';

    const keywords = settingKeywords.value
      .split(',')
      .map(k => k.trim())
      .filter(Boolean);

    const payload = {
      keywords,
      minDiscount: Number(settingMinDiscount.value),
      maxPostsPerRun: Number(settingMaxPosts.value),
      quietHours: {
        enabled: settingQuietEnabled.checked,
        startHourIST: Number(settingQuietStart.value),
        endHourIST: Number(settingQuietEnd.value)
      }
    };

    try {
      const res = await apiFetch('/settings', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      if (res.success) {
        showToast('Settings saved successfully in Netlify Blobs!', 'success');
        metricMinDiscount.textContent = `${payload.minDiscount}%`;
        metricQuietHours.textContent = payload.quietHours.enabled ? 'Active' : 'Off';
      }
    } catch (err) {
      showToast(`Error saving settings: ${err.message}`, 'error');
    } finally {
      btnSaveSettings.disabled = false;
      btnSaveSettings.textContent = '💾 Save Configuration';
    }
  });

  // --- Quick Actions: Run Deals Engine Now ---
  btnRunNow.addEventListener('click', async () => {
    runModal.style.display = 'flex';
    runModalTitle.innerHTML = `<span class="loading-spinner"></span> <span>Running Deals Engine...</span>`;
    runModalDesc.textContent = 'Fetching deals, checking deduplication, and broadcasting...';
    runModalContent.innerHTML = 'Connecting to deals APIs...\nBypassing quiet hours for manual admin trigger...';
    btnCloseModal.style.display = 'none';

    try {
      const res = await apiFetch('/run-now', { method: 'POST' });
      const result = res.result || {};

      let statusEmoji = '✅';
      if (result.status === 'ERROR') statusEmoji = '❌';
      if (result.status === 'WARNING') statusEmoji = '⚠️';

      runModalTitle.innerHTML = `<span>${statusEmoji} Engine Run Completed: ${result.status}</span>`;
      runModalDesc.textContent = `Completed in ${result.durationMs || 0}ms.`;

      let summaryHtml = `<b>Deals Found:</b> ${result.dealsFound || 0}\n` +
        `<b>Filtered Out:</b> ${result.dealsFiltered || 0}\n` +
        `<b>Deduplicated (48h):</b> ${result.dealsDeduplicated || 0}\n` +
        `<b>Broadcasted Deals:</b> ${result.dealsPosted || 0}\n\n`;

      if (result.errors && result.errors.length > 0) {
        summaryHtml += `<span style="color: #ef4444;"><b>Errors encountered:</b>\n- ${result.errors.join('\n- ')}</span>\n\n`;
      }

      if (result.logs && result.logs.length > 0) {
        summaryHtml += `<b>Execution Details:</b>\n${result.logs.slice(-8).join('\n')}`;
      }

      runModalContent.innerHTML = summaryHtml.replace(/\n/g, '<br/>');
      showToast(`Run complete: Posted ${result.dealsPosted || 0} deals`, 'success');
      loadDashboardData();
    } catch (err) {
      runModalTitle.innerHTML = `<span>❌ Engine Run Failed</span>`;
      runModalDesc.textContent = err.message;
      runModalContent.textContent = err.stack || err.message;
      showToast(`Run error: ${err.message}`, 'error');
    } finally {
      btnCloseModal.style.display = 'block';
    }
  });

  btnCloseModal.addEventListener('click', () => {
    runModal.style.display = 'none';
  });

  // --- Quick Actions: Test Telegram Channel ---
  btnTestTelegram.addEventListener('click', async () => {
    btnTestTelegram.disabled = true;
    btnTestTelegram.textContent = 'Sending Test...';

    try {
      const res = await apiFetch('/test-telegram', { method: 'POST' });
      if (res.success) {
        showToast('✅ Test message sent to your Telegram channel!', 'success');
      }
    } catch (err) {
      showToast(`Telegram test failed: ${err.message}`, 'error');
    } finally {
      btnTestTelegram.disabled = false;
      btnTestTelegram.innerHTML = '<span>📲 Test Telegram Channel</span>';
    }
  });

  btnRefreshHistory.addEventListener('click', loadHistory);
  btnRefreshLogs.addEventListener('click', loadLogs);

  // --- Load Full Dashboard Status & Settings ---
  async function loadDashboardData() {
    try {
      const [statusRes, settingsRes] = await Promise.all([
        apiFetch('/status'),
        apiFetch('/settings')
      ]);

      const status = statusRes.status || {};
      const settings = settingsRes.settings || {};

      // 1. Service health pills
      const svcs = status.configuredServices || {};
      updatePill(pillTelegram, svcs.telegram, 'Telegram Bot');
      updatePill(pillAmazon, svcs.amazon, 'Amazon PA-API');
      updatePill(pillFlipkart, svcs.flipkart, 'Flipkart/Shopsy');
      updatePill(pillGemini, svcs.gemini, 'Gemini AI');
      updatePill(pillFacebook, svcs.facebook, 'Facebook Page');

      // 2. Metrics
      if (status.lastRun) {
        metricLastRunStatus.textContent = status.lastRun.status || 'OK';
        metricLastRunStatus.style.color = status.lastRun.status === 'SUCCESS' ? '#34d399' : '#f87171';
        metricLastRunTime.textContent = timeAgo(status.lastRun.timestamp);
      } else {
        metricLastRunStatus.textContent = 'None';
        metricLastRunTime.textContent = 'Awaiting run';
      }

      metricTotalPosted.textContent = status.totalPostsRecorded || 0;
      countHistory.textContent = status.totalPostsRecorded || 0;
      metricLastPostTime.textContent = status.lastPostTime ? `Last: ${timeAgo(status.lastPostTime)}` : 'None yet';

      metricMinDiscount.textContent = `${settings.minDiscount || 40}%`;
      discountLabel.textContent = `${settings.minDiscount || 40}%`;
      settingMinDiscount.value = settings.minDiscount || 40;

      metricQuietHours.textContent = status.isQuietHourNow ? 'Active Now' : (settings.quietHours?.enabled ? 'Scheduled' : 'Off');
      metricCurrentIST.textContent = status.currentISTTime || '- IST';

      // 3. Settings form population
      if (Array.isArray(settings.keywords)) {
        settingKeywords.value = settings.keywords.join(', ');
      }
      settingMaxPosts.value = String(settings.maxPostsPerRun || 5);
      settingQuietEnabled.checked = Boolean(settings.quietHours?.enabled);
      quietHoursInputs.style.display = settingQuietEnabled.checked ? 'grid' : 'none';
      if (settings.quietHours) {
        settingQuietStart.value = String(settings.quietHours.startHourIST ?? 23);
        settingQuietEnd.value = String(settings.quietHours.endHourIST ?? 7);
      }
    } catch (err) {
      showToast(`Failed loading status: ${err.message}`, 'error');
    }
  }

  function updatePill(el, isActive, name) {
    if (!el) return;
    const dot = el.querySelector('.status-dot');
    if (dot) {
      dot.className = `status-dot ${isActive ? 'active' : 'inactive'}`;
    }
    el.title = `${name}: ${isActive ? 'Configured & Active' : 'Missing environment credentials'}`;
  }

  // --- Load Deals History ---
  async function loadHistory() {
    try {
      const res = await apiFetch('/history');
      const posts = res.history || [];
      countHistory.textContent = posts.length;

      if (posts.length === 0) {
        dealsContainer.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">📦</div>
            <p>No deals posted yet. Click <b>Run Deals Engine Now</b> to broadcast deals.</p>
          </div>
        `;
        return;
      }

      dealsContainer.innerHTML = posts.map(deal => {
        const storeClass = deal.source === 'amazon' ? 'amazon' : 'flipkart';
        const formattedPrice = `₹${Number(deal.price).toLocaleString('en-IN')}`;
        const formattedMrp = deal.mrp ? `₹${Number(deal.mrp).toLocaleString('en-IN')}` : '';

        return `
          <div class="deal-item">
            <img class="deal-thumb" src="${escapeHtml(deal.image)}" alt="Deal thumbnail" loading="lazy" onerror="this.src='https://via.placeholder.com/80?text=Deal'" />
            <div class="deal-info">
              <div>
                <div class="deal-title" title="${escapeHtml(deal.title)}">${escapeHtml(deal.title)}</div>
                <div class="deal-prices">
                  <span class="deal-price">${formattedPrice}</span>
                  ${formattedMrp ? `<span class="deal-mrp">${formattedMrp}</span>` : ''}
                  <span class="deal-badge">${deal.discount}% OFF</span>
                </div>
              </div>
              <div class="deal-meta">
                <span class="store-tag ${storeClass}">${deal.source}</span>
                <span>${timeAgo(deal.postedAt)}</span>
                <a href="${escapeHtml(deal.link)}" target="_blank" rel="noopener noreferrer" style="color: #38bdf8; font-weight: 600; text-decoration: none;">View Link ↗</a>
              </div>
            </div>
          </div>
        `;
      }).join('');
    } catch (err) {
      dealsContainer.innerHTML = `<div style="color: #f87171; padding: 1rem;">Failed to load history: ${err.message}</div>`;
    }
  }

  // --- Load Run Logs ---
  async function loadLogs() {
    try {
      const res = await apiFetch('/history');
      const logs = res.logs || [];

      if (logs.length === 0) {
        logsTerminal.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">📜</div>
            <p>No engine execution logs recorded yet.</p>
          </div>
        `;
        return;
      }

      logsTerminal.innerHTML = logs.map(log => {
        const statusClass = log.status || 'INFO';
        const timeStr = new Date(log.timestamp).toLocaleTimeString('en-IN', { hour12: false });
        const errorsCount = log.errors ? log.errors.length : 0;

        return `
          <div class="log-entry">
            <div class="log-header">
              <div>
                <span class="log-status ${statusClass}">${statusClass}</span>
                <span style="font-weight: 600; margin-left: 0.4rem;">${timeAgo(log.timestamp)}</span>
              </div>
              <span class="log-meta">${timeStr} (${log.durationMs || 0}ms)</span>
            </div>
            <div class="log-details">
              Found: ${log.dealsFound || 0} | Filtered: ${log.dealsFiltered || 0} | Deduplicated: ${log.dealsDeduplicated || 0} | Posted: <b>${log.dealsPosted || 0}</b>
              ${errorsCount > 0 ? `<br/><span style="color: #f87171;">Errors (${errorsCount}): ${log.errors.join('; ')}</span>` : ''}
            </div>
          </div>
        `;
      }).join('');
    } catch (err) {
      logsTerminal.innerHTML = `<div style="color: #f87171; padding: 1rem;">Failed to load logs: ${err.message}</div>`;
    }
  }

  // --- Utility Functions ---
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function timeAgo(dateString) {
    if (!dateString) return 'Never';
    const seconds = Math.floor((new Date() - new Date(dateString)) / 1000);
    if (seconds < 60) return `${Math.max(1, seconds)}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  // --- Auto-Initialize on Load ---
  window.addEventListener('DOMContentLoaded', () => {
    const saved = getPassword();
    if (saved) {
      apiFetch('/auth-check', { method: 'POST' })
        .then(() => showDashboard())
        .catch(() => showLogin());
    } else {
      showLogin();
    }
  });
})();
