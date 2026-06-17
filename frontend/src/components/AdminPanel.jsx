import React, { useState, useEffect } from 'react';
import { 
  UserPlus, 
  Sliders, 
  Check, 
  X, 
  Key, 
  Trash2 
} from 'lucide-react';
import { useTradeStore } from '../store/useTradeStore';
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
    setAdminError,
    setAdminSuccess
  } = useTradeStore();

  // Local form states
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState('User');

  const [resettingUser, setResettingUser] = useState(null);
  const [resetPasswordVal, setResetPasswordVal] = useState('');

  // Fetch users when component mounts
  useEffect(() => {
    fetchAdminUsers();
  }, [fetchAdminUsers]);

  const handleCreateUser = async (e) => {
    e.preventDefault();
    const success = await createUser(newUsername, newPassword, newName, newRole);
    if (success) {
      setNewUsername('');
      setNewPassword('');
      setNewName('');
      setNewRole('User');
    }
  };

  const handleUpdatePassword = async (targetUsername) => {
    const success = await updatePassword(targetUsername, resetPasswordVal);
    if (success) {
      setResetPasswordVal('');
      setResettingUser(null);
    }
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

          <form onSubmit={handleCreateUser} className="space-y-4">
            <div className="space-y-1">
              <label className="text-xs font-black text-slate-500 uppercase tracking-widest">{t('displayName')}</label>
              <input 
                type="text" 
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Nguyễn Văn A" 
                className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/40 transition-colors"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-black text-slate-500 uppercase tracking-widest">{t('username')}</label>
              <input 
                type="text" 
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder="e.g. nguyenvana" 
                className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/40 transition-colors"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-black text-slate-500 uppercase tracking-widest">{t('password')}</label>
              <input 
                type="password" 
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Tối thiểu 6 ký tự" 
                className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/40 transition-colors"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-black text-slate-500 uppercase tracking-widest">{t('roleHeader')}</label>
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
                className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3 text-xs text-white focus:outline-none focus:border-amber-500/40 cursor-pointer appearance-none bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%23eab308%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%25.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E')] bg-[length:10px] bg-[position:right_16px_center] bg-no-repeat transition-colors"
              >
                <option value="User" className="bg-[#050507]">User (Thành viên thường)</option>
                <option value="Administrator" className="bg-[#050507]">Administrator (Quản trị viên)</option>
              </select>
            </div>

            <button 
              type="submit"
              className="w-full bg-amber-500 hover:bg-amber-600 text-[#040406] font-black py-3.5 px-4 rounded-xl text-xs transition-all duration-300 tracking-wider shadow-[0_0_15px_rgba(234,179,8,0.15)] flex items-center justify-center gap-2 cursor-pointer mt-4"
            >
              <UserPlus className="h-4 w-4" />
              <span>{t('createUserButton')}</span>
            </button>
          </form>
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
                    return (
                      <tr key={u.username} className="hover:bg-slate-950/20 transition-colors">
                        <td className="py-4 px-4">
                          <div className="font-bold text-white text-sm">{u.name}</div>
                          <div className="text-xs font-mono text-slate-500 mt-0.5">
                            @{u.username} {isSelf && <span className="text-amber-500/80 font-bold">({t('you')})</span>}
                          </div>
                        </td>
                        <td className="py-4 px-4">
                          {isSelf ? (
                            <span className="px-3 py-1 bg-amber-500/10 border border-amber-500/30 text-amber-500 rounded-lg text-xs font-black tracking-wide uppercase">
                              {u.role}
                            </span>
                          ) : (
                            <select
                              value={u.role}
                              onChange={(e) => handleChangeRole(u.username, e.target.value)}
                              className="bg-white/[0.04] border border-white/[0.08] rounded-lg px-2 py-1 text-[11px] text-white focus:outline-none focus:border-amber-500/40 cursor-pointer transition-colors"
                            >
                              <option value="User">User</option>
                              <option value="Administrator">Administrator</option>
                            </select>
                          )}
                        </td>
                        <td className="py-4 px-4">
                          <div className="flex flex-wrap items-center gap-3">
                            {resettingUser === u.username ? (
                              <div className="flex items-center gap-2 panel-surface p-1.5 rounded-xl">
                                <input
                                  type="password"
                                  value={resetPasswordVal}
                                  onChange={(e) => setResetPasswordVal(e.target.value)}
                                  placeholder={t('newPasswordPlaceholder')}
                                  className="bg-white/[0.04] border border-white/[0.08] rounded-lg px-2 py-1 text-xs text-white placeholder-slate-600 focus:outline-none w-32 font-sans"
                                />
                                <button
                                  onClick={() => handleUpdatePassword(u.username)}
                                  title="Xác nhận đổi mật khẩu"
                                  className="p-1 text-emerald-500 hover:bg-emerald-500/10 rounded transition-all cursor-pointer"
                                >
                                  <Check className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  onClick={() => {
                                    setResettingUser(null);
                                    setResetPasswordVal('');
                                  }}
                                  title="Hủy"
                                  className="p-1 text-red-400 hover:bg-red-500/10 rounded transition-all cursor-pointer"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => {
                                  setResetPasswordVal('');
                                  setResettingUser(u.username);
                                }}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-white/[0.04] border border-white/[0.08] hover:border-amber-500/35 hover:bg-amber-500/5 text-slate-300 hover:text-amber-500 rounded-lg text-xs font-black transition-all cursor-pointer"
                              >
                                <Key className="h-3 w-3" />
                                <span>{t('changePassword')}</span>
                              </button>
                            )}

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
    </div>
    </div>
  );
}
