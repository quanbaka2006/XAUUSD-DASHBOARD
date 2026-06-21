import React, { useState, useEffect } from 'react';
import { 
  Zap, 
  Trash2, 
  Sliders, 
  Send, 
  AlertCircle, 
  CheckCircle, 
  RefreshCw, 
  Info,
  Server,
  User,
  Lock,
  Edit,
  Shield,
  HelpCircle,
  Eye,
  EyeOff
} from 'lucide-react';
import { useTradeStore } from '../store/useTradeStore';
import { useTranslation } from '../utils/translations';

export function AutoTrade() {
  const { t } = useTranslation();
  const {
    user,
    mt5Accounts,
    mt5Loading,
    mt5Error,
    mt5Success,
    fetchMt5Accounts,
    connectMt5Account,
    disconnectMt5Account,
    updateMt5Risk,
    clearMt5Messages
  } = useTradeStore();

  // New connection form state
  const [name, setName] = useState('');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [server, setServer] = useState('');
  const [riskType, setRiskType] = useState('multiplier');
  const [riskValue, setRiskValue] = useState('1.0');
  const [showPassword, setShowPassword] = useState(false);

  // Edit risk state
  const [editingId, setEditingId] = useState(null);
  const [editRiskType, setEditRiskType] = useState('multiplier');
  const [editRiskValue, setEditRiskValue] = useState('1.0');

  useEffect(() => {
    fetchMt5Accounts();
    return () => {
      clearMt5Messages();
    };
  }, []);

  const handleConnect = async (e) => {
    e.preventDefault();
    if (!login || !password || !server) return;

    const success = await connectMt5Account({
      name: name || `MT5 - ${login}`,
      login: parseInt(login, 10),
      password,
      server,
      riskConfig: {
        type: riskType,
        value: parseFloat(riskValue)
      }
    });

    if (success) {
      setName('');
      setLogin('');
      setPassword('');
      setServer('');
      setRiskType('multiplier');
      setRiskValue('1.0');
    }
  };

  const handleDisconnect = async (id, accountName) => {
    if (window.confirm(`Bạn có chắc chắn muốn ngắt kết nối tài khoản "${accountName}" không?`)) {
      await disconnectMt5Account(id);
    }
  };

  const startEditRisk = (account) => {
    setEditingId(account.id);
    setEditRiskType(account.riskConfig?.type || 'multiplier');
    setEditRiskValue(account.riskConfig?.value?.toString() || '1.0');
  };

  const saveRiskEdit = async (id) => {
    const success = await updateMt5Risk(id, {
      type: editRiskType,
      value: parseFloat(editRiskValue)
    });
    if (success) {
      setEditingId(null);
    }
  };

  return (
    <div className="w-full flex flex-col gap-6 text-slate-100 font-sans">
      {/* PAGE HEADER */}
      <div className="panel-primary flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 p-5 rounded-2xl relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-amber-500/25 to-transparent" />
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500">
            <Zap className="h-5 w-5 animate-pulse" />
          </div>
          <div className="text-left">
            <span className="text-xs font-black text-amber-500 uppercase tracking-widest block">COPY TRADING ENGINE</span>
            <h2 className="text-xl font-black text-white uppercase mt-0.5 tracking-tight">Auto Trade Console</h2>
          </div>
        </div>
        <p className="text-xs text-slate-400 max-w-sm text-left sm:text-right font-medium leading-relaxed">
          Tự động sao chép các tín hiệu giao dịch chất lượng cao của hệ thống trực tiếp vào tài khoản MetaTrader 5 của bạn.
        </p>
      </div>

      {/* FEEDBACK MESSAGES */}
      {mt5Error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-xs font-bold font-sans flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-500 shrink-0" />
          <div className="text-left">
            <span className="font-black block uppercase text-[10px] tracking-wider mb-0.5 text-red-500">LỖI THỰC THI</span>
            {mt5Error}
          </div>
        </div>
      )}
      {mt5Success && (
        <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl text-xs font-bold font-sans flex items-start gap-3">
          <CheckCircle className="h-5 w-5 text-emerald-500 shrink-0" />
          <div className="text-left">
            <span className="font-black block uppercase text-[10px] tracking-wider mb-0.5 text-emerald-500">THÀNH CÔNG</span>
            {mt5Success}
          </div>
        </div>
      )}

      {/* MAIN CONTAINER */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch text-left">
        {/* LEFT COLUMN: CONNECTION FORM & BOT GUIDE */}
        <div className="lg:col-span-5 flex flex-col gap-6">
          {/* CONNECT FORM */}
          <div className="panel-primary p-6 rounded-2xl relative flex flex-col gap-4">
            <div className="absolute top-0 left-0 right-0 h-[1.5px] bg-gradient-to-r from-transparent via-amber-500/20 to-transparent" />
            <div className="flex items-center justify-between pb-3 border-b border-white/[0.04]">
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-xl bg-amber-500/10 flex items-center justify-center border border-amber-500/25">
                  <Server className="h-4 w-4 text-amber-500" />
                </div>
                <div>
                  <div className="text-xs font-black tracking-widest text-slate-500 uppercase">METAAPI SECURE</div>
                  <h3 className="text-sm font-black text-white uppercase tracking-tight">Kết nối tài khoản MT5</h3>
                </div>
              </div>
              <button 
                onClick={fetchMt5Accounts}
                disabled={mt5Loading}
                className="p-2 rounded-lg bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.08] text-slate-400 hover:text-white transition-all cursor-pointer disabled:opacity-50"
                title="Làm mới trạng thái"
              >
                <RefreshCw className={`h-4 w-4 ${mt5Loading ? 'animate-spin text-amber-500' : ''}`} />
              </button>
            </div>

            <form onSubmit={handleConnect} className="space-y-4" autoComplete="off">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Tên gợi nhớ</label>
                <div className="relative">
                  <input 
                    type="text" 
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Tài Khoản Demo XAU" 
                    className="w-full bg-white/[0.03] border border-white/[0.06] rounded-xl pl-4 pr-4 py-2.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/40 transition-colors font-sans"
                    autoComplete="off"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Số tài khoản (Login ID) *</label>
                  <div className="relative">
                    <input 
                      type="number" 
                      required
                      value={login}
                      onChange={(e) => setLogin(e.target.value)}
                      placeholder="e.g. 50139420" 
                      className="w-full bg-white/[0.03] border border-white/[0.06] rounded-xl px-4 py-2.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/40 transition-colors font-mono"
                      autoComplete="off"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Server của sàn *</label>
                  <div className="relative">
                    <input 
                      type="text" 
                      required
                      value={server}
                      onChange={(e) => setServer(e.target.value)}
                      placeholder="e.g. GTCGlobal-Demo" 
                      className="w-full bg-white/[0.03] border border-white/[0.06] rounded-xl px-4 py-2.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/40 transition-colors font-mono"
                      autoComplete="new-password"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Mật khẩu (Master/Investor) *</label>
                <div className="relative">
                  <input 
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Nhập mật khẩu MT5" 
                    className="w-full bg-white/[0.03] border border-white/[0.06] rounded-xl pl-4 pr-10 py-2.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/40 transition-colors"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 pb-2">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Quản lý rủi ro</label>
                  <select
                    value={riskType}
                    onChange={(e) => setRiskType(e.target.value)}
                    className="w-full bg-[#0a0f1d] border border-white/[0.06] rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-amber-500/40 cursor-pointer"
                  >
                    <option value="multiplier">Tỷ lệ (Multiplier)</option>
                    <option value="fixedLot">Lệnh cố định (Fixed Lot)</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">
                    {riskType === 'multiplier' ? 'Hệ số nhân (e.g. 1.0)' : 'Khối lượng lot (e.g. 0.01)'}
                  </label>
                  <input 
                    type="number" 
                    step="0.01"
                    min="0.01"
                    required
                    value={riskValue}
                    onChange={(e) => setRiskValue(e.target.value)}
                    className="w-full bg-white/[0.03] border border-white/[0.06] rounded-xl px-4 py-2.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/40 transition-colors font-mono"
                  />
                </div>
              </div>

              <button 
                type="submit"
                disabled={mt5Loading}
                className="w-full bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 font-black py-3 rounded-xl text-xs transition-all uppercase tracking-wider shadow-[0_0_15px_rgba(234,179,8,0.2)] flex items-center justify-center gap-2 cursor-pointer"
              >
                {mt5Loading ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Đang kết nối...
                  </>
                ) : (
                  <>
                    <Zap className="h-4 w-4 text-slate-950" />
                    Kết nối tài khoản MT5
                  </>
                )}
              </button>
            </form>
          </div>

          {/* TELEGRAM GUIDE */}
          <div className="panel-primary p-6 rounded-2xl relative flex flex-col gap-4">
            <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[#3b82f6]/20 to-transparent" />
            <div className="flex items-center gap-2.5 pb-3 border-b border-white/[0.04]">
              <div className="h-9 w-9 rounded-xl bg-blue-500/10 flex items-center justify-center border border-blue-500/25">
                <Send className="h-4 w-4 text-blue-400" />
              </div>
              <div>
                <div className="text-xs font-black tracking-widest text-slate-500 uppercase">NOTIFICATION BOT</div>
                <h3 className="text-sm font-black text-white uppercase tracking-tight">Kênh Báo Lệnh Telegram</h3>
              </div>
            </div>

            <div className="text-xs text-slate-300 space-y-3 leading-relaxed">
              <p>
                Để nhận thông báo và nhật ký giao dịch tức thời trực tiếp trên Telegram, vui lòng liên kết tài khoản của bạn với Bot trợ lý.
              </p>
              
              <div className="p-3 bg-white/[0.02] border border-white/[0.05] rounded-xl space-y-2">
                <div className="flex items-center gap-2 text-slate-200 font-bold">
                  <span className="text-amber-500 font-black">Bước 1:</span>
                  <span>Tìm kiếm bot trên Telegram:</span>
                </div>
                <div className="flex items-center justify-between bg-[#080d16] px-3 py-2 rounded-lg border border-white/[0.03]">
                  <a 
                    href="https://t.me/APIMT5_bot" 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    className="text-blue-400 hover:underline font-mono text-[11px]"
                  >
                    @APIMT5_bot
                  </a>
                  <span className="text-[10px] bg-blue-500/10 border border-blue-500/30 text-blue-400 px-1.5 py-0.5 rounded font-black tracking-wide">OPEN LINK</span>
                </div>
                
                <div className="flex items-center gap-2 text-slate-200 font-bold pt-1">
                  <span className="text-amber-500 font-black">Bước 2:</span>
                  <span>Nhấn <code className="text-amber-500 font-mono text-[11px]">/start</code> kèm tên đăng nhập:</span>
                </div>
                <div className="flex items-center justify-between bg-[#080d16] px-3 py-2 rounded-lg border border-white/[0.03]">
                  <code className="text-slate-300 font-mono text-[11px]">/start {user?.username || 'admin'}</code>
                  <button 
                    onClick={() => {
                      navigator.clipboard.writeText(`/start ${user?.username || 'admin'}`);
                      alert('Đã sao chép lệnh vào clipboard!');
                    }}
                    className="text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-300 px-2 py-1 rounded cursor-pointer font-bold transition-all"
                  >
                    COPY
                  </button>
                </div>
              </div>

              <div className="p-3 bg-blue-500/5 border border-blue-500/10 text-blue-400 rounded-xl text-[11px] flex gap-2.5 items-start">
                <Info className="h-4 w-4 shrink-0 text-blue-400 mt-0.5" />
                <span className="text-left font-medium">
                  Hệ thống sẽ gửi thông báo mỗi khi có tín hiệu mới được kích hoạt, vào lệnh thành công, khớp SL/TP hoặc tài khoản bị ngắt kết nối.
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: CONNECTED ACCOUNTS TABLE */}
        <div className="lg:col-span-7 flex flex-col gap-6">
          <div className="panel-primary p-6 rounded-2xl relative flex flex-col gap-4 h-full">
            <div className="absolute top-0 left-0 right-0 h-[1.5px] bg-gradient-to-r from-transparent via-[#ca8a04]/20 to-transparent" />
            <div className="flex items-center gap-2.5 pb-3 border-b border-white/[0.04]">
              <div className="h-9 w-9 rounded-xl bg-amber-500/10 flex items-center justify-center border border-amber-500/25">
                <Shield className="h-4 w-4 text-amber-500" />
              </div>
              <div className="text-left">
                <div className="text-xs font-black tracking-widest text-slate-500 uppercase">CONNECTION STATUS</div>
                <h3 className="text-sm font-black text-white uppercase tracking-tight">Tài khoản MT5 đang hoạt động</h3>
              </div>
            </div>

            {mt5Loading && mt5Accounts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-3">
                <RefreshCw className="h-8 w-8 animate-spin text-amber-500" />
                <span className="text-xs font-bold">Đang tải danh sách tài khoản MT5...</span>
              </div>
            ) : mt5Accounts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-slate-500 text-center gap-4">
                <div className="h-12 w-12 rounded-full bg-white/[0.02] border border-white/[0.05] flex items-center justify-center text-slate-600">
                  <Server className="h-6 w-6" />
                </div>
                <div className="max-w-xs space-y-1">
                  <h4 className="text-xs font-black text-white uppercase">Chưa có tài khoản kết nối</h4>
                  <p className="text-[11px] leading-relaxed">
                    Sử dụng form bên trái để kết nối tài khoản MT5 của bạn vào hệ thống sao chép lệnh tự động.
                  </p>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left border-collapse">
                  <thead>
                    <tr className="border-b border-white/[0.04] text-slate-500">
                      <th className="py-3 font-black uppercase text-[10px] tracking-wider">Tài khoản (MT5 ID)</th>
                      <th className="py-3 font-black uppercase text-[10px] tracking-wider">Broker & Server</th>
                      <th className="py-3 font-black uppercase text-[10px] tracking-wider">Trạng thái</th>
                      <th className="py-3 font-black uppercase text-[10px] tracking-wider">Rủi ro (Risk)</th>
                      <th className="py-3 font-black uppercase text-[10px] tracking-wider text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.03]">
                    {mt5Accounts.map((account) => {
                      const isEditing = editingId === account.id;
                      const isConnected = account.connectionStatus === 'connected' || account.status === 'CONNECTED';
                      
                      return (
                        <tr key={account.id} className="hover:bg-white/[0.01] transition-colors group">
                          {/* Account Identification */}
                          <td className="py-4 pr-2">
                            <div className="flex flex-col text-left">
                              <span className="font-black text-white">{account.name || 'MT5 Account'}</span>
                              <span className="text-[11px] font-mono text-slate-500 mt-0.5">{account.login}</span>
                            </div>
                          </td>

                          {/* Broker Server */}
                          <td className="py-4 pr-2">
                            <div className="flex items-center gap-1.5 text-left">
                              <span className="font-bold text-slate-300 font-mono text-[11px]">{account.server}</span>
                            </div>
                          </td>

                          {/* Connection Status */}
                          <td className="py-4 pr-2">
                            {isConnected ? (
                              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-full text-[10px] font-black uppercase tracking-wider">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
                                CONNECTED
                              </span>
                            ) : account.connectionStatus === 'connecting' ? (
                              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-amber-500/10 border border-amber-500/30 text-amber-500 rounded-full text-[10px] font-black uppercase tracking-wider">
                                <RefreshCw className="h-2.5 w-2.5 animate-spin" />
                                CONNECTING
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-slate-500/10 border border-slate-500/20 text-slate-500 rounded-full text-[10px] font-black uppercase tracking-wider font-bold">
                                DISCONNECTED
                              </span>
                            )}
                          </td>

                          {/* Risk Configuration / Edit */}
                          <td className="py-4 pr-2">
                            {isEditing ? (
                              <div className="flex items-center gap-2">
                                <select
                                  value={editRiskType}
                                  onChange={(e) => setEditRiskType(e.target.value)}
                                  className="bg-[#0a0f1d] border border-white/[0.1] rounded px-1.5 py-1 text-[11px] text-white focus:outline-none focus:border-amber-500/40"
                                >
                                  <option value="multiplier">Tỷ lệ</option>
                                  <option value="fixedLot">Cố định</option>
                                </select>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0.01"
                                  value={editRiskValue}
                                  onChange={(e) => setEditRiskValue(e.target.value)}
                                  className="w-16 bg-white/[0.04] border border-white/[0.1] rounded px-1.5 py-1 text-[11px] text-white font-mono text-center focus:outline-none"
                                />
                              </div>
                            ) : (
                              <div className="flex flex-col text-left">
                                <span className="font-bold text-slate-200">
                                  {account.riskConfig?.type === 'multiplier' 
                                    ? `Tỷ lệ x${account.riskConfig?.value || '1.0'}`
                                    : `Cố định ${account.riskConfig?.value || '0.01'} lot`
                                  }
                                </span>
                              </div>
                            )}
                          </td>

                          {/* Action Buttons */}
                          <td className="py-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              {isEditing ? (
                                <>
                                  <button
                                    onClick={() => saveRiskEdit(account.id)}
                                    className="px-2.5 py-1 bg-amber-500 hover:bg-amber-600 text-slate-950 rounded text-[11px] font-black transition-all cursor-pointer"
                                  >
                                    LƯU
                                  </button>
                                  <button
                                    onClick={() => setEditingId(null)}
                                    className="px-2.5 py-1 bg-white/[0.05] hover:bg-white/[0.1] text-slate-400 hover:text-white rounded text-[11px] font-black transition-all cursor-pointer"
                                  >
                                    HỦY
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    onClick={() => {
                                      setEditingId(account.id);
                                      setEditRiskType(account.riskConfig?.type || 'multiplier');
                                      setEditRiskValue(account.riskConfig?.value?.toString() || '1.0');
                                    }}
                                    className="p-1.5 rounded bg-white/[0.03] border border-white/[0.06] hover:bg-amber-500/10 hover:border-amber-500/30 text-slate-400 hover:text-amber-500 transition-all cursor-pointer"
                                    title="Chỉnh sửa cấu hình rủi ro"
                                  >
                                    <Sliders className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    onClick={() => handleDisconnect(account.id, account.name)}
                                    className="p-1.5 rounded bg-white/[0.03] border border-white/[0.06] hover:bg-red-500/10 hover:border-red-500/30 text-slate-400 hover:text-red-500 transition-all cursor-pointer"
                                    title="Ngắt kết nối tài khoản"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* GOLDEN RULES / TECHNICAL SPEC */}
            <div className="mt-auto pt-6 border-t border-white/[0.04]">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-[11px] text-slate-400">
                <div className="flex gap-2">
                  <div className="h-5 w-5 rounded bg-amber-500/10 flex items-center justify-center text-amber-500 shrink-0 mt-0.5">
                    <Info className="h-3.5 w-3.5" />
                  </div>
                  <div className="text-left leading-relaxed">
                    <span className="font-black text-white block mb-0.5">Về Khớp Lệnh & Trượt Giá</span>
                    Tín hiệu được đẩy trực tiếp từ server qua API siêu tốc. Tuy nhiên, kết quả thực tế có thể chênh lệch nhẹ (trượt giá/spread) tùy vào nhà môi giới của bạn.
                  </div>
                </div>

                <div className="flex gap-2">
                  <div className="h-5 w-5 rounded bg-amber-500/10 flex items-center justify-center text-amber-500 shrink-0 mt-0.5">
                    <Shield className="h-3.5 w-3.5" />
                  </div>
                  <div className="text-left leading-relaxed">
                    <span className="font-black text-white block mb-0.5">Bảo Mật Tài Khoản</span>
                    Thông tin mật khẩu MT5 được mã hóa đầu cuối và chỉ sử dụng để thực thi lệnh thông qua giao thức API an toàn của MetaApi.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
