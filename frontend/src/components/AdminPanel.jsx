import React, { useState, useEffect } from 'react';
import { 
  UserPlus, 
  Sliders, 
  Check, 
  X, 
  Key, 
  Trash2 
} from 'lucide-react';
import { useTradeStore, SOCKET_URL } from '../store/useTradeStore';
import { useTranslation } from '../utils/translations';

export function AdminPanel() {
  const { t } = useTranslation();
  const {
    user,
    adminUsers,
    adminLoading,
    adminError,
    adminSuccess,
    fetchAdminUsers,
    createUser,
    updatePassword,
    changeRole,
    deleteUser,
    editUser,
    setAdminError,
    setAdminSuccess
  } = useTradeStore();

  // Local form states
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState('User');
  const [newExpiresAt, setNewExpiresAt] = useState('');

  const [newTelegramSupport, setNewTelegramSupport] = useState('');
  const [newRefCode, setNewRefCode] = useState('');

  const [editingUser, setEditingUser] = useState(null);
  const [editPasswordVal, setEditPasswordVal] = useState('');
  const [editTelegramVal, setEditTelegramVal] = useState('');
  const [editRefCodeVal, setEditRefCodeVal] = useState('');

  // Audit Logs local states
  const [logs, setLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState('');
  const [logsSuccess, setLogsSuccess] = useState('');

  const fetchLogs = async () => {
    if (user?.role !== 'SuperAdmin') return;
    setLogsLoading(true);
    setLogsError('');
    try {
      const token = localStorage.getItem('auth_token');
      const response = await fetch(`${SOCKET_URL}/api/admin/audit-logs`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      if (response.ok && data.success) {
        setLogs(data.logs || []);
      } else {
        setLogsError(data.error || 'Không thể tải nhật ký hoạt động.');
      }
    } catch {
      setLogsError('Lỗi kết nối máy chủ khi tải nhật ký.');
    } finally {
      setLogsLoading(false);
    }
  };

  const handleClearLogs = async () => {
    if (!window.confirm('Bạn có chắc chắn muốn xóa toàn bộ nhật ký hoạt động không?')) return;
    setLogsError('');
    setLogsSuccess('');
    try {
      const token = localStorage.getItem('auth_token');
      const response = await fetch(`${SOCKET_URL}/api/admin/audit-logs`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      if (response.ok && data.success) {
        setLogsSuccess(data.message || 'Đã xóa nhật ký.');
        setLogs([]);
      } else {
        setLogsError(data.error || 'Không thể xóa nhật ký.');
      }
    } catch {
      setLogsError('Lỗi kết nối khi xóa nhật ký.');
    }
  };

  // Fetch users when component mounts, and fetch audit logs if SuperAdmin
  useEffect(() => {
    fetchAdminUsers();
    if (user?.role === 'SuperAdmin') {
      fetchLogs();
    }
  }, [fetchAdminUsers, user]);

  const handleCreateUser = async (e) => {
    e.preventDefault();
    const success = await createUser(newUsername, newPassword, newName, newRole, newExpiresAt, newTelegramSupport, newRefCode);
    if (success) {
      setNewUsername('');
      setNewPassword('');
      setNewName('');
      setNewRole('User');
      setNewExpiresAt('');
      setNewTelegramSupport('');
      setNewRefCode('');
    }
  };

  const handleUpdateExpiration = async (targetUsername, targetDate) => {
    await editUser(targetUsername, undefined, undefined, targetDate || null);
  };

  const handleSaveUser = async (targetUsername) => {
    let success = true;
    if (editPasswordVal) {
      success = await updatePassword(targetUsername, editPasswordVal);
    }
    if (success) {
      const targetUser = adminUsers.find(u => u.username === targetUsername);
      if (targetUser && (targetUser.telegramSupport !== editTelegramVal || targetUser.refCode !== editRefCodeVal)) {
        success = await editUser(targetUsername, undefined, undefined, undefined, editTelegramVal, editRefCodeVal);
      }
    }
    if (success) {
      setEditingUser(null);
      setEditPasswordVal('');
      setEditTelegramVal('');
      setEditRefCodeVal('');
      setAdminSuccess('Cập nhật thông tin tài khoản thành công!');
    }
  };

  const startEditing = (u) => {
    setEditingUser(u.username);
    setEditPasswordVal('');
    setEditTelegramVal(u.telegramSupport || '');
    setEditRefCodeVal(u.refCode || '');
  };

  const handleChangeRole = async (targetUsername, targetRole) => {
    await changeRole(targetUsername, targetRole);
  };

  const handleDeleteUser = async (targetUsername) => {
    if (window.confirm(t('confirmDeleteUser').replace('{username}', targetUsername))) {
      await deleteUser(targetUsername);
    }
  };

  return (
    <div className="w-full flex flex-col gap-6 text-slate-100 font-sans">

      {/* PAGE HEADER */}
      <div className="panel-primary flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 p-5 rounded-2xl relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-amber-500/20 to-transparent" />
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500">
            <Sliders className="h-5 w-5" />
          </div>
          <div className="text-left">
            <span className="text-xs font-black text-amber-500 uppercase tracking-widest block">ADMIN CONTROL</span>
            <h2 className="text-xl font-black text-white uppercase mt-0.5 tracking-tight">{t('memberManagement')}</h2>
          </div>
        </div>
        <p className="text-xs text-slate-400 max-w-sm text-left sm:text-right font-medium leading-relaxed">
          Quản lý tài khoản thành viên, phân quyền và bảo mật hệ thống.
        </p>
      </div>

    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch text-left">
      {/* LEFT COLUMN: CREATE USER FORM */}
      <div className="lg:col-span-4 flex flex-col gap-6">
        <div className="space-panel-heavy p-6 rounded-2xl relative flex flex-col gap-4">
          <div className="flex items-center gap-2.5 pb-3 border-b border-slate-800/60">
            <div className="h-9 w-9 rounded-xl bg-amber-500/10 flex items-center justify-center border border-amber-500/25">
              <UserPlus className="h-4 w-4 text-amber-500" />
            </div>
            <div>
              <div className="text-xs font-black tracking-widest text-slate-500 uppercase">ADMIN CONTROL</div>
              <h3 className="text-sm font-black text-white uppercase tracking-tight">{t('createAccount')}</h3>
            </div>
          </div>

          {adminError && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-xs font-bold font-sans">
              ⚠️ {adminError}
            </div>
          )}
          {adminSuccess && (
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl text-xs font-bold font-sans">
              ✓ {adminSuccess}
            </div>
          )}

          {user?.role === 'Employee' ? (
            <div className="p-4 bg-sky-500/5 border border-sky-500/15 text-sky-400 rounded-2xl text-xs font-medium leading-relaxed font-sans text-left">
              ℹ️ Bạn đang đăng nhập bằng tài khoản Hỗ trợ (Employee). Bạn chỉ có quyền xem danh sách thành viên để hỗ trợ kỹ thuật, không thể tạo mới, thay đổi mật khẩu hoặc xóa tài khoản.
            </div>
          ) : (
            <form onSubmit={handleCreateUser} className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-black text-slate-500 uppercase tracking-widest">{t('displayName')}</label>
                <input 
                  type="text" 
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Nguyễn Văn A" 
                  className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/40 transition-colors font-sans"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-black text-slate-500 uppercase tracking-widest">{t('username')}</label>
                <input 
                  type="text" 
                  required
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="e.g. nguyenvana" 
                  className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/40 transition-colors font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-black text-slate-500 uppercase tracking-widest">{t('password')}</label>
                <input 
                  type="password" 
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Tối thiểu 6 ký tự" 
                  className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/40 transition-colors font-sans"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-black text-slate-500 uppercase tracking-widest">{t('roleHeader')}</label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value)}
                  className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3 text-xs text-white focus:outline-none focus:border-amber-500/40 cursor-pointer appearance-none bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%23eab308%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%25.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E')] bg-[length:10px] bg-[position:right_16px_center] bg-no-repeat transition-colors font-sans"
                >
                  <option value="User" className="bg-[#050507]">User (Thành viên thường)</option>
                  <option value="Employee" className="bg-[#050507]">Employee (Nhân viên hỗ trợ)</option>
                  <option value="Administrator" className="bg-[#050507]">Administrator (Quản trị viên)</option>
                  {user?.role === 'SuperAdmin' && (
                    <option value="SuperAdmin" className="bg-[#050507]">Super Admin (Quản trị tối cao)</option>
                  )}
                </select>
              </div>

              {['Administrator', 'SuperAdmin'].includes(newRole) && (
                <>
                  <div className="space-y-1">
                    <label className="text-xs font-black text-slate-500 uppercase tracking-widest">Telegram Support Link</label>
                    <input 
                      type="text" 
                      value={newTelegramSupport}
                      onChange={(e) => setNewTelegramSupport(e.target.value)}
                      placeholder="e.g. https://t.me/alphagoldhelper" 
                      className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/40 transition-colors font-mono"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-black text-slate-500 uppercase tracking-widest">Đuôi link Ref (Tùy chọn)</label>
                    <input 
                      type="text" 
                      value={newRefCode}
                      onChange={(e) => setNewRefCode(e.target.value)}
                      placeholder="Bỏ trống để tự sinh ngẫu nhiên" 
                      className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/40 transition-colors font-mono"
                    />
                    <span className="text-[10px] text-slate-500 block font-sans">Chỉ chứa chữ cái và số (ví dụ: gold77, quan123).</span>
                  </div>
                </>
              )}

              <div className="space-y-1">
                <label className="text-xs font-black text-slate-500 uppercase tracking-widest">Hạn sử dụng</label>
                <input 
                  type="date" 
                  value={newExpiresAt}
                  onChange={(e) => setNewExpiresAt(e.target.value)}
                  className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/40 transition-colors cursor-pointer font-sans"
                />
                <span className="text-[10px] text-slate-500 block font-sans">Bỏ trống để cấp tài khoản vô thời hạn.</span>
              </div>

              <button 
                type="submit"
                className="w-full bg-amber-500 hover:bg-amber-600 text-[#040406] font-black py-3.5 px-4 rounded-xl text-xs transition-all duration-300 tracking-wider shadow-[0_0_15px_rgba(234,179,8,0.15)] flex items-center justify-center gap-2 cursor-pointer mt-4 font-sans"
              >
                <UserPlus className="h-4 w-4" />
                <span>{t('createUserButton')}</span>
              </button>
            </form>
          )}
        </div>
      </div>

      {/* RIGHT COLUMN: USERS LIST TABLE */}
      <div className="lg:col-span-8 flex flex-col gap-6">
        <div className="space-panel-heavy p-6 rounded-2xl relative flex flex-col gap-4 text-left">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pb-3 border-b border-slate-800/60">
            <div className="flex items-center gap-2.5">
              <div className="h-9 w-9 rounded-xl bg-slate-800/60 flex items-center justify-center border border-slate-700/40">
                <Sliders className="h-4 w-4 text-slate-400" />
              </div>
              <div>
                <div className="text-xs font-black tracking-widest text-slate-500 uppercase">DATABASE</div>
                <h3 className="text-sm font-black text-white uppercase tracking-tight">{t('memberManagement')}</h3>
              </div>
            </div>
            <span className="panel-surface px-3 py-1 rounded-xl text-xs font-mono font-black text-amber-500">
              {adminUsers.length} {t('account').toUpperCase()}
            </span>
          </div>

          {adminLoading ? (
            <div className="py-12 text-center text-xs text-slate-500 font-bold animate-pulse">
              {t('loadingAccounts')}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/[0.06] text-[11px] font-black text-slate-500 uppercase tracking-wider">
                    <th className="py-3 px-4">{t('memberHeader')}</th>
                    <th className="py-3 px-4">{t('roleHeader')}</th>
                    <th className="py-3 px-4">{t('actionHeader')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04] text-xs text-slate-300">
                  {adminUsers.map((u) => {
                    const isSelf = u.username.toLowerCase() === user?.username?.toLowerCase();
                    const isEmployee = user?.role === 'Employee';
                    const isSuperAdmin = user?.role === 'SuperAdmin';
                    const targetIsSuperAdmin = u.role === 'SuperAdmin';
                    
                    // Rules for editing/deleting based on creator/hierarchy:
                    // Regular Admin cannot edit/delete SuperAdmin or other admins they didn't create
                    const isBlockedFromEditing = isEmployee || (!isSuperAdmin && targetIsSuperAdmin) || (user?.role === 'Administrator' && u.role === 'Administrator' && u.createdBy !== user?.username);
                    
                    return (
                      <tr key={u.username} className="hover:bg-slate-950/20 transition-colors">
                        <td className="py-4 px-4 font-sans text-left">
                          <div className="font-bold text-white text-sm">{u.name}</div>
                          <div className="text-xs font-mono text-slate-500 mt-0.5">
                            @{u.username} {isSelf && <span className="text-amber-500/80 font-bold">({t('you')})</span>}
                            {u.createdBy && <span className="text-slate-600 ml-2 font-sans">(Tạo bởi: @{u.createdBy})</span>}
                          </div>
                          <div className="text-[11px] mt-2 flex items-center gap-1.5 flex-wrap font-sans">
                            <span className="text-slate-500 font-bold">Hạn dùng:</span>
                            {isSelf || isBlockedFromEditing ? (
                              <span className="text-slate-400 font-bold">
                                {u.expiresAt ? new Date(u.expiresAt).toLocaleDateString('vi-VN') : 'Vô thời hạn'}
                              </span>
                            ) : (
                              <div className="flex items-center gap-2">
                                <input
                                  type="date"
                                  disabled={isBlockedFromEditing}
                                  value={u.expiresAt ? u.expiresAt.split('T')[0] : ''}
                                  onChange={(e) => handleUpdateExpiration(u.username, e.target.value)}
                                  className="bg-white/[0.03] border border-white/[0.08] hover:border-amber-500/30 rounded-lg px-2 py-0.5 text-[11px] text-slate-300 focus:outline-none cursor-pointer transition-colors font-sans"
                                />
                                {u.expiresAt ? (
                                  new Date(u.expiresAt).getTime() < Date.now() ? (
                                    <span className="text-red-400 text-[10px] font-black uppercase tracking-wider bg-red-500/10 border border-red-500/20 px-1.5 py-0.5 rounded-md">Hết hạn</span>
                                  ) : (
                                    <span className="text-emerald-400 text-[10px] font-black uppercase tracking-wider bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded-md">Hoạt động</span>
                                  )
                                ) : (
                                  <span className="text-slate-500 text-[10px] font-bold uppercase tracking-wider bg-slate-800/20 border border-slate-700/20 px-1.5 py-0.5 rounded-md">Vô hạn</span>
                                )}
                              </div>
                            )}
                          </div>

                          {u.refCode && (
                            <div className="text-[11px] mt-2 flex flex-col gap-1 font-sans">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-slate-500 font-bold">Mã giới thiệu:</span>
                                <span className="text-amber-500 font-bold font-mono bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">{u.refCode}</span>
                              </div>
                              <div className="flex items-center gap-2 flex-wrap mt-0.5">
                                <span className="text-slate-500 font-bold">Link giới thiệu:</span>
                                <span className="text-amber-500/80 font-bold font-mono select-all break-all">{window.location.origin}/?ref={u.refCode}</span>
                                <button
                                  onClick={() => {
                                    navigator.clipboard.writeText(`${window.location.origin}/?ref=${u.refCode}`);
                                    setAdminSuccess('Đã sao chép link giới thiệu vào bộ nhớ tạm!');
                                  }}
                                  className="text-[10px] bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 px-1.5 py-0.5 rounded border border-amber-500/20 transition-all cursor-pointer font-sans font-bold"
                                >
                                  Sao chép
                                </button>
                              </div>
                            </div>
                          )}

                          {u.telegramSupport && (
                            <div className="text-[11px] mt-2 flex items-center gap-1.5 flex-wrap font-sans">
                              <span className="text-slate-500 font-bold">Telegram Support:</span>
                              <a href={u.telegramSupport} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:text-sky-300 font-bold font-mono underline break-all">
                                {u.telegramSupport}
                              </a>
                            </div>
                          )}
                        </td>
                        <td className="py-4 px-4 text-left">
                          {isSelf || isBlockedFromEditing ? (
                            <span className={`px-3 py-1 rounded-lg text-xs font-black tracking-wide uppercase ${
                              u.role === 'SuperAdmin'
                                ? 'bg-red-500/10 border border-red-500/30 text-red-400'
                                : u.role === 'Administrator'
                                ? 'bg-amber-500/10 border border-amber-500/30 text-amber-500'
                                : u.role === 'Employee'
                                ? 'bg-sky-500/10 border border-sky-500/30 text-sky-400'
                                : 'bg-slate-500/10 border border-slate-500/30 text-slate-400'
                            }`}>
                              {u.role === 'SuperAdmin' ? 'Super Admin' : u.role === 'Administrator' ? 'Admin' : u.role}
                            </span>
                          ) : (
                            <select
                              value={u.role}
                              onChange={(e) => handleChangeRole(u.username, e.target.value)}
                              className="bg-white/[0.04] border border-white/[0.08] rounded-lg px-2 py-1 text-[11px] text-white focus:outline-none focus:border-amber-500/40 cursor-pointer transition-colors"
                            >
                              <option value="User">User</option>
                              <option value="Employee">Employee</option>
                              <option value="Administrator">Administrator</option>
                              {isSuperAdmin && (
                                <option value="SuperAdmin">SuperAdmin</option>
                              )}
                            </select>
                          )}
                        </td>
                        <td className="py-4 px-4 text-left">
                          <div className="flex flex-wrap items-center gap-3">
                            {isBlockedFromEditing ? (
                              <span className="text-slate-600 text-xs italic font-bold font-sans">Chỉ xem</span>
                            ) : editingUser === u.username ? (
                              <div className="flex flex-col gap-2 panel-surface p-3 rounded-xl border border-white/[0.06] w-full max-w-[280px]">
                                <div className="space-y-1">
                                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Mật khẩu mới</label>
                                  <input
                                    type="password"
                                    value={editPasswordVal}
                                    onChange={(e) => setEditPasswordVal(e.target.value)}
                                    placeholder="Bỏ trống nếu không đổi"
                                    className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/40 transition-colors font-sans"
                                  />
                                </div>
                                {['SuperAdmin', 'Administrator'].includes(u.role) && (
                                  <>
                                    <div className="space-y-1">
                                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Telegram Support Link</label>
                                      <input
                                        type="text"
                                        value={editTelegramVal}
                                        onChange={(e) => setEditTelegramVal(e.target.value)}
                                        placeholder="https://t.me/your_telegram"
                                        className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/40 transition-colors font-mono"
                                      />
                                    </div>
                                    <div className="space-y-1">
                                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Mã giới thiệu (Đuôi ref)</label>
                                      <input
                                        type="text"
                                        value={editRefCodeVal}
                                        onChange={(e) => setEditRefCodeVal(e.target.value)}
                                        placeholder="Mã giới thiệu tùy chọn"
                                        className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/40 transition-colors font-mono"
                                      />
                                    </div>
                                  </>
                                )}
                                <div className="flex items-center justify-end gap-2 pt-1 border-t border-white/[0.05]">
                                  <button
                                    onClick={() => handleSaveUser(u.username)}
                                    className="flex items-center gap-1 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-[#040406] font-black rounded-lg text-[10px] uppercase transition-colors cursor-pointer"
                                  >
                                    <Check className="h-3 w-3" />
                                    <span>Lưu</span>
                                  </button>
                                  <button
                                    onClick={() => {
                                      setEditingUser(null);
                                      setEditPasswordVal('');
                                      setEditTelegramVal('');
                                      setEditRefCodeVal('');
                                    }}
                                    className="flex items-center gap-1 px-3 py-1.5 bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 font-bold rounded-lg text-[10px] uppercase transition-colors cursor-pointer border border-white/[0.08]"
                                  >
                                    <X className="h-3 w-3" />
                                    <span>Hủy</span>
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <button
                                onClick={() => {
                                  startEditing(u);
                                }}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-white/[0.04] border border-white/[0.08] hover:border-amber-500/35 hover:bg-amber-500/5 text-slate-300 hover:text-amber-500 rounded-lg text-xs font-black transition-all cursor-pointer font-sans"
                              >
                                <Sliders className="h-3 w-3" />
                                <span>Sửa thông tin</span>
                              </button>
                            )}

                            {!isBlockedFromEditing && (
                              <button
                                onClick={() => handleDeleteUser(u.username)}
                                disabled={isSelf}
                                title={isSelf ? "Bạn không thể tự xóa tài khoản của mình" : "Xóa tài khoản"}
                                className={`p-1.5 border rounded-lg transition-all flex items-center justify-center ${
                                  isSelf
                                    ? 'border-white/[0.05] text-zinc-700 cursor-not-allowed opacity-40'
                                    : 'border-red-950/40 hover:border-red-500/30 text-slate-500 hover:text-red-400 hover:bg-red-500/10 cursor-pointer'
                                }`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
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
        </div>
      </div>

      {/* AUDIT LOGS SECTION - ONLY FOR SUPER ADMIN */}
      {user?.role === 'SuperAdmin' && (
        <div className="lg:col-span-12 space-panel-heavy p-6 rounded-2xl relative flex flex-col gap-4 text-left">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pb-3 border-b border-slate-800/60">
            <div className="flex items-center gap-2.5">
              <div className="h-9 w-9 rounded-xl bg-red-500/10 flex items-center justify-center border border-red-500/25">
                <Sliders className="h-4 w-4 text-red-400" />
              </div>
              <div>
                <div className="text-xs font-black tracking-widest text-red-500 uppercase">SUPER ADMIN ONLY</div>
                <h3 className="text-sm font-black text-white uppercase tracking-tight">Nhật ký hoạt động (Audit Logs)</h3>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button 
                onClick={fetchLogs}
                disabled={logsLoading}
                className="px-3 py-1.5 bg-white/[0.04] border border-white/[0.08] hover:border-slate-400/30 text-xs font-bold rounded-lg hover:bg-slate-800/30 cursor-pointer transition-colors"
              >
                {logsLoading ? 'Đang tải...' : 'Làm mới'}
              </button>
              <button 
                onClick={handleClearLogs}
                className="px-3 py-1.5 bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 text-xs font-bold rounded-lg cursor-pointer transition-colors"
              >
                Xóa toàn bộ
              </button>
            </div>
          </div>

          {logsError && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-xs font-bold">
              ⚠️ {logsError}
            </div>
          )}
          {logsSuccess && (
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl text-xs font-bold">
              ✓ {logsSuccess}
            </div>
          )}

          {logsLoading && logs.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-500 font-bold animate-pulse">
              Đang tải nhật ký hệ thống...
            </div>
          ) : logs.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-500 font-bold">
              Chưa có nhật ký hoạt động nào.
            </div>
          ) : (
            <div className="max-h-[300px] overflow-y-auto pr-1 text-xs">
              <div className="space-y-2.5">
                {logs.map((log, index) => (
                  <div key={index} className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.04] flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-white/[0.03] transition-colors">
                    <div className="space-y-1">
                      <div className="text-slate-300 font-bold">
                        <span className="text-amber-500 font-mono">@{log.actor}</span>{' '}
                        <span className="text-slate-400 font-normal">{log.action === 'CREATE_USER' ? 'đã tạo user' : log.action === 'CHANGE_ROLE' ? 'đã đổi quyền' : log.action === 'DELETE_USER' ? 'đã xóa user' : log.action === 'CHANGE_PASSWORD' ? 'đã đổi mật khẩu' : log.action === 'EDIT_USER' ? 'đã sửa thông tin' : log.action}{' '}</span>
                        <span className="text-sky-400 font-mono">@{log.target}</span>
                      </div>
                      <div className="text-slate-500 text-[11px] leading-relaxed">
                        Chi tiết: {log.details}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-slate-500 text-[10px] font-mono">{new Date(log.timestamp).toLocaleString('vi-VN')}</div>
                      <div className="text-slate-600 text-[10px] font-mono mt-0.5">IP: {log.ip}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
    </div>
  );
}
