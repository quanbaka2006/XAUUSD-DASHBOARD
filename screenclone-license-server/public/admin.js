(() => {
  const state = { token: sessionStorage.getItem('screenclone_admin_token') || '', customers: [], licenses: [] };
  const element = (id) => document.getElementById(id);
  const loginView = element('login-view');
  const dashboardView = element('dashboard-view');

  function showMessage(text, error = false, target = 'system-message') {
    const node = element(target);
    node.textContent = text;
    node.className = `message${error ? ' error' : ''}`;
    window.setTimeout(() => node.classList.add('hidden'), 6000);
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[character]));
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
        ...(options.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && path !== '/api/admin/login') logout();
      throw new Error(data.error || 'Yêu cầu không thành công.');
    }
    return data;
  }

  function logout() {
    state.token = '';
    sessionStorage.removeItem('screenclone_admin_token');
    dashboardView.classList.add('hidden');
    loginView.classList.remove('hidden');
    element('login-password').value = '';
  }

  async function loadDashboard() {
    const [customers, licenseData] = await Promise.all([
      api('/api/admin/customers'),
      api('/api/license/admin/licenses')
    ]);
    state.customers = customers.customers || [];
    state.licenses = licenseData.licenses || [];
    element('stat-customers').textContent = state.customers.length;
    element('stat-approved').textContent = state.licenses.reduce((sum, row) => sum + row.devices.filter((device) => device.status === 'approved').length, 0);
    element('stat-pending').textContent = state.licenses.reduce((sum, row) => sum + row.devices.filter((device) => device.status === 'pending').length, 0);
    element('stat-key').textContent = licenseData.signingKeyFingerprint ? `${licenseData.signingKeyFingerprint.slice(0, 8)}…` : 'Chưa cấu hình';
    renderCustomers();
  }

  function renderCustomers() {
    const query = element('search-input').value.trim().toLowerCase();
    const licenseMap = new Map(state.licenses.map((row) => [row.username, row]));
    const rows = state.customers.filter((customer) => {
      const license = licenseMap.get(customer.username);
      return !query || customer.username.includes(query) || customer.name.toLowerCase().includes(query)
        || (license && license.devices.some((device) => `${device.label} ${device.model}`.toLowerCase().includes(query)));
    });
    element('customer-list').innerHTML = rows.length ? rows.map((customer) => {
      const row = licenseMap.get(customer.username) || { license: {}, devices: [] };
      const license = row.license || {};
      const expiry = license.expiresAt ? new Date(license.expiresAt).toISOString().slice(0, 10) : '';
      const devices = row.devices || [];
      return `<article class="customer-card" data-username="${escapeHtml(customer.username)}">
        <div class="customer-head">
          <div><div class="customer-name">${escapeHtml(customer.name)} <span class="badge ${license.enabled ? '' : 'off'}">${license.enabled ? 'Được phép' : 'Đang khóa'}</span></div><div class="username">@${escapeHtml(customer.username)}</div></div>
          <div class="customer-actions"><button class="small neutral" data-action="password">Đổi mật khẩu</button><button class="small revoke" data-action="delete-customer">Xóa tài khoản</button></div>
        </div>
        <div class="license-grid">
          <label><span>Cho phép</span><select data-field="enabled"><option value="true" ${license.enabled ? 'selected' : ''}>Bật</option><option value="false" ${!license.enabled ? 'selected' : ''}>Khóa</option></select></label>
          <label><span>Số máy</span><input data-field="maxDevices" type="number" min="1" max="20" value="${Number(license.maxDevices || 1)}" /></label>
          <label><span>Offline</span><select data-field="offlineHours">${[1,3,6,12,24].map((hour) => `<option value="${hour}" ${Number(license.offlineHours || 12) === hour ? 'selected' : ''}>${hour} giờ</option>`).join('')}</select></label>
          <label><span>Hết hạn</span><input data-field="expiresAt" type="date" value="${expiry}" /></label>
          <button class="primary small" data-action="save-license">Lưu giấy phép</button>
        </div>
        <div class="device-list">${devices.length ? devices.map(deviceHtml).join('') : '<div class="empty">Chưa có iPhone gửi yêu cầu kích hoạt.</div>'}</div>
      </article>`;
    }).join('') : '<div class="empty">Không tìm thấy tài khoản.</div>';
  }

  function deviceHtml(device) {
    const actions = device.status === 'approved'
      ? '<button class="small revoke" data-device-action="revoke">Thu hồi</button>'
      : `<button class="small approve" data-device-action="approve">Duyệt</button>${device.status === 'revoked' ? '<button class="small neutral" data-device-action="pending">Chờ duyệt</button>' : ''}`;
    return `<div class="device" data-device-id="${escapeHtml(device.deviceId)}">
      <div class="device-main"><div class="device-title">${escapeHtml(device.label || device.model || 'iPhone')} · ${escapeHtml(device.status)}</div><div class="device-meta">${escapeHtml(device.model)} · iOS ${escapeHtml(device.iosVersion)} · v${escapeHtml(device.clientVersion)} · ${escapeHtml(device.deviceId.slice(0,16))}…</div></div>
      <div class="device-actions">${actions}<button class="small neutral" data-device-action="delete">Xóa liên kết</button></div>
    </div>`;
  }

  element('login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const data = await api('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({ username: element('login-username').value, password: element('login-password').value })
      });
      state.token = data.token;
      sessionStorage.setItem('screenclone_admin_token', state.token);
      loginView.classList.add('hidden');
      dashboardView.classList.remove('hidden');
      await loadDashboard();
    } catch (error) { showMessage(error.message, true, 'login-message'); }
  });

  element('create-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = element('create-username').value.trim().toLowerCase();
    try {
      await api('/api/admin/customers', { method: 'POST', body: JSON.stringify({ username, name: element('create-name').value, password: element('create-password').value }) });
      await api(`/api/license/admin/accounts/${encodeURIComponent(username)}`, {
        method: 'PUT',
        body: JSON.stringify({
          enabled: true,
          maxDevices: Number(element('create-max-devices').value),
          offlineHours: Number(element('create-offline-hours').value),
          expiresAt: element('create-expiry').value ? `${element('create-expiry').value}T23:59:59.999Z` : null
        })
      });
      event.target.reset();
      element('create-max-devices').value = '1';
      element('create-offline-hours').value = '12';
      showMessage(`Đã tạo và cấp phép cho ${username}.`);
      await loadDashboard();
    } catch (error) { showMessage(error.message, true); }
  });

  element('customer-list').addEventListener('click', async (event) => {
    const card = event.target.closest('.customer-card');
    const deviceNode = event.target.closest('.device');
    const action = event.target.dataset.action;
    const deviceAction = event.target.dataset.deviceAction;
    if (!card || (!action && !deviceAction)) return;
    const username = card.dataset.username;
    try {
      if (action === 'save-license') {
        const field = (name) => card.querySelector(`[data-field="${name}"]`).value;
        await api(`/api/license/admin/accounts/${encodeURIComponent(username)}`, { method: 'PUT', body: JSON.stringify({
          enabled: field('enabled') === 'true', maxDevices: Number(field('maxDevices')), offlineHours: Number(field('offlineHours')),
          expiresAt: field('expiresAt') ? `${field('expiresAt')}T23:59:59.999Z` : null
        }) });
        showMessage(`Đã cập nhật giấy phép ${username}.`);
      } else if (action === 'password') {
        const password = window.prompt(`Mật khẩu mới cho ${username} (ít nhất 12 ký tự):`);
        if (!password) return;
        await api(`/api/admin/customers/${encodeURIComponent(username)}`, { method: 'PUT', body: JSON.stringify({ password }) });
        showMessage('Đã đổi mật khẩu khách hàng.');
      } else if (action === 'delete-customer') {
        if (!window.confirm(`Xóa tài khoản ${username} cùng mọi liên kết thiết bị?`)) return;
        await api(`/api/admin/customers/${encodeURIComponent(username)}`, { method: 'DELETE' });
        showMessage(`Đã xóa ${username}.`);
      } else if (deviceAction) {
        const deviceId = deviceNode.dataset.deviceId;
        if ((deviceAction === 'revoke' || deviceAction === 'delete') && !window.confirm('Xác nhận thay đổi quyền thiết bị này?')) return;
        await api(`/api/license/admin/devices/${deviceId}${deviceAction === 'delete' ? '' : `/${deviceAction}`}`, { method: deviceAction === 'delete' ? 'DELETE' : 'POST' });
        showMessage('Đã cập nhật thiết bị.');
      }
      await loadDashboard();
    } catch (error) { showMessage(error.message, true); }
  });

  element('search-input').addEventListener('input', renderCustomers);
  element('refresh-button').addEventListener('click', () => loadDashboard().catch((error) => showMessage(error.message, true)));
  element('logout-button').addEventListener('click', logout);

  if (state.token) {
    api('/api/admin/me').then(() => {
      loginView.classList.add('hidden');
      dashboardView.classList.remove('hidden');
      return loadDashboard();
    }).catch(logout);
  }
})();
