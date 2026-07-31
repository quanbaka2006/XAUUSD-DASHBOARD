import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  KeyRound,
  Loader2,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  ShieldOff,
  Smartphone,
  Trash2,
  XCircle
} from 'lucide-react';
import { SOCKET_URL } from '../store/useTradeStore';

const authHeaders = () => ({
  Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}`,
  'Content-Type': 'application/json'
});

const dateInputValue = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
};

const statusStyle = {
  approved: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  pending: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  revoked: 'border-rose-500/30 bg-rose-500/10 text-rose-300'
};

const statusLabel = {
  approved: 'Đã duyệt',
  pending: 'Chờ duyệt',
  revoked: 'Đã khóa'
};

export function ScreenCloneLicensePanel() {
  const [licenses, setLicenses] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [configured, setConfigured] = useState(true);
  const [fingerprint, setFingerprint] = useState('');
  const [minimumVersion, setMinimumVersion] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState('');
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState(null);

  const request = useCallback(async (path, options = {}) => {
    const response = await fetch(`${SOCKET_URL}/api/screenclone${path}`, {
      ...options,
      headers: { ...authHeaders(), ...(options.headers || {}) }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Yêu cầu không thành công.');
    return data;
  }, []);

  const fetchLicenses = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const data = await request('/admin/licenses');
      const rows = data.licenses || [];
      setLicenses(rows);
      setConfigured(Boolean(data.configured));
      setFingerprint(data.signingKeyFingerprint || '');
      setMinimumVersion(data.minimumClientVersion || '');
      setDrafts(Object.fromEntries(rows.map((row) => [row.username, {
        enabled: Boolean(row.license?.enabled),
        maxDevices: row.license?.maxDevices || 1,
        offlineHours: row.license?.offlineHours || 12,
        expiresAt: dateInputValue(row.license?.expiresAt)
      }])));
    } catch (error) {
      setMessage({ type: 'error', text: error.message });
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    fetchLicenses();
  }, [fetchLicenses]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return licenses;
    return licenses.filter((row) => row.username.includes(needle)
      || String(row.name || '').toLowerCase().includes(needle)
      || row.devices.some((device) => String(device.label || device.model || '').toLowerCase().includes(needle)));
  }, [licenses, query]);

  const changeDraft = (username, patch) => {
    setDrafts((current) => ({
      ...current,
      [username]: { ...current[username], ...patch }
    }));
  };

  const saveLicense = async (username) => {
    const key = `license:${username}`;
    setBusyKey(key);
    setMessage(null);
    try {
      const draft = drafts[username];
      await request(`/admin/accounts/${encodeURIComponent(username)}`, {
        method: 'PUT',
        body: JSON.stringify({
          ...draft,
          expiresAt: draft.expiresAt ? new Date(`${draft.expiresAt}T23:59:59.999Z`).toISOString() : null
        })
      });
      setMessage({ type: 'success', text: `Đã cập nhật giấy phép cho ${username}. Các phiên cũ đã bị thay thế.` });
      await fetchLicenses(true);
    } catch (error) {
      setMessage({ type: 'error', text: error.message });
    } finally {
      setBusyKey('');
    }
  };

  const deviceAction = async (device, action) => {
    const key = `${action}:${device.deviceId}`;
    const destructive = action === 'revoke' || action === 'delete';
    if (destructive && !window.confirm(
      action === 'delete'
        ? `Xóa liên kết thiết bị ${device.label || device.model || device.deviceId.slice(0, 12)}?`
        : `Thu hồi quyền của thiết bị ${device.label || device.model || device.deviceId.slice(0, 12)}?`
    )) return;

    setBusyKey(key);
    setMessage(null);
    try {
      await request(`/admin/devices/${device.deviceId}${action === 'delete' ? '' : `/${action}`}`, {
        method: action === 'delete' ? 'DELETE' : 'POST'
      });
      setMessage({ type: 'success', text: 'Đã cập nhật trạng thái thiết bị.' });
      await fetchLicenses(true);
    } catch (error) {
      setMessage({ type: 'error', text: error.message });
    } finally {
      setBusyKey('');
    }
  };

  return (
    <section className="rounded-2xl border border-cyan-500/20 bg-slate-950/55 p-4 sm:p-5 shadow-xl shadow-cyan-950/10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-xl border border-cyan-400/20 bg-cyan-500/10 p-2.5 text-cyan-300">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white">Bản quyền ScreenClone</h2>
            <p className="mt-1 text-xs text-slate-400">
              Quản lý quyền tài khoản, số máy, thời hạn offline và thu hồi thiết bị.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => fetchLicenses()}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-cyan-500/40 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Làm mới
        </button>
      </div>

      {!configured && (
        <div className="mt-4 flex gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
          <ShieldOff className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <strong>Máy chủ đang khóa an toàn.</strong>
            <p className="mt-1 text-xs text-rose-200/80">
              Chưa cấu hình khóa ký hoặc token pepper; mọi yêu cầu kích hoạt sẽ bị từ chối.
            </p>
          </div>
        </div>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
          <div className="text-[11px] uppercase tracking-wider text-slate-500">Tài khoản</div>
          <div className="mt-1 text-xl font-bold text-white">{licenses.length}</div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
          <div className="text-[11px] uppercase tracking-wider text-slate-500">Thiết bị đã duyệt</div>
          <div className="mt-1 text-xl font-bold text-emerald-300">
            {licenses.reduce((sum, row) => sum + row.devices.filter((device) => device.status === 'approved').length, 0)}
          </div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
          <div className="text-[11px] uppercase tracking-wider text-slate-500">Client tối thiểu</div>
          <div className="mt-1 text-xl font-bold text-cyan-300">{minimumVersion || '—'}</div>
        </div>
      </div>

      {fingerprint && (
        <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-500">
          <KeyRound className="h-3.5 w-3.5" />
          Khóa ký: <code className="select-all text-slate-400">{fingerprint.slice(0, 16)}…</code>
        </div>
      )}

      {message && (
        <div className={`mt-4 rounded-xl border px-3 py-2 text-sm ${
          message.type === 'error'
            ? 'border-rose-500/30 bg-rose-500/10 text-rose-200'
            : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
        }`}>
          {message.text}
        </div>
      )}

      <div className="relative mt-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Tìm tài khoản hoặc thiết bị…"
          className="w-full rounded-xl border border-slate-800 bg-slate-950 py-2.5 pl-10 pr-3 text-sm text-white outline-none focus:border-cyan-500/50"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin" /> Đang tải giấy phép…
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {filtered.map((row) => {
            const draft = drafts[row.username] || {};
            const approvedCount = row.devices.filter((device) => device.status === 'approved').length;
            return (
              <article key={row.username} className="rounded-xl border border-slate-800 bg-slate-900/55 p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-white">{row.name}</span>
                      <span className="rounded-md bg-slate-800 px-2 py-0.5 text-xs text-slate-400">@{row.username}</span>
                      <span className={`rounded-md border px-2 py-0.5 text-xs ${
                        draft.enabled
                          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                          : 'border-slate-700 bg-slate-800 text-slate-400'
                      }`}>
                        {draft.enabled ? 'Được cấp phép' : 'Đang khóa'}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-slate-500">{approvedCount}/{draft.maxDevices || 1} thiết bị đang hoạt động</div>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[auto_90px_100px_150px_auto]">
                    <label className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 text-xs text-slate-300">
                      <input
                        type="checkbox"
                        checked={Boolean(draft.enabled)}
                        onChange={(event) => changeDraft(row.username, { enabled: event.target.checked })}
                        className="accent-cyan-500"
                      />
                      Cho phép
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="20"
                      title="Số thiết bị tối đa"
                      value={draft.maxDevices || 1}
                      onChange={(event) => changeDraft(row.username, { maxDevices: Number(event.target.value) })}
                      className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-2 text-xs text-white outline-none focus:border-cyan-500/50"
                    />
                    <select
                      title="Thời gian dùng khi mất mạng"
                      value={draft.offlineHours || 12}
                      onChange={(event) => changeDraft(row.username, { offlineHours: Number(event.target.value) })}
                      className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-2 text-xs text-white outline-none focus:border-cyan-500/50"
                    >
                      <option value="1">Offline 1h</option>
                      <option value="3">Offline 3h</option>
                      <option value="6">Offline 6h</option>
                      <option value="12">Offline 12h</option>
                      <option value="24">Offline 24h</option>
                    </select>
                    <input
                      type="date"
                      title="Ngày hết hạn giấy phép"
                      value={draft.expiresAt || ''}
                      onChange={(event) => changeDraft(row.username, { expiresAt: event.target.value })}
                      className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-2 text-xs text-white outline-none focus:border-cyan-500/50"
                    />
                    <button
                      type="button"
                      onClick={() => saveLicense(row.username)}
                      disabled={busyKey === `license:${row.username}`}
                      className="inline-flex items-center justify-center gap-2 rounded-lg bg-cyan-600 px-3 py-2 text-xs font-bold text-white hover:bg-cyan-500 disabled:opacity-50"
                    >
                      {busyKey === `license:${row.username}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      Lưu
                    </button>
                  </div>
                </div>

                <div className="mt-3 space-y-2">
                  {row.devices.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-slate-800 px-3 py-3 text-xs text-slate-500">
                      Chưa có iPhone nào gửi yêu cầu kích hoạt.
                    </div>
                  ) : row.devices.map((device) => (
                    <div key={device.deviceId} className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-950/60 p-3 md:flex-row md:items-center md:justify-between">
                      <div className="flex min-w-0 items-start gap-3">
                        <Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate text-sm font-medium text-slate-200">{device.label || device.model || 'iPhone'}</span>
                            <span className={`rounded-md border px-2 py-0.5 text-[11px] ${statusStyle[device.status] || statusStyle.pending}`}>
                              {statusLabel[device.status] || device.status}
                            </span>
                          </div>
                          <div className="mt-1 break-all text-[11px] text-slate-500">
                            {device.model || 'Không rõ model'} · iOS {device.iosVersion || '?'} · v{device.clientVersion || '?'} · {device.deviceId.slice(0, 16)}…
                          </div>
                          <div className="mt-1 text-[11px] text-slate-600">
                            Lần cuối: {device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString('vi-VN') : 'Chưa có'}
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {device.status !== 'approved' && (
                          <button
                            type="button"
                            onClick={() => deviceAction(device, 'approve')}
                            disabled={busyKey === `approve:${device.deviceId}`}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-xs text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" /> Duyệt
                          </button>
                        )}
                        {device.status === 'approved' && (
                          <button
                            type="button"
                            onClick={() => deviceAction(device, 'revoke')}
                            disabled={busyKey === `revoke:${device.deviceId}`}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1.5 text-xs text-rose-300 hover:bg-rose-500/20 disabled:opacity-50"
                          >
                            <XCircle className="h-3.5 w-3.5" /> Thu hồi
                          </button>
                        )}
                        {device.status === 'revoked' && (
                          <button
                            type="button"
                            onClick={() => deviceAction(device, 'pending')}
                            disabled={busyKey === `pending:${device.deviceId}`}
                            className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-300 hover:bg-amber-500/20 disabled:opacity-50"
                          >
                            Chuyển chờ duyệt
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => deviceAction(device, 'delete')}
                          disabled={busyKey === `delete:${device.deviceId}`}
                          className="rounded-lg border border-slate-700 bg-slate-900 p-1.5 text-slate-400 hover:border-rose-500/30 hover:text-rose-300 disabled:opacity-50"
                          title="Xóa liên kết thiết bị"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
