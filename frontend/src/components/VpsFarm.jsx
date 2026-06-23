import React, { useState, useEffect } from 'react';
import { 
  Server, 
  Cpu, 
  HardDrive, 
  Zap, 
  Play, 
  Square, 
  ShieldAlert, 
  RefreshCw, 
  Plus, 
  Trash2, 
  Wifi, 
  WifiOff, 
  CheckCircle, 
  AlertTriangle 
} from 'lucide-react';
import { useTranslation } from '../utils/translations';
import { useTradeStore } from '../store/useTradeStore';

export function VpsFarm() {
  const { t } = useTranslation();
  const { fetchMt5Accounts, mt5Accounts } = useTradeStore();

  const [vpsStatus, setVpsStatus] = useState(null);
  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  // Form states for quick connection
  const [name, setName] = useState('');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [server, setServer] = useState('');
  const [riskType, setRiskType] = useState('multiplier');
  const [riskValue, setRiskValue] = useState('0.5');

  // Fetch telemetry and slots
  const fetchData = async () => {
    setLoading(true);
    setError(null);
    const token = localStorage.getItem('auth_token');
    try {
      // 1. Fetch system resources
      const vpsRes = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/v1/vps/status`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (vpsRes.ok) {
        const data = await vpsRes.json();
        if (data.success) setVpsStatus(data.resources);
      }

      // 2. Fetch slots status
      const slotsRes = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/v1/vps/slots`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (slotsRes.ok) {
        const data = await slotsRes.json();
        if (data.success) setSlots(data.slots || []);
      }
    } catch (err) {
      console.error('[VPS Farm] Fetch error:', err);
      setError('Không thể kết nối đến máy chủ API VPS.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 8000); // refresh every 8s
    return () => clearInterval(interval);
  }, []);

  const handleStartSlot = async (login) => {
    setSuccess(null);
    setError(null);
    const token = localStorage.getItem('auth_token');
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/v1/vps/slots/start`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ login })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSuccess(data.message);
        fetchData();
      } else {
        setError(data.error || 'Khởi chạy máy chủ ảo thất bại.');
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handleStopSlot = async (login) => {
    setSuccess(null);
    setError(null);
    const token = localStorage.getItem('auth_token');
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/v1/vps/slots/stop`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ login })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSuccess(data.message);
        fetchData();
      } else {
        setError(data.error || 'Dừng máy chủ ảo thất bại.');
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handleKillAll = async () => {
    if (!window.confirm('CẢNH BÁO CỰC KỲ NGUY HIỂM!\nHành động này sẽ ĐÓNG TOÀN BỘ vị thế đang mở và dừng tất cả robot MT5 local ngay lập tức.\nBạn có chắc chắn muốn kích hoạt nút Tắt Khẩn Cấp không?')) {
      return;
    }
    
    setSuccess(null);
    setError(null);
    const token = localStorage.getItem('auth_token');
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/v1/vps/slots/kill-all`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSuccess(data.message);
        fetchData();
      } else {
        setError(data.error || 'Thực thi nút tắt khẩn cấp thất bại.');
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handleConnect = async (e) => {
    e.preventDefault();
    if (!login || !password || !server) return;
    setSuccess(null);
    setError(null);

    const token = localStorage.getItem('auth_token');
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/v1/accounts/connect`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          name: name || `MT5 - ${login}`,
          login: parseInt(login, 10),
          password,
          server,
          useVpsFarm: true,
          riskConfig: {
            mode: riskType,
            value: parseFloat(riskValue)
          }
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSuccess('Đã thêm tài khoản mới vào VPS Farm thành công! Hãy bấm khởi chạy (Start) để bắt đầu.');
        setName('');
        setLogin('');
        setPassword('');
        setServer('');
        fetchData();
      } else {
        setError(data.error || 'Lỗi thêm tài khoản.');
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDeleteAccount = async (id, accountName) => {
    if (!window.confirm(`Bạn có chắc chắn muốn ngắt kết nối và xóa tài khoản "${accountName}" khỏi VPS Farm?`)) {
      return;
    }
    setSuccess(null);
    setError(null);
    const token = localStorage.getItem('auth_token');
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/v1/accounts/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok) {
        setSuccess('Đã xóa tài khoản khỏi VPS Farm.');
        fetchData();
      } else {
        setError(data.error || 'Lỗi xóa tài khoản.');
      }
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="w-full flex flex-col gap-6 text-slate-100 font-sans">
      {/* PAGE HEADER */}
      <div className="panel-primary flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 p-5 rounded-2xl relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-amber-500/25 to-transparent" />
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500">
            <Server className="h-5 w-5 animate-pulse" />
          </div>
          <div className="text-left">
            <span className="text-xs font-black text-amber-500 uppercase tracking-widest block">PORTABLE VM POOL</span>
            <h2 className="text-xl font-black text-white uppercase mt-0.5 tracking-tight">MT5 VPS Farm Control Center</h2>
          </div>
        </div>
        <p className="text-xs text-slate-400 max-w-sm text-left sm:text-right font-medium leading-relaxed">
          Quản lý trực tiếp các tiến trình MT5 chạy ngầm trên VPS của bạn mà không thông qua MetaApi cloud. Giảm chi phí $9/tài khoản về 0$.
        </p>
      </div>

      {/* EMERGENCY KILL SWITCH HUB */}
      <div className="panel-primary p-6 rounded-2xl relative overflow-hidden bg-red-950/20 border border-red-500/30 flex flex-col md:flex-row items-center justify-between gap-6 shadow-[0_0_40px_rgba(239,68,68,0.06)]">
        <div className="absolute top-0 left-0 bottom-0 w-1.5 bg-red-500" />
        <div className="text-left flex-1 space-y-1">
          <h3 className="text-base font-black text-red-500 uppercase tracking-wider flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 animate-bounce" />
            Nút Tắt Khẩn Cấp (Emergency Kill Switch)
          </h3>
          <p className="text-xs text-slate-300 font-medium leading-relaxed max-w-2xl">
            Khi thị trường có biến động mạnh ngoài dự kiến hoặc xảy ra sự cố kỹ thuật, bấm nút bên phải để kích hoạt tắt khẩn cấp. 
            Hệ thống sẽ ngay lập tức gửi tín hiệu đóng toàn bộ lệnh đang chạy và tắt sạch máy chủ ảo MT5 để bảo vệ vốn.
          </p>
        </div>
        <button
          onClick={handleKillAll}
          className="px-6 py-4 bg-red-600 hover:bg-red-700 active:scale-95 text-white font-black rounded-xl text-xs uppercase tracking-widest transition-all duration-300 shadow-[0_0_20px_rgba(239,68,68,0.4)] hover:shadow-[0_0_35px_rgba(239,68,68,0.6)] cursor-pointer shrink-0 border border-red-400/20"
        >
          🚨 Kích hoạt Kill Switch 🚨
        </button>
      </div>

      {/* FEEDBACK MESSAGES */}
      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-xs font-bold font-sans flex items-start gap-3 text-left">
          <AlertTriangle className="h-5 w-5 text-red-500 shrink-0" />
          <div>
            <span className="font-black block uppercase text-[10px] tracking-wider mb-0.5 text-red-500">LỖI THỰC THI</span>
            {error}
          </div>
        </div>
      )}
      {success && (
        <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl text-xs font-bold font-sans flex items-start gap-3 text-left">
          <CheckCircle className="h-5 w-5 text-emerald-500 shrink-0" />
          <div>
            <span className="font-black block uppercase text-[10px] tracking-wider mb-0.5 text-emerald-500">THÀNH CÔNG</span>
            {success}
          </div>
        </div>
      )}

      {/* METRICS & SYSTEM RESOURCE TELEMETRY */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
        {/* CPU TELEMETRY */}
        <div className="panel-primary p-5 rounded-2xl relative flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest block">TELEMETRY</span>
            <h4 className="text-sm font-black text-white uppercase tracking-tight">CPU Server Load</h4>
            <div className="text-2xl font-black text-amber-500 font-mono mt-1">
              {vpsStatus ? `${vpsStatus.cpu}%` : '-- %'}
            </div>
          </div>
          <div className="h-12 w-12 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500">
            <Cpu className="h-6 w-6" />
          </div>
          {/* Progress Line */}
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/[0.04]">
            <div 
              className="h-full bg-amber-500 transition-all duration-500" 
              style={{ width: `${vpsStatus ? vpsStatus.cpu : 0}%` }}
            />
          </div>
        </div>

        {/* RAM TELEMETRY */}
        <div className="panel-primary p-5 rounded-2xl relative flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest block">TELEMETRY</span>
            <h4 className="text-sm font-black text-white uppercase tracking-tight">RAM Server Memory</h4>
            <div className="text-2xl font-black text-sky-500 font-mono mt-1">
              {vpsStatus ? `${vpsStatus.ram}%` : '-- %'}
            </div>
            <span className="text-[10px] text-slate-400 block font-medium">
              {vpsStatus ? `Sử dụng ${vpsStatus.totalRamGb - vpsStatus.freeRamGb}GB / ${vpsStatus.totalRamGb}GB` : 'N/A'}
            </span>
          </div>
          <div className="h-12 w-12 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-500">
            <HardDrive className="h-6 w-6" />
          </div>
          {/* Progress Line */}
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/[0.04]">
            <div 
              className="h-full bg-sky-500 transition-all duration-500" 
              style={{ width: `${vpsStatus ? vpsStatus.ram : 0}%` }}
            />
          </div>
        </div>

        {/* ACTIVE CONNECTIONS & SLOTS */}
        <div className="panel-primary p-5 rounded-2xl relative flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest block">COMMUNICATION</span>
            <h4 className="text-sm font-black text-white uppercase tracking-tight">Active Client Slots</h4>
            <div className="text-2xl font-black text-emerald-500 font-mono mt-1">
              {slots.filter(s => s.connected).length} / {slots.length}
            </div>
            <span className="text-[10px] text-slate-400 block font-medium">
              Cổng socket TCP: <strong className="text-white font-mono">7788</strong> (Hoạt động)
            </span>
          </div>
          <div className="h-12 w-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-500">
            <Zap className="h-6 w-6" />
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/[0.04]">
            <div 
              className="h-full bg-emerald-500 transition-all duration-500" 
              style={{ width: `${slots.length > 0 ? (slots.filter(s => s.connected).length / slots.length) * 100 : 0}%` }}
            />
          </div>
        </div>
      </div>

      {/* CORE CONTROL AREA */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start text-left">
        
        {/* LEFT COLUMN: ACTIVE SLOTS MONITOR */}
        <div className="lg:col-span-8 space-y-6">
          <div className="panel-primary p-6 rounded-2xl relative flex flex-col gap-4">
            <div className="absolute top-0 left-0 right-0 h-[1.5px] bg-gradient-to-r from-transparent via-amber-500/20 to-transparent" />
            <div className="flex items-center justify-between pb-3 border-b border-white/[0.04]">
              <h3 className="text-sm font-black text-white uppercase tracking-tight">Bảng kiểm soát tiến trình MT5 (Slots Pool)</h3>
              <button 
                onClick={fetchData} 
                disabled={loading}
                className="p-2 rounded-lg bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.08] text-slate-400 hover:text-white transition-all cursor-pointer"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin text-amber-500' : ''}`} />
              </button>
            </div>

            {slots.length === 0 ? (
              <div className="py-10 text-center text-slate-500 text-xs font-bold">
                Chưa có tài khoản nào được kết nối với VPS Farm. Vui lòng cấu hình tài khoản ở ô bên phải.
              </div>
            ) : (
              <div className="overflow-x-auto w-full">
                <table className="w-full text-xs font-sans">
                  <thead>
                    <tr className="border-b border-white/[0.06] text-slate-400 font-bold uppercase tracking-wider text-[10px] text-left">
                      <th className="py-3 px-2">Tài khoản (Login)</th>
                      <th className="py-3 px-2">Server / Tên</th>
                      <th className="py-3 px-2">Rủi ro (Risk)</th>
                      <th className="py-3 px-2">Bản local (Process)</th>
                      <th className="py-3 px-2">Truyền lệnh (Socket)</th>
                      <th className="py-3 px-2 text-right">Điều khiển</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.03]">
                    {slots.map(slot => (
                      <tr key={slot.login} className="hover:bg-white/[0.01] transition-colors">
                        <td className="py-4 px-2 font-mono font-bold text-white">{slot.login}</td>
                        <td className="py-4 px-2">
                          <div className="font-bold text-slate-200">{slot.name}</div>
                          <div className="text-[10px] text-slate-500 font-mono mt-0.5">{slot.server}</div>
                        </td>
                        <td className="py-4 px-2">
                          <span className="px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/[0.07] font-bold text-amber-500 uppercase text-[9px] tracking-wider">
                            {slot.riskConfig?.mode === 'fixed' ? `${slot.riskConfig.value} Fixed Lot` : `x${slot.riskConfig?.value} Mult`}
                          </span>
                        </td>
                        <td className="py-4 px-2">
                          {slot.running ? (
                            <span className="flex items-center gap-1.5 text-emerald-400 font-bold">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-ping" />
                              Running (PID: {slot.pid})
                            </span>
                          ) : (
                            <span className="flex items-center gap-1.5 text-slate-500 font-bold">
                              <span className="h-1.5 w-1.5 rounded-full bg-slate-600" />
                              Stopped
                            </span>
                          )}
                        </td>
                        <td className="py-4 px-2">
                          {slot.connected ? (
                            <span className="flex items-center gap-1.5 text-sky-400 font-bold">
                              <Wifi className="h-3.5 w-3.5 text-sky-400 animate-pulse" />
                              Connected
                            </span>
                          ) : (
                            <span className="flex items-center gap-1.5 text-slate-500 font-bold">
                              <WifiOff className="h-3.5 w-3.5 text-slate-500" />
                              Offline
                            </span>
                          )}
                        </td>
                        <td className="py-4 px-2 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {slot.running ? (
                              <button
                                onClick={() => handleStopSlot(slot.login)}
                                className="p-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 hover:border-red-500/40 text-red-400 rounded-lg transition-all cursor-pointer flex items-center justify-center"
                                title="Dừng terminal"
                              >
                                <Square className="h-3.5 w-3.5 fill-red-400" />
                              </button>
                            ) : (
                              <button
                                onClick={() => handleStartSlot(slot.login)}
                                className="p-2 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 hover:border-emerald-500/40 text-emerald-400 rounded-lg transition-all cursor-pointer flex items-center justify-center"
                                title="Khởi chạy terminal"
                              >
                                <Play className="h-3.5 w-3.5 fill-emerald-400" />
                              </button>
                            )}
                            <button
                              onClick={() => handleDeleteAccount(slot.id, slot.name)}
                              className="p-2 bg-white/[0.02] hover:bg-red-500/10 border border-white/[0.06] hover:border-red-500/20 text-slate-400 hover:text-red-400 rounded-lg transition-all cursor-pointer flex items-center justify-center"
                              title="Xóa tài khoản khỏi VPS"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: QUICK CONNECT ACCOUNT FORM */}
        <div className="lg:col-span-4 space-y-6">
          <div className="panel-primary p-6 rounded-2xl relative flex flex-col gap-4">
            <div className="absolute top-0 left-0 right-0 h-[1.5px] bg-gradient-to-r from-transparent via-amber-500/20 to-transparent" />
            <div className="flex items-center gap-2.5 pb-3 border-b border-white/[0.04]">
              <div className="h-9 w-9 rounded-xl bg-amber-500/10 flex items-center justify-center border border-amber-500/25 text-amber-500">
                <Plus className="h-5 w-5" />
              </div>
              <div>
                <div className="text-xs font-black tracking-widest text-slate-500 uppercase">ADD TO VPS FARM</div>
                <h3 className="text-sm font-black text-white uppercase tracking-tight">Thêm tài khoản MT5</h3>
              </div>
            </div>

            <form onSubmit={handleConnect} className="space-y-4" autoComplete="off">
              <div className="space-y-1.5 text-left">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Tên gợi nhớ</label>
                <input 
                  type="text" 
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. VPS Account 1" 
                  className="w-full bg-white/[0.03] border border-white/[0.06] rounded-xl px-4 py-2.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/40 transition-colors"
                  autoComplete="off"
                />
              </div>

              <div className="space-y-1.5 text-left">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Số tài khoản (Login ID) *</label>
                <input 
                  type="number" 
                  required
                  value={login}
                  onChange={(e) => setLogin(e.target.value)}
                  placeholder="e.g. 5012345" 
                  className="w-full bg-white/[0.03] border border-white/[0.06] rounded-xl px-4 py-2.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/40 transition-colors font-mono"
                  autoComplete="off"
                />
              </div>

              <div className="space-y-1.5 text-left">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Mật khẩu giao dịch *</label>
                <input 
                  type="password" 
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Mật khẩu tài khoản MT5" 
                  className="w-full bg-white/[0.03] border border-white/[0.06] rounded-xl px-4 py-2.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/40 transition-colors"
                  autoComplete="new-password"
                />
              </div>

              <div className="space-y-1.5 text-left">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Tên máy chủ (Server) *</label>
                <input 
                  type="text" 
                  required
                  value={server}
                  onChange={(e) => setServer(e.target.value)}
                  placeholder="e.g. Exness-MT5Trial6" 
                  className="w-full bg-white/[0.03] border border-white/[0.06] rounded-xl px-4 py-2.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/40 transition-colors font-mono"
                  autoComplete="off"
                />
              </div>

              {/* RISK CONFIG */}
              <div className="grid grid-cols-2 gap-4 text-left">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Chế độ rủi ro</label>
                  <select 
                    value={riskType} 
                    onChange={(e) => setRiskType(e.target.value)}
                    className="w-full bg-[#060914] border border-white/[0.06] rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-amber-500/40"
                  >
                    <option value="multiplier">Hệ số lot (Mult)</option>
                    <option value="fixed">Lot cố định (Fixed)</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Giá trị cấu hình</label>
                  <input 
                    type="number" 
                    step="0.01" 
                    min="0.01"
                    max="10.0"
                    required
                    value={riskValue}
                    onChange={(e) => setRiskValue(e.target.value)}
                    placeholder="e.g. 0.5" 
                    className="w-full bg-white/[0.03] border border-white/[0.06] rounded-xl px-4 py-2.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/40 transition-colors font-mono"
                  />
                </div>
              </div>

              <button 
                type="submit"
                className="w-full bg-amber-500 hover:bg-amber-600 active:scale-[0.98] text-[#040406] font-black py-3 rounded-xl text-xs uppercase tracking-widest transition-all duration-300 shadow-[0_0_15px_rgba(234,179,8,0.15)] flex items-center justify-center gap-2 cursor-pointer mt-2"
              >
                <Plus className="h-4 w-4" />
                <span>Thêm tài khoản</span>
              </button>
            </form>
          </div>
        </div>

      </div>
    </div>
  );
}
