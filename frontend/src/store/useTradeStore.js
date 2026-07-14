import { create } from 'zustand';
import { 
  calculateZenTrendLines, 
  calculateUTBotSignals, 
  calculateChandelierExit, 
  calculateTrendlinesWithBreaks, 
  calculateATR,
  getCurrentSignal
} from '../utils/indicators';
import {
  advanceSignalWithPrice,
  getTrackedSignalForIndicator,
  putTrackedSignalForIndicator
} from '../utils/signalLifecycle';

export const SOCKET_URL = window.location.hostname === 'localhost' 
  ? 'http://localhost:5000' 
  : 'https://xauusd-dashboard-izrr.onrender.com';

const initialSignals = Object.fromEntries(
  ['XAUUSD', 'WTIUSD', 'XAGUSD', 'BTCUSD', 'ETHUSD'].map((symbol) => [
    symbol,
    Object.fromEntries(['M1', 'M5', 'M15', 'H1'].map((timeframe) => [
      timeframe,
      {
        symbol,
        timeframe,
        action: 'stale',
        entry: 0,
        sl: 0,
        tp: 0,
        tps: [],
        signalStrength: 0,
        timestamp: Date.now()
      }
    ]))
  ])
);

const getSavedToken = () => localStorage.getItem('auth_token') || '';
const getSavedUser = () => {
  const user = localStorage.getItem('auth_user');
  try {
    return user ? JSON.parse(user) : null;
  } catch {
    return null;
  }
};

const TRACKED_SIGNALS_STORAGE_KEY = 'tracked_signals_v3';

const getSavedTrackedSignals = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(TRACKED_SIGNALS_STORAGE_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const persistTrackedSignals = (signals) => {
  try { localStorage.setItem(TRACKED_SIGNALS_STORAGE_KEY, JSON.stringify(signals)); } catch (_) {}
};

const initialTrackedSignals = getSavedTrackedSignals();

const getSavedVirtualAccount = () => {
  const account = localStorage.getItem('virtual_account');
  const defaults = {
    balance: 10000,
    equity: 10000,
    history: [],
    openTrades: [],
    maxDrawdown: 0,
    peakBalance: 10000,
    psychologyScore: { discipline: 100, patience: 100, emotionalControl: 100, focus: 100 },
    lastSignalTime: 0
  };
  try {
    if (!account) return defaults;
    const parsed = JSON.parse(account);
    if (!parsed || typeof parsed !== 'object') return defaults;
    return {
      ...defaults,
      ...parsed,
      history: Array.isArray(parsed.history) ? parsed.history : [],
      openTrades: Array.isArray(parsed.openTrades) ? parsed.openTrades : [],
      psychologyScore: {
        ...defaults.psychologyScore,
        ...(parsed.psychologyScore || {})
      }
    };
  } catch {
    return defaults;
  }
};

const getSavedStartingCapital = () => {
  const val = localStorage.getItem('starting_capital');
  return val ? parseFloat(val) : 10000;
};

const getSavedSimulatedSpread = () => {
  const val = localStorage.getItem('simulated_spread');
  return val ? parseFloat(val) : 0.20;
};

const getSavedSimulatedRiskPercent = () => {
  const val = localStorage.getItem('simulated_risk_percent');
  return val ? parseFloat(val) : 1.0;
};

const getSavedSimulatedSlPoints = () => {
  const val = localStorage.getItem('simulated_sl_points');
  return val ? parseFloat(val) : 2.0;
};

const getSavedSimulatedTpPoints = () => {
  const val = localStorage.getItem('simulated_tp_points');
  return val ? parseFloat(val) : 4.0;
};

const getSavedIsSimulating = () => {
  return localStorage.getItem('is_simulating') === 'true';
};

const getSavedSimulatedIndicator = () => {
  const val = localStorage.getItem('simulated_indicator');
  return val || 'zen';
};

const getLatestSignalForSystem = (system, candles, state) => {
  if (!candles || candles.length < 20) return null;
  const params = {
    history: candles,
    selectedSymbol: state.selectedSymbol,
    selectedTimeframe: state.selectedTimeframe,
    selectedIndicatorSystem: system,
    zenFastPeriod: state.zenFastPeriod,
    zenSlowPeriod: state.zenSlowPeriod,
    utBotKeyValue: state.utBotKeyValue,
    utBotAtrPeriod: state.utBotAtrPeriod,
    chandelierAtrPeriod: state.chandelierAtrPeriod,
    chandelierAtrMultiplier: state.chandelierAtrMultiplier,
    trendlineLength: state.trendlineLength,
    trendlineSlopeMult: state.trendlineSlopeMult,
    livePrice: state.livePrice
  };
  return getCurrentSignal(params);
};

const getContractSize = (symbol) => {
  if (!symbol) return 100;
  if (symbol.includes('XAU')) return 100;
  if (symbol.includes('WTI')) return 1000;
  if (symbol.includes('XAG')) return 5000;
  if (symbol.includes('BTC') || symbol.includes('ETH')) return 1;
  return 100;
};

const getDefaultSpread = (symbol) => {
  if (!symbol) return 0.20;
  if (symbol.includes('XAU')) return 0.20;
  if (symbol.includes('WTI')) return 0.04;
  if (symbol.includes('XAG')) return 0.02;
  if (symbol.includes('BTC')) return 15.0;
  if (symbol.includes('ETH')) return 1.5;
  return 0.10;
};

const calculatePsychology = (history, maxDrawdown) => {
  let discipline = 100;
  let patience = 100;
  let emotionalControl = 100;
  let focus = 100;

  if (history.length > 0) {
    const last5 = history.slice(-5);
    const losses = last5.filter(t => t.profit < 0).length;
    emotionalControl = Math.max(40, 100 - losses * 12);
    
    const avgDuration = last5.reduce((acc, t) => acc + (t.closeTime - t.openTime), 0) / last5.length;
    if (avgDuration < 60000 * 5) {
      patience = 60;
    } else if (avgDuration < 60000 * 15) {
      patience = 80;
    }
    
    discipline = Math.max(50, 100 - Math.round(maxDrawdown * 3));
    focus = Math.max(45, 100 - Math.round(maxDrawdown * 4));
  }
  return { discipline, patience, emotionalControl, focus };
};

export const useTradeStore = create((set, get) => ({
  toasts: [],
  addToast: (signal) => {
    const id = Date.now() + Math.random();
    set((state) => ({ toasts: [...state.toasts, { id, signal }] }));
    setTimeout(() => {
      get().removeToast(id);
    }, 7000);
  },
  removeToast: (id) => {
    set((state) => ({ toasts: state.toasts.filter(t => t.id !== id) }));
  },
  // Authentication State
  isLoggedIn: !!getSavedToken(),
  user: getSavedUser(),
  token: getSavedToken(),
  isRegistering: false,
  loginError: '',
  registerSuccessMsg: '',
  rememberMe: true,

  // Admin Panel States
  currentView: 'dashboard',
  adminUsers: [],
  useMongoDB: true,
  adminLoading: false,
  adminError: '',
  adminSuccess: '',

  // Symbol & Timeframe Selection
  selectedSymbol: 'XAUUSD',
  selectedTimeframe: 'M1',

  // Custom Indicator System States
  selectedIndicatorSystem: 'zen',
  zenFastPeriod: 20,
  zenSlowPeriod: 50,
  utBotKeyValue: 2,
  utBotAtrPeriod: 10,
  chandelierAtrPeriod: 22,
  chandelierAtrMultiplier: 3.0,
  trendlineLength: 14,
  trendlineSlopeMult: 1.0,

  // Realtime Feeds & connection details
  livePrice: null,
  connectionStatus: false,
  utcTime: '',

  // Main Indicators Parameters
  ind1Type: 'EMA',
  ind1Period: 20,
  ind1Color: '#ca8a04',
  showInd1: true,

  ind2Type: 'EMA',
  ind2Period: 50,
  ind2Color: '#b25e3d',
  showInd2: true,

  // Oscillators (RSI / MACD)
  rsiType: 'RSI',
  rsiPeriod: 14,
  rsiColor: '#a855f7',
  showRsi: false,

  macdType: 'MACD',
  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,
  macdColor: '#3b82f6',
  showMacd: false,

  // Smart Money Concept (SMC)
  smcType: 'SMC',
  smcBosColor: '#ca8a04',
  smcChochColor: '#ef4444',
  showSmc: true,

  // Sidebar & Layout State
  configTab: 'ma',
  isSidebarHovered: false,
  isMobileMenuOpen: false,
  historyCount: 0,
  marketDataStatus: null,
  signals: initialSignals,
  trackedSignals: initialTrackedSignals,

  showConfigPanel: false,
  candleColorTheme: 'premium',
  riskCalculator: { accountBalance: 10000, riskPercentage: 1 },
  currentSignal: getTrackedSignalForIndicator(initialTrackedSignals, 'XAUUSD', 'M1', 'zen'),

  userBotSettings: {},

  // Virtual Account Simulation States
  candlesHistory: [],
  virtualAccount: getSavedVirtualAccount(),
  startingCapital: getSavedStartingCapital(),
  simulatedSpread: getSavedSimulatedSpread(),
  simulatedRiskPercent: getSavedSimulatedRiskPercent(),
  simulatedSlPoints: getSavedSimulatedSlPoints(),
  simulatedTpPoints: getSavedSimulatedTpPoints(),
  isSimulating: getSavedIsSimulating(),
  simulatedIndicator: getSavedSimulatedIndicator(),

  // Economic Calendar & VnWallStreet News States
  calendarEvents: [],
  calendarLoading: false,
  wallstreetNews: [],
  newsLoading: false,
  language: (typeof window !== 'undefined' ? localStorage.getItem('language') : 'vn') || 'vn',

  // Simple State Setters
  setIsRegistering: (val) => set({ isRegistering: val }),
  setLoginError: (val) => set({ loginError: val }),
  setRegisterSuccessMsg: (val) => set({ registerSuccessMsg: val }),
  setRememberMe: (val) => set({ rememberMe: val }),
  setCurrentView: (val) => {
    set({ currentView: val, adminError: '', adminSuccess: '' });
    if (typeof window !== 'undefined' && window.history) {
      const path = val === 'dashboard' ? '/' : `/${val}`;
      if (window.location.pathname !== path) {
        window.history.pushState(null, '', path);
      }
    }
  },
  setAdminError: (val) => set({ adminError: val }),
  setAdminSuccess: (val) => set({ adminSuccess: val }),
  setSelectedSymbol: (val) => {
    set((state) => ({
      selectedSymbol: val,
      currentSignal: getTrackedSignalForIndicator(
        state.trackedSignals, val, state.selectedTimeframe, state.selectedIndicatorSystem
      )
    }));
    set({ simulatedSpread: getDefaultSpread(val) });
  },
  setSelectedTimeframe: (val) => set((state) => ({
    selectedTimeframe: val,
    currentSignal: getTrackedSignalForIndicator(
      state.trackedSignals, state.selectedSymbol, val, state.selectedIndicatorSystem
    )
  })),
  setSelectedIndicatorSystem: (val) => set((state) => ({
    selectedIndicatorSystem: val,
    currentSignal: getTrackedSignalForIndicator(
      state.trackedSignals, state.selectedSymbol, state.selectedTimeframe, val
    )
  })),
  setZenFastPeriod: (val) => set({ zenFastPeriod: val }),
  setZenSlowPeriod: (val) => set({ zenSlowPeriod: val }),
  setUtBotKeyValue: (val) => set({ utBotKeyValue: val }),
  setUtBotAtrPeriod: (val) => set({ utBotAtrPeriod: val }),
  setChandelierAtrPeriod: (val) => set({ chandelierAtrPeriod: val }),
  setChandelierAtrMultiplier: (val) => set({ chandelierAtrMultiplier: val }),
  setTrendlineLength: (val) => set({ trendlineLength: val }),
  setTrendlineSlopeMult: (val) => set({ trendlineSlopeMult: val }),
  setLivePrice: (val) => {
    set((state) => {
      const symbolSignals = state.trackedSignals?.[state.selectedSymbol] || {};
      let lifecycleChanged = false;
      const updatedSymbolSignals = Object.fromEntries(Object.entries(symbolSignals).map(([timeframe, indicatorSignals]) => {
        const updatedIndicatorSignals = Object.fromEntries(
          Object.entries(indicatorSignals || {}).map(([indicator, signal]) => {
            const advanced = advanceSignalWithPrice(signal, val);
            if (advanced !== signal) lifecycleChanged = true;
            return [indicator, advanced];
          })
        );
        return [timeframe, updatedIndicatorSignals];
      }));
      if (!lifecycleChanged) return { livePrice: val };
      const trackedSignals = {
        ...state.trackedSignals,
        [state.selectedSymbol]: updatedSymbolSignals
      };
      persistTrackedSignals(trackedSignals);
      return {
        livePrice: val,
        trackedSignals,
        currentSignal: updatedSymbolSignals[state.selectedTimeframe]?.[state.selectedIndicatorSystem] || state.currentSignal
      };
    });
    get().updateVirtualTick(val);
  },
  setUtcTime: (val) => set({ utcTime: val }),
  setLanguage: (val) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('language', val);
    }
    set({ language: val });
  },
  setConnectionStatus: (val) => set({ connectionStatus: val }),


  fetchUserSettings: async () => {
    try {
      const token = localStorage.getItem('auth_token');
      const response = await fetch(`${SOCKET_URL}/api/user/settings`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        set({ userBotSettings: data.botSettings || {} });
      }
    } catch (e) {
      console.error('Error fetching user settings:', e);
    }
  },

  updateUserSettings: async (botSettings) => {
    try {
      const token = localStorage.getItem('auth_token');
      const response = await fetch(`${SOCKET_URL}/api/user/settings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ botSettings })
      });
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          set({ userBotSettings: data.botSettings });
          return true;
        }
      }
      return false;
    } catch (e) {
      console.error('Error updating user settings:', e);
      return false;
    }
  },

  setInd1Type: (val) => set({ ind1Type: val }),
  setInd1Period: (val) => set({ ind1Period: val }),
  setInd1Color: (val) => set({ ind1Color: val }),
  setShowInd1: (val) => set({ showInd1: val }),

  setInd2Type: (val) => set({ ind2Type: val }),
  setInd2Period: (val) => set({ ind2Period: val }),
  setInd2Color: (val) => set({ ind2Color: val }),
  setShowInd2: (val) => set({ showInd2: val }),

  setRsiType: (val) => set({ rsiType: val }),
  setRsiPeriod: (val) => set({ rsiPeriod: val }),
  setRsiColor: (val) => set({ rsiColor: val }),
  setShowRsi: (val) => set({ showRsi: val }),

  setMacdType: (val) => set({ macdType: val }),
  setMacdFast: (val) => set({ macdFast: val }),
  setMacdSlow: (val) => set({ macdSlow: val }),
  setMacdSignal: (val) => set({ macdSignal: val }),
  setMacdColor: (val) => set({ macdColor: val }),
  setShowMacd: (val) => set({ showMacd: val }),

  setSmcType: (val) => set({ smcType: val }),
  setSmcBosColor: (val) => set({ smcBosColor: val }),
  setSmcChochColor: (val) => set({ smcChochColor: val }),
  setShowSmc: (val) => set({ showSmc: val }),

  setConfigTab: (val) => set({ configTab: val }),
  setIsSidebarHovered: (val) => set({ isSidebarHovered: val }),
  setIsMobileMenuOpen: (val) => set({ isMobileMenuOpen: val }),
  setHistoryCount: (val) => set((state) => ({
    historyCount: typeof val === 'function' ? val(state.historyCount) : val
  })),
  setSignals: (val) => set((state) => ({
    signals: typeof val === 'function' ? val(state.signals) : val
  })),
  setTrackedSignal: (symbol, timeframe, indicator, signal) => set((state) => {
    const trackedSignals = putTrackedSignalForIndicator(
      state.trackedSignals, symbol, timeframe, indicator, signal
    );
    persistTrackedSignals(trackedSignals);
    return {
      trackedSignals,
      currentSignal: state.selectedSymbol === symbol && state.selectedTimeframe === timeframe &&
          state.selectedIndicatorSystem === indicator
        ? signal
        : state.currentSignal
    };
  }),

  toggleConfigPanel: () => set((state) => ({ showConfigPanel: !state.showConfigPanel })),
  setCandleColorTheme: (val) => set({ candleColorTheme: val }),
  updateRiskCalculator: (balance, risk) => set({
    riskCalculator: { accountBalance: balance, riskPercentage: risk }
  }),


  // Authentication Actions
  login: async (username, password) => {
    set({ loginError: '', registerSuccessMsg: '' });
    if (!username || !password) {
      set({ loginError: 'Vui lòng nhập đầy đủ thông tin.' });
      return false;
    }
    try {
      const response = await fetch(`${SOCKET_URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await response.json();
      if (response.ok && data.success) {
        localStorage.setItem('auth_token', data.token);
        localStorage.setItem('auth_user', JSON.stringify(data.user));
        set({
          token: data.token,
          user: data.user,
          isLoggedIn: true,
          loginError: ''
        });
        return true;
      } else {
        set({ loginError: data.error || 'Đăng nhập thất bại.' });
        return false;
      }
    } catch (err) {
      set({ loginError: 'Lỗi kết nối máy chủ xác thực.' });
      return false;
    }
  },

  register: async (username, password, name) => {
    set({ loginError: '', registerSuccessMsg: '' });
    if (!username || !password || !name) {
      set({ loginError: 'Vui lòng nhập đầy đủ thông tin đăng ký.' });
      return false;
    }
    try {
      const response = await fetch(`${SOCKET_URL}/api/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, name })
      });
      const data = await response.json();
      if (response.ok && data.success) {
        set({
          registerSuccessMsg: 'Đăng ký tài khoản thành công! Hãy đăng nhập.',
          isRegistering: false
        });
        return true;
      } else {
        set({ loginError: data.error || 'Đăng ký thất bại.' });
        return false;
      }
    } catch (err) {
      set({ loginError: 'Không thể kết nối đến máy chủ.' });
      return false;
    }
  },

  logout: () => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
    set({
      user: null,
      token: '',
      isLoggedIn: false,
      currentView: 'dashboard'
    });
  },

  checkAuth: () => {
    const token = localStorage.getItem('auth_token');
    const user = localStorage.getItem('auth_user');
    if (token && user) {
      try {
        set({
          token,
          user: JSON.parse(user),
          isLoggedIn: true
        });
      } catch {
        get().logout();
      }
    } else {
      get().logout();
    }
  },

  // Admin Actions
  fetchAdminUsers: async () => {
    set({ adminLoading: true, adminError: '' });
    const token = get().token || localStorage.getItem('auth_token');
    try {
      const response = await fetch(`${SOCKET_URL}/api/admin/users`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      if (response.ok && data.success) {
        set({ 
          adminUsers: data.users,
          useMongoDB: data.useMongoDB !== undefined ? data.useMongoDB : true
        });
      } else {
        set({ adminError: data.error || 'Không thể tải danh sách tài khoản.' });
      }
    } catch (err) {
      set({ adminError: 'Lỗi kết nối máy chủ.' });
    } finally {
      set({ adminLoading: false });
    }
  },

  createUser: async (username, password, name, role, expiresAt, telegramSupport, refCode) => {
    set({ adminError: '', adminSuccess: '' });
    if (!username || !password || !name || !role) {
      set({ adminError: 'Vui lòng điền đầy đủ thông tin.' });
      return false;
    }
    const token = get().token || localStorage.getItem('auth_token');
    try {
      const response = await fetch(`${SOCKET_URL}/api/admin/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ username, password, name, role, expiresAt, telegramSupport, refCode })
      });
      const data = await response.json();
      if (response.ok && data.success) {
        set({ adminSuccess: data.message || 'Tạo tài khoản thành công!' });
        get().fetchAdminUsers();
        return true;
      } else {
        set({ adminError: data.error || 'Tạo tài khoản thất bại.' });
        return false;
      }
    } catch (err) {
      set({ adminError: 'Lỗi kết nối máy chủ.' });
      return false;
    }
  },

  editUser: async (targetUsername, name, role, expiresAt, telegramSupport, refCode) => {
    set({ adminError: '', adminSuccess: '' });
    const token = get().token || localStorage.getItem('auth_token');
    try {
      const response = await fetch(`${SOCKET_URL}/api/admin/users/${targetUsername}/edit`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ name, role, expiresAt, telegramSupport, refCode })
      });
      const data = await response.json();
      if (response.ok && data.success) {
        set({ adminSuccess: data.message || 'Cập nhật tài khoản thành công!' });
        get().fetchAdminUsers();
        return true;
      } else {
        set({ adminError: data.error || 'Cập nhật tài khoản thất bại.' });
        return false;
      }
    } catch (err) {
      set({ adminError: 'Lỗi kết nối máy chủ.' });
      return false;
    }
  },

  updatePassword: async (targetUsername, password) => {
    set({ adminError: '', adminSuccess: '' });
    if (!password || password.length < 6) {
      set({ adminError: 'Mật khẩu mới phải từ 6 ký tự trở lên.' });
      return false;
    }
    const token = get().token || localStorage.getItem('auth_token');
    try {
      const response = await fetch(`${SOCKET_URL}/api/admin/users/${targetUsername}/password`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ password })
      });
      const data = await response.json();
      if (response.ok && data.success) {
        set({ adminSuccess: data.message || 'Cập nhật mật khẩu thành công!' });
        return true;
      } else {
        set({ adminError: data.error || 'Cập nhật mật khẩu thất bại.' });
        return false;
      }
    } catch (err) {
      set({ adminError: 'Lỗi kết nối máy chủ.' });
      return false;
    }
  },

  changeRole: async (targetUsername, role) => {
    set({ adminError: '', adminSuccess: '' });
    const token = get().token || localStorage.getItem('auth_token');
    try {
      const response = await fetch(`${SOCKET_URL}/api/admin/users/${targetUsername}/role`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ role })
      });
      const data = await response.json();
      if (response.ok && data.success) {
        set({ adminSuccess: data.message || 'Cập nhật quyền thành công!' });
        get().fetchAdminUsers();
        return true;
      } else {
        set({ adminError: data.error || 'Cập nhật quyền thất bại.' });
        return false;
      }
    } catch (err) {
      set({ adminError: 'Lỗi kết nối máy chủ.' });
      return false;
    }
  },

  deleteUser: async (targetUsername) => {
    set({ adminError: '', adminSuccess: '' });
    const token = get().token || localStorage.getItem('auth_token');
    try {
      const response = await fetch(`${SOCKET_URL}/api/admin/users/${targetUsername}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      if (response.ok && data.success) {
        set({ adminSuccess: data.message || 'Xóa tài khoản thành công!' });
        get().fetchAdminUsers();
        return true;
      } else {
        set({ adminError: data.error || 'Xóa tài khoản thất bại.' });
        return false;
      }
    } catch (err) {
      set({ adminError: 'Lỗi kết nối máy chủ.' });
      return false;
    }
  },
  
  // Virtual Simulation Actions
  setCandlesHistory: (candles) => set({ candlesHistory: candles }),
  
  setStartingCapital: (capital) => {
    localStorage.setItem('starting_capital', capital);
    set({ startingCapital: capital });
  },
  
  setSimulatedSpread: (spread) => {
    localStorage.setItem('simulated_spread', spread);
    set({ simulatedSpread: spread });
  },
  
  setSimulatedRiskPercent: (risk) => {
    localStorage.setItem('simulated_risk_percent', risk);
    set({ simulatedRiskPercent: risk });
  },
  
  setSimulatedSlPoints: (sl) => {
    localStorage.setItem('simulated_sl_points', sl);
    set({ simulatedSlPoints: sl });
  },
  
  setSimulatedTpPoints: (tp) => {
    localStorage.setItem('simulated_tp_points', tp);
    set({ simulatedTpPoints: tp });
  },
  
  setSimulatedIndicator: (val) => {
    localStorage.setItem('simulated_indicator', val);
    set({ simulatedIndicator: val });
  },
  
  stopVirtualSimulation: () => {
    localStorage.setItem('is_simulating', 'false');
    const nextAccount = {
      ...get().virtualAccount,
      openTrades: []
    };
    set({ 
      isSimulating: false,
      virtualAccount: nextAccount
    });
    localStorage.setItem('virtual_account', JSON.stringify(nextAccount));
  },
  
  startVirtualSimulation: () => {
    localStorage.setItem('is_simulating', 'true');
    const { startingCapital, selectedSymbol, simulatedSpread, simulatedRiskPercent, simulatedSlPoints, simulatedTpPoints, simulatedIndicator, candlesHistory } = get();
    
    const initialAccount = {
      balance: startingCapital,
      equity: startingCapital,
      history: [],
      openTrades: [],
      maxDrawdown: 0,
      peakBalance: startingCapital,
      psychologyScore: { discipline: 100, patience: 100, emotionalControl: 100, focus: 100 },
      lastSignalTime: 0
    };
    
    set({
      virtualAccount: initialAccount,
      isSimulating: true
    });
    
    if (!candlesHistory || candlesHistory.length < 30) {
      localStorage.setItem('virtual_account', JSON.stringify(initialAccount));
      return;
    }
    
    let balance = startingCapital;
    let peakBalance = startingCapital;
    let maxDrawdown = 0;
    const closedTrades = [];
    let activeTrade = null;
    let lastSignalTime = 0;
    
    let signalsData = [];
    if (simulatedIndicator === 'zen') {
      signalsData = calculateZenTrendLines(candlesHistory, get().zenFastPeriod, get().zenSlowPeriod);
    } else if (simulatedIndicator === 'utbot') {
      signalsData = calculateUTBotSignals(candlesHistory, get().utBotKeyValue, get().utBotAtrPeriod);
    } else if (simulatedIndicator === 'chandelier') {
      signalsData = calculateChandelierExit(candlesHistory, get().chandelierAtrPeriod, get().chandelierAtrMultiplier);
    } else if (simulatedIndicator === 'trendline') {
      signalsData = calculateTrendlinesWithBreaks(candlesHistory, get().trendlineLength, get().trendlineSlopeMult);
    }
    
    const signalByTime = {};
    signalsData.forEach(sig => {
      signalByTime[sig.time] = sig;
    });
    
    const atrValues = calculateATR(candlesHistory, 14);
    const atrByTime = {};
    atrValues.forEach(item => {
      atrByTime[item.time] = item.value;
    });
    
    const contractSize = getContractSize(selectedSymbol);
    
    for (let i = 20; i < candlesHistory.length - 1; i++) {
      const candle = candlesHistory[i];
      const time = candle.time;
      const closePrice = candle.close;
      const atrVal = atrByTime[time] || (candle.high - candle.low || 0.1);
      
      const dynamicSLOffset = atrVal * 1.5;
      const dynamicTPOffset = atrVal * 3;
      
      const sig = signalByTime[time];
      if (!sig) continue;
      
      let action = 'stale';
      if (simulatedIndicator === 'zen') {
        action = sig.trend === 'bullish' ? 'buy' : 'sell';
      } else if (simulatedIndicator === 'utbot' || simulatedIndicator === 'chandelier' || simulatedIndicator === 'trendline') {
        if (sig.buy) action = 'buy';
        else if (sig.sell) action = 'sell';
      }
      
      if (activeTrade) {
        let isClosed = false;
        let exitPrice = 0;
        let exitTime = candle.time * 1000;
        let reason = '';
        
        if (activeTrade.type === 'buy') {
          if (candle.low - simulatedSpread <= activeTrade.sl) {
            isClosed = true;
            exitPrice = activeTrade.sl;
            reason = 'SL';
          } else if (candle.high - simulatedSpread >= activeTrade.tp) {
            isClosed = true;
            exitPrice = activeTrade.tp;
            reason = 'TP';
          }
        } else {
          if (candle.high + simulatedSpread >= activeTrade.sl) {
            isClosed = true;
            exitPrice = activeTrade.sl;
            reason = 'SL';
          } else if (candle.low + simulatedSpread <= activeTrade.tp) {
            isClosed = true;
            exitPrice = activeTrade.tp;
            reason = 'TP';
          }
        }
        
        if (isClosed) {
          const profit = activeTrade.type === 'buy'
            ? (exitPrice - activeTrade.openPrice) * activeTrade.lot * contractSize
            : (activeTrade.openPrice - exitPrice) * activeTrade.lot * contractSize;
          
          balance += profit;
          if (balance > peakBalance) peakBalance = balance;
          const dd = ((peakBalance - balance) / peakBalance) * 100;
          if (dd > maxDrawdown) maxDrawdown = dd;
          
          closedTrades.push({
            ...activeTrade,
            closePrice,
            closePriceActual: exitPrice,
            closeTime: exitTime,
            profit: parseFloat(profit.toFixed(2)),
            status: profit >= 0 ? 'win' : 'loss',
            reason
          });
          
          activeTrade = null;
        }
      }
      
      if (!activeTrade && (action === 'buy' || action === 'sell')) {
        const sigTime = sig.time * 1000;
        if (sigTime > lastSignalTime) {
          lastSignalTime = sigTime;
          const entryPrice = action === 'buy'
            ? candle.close + simulatedSpread
            : candle.close - simulatedSpread;
            
          const sl = action === 'buy' ? entryPrice - simulatedSlPoints : entryPrice + simulatedSlPoints;
          const tp = action === 'buy' ? entryPrice + simulatedTpPoints : entryPrice - simulatedTpPoints;
          
          const slDistance = Math.abs(entryPrice - sl);
          const riskAmount = balance * (simulatedRiskPercent / 100);
          let lot = slDistance > 0 ? riskAmount / (slDistance * contractSize) : 0.1;
          lot = parseFloat(Math.max(0.01, Math.min(100, lot)).toFixed(2));
          
          activeTrade = {
            id: 'T-' + Math.random().toString(36).substr(2, 9).toUpperCase(),
            symbol: selectedSymbol,
            type: action,
            openPrice: entryPrice,
            openTime: candle.time * 1000,
            sl,
            tp,
            lot,
            contractSize
          };
        }
      }
    }
    
    const trimmedHistory = closedTrades.slice(-15);
    const psychologyScore = calculatePsychology(trimmedHistory, maxDrawdown);
    
    const finalAccount = {
      balance: parseFloat(balance.toFixed(2)),
      equity: activeTrade ? parseFloat(balance.toFixed(2)) : parseFloat(balance.toFixed(2)),
      history: trimmedHistory,
      openTrades: activeTrade ? [activeTrade] : [],
      maxDrawdown: parseFloat(maxDrawdown.toFixed(2)),
      peakBalance,
      psychologyScore,
      lastSignalTime
    };
    
    set({ virtualAccount: finalAccount });
    localStorage.setItem('virtual_account', JSON.stringify(finalAccount));
  },
  
  updateVirtualTick: (livePrice) => {
    const { isSimulating, virtualAccount, selectedSymbol, simulatedSpread, simulatedRiskPercent, simulatedSlPoints, simulatedTpPoints, simulatedIndicator, candlesHistory } = get();
    if (!isSimulating || !livePrice) return;
    
    const { balance, history, openTrades, peakBalance, maxDrawdown } = virtualAccount;
    const contractSize = getContractSize(selectedSymbol);
    
    let currentEquity = balance;
    let hasTradeClosed = false;
    const updatedOpenTrades = [];
    const newHistory = [...history];
    let newBalance = balance;
    let newPeakBalance = peakBalance;
    let newMaxDrawdown = maxDrawdown;
    
    const currentSignal = getLatestSignalForSystem(simulatedIndicator, candlesHistory, get());
    
    for (const trade of openTrades) {
      let floatingPnl = 0;
      let isClosed = false;
      let exitPrice = 0;
      let reason = '';
      
      if (trade.type === 'buy') {
        floatingPnl = (livePrice - trade.openPrice) * trade.lot * contractSize;
        if (livePrice <= trade.sl) {
          isClosed = true;
          exitPrice = trade.sl;
          reason = 'SL';
        } else if (livePrice >= trade.tp) {
          isClosed = true;
          exitPrice = trade.tp;
          reason = 'TP';
        }
      } else {
        floatingPnl = (trade.openPrice - livePrice) * trade.lot * contractSize;
        if (livePrice >= trade.sl) {
          isClosed = true;
          exitPrice = trade.sl;
          reason = 'SL';
        } else if (livePrice <= trade.tp) {
          isClosed = true;
          exitPrice = trade.tp;
          reason = 'TP';
        }
      }
      
      if (isClosed) {
        const pnl = trade.type === 'buy'
          ? (exitPrice - trade.openPrice) * trade.lot * contractSize
          : (trade.openPrice - exitPrice) * trade.lot * contractSize;
        
        newBalance += pnl;
        if (newBalance > newPeakBalance) newPeakBalance = newBalance;
        const dd = ((newPeakBalance - newBalance) / newPeakBalance) * 100;
        if (dd > newMaxDrawdown) newMaxDrawdown = dd;
        
        newHistory.push({
          ...trade,
          closePrice: livePrice,
          closePriceActual: exitPrice,
          closeTime: Date.now(),
          profit: parseFloat(pnl.toFixed(2)),
          status: pnl >= 0 ? 'win' : 'loss',
          reason
        });
        hasTradeClosed = true;
      } else {
        trade.floatingPnl = parseFloat(floatingPnl.toFixed(2));
        currentEquity += floatingPnl;
        updatedOpenTrades.push(trade);
      }
    }
    
    if (hasTradeClosed && updatedOpenTrades.length === 0) {
      currentEquity = newBalance;
    }
    
    let newLastSignalTime = virtualAccount.lastSignalTime || 0;
    
    if (updatedOpenTrades.length === 0 && currentSignal && (currentSignal.action === 'buy' || currentSignal.action === 'sell')) {
      const lastSignalTime = virtualAccount.lastSignalTime || 0;
      if (currentSignal.timestamp > lastSignalTime) {
        newLastSignalTime = currentSignal.timestamp;
        const entryPrice = currentSignal.action === 'buy'
          ? livePrice + simulatedSpread
          : livePrice - simulatedSpread;
          
        const sl = currentSignal.action === 'buy'
          ? entryPrice - simulatedSlPoints
          : entryPrice + simulatedSlPoints;
        const tp = currentSignal.action === 'buy'
          ? entryPrice + simulatedTpPoints
          : entryPrice - simulatedTpPoints;
        
        const slDistance = Math.abs(entryPrice - sl);
        const riskAmount = newBalance * (simulatedRiskPercent / 100);
        let lot = slDistance > 0 ? riskAmount / (slDistance * contractSize) : 0.1;
        lot = parseFloat(Math.max(0.01, Math.min(100, lot)).toFixed(2));
        
        const newTrade = {
          id: 'T-' + Math.random().toString(36).substr(2, 9).toUpperCase(),
          symbol: selectedSymbol,
          type: currentSignal.action,
          openPrice: entryPrice,
          openTime: Date.now(),
          sl,
          tp,
          lot,
          contractSize,
          floatingPnl: 0
        };
        
        updatedOpenTrades.push(newTrade);
      }
    }
    
    const trimmedHistory = newHistory.slice(-15);
    const psychologyScore = calculatePsychology(trimmedHistory, newMaxDrawdown);
    
    const nextAccount = {
      balance: parseFloat(newBalance.toFixed(2)),
      equity: parseFloat(currentEquity.toFixed(2)),
      history: trimmedHistory,
      openTrades: updatedOpenTrades,
      maxDrawdown: parseFloat(newMaxDrawdown.toFixed(2)),
      peakBalance: newPeakBalance,
      psychologyScore,
      lastSignalTime: newLastSignalTime
    };
    
    set({ virtualAccount: nextAccount });
    
    // Performance Optimization: Only write to localStorage when critical trading events happen (open/close trade).
    // Floating equity/PnL changes do NOT need to be saved every second since they are dynamically recalculated from livePrice on page load.
    const hasTradesChanged = openTrades.length !== updatedOpenTrades.length || hasTradeClosed;
    if (hasTradesChanged) {
      localStorage.setItem('virtual_account', JSON.stringify(nextAccount));
    }
  },

  fetchNews: async (limit = 20, start = 0, importantOnly = false) => {
    set({ newsLoading: true });
    const token = get().token || localStorage.getItem('auth_token');
    try {
      const importantParam = importantOnly ? '&important=1' : '';
      const response = await fetch(`${SOCKET_URL}/api/external/news?limit=${limit}&start=${start}${importantParam}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      if (response.ok && data.data) {
        set({ wallstreetNews: data.data });
      }
    } catch (err) {
      console.error('Error fetching wallstreet news:', err.message);
    } finally {
      set({ newsLoading: false });
    }
  },

  fetchCalendarForDateRange: async (startDateStr, endDateStr) => {
    set({ calendarLoading: true, calendarEvents: [] });
    const token = get().token || localStorage.getItem('auth_token');
    
    const start = new Date(startDateStr);
    const end = new Date(endDateStr);
    const dateStrings = [];
    
    const maxDays = 14;
    let current = new Date(start);
    let dayCount = 0;
    
    while (current <= end && dayCount < maxDays) {
      const year = current.getFullYear();
      const month = current.getMonth() + 1;
      const day = current.getDate();
      dateStrings.push(`${year}/${month}/${day}`);
      
      current.setDate(current.getDate() + 1);
      dayCount++;
    }
    
    try {
      // Fetch VnWallStreet calendar day-by-day as before
      const vnPromises = dateStrings.map(async (dStr) => {
        try {
          const res = await fetch(`${SOCKET_URL}/api/external/calendar?date=${encodeURIComponent(dStr)}`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if (res.ok) {
            const result = await res.json();
            return result.data?.list || [];
          }
        } catch (e) {
          console.error(`Error fetching calendar for ${dStr}:`, e.message);
        }
        return [];
      });
      
      // Fetch Finnhub calendar for the entire range in parallel
      const fetchFinnhub = async () => {
        try {
          const res = await fetch(`${SOCKET_URL}/api/external/finnhub-calendar?from=${startDateStr}&to=${endDateStr}`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if (res.ok) {
            const result = await res.json();
            return result.economicCalendar || [];
          }
        } catch (e) {
          console.error('Error fetching Finnhub calendar:', e.message);
        }
        return [];
      };

      const [vnResults, finnhubEvents] = await Promise.all([
        Promise.all(vnPromises),
        fetchFinnhub()
      ]);
      
      let mergedEvents = [];
      vnResults.forEach((dayEvents) => {
        mergedEvents = mergedEvents.concat(dayEvents);
      });
      
      const seen = new Set();
      const uniqueEvents = [];
      for (const ev of mergedEvents) {
        const title = ev.events_translate || ev.events;
        if (!title) continue;
        
        const key = ev.id || ev.events_id || `${ev.events_time}-${ev.country}-${title}`;
        if (!seen.has(key)) {
          seen.add(key);
          uniqueEvents.push(ev);
        }
      }

      // Map Finnhub events to make lookup easy.
      // Match by country, simplified event name, and date (same day in UTC or local).
      const normalizeStr = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const getFormattedDate = (dStr) => {
        if (!dStr) return '';
        try {
          const d = new Date(dStr);
          return d.toISOString().slice(0, 10); // YYYY-MM-DD
        } catch (_) {
          return '';
        }
      };

      // Group Finnhub events by country for faster lookup
      const fhMap = {};
      finnhubEvents.forEach(fh => {
        const cCode = (fh.country || '').toUpperCase();
        if (!fhMap[cCode]) fhMap[cCode] = [];
        fhMap[cCode].push({
          ...fh,
          normEvent: normalizeStr(fh.event),
          date: getFormattedDate(fh.time)
        });
      });

      // Merge Finnhub data into vnwallstreet events if data is missing
      uniqueEvents.forEach(ev => {
        // Only merge if we actually need data (one of consensus, actual, previous is missing or is '---')
        const needsData = !ev.consensus || ev.consensus === '---' || 
                          !ev.actual || ev.actual === '---' || 
                          !ev.previous || ev.previous === '---';
        if (!needsData) return;

        const evCountry = (ev.country || '').toUpperCase();
        const candidates = fhMap[evCountry] || [];
        if (candidates.length === 0) return;

        const evNorm = normalizeStr(ev.events);
        const evDate = getFormattedDate(ev.pub_time_tz || ev.tz);

        // Find the best match
        let bestMatch = null;
        let bestScore = 0;

        for (const fh of candidates) {
          // Date check: must be same day or ±1 day due to timezone shifts
          if (evDate && fh.date) {
            const d1 = new Date(evDate).getTime();
            const d2 = new Date(fh.date).getTime();
            const diffDays = Math.abs(d1 - d2) / (1000 * 60 * 60 * 24);
            if (diffDays > 1.2) continue; // Skip if date is too far
          }

          // Exact or substring match of event name
          let score = 0;
          if (fh.normEvent === evNorm) {
            score = 10;
          } else if (evNorm.includes(fh.normEvent) || fh.normEvent.includes(evNorm)) {
            score = 5;
          } else {
            // Check common keywords match
            const fhWords = fh.normEvent.split(' ');
            const evWords = evNorm.split(' ');
            const common = fhWords.filter(w => w.length > 2 && evWords.includes(w));
            if (common.length >= 2) {
              score = common.length;
            }
          }

          if (score > bestScore) {
            bestScore = score;
            bestMatch = fh;
          }
        }

        if (bestMatch && bestScore >= 2) {
          // Helper to append unit if present
          const formatValueWithUnit = (val, unit) => {
            if (val === undefined || val === null || val === '') return '';
            const valStr = String(val);
            if (!unit || valStr.includes(unit) || valStr.includes('%')) return valStr;
            return `${valStr}${unit}`;
          };

          // Merge consensus (forecast)
          if ((!ev.consensus || ev.consensus === '---') && bestMatch.estimate !== undefined && bestMatch.estimate !== null) {
            ev.consensus = formatValueWithUnit(bestMatch.estimate, bestMatch.unit);
            ev.isConsensusFromFinnhub = true;
          }

          // Merge actual
          if ((!ev.actual || ev.actual === '---') && bestMatch.actual !== undefined && bestMatch.actual !== null) {
            ev.actual = formatValueWithUnit(bestMatch.actual, bestMatch.unit);
            ev.isActualFromFinnhub = true;
          }

          // Merge previous
          if ((!ev.previous || ev.previous === '---') && bestMatch.prev !== undefined && bestMatch.prev !== null) {
            ev.previous = formatValueWithUnit(bestMatch.prev, bestMatch.unit);
            ev.isPreviousFromFinnhub = true;
          }
        }
      });
      
      uniqueEvents.sort((a, b) => {
        const timeA = new Date(a.pub_time_tz || a.tz || 0).getTime();
        const timeB = new Date(b.pub_time_tz || b.tz || 0).getTime();
        return timeA - timeB;
      });
      
      set({ calendarEvents: uniqueEvents });
    } catch (err) {
      console.error('Error fetching calendar range:', err.message);
    } finally {
      set({ calendarLoading: false });
    }
  },

  // MT5 Copy Trading state
  mt5Accounts: [],
  mt5Loading: false,
  mt5Error: null,
  mt5Success: null,

  clearMt5Messages: () => set({ mt5Error: null, mt5Success: null }),

  fetchMt5Accounts: async () => {
    set({ mt5Loading: true, mt5Error: null });
    const token = get().token || localStorage.getItem('auth_token');
    try {
      const response = await fetch(`${SOCKET_URL}/api/v1/accounts`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      if (response.ok) {
        set({ mt5Accounts: data.accounts || [] });
      } else {
        set({ mt5Error: data.error || 'Không thể tải danh sách tài khoản MT5.' });
      }
    } catch (err) {
      set({ mt5Error: err.message });
    } finally {
      set({ mt5Loading: false });
    }
  },

  connectMt5Account: async (accountData) => {
    set({ mt5Loading: true, mt5Error: null, mt5Success: null });
    const token = get().token || localStorage.getItem('auth_token');
    try {
      const response = await fetch(`${SOCKET_URL}/api/v1/accounts/connect`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify(accountData)
      });
      const data = await response.json();
      if (response.ok) {
        set({ mt5Success: 'Kết nối tài khoản MT5 thành công!' });
        get().fetchMt5Accounts();
        return true;
      } else {
        set({ mt5Error: data.error || 'Kết nối tài khoản thất bại.' });
        return false;
      }
    } catch (err) {
      set({ mt5Error: err.message });
      return false;
    } finally {
      set({ mt5Loading: false });
    }
  },

  disconnectMt5Account: async (id) => {
    set({ mt5Loading: true, mt5Error: null, mt5Success: null });
    const token = get().token || localStorage.getItem('auth_token');
    try {
      const response = await fetch(`${SOCKET_URL}/api/v1/accounts/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      if (response.ok) {
        set({ mt5Success: 'Đã hủy kết nối tài khoản MT5!' });
        get().fetchMt5Accounts();
        return true;
      } else {
        set({ mt5Error: data.error || 'Hủy kết nối tài khoản thất bại.' });
        return false;
      }
    } catch (err) {
      set({ mt5Error: err.message });
      return false;
    } finally {
      set({ mt5Loading: false });
    }
  },

  updateMt5Risk: async (id, riskConfig) => {
    set({ mt5Loading: true, mt5Error: null, mt5Success: null });
    const token = get().token || localStorage.getItem('auth_token');
    try {
      const response = await fetch(`${SOCKET_URL}/api/v1/accounts/${id}/risk`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify({ riskConfig })
      });
      const data = await response.json();
      if (response.ok) {
        set({ mt5Success: 'Cập nhật cấu hình rủi ro thành công!' });
        get().fetchMt5Accounts();
        return true;
      } else {
        set({ mt5Error: data.error || 'Cập nhật rủi ro thất bại.' });
        return false;
      }
    } catch (err) {
      set({ mt5Error: err.message });
      return false;
    } finally {
      set({ mt5Loading: false });
    }
  }
}));
